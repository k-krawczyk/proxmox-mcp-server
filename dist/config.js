import { z } from 'zod';
const boolFromEnv = z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
    .transform((v) => v === 'true' || v === '1' || v === 'yes');
const csvList = z.string().transform((v) => v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0));
// USER@REALM!TOKENID — the secret is supplied separately, not as part of the id.
const tokenIdPattern = /^[^@\s]+@[^!\s]+![^=\s]+$/;
const schema = z.object({
    PROXMOX_HOST: z
        .string()
        .url('PROXMOX_HOST must be a full URL, e.g. https://pve.local:8006')
        .transform((v) => v.replace(/\/+$/, '')),
    PROXMOX_TOKEN_ID: z
        .string()
        .regex(tokenIdPattern, 'PROXMOX_TOKEN_ID must look like USER@REALM!TOKENID'),
    PROXMOX_TOKEN_SECRET: z.string().min(1, 'PROXMOX_TOKEN_SECRET must not be empty'),
    PROXMOX_INSECURE_TLS: boolFromEnv.default('false'),
    PVE_READONLY: boolFromEnv.default('true'),
    PVE_NODE_ALLOWLIST: csvList.optional(),
    PVE_VMID_ALLOWLIST: csvList
        .optional()
        .transform((list) => list?.map((v) => Number(v)))
        .pipe(z.array(z.number().int().positive()).optional()),
    PROXMOX_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    PVE_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
});
export function loadConfig(env = process.env) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
        throw new Error(`Invalid configuration. Fix these environment variables:\n${issues}`);
    }
    const c = parsed.data;
    return {
        host: c.PROXMOX_HOST,
        apiBase: `${c.PROXMOX_HOST}/api2/json`,
        authHeader: `PVEAPIToken=${c.PROXMOX_TOKEN_ID}=${c.PROXMOX_TOKEN_SECRET}`,
        insecureTls: c.PROXMOX_INSECURE_TLS,
        readonly: c.PVE_READONLY,
        ...(c.PVE_NODE_ALLOWLIST ? { nodeAllowlist: c.PVE_NODE_ALLOWLIST } : {}),
        ...(c.PVE_VMID_ALLOWLIST ? { vmidAllowlist: c.PVE_VMID_ALLOWLIST } : {}),
        requestTimeoutMs: c.PROXMOX_REQUEST_TIMEOUT_MS,
        taskTimeoutMs: c.PVE_TASK_TIMEOUT_MS,
    };
}
//# sourceMappingURL=config.js.map