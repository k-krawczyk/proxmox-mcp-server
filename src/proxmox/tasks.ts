import type { ProxmoxClient } from './client.js';
import type { PveTaskStatus } from './types.js';
import { TaskFailedError, TaskTimeoutError } from '../util/errors.js';
import { log } from '../util/logging.js';

export interface ParsedUpid {
  node: string;
  type: string;
  id: string;
  user: string;
}

// UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:
export function parseUpid(upid: string): ParsedUpid {
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

export function isUpid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('UPID:');
}

export interface WaitForTaskOptions {
  timeoutMs: number;
  pollIntervalMs?: number;
}

export interface TaskOutcome {
  upid: string;
  node: string;
  type: string;
  exitStatus: string;
}

/**
 * Block until the given task reaches the stopped state, then assert it exited
 * cleanly. Without this, a write tool would report success the moment Proxmox
 * accepts the request — long before the clone/backup/migration actually finishes.
 */
export async function waitForTask(
  client: ProxmoxClient,
  upid: string,
  opts: WaitForTaskOptions,
): Promise<TaskOutcome> {
  const { node, type } = parseUpid(upid);
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const deadline = Date.now() + opts.timeoutMs;
  const encoded = encodeURIComponent(upid);

  for (;;) {
    const status = await client.get<PveTaskStatus>(`/nodes/${node}/tasks/${encoded}/status`);

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

interface TaskLogLine {
  n: number;
  t: string;
}

async function readLogTail(
  client: ProxmoxClient,
  node: string,
  encodedUpid: string,
): Promise<string> {
  try {
    const lines = await client.get<TaskLogLine[]>(`/nodes/${node}/tasks/${encodedUpid}/log`, {
      params: { start: 0, limit: 25 },
    });
    return lines
      .map((l) => l.t)
      .filter((t) => typeof t === 'string')
      .join('\n');
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
