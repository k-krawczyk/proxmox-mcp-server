import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import { confirmField, guardTarget, nodeField, settleTask, vmidField } from './helpers.js';
import { requireConfirm, requireMatchingId } from '../guards/confirm.js';
import type { Params } from '../proxmox/client.js';
import type { PveClusterResource, PveGuestStatus } from '../proxmox/types.js';

const diskSchema = z
  .object({
    storage: z.string().min(1).describe('Storage id for the disk, e.g. "local-lvm"'),
    sizeGb: z.number().int().positive().describe('Disk size in GiB'),
    bus: z.enum(['scsi', 'virtio', 'sata', 'ide']).default('scsi'),
  })
  .describe('Primary disk to allocate');

const netSchema = z
  .object({
    bridge: z.string().min(1).default('vmbr0'),
    model: z.enum(['virtio', 'e1000', 'rtl8139', 'vmxnet3']).default('virtio'),
    vlan: z.number().int().min(1).max(4094).optional().describe('Optional VLAN tag'),
  })
  .describe('Primary network interface (net0)');

const isoSchema = z
  .object({
    storage: z.string().min(1),
    file: z.string().min(1).describe('ISO file name as listed by pve_storage_content'),
  })
  .describe('ISO image to attach as a CD-ROM on ide2');

export function registerQemuTools(reg: ToolRegistry): void {
  reg.register(
    {
      name: 'pve_list_vms',
      title: 'List VMs',
      description:
        'List QEMU VMs. With a node, lists that node directly; without one, returns every VM in ' +
        'the cluster from the resource index.',
      schema: { node: z.string().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ node }, ctx) => {
      if (node) {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/qemu`);
      }
      return ctx.client.get<PveClusterResource[]>('/cluster/resources', { params: { type: 'vm' } });
    },
  );

  reg.register(
    {
      name: 'pve_vm_status',
      title: 'VM status',
      description: 'Current runtime status of a VM (running/stopped, CPU, memory, uptime).',
      schema: { node: nodeField, vmid: vmidField },
      annotations: { readOnlyHint: true },
    },
    ({ node, vmid }, ctx) => {
      guardTarget(ctx, node, vmid);
      return ctx.client.get<PveGuestStatus>(`/nodes/${node}/qemu/${vmid}/status/current`);
    },
  );

  reg.register(
    {
      name: 'pve_vm_config',
      title: 'VM config',
      description: 'Full configuration of a VM (cores, memory, disks, network, boot order).',
      schema: { node: nodeField, vmid: vmidField },
      annotations: { readOnlyHint: true },
    },
    ({ node, vmid }, ctx) => {
      guardTarget(ctx, node, vmid);
      return ctx.client.get(`/nodes/${node}/qemu/${vmid}/config`);
    },
  );

  registerLifecycle(reg, 'start', false, 'Start a stopped VM.');
  registerLifecycle(reg, 'shutdown', false, 'Gracefully shut down a VM via ACPI.');
  registerLifecycle(reg, 'reboot', false, 'Gracefully reboot a VM via ACPI.');
  registerLifecycle(reg, 'stop', true, 'Immediately power off a VM (no graceful shutdown).');
  registerLifecycle(reg, 'reset', true, 'Hard-reset a VM (equivalent to the reset button).');

  reg.register(
    {
      name: 'pve_vm_create',
      title: 'Create VM',
      description:
        'Create a new QEMU VM. Provide structured disk/net/iso, or use the raw passthrough for ' +
        'advanced options. Returns the task outcome once provisioning finishes.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        name: z.string().optional(),
        cores: z.number().int().positive().default(1),
        sockets: z.number().int().positive().default(1),
        memory: z.number().int().positive().default(512).describe('Memory in MiB'),
        ostype: z.string().default('l26').describe('Guest OS type, e.g. l26, win11, other'),
        scsihw: z.string().default('virtio-scsi-single'),
        disk: diskSchema.optional(),
        net: netSchema.optional(),
        iso: isoSchema.optional(),
        start: z.boolean().default(false).describe('Start the VM immediately after creation'),
        extra: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Raw key/value pairs passed straight to the API (e.g. {"agent":"1"})'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      const params: Params = {
        vmid: args.vmid,
        cores: args.cores,
        sockets: args.sockets,
        memory: args.memory,
        ostype: args.ostype,
        scsihw: args.scsihw,
        name: args.name,
        start: args.start,
      };
      if (args.disk) {
        params[`${args.disk.bus}0`] = `${args.disk.storage}:${args.disk.sizeGb}`;
      }
      if (args.net) {
        const vlan = args.net.vlan ? `,tag=${args.net.vlan}` : '';
        params.net0 = `${args.net.model},bridge=${args.net.bridge}${vlan}`;
      }
      if (args.iso) {
        params.ide2 = `${args.iso.storage}:iso/${args.iso.file},media=cdrom`;
      }
      Object.assign(params, args.extra);
      const data = await ctx.client.post(`/nodes/${args.node}/qemu`, { params });
      return settleTask(ctx, data, { action: 'create', vmid: args.vmid });
    },
  );

  reg.register(
    {
      name: 'pve_vm_clone',
      title: 'Clone VM',
      description:
        'Clone a VM or template into a new VMID. Linked clone by default; set full=true for an ' +
        'independent full copy.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        newid: vmidField.describe('VMID for the new clone'),
        name: z.string().optional(),
        full: z.boolean().default(false).describe('Full clone (independent copy) vs linked clone'),
        target: z.string().optional().describe('Target node for the clone'),
        storage: z.string().optional().describe('Target storage for a full clone'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      guardTarget(ctx, args.target ?? args.node, args.newid);
      const data = await ctx.client.post(`/nodes/${args.node}/qemu/${args.vmid}/clone`, {
        params: {
          newid: args.newid,
          name: args.name,
          full: args.full,
          target: args.target,
          storage: args.storage,
        },
      });
      return settleTask(ctx, data, { action: 'clone', from: args.vmid, to: args.newid });
    },
  );

  reg.register(
    {
      name: 'pve_vm_migrate',
      title: 'Migrate VM',
      description: 'Migrate a VM to another node. Set online=true for a live migration.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        target: z.string().min(1).describe('Destination node'),
        online: z.boolean().default(false).describe('Live migration of a running VM'),
        withLocalDisks: z.boolean().default(false).describe('Also migrate local disks'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      guardTarget(ctx, args.target);
      const data = await ctx.client.post(`/nodes/${args.node}/qemu/${args.vmid}/migrate`, {
        params: {
          target: args.target,
          online: args.online,
          'with-local-disks': args.withLocalDisks,
        },
      });
      return settleTask(ctx, data, { action: 'migrate', vmid: args.vmid, target: args.target });
    },
  );

  reg.register(
    {
      name: 'pve_vm_set_config',
      title: 'Update VM config',
      description:
        'Change VM resources or settings. Pass only the fields to change; everything else is ' +
        'left untouched. Some changes only take effect after the next reboot.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        cores: z.number().int().positive().optional(),
        sockets: z.number().int().positive().optional(),
        memory: z.number().int().positive().optional().describe('Memory in MiB'),
        name: z.string().optional(),
        description: z.string().optional(),
        extra: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Raw key/value pairs for fields not covered above'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      const params: Params = {
        cores: args.cores,
        sockets: args.sockets,
        memory: args.memory,
        name: args.name,
        description: args.description,
      };
      Object.assign(params, args.extra);
      const data = await ctx.client.put(`/nodes/${args.node}/qemu/${args.vmid}/config`, { params });
      return settleTask(ctx, data, { action: 'set_config', vmid: args.vmid });
    },
  );

  reg.register(
    {
      name: 'pve_vm_delete',
      title: 'Delete VM',
      description:
        'Permanently delete a VM and its disks. Requires confirm=true and confirmVmid set to the ' +
        'same VMID. This cannot be undone.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        confirm: confirmField,
        confirmVmid: z.number().int().positive().describe('Repeat the VMID to confirm deletion'),
        purge: z
          .boolean()
          .default(true)
          .describe('Also remove the VM from backup/replication jobs'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      requireConfirm(args.confirm, `delete VM ${args.vmid}`);
      requireMatchingId(args.confirmVmid, args.vmid, `VM ${args.vmid}`);
      const data = await ctx.client.delete(`/nodes/${args.node}/qemu/${args.vmid}`, {
        params: { purge: args.purge, 'destroy-unreferenced-disks': true },
      });
      return settleTask(ctx, data, { action: 'delete', vmid: args.vmid });
    },
  );
}

function registerLifecycle(
  reg: ToolRegistry,
  op: 'start' | 'stop' | 'shutdown' | 'reboot' | 'reset',
  destructive: boolean,
  description: string,
): void {
  reg.register(
    {
      name: `pve_vm_${op}`,
      title: `VM ${op}`,
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
        requireConfirm((args as { confirm?: boolean }).confirm, `${op} VM ${args.vmid}`);
      }
      const data = await ctx.client.post(`/nodes/${args.node}/qemu/${args.vmid}/status/${op}`);
      return settleTask(ctx, data, { action: op, vmid: args.vmid });
    },
  );
}
