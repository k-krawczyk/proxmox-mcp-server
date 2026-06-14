import { describe, expect, it, vi } from 'vitest';
import { atLeast, getVersion, parsePveVersion, requireMinVersion } from './version.js';
import { GuardError } from '../util/errors.js';
import type { ProxmoxClient } from './client.js';

function fakeClient(get: ReturnType<typeof vi.fn>): ProxmoxClient {
  return { get } as unknown as ProxmoxClient;
}

describe('parsePveVersion', () => {
  it('parses the common version shapes', () => {
    expect(parsePveVersion('9.2.3')).toEqual({ major: 9, minor: 2, patch: 3 });
    expect(parsePveVersion('8.2')).toEqual({ major: 8, minor: 2, patch: 0 });
    expect(parsePveVersion('7.2-11')).toEqual({ major: 7, minor: 2, patch: 11 });
  });
});

describe('atLeast', () => {
  it('compares major then minor', () => {
    expect(atLeast({ major: 7, minor: 2 }, 7, 2)).toBe(true);
    expect(atLeast({ major: 8, minor: 0 }, 7, 2)).toBe(true);
    expect(atLeast({ major: 7, minor: 1 }, 7, 2)).toBe(false);
    expect(atLeast({ major: 6, minor: 4 }, 7, 2)).toBe(false);
  });
});

describe('getVersion', () => {
  it('reads /version and enriches it with parsed numbers', async () => {
    const get = vi.fn().mockResolvedValue({ version: '9.2.3', release: '9.2', repoid: 'abc' });
    const result = await getVersion(fakeClient(get));
    expect(result).toMatchObject({ version: '9.2.3', major: 9, minor: 2, patch: 3 });
    expect(get).toHaveBeenCalledWith('/version');
  });

  it('caches the lookup per client', async () => {
    const get = vi.fn().mockResolvedValue({ version: '8.2.0', release: '8.2' });
    const client = fakeClient(get);
    await getVersion(client);
    await getVersion(client);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('requireMinVersion', () => {
  it('passes when the node meets the minimum', async () => {
    const get = vi.fn().mockResolvedValue({ version: '7.2-11', release: '7.2' });
    await expect(
      requireMinVersion(fakeClient(get), [7, 2], 'pve_download_iso'),
    ).resolves.toBeUndefined();
  });

  it('throws a GuardError naming the requirement on an older node', async () => {
    const get = vi.fn().mockResolvedValue({ version: '7.1-8', release: '7.1' });
    const err = await requireMinVersion(fakeClient(get), [7, 2], 'pve_download_iso').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GuardError);
    expect((err as Error).message).toMatch(/7\.2 or newer/);
    expect((err as Error).message).toContain('7.1-8');
  });
});
