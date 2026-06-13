# proxmox-mcp-server

An MCP server that exposes a Proxmox VE cluster as tools for an MCP client such as
Claude. It talks to the Proxmox REST API (`/api2/json`) with an API token and
communicates with the client over stdio.

Write operations in Proxmox are asynchronous: the API returns a task id (UPID) and
the work continues in the background. This server polls each task to completion and
reports the real exit status, so a tool only reports success once the operation has
actually finished.

## Requirements

- Node.js 20 or newer
- A Proxmox VE 7.2+ node or cluster reachable over HTTPS (the ISO/template download
  tool uses the `download-url` endpoint introduced in 7.2)
- An API token (see below)

## Install and build

```
npm install
npm run build
```

This produces `dist/index.js`, the entry point you point your MCP client at.

## Creating an API token

Use a dedicated user and token with privilege separation enabled, not the root
token. In the Proxmox web UI: Datacenter → Permissions → API Tokens → Add.

```
# create a user and a token with privilege separation on
pveum user add mcp@pve
pveum user token add mcp@pve mcp --privsep 1
```

The token secret (a UUID) is shown once. The token id is `mcp@pve!mcp`.

Grant only the privileges the tools you intend to use need. With privilege
separation on, permissions must be assigned to the token itself, not just the user.

Read-only usage (everything in `PVE_READONLY=true` mode):

```
pveum acl modify / --tokens 'mcp@pve!mcp' --roles PVEAuditor
```

For write operations, grant the matching privileges per group. A practical setup
grants `PVEVMAdmin` on the guests and audit/space roles on storage:

```
pveum acl modify /vms     --tokens 'mcp@pve!mcp' --roles PVEVMAdmin
pveum acl modify /storage --tokens 'mcp@pve!mcp' --roles PVEDatastoreAdmin
```

Privileges by tool group, if you prefer to build a custom role:

- Read / cluster (`pve_list_*`, `*_status`, `*_config`, `pve_cluster_resources`):
  `VM.Audit`, `Datastore.Audit`, `Sys.Audit`.
- VM/LXC lifecycle (start, stop, shutdown, reboot, reset): `VM.PowerMgmt`.
- Create / set config / clone: `VM.Allocate`, `VM.Config.Disk`, `VM.Config.CPU`,
  `VM.Config.Memory`, `VM.Config.Network`, `VM.Config.Options`, `VM.Clone`, plus
  `Datastore.AllocateSpace` on the target storage.
- Migrate: `VM.Migrate`.
- Delete: `VM.Allocate`.
- Snapshots (create/rollback/delete): `VM.Snapshot` (rollback also needs
  `VM.Snapshot.Rollback`).
- Storage listing and ISO/template download: `Datastore.Audit`,
  `Datastore.AllocateTemplate`.
- Network (create bridge, apply): `Sys.Modify`.
- Backup / restore / schedule: `VM.Backup`, `Datastore.AllocateSpace`; restore also
  needs `VM.Allocate`; scheduling a cluster job also needs `Sys.Modify`.

A `403` from a tool almost always means a missing privilege on the token for that
path.

## Configuration

All configuration is via environment variables. Copy `.env.example` and fill it in,
or set them directly in your MCP client config.

- `PROXMOX_HOST` (required) — full base URL, e.g. `https://pve.local:8006`.
- `PROXMOX_TOKEN_ID` (required) — `USER@REALM!TOKENID`, e.g. `mcp@pve!mcp`.
- `PROXMOX_TOKEN_SECRET` (required) — the token UUID.
- `PROXMOX_INSECURE_TLS` — `true` to accept self-signed certificates. Off by
  default; only for labs. See the security note below.
- `PVE_READONLY` — `true` (default) registers only read tools. Set to `false` to
  enable write and destructive tools.
- `PVE_NODE_ALLOWLIST` — optional comma-separated node names; tools refuse to act on
  any node outside the list.
- `PVE_VMID_ALLOWLIST` — optional comma-separated guest ids; same idea for VMs/CTs.
- `PROXMOX_REQUEST_TIMEOUT_MS` — per-request timeout (default 30000).
- `PVE_TASK_TIMEOUT_MS` — how long to wait for an async task (default 600000).
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error` (default `info`). Logs go to
  stderr; stdout is reserved for the MCP protocol.

The auth header sent to Proxmox is `Authorization: PVEAPIToken=USER@REALM!TOKENID=UUID`
(no `Bearer` prefix), as required for API tokens.

## Running

Register the built server with your MCP client. For Claude Desktop, add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proxmox": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "PROXMOX_HOST": "https://pve.local:8006",
        "PROXMOX_TOKEN_ID": "mcp@pve!mcp",
        "PROXMOX_TOKEN_SECRET": "00000000-0000-0000-0000-000000000000",
        "PVE_READONLY": "true"
      }
    }
  }
}
```

To inspect the tools manually before wiring it into a client:

