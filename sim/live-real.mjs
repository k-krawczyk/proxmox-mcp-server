import { loadConfig } from '../dist/config.js';
import { ProxmoxClient } from '../dist/proxmox/client.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { registerAllTools } from '../dist/tools/index.js';

// End-to-end exercise of every tool against a real Proxmox node. Uses a free
// VMID range and cleans up after itself even on failure. Guests are created
// without a NIC because the lab node has no bridge, and disks are qcow2 so the
// VM snapshot path works on the dir storage.

const N = 'pve-lab-01';
const STORAGE = 'local';
const TEMPLATE = 'local:vztmpl/alpine-3.22-default_20250617_amd64.tar.xz';
const VM = 9000;
const VM_CLONE = 9001;
const CT = 9100;
const CT_CLONE = 9101;

const tools = new Map();
const server = { registerTool: (name, _cfg, cb) => tools.set(name, cb) };
const config = loadConfig();
const client = new ProxmoxClient(config);
registerAllTools(new ToolRegistry(server, { client, config }));

let pass = 0;
const failures = [];

function tryJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

async function ok(name, args, check) {
  const res = await tools.get(name)(args ?? {});
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name} isError: ${text}`);
  if (check) {
    const problem = check(tryJson(text), text);
    if (problem) throw new Error(`${name}: ${problem}`);
  }
  pass += 1;
  process.stdout.write(`  PASS ${name}\n`);
  return tryJson(text);
}

async function rejects(name, args, needle) {
  const res = await tools.get(name)(args ?? {});
  if (!res.isError) throw new Error(`${name} should have been rejected`);
  if (needle && !res.content[0].text.includes(needle))
    throw new Error(`${name}: expected "${needle}" in ${res.content[0].text}`);
  pass += 1;
  process.stdout.write(`  PASS ${name} (rejected: ${needle})\n`);
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

try {
  await step('cluster and node reads', async () => {
    await ok('pve_list_nodes', {}, (d) => (d.some((n) => n.node === N) ? null : `node ${N} not listed`));
    await ok('pve_node_status', { node: N }, (d) => (d.pveversion ? null : 'no pveversion'));
    await ok('pve_cluster_resources', {});
    await ok('pve_list_tasks', { node: N });
    await ok('pve_list_storage', { node: N }, (d) => (d.some((s) => s.storage === STORAGE) ? null : 'no local storage'));
    await ok('pve_storage_content', { node: N, storage: STORAGE, content: 'vztmpl' }, (d) =>
      d.some((c) => c.volid === TEMPLATE) ? null : 'alpine template not found',
    );
    await ok('pve_list_network', { node: N }, (d) => (d.some((i) => i.iface === 'eth0') ? null : 'no eth0'));
  });

  await step('image download tool', async () => {
    await ok('pve_download_iso', {
      node: N,
      storage: STORAGE,
      url: 'http://download.proxmox.com/images/system/alpine-3.22-default_20250617_amd64.tar.xz',
      filename: 'alpine-tooltest.tar.xz',
      content: 'vztmpl',
    }, (d) => (d.exitStatus === 'OK' ? null : 'download task not OK'));
    await ok('pve_storage_content', { node: N, storage: STORAGE, content: 'vztmpl' }, (d) =>
      d.some((c) => c.volid.endsWith('alpine-tooltest.tar.xz')) ? null : 'downloaded file missing',
    );
  });

  await step('VM create, inspect, lifecycle', async () => {
    await ok('pve_vm_create', {
      node: N,
      vmid: VM,
      name: 'mcp-e2e-vm',
      cores: 1,
      memory: 512,
      ostype: 'l26',
      extra: { scsi0: `${STORAGE}:1,format=qcow2` },
    }, (d) => (d.exitStatus === 'OK' ? null : 'create not OK'));
    await ok('pve_vm_status', { node: N, vmid: VM }, (d) => (d.status === 'stopped' ? null : 'new VM not stopped'));
    await ok('pve_vm_config', { node: N, vmid: VM }, (d) => (d.scsi0 ? null : 'disk missing in config'));
    await ok('pve_vm_start', { node: N, vmid: VM });
    await ok('pve_vm_status', { node: N, vmid: VM }, (d) => (d.status === 'running' ? null : 'VM not running'));
    await ok('pve_vm_set_config', { node: N, vmid: VM, memory: 1024 });
    await ok('pve_vm_config', { node: N, vmid: VM }, (d) => (Number(d.memory) === 1024 ? null : 'memory not updated'));
  });

  await step('VM snapshots', async () => {
    await ok('pve_snapshot_create', { node: N, vmid: VM, type: 'qemu', snapname: 'base', description: 'e2e' });
    await ok('pve_list_snapshots', { node: N, vmid: VM, type: 'qemu' }, (d) =>
      d.some((s) => s.name === 'base') ? null : 'snapshot not listed',
    );
    await ok('pve_snapshot_rollback', { node: N, vmid: VM, type: 'qemu', snapname: 'base', confirm: true, confirmName: 'base' });
    await ok('pve_snapshot_delete', { node: N, vmid: VM, type: 'qemu', snapname: 'base', confirm: true, confirmName: 'base' });
  });

  await step('VM clone and migrate', async () => {
    await ok('pve_vm_stop', { node: N, vmid: VM, confirm: true });
    await ok('pve_vm_clone', { node: N, vmid: VM, newid: VM_CLONE, name: 'mcp-e2e-clone', full: true });
    await ok('pve_list_vms', { node: N }, (d) => (d.some((v) => v.vmid === VM_CLONE) ? null : 'clone missing'));
    // Standalone node: a migration to itself is correctly refused by PVE. This
    // verifies the request is built right and the 400 is mapped to a clear message.
    await rejects('pve_vm_migrate', { node: N, vmid: VM_CLONE, target: N }, 'local node');
  });

  let archive;
  await step('VM backup, delete, restore', async () => {
    await ok('pve_backup_now', { node: N, vmid: VM, storage: STORAGE, mode: 'snapshot', compress: 'zstd' });
    const backups = await ok('pve_list_backups', { node: N, storage: STORAGE }, (d) =>
      d.some((b) => b.vmid === VM) ? null : 'backup not listed',
    );
    archive = backups.find((b) => b.vmid === VM).volid;
    await ok('pve_vm_delete', { node: N, vmid: VM, confirm: true, confirmVmid: VM });
    await ok('pve_restore', { node: N, vmid: VM, type: 'qemu', archive, storage: STORAGE, confirm: true, confirmVmid: VM });
    await ok('pve_vm_status', { node: N, vmid: VM }, (d) => (d.vmid === VM ? null : 'restore failed'));
  });

  await step('LXC full cycle', async () => {
    await ok('pve_list_containers', { node: N });
    await ok('pve_lxc_create', {
      node: N,
      vmid: CT,
      ostemplate: TEMPLATE,
      hostname: 'mcp-e2e-ct',
      cores: 1,
      memory: 256,
      swap: 0,
      rootfs: { storage: STORAGE, sizeGb: 1 },
      unprivileged: true,
    }, (d) => (d.exitStatus === 'OK' ? null : 'lxc create not OK'));
    await ok('pve_lxc_status', { node: N, vmid: CT }, (d) => (d.vmid === CT ? null : 'container missing'));
    await ok('pve_lxc_config', { node: N, vmid: CT });
    await ok('pve_lxc_start', { node: N, vmid: CT });
    await ok('pve_lxc_status', { node: N, vmid: CT }, (d) => (d.status === 'running' ? null : 'CT not running'));
    await ok('pve_lxc_stop', { node: N, vmid: CT, confirm: true });
    await ok('pve_lxc_clone', { node: N, vmid: CT, newid: CT_CLONE, hostname: 'mcp-e2e-ct-clone' });
    await ok('pve_list_containers', { node: N }, (d) => (d.some((c) => c.vmid === CT_CLONE) ? null : 'CT clone missing'));
  });

  await step('network (pending bridge, no apply)', async () => {
    await ok('pve_create_bridge', { node: N, iface: 'vmbr1', autostart: true, cidr: '10.99.99.1/24' });
    await ok('pve_list_network', { node: N }, (d) => (d.some((i) => i.iface === 'vmbr1') ? null : 'vmbr1 not staged'));
    process.stdout.write('  SKIP pve_apply_network (would reload networking on the live remote node)\n');
  });

  await step('scheduled backup job', async () => {
    await ok('pve_schedule_backup', { schedule: 'sat 02:00', storage: STORAGE, all: true, mode: 'snapshot', compress: 'zstd' });
  });

  await step('safety gates (must reject)', async () => {
    await rejects('pve_vm_delete', { node: N, vmid: VM, confirmVmid: VM }, 'confirm=true');
    await rejects('pve_vm_delete', { node: N, vmid: VM, confirm: true, confirmVmid: 1 }, 'mismatch');
    await rejects('pve_snapshot_rollback', { node: N, vmid: VM, type: 'qemu', snapname: 'x', confirmName: 'x' }, 'confirm=true');
  });

  await step('error mapping (bad token)', async () => {
    const bad = new ProxmoxClient({ ...config, authHeader: 'PVEAPIToken=root@pam!mcp=wrong' });
    try {
      await bad.get('/nodes');
      throw new Error('expected auth failure');
    } catch (err) {
      if (!/authentication failed|401/i.test(err.message)) throw new Error(`unexpected: ${err.message}`);
      pass += 1;
      process.stdout.write('  PASS bad token mapped to actionable message\n');
    }
  });
} finally {
  process.stdout.write('\ncleanup\n');
  const settle = async (upid) => {
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) return;
    const enc = encodeURIComponent(upid);
    for (let i = 0; i < 60; i++) {
      const s = await client.get(`/nodes/${N}/tasks/${enc}/status`);
      if (s.status === 'stopped') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const quiet = async (label, fn) => {
    try {
      await fn();
      process.stdout.write(`  ${label}\n`);
    } catch {
      /* nothing to clean */
    }
  };

  for (const [kind, id] of [
    ['qemu', VM],
    ['qemu', VM_CLONE],
    ['lxc', CT],
    ['lxc', CT_CLONE],
  ]) {
    await quiet(`removed ${kind} ${id}`, async () =>
      settle(await client.delete(`/nodes/${N}/${kind}/${id}`, { params: { purge: true, 'destroy-unreferenced-disks': true } })),
    );
  }

  await quiet('reverted pending network', () => client.delete(`/nodes/${N}/network`));
  await quiet('removed downloaded test template', () =>
    client.delete(`/nodes/${N}/storage/${STORAGE}/content/${encodeURIComponent(`${STORAGE}:vztmpl/alpine-tooltest.tar.xz`)}`),
  );
  await quiet('removed backup archives', async () => {
    const items = await client.get(`/nodes/${N}/storage/${STORAGE}/content`, { params: { content: 'backup' } });
    for (const it of items.filter((i) => i.vmid === VM)) {
      await client.delete(`/nodes/${N}/storage/${STORAGE}/content/${encodeURIComponent(it.volid)}`).catch(() => {});
    }
  });
  await quiet('removed schedule jobs', async () => {
    const jobs = await client.get('/cluster/backup');
    for (const j of jobs) await client.delete(`/cluster/backup/${j.id}`).catch(() => {});
  });
}

process.stdout.write(`\n${'='.repeat(50)}\nchecks passed: ${pass}, failed: ${failures.length}\n`);
if (failures.length) {
  process.stdout.write('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('all live tool checks passed\n');
}
