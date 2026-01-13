/**
 * @intexuraos/infra-sentry
 *
 * Sentry integration for IntexuraOS services.
 *
 * ## Usage
 *
 * ```ts
 * import { initSentry, createSentryTransport, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 *
 * // 1. Initialize Sentry at entry point (index.ts)
 * initSentry({
 *   dsn: process.env['INTEXURAOS_SENTRY_DSN'],
 *   environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
 *   serviceName: 'my-service',
 * });
 *
 * // 2. Add Pino transport in server.ts
 * const app = Fastify({
 *   logger: {
 *     level: 'info',
 *     transport: createSentryTransport(),
 *   },
 * });
 *
 * // 3. Replace error handler
 * setupSentryErrorHandler(app);
 * ```
 *
 * All `log.error()` and `log.warn()` calls will now be sent to Sentry.
 */

export { initSentry, type SentryConfig } from './init.js';
export { createSentryTransport } from './transport.js';
export { setupSentryErrorHandler } from './fastify.js';
