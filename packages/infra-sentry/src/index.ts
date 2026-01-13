/**
 * @intexuraos/infra-sentry
 *
 * Sentry integration for IntexuraOS services.
 *
 * ## Usage
 *
 * ```ts
 * import { initSentry, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 *
 * // 1. Initialize Sentry at entry point (index.ts)
 * initSentry({
 *   dsn: process.env['INTEXURAOS_SENTRY_DSN'],
 *   environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
 *   serviceName: 'my-service',
 * });
 *
 * // 2. Replace error handler in server.ts
 * setupSentryErrorHandler(app);
 * ```
 *
 * All unhandled errors will now be sent to Sentry.
 * For manual error reporting, use the `sendToSentry()` function.
 */

export { initSentry, type SentryConfig } from './init.js';
export { createSentryTransport, sendToSentry } from './transport.js';
export { setupSentryErrorHandler } from './fastify.js';
