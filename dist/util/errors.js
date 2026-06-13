/**
 * Error raised for any non-2xx response from the Proxmox API. Carries enough
 * structure that callers can turn it into an actionable message without having
 * to re-parse the HTTP body.
 */
export class ProxmoxApiError extends Error {
    status;
    statusText;
    method;
    path;
    pveErrors;
    constructor(args) {
        super(ProxmoxApiError.buildMessage(args));
        this.name = 'ProxmoxApiError';
        this.status = args.status;
        this.statusText = args.statusText;
        this.method = args.method;
        this.path = args.path;
        if (args.pveErrors)
            this.pveErrors = args.pveErrors;
    }
    static buildMessage(args) {
        const hint = explainStatus(args.status);
        const parts = [
            `Proxmox API ${args.method} ${args.path} failed: ${args.status} ${args.statusText}`,
        ];
        if (hint)
            parts.push(hint);
        if (args.pveErrors && Object.keys(args.pveErrors).length > 0) {
            const detail = Object.entries(args.pveErrors)
                .map(([field, msg]) => `${field}: ${msg}`)
                .join('; ');
            parts.push(`details: ${detail}`);
        }
        else if (args.body && args.body.trim().length > 0) {
            parts.push(`body: ${truncate(args.body.trim(), 300)}`);
        }
        return parts.join(' — ');
    }
}
/** Raised when an async PVE task (UPID) finishes with a non-OK exit status. */
export class TaskFailedError extends Error {
    upid;
    exitStatus;
    constructor(upid, exitStatus, logTail) {
        const suffix = logTail ? ` — last log: ${truncate(logTail, 400)}` : '';
        super(`Task ${upid} finished with exit status "${exitStatus}"${suffix}`);
        this.name = 'TaskFailedError';
        this.upid = upid;
        this.exitStatus = exitStatus;
    }
}
/** Raised when a task does not reach the stopped state within the timeout. */
export class TaskTimeoutError extends Error {
    upid;
    constructor(upid, timeoutMs) {
        super(`Task ${upid} did not finish within ${timeoutMs}ms. It may still be running on the node; ` +
            `check pve_list_tasks before retrying.`);
        this.name = 'TaskTimeoutError';
        this.upid = upid;
    }
}
/** Raised by the confirmation/allowlist guards. Message is shown to the caller verbatim. */
export class GuardError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GuardError';
    }
}
function explainStatus(status) {
    switch (status) {
        case 400:
            return 'the request parameters were rejected; check required fields and value formats';
        case 401:
            return 'authentication failed; verify PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET';
        case 403:
            return 'the token lacks the privileges for this path; grant the matching role/permission';
        case 404:
            return 'the node, guest, or resource does not exist';
        case 500:
        case 501:
            return 'the node reported an internal error; the operation may be partially applied';
        case 596:
            return 'connection to the node failed (node down or unreachable in the cluster)';
        default:
            return undefined;
    }
}
function truncate(value, max) {
    return value.length > max ? value.slice(0, max) + '…' : value;
}
export function errorToMessage(err) {
    if (err instanceof Error)
        return err.message;
    return typeof err === 'string' ? err : JSON.stringify(err);
}
//# sourceMappingURL=errors.js.map