import { styleText } from 'node:util';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogRecord {
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly scope: string;
  readonly message: string;
  readonly time: number;
  readonly error?: Error;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Where records go. Defaults to a coloured stderr writer. */
  readonly sink?: LogSink;
}

const RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** Every level, quietest first — for `--log-level` help and level pickers. */
export const LOG_LEVELS: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug', 'trace'];

const COLOR: Record<Exclude<LogLevel, 'silent'>, Parameters<typeof styleText>[0]> = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'gray',
  trace: 'gray',
};

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(RANK, value);
}

export const stderrSink: LogSink = (record) => {
  const time = new Date(record.time).toISOString().slice(11, 23);
  const head = styleText(COLOR[record.level], `${record.level.padEnd(5)} ${record.scope}`);
  console.error(`${styleText('gray', time)} ${head} ${record.message}`);
  if (record.error?.stack) {
    console.error(styleText('gray', record.error.stack));
  }
};

/** Level and sink of one logger *family*, shared by a parent and its children. */
interface LoggerState {
  level: LogLevel;
  sink: LogSink;
}

/**
 * A ~50-line replacement for `debug`. Levelled, scoped, and pluggable so the
 * Electron main process can forward records straight into the UI.
 */
export class Logger {
  readonly scope: string;
  #state: LoggerState;

  constructor(scope = 'green-tunnel', options: LoggerOptions = {}) {
    this.scope = scope;
    this.#state = { level: options.level ?? 'error', sink: options.sink ?? stderrSink };
  }

  get level(): LogLevel {
    return this.#state.level;
  }

  setLevel(level: LogLevel): void {
    this.#state.level = level;
  }

  setSink(sink: LogSink): void {
    this.#state.sink = sink;
  }

  child(scope: string): Logger {
    const child = new Logger(`${this.scope}:${scope}`);
    // Deliberately the *same* state object, not a copy of the values: the log
    // panel raises the level while the app is running, and a child created
    // before that would otherwise stay stuck at whatever the level was when it
    // was made — silently swallowing exactly the records the user asked for.
    child.#state = this.#state;
    return child;
  }

  error(message: string, error?: Error): void {
    this.#emit('error', message, error);
  }

  warn(message: string): void {
    this.#emit('warn', message);
  }

  info(message: string): void {
    this.#emit('info', message);
  }

  debug(message: string): void {
    this.#emit('debug', message);
  }

  trace(message: string): void {
    this.#emit('trace', message);
  }

  #emit(level: Exclude<LogLevel, 'silent'>, message: string, error?: Error): void {
    if (RANK[level] > RANK[this.#state.level]) return;
    this.#state.sink(
      error
        ? { level, scope: this.scope, message, time: Date.now(), error }
        : { level, scope: this.scope, message, time: Date.now() },
    );
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger('green-tunnel', options);
}
