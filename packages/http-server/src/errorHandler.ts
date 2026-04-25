/**
 * Fastify error handler aware of {@link IntexuraOSError}.
 *
 * Plan §8 (docs/plans/2026-04-24-INT-1538-observability-unification.md):
 * - `IntexuraOSError` → reply `{ code, message, details? }` with
 *   `err.httpStatus`; do NOT forward to Sentry when `httpStatus < 500`.
 * - Any other error → reply `{ code: 'INTERNAL_ERROR', message: 'Internal
 *   Server Error' }` with `500`; forward to Sentry.
 * - Always log with the structured `err` key and include `requestId` from
 *   the active request context.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { getRequestId, IntexuraOSError } from '@intexuraos/common-core';
// Module side-effect: augments FastifyReply with `.fail()`.
import '@intexuraos/common-http';

/**
 * Options for {@link createErrorHandler}.
 */
export interface CreateErrorHandlerOptions {
  /**
   * Optional Sentry forwarder. Called with the original error whenever the
   * effective HTTP status is `>= 500` (i.e. server-side failures only).
   *
   * Wrapping in a callback keeps `@intexuraos/http-server` free of a hard
   * dependency on `@sentry/node` while still letting callers wire Sentry in.
   */
  captureException?: (error: unknown) => void;
}

/**
 * Create a Fastify error handler implementing plan §8.
 */
export function createErrorHandler(
  options: CreateErrorHandlerOptions = {}
): (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { captureException } = options;

  return async (
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const requestId = getRequestId();

    if (error instanceof IntexuraOSError) {
      const status = error.httpStatus;

      request.log.error(
        { err: error, requestId, code: error.code, statusCode: status },
        'Request failed'
      );

      if (status >= 500 && captureException !== undefined) {
        captureException(error);
      }

      // `reply.fail()` (from `@intexuraos/common-http`'s Fastify augmentation)
      // already calls `.status(ERROR_HTTP_STATUS[code]).send(...)` internally,
      // so we do not set the status here.
      await reply.fail(error.code, error.message, undefined, error.details);
      return;
    }

    request.log.error({ err: error, requestId }, 'Unhandled error');

    if (captureException !== undefined) {
      captureException(error);
    }

    // `reply.fail('INTERNAL_ERROR', ...)` resolves to status 500 via
    // `ERROR_HTTP_STATUS` — no explicit `reply.status(...)` needed.
    await reply.fail('INTERNAL_ERROR', 'Internal Server Error');
  };
}
