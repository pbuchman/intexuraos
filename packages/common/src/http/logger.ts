/**
 * Shared logger configuration for Fastify services.
 *
 * Provides consistent logging behavior across all services:
 * - Suppresses health check endpoint logs (Cloud Run probes)
 * - Uses JSON format in production
 */
import type { FastifyInstance } from 'fastify';

/**
 * Paths that should not be logged (e.g., health checks from Cloud Run).
 */
const SILENT_PATHS = new Set(['/health']);

/**
 * Hook to determine if a request should be logged.
 * Returns false for health check endpoints to suppress logging.
 */
export function shouldLogRequest(url: string | undefined): boolean {
  if (url === undefined) return true;
  // Extract path without query string
  const path = url.split('?')[0];
  return path === undefined || !SILENT_PATHS.has(path);
}

/**
 * Registers request logging hooks that skip health check endpoints.
 * Use this after creating the Fastify instance with `disableRequestLogging: true`.
 *
 * @example
 * const app = Fastify({
 *   logger: true,
 *   disableRequestLogging: true,
 * });
 * registerQuietHealthCheckLogging(app);
 */
export function registerQuietHealthCheckLogging(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (shouldLogRequest(request.url)) {
      request.log.info(
        {
          req: {
            method: request.method,
            url: request.url,
            host: request.headers.host,
            remoteAddress: request.ip,
          },
        },
        'incoming request'
      );
    }
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    if (shouldLogRequest(request.url)) {
      request.log.info(
        {
          res: { statusCode: reply.statusCode },
          responseTime: reply.elapsedTime,
        },
        'request completed'
      );
    }
    done();
  });
}
