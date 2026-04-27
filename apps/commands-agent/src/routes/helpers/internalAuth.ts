import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';
import {
  createGoogleOidcVerifier,
  type GoogleOidcVerifier,
} from '@intexuraos/internal-clients';

export type InternalAuthStrategy = 'pubsub-oidc' | 'scheduler-oidc' | 'internal-token';

let cachedVerifier: GoogleOidcVerifier | undefined;
let cachedAudience: string | undefined;

/**
 * Lazy-initialize the verifier so that tests (which set/unset env vars per-test)
 * always read the latest INTEXURAOS_SERVICE_URL. The factory caches the JWKS
 * fetcher internally; we cache the returned verifier per audience so that env
 * changes (test scenarios) invalidate the cache.
 */
function getVerifier(): GoogleOidcVerifier {
  const audience = process.env['INTEXURAOS_SERVICE_URL'] ?? '';
  if (cachedVerifier === undefined || cachedAudience !== audience) {
    cachedAudience = audience;
    cachedVerifier = createGoogleOidcVerifier({ audience });
  }
  return cachedVerifier;
}

/**
 * Authenticate a PubSub push request.
 * - Pub/Sub push requests have `from: noreply@google.com` header (OIDC validated by Cloud Run)
 * - Direct service calls use `x-internal-auth` header
 */
export function authenticateInternalPubSub(
  request: FastifyRequest
): { authenticated: true; strategy: InternalAuthStrategy } | { authenticated: false } {
  const fromHeader = request.headers.from;
  const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

  if (isPubSubPush) {
    // Pub/Sub push: Cloud Run already validated OIDC token before request reached us
    return { authenticated: true, strategy: 'pubsub-oidc' };
  }

  // Direct service call: validate x-internal-auth header
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    return { authenticated: false };
  }

  return { authenticated: true, strategy: 'internal-token' };
}

/**
 * Authenticate a Cloud Scheduler request.
 *
 * Two paths:
 * 1. `Authorization: Bearer <Google-signed OIDC token>` — verified against
 *    Google's JWKS with `audience = INTEXURAOS_SERVICE_URL` (this service's
 *    own Cloud Run URL). Used by Cloud Scheduler with OIDC tokens.
 * 2. `x-internal-auth: <shared secret>` — fallback for direct service-to-service
 *    calls during dev/staging.
 *
 * Returns `authenticated: false` for any malformed, expired, audience-mismatched,
 * or otherwise invalid token.
 */
export async function authenticateInternalScheduler(
  request: FastifyRequest
): Promise<
  | { authenticated: true; strategy: InternalAuthStrategy; subject?: string }
  | { authenticated: false }
> {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const result = await getVerifier()(authHeader);
    if (result.valid) {
      return { authenticated: true, strategy: 'scheduler-oidc', subject: result.subject };
    }
    request.log.warn({ reason: result.reason }, 'Scheduler OIDC verification failed');
    return { authenticated: false };
  }

  // Direct service call: validate x-internal-auth header
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    return { authenticated: false };
  }

  return { authenticated: true, strategy: 'internal-token' };
}
