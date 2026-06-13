import type { Config } from '../config.js';
import { GuardError } from '../util/errors.js';

/**
 * Generic gate for destructive operations. Every tool annotated with
 * destructiveHint passes its `confirm` flag through here before touching the API.
 */
export function requireConfirm(confirm: boolean | undefined, action: string): void {
  if (confirm !== true) {
    throw new GuardError(
      `Refusing to ${action}: pass confirm=true to proceed. This operation is destructive.`,
    );
  }
}

/**
 * Stronger gate for irreversible operations (delete, restore, rollback): the
 * caller must echo back the resource identifier so a wrong target is caught.
 */
export function requireMatchingId(
  provided: string | number | undefined,
  expected: string | number,
  resource: string,
): void {
  if (provided === undefined || String(provided) !== String(expected)) {
    throw new GuardError(
      `Confirmation mismatch for ${resource}: expected the identifier "${expected}" to be ` +
        `repeated, got "${provided ?? ''}". This guards against acting on the wrong target.`,
    );
  }
}

export function checkNodeAllowed(config: Config, node: string): void {
  if (config.nodeAllowlist && !config.nodeAllowlist.includes(node)) {
    throw new GuardError(
      `Node "${node}" is not in PVE_NODE_ALLOWLIST (${config.nodeAllowlist.join(', ')}).`,
    );
  }
}

export function checkVmidAllowed(config: Config, vmid: number): void {
  if (config.vmidAllowlist && !config.vmidAllowlist.includes(vmid)) {
    throw new GuardError(
      `Guest id ${vmid} is not in PVE_VMID_ALLOWLIST (${config.vmidAllowlist.join(', ')}).`,
    );
  }
}
