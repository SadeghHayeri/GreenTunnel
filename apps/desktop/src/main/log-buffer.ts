import { EventEmitter } from 'node:events';
import type { LogRecord, LogSink } from 'green-tunnel';
import type { LogEntry } from '../shared/types.js';

/**
 * Lines kept in memory. At `trace` a busy browser session produces a few
 * hundred a minute, so this is roughly an hour of history — enough to still
 * hold the start of whatever went wrong once the user thinks to look.
 */
export const LOG_CAPACITY = 5000;

/**
 * Trim in batches rather than on every push: dropping one entry off the front
 * of a 5000-element array per record is a lot of copying under a trace-level
 * flood, and nobody can tell the difference between 5000 and 5512 lines.
 */
const TRIM_SLACK = 512;

/** Coalesce pushes to the window; a flood must not be one IPC message each. */
const FLUSH_MS = 120;

interface LogBufferEvents {
  append: [LogEntry[]];
  cleared: [];
}

/**
 * A bounded ring of log records, and the only thing the log panel reads from.
 *
 * It is deliberately independent of the engine: `TunnelService` restarts the
 * `Proxy` whenever an engine setting changes, and history that vanished on
 * every restart would be useless for the one job this has — telling the user
 * what happened just before something broke.
 */
export class LogBuffer extends EventEmitter<LogBufferEvents> {
  readonly capacity: number;

  #entries: LogEntry[] = [];
  #pending: LogEntry[] = [];
  #timer: NodeJS.Timeout | null = null;
  #seq = 0;
  #dropped = 0;

  constructor(capacity = LOG_CAPACITY) {
    super();
    this.capacity = capacity;
  }

  get entries(): readonly LogEntry[] {
    return this.#entries;
  }

  get dropped(): number {
    return this.#dropped;
  }

  /** Hand this to `createLogger`; the logger's level decides what arrives. */
  readonly sink: LogSink = (record: LogRecord): void => {
    const entry: LogEntry = {
      seq: ++this.#seq,
      time: record.time,
      level: record.level,
      scope: record.scope,
      message: record.message,
      ...(record.error?.stack === undefined ? {} : { stack: record.error.stack }),
    };

    this.#entries.push(entry);
    if (this.#entries.length > this.capacity + TRIM_SLACK) {
      const excess = this.#entries.length - this.capacity;
      this.#entries.splice(0, excess);
      this.#dropped += excess;
    }

    this.#pending.push(entry);
    this.#scheduleFlush();
  };

  clear(): void {
    this.#entries = [];
    this.#pending = [];
    this.#dropped = 0;
    this.emit('cleared');
  }

  #scheduleFlush(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const batch = this.#pending;
      this.#pending = [];
      if (batch.length > 0) this.emit('append', batch);
    }, FLUSH_MS);
    // Logging must never be the reason the process is still alive.
    this.#timer.unref();
  }
}
