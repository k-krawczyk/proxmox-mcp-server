// Waits until the simulator (local node or container) answers, then runs the
// full tool sweep against it. Used by `npm run sweep:docker`.

process.env.PROXMOX_HOST ??= 'http://127.0.0.1:8006';
process.env.PROXMOX_TOKEN_ID ??= 'root@pam!sim';
process.env.PROXMOX_TOKEN_SECRET ??= 'sim-secret';
process.env.PVE_READONLY ??= 'false';

const url = `${process.env.PROXMOX_HOST}/api2/json/nodes`;
const auth = `PVEAPIToken=${process.env.PROXMOX_TOKEN_ID}=${process.env.PROXMOX_TOKEN_SECRET}`;

async function waitReachable(attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`simulator did not become reachable at ${url}`);
}

await waitReachable();
await import('./sweep.mjs');
