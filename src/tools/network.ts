import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import { confirmField, guardTarget, nodeField, settleTask } from './helpers.js';
import { requireConfirm } from '../guards/confirm.js';
import type { PveNetworkIface } from '../proxmox/types.js';

export function registerNetworkTools(reg: ToolRegistry): void {
  reg.register(
    {
      name: 'pve_list_network',
      title: 'List network interfaces',
      description:
        'List network interfaces on a node (bridges, bonds, physical NICs, VLANs). Pending, ' +
        'not-yet-applied changes are included.',
      schema: {
        node: nodeField,
        type: z
          .enum(['bridge', 'bond', 'eth', 'vlan', 'alias', 'any_bridge'])
          .optional()
          .describe('Filter by interface type'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ node, type }, ctx) => {
      guardTarget(ctx, node);
      return ctx.client.get<PveNetworkIface[]>(`/nodes/${node}/network`, {
        params: type ? { type } : undefined,
      });
    },
  );

  reg.register(
    {
      name: 'pve_create_bridge',
      title: 'Create bridge',
      description:
        'Create a Linux bridge on a node. The change is staged as pending; call pve_apply_network ' +
        'to activate it.',
      schema: {
        node: nodeField,
        iface: z
          .string()
          .regex(/^vmbr\d+$/, 'Bridge name must be vmbrN, e.g. vmbr1')
          .describe('Bridge interface name'),
        autostart: z.boolean().default(true),
        bridgePorts: z.string().optional().describe('Physical ports to enslave, e.g. "eno1"'),
        cidr: z.string().optional().describe('IPv4 address in CIDR notation, e.g. 10.0.0.1/24'),
        gateway: z.string().optional(),
        vlanAware: z.boolean().default(false),
        comments: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node);
      const data = await ctx.client.post(`/nodes/${args.node}/network`, {
        params: {
          iface: args.iface,
          type: 'bridge',
          autostart: args.autostart,
          bridge_ports: args.bridgePorts,
          bridge_vlan_aware: args.vlanAware,
          cidr: args.cidr,
          gateway: args.gateway,
          comments: args.comments,
        },
      });
      return settleTask(ctx, data, { action: 'create_bridge', iface: args.iface });
    },
  );

  reg.register(
    {
      name: 'pve_apply_network',
      title: 'Apply network config',
      description:
        'Apply all pending network changes on a node. This reloads networking and can drop ' +
        'connectivity if the configuration is wrong. Requires confirm=true.',
      schema: { node: nodeField, confirm: confirmField },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      write: true,
    },
    async ({ node, confirm }, ctx) => {
      guardTarget(ctx, node);
      requireConfirm(confirm, `apply pending network changes on ${node}`);
      const data = await ctx.client.put(`/nodes/${node}/network`);
      return settleTask(ctx, data, { action: 'apply_network', node });
    },
  );
}
