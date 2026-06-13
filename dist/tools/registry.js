import { errorToMessage } from '../util/errors.js';
import { log } from '../util/logging.js';
// Wrapping the SDK behind this registry keeps the rest of the codebase free of
// direct SDK types, which eases the planned migration to the v2 spec later on.
export class ToolRegistry {
    server;
    ctx;
    registered = 0;
    skipped = 0;
    constructor(server, ctx) {
        this.server = server;
        this.ctx = ctx;
    }
    register(def, handler) {
        if (def.write && this.ctx.config.readonly) {
            this.skipped++;
            log.debug('readonly mode: not registering write tool', { name: def.name });
            return;
        }
        const shape = (def.schema ?? {});
        const callback = async (args) => {
            try {
                const result = await handler(args, this.ctx);
                return { content: [{ type: 'text', text: render(result) }] };
            }
            catch (err) {
                log.warn('tool failed', { name: def.name, error: errorToMessage(err) });
                return {
                    content: [{ type: 'text', text: `Error: ${errorToMessage(err)}` }],
                    isError: true,
                };
            }
        };
        this.server.registerTool(def.name, {
            title: def.title,
            description: def.description,
            inputSchema: shape,
            annotations: { title: def.title, openWorldHint: true, ...def.annotations },
        }, 
        // The SDK callback type is a deferred conditional over the raw shape that
        // TypeScript cannot match against this generic wrapper; the cast is the one
        // place SDK types leak, isolated here on purpose.
        callback);
        this.registered++;
    }
    get counts() {
        return { registered: this.registered, skipped: this.skipped };
    }
}
function render(result) {
    if (typeof result === 'string')
        return result;
    return JSON.stringify(result ?? null, null, 2);
}
//# sourceMappingURL=registry.js.map