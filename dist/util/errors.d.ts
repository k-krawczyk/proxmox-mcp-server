/**
 * Error raised for any non-2xx response from the Proxmox API. Carries enough
 * structure that callers can turn it into an actionable message without having
 * to re-parse the HTTP body.
 */
export declare class ProxmoxApiError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly method: string;
    readonly path: string;
    readonly pveErrors?: Record<string, string>;
    constructor(args: {
        status: number;
        statusText: string;
        method: string;
        path: string;
        pveErrors?: Record<string, string>;
        body?: string;
    });
    private static buildMessage;
}
/** Raised when an async PVE task (UPID) finishes with a non-OK exit status. */
export declare class TaskFailedError extends Error {
    readonly upid: string;
    readonly exitStatus: string;
    constructor(upid: string, exitStatus: string, logTail?: string);
}
/** Raised when a task does not reach the stopped state within the timeout. */
export declare class TaskTimeoutError extends Error {
    readonly upid: string;
    constructor(upid: string, timeoutMs: number);
}
/** Raised by the confirmation/allowlist guards. Message is shown to the caller verbatim. */
export declare class GuardError extends Error {
    constructor(message: string);
}
export declare function errorToMessage(err: unknown): string;
