import { TaskFailedError, TaskTimeoutError } from '../util/errors.js';
import { log } from '../util/logging.js';
// UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:
export function parseUpid(upid) {
    const parts = upid.split(':');
    if (parts[0] !== 'UPID' || parts.length < 8) {
        throw new Error(`Malformed UPID: ${upid}`);
    }
    return {
        node: parts[1] ?? '',
        type: parts[5] ?? '',
        id: parts[6] ?? '',
        user: parts[7] ?? '',
    };
}
export function isUpid(value) {
    return typeof value === 'string' && value.startsWith('UPID:');
}
/**
 * Block until the given task reaches the stopped state, then assert it exited
 * cleanly. Without this, a write tool would report success the moment Proxmox
 * accepts the request — long before the clone/backup/migration actually finishes.
 */
export async function waitForTask(client, upid, opts) {
    const { node, type } = parseUpid(upid);
    const pollIntervalMs = opts.pollIntervalMs ?? 1500;
    const deadline = Date.now() + opts.timeoutMs;
    const encoded = encodeURIComponent(upid);
    for (;;) {
        const status = await client.get(`/nodes/${node}/tasks/${encoded}/status`);
        if (status.status === 'stopped') {
            const exitStatus = status.exitstatus ?? 'unknown';
            if (exitStatus !== 'OK') {
                const tail = await readLogTail(client, node, encoded);
                throw new TaskFailedError(upid, exitStatus, tail);
            }
            log.debug('task finished', { upid, exitStatus });
            return { upid, node, type, exitStatus };
        }
        if (Date.now() >= deadline) {
            throw new TaskTimeoutError(upid, opts.timeoutMs);
        }
        await delay(pollIntervalMs);
    }
}
async function readLogTail(client, node, encodedUpid) {
    try {
        const lines = await client.get(`/nodes/${node}/tasks/${encodedUpid}/log`, {
            params: { start: 0, limit: 25 },
        });
        return lines
            .map((l) => l.t)
            .filter((t) => typeof t === 'string')
            .join('\n');
    }
    catch {
        return '';
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=tasks.js.map