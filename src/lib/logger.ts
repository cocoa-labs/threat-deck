/**
 * Structured logger — zero-dep JSON-line logger for Cocoa AI Threat Deck.
 *
 * Why not pino: a 2KB single-file logger covers the actual needs (structured
 * JSON, level filtering, request-context propagation, audit-event emission)
 * without adding a runtime dependency. If we ever need pino's pretty-printing,
 * transport plugins, or async logging, swap this module — every caller uses
 * the same interface.
 *
 * Output format (one JSON object per line, suitable for Datadog / Vector / Loki):
 *   {"ts":"2026-05-23T14:32:11.123Z","level":"info","msg":"...","ctx":{...}}
 *
 * Levels (filterable via LOG_LEVEL env var):
 *   trace < debug < info < warn < error < fatal
 *
 * Audit events go through `recordAudit()` in `src/lib/audit.ts`, which calls
 * `logger.audit(...)` here (synchronous stdout/stderr emit) AND writes a row
 * to the aegis_audit_log DB table (fire-and-forget Promise so logging never
 * blocks the request path).
 */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function resolveMinLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVEL_PRIORITY) return raw as LogLevel;
  return 'info';
}

const minLevel = resolveMinLevel();
const minPriority = LEVEL_PRIORITY[minLevel];

/* ─── Core emit ─── */

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVEL_PRIORITY[level] < minPriority) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (ctx && Object.keys(ctx).length > 0) {
    entry.ctx = ctx;
  }

  // One JSON line per log entry — append a newline so `tail -f | jq` works.
  // Use stderr for warn/error/fatal so log shippers can route them.
  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'warn' || level === 'error' || level === 'fatal') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

/* ─── Public logger interface ─── */

export const logger = {
  trace: (msg: string, ctx?: LogContext) => emit('trace', msg, ctx),
  debug: (msg: string, ctx?: LogContext) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit('error', msg, ctx),
  fatal: (msg: string, ctx?: LogContext) => emit('fatal', msg, ctx),

  /**
   * Audit-level emit. Always logged at `info` priority (filterable like any
   * other level) but with a fixed `audit: true` marker so log shippers can
   * route audit events to a separate sink for compliance retention.
   *
   * This is the LOG side of audit recording — the DB-persistence side lives
   * in `src/lib/audit.ts` (which calls this internally). Don't call this
   * directly from feature code; call `recordAudit()` so both sides happen.
   */
  audit: (action: string, ctx?: LogContext) =>
    emit('info', `audit:${action}`, { ...ctx, audit: true, action }),

  /**
   * Bind a context object to all subsequent calls on the returned logger.
   * Useful for per-request loggers: `const log = logger.child({ requestId, userId })`.
   * The bound context merges with each call's context (call-site keys win).
   */
  child(boundCtx: LogContext) {
    return {
      trace: (msg: string, ctx?: LogContext) => emit('trace', msg, { ...boundCtx, ...ctx }),
      debug: (msg: string, ctx?: LogContext) => emit('debug', msg, { ...boundCtx, ...ctx }),
      info: (msg: string, ctx?: LogContext) => emit('info', msg, { ...boundCtx, ...ctx }),
      warn: (msg: string, ctx?: LogContext) => emit('warn', msg, { ...boundCtx, ...ctx }),
      error: (msg: string, ctx?: LogContext) => emit('error', msg, { ...boundCtx, ...ctx }),
      fatal: (msg: string, ctx?: LogContext) => emit('fatal', msg, { ...boundCtx, ...ctx }),
      audit: (action: string, ctx?: LogContext) =>
        emit('info', `audit:${action}`, { ...boundCtx, ...ctx, audit: true, action }),
    };
  },
};

/* ─── Error formatting helper ─── */

/**
 * Convert an unknown caught value into a structured log-friendly object.
 * Captures name, message, and stack for real Error objects; just stringifies
 * everything else.
 */
export function formatError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return {
    name: 'NonError',
    message: typeof err === 'string' ? err : JSON.stringify(err),
  };
}
