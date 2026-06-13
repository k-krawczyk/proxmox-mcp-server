export interface Config {
    host: string;
    apiBase: string;
    authHeader: string;
    insecureTls: boolean;
    readonly: boolean;
    nodeAllowlist?: string[];
    vmidAllowlist?: number[];
    requestTimeoutMs: number;
    taskTimeoutMs: number;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): Config;
