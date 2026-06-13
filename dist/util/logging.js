const LEVELS = ['debug', 'info', 'warn', 'error'];
function envLevel() {
    const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
    return LEVELS.includes(raw) ? raw : 'info';
}
const threshold = LEVELS.indexOf(envLevel());
// stdout carries the MCP protocol stream, so every diagnostic line must go to stderr.
function emit(level, message, fields) {
    if (LEVELS.indexOf(level) < threshold)
        return;
    const time = new Date().toISOString();
    let line = `${time} ${level.toUpperCase()} ${message}`;
    if (fields && Object.keys(fields).length > 0) {
        line += ' ' + JSON.stringify(fields);
    }
    process.stderr.write(line + '\n');
}
export const log = {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
};
//# sourceMappingURL=logging.js.map