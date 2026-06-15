/**
 * createWorkerLogger — pino wrapper with `{ worker: name }` base bindings and
 * shared error serializers.
 *
 * Intent: every Cloud Function / Pub/Sub worker creates exactly one logger via
 * this factory at module load. Downstream modules accept a `WorkerLogger`
 * argument so they never reach for a module-level logger and remain unit-test
 * friendly (`createFakeLogger` from `@intexuraos/common-worker/testing`).
 *
 * `LOG_LEVEL` is read once when the factory is called. Default: `info`. The
 * empty string is treated as "unset" so a partially-templated env file does
 * not silently disable logging.
 */
import pino from 'pino';
import type { DestinationStream } from 'pino';
import { serializeError } from '@intexuraos/common-core';

export interface WorkerLogger {
  readonly level: string;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): WorkerLogger;
}

/**
 * Test seam: callers may pass a custom destination so unit tests can capture
 * structured output without touching stdout. Production callers pass nothing.
 */
export interface CreateWorkerLoggerOptions {
  readonly destination?: DestinationStream;
}

function resolveLevel(): string {
  const raw = process.env['LOG_LEVEL'];
  if (raw === undefined || raw === '') return 'info';
  return raw;
}

export function createWorkerLogger(
  name: string,
  options: CreateWorkerLoggerOptions = {}
): WorkerLogger {
  const pinoOptions: pino.LoggerOptions = {
    level: resolveLevel(),
    base: { worker: name },
    formatters: {
      level: (label: string): { level: string } => ({ level: label }),
    },
    serializers: { error: serializeError, err: serializeError },
  };
  const logger =
    options.destination !== undefined ? pino(pinoOptions, options.destination) : pino(pinoOptions);
  return logger as unknown as WorkerLogger;
}
