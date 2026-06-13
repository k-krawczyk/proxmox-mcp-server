import { Agent, fetch } from 'undici';
import type { Config } from '../config.js';
import { ProxmoxApiError } from '../util/errors.js';
import { log } from '../util/logging.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type ParamValue = string | number | boolean | undefined | null;
export type Params = Record<string, ParamValue | ParamValue[]>;

interface RequestOptions {
  params?: Params;
  /** Per-call override; defaults to the configured request timeout. */
  timeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([502, 503, 504, 596]);
const MAX_GET_RETRIES = 2;

export class ProxmoxClient {
  private readonly apiBase: string;
  private readonly authHeader: string;
  private readonly requestTimeoutMs: number;
  private readonly dispatcher?: Agent;

  constructor(config: Config) {
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

  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  post<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, opts);
  }

  put<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, opts);
  }

  delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, opts);
  }

  private async request<T>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? this.requestTimeoutMs;
    const encoded = encodeParams(opts?.params);

    let url = `${this.apiBase}${path}`;
    let body: string | undefined;
    if (method === 'GET' || method === 'DELETE') {
      if (encoded) url += `?${encoded}`;
    } else {
      body = encoded ?? '';
    }

    const headers: Record<string, string> = { Authorization: this.authHeader };
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    // GET is the only method retried: it is the sole side-effect-free verb here,
    // so re-issuing it after a transient network/5xx failure is always safe.
    const maxAttempts = method === 'GET' ? MAX_GET_RETRIES + 1 : 1;
    let lastError: unknown;

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

        return parseData<T>(text);
      } catch (err) {
        if (err instanceof ProxmoxApiError) throw err;
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

function encodeParams(params?: Params): string | undefined {
  if (!params) return undefined;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        search.append(key, toParamString(item));
      }
    } else {
      search.append(key, toParamString(value));
    }
  }
  const out = search.toString();
  return out.length > 0 ? out : undefined;
}

function toParamString(value: ParamValue): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function parseData<T>(text: string): T {
  if (text.trim().length === 0) return undefined as T;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return text as unknown as T;
  }
  if (json !== null && typeof json === 'object' && 'data' in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function extractPveErrors(text: string): Record<string, string> | undefined {
  try {
    const json = JSON.parse(text) as { errors?: Record<string, string> };
    if (json.errors && typeof json.errors === 'object') return json.errors;
  } catch {
    /* body was not JSON */
  }
  return undefined;
}

function wrapNetworkError(method: HttpMethod, path: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  const isTimeout = err instanceof Error && err.name === 'TimeoutError';
  const detail = isTimeout ? 'request timed out' : reason;
  return new Error(`Proxmox API ${method} ${path} failed before a response: ${detail}`);
}

function backoffMs(attempt: number): number {
  return 250 * attempt;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
