import { z } from 'zod';
import type { ToolContext } from './registry.js';
export declare const nodeField: z.ZodString;
export declare const vmidField: z.ZodNumber;
export declare const confirmField: z.ZodOptional<z.ZodBoolean>;
/**
 * Resolve a write response. PVE returns a UPID string for asynchronous work; in
 * that case we block until the task is done and report its real exit status
 * instead of an optimistic "ok".
 */
export declare function settleTask(ctx: ToolContext, data: unknown, summary: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function guardTarget(ctx: ToolContext, node: string, vmid?: number): void;
