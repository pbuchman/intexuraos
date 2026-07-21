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

const COARSE_DIAGNOSTIC_HEADERS = ['content-type', 'content-length'] as const;
const AUTHENTICATION_HEADERS = ['authorization', 'x-internal-auth'] as const;
const REDACTED_HEADER_VALUE = '[REDACTED]';

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
    const fastifyError = error as { code?: string; statusCode?: number };

    // Rate-limit short-circuit: respond with RATE_LIMITED before logging to
    // Sentry. 429s are expected operational events (e.g. @fastify/rate-limit),
    // not exceptions worth capturing.
    if (fastifyError.statusCode === 429) {
      const message = error.message.length > 0 ? error.message : 'Rate limit exceeded';
      reply.status(429);
      await fastifyReply.fail('RATE_LIMITED', message);
      return;
    }

    // Fastify request parsing and schema validation errors are client/input
    // failures. Return a structured 4xx without promoting them to Sentry issues.
    if (
      fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      fastifyError.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      request.log.info({ err: error }, 'Invalid JSON request body');
      reply.status(400);
      await fastifyReply.fail('INVALID_REQUEST', 'Invalid JSON body');
      return;
    }

    if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      request.log.info({ err: error }, 'Unsupported request media type');
      reply.status(400);
      await fastifyReply.fail('INVALID_REQUEST', error.message);
      return;
    }

    if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      request.log.info({ err: error }, 'Request body too large');
      await reply.status(413).send({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Request body too large',
        },
        diagnostics: {
          requestId: 'requestId' in request ? request.requestId : '',
          durationMs:
            'startTime' in request && typeof request.startTime === 'number'
              ? Date.now() - request.startTime
              : 0,
        },
      });
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

        request.log.info({ err: error }, 'Request validation failed');
        reply.status(400);
        await fastifyReply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
        return;
      }
    }

    // Log to Pino FIRST - this is our reliable error log
    request.log.error({ err: error }, 'Unhandled error');

    // Try to send to Sentry, but don't let it break error handling
    try {
      const safeRoute = getSafeRequestRoute(request);
      Sentry.withScope((scope) => {
        scope.setTag('url', safeRoute);
        scope.setTag('method', request.method);
        scope.setContext('request', {
          url: safeRoute,
          method: request.method,
          headers: sanitizeHeaders(request.headers),
        });
        Sentry.captureException(error);
      });
    } catch (sentryError) {
      // Log that Sentry failed but don't crash the error handler
      request.log.warn({ err: sentryError }, 'Failed to send error to Sentry');
    }

    // Return error response
    reply.status(500);
    await fastifyReply.fail('INTERNAL_ERROR', 'Internal error');
  });
}

function getSafeRequestRoute(request: { routeOptions: { url: string | undefined } }): string {
  const routeTemplate = request.routeOptions.url;
  return typeof routeTemplate === 'string' && routeTemplate.length > 0
    ? routeTemplate
    : 'unmatched_route';
}

/**
 * Select the only request headers safe enough for telemetry.
 */
function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};

  for (const header of COARSE_DIAGNOSTIC_HEADERS) {
    const value = headers[header];
    if (typeof value === 'string') {
      safeHeaders[header] = value;
    }
  }

  for (const header of AUTHENTICATION_HEADERS) {
    if (headers[header] !== undefined) {
      safeHeaders[header] = REDACTED_HEADER_VALUE;
    }
  }

  return safeHeaders;
}
