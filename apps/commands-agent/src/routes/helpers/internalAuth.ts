import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';

export type InternalAuthStrategy = 'pubsub-oidc' | 'scheduler-oidc' | 'internal-token';

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
 * - Cloud Scheduler uses OIDC tokens (validated by Cloud Run at infrastructure level)
 * - Direct service calls use `x-internal-auth` header
 */
export function authenticateInternalScheduler(
  request: FastifyRequest
): { authenticated: true; strategy: InternalAuthStrategy } | { authenticated: false } {
  const authHeader = request.headers.authorization;
  const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

  if (isOidcAuth) {
    // OIDC token validated by Cloud Run
    return { authenticated: true, strategy: 'scheduler-oidc' };
  }

  // Direct service call: validate x-internal-auth header
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    return { authenticated: false };
  }

  return { authenticated: true, strategy: 'internal-token' };
}
