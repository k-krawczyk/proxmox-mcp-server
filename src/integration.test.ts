import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { ProxmoxClient } from './proxmox/client.js';
import type { PveNode } from './proxmox/types.js';

// Opt-in only: set PVE_INTEGRATION=1 with real PROXMOX_* env to hit a live node.
// Without it the suite is skipped so CI and offline runs stay green.
const run = process.env.PVE_INTEGRATION === '1';

describe.runIf(run)('live Proxmox (read-only)', () => {
  it('lists nodes from the real cluster', async () => {
    const client = new ProxmoxClient(loadConfig());
    const nodes = await client.get<PveNode[]>('/nodes');
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]).toHaveProperty('node');
  });
});
