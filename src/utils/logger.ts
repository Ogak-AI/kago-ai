// ============================================================
// Kago AI – Structured Logger
// Provides consistent, tagged log output with severity levels.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '✅',
  warn: '⚠️',
  error: '❌',
};

/**
 * Structured logger for Kago AI.
 * All log entries are prefixed with [Kago/{module}] for easy filtering.
 */
export class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private format(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = `[Kago/${this.module}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${LOG_COLORS[level]} ${timestamp} ${prefix} ${message}${dataStr}`;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    console.log(this.format('debug', message, data));
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.log(this.format('info', message, data));
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(this.format('warn', message, data));
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errStr = error instanceof Error ? error.message : String(error ?? '');
    const combined = { ...data, ...(errStr ? { error: errStr } : {}) };
    console.error(this.format('error', message, Object.keys(combined).length > 0 ? combined : undefined));
  }
}

/** Create a logger for a specific module */
export function createLogger(module: string): Logger {
  return new Logger(module);
}
