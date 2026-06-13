import type { ProxmoxClient } from './client.js';
export interface ParsedUpid {
    node: string;
    type: string;
    id: string;
    user: string;
}
export declare function parseUpid(upid: string): ParsedUpid;
export declare function isUpid(value: unknown): value is string;
export interface WaitForTaskOptions {
    timeoutMs: number;
    pollIntervalMs?: number;
}
export interface TaskOutcome {
    upid: string;
    node: string;
    type: string;
    exitStatus: string;
}
/**
 * Block until the given task reaches the stopped state, then assert it exited
 * cleanly. Without this, a write tool would report success the moment Proxmox
 * accepts the request — long before the clone/backup/migration actually finishes.
 */
export declare function waitForTask(client: ProxmoxClient, upid: string, opts: WaitForTaskOptions): Promise<TaskOutcome>;
