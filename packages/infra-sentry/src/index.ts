/**
 * @intexuraos/infra-sentry
 *
 * Sentry integration for IntexuraOS services.
 *
 * ## Usage
 *
 * ```ts
 * import { initSentry, createSentryStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 * import pino from 'pino';
 *
 * // 1. Initialize Sentry at entry point (index.ts)
 * initSentry({
 *   dsn: process.env['INTEXURAOS_SENTRY_DSN'],
 *   environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
 *   serviceName: 'my-service',
 * });
 *
 * // 2. In server.ts, configure logger with Sentry stream
 * const app = Fastify({
 *   logger: {
 *     level: 'info',
 *     stream: createSentryStream(
 *       pino.multistream([
 *         pino.destination({ dest: 1, sync: false }), // stdout
 *       ])
 *     ),
 *   },
 * });
 *
 * // 3. Replace error handler
 * setupSentryErrorHandler(app);
 * ```
 *
 * All error/warn/fatal logs will now be sent to Sentry automatically.
 */

export { initSentry, type SentryConfig } from './init.js';
export { createSentryStream, sendToSentry, isSentryConfigured } from './transport.js';
export { setupSentryErrorHandler } from './fastify.js';
