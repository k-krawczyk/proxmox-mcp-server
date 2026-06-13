import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  PROXMOX_HOST: 'https://pve.local:8006',
  PROXMOX_TOKEN_ID: 'root@pam!mcp',
  PROXMOX_TOKEN_SECRET: 'aaaa-bbbb-cccc',
};

describe('loadConfig', () => {
  it('builds the PVEAPIToken auth header without a Bearer prefix', () => {
    const config = loadConfig(base);
    expect(config.authHeader).toBe('PVEAPIToken=root@pam!mcp=aaaa-bbbb-cccc');
    expect(config.authHeader.startsWith('Bearer')).toBe(false);
  });

  it('derives the api base and strips a trailing slash from the host', () => {
    const config = loadConfig({ ...base, PROXMOX_HOST: 'https://pve.local:8006/' });
    expect(config.host).toBe('https://pve.local:8006');
    expect(config.apiBase).toBe('https://pve.local:8006/api2/json');
  });

  it('defaults to readonly and secure TLS', () => {
    const config = loadConfig(base);
    expect(config.readonly).toBe(true);
    expect(config.insecureTls).toBe(false);
  });

  it('parses boolean env flags', () => {
    const config = loadConfig({ ...base, PVE_READONLY: 'false', PROXMOX_INSECURE_TLS: 'true' });
    expect(config.readonly).toBe(false);
    expect(config.insecureTls).toBe(true);
  });

  it('parses node and vmid allowlists', () => {
    const config = loadConfig({
      ...base,
      PVE_NODE_ALLOWLIST: 'pve1, pve2',
      PVE_VMID_ALLOWLIST: '100,101',
    });
    expect(config.nodeAllowlist).toEqual(['pve1', 'pve2']);
    expect(config.vmidAllowlist).toEqual([100, 101]);
  });

  it('reports missing required variables with their names', () => {
    expect(() => loadConfig({ PROXMOX_HOST: 'https://pve.local:8006' })).toThrow(
      /PROXMOX_TOKEN_ID/,
    );
  });

  it('rejects a malformed token id', () => {
    expect(() => loadConfig({ ...base, PROXMOX_TOKEN_ID: 'root@pam' })).toThrow(
      /USER@REALM!TOKENID/,
    );
  });

  it('rejects a host that is not a URL', () => {
    expect(() => loadConfig({ ...base, PROXMOX_HOST: 'pve.local' })).toThrow(/full URL/);
  });
});
