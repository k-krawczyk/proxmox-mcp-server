import { loadConfig } from '../dist/config.js';
import { ProxmoxClient } from '../dist/proxmox/client.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { registerAllTools } from '../dist/tools/index.js';

// Drives every registered tool against whatever PROXMOX_HOST points at (the
// simulator) and asserts real outcomes. Exits non-zero on the first failure.

const tools = new Map();
const server = { registerTool: (name, _cfg, cb) => tools.set(name, cb) };
const config = loadConfig();
const registry = new ToolRegistry(server, { client: new ProxmoxClient(config), config });
registerAllTools(registry);

let pass = 0;
const failures = [];

async function ok(name, args, check) {
  const res = await tools.get(name)(args ?? {});
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name} returned isError: ${text}`);
  if (check) {
    const parsed = tryJson(text);
    const problem = check(parsed, text);
    if (problem) throw new Error(`${name}: ${problem}`);
  }
  pass += 1;
  process.stdout.write(`  PASS ${name}\n`);
  return tryJson(text);
}

async function rejects(name, args, needle) {
  const res = await tools.get(name)(args ?? {});
  const text = res.content[0].text;
  if (!res.isError) throw new Error(`${name} should have been rejected but succeeded`);
  if (needle && !text.includes(needle))
    throw new Error(`${name}: expected rejection to mention "${needle}", got: ${text}`);
  pass += 1;
  process.stdout.write(`  PASS ${name} (correctly rejected: ${needle})\n`);
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function step(title, fn) {
  process.stdout.write(`\n${title}\n`);
  try {
    await fn();
  } catch (err) {
    failures.push(err.message);
    process.stdout.write(`  FAIL ${err.message}\n`);
  }
}

const N = 'pve';
const VM = 9000;
const VM_CLONE = 9001;
const CT = 9100;
const CT_CLONE = 9101;

await step('cluster and node reads', async () => {
  await ok('pve_version', {}, (d) =>
    d.major === 8 && d.minor === 2 ? null : 'unexpected version',
  );
  await ok('pve_list_nodes', {}, (d) =>
    Array.isArray(d) && d[0]?.node === N ? null : 'expected node pve',
  );
  await ok('pve_node_status', { node: N });
  await ok('pve_cluster_resources', {});
  await ok('pve_cluster_resources', { type: 'vm' });
  await ok('pve_list_tasks', { node: N });
});

await step('storage and network reads', async () => {
  await ok('pve_list_storage', { node: N }, (d) =>
    d.some((s) => s.storage === 'local') ? null : 'no local storage',
  );
  await ok('pve_storage_content', { node: N, storage: 'local', content: 'iso' }, (d) =>
    d.length ? null : 'no iso content',
  );
  await ok('pve_storage_content', { node: N, storage: 'local', content: 'vztmpl' });
  await ok('pve_list_network', { node: N }, (d) =>
    d.some((n) => n.iface === 'vmbr0') ? null : 'no vmbr0',
  );
});

await step('VM create and inspect', async () => {
  await ok('pve_list_vms', { node: N });
  await ok(
    'pve_vm_create',
    {
      node: N,
      vmid: VM,
      name: 'sweep-test',
      cores: 2,
      memory: 1024,
      disk: { storage: 'local-lvm', sizeGb: 16, bus: 'scsi' },
      net: { bridge: 'vmbr0', model: 'virtio' },
      iso: { storage: 'local', file: 'debian-12.7.0-amd64-netinst.iso' },
    },
    (d) => (d.exitStatus === 'OK' ? null : 'create task did not finish OK'),
  );
  await ok('pve_vm_status', { node: N, vmid: VM }, (d) =>
    d.status === 'stopped' ? null : 'new VM should be stopped',
  );
  await ok('pve_vm_config', { node: N, vmid: VM }, (d) => (d.scsi0 ? null : 'disk not in config'));
});

await step('VM lifecycle and reconfigure', async () => {
  await ok('pve_vm_start', { node: N, vmid: VM });
  await ok('pve_vm_status', { node: N, vmid: VM }, (d) =>
    d.status === 'running' ? null : 'VM should be running after start',
  );
  await ok('pve_vm_set_config', { node: N, vmid: VM, memory: 2048 });
  await ok('pve_vm_config', { node: N, vmid: VM }, (d) =>
    Number(d.memory) === 2048 ? null : 'memory not updated',
  );
  await ok('pve_vm_reboot', { node: N, vmid: VM });
});

await step('snapshots', async () => {
  await ok('pve_snapshot_create', {
    node: N,
    vmid: VM,
    type: 'qemu',
    snapname: 'base',
    description: 'pre-change',
  });
  await ok('pve_list_snapshots', { node: N, vmid: VM, type: 'qemu' }, (d) =>
    d.some((s) => s.name === 'base') ? null : 'snapshot not listed',
  );
  await ok('pve_snapshot_rollback', {
    node: N,
    vmid: VM,
    type: 'qemu',
    snapname: 'base',
    confirm: true,
    confirmName: 'base',
  });
  await ok('pve_snapshot_delete', {
    node: N,
    vmid: VM,
    type: 'qemu',
    snapname: 'base',
    confirm: true,
    confirmName: 'base',
  });
  await ok('pve_list_snapshots', { node: N, vmid: VM, type: 'qemu' }, (d) =>
    d.some((s) => s.name === 'base') ? 'snapshot not deleted' : null,
  );
});

await step('clone and migrate', async () => {
  await ok('pve_vm_clone', { node: N, vmid: VM, newid: VM_CLONE, name: 'sweep-clone', full: true });
  await ok('pve_list_vms', { node: N }, (d) =>
    d.some((v) => v.vmid === VM_CLONE) ? null : 'clone not present',
  );
  await ok('pve_vm_migrate', { node: N, vmid: VM_CLONE, target: N, online: false });
});

await step('backup, restore', async () => {
  await ok('pve_backup_now', {
    node: N,
    vmid: VM,
    storage: 'local',
    mode: 'snapshot',
    compress: 'zstd',
  });
  const backups = await ok('pve_list_backups', { node: N, storage: 'local' }, (d) =>
    d.some((b) => b.vmid === VM) ? null : 'backup not listed',
  );
  const archive = backups.find((b) => b.vmid === VM).volid;
  await ok('pve_vm_stop', { node: N, vmid: VM, confirm: true });
  await ok('pve_vm_delete', { node: N, vmid: VM, confirm: true, confirmVmid: VM });
  await ok('pve_restore', {
    node: N,
    vmid: VM,
    type: 'qemu',
    archive,
    storage: 'local-lvm',
    confirm: true,
    confirmVmid: VM,
  });
  await ok('pve_vm_status', { node: N, vmid: VM }, (d) =>
    d.vmid === VM ? null : 'restore did not recreate VM',
  );
});

await step('LXC full cycle', async () => {
  await ok('pve_list_containers', { node: N });
  await ok('pve_lxc_create', {
    node: N,
    vmid: CT,
    ostemplate: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst',
    hostname: 'sweep-ct',
    cores: 1,
    memory: 512,
    rootfs: { storage: 'local-lvm', sizeGb: 8 },
    net: { bridge: 'vmbr0', name: 'eth0', ip: 'dhcp' },
  });
  await ok('pve_lxc_status', { node: N, vmid: CT }, (d) =>
    d.vmid === CT ? null : 'container missing',
  );
  await ok('pve_lxc_config', { node: N, vmid: CT });
  await ok('pve_lxc_start', { node: N, vmid: CT });
  await ok('pve_lxc_clone', { node: N, vmid: CT, newid: CT_CLONE, hostname: 'sweep-ct-clone' });
  await ok('pve_lxc_stop', { node: N, vmid: CT, confirm: true });
  await ok('pve_lxc_delete', { node: N, vmid: CT, confirm: true, confirmVmid: CT });
  await ok('pve_lxc_delete', { node: N, vmid: CT_CLONE, confirm: true, confirmVmid: CT_CLONE });
});

await step('storage image download', async () => {
  await ok('pve_download_iso', {
    node: N,
    storage: 'local',
    url: 'https://example.com/alpine.iso',
    filename: 'alpine-3.20.iso',
    content: 'iso',
  });
  await ok('pve_storage_content', { node: N, storage: 'local', content: 'iso' }, (d) =>
    d.some((c) => c.volid.endsWith('alpine-3.20.iso')) ? null : 'downloaded iso not present',
  );
});

await step('network changes', async () => {
  await ok('pve_create_bridge', { node: N, iface: 'vmbr1', autostart: true, cidr: '10.10.0.1/24' });
  await ok('pve_list_network', { node: N }, (d) =>
    d.some((n) => n.iface === 'vmbr1') ? null : 'vmbr1 not created',
  );
  await ok('pve_apply_network', { node: N, confirm: true });
});

await step('scheduled backup', async () => {
  await ok('pve_schedule_backup', {
    schedule: 'sat 02:00',
    storage: 'local',
    all: true,
    mode: 'snapshot',
    compress: 'zstd',
  });
});

await step('VM clone cleanup', async () => {
  await ok('pve_vm_stop', { node: N, vmid: VM, confirm: true });
  await ok('pve_vm_delete', { node: N, vmid: VM, confirm: true, confirmVmid: VM });
  await ok('pve_vm_delete', { node: N, vmid: VM_CLONE, confirm: true, confirmVmid: VM_CLONE });
});

await step('safety gates (must reject)', async () => {
  await rejects('pve_vm_delete', { node: N, vmid: 9999, confirmVmid: 9999 }, 'confirm=true');
  await rejects(
    'pve_vm_delete',
    { node: N, vmid: 9999, confirm: true, confirmVmid: 1 },
    'mismatch',
  );
  await rejects(
    'pve_snapshot_rollback',
    { node: N, vmid: 9999, type: 'qemu', snapname: 'x', confirmName: 'x' },
    'confirm=true',
  );
  await rejects('pve_apply_network', { node: N }, 'confirm=true');
});

await step('error mapping (bad auth)', async () => {
  const badConfig = { ...config, authHeader: 'PVEAPIToken=root@pam!sim=wrong-secret' };
  const badClient = new ProxmoxClient(badConfig);
  try {
    await badClient.get('/nodes');
    throw new Error('expected 401 with bad token');
  } catch (err) {
    if (!/authentication failed|401/i.test(err.message))
      throw new Error(`unexpected error: ${err.message}`);
    pass += 1;
    process.stdout.write('  PASS 401 mapped to actionable message\n');
  }
});

process.stdout.write(`\n${'='.repeat(50)}\n`);
process.stdout.write(`checks passed: ${pass}, failed: ${failures.length}\n`);
if (failures.length) {
  process.stdout.write('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('all tool checks passed\n');
