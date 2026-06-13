import { GuardError } from '../util/errors.js';
/**
 * Generic gate for destructive operations. Every tool annotated with
 * destructiveHint passes its `confirm` flag through here before touching the API.
 */
export function requireConfirm(confirm, action) {
    if (confirm !== true) {
        throw new GuardError(`Refusing to ${action}: pass confirm=true to proceed. This operation is destructive.`);
    }
}
/**
 * Stronger gate for irreversible operations (delete, restore, rollback): the
 * caller must echo back the resource identifier so a wrong target is caught.
 */
export function requireMatchingId(provided, expected, resource) {
    if (provided === undefined || String(provided) !== String(expected)) {
        throw new GuardError(`Confirmation mismatch for ${resource}: expected the identifier "${expected}" to be ` +
            `repeated, got "${provided ?? ''}". This guards against acting on the wrong target.`);
    }
}
export function checkNodeAllowed(config, node) {
    if (config.nodeAllowlist && !config.nodeAllowlist.includes(node)) {
        throw new GuardError(`Node "${node}" is not in PVE_NODE_ALLOWLIST (${config.nodeAllowlist.join(', ')}).`);
    }
}
export function checkVmidAllowed(config, vmid) {
    if (config.vmidAllowlist && !config.vmidAllowlist.includes(vmid)) {
        throw new GuardError(`Guest id ${vmid} is not in PVE_VMID_ALLOWLIST (${config.vmidAllowlist.join(', ')}).`);
    }
}
//# sourceMappingURL=confirm.js.map