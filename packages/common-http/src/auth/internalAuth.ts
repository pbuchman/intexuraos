import type { FastifyRequest } from 'fastify';

const ENV_CURRENT = 'INTEXURAOS_INTERNAL_AUTH_TOKEN';
const ENV_PREVIOUS = 'INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS';
const HEADER = 'x-internal-auth';

export interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
  tokenUsed?: 'current' | 'previous';
}

/**
 * Validate internal service-to-service authentication.
 *
 * Reads INTEXURAOS_INTERNAL_AUTH_TOKEN (current) and the optional
 * INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS (previous) at runtime to
 * support a 24h rotation window where both tokens are accepted.
 *
 * Acceptance order:
 * 1. CURRENT must be configured. If empty → `not_configured`.
 * 2. Header matches CURRENT → accept (`tokenUsed: 'current'`).
 * 3. PREVIOUS is non-empty AND header matches PREVIOUS → accept
 *    (`tokenUsed: 'previous'`) and emit a warn-level log so operators
 *    can observe rotation traffic and tighten the window.
 * 4. Otherwise → `token_mismatch`.
 *
 * @param request - Fastify request object
 * @returns Object with valid boolean, optional reason for failure, and
 *          optional tokenUsed marker on success.
 */
export function validateInternalAuth(request: FastifyRequest): InternalAuthResult {
  const current = process.env[ENV_CURRENT] ?? '';
  if (current === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return { valid: false, reason: 'not_configured' };
  }

  const authHeader = request.headers[HEADER];
  if (authHeader === current) {
    return { valid: true, tokenUsed: 'current' };
  }

  const previous = process.env[ENV_PREVIOUS] ?? '';
  if (previous !== '' && authHeader === previous) {
    request.log.warn('Internal auth: PREVIOUS token accepted (rotation window active)');
    return { valid: true, tokenUsed: 'previous' };
  }

  request.log.warn('Internal auth failed: token mismatch');
  return { valid: false, reason: 'token_mismatch' };
}
