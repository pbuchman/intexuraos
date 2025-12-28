/**
 * Validation error handler for Fastify.
 * Converts Fastify validation errors to IntexuraOS envelope format.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Type guard for Fastify validation errors.
 */
function isValidationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray((error as { validation?: unknown }).validation)
  );
}

/**
 * Create a Fastify error handler that returns validation errors in IntexuraOS envelope.
 *
 * Usage:
 *   app.setErrorHandler(createValidationErrorHandler());
 */
export function createValidationErrorHandler(): (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void> {
  return async (
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (isValidationError(error)) {
      const validation = (
        error as {
          validation: {
            instancePath?: string;
            params?: { missingProperty?: string };
            message?: string;
          }[];
          message?: string;
        }
      ).validation;

      const errors = validation.map((v) => {
        const rawPath = (v.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
        // When a required top-level property is missing, instancePath="" and missingProperty has the field name
        const path = rawPath === '' ? (v.params?.missingProperty ?? 'body') : rawPath;

        return {
          path,
          message: v.message ?? 'Invalid value',
        };
      });

      reply.status(400);
      await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
        errors,
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    reply.status(500);
    await reply.fail('INTERNAL_ERROR', 'Internal error');
  };
}
