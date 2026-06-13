import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z, ZodRawShape } from 'zod';
import type { Config } from '../config.js';
import type { ProxmoxClient } from '../proxmox/client.js';
import { errorToMessage } from '../util/errors.js';
import { log } from '../util/logging.js';

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

// Mirror of the SDK's internal ShapeOutput so handler args line up exactly with
// what registerTool passes through at runtime.
type InferArgs<Shape extends ZodRawShape> = { [K in keyof Shape]: z.infer<Shape[K]> };
type Handler<Shape extends ZodRawShape> = (
  args: InferArgs<Shape>,
  ctx: ToolContext,
) => Promise<unknown> | unknown;

// Wrapping the SDK behind this registry keeps the rest of the codebase free of
// direct SDK types, which eases the planned migration to the v2 spec later on.
export class ToolRegistry {
  private registered = 0;
  private skipped = 0;

  constructor(
    private readonly server: McpServer,
    private readonly ctx: ToolContext,
  ) {}

  register<Shape extends ZodRawShape>(def: ToolDefinition<Shape>, handler: Handler<Shape>): void {
    if (def.write && this.ctx.config.readonly) {
      this.skipped++;
      log.debug('readonly mode: not registering write tool', { name: def.name });
      return;
    }

    const shape = (def.schema ?? {}) as Shape;
    const callback = async (args: InferArgs<Shape>) => {
      try {
        const result = await handler(args, this.ctx);
        return { content: [{ type: 'text' as const, text: render(result) }] };
      } catch (err) {
        log.warn('tool failed', { name: def.name, error: errorToMessage(err) });
        return {
          content: [{ type: 'text' as const, text: `Error: ${errorToMessage(err)}` }],
          isError: true,
        };
      }
    };

    this.server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: shape,
        annotations: { title: def.title, openWorldHint: true, ...def.annotations },
      },
      // The SDK callback type is a deferred conditional over the raw shape that
      // TypeScript cannot match against this generic wrapper; the cast is the one
      // place SDK types leak, isolated here on purpose.
      callback as unknown as ToolCallback<Shape>,
    );
    this.registered++;
  }

  get counts(): { registered: number; skipped: number } {
    return { registered: this.registered, skipped: this.skipped };
  }
}

function render(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result ?? null, null, 2);
}
