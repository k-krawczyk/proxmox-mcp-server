declare const LEVELS: readonly ["debug", "info", "warn", "error"];
export type LogLevel = (typeof LEVELS)[number];
export declare const log: {
    debug: (message: string, fields?: Record<string, unknown>) => void;
    info: (message: string, fields?: Record<string, unknown>) => void;
    warn: (message: string, fields?: Record<string, unknown>) => void;
    error: (message: string, fields?: Record<string, unknown>) => void;
};
export {};
