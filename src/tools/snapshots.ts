import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import { confirmField, guardTarget, nodeField, settleTask, vmidField } from './helpers.js';
import { requireConfirm, requireMatchingId } from '../guards/confirm.js';
import type { PveSnapshot } from '../proxmox/types.js';

const guestType = z
  .enum(['qemu', 'lxc'])
  .describe('Guest kind: "qemu" for VMs, "lxc" for containers');
const snapName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Snapshot name must start with a letter and be alphanumeric')
  .describe('Snapshot name');

export function registerSnapshotTools(reg: ToolRegistry): void {
  reg.register(
    {
      name: 'pve_list_snapshots',
      title: 'List snapshots',
      description: 'List snapshots of a VM or container, including the "current" pseudo-snapshot.',
      schema: { node: nodeField, vmid: vmidField, type: guestType },
      annotations: { readOnlyHint: true },
    },
    ({ node, vmid, type }, ctx) => {
      guardTarget(ctx, node, vmid);
      return ctx.client.get<PveSnapshot[]>(`/nodes/${node}/${type}/${vmid}/snapshot`);
    },
  );

  reg.register(
    {
      name: 'pve_snapshot_create',
      title: 'Create snapshot',
      description: 'Create a snapshot. For VMs, set vmstate=true to also capture running RAM.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        type: guestType,
        snapname: snapName,
        description: z.string().optional(),
        vmstate: z.boolean().default(false).describe('Include VM RAM state (QEMU only)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      const data = await ctx.client.post(`/nodes/${args.node}/${args.type}/${args.vmid}/snapshot`, {
        params: {
          snapname: args.snapname,
          description: args.description,
          vmstate: args.type === 'qemu' ? args.vmstate : undefined,
        },
      });
      return settleTask(ctx, data, { action: 'snapshot_create', snapname: args.snapname });
    },
  );

  reg.register(
    {
      name: 'pve_snapshot_rollback',
      title: 'Rollback snapshot',
      description:
        'Roll a guest back to a snapshot. The current state is discarded. Requires confirm=true ' +
        'and confirmName set to the snapshot name.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        type: guestType,
        snapname: snapName,
        confirm: confirmField,
        confirmName: z.string().describe('Repeat the snapshot name to confirm rollback'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      requireConfirm(args.confirm, `roll back ${args.vmid} to "${args.snapname}"`);
      requireMatchingId(args.confirmName, args.snapname, `snapshot "${args.snapname}"`);
      const data = await ctx.client.post(
        `/nodes/${args.node}/${args.type}/${args.vmid}/snapshot/${args.snapname}/rollback`,
      );
      return settleTask(ctx, data, { action: 'snapshot_rollback', snapname: args.snapname });
    },
  );

  reg.register(
    {
      name: 'pve_snapshot_delete',
      title: 'Delete snapshot',
      description:
        'Delete a snapshot. Requires confirm=true and confirmName set to the snapshot name.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        type: guestType,
        snapname: snapName,
        confirm: confirmField,
        confirmName: z.string().describe('Repeat the snapshot name to confirm deletion'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      requireConfirm(args.confirm, `delete snapshot "${args.snapname}"`);
      requireMatchingId(args.confirmName, args.snapname, `snapshot "${args.snapname}"`);
      const data = await ctx.client.delete(
        `/nodes/${args.node}/${args.type}/${args.vmid}/snapshot/${args.snapname}`,
      );
      return settleTask(ctx, data, { action: 'snapshot_delete', snapname: args.snapname });
    },
  );
}
