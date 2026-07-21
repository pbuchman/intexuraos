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

export interface SentryErrorHandlerOptions {
  /** URL path prefixes whose identifiers, query, headers, and raw errors are private. */
  privatePathPrefixes?: readonly string[];
}

const PRIVATE_REQUEST_FAILED_MESSAGE = 'Private request failed';

function privatePathPrefix(
  url: string,
  privatePathPrefixes: readonly string[]
): string | undefined {
  return privatePathPrefixes.find((prefix) => url.startsWith(prefix));
}

function safeRequestUrl(matchedPrivatePrefix: string): string {
  return `${matchedPrivatePrefix}[REDACTED]`;
}

function errorLogContext(
  error: FastifyError,
  matchedPrivatePrefix: string | undefined,
  code: string
): Readonly<Record<string, unknown>> {
  return matchedPrivatePrefix === undefined
    ? { err: error }
    : { code, privateRequest: true, _skipSentry: true };
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
export function setupSentryErrorHandler(
  app: FastifyInstance,
  options: SentryErrorHandlerOptions = {}
): void {
  const privatePathPrefixes = options.privatePathPrefixes ?? [];
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const fastifyReply = reply as IntexuraFastifyReply;
    const fastifyError = error as { code?: string; statusCode?: number };
    const matchedPrivatePrefix = privatePathPrefix(request.url, privatePathPrefixes);

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
      request.log.info(
        errorLogContext(error, matchedPrivatePrefix, 'INVALID_JSON_BODY'),
        'Invalid JSON request body'
      );
      reply.status(400);
      await fastifyReply.fail('INVALID_REQUEST', 'Invalid JSON body');
      return;
    }

    if (fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      request.log.info(
        errorLogContext(error, matchedPrivatePrefix, 'INVALID_MEDIA_TYPE'),
        'Unsupported request media type'
      );
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

        request.log.info(
          errorLogContext(error, matchedPrivatePrefix, 'VALIDATION_FAILED'),
          'Request validation failed'
        );
        reply.status(400);
        await fastifyReply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
        return;
      }
    }

    // Log to Pino FIRST - this is our reliable error log
    request.log.error(
      errorLogContext(error, matchedPrivatePrefix, 'UNHANDLED_PRIVATE_REQUEST_ERROR'),
      matchedPrivatePrefix === undefined ? 'Unhandled error' : 'Unhandled private request error'
    );

    // Try to send to Sentry, but don't let it break error handling
    try {
      const safeRoute = getSafeRequestRoute(request);
      Sentry.withScope((scope) => {
        const requestUrl =
          matchedPrivatePrefix === undefined ? safeRoute : safeRequestUrl(matchedPrivatePrefix);
        scope.setTag('url', requestUrl);
        scope.setTag('method', request.method);
        scope.setContext('request', {
          url: requestUrl,
          method: request.method,
          headers: sanitizeHeaders(request.headers),
        });
        Sentry.captureException(
          matchedPrivatePrefix === undefined ? error : new Error(PRIVATE_REQUEST_FAILED_MESSAGE)
        );
      });
    } catch (sentryError) {
      // Log that Sentry failed but don't crash the error handler
      request.log.warn(
        matchedPrivatePrefix === undefined
          ? { err: sentryError }
          : { code: 'SENTRY_CAPTURE_FAILED', privateRequest: true, _skipSentry: true },
        'Failed to send error to Sentry'
      );
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
