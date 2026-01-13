/**
 * Fastify error handler integration for Sentry.
 *
 * Replaces the default Fastify error handler with one that sends
 * unhandled errors to Sentry before responding to the client.
 *
 * @example
 * ```ts
 * import { setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 *
 * const app = Fastify();
 * setupSentryErrorHandler(app);
 * ```
 */

import * as Sentry from '@sentry/node';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

/**
 * Augmented FastifyReply with .fail() method from common-http.
 */
interface IntexuraFastifyReply extends FastifyReply {
  fail: (code: string, message: string, diagnostics?: unknown, details?: unknown) => FastifyReply;
}

/**
 * Set up Fastify error handler that sends errors to Sentry.
 *
 * This function:
 * 1. Sends the error to Sentry with request context
 * 2. Logs the error via Pino
 * 3. Returns a standardized error response to the client
 *
 * @param app - Fastify instance to configure
 */
export function setupSentryErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const fastifyReply = reply as IntexuraFastifyReply;
    const fastifyError = error as { code?: string };

    // Log to Pino FIRST - this is our reliable error log
    request.log.error({ err: error }, 'Unhandled error');

    // Try to send to Sentry, but don't let it break error handling
    try {
      Sentry.withScope((scope) => {
        scope.setTag('url', request.url);
        scope.setTag('method', request.method);
        scope.setContext('request', {
          url: request.url,
          method: request.method,
          headers: sanitizeHeaders(request.headers),
        });
        Sentry.captureException(error);
      });
    } catch (sentryError) {
      // Log that Sentry failed but don't crash the error handler
      request.log.warn({ err: sentryError }, 'Failed to send error to Sentry');
    }

    // Handle Fastify-specific errors
    if (fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      reply.status(400);
      await fastifyReply.fail('INVALID_REQUEST', 'Invalid JSON body');
      return;
    }

    // Handle validation errors
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      const errorWithValidation = error as {
        validation?: { instancePath?: string; message?: string }[];
      };
      if (Array.isArray(errorWithValidation.validation)) {
        const validation = errorWithValidation.validation;

        const errors = validation.map((v) => {
          let path = (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
          if (path === '') {
            const requiredMatch = /must have required property '([^']+)'/.exec(v.message ?? '');
            path = requiredMatch?.[1] ?? '<root>';
          }

          return {
            path,
            message: v.message ?? 'Invalid value',
          };
        });

        reply.status(400);
        await fastifyReply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
        return;
      }
    }

    // Return error response
    reply.status(500);
    await fastifyReply.fail('INTERNAL_ERROR', 'Internal error');
  });
}

/**
 * Remove sensitive headers before sending to Sentry.
 */
function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const SENSITIVE_HEADERS = ['authorization', 'x-internal-auth', 'cookie', 'x-api-key', 'apikey'];

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.includes(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = value[0] ?? '';
    }
  }
  return sanitized;
}
