import type { Config } from '../config.js';
/**
 * Generic gate for destructive operations. Every tool annotated with
 * destructiveHint passes its `confirm` flag through here before touching the API.
 */
export declare function requireConfirm(confirm: boolean | undefined, action: string): void;
/**
 * Stronger gate for irreversible operations (delete, restore, rollback): the
 * caller must echo back the resource identifier so a wrong target is caught.
 */
export declare function requireMatchingId(provided: string | number | undefined, expected: string | number, resource: string): void;
export declare function checkNodeAllowed(config: Config, node: string): void;
export declare function checkVmidAllowed(config: Config, vmid: number): void;
