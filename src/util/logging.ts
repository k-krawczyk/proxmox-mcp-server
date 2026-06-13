const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LEVELS)[number];

function envLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

const threshold = LEVELS.indexOf(envLevel());

// stdout carries the MCP protocol stream, so every diagnostic line must go to stderr.
function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS.indexOf(level) < threshold) return;
  const time = new Date().toISOString();
  let line = `${time} ${level.toUpperCase()} ${message}`;
  if (fields && Object.keys(fields).length > 0) {
    line += ' ' + JSON.stringify(fields);
  }
  process.stderr.write(line + '\n');
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
