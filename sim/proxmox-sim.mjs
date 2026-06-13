import { createServer } from 'node:http';

// In-memory simulator of the subset of the Proxmox VE API this server calls.
// It is faithful to the request/response contract — token auth, the {data:...}
// envelope, UPID task ids and the task status lifecycle — so the MCP tools can be
// exercised end to end. It is NOT a hypervisor: there is no real virtualization
// behind it, only bookkeeping that makes create/snapshot/backup/delete observable.

const PORT = Number(process.env.SIM_PORT ?? 8006);
const NODE = 'pve';
const TOKEN_ID = process.env.SIM_TOKEN_ID ?? 'root@pam!sim';
const TOKEN_SECRET = process.env.SIM_TOKEN_SECRET ?? 'sim-secret';

const vms = new Map();
const lxcs = new Map();
const snaps = { qemu: new Map(), lxc: new Map() };
const tasks = [];
let taskSeq = 0x1000;

const storages = [
  { storage: 'local', type: 'dir', content: 'iso,vztmpl,backup', enabled: 1, active: 1, total: 1e11, used: 2e10, avail: 8e10 },
  { storage: 'local-lvm', type: 'lvmthin', content: 'images,rootdir', enabled: 1, active: 1, total: 5e11, used: 1e11, avail: 4e11 },
];
const content = {
  local: [
    { volid: 'local:iso/debian-12.7.0-amd64-netinst.iso', content: 'iso', format: 'iso', size: 6.5e8 },
    { volid: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst', content: 'vztmpl', format: 'tzst', size: 1.2e8 },
  ],
  'local-lvm': [],
};
const networks = [
  { iface: 'vmbr0', type: 'bridge', method: 'static', cidr: '10.0.0.1/24', address: '10.0.0.1', active: 1, autostart: 1, bridge_ports: 'eno1' },
  { iface: 'eno1', type: 'eth', method: 'manual', active: 1 },
];

function bag(map, type) {
  return [...map.values()].map((g) => ({ ...g, type }));
}

function newUpid(type, id) {
  taskSeq += 1;
  const hex = taskSeq.toString(16).padStart(8, '0');
  const upid = `UPID:${NODE}:${hex}:00000000:00000000:${type}:${id}:${TOKEN_ID}:`;
  tasks.unshift({ upid, node: NODE, type, id: String(id), user: TOKEN_ID, status: 'stopped', exitstatus: 'OK', starttime: 0, endtime: 0 });
  return upid;
}

class ApiError extends Error {
  constructor(status, errors) {
    super('api error');
    this.status = status;
    this.errors = errors;
  }
}

function guest(kind, vmid) {
  const map = kind === 'qemu' ? vms : lxcs;
  const g = map.get(Number(vmid));
  if (!g) throw new ApiError(500, { vmid: `Configuration file for ${vmid} does not exist` });
  return g;
}

const routes = [
  ['GET', /^\/nodes$/, () => [
    { node: NODE, status: 'online', cpu: 0.05, maxcpu: 8, mem: 4e9, maxmem: 16e9, uptime: 86400 },
  ]],
  ['GET', /^\/nodes\/([^/]+)\/status$/, () => ({
    uptime: 86400,
    cpuinfo: { cpus: 8, model: 'Simulated CPU' },
    memory: { total: 16e9, used: 4e9, free: 12e9 },
    pveversion: 'pve-manager/8.2.0/sim',
  })],
  ['GET', /^\/cluster\/resources$/, (_p, q) => {
    const all = [
      { id: `node/${NODE}`, type: 'node', node: NODE, status: 'online', maxcpu: 8, maxmem: 16e9 },
      ...storages.map((s) => ({ id: `storage/${NODE}/${s.storage}`, type: 'storage', node: NODE, storage: s.storage, status: 'available' })),
      ...bag(vms, 'qemu').map((v) => ({ id: `qemu/${v.vmid}`, type: 'qemu', node: NODE, vmid: v.vmid, name: v.name, status: v.status })),
      ...bag(lxcs, 'lxc').map((c) => ({ id: `lxc/${c.vmid}`, type: 'lxc', node: NODE, vmid: c.vmid, name: c.name, status: c.status })),
    ];
    return q.type ? all.filter((r) => (q.type === 'vm' ? r.type === 'qemu' || r.type === 'lxc' : r.type === q.type)) : all;
  }],
  ['GET', /^\/nodes\/([^/]+)\/tasks$/, () => tasks.slice(0, 50)],
  ['GET', /^\/nodes\/([^/]+)\/tasks\/([^/]+)\/status$/, (p) => {
    const t = tasks.find((x) => x.upid === decodeURIComponent(p[2]));
    if (!t) throw new ApiError(500, { upid: 'no such task' });
    return { upid: t.upid, node: NODE, type: t.type, status: 'stopped', exitstatus: 'OK', pid: 1234 };
  }],
  ['GET', /^\/nodes\/([^/]+)\/tasks\/([^/]+)\/log$/, () => [{ n: 1, t: 'TASK OK' }]],

  ['GET', /^\/nodes\/([^/]+)\/qemu$/, () => bag(vms, 'qemu')],
  ['GET', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/status\/current$/, (p) => {
    const v = guest('qemu', p[2]);
    return { status: v.status, vmid: v.vmid, name: v.name, cpus: v.config.cores, maxmem: v.config.memory * 1024 * 1024, uptime: v.status === 'running' ? 60 : 0 };
  }],
  ['GET', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/config$/, (p) => ({ ...guest('qemu', p[2]).config })],

  ['GET', /^\/nodes\/([^/]+)\/lxc$/, () => bag(lxcs, 'lxc')],
  ['GET', /^\/nodes\/([^/]+)\/lxc\/(\d+)\/status\/current$/, (p) => {
    const c = guest('lxc', p[2]);
    return { status: c.status, vmid: c.vmid, name: c.name, cpus: c.config.cores, maxmem: c.config.memory * 1024 * 1024 };
  }],
  ['GET', /^\/nodes\/([^/]+)\/lxc\/(\d+)\/config$/, (p) => ({ ...guest('lxc', p[2]).config })],

  ['GET', /^\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/snapshot$/, (p) => {
    const list = snaps[p[2]].get(Number(p[3])) ?? [];
    return [...list, { name: 'current', description: 'You are here!' }];
  }],

  ['GET', /^\/nodes\/([^/]+)\/storage$/, () => storages],
  ['GET', /^\/nodes\/([^/]+)\/storage\/([^/]+)\/content$/, (p, q) => {
    const list = content[p[2]] ?? [];
    return q.content ? list.filter((c) => c.content === q.content) : list;
  }],
  ['GET', /^\/nodes\/([^/]+)\/network$/, (_p, q) => (q.type ? networks.filter((n) => n.type === q.type) : networks)],

  ['POST', /^\/nodes\/([^/]+)\/qemu$/, (_p, _q, b) => createOrRestore('qemu', b)],
  ['POST', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/status\/(start|stop|shutdown|reboot|reset)$/, (p) => lifecycle('qemu', p[2], p[3])],
  ['POST', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/clone$/, (p, _q, b) => clone('qemu', p[2], b)],
  ['POST', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/migrate$/, (p) => newUpid('qmigrate', p[2])],
  ['PUT', /^\/nodes\/([^/]+)\/qemu\/(\d+)\/config$/, (p, _q, b) => {
    Object.assign(guest('qemu', p[2]).config, numify(b));
    return null;
  }],
  ['DELETE', /^\/nodes\/([^/]+)\/qemu\/(\d+)$/, (p) => destroy('qemu', p[2])],

  ['POST', /^\/nodes\/([^/]+)\/lxc$/, (_p, _q, b) => createOrRestore('lxc', b)],
  ['POST', /^\/nodes\/([^/]+)\/lxc\/(\d+)\/status\/(start|stop|shutdown|reboot)$/, (p) => lifecycle('lxc', p[2], p[3])],
  ['POST', /^\/nodes\/([^/]+)\/lxc\/(\d+)\/clone$/, (p, _q, b) => clone('lxc', p[2], b)],
  ['DELETE', /^\/nodes\/([^/]+)\/lxc\/(\d+)$/, (p) => destroy('lxc', p[2])],

  ['POST', /^\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/snapshot$/, (p, _q, b) => {
    guest(p[2], p[3]);
    const list = snaps[p[2]].get(Number(p[3])) ?? [];
    list.push({ name: b.snapname, description: b.description ?? '', snaptime: 0 });
    snaps[p[2]].set(Number(p[3]), list);
    return newUpid(p[2] === 'qemu' ? 'qmsnapshot' : 'vzsnapshot', p[3]);
  }],
  ['POST', /^\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/snapshot\/([^/]+)\/rollback$/, (p) => newUpid('qmrollback', p[3])],
  ['DELETE', /^\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/snapshot\/([^/]+)$/, (p) => {
    const list = (snaps[p[2]].get(Number(p[3])) ?? []).filter((s) => s.name !== p[4]);
    snaps[p[2]].set(Number(p[3]), list);
    return newUpid('qmdelsnapshot', p[3]);
  }],

  ['POST', /^\/nodes\/([^/]+)\/storage\/([^/]+)\/download-url$/, (p, _q, b) => {
    (content[p[2]] ??= []).push({ volid: `${p[2]}:${b.content}/${b.filename}`, content: b.content, size: 1e8 });
    return newUpid('download', b.filename);
  }],
  ['POST', /^\/nodes\/([^/]+)\/network$/, (_p, _q, b) => {
    networks.push({ iface: b.iface, type: b.type, method: b.cidr ? 'static' : 'manual', cidr: b.cidr, active: 0, autostart: b.autostart === '1' ? 1 : 0 });
    return null;
  }],
  ['PUT', /^\/nodes\/([^/]+)\/network$/, () => {
    networks.forEach((n) => (n.active = 1));
    return newUpid('srvreload', 'networking');
  }],
  ['POST', /^\/nodes\/([^/]+)\/vzdump$/, (_p, _q, b) => {
    const ts = '2026_06_13-12_00_00';
    (content[b.storage] ??= []).push({ volid: `${b.storage}:backup/vzdump-qemu-${b.vmid}-${ts}.vma.zst`, content: 'backup', vmid: Number(b.vmid), size: 5e8 });
    return newUpid('vzdump', b.vmid);
  }],
  ['POST', /^\/cluster\/backup$/, () => `backup-${taskSeq}`],
];

function numify(body) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

function createOrRestore(kind, b) {
  const map = kind === 'qemu' ? vms : lxcs;
  const vmid = Number(b.vmid);
  const isRestore = kind === 'qemu' ? Boolean(b.archive) : b.restore === '1';
  if (!isRestore && map.has(vmid)) throw new ApiError(500, { vmid: `${vmid} already exists` });
  map.set(vmid, {
    vmid,
    name: b.name ?? b.hostname ?? `${kind}-${vmid}`,
    status: b.start === '1' ? 'running' : 'stopped',
    config: numify(b),
  });
  return newUpid(kind === 'qemu' ? (isRestore ? 'qmrestore' : 'qmcreate') : isRestore ? 'vzrestore' : 'vzcreate', vmid);
}

function lifecycle(kind, vmid, op) {
  const g = guest(kind, vmid);
  g.status = op === 'start' || op === 'reboot' || op === 'reset' ? 'running' : 'stopped';
  const prefix = kind === 'qemu' ? 'qm' : 'vz';
  return newUpid(`${prefix}${op}`, vmid);
}

function clone(kind, vmid, b) {
  const src = guest(kind, vmid);
  const map = kind === 'qemu' ? vms : lxcs;
  const newid = Number(b.newid);
  if (map.has(newid)) throw new ApiError(500, { newid: `${newid} already exists` });
  map.set(newid, { vmid: newid, name: b.name ?? b.hostname ?? `clone-${newid}`, status: 'stopped', config: { ...src.config, vmid: newid } });
  return newUpid(kind === 'qemu' ? 'qmclone' : 'vzclone', vmid);
}

function destroy(kind, vmid) {
  const map = kind === 'qemu' ? vms : lxcs;
  if (!map.delete(Number(vmid))) throw new ApiError(500, { vmid: `${vmid} does not exist` });
  snaps[kind].delete(Number(vmid));
  return newUpid(kind === 'qemu' ? 'qmdestroy' : 'vzdestroy', vmid);
}

function authorized(req) {
  const header = req.headers['authorization'] ?? '';
  return header === `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`;
}

const server = createServer((req, res) => {
  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (!authorized(req)) {
    send(401, { data: null, errors: { authentication: 'invalid API token' } });
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api2\/json/, '');
  const query = Object.fromEntries(url.searchParams.entries());

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = Object.fromEntries(new URLSearchParams(raw));
    for (const [method, regex, handler] of routes) {
      if (method !== req.method) continue;
      const match = regex.exec(path);
      if (!match) continue;
      try {
        send(200, { data: handler(match, query, body) });
      } catch (err) {
        if (err instanceof ApiError) send(err.status, { data: null, errors: err.errors });
        else send(500, { data: null, errors: { server: String(err) } });
      }
      return;
    }
    send(404, { data: null, errors: { path: `no handler for ${req.method} ${path}` } });
  });
});

server.listen(PORT, () => {
  process.stderr.write(`proxmox-sim listening on http://0.0.0.0:${PORT} (node=${NODE})\n`);
});
