import type { FastifyRequest } from 'fastify';

const ENV_VAR = 'INTEXURAOS_INTERNAL_AUTH_TOKEN';
const HEADER = 'x-internal-auth';

export interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
}

/**
 * Validate internal service-to-service authentication.
 * Reads INTEXURAOS_INTERNAL_AUTH_TOKEN at runtime to support test injection.
 *
 * @param request - Fastify request object
 * @returns Object with valid boolean and optional reason for failure
 */
export function validateInternalAuth(request: FastifyRequest): InternalAuthResult {
  const internalAuthToken = process.env[ENV_VAR] ?? '';
  if (internalAuthToken === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return { valid: false, reason: 'not_configured' };
  }
  const authHeader = request.headers[HEADER];
  if (authHeader !== internalAuthToken) {
    request.log.warn('Internal auth failed: token mismatch');
    return { valid: false, reason: 'token_mismatch' };
  }
  return { valid: true };
}
