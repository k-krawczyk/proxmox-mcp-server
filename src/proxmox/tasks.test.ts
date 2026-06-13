import { describe, expect, it, vi } from 'vitest';
import { parseUpid, waitForTask } from './tasks.js';
import { TaskFailedError, TaskTimeoutError } from '../util/errors.js';
import type { ProxmoxClient } from './client.js';

const UPID = 'UPID:pve1:0000ABCD:00112233:64000000:qmstart:100:root@pam:';

function fakeClient(get: ReturnType<typeof vi.fn>): ProxmoxClient {
  return { get } as unknown as ProxmoxClient;
}

describe('parseUpid', () => {
  it('extracts the node and task type', () => {
    expect(parseUpid(UPID)).toMatchObject({ node: 'pve1', type: 'qmstart', id: '100' });
  });

  it('rejects a malformed UPID', () => {
    expect(() => parseUpid('not-a-upid')).toThrow(/Malformed UPID/);
  });
});

describe('waitForTask', () => {
  it('polls until the task stops and reports a clean exit status', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'OK' });

    const outcome = await waitForTask(fakeClient(get), UPID, {
      timeoutMs: 1000,
      pollIntervalMs: 1,
    });

    expect(outcome).toMatchObject({ node: 'pve1', exitStatus: 'OK' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('throws TaskFailedError on a non-OK exit status and includes the log tail', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: 'stopped', exitstatus: 'command failed' })
      .mockResolvedValueOnce([{ n: 1, t: 'disk full' }]);

    await expect(
      waitForTask(fakeClient(get), UPID, { timeoutMs: 1000, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(TaskFailedError);
  });

  it('throws TaskTimeoutError when the task never stops in time', async () => {
    const get = vi.fn().mockResolvedValue({ status: 'running' });

    await expect(
      waitForTask(fakeClient(get), UPID, { timeoutMs: 0, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(TaskTimeoutError);
  });
});
