import { z } from 'zod';
import { guardTarget, nodeField } from './helpers.js';
export function registerClusterTools(reg) {
    reg.register({
        name: 'pve_list_nodes',
        title: 'List nodes',
        description: 'List all nodes in the Proxmox cluster with their online status and load.',
        annotations: { readOnlyHint: true },
    }, (_args, ctx) => ctx.client.get('/nodes'));
    reg.register({
        name: 'pve_node_status',
        title: 'Node status',
        description: 'Detailed status of a single node: CPU, memory, uptime, kernel and PVE version.',
        schema: { node: nodeField },
        annotations: { readOnlyHint: true },
    }, ({ node }, ctx) => {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/status`);
    });
    reg.register({
        name: 'pve_cluster_resources',
        title: 'Cluster resources',
        description: 'Single combined view of cluster resources (VMs, containers, storage, nodes). Use the ' +
            'type filter to narrow the result.',
        schema: {
            type: z
                .enum(['vm', 'storage', 'node', 'sdn'])
                .optional()
                .describe('Optional resource type filter'),
        },
        annotations: { readOnlyHint: true },
    }, ({ type }, ctx) => ctx.client.get('/cluster/resources', {
        params: type ? { type } : undefined,
    }));
    reg.register({
        name: 'pve_list_tasks',
        title: 'List tasks',
        description: 'Recent task log for a node, including UPID, type, status and exit status. Useful to ' +
            'check on a long-running operation that may have outlived a tool call timeout.',
        schema: {
            node: nodeField,
            limit: z.number().int().positive().max(500).default(50).describe('Maximum tasks to return'),
            running: z.boolean().optional().describe('Only return tasks that are still running'),
        },
        annotations: { readOnlyHint: true },
    }, ({ node, limit, running }, ctx) => {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/tasks`, {
            params: { limit, source: 'all', ...(running ? { running: true } : {}) },
        });
    });
}
//# sourceMappingURL=cluster.js.map