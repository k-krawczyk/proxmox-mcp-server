#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ProxmoxClient } from './proxmox/client.js';
import { ToolRegistry } from './tools/registry.js';
import { registerAllTools } from './tools/index.js';
import { getVersion } from './proxmox/version.js';
import { errorToMessage } from './util/errors.js';
import { log } from './util/logging.js';
async function main() {
    const config = loadConfig();
    const client = new ProxmoxClient(config);
    const server = new McpServer({ name: 'proxmox-mcp-server', version: '0.2.0' });
    const registry = new ToolRegistry(server, { client, config });
    registerAllTools(registry);
    const { registered, skipped } = registry.counts;
    log.info('proxmox mcp server starting', {
        host: config.host,
        readonly: config.readonly,
        toolsRegistered: registered,
        writeToolsSkipped: skipped,
        nodeAllowlist: config.nodeAllowlist ?? 'all',
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Best-effort probe so the operator sees which PVE version they connected to.
    // Detached from startup: a slow or unreachable node must not delay readiness.
    void getVersion(client)
        .then((v) => log.info('connected to proxmox', { pveVersion: v.version, release: v.release }))
        .catch((err) => log.warn('proxmox version probe failed', { error: errorToMessage(err) }));
}
main().catch((err) => {
    log.error('fatal: server failed to start', { error: errorToMessage(err) });
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map