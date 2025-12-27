import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

/**
 * Handle Zod validation errors.
 * Converts Zod errors to standard API error response.
 */
export function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}
