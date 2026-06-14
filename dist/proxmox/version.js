import { GuardError } from '../util/errors.js';
// The version rarely changes within a session, so cache the lookup per client to
// avoid an extra round trip on every version-gated call.
const cache = new WeakMap();
export function getVersion(client) {
    let pending = cache.get(client);
    if (!pending) {
        pending = fetchVersion(client).catch((err) => {
            cache.delete(client);
            throw err;
        });
        cache.set(client, pending);
    }
    return pending;
}
async function fetchVersion(client) {
    const raw = await client.get('/version');
    const source = raw.version ?? raw.release ?? '0';
    const { major, minor, patch } = parsePveVersion(source);
    return {
        version: raw.version ?? source,
        release: raw.release ?? source,
        repoid: raw.repoid,
        major,
        minor,
        patch,
    };
}
export function parsePveVersion(raw) {
    const nums = (raw.match(/\d+/g) ?? []).map(Number);
    return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0 };
}
export function atLeast(version, major, minor) {
    return version.major > major || (version.major === major && version.minor >= minor);
}
export async function requireMinVersion(client, min, feature) {
    const version = await getVersion(client);
    if (!atLeast(version, min[0], min[1])) {
        throw new GuardError(`${feature} requires Proxmox VE ${min[0]}.${min[1]} or newer; this node reports ${version.version}.`);
    }
}
//# sourceMappingURL=version.js.map