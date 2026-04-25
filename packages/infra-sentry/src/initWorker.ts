/**
 * Worker bootstrap helper.
 *
 * `initWorker` is the single entry point for `workers/` (Cloud Functions /
 * background workers) — it wires Sentry initialization and a Pino logger
 * (with the unified Sentry + OTel + dev streams via `createAppLogger`)
 * behind one call, and returns a `flush` that drains both before process
 * exit.
 *
 * @example
 * ```ts
 * import { initWorker } from '@intexuraos/infra-sentry';
 *
 * const { logger, flush } = initWorker({
 *   serviceName: 'my-worker',
 *   environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
 *   sentryDsn: process.env['INTEXURAOS_SENTRY_DSN'],
 * });
 *
 * try {
 *   logger.info('starting work');
 *   // ...
 * } finally {
 *   await flush();
 * }
 * ```
 */

import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';
import { defaultRelease, initSentry } from './init.js';
import { createAppLogger } from './appLogger.js';

export interface WorkerBootstrapConfig {
  /** Service name (used as logger name + Sentry serverName). */
  serviceName: string;
  /** Environment name (e.g. `development`, `production`). */
  environment: string;
  /** Sentry DSN. When undefined / empty, Sentry is not initialized. */
  sentryDsn?: string;
  /**
   * Release identifier (e.g. Cloud Run revision). Defaults to
   * `process.env['K_REVISION']`.
   */
  release?: string;
  /** Tracing sample rate override. */
  tracesSampleRate?: number;
  /**
   * Extra tags to attach to every Sentry event (applied via `Sentry.setTag`
   * when DSN is present).
   */
  extraLogStreamTags?: Record<string, string>;
}

export interface WorkerBootstrap {
  /** Pino logger wired with the unified streams (stdout + Sentry + OTel). */
  logger: Logger;
  /**
   * Drain logger + Sentry buffers. Always resolves; never throws — both
   * underlying flushes are wrapped in a `try/catch` so a worker can call
   * `await flush()` from a shutdown handler without extra guards.
   */
  flush: () => Promise<void>;
}

function dsnPresent(dsn: string | undefined): dsn is string {
  return dsn !== undefined && dsn !== '';
}

export function initWorker(cfg: WorkerBootstrapConfig): WorkerBootstrap {
  const sentryConfig: Parameters<typeof initSentry>[0] = {
    serviceName: cfg.serviceName,
    environment: cfg.environment,
  };
  if (cfg.sentryDsn !== undefined) {
    sentryConfig.dsn = cfg.sentryDsn;
  }
  if (cfg.tracesSampleRate !== undefined) {
    sentryConfig.tracesSampleRate = cfg.tracesSampleRate;
  }
  const release = cfg.release ?? defaultRelease();
  if (release !== undefined && release !== '') {
    sentryConfig.release = release;
  }

  initSentry(sentryConfig);

  const logger = createAppLogger({ name: cfg.serviceName });

  if (dsnPresent(cfg.sentryDsn) && cfg.extraLogStreamTags !== undefined) {
    for (const [key, value] of Object.entries(cfg.extraLogStreamTags)) {
      Sentry.setTag(key, value);
    }
  }

  const flush = async (): Promise<void> => {
    try {
      // Pino exposes flush on most logger types; silent loggers may not.
      const maybeFlush = (logger as unknown as { flush?: () => unknown }).flush;
      if (typeof maybeFlush === 'function') {
        await maybeFlush.call(logger);
      }
    } catch {
      // swallow — flush must always resolve
    }

    if (dsnPresent(cfg.sentryDsn)) {
      try {
        await Sentry.flush(2000);
      } catch {
        // swallow — flush must always resolve
      }
    }
  };

  return { logger, flush };
}
