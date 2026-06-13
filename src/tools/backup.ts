import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import { confirmField, guardTarget, nodeField, settleTask, vmidField } from './helpers.js';
import { requireConfirm, requireMatchingId } from '../guards/confirm.js';
import type { Params } from '../proxmox/client.js';
import type { PveStorageContent } from '../proxmox/types.js';

const compress = z.enum(['0', 'gzip', 'lzo', 'zstd']).describe('Compression algorithm');
const backupMode = z
  .enum(['snapshot', 'suspend', 'stop'])
  .describe('vzdump mode: snapshot (live), suspend, or stop');

export function registerBackupTools(reg: ToolRegistry): void {
  reg.register(
    {
      name: 'pve_list_backups',
      title: 'List backups',
      description: 'List backup archives stored on a storage.',
      schema: { node: nodeField, storage: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    ({ node, storage }, ctx) => {
      guardTarget(ctx, node);
      return ctx.client.get<PveStorageContent[]>(`/nodes/${node}/storage/${storage}/content`, {
        params: { content: 'backup' },
      });
    },
  );

  reg.register(
    {
      name: 'pve_backup_now',
      title: 'Backup now',
      description:
        'Run a one-off vzdump backup of a guest to a storage. Returns the task outcome when the ' +
        'backup finishes.',
      schema: {
        node: nodeField,
        vmid: vmidField,
        storage: z.string().min(1),
        mode: backupMode.default('snapshot'),
        compress: compress.default('zstd'),
        notes: z.string().optional().describe('Notes attached to the backup'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      const params: Params = {
        vmid: args.vmid,
        storage: args.storage,
        mode: args.mode,
        compress: args.compress,
      };
      if (args.notes) params['notes-template'] = args.notes;
      const data = await ctx.client.post(`/nodes/${args.node}/vzdump`, { params });
      return settleTask(ctx, data, { action: 'backup', vmid: args.vmid });
    },
  );

  reg.register(
    {
      name: 'pve_restore',
      title: 'Restore backup',
      description:
        'Restore a backup archive into a guest id. If the target id already exists its contents ' +
        'are overwritten, so this requires confirm=true and confirmVmid set to the target id.',
      schema: {
        node: nodeField,
        vmid: vmidField.describe('Target guest id to restore into'),
        type: z.enum(['qemu', 'lxc']),
        archive: z
          .string()
          .min(1)
          .describe(
            'Backup volume id, e.g. "local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst"',
          ),
        storage: z.string().optional().describe('Target storage for the restored disks'),
        force: z.boolean().default(true).describe('Overwrite an existing guest with the same id'),
        confirm: confirmField,
        confirmVmid: z.number().int().positive().describe('Repeat the target id to confirm'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      guardTarget(ctx, args.node, args.vmid);
      requireConfirm(args.confirm, `restore into ${args.type} ${args.vmid}`);
      requireMatchingId(args.confirmVmid, args.vmid, `guest ${args.vmid}`);

      const params: Params = { vmid: args.vmid, force: args.force, storage: args.storage };
      // The two guest kinds take the archive under different parameter names, and
      // LXC additionally needs restore=1 to switch the create endpoint into restore mode.
      if (args.type === 'qemu') {
        params.archive = args.archive;
      } else {
        params.ostemplate = args.archive;
        params.restore = true;
      }
      const data = await ctx.client.post(`/nodes/${args.node}/${args.type}`, { params });
      return settleTask(ctx, data, { action: 'restore', vmid: args.vmid });
    },
  );

  reg.register(
    {
      name: 'pve_schedule_backup',
      title: 'Schedule backup',
      description:
        'Create a recurring cluster backup job. Schedule uses systemd calendar syntax, e.g. ' +
        '"sat 02:00" or "mon..fri 22:00".',
      schema: {
        schedule: z.string().min(1).describe('systemd calendar event, e.g. "sat 02:00"'),
        storage: z.string().min(1),
        mode: backupMode.default('snapshot'),
        compress: compress.default('zstd'),
        enabled: z.boolean().default(true),
        all: z.boolean().default(false).describe('Back up every guest'),
        vmids: z
          .array(z.number().int().positive())
          .optional()
          .describe('Specific guest ids to back up (ignored when all=true)'),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      write: true,
    },
    async (args, ctx) => {
      if (!args.all && (!args.vmids || args.vmids.length === 0)) {
        throw new Error('Specify either all=true or a non-empty vmids list.');
      }
      const params: Params = {
        schedule: args.schedule,
        storage: args.storage,
        mode: args.mode,
        compress: args.compress,
        enabled: args.enabled,
      };
      if (args.all) {
        params.all = true;
      } else if (args.vmids) {
        params.vmid = args.vmids.join(',');
      }
      if (args.notes) params['notes-template'] = args.notes;
      const data = await ctx.client.post('/cluster/backup', { params });
      return { action: 'schedule_backup', schedule: args.schedule, result: data ?? 'created' };
    },
  );
}