```
npx @modelcontextprotocol/inspector node dist/index.js
```

During development you can run from source with `npm run dev`.

## Tools

Read tools are always registered. Tools marked write are only registered when
`PVE_READONLY=false`. Destructive tools additionally require `confirm: true`, and
delete/restore/rollback require echoing the target id or name.

Cluster and nodes:

- `pve_list_nodes`, `pve_node_status`
- `pve_cluster_resources` — VMs, containers, storage and nodes in one view
- `pve_list_tasks` — recent tasks on a node, with UPID and exit status

VMs (QEMU):

- `pve_list_vms`, `pve_vm_status`, `pve_vm_config`
- `pve_vm_start`, `pve_vm_shutdown`, `pve_vm_reboot`, `pve_vm_stop` (confirm),
  `pve_vm_reset` (confirm)
- `pve_vm_create`, `pve_vm_clone`, `pve_vm_migrate`, `pve_vm_set_config`
- `pve_vm_delete` (confirm + confirmVmid)

Containers (LXC):

- `pve_list_containers`, `pve_lxc_status`, `pve_lxc_config`
- `pve_lxc_start`, `pve_lxc_shutdown`, `pve_lxc_reboot`, `pve_lxc_stop` (confirm)
- `pve_lxc_create`, `pve_lxc_clone`, `pve_lxc_delete` (confirm + confirmVmid)

Snapshots (qemu or lxc via the `type` argument):

- `pve_list_snapshots`, `pve_snapshot_create`
- `pve_snapshot_rollback` (confirm + confirmName), `pve_snapshot_delete`
  (confirm + confirmName)

Storage and images:

- `pve_list_storage`, `pve_storage_content`, `pve_download_iso`

Network:

- `pve_list_network`, `pve_create_bridge`, `pve_apply_network` (confirm)

Backup:

- `pve_list_backups`, `pve_backup_now`, `pve_restore` (confirm + confirmVmid),
  `pve_schedule_backup`

## Security notes

- Start in `PVE_READONLY=true`. Write tools are not just hidden — they are never
  registered, so the client cannot call them at all.
- Destructive tools require `confirm: true`. Deleting a guest, rolling back or
  deleting a snapshot, and restoring a backup also require repeating the target id
  or snapshot name, which guards against acting on the wrong target.
- Use a token with the minimum privileges for your use case and keep privilege
  separation on.
- The token secret is read only from the environment and is never written to logs.
- `PROXMOX_INSECURE_TLS=true` disables certificate verification for the whole
  client and exposes the connection to man-in-the-middle attacks. Use it only
  against a lab with a self-signed certificate; for anything else, install a
  properly issued certificate or add the cluster CA to the host trust store.

## Development

```
npm run dev          # run from source (tsx)
npm run lint         # eslint
npm run format       # prettier --write
npm test             # unit tests (vitest)
npm run build        # type-check and emit to dist/
```

The unit tests mock `fetch` and cover the auth header, UPID parsing and polling,
error mapping, the confirmation gate and read-only registration. An optional live
smoke test runs only when `PVE_INTEGRATION=1` is set together with valid
`PROXMOX_*` variables:

```
PVE_INTEGRATION=1 npm test
```

### End-to-end sweep against a simulator

`sim/` contains a small in-memory simulator of the Proxmox API. It is faithful to
the request/response contract (token auth, the `{data:...}` envelope, UPID task ids
and the task status lifecycle) and keeps state, so every tool can be exercised end
to end — the full create → start → snapshot → clone → backup → delete → restore
cycle for VMs and containers — without a hypervisor. It does not emulate
virtualization; it proves the tool/client/polling/guard code paths.

Run the sweep against the simulator started with Node:

```
npm run build
npm run sim          # in one terminal
npm run sweep        # in another
```

Or run the simulator in a container and sweep against it:

```
npm run sweep:docker
```

This requires a running Docker engine. Building the real Proxmox VE inside Docker is
not supported here: it is a hypervisor and needs `/dev/kvm` and the host LXC stack,
which a container (especially on macOS, where Docker itself runs in a VM without
nested virtualization) cannot provide. For real lifecycle testing point
`PVE_INTEGRATION=1` at an actual node instead.

### End-to-end sweep against a real node

`sim/live-real.mjs` runs the same kind of sweep against an actual Proxmox node: it
creates a VM (qcow2 disk) and an LXC container in a free VMID range and drives the
full create → start → snapshot → clone → backup → delete → restore cycle, then
cleans up every guest, the pending bridge, the downloaded template, backup archives
and schedule jobs — even on failure. It deliberately skips `pve_apply_network`
(reloading networking on a remote node can drop the connection) and treats a
migration to the only node as the expected rejection. Point a `.env` at the node and:

```
npm run build
set -a; . ./.env; set +a   # load PROXMOX_* into the environment
npm run test:live
```

Guests use no NIC unless the node has a bridge, so a single-storage node with only
`local` and no `vmbr0` is enough.
