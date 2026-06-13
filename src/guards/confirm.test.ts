import { describe, expect, it } from 'vitest';
import {
  checkNodeAllowed,
  checkVmidAllowed,
  requireConfirm,
  requireMatchingId,
} from './confirm.js';
import { GuardError } from '../util/errors.js';
import type { Config } from '../config.js';

const config = (over: Partial<Config> = {}): Config => ({
  host: 'https://pve.local:8006',
  apiBase: 'https://pve.local:8006/api2/json',
  authHeader: 'PVEAPIToken=root@pam!mcp=secret',
  insecureTls: false,
  readonly: false,
  requestTimeoutMs: 1000,
  taskTimeoutMs: 5000,
  ...over,
});

describe('requireConfirm', () => {
  it('passes when confirm is true', () => {
    expect(() => requireConfirm(true, 'delete VM 100')).not.toThrow();
  });

  it('throws a GuardError when confirm is missing or false', () => {
    expect(() => requireConfirm(undefined, 'delete VM 100')).toThrow(GuardError);
    expect(() => requireConfirm(false, 'delete VM 100')).toThrow(/confirm=true/);
  });
});

describe('requireMatchingId', () => {
  it('passes when the echoed id matches', () => {
    expect(() => requireMatchingId(100, 100, 'VM 100')).not.toThrow();
    expect(() => requireMatchingId('snap1', 'snap1', 'snapshot')).not.toThrow();
  });

  it('throws on a mismatch or missing confirmation', () => {
    expect(() => requireMatchingId(101, 100, 'VM 100')).toThrow(/mismatch/);
    expect(() => requireMatchingId(undefined, 100, 'VM 100')).toThrow(GuardError);
  });
});

describe('allowlists', () => {
  it('allows any node when no allowlist is set', () => {
    expect(() => checkNodeAllowed(config(), 'pve9')).not.toThrow();
  });

  it('blocks a node outside the allowlist', () => {
    expect(() => checkNodeAllowed(config({ nodeAllowlist: ['pve1'] }), 'pve9')).toThrow(
      /not in PVE_NODE_ALLOWLIST/,
    );
  });

  it('blocks a vmid outside the allowlist', () => {
    expect(() => checkVmidAllowed(config({ vmidAllowlist: [100] }), 200)).toThrow(
      /not in PVE_VMID_ALLOWLIST/,
    );
  });
});
