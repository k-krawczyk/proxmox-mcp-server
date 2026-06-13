import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('undici', () => ({
  fetch: fetchMock,
  Agent: class {
    constructor(public opts: unknown) {}
  },
}));

import { ProxmoxClient } from './client.js';
import { ProxmoxApiError } from '../util/errors.js';
import type { Config } from '../config.js';

const config: Config = {
  host: 'https://pve.local:8006',
  apiBase: 'https://pve.local:8006/api2/json',
  authHeader: 'PVEAPIToken=root@pam!mcp=secret',
  insecureTls: false,
  readonly: false,
  requestTimeoutMs: 1000,
  taskTimeoutMs: 5000,
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status === 403 ? 'Forbidden' : 'OK',
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe('ProxmoxClient', () => {
  it('sends the token auth header and returns the unwrapped data field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ node: 'pve1' }] }));
    const client = new ProxmoxClient(config);

    const result = await client.get('/nodes');

    expect(result).toEqual([{ node: 'pve1' }]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pve.local:8006/api2/json/nodes');
    expect((options.headers as Record<string, string>).Authorization).toBe(
      'PVEAPIToken=root@pam!mcp=secret',
    );
  });

  it('form-encodes POST parameters, mapping booleans to 0/1', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: 'UPID:pve1:x' }));
    const client = new ProxmoxClient(config);

    await client.post('/nodes/pve1/qemu/100/status/start', {
      params: { skiplock: true, timeout: 30 },
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.body).toBe('skiplock=1&timeout=30');
  });

  it('maps a 403 to an actionable ProxmoxApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: { vmid: 'permission denied' } }, { ok: false, status: 403 }),
    );
    const client = new ProxmoxClient(config);

    const err = await client.get('/nodes/pve1/qemu/100/config').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProxmoxApiError);
    expect((err as ProxmoxApiError).message).toMatch(/privileges/);
    expect((err as ProxmoxApiError).message).toContain('permission denied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET on a transient 503 but not a POST', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ data: 'ok' }));
    const client = new ProxmoxClient(config);

    await expect(client.get('/nodes')).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }));
    await expect(client.post('/nodes/pve1/qemu')).rejects.toBeInstanceOf(ProxmoxApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
