import { z } from 'zod';
import { guardTarget, nodeField, settleTask } from './helpers.js';
import { requireMinVersion } from '../proxmox/version.js';
export function registerStorageTools(reg) {
    reg.register({
        name: 'pve_list_storage',
        title: 'List storage',
        description: 'List storages visible from a node, with type, enabled content and free space.',
        schema: { node: nodeField },
        annotations: { readOnlyHint: true },
    }, ({ node }, ctx) => {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/storage`);
    });
    reg.register({
        name: 'pve_storage_content',
        title: 'Storage content',
        description: 'List the volumes on a storage: ISO images, container templates, disk images or backups. ' +
            'Use the content filter to narrow the listing.',
        schema: {
            node: nodeField,
            storage: z.string().min(1),
            content: z
                .enum(['iso', 'vztmpl', 'images', 'backup', 'rootdir', 'snippets'])
                .optional()
                .describe('Filter by content type'),
        },
        annotations: { readOnlyHint: true },
    }, ({ node, storage, content }, ctx) => {
        guardTarget(ctx, node);
        return ctx.client.get(`/nodes/${node}/storage/${storage}/content`, {
            params: content ? { content } : undefined,
        });
    });
    reg.register({
        name: 'pve_download_iso',
        title: 'Download ISO or template',
        description: 'Download an ISO image or container template from a URL straight onto a storage. Returns ' +
            'the task outcome once the download completes.',
        schema: {
            node: nodeField,
            storage: z.string().min(1),
            url: z.string().url().describe('Source URL to download from'),
            filename: z.string().min(1).describe('Destination file name on the storage'),
            content: z.enum(['iso', 'vztmpl']).default('iso'),
            checksum: z.string().optional(),
            checksumAlgorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        write: true,
    }, async (args, ctx) => {
        guardTarget(ctx, args.node);
        // The download-url endpoint only exists from PVE 7.2; gate it so older nodes
        // get a clear message instead of a bare 404.
        await requireMinVersion(ctx.client, [7, 2], 'pve_download_iso');
        const data = await ctx.client.post(`/nodes/${args.node}/storage/${args.storage}/download-url`, {
            params: {
                content: args.content,
                url: args.url,
                filename: args.filename,
                checksum: args.checksum,
                'checksum-algorithm': args.checksumAlgorithm,
            },
        });
        return settleTask(ctx, data, { action: 'download', filename: args.filename });
    });
}
//# sourceMappingURL=storage.js.map