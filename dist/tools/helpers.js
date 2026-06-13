import { z } from 'zod';
import { checkNodeAllowed, checkVmidAllowed } from '../guards/confirm.js';
import { isUpid, waitForTask } from '../proxmox/tasks.js';
export const nodeField = z.string().min(1).describe('Target Proxmox node name, e.g. "pve1"');
export const vmidField = z
    .number()
    .int()
    .positive()
    .describe('Numeric guest id (VMID) of the VM or container');
export const confirmField = z
    .boolean()
    .optional()
    .describe('Must be true to run this destructive operation');
/**
 * Resolve a write response. PVE returns a UPID string for asynchronous work; in
 * that case we block until the task is done and report its real exit status
 * instead of an optimistic "ok".
 */
export async function settleTask(ctx, data, summary) {
    if (isUpid(data)) {
        const outcome = await waitForTask(ctx.client, data, { timeoutMs: ctx.config.taskTimeoutMs });
        return { ...summary, upid: outcome.upid, exitStatus: outcome.exitStatus };
    }
    return { ...summary, result: data ?? 'ok' };
}
export function guardTarget(ctx, node, vmid) {
    checkNodeAllowed(ctx.config, node);
    if (vmid !== undefined)
        checkVmidAllowed(ctx.config, vmid);
}
//# sourceMappingURL=helpers.js.map