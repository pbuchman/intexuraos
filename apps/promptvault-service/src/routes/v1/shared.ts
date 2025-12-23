import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import type { PromptVaultErrorCode } from '../../domain/promptvault/index.js';

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

/**
 * Map domain error codes to HTTP error codes.
 */
export function mapDomainErrorCode(
  code: PromptVaultErrorCode
): 'NOT_FOUND' | 'MISCONFIGURED' | 'DOWNSTREAM_ERROR' | 'INVALID_REQUEST' | 'UNAUTHORIZED' {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'NOT_CONNECTED':
      return 'MISCONFIGURED';
    case 'VALIDATION_ERROR':
      return 'INVALID_REQUEST';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    default:
      return 'DOWNSTREAM_ERROR';
  }
}
