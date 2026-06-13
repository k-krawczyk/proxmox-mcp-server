import { Agent, fetch } from 'undici';
import { ProxmoxApiError } from '../util/errors.js';
import { log } from '../util/logging.js';
const RETRYABLE_STATUS = new Set([502, 503, 504, 596]);
const MAX_GET_RETRIES = 2;
export class ProxmoxClient {
    apiBase;
    authHeader;
    requestTimeoutMs;
    dispatcher;
    constructor(config) {
        this.apiBase = config.apiBase;
        this.authHeader = config.authHeader;
        this.requestTimeoutMs = config.requestTimeoutMs;
        if (config.insecureTls) {
            // Self-signed labs only. This disables certificate validation for the
            // whole client, so it is gated behind an explicit env flag and a warning.
            this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
            log.warn('TLS certificate verification is disabled (PROXMOX_INSECURE_TLS=true)');
        }
    }
    get(path, opts) {
        return this.request('GET', path, opts);
    }
    post(path, opts) {
        return this.request('POST', path, opts);
    }
    put(path, opts) {
        return this.request('PUT', path, opts);
    }
    delete(path, opts) {
        return this.request('DELETE', path, opts);
    }
    async request(method, path, opts) {
        const timeoutMs = opts?.timeoutMs ?? this.requestTimeoutMs;
        const encoded = encodeParams(opts?.params);
        let url = `${this.apiBase}${path}`;
        let body;
        if (method === 'GET' || method === 'DELETE') {
            if (encoded)
                url += `?${encoded}`;
        }
        else {
            body = encoded ?? '';
        }
        const headers = { Authorization: this.authHeader };
        if (body !== undefined)
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        // GET is the only method retried: it is the sole side-effect-free verb here,
        // so re-issuing it after a transient network/5xx failure is always safe.
        const maxAttempts = method === 'GET' ? MAX_GET_RETRIES + 1 : 1;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                log.debug('proxmox request', { method, path, attempt });
                const res = await fetch(url, {
                    method,
                    headers,
                    body,
                    signal: AbortSignal.timeout(timeoutMs),
                    ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
                });
                const text = await res.text();
                if (!res.ok) {
                    const pveErrors = extractPveErrors(text);
                    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
                        lastError = new ProxmoxApiError({
                            status: res.status,
                            statusText: res.statusText,
                            method,
                            path,
                            ...(pveErrors ? { pveErrors } : {}),
                            body: text,
                        });
                        await delay(backoffMs(attempt));
                        continue;
                    }
                    throw new ProxmoxApiError({
                        status: res.status,
                        statusText: res.statusText,
                        method,
                        path,
                        ...(pveErrors ? { pveErrors } : {}),
                        body: text,
                    });
                }
                return parseData(text);
            }
            catch (err) {
                if (err instanceof ProxmoxApiError)
                    throw err;
                // Network-level failure (DNS, TLS, timeout). Retry only for GET.
                lastError = err;
                if (attempt < maxAttempts) {
                    await delay(backoffMs(attempt));
                    continue;
                }
                throw wrapNetworkError(method, path, err);
            }
        }
        throw wrapNetworkError(method, path, lastError);
    }
}
function encodeParams(params) {
    if (!params)
        return undefined;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null)
            continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === undefined || item === null)
                    continue;
                search.append(key, toParamString(item));
            }
        }
        else {
            search.append(key, toParamString(value));
        }
    }
    const out = search.toString();
    return out.length > 0 ? out : undefined;
}
function toParamString(value) {
    if (typeof value === 'boolean')
        return value ? '1' : '0';
    return String(value);
}
function parseData(text) {
    if (text.trim().length === 0)
        return undefined;
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        return text;
    }
    if (json !== null && typeof json === 'object' && 'data' in json) {
        return json.data;
    }
    return json;
}
function extractPveErrors(text) {
    try {
        const json = JSON.parse(text);
        if (json.errors && typeof json.errors === 'object')
            return json.errors;
    }
    catch {
        /* body was not JSON */
    }
    return undefined;
}
function wrapNetworkError(method, path, err) {
    const reason = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const detail = isTimeout ? 'request timed out' : reason;
    return new Error(`Proxmox API ${method} ${path} failed before a response: ${detail}`);
}
function backoffMs(attempt) {
    return 250 * attempt;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=client.js.map