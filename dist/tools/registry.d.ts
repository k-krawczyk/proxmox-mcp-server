import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z, ZodRawShape } from 'zod';
import type { Config } from '../config.js';
import type { ProxmoxClient } from '../proxmox/client.js';
export interface ToolContext {
    client: ProxmoxClient;
    config: Config;
}
export interface ToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
}
interface ToolDefinition<Shape extends ZodRawShape> {
    name: string;
    title: string;
    description: string;
    schema?: Shape;
    annotations: ToolAnnotations;
    /** Tools that change state. Not registered at all when PVE_READONLY=true. */
    write?: boolean;
}
type InferArgs<Shape extends ZodRawShape> = {
    [K in keyof Shape]: z.infer<Shape[K]>;
};
type Handler<Shape extends ZodRawShape> = (args: InferArgs<Shape>, ctx: ToolContext) => Promise<unknown> | unknown;
export declare class ToolRegistry {
    private readonly server;
    private readonly ctx;
    private registered;
    private skipped;
    constructor(server: McpServer, ctx: ToolContext);
    register<Shape extends ZodRawShape>(def: ToolDefinition<Shape>, handler: Handler<Shape>): void;
    get counts(): {
        registered: number;
        skipped: number;
    };
}
export {};
