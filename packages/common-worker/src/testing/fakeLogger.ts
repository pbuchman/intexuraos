/**
 * createFakeLogger — in-memory `WorkerLogger` for unit tests.
 *
 * All `info`/`warn`/`error`/`debug` calls append to `entries` so tests can
 * assert structured observability output without touching pino. `child()`
 * produces a fresh fake logger with its own `entries` array.
 */
import type { WorkerLogger } from '../logger.js';

export interface FakeLoggerEntry {
  readonly level: 'info' | 'warn' | 'error' | 'debug';
  readonly obj: object;
  readonly msg?: string;
}

export interface FakeLogger extends WorkerLogger {
  readonly entries: FakeLoggerEntry[];
}

export function createFakeLogger(level = 'debug'): FakeLogger {
  const entries: FakeLoggerEntry[] = [];
  const record =
    (lvl: FakeLoggerEntry['level']) =>
    (obj: object, msg?: string): void => {
      const entry: FakeLoggerEntry =
        msg === undefined ? { level: lvl, obj } : { level: lvl, obj, msg };
      entries.push(entry);
    };
  const logger: FakeLogger = {
    level,
    entries,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    child: (): WorkerLogger => createFakeLogger(level),
  };
  return logger;
}
