/**
 * Sentry initialization for IntexuraOS services.
 *
 * Call `initSentry()` at the top of your service's entry point (index.ts)
 * before any other imports or initialization.
 */

import * as Sentry from '@sentry/node';

export interface SentryConfig {
  /** Sentry DSN from environment variable or config */
  dsn?: string;
  /** Environment name (e.g., 'development', 'production') */
  environment?: string;
  /** Service name for Sentry dashboard filtering */
  serviceName: string;
  /** Tracing sample rate (0 = disabled, 1 = 100%) */
  tracesSampleRate?: number;
}

/**
 * Initialize Sentry SDK for the service.
 *
 * If no DSN is provided, logs a warning and returns early (non-breaking).
 *
 * @example
 * ```ts
 * import { initSentry } from '@intexuraos/infra-sentry';
 *
 * initSentry({
 *   dsn: process.env['INTEXURAOS_SENTRY_DSN'],
 *   environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
 *   serviceName: 'research-agent',
 * });
 * ```
 */
export function initSentry(config: SentryConfig): void {
  if (!config.dsn) {
    console.warn('[Sentry] No DSN provided, skipping initialization');
    return;
  }

  const options: {
    dsn: string;
    serverName: string;
    sendDefaultPii: boolean;
    tracesSampleRate: number;
    environment?: string;
  } = {
    dsn: config.dsn,
    serverName: config.serviceName,
    sendDefaultPii: false,
    tracesSampleRate: config.tracesSampleRate ?? 0,
  };

  if (config.environment !== undefined) {
    options.environment = config.environment;
  }

  Sentry.init(options);
}
