import type { Config } from '../config.js';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type ParamValue = string | number | boolean | undefined | null;
export type Params = Record<string, ParamValue | ParamValue[]>;
interface RequestOptions {
    params?: Params;
    /** Per-call override; defaults to the configured request timeout. */
    timeoutMs?: number;
}
export declare class ProxmoxClient {
    private readonly apiBase;
    private readonly authHeader;
    private readonly requestTimeoutMs;
    private readonly dispatcher?;
    constructor(config: Config);
    get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
    post<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
    put<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
    delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
    private request;
}
export {};
