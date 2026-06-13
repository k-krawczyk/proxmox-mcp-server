import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolRegistry, type ToolContext } from './registry.js';
import { registerQemuTools } from './qemu.js';
import type { Config } from '../config.js';

type ToolCb = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function makeConfig(readonly: boolean): Config {
  return {
    host: 'https://pve.local:8006',
    apiBase: 'https://pve.local:8006/api2/json',
    authHeader: 'PVEAPIToken=root@pam!mcp=secret',
    insecureTls: false,
    readonly,
    requestTimeoutMs: 1000,
    taskTimeoutMs: 5000,
  };
}

function setup(readonly: boolean, client: Partial<ToolContext['client']>) {
  const tools = new Map<string, ToolCb>();
  const server = {
    registerTool: (name: string, _cfg: unknown, cb: ToolCb) => tools.set(name, cb),
  } as unknown as McpServer;
  const registry = new ToolRegistry(server, {
    client: client as ToolContext['client'],
    config: makeConfig(readonly),
  });
  registerQemuTools(registry);
  return { tools, registry };
}

describe('readonly mode', () => {
  it('registers read tools but skips write tools', () => {
    const { tools, registry } = setup(true, { get: vi.fn() });

    expect(tools.has('pve_vm_status')).toBe(true);
    expect(tools.has('pve_vm_config')).toBe(true);
    expect(tools.has('pve_vm_delete')).toBe(false);
    expect(tools.has('pve_vm_start')).toBe(false);
    expect(registry.counts.skipped).toBeGreaterThan(0);
  });

  it('registers write tools when readonly is off', () => {
    const { tools } = setup(false, { get: vi.fn() });
    expect(tools.has('pve_vm_delete')).toBe(true);
    expect(tools.has('pve_vm_start')).toBe(true);
  });
});

describe('result wrapping', () => {
  it('serialises a successful result into text content', async () => {
    const get = vi.fn().mockResolvedValue({ status: 'running', vmid: 100 });
    const { tools } = setup(false, { get });

    const result = await tools.get('pve_vm_status')!({ node: 'pve1', vmid: 100 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('"status": "running"');
  });

  it('turns a thrown error into an isError result instead of throwing', async () => {
    const get = vi.fn().mockRejectedValue(new Error('boom'));
    const { tools } = setup(false, { get });

    const result = await tools.get('pve_vm_status')!({ node: 'pve1', vmid: 100 });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('boom');
  });
});

describe('confirmation gate through a real tool', () => {
  it('rejects pve_vm_delete without confirm and never calls the API', async () => {
    const del = vi.fn();
    const { tools } = setup(false, { delete: del });

    const result = await tools.get('pve_vm_delete')!({
      node: 'pve1',
      vmid: 100,
      confirmVmid: 100,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('confirm=true');
    expect(del).not.toHaveBeenCalled();
  });

  it('rejects pve_vm_delete when confirmVmid does not match', async () => {
    const del = vi.fn();
    const { tools } = setup(false, { delete: del });

    const result = await tools.get('pve_vm_delete')!({
      node: 'pve1',
      vmid: 100,
      confirm: true,
      confirmVmid: 999,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('mismatch');
    expect(del).not.toHaveBeenCalled();
  });

  it('proceeds when confirm and confirmVmid are correct', async () => {
    const del = vi.fn().mockResolvedValue(null);
    const { tools } = setup(false, { delete: del });

    const result = await tools.get('pve_vm_delete')!({
      node: 'pve1',
      vmid: 100,
      confirm: true,
      confirmVmid: 100,
    });

    expect(result.isError).toBeUndefined();
    expect(del).toHaveBeenCalledWith('/nodes/pve1/qemu/100', expect.anything());
  });
});
