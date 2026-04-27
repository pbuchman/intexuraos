/**
 * Logger type used for dependency injection across the transcription worker.
 *
 * The runtime logger is bootstrapped via `initWorker()` in `index.ts` (see
 * `@intexuraos/infra-sentry`); this module exists only to expose a structural
 * `Logger` interface that callers (`polling.ts`, `main.ts`, providers) accept
 * without taking a hard dependency on `pino`.
 */
export interface Logger {
  level: string;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}
