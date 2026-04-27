/**
 * Sentry initialization for IntexuraOS services.
 *
 * Call `initSentry()` at the top of your service's entry point (index.ts)
 * before any other imports or initialization.
 */

import * as Sentry from '@sentry/node';
import { redactObject } from './redact.js';

export interface SentryConfig {
  /** Sentry DSN from environment variable or config */
  dsn?: string;
  /** Environment name (e.g., 'development', 'production') */
  environment?: string;
  /** Service name for Sentry dashboard filtering */
  serviceName: string;
  /** Tracing sample rate (0 = disabled, 1 = 100%). Defaults to 0.1 in production, 0 elsewhere. */
  tracesSampleRate?: number;
  /**
   * Release identifier (e.g., Cloud Run revision). Defaults to `process.env['K_REVISION']`
   * when set and non-empty.
   */
  release?: string;
}

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type SentryEvent = Parameters<NonNullable<SentryInitOptions['beforeSend']>>[0];

/**
 * Resolve the default Sentry `release` from the runtime environment.
 *
 * Cloud Run injects `K_REVISION` on every revision. When unset (e.g. local
 * dev) we leave the field undefined so Sentry can fall back to its own
 * defaults rather than tagging events with a misleading value.
 *
 * Exported because `initWorker` also needs the same fallback semantics — keep
 * the rule in one place so future additions (e.g. git-sha fallback) only need
 * to land here.
 */
export function defaultRelease(): string | undefined {
  const rev = process.env['K_REVISION'];
  if (rev === undefined || rev === '') {
    return undefined;
  }
  return rev;
}

function defaultTracesSampleRate(environment: string | undefined): number {
  return environment === 'production' ? 0.1 : 0;
}

/**
 * Build the `beforeSend` hook applied to every outbound Sentry event.
 *
 * - Drops events whose response status_code is a number `< 500` (e.g. 4xx
 *   client errors that we don't want to alert on).
 * - Otherwise returns a copy with `extra`, `contexts` and `breadcrumbs[*].data`
 *   passed through `redactObject` so PII / secrets never leave the process.
 */
function buildBeforeSend(): NonNullable<SentryInitOptions['beforeSend']> {
  return (event) => {
    // The status-code drop MUST run before redaction. `status_code` is not in
    // `SENTRY_REDACT_KEYS` today, but reading it after `redactObject` would
    // make the drop logic silently break if a future contributor added it.
    const statusCode = (event.contexts?.response as { status_code?: unknown } | undefined)
      ?.status_code;
    if (typeof statusCode === 'number' && statusCode < 500) {
      return null;
    }

    const next: SentryEvent = { ...event };
    if (event.extra !== undefined) {
      next.extra = redactObject(event.extra);
    }
    if (event.contexts !== undefined) {
      next.contexts = redactObject(event.contexts);
    }
    if (Array.isArray(event.breadcrumbs)) {
      next.breadcrumbs = event.breadcrumbs.map((bc) => {
        if (bc.data === undefined) {
          return bc;
        }
        return { ...bc, data: redactObject(bc.data) };
      });
    }
    return next;
  };
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
  if (config.dsn === undefined || config.dsn === '') {
    return;
  }

  const tracesSampleRate = config.tracesSampleRate ?? defaultTracesSampleRate(config.environment);

  const release = config.release ?? defaultRelease();

  const options: SentryInitOptions = {
    dsn: config.dsn,
    serverName: config.serviceName,
    sendDefaultPii: false,
    tracesSampleRate,
    beforeSend: buildBeforeSend(),
  };

  if (config.environment !== undefined) {
    options.environment = config.environment;
  }

  if (release !== undefined) {
    options.release = release;
  }

  Sentry.init(options);

  const runtime = process.env['INTEXURAOS_RUNTIME'];
  if (runtime !== undefined && runtime !== '') {
    Sentry.setTag('runtime', runtime);
  }
}
