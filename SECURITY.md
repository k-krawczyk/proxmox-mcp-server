# Security Policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull request.

Use GitHub's private reporting: the **Security** tab of this repository →
**Report a vulnerability**. If you cannot use that, email karkra321@gmail.com.

Include enough to reproduce: affected version, configuration, and the impact you
observed. Expect an initial response within a few days. Once a fix is available it
will ship in a patch release and the report will be credited unless you prefer
otherwise.

## Supported versions

This project is pre-1.0. Fixes land on the latest `0.x` release published to npm;
older versions are not patched. Upgrade to the latest version before reporting.

## Security model

This server manages real infrastructure, so treat it as privileged software.

- **Credentials** come only from the environment (`PROXMOX_TOKEN_*`) and are never
  written to logs. Logs go to stderr; stdout carries the MCP protocol only.
- **Least privilege.** Create a dedicated API token with privilege separation and
  grant it only the roles you need (see the README). Do not use a root token.
- **Read-only by default.** `PVE_READONLY=true` does not register write tools at all,
  so the client cannot call them. Enable writes deliberately.
- **Destructive operations** require `confirm: true`, and delete/restore/rollback
  require echoing the target id or snapshot name. The optional
  `PVE_NODE_ALLOWLIST` / `PVE_VMID_ALLOWLIST` further limit scope.
- **TLS** verification is on by default. `PROXMOX_INSECURE_TLS=true` disables it and
  exposes the connection to man-in-the-middle attacks — use it only against a lab
  with a self-signed certificate.

An MCP client can invoke any registered tool. Run the server with a token scoped to
what that client is trusted to do, and keep `PVE_READONLY=true` unless you need
writes.

## What to report

In scope: secret leakage (logs, errors), authentication/authorization bypasses, the
confirmation gate or read-only mode failing to block a write, command/SSRF-style
injection through tool parameters, and dependency vulnerabilities that are
exploitable through this server.

Out of scope: misconfiguration on your side (an over-privileged token, running with
`PROXMOX_INSECURE_TLS=true` in production), and the inherent ability of a privileged
client to perform privileged Proxmox actions it was granted.
