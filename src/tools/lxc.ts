import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import { confirmField, guardTarget, nodeField, settleTask, vmidField } from './helpers.js';
import { requireConfirm, requireMatchingId } from '../guards/confirm.js';
import type { Params } from '../proxmox/client.js';
import type { PveClusterResource, PveGuestStatus } from '../proxmox/types.js';

export function registerLxcTools(reg: ToolRegistry): void {
  reg.register(
    {
      name: 'pve_list_containers',
      title: 'List containers',
      description:
        'List LXC containers. With a node, lists that node directly; without one, returns every ' +
        'container in the cluster from the resource index.',
      schema: { node: z.string().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ node }, ctx) => {
      if (node) {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/lxc`);
      }
      return ctx.client.get<PveClusterResource[]>('/cluster/resources', { params: { type: 'vm' } });
    },
  );

  reg.register(
    {
      name: 'pve_lxc_status',
      title: 'Container status',
      description: 'Current runtime status of a container (running/stopped, CPU, memory, uptime).',
      schema: { node: nodeField, vmid: vmidField },
      annotations: { readOnlyHint: true },
    },
    ({ node, vmid }, ctx) => {
      guardTarget(ctx, node, vmid);
      return ctx.client.get<PveGuestStatus>(`/nodes/${node}/lxc/${vmid}/status/current`);
    },
  );

  reg.register(
    {
      name: 'pve_lxc_config',
      title: 'Container config',
      description: 'Full configuration of a container (cores, memory, rootfs, network, features).',
      schema: { node: nodeField, vmid: vmidField },
      annotations: { readOnlyHint: true },
    },
    ({ node, vmid }, ctx) => {
      guardTarget(ctx, node, vmid);
      return ctx.client.get(`/nodes/${node}/lxc/${vmid}/config`);
    },
  );

  registerLifecycle(reg, 'start', false, 'Start a stopped container.');
  registerLifecycle(reg, 'shutdown', false, 'Gracefully shut down a container.');
  registerLifecycle(reg, 'reboot', false, 'Reboot a container.');
  registerLifecycle(reg, 'stop', true, 'Immediately stop a container (no graceful shutdown).');

  reg.register(
    {
      name: 'pve_lxc_create',
      title: 'Create container',
      description:
        'Create a new LXC container from a template. The template must already exist on storage ' +
        '(see pve_storage_content with content=vztmpl). Returns the task outcome when done.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        ostemplate: z
          .string()
          .min(1)
          .describe(
            'Template volume id, e.g. "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"',
          ),
        hostname: z.string().optional(),
        cores: z.number().int().positive().default(1),
        memory: z.number().int().positive().default(512).describe('Memory in MiB'),
        swap: z.number().int().nonnegative().default(512).describe('Swap in MiB'),
        rootfs: z.object({
          storage: z.string().min(1),
          sizeGb: z.number().int().positive(),
        }),
        net: z
          .object({
            bridge: z.string().min(1).default('vmbr0'),
            name: z.string().min(1).default('eth0'),
            ip: z.string().default('dhcp').describe('"dhcp" or a static CIDR like 10.0.0.5/24'),
            gateway: z.string().optional(),
          })
          .optional(),
        password: z.string().optional().describe('Root password for the container'),
        sshPublicKeys: z.string().optional().describe('One or more SSH public keys'),
        unprivileged: z.boolean().default(true),
        start: z.boolean().default(false),
        extra: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      const params: Params = {
        vmid: args.vmid,
        ostemplate: args.ostemplate,
        hostname: args.hostname,
        cores: args.cores,
        memory: args.memory,
        swap: args.swap,
        rootfs: `${args.rootfs.storage}:${args.rootfs.sizeGb}`,
        unprivileged: args.unprivileged,
        start: args.start,
        password: args.password,
        'ssh-public-keys': args.sshPublicKeys,
      };
      if (args.net) {
        const gw = args.net.gateway ? `,gw=${args.net.gateway}` : '';
        params.net0 = `name=${args.net.name},bridge=${args.net.bridge},ip=${args.net.ip}${gw}`;
      }
      Object.assign(params, args.extra);
      const data = await ctx.client.post(`/nodes/${args.node}/lxc`, { params });
      return settleTask(ctx, data, { action: 'create', vmid: args.vmid });
    },
  );

  reg.register(
    {
      name: 'pve_lxc_clone',
      title: 'Clone container',
      description: 'Clone a container into a new VMID. Set full=true for an independent copy.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        newid: vmidField.describe('VMID for the new clone'),
        hostname: z.string().optional(),
        full: z.boolean().default(false),
        storage: z.string().optional().describe('Target storage for a full clone'),
        target: z.string().optional().describe('Target node for the clone'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      guardTarget(ctx, args.target ?? args.node, args.newid);
      const data = await ctx.client.post(`/nodes/${args.node}/lxc/${args.vmid}/clone`, {
        params: {
          newid: args.newid,
          hostname: args.hostname,
          full: args.full,
          storage: args.storage,
          target: args.target,
        },
      });
      return settleTask(ctx, data, { action: 'clone', from: args.vmid, to: args.newid });
    },
  );

  reg.register(
    {
      name: 'pve_lxc_delete',
      title: 'Delete container',
      description:
        'Permanently delete a container and its rootfs. Requires confirm=true and confirmVmid set ' +
        'to the same VMID. This cannot be undone.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        confirm: confirmField,
        confirmVmid: z.number().int().positive().describe('Repeat the VMID to confirm deletion'),
        purge: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      requireConfirm(args.confirm, `delete container ${args.vmid}`);
      requireMatchingId(args.confirmVmid, args.vmid, `container ${args.vmid}`);
      const data = await ctx.client.delete(`/nodes/${args.node}/lxc/${args.vmid}`, {
        params: { purge: args.purge, 'destroy-unreferenced-disks': true },
      });
      return settleTask(ctx, data, { action: 'delete', vmid: args.vmid });
    },
  );
}

function registerLifecycle(
  reg: ToolRegistry,
  op: 'start' | 'stop' | 'shutdown' | 'reboot',
  destructive: boolean,
  description: string,
): void {
  reg.register(
    {
      name: `pve_lxc_${op}`,
      title: `Container ${op}`,
      description,
      schema: destructive
        ? { node: nodeField, vmid: vmidField, confirm: confirmField }
        : { node: nodeField, vmid: vmidField },
      annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      if (destructive) {
        requireConfirm((args as { confirm?: boolean }).confirm, `${op} container ${args.vmid}`);
      }
      const data = await ctx.client.post(`/nodes/${args.node}/lxc/${args.vmid}/status/${op}`);
      return settleTask(ctx, data, { action: op, vmid: args.vmid });
    },
  );
}
