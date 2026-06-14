import type { ProxmoxClient } from './client.js';
export interface PveVersion {
    version: string;
    release: string;
    repoid?: string;
    major: number;
    minor: number;
    patch: number;
}
export declare function getVersion(client: ProxmoxClient): Promise<PveVersion>;
export declare function parsePveVersion(raw: string): {
    major: number;
    minor: number;
    patch: number;
};
export declare function atLeast(version: {
    major: number;
    minor: number;
}, major: number, minor: number): boolean;
export declare function requireMinVersion(client: ProxmoxClient, min: readonly [number, number], feature: string): Promise<void>;
