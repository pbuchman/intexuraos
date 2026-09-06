import type { FastifyRequest } from 'fastify';

const ENV_CURRENT = 'INTEXURAOS_INTERNAL_AUTH_TOKEN';
const HEADER = 'x-internal-auth';
// Keep common-http independent of infra-sentry; this string mirrors SKIP_SENTRY_KEY.
const SKIP_SENTRY_KEY = '_skipSentry';

export interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
  tokenUsed?: 'current';
}

/**
 * Validate internal service-to-service authentication.
 *
 * Reads exactly one INTEXURAOS_INTERNAL_AUTH_TOKEN at runtime. Old-token
 * fallback is intentionally unsupported: the security cutover stops every
 * caller and restarts the complete runtime with one new value.
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

  request.log.warn({ [SKIP_SENTRY_KEY]: true }, 'Internal auth failed: token mismatch');
  return { valid: false, reason: 'token_mismatch' };
}
