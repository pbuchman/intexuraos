/**
 * Shared authentication strategies for internal traffic.
 *
 * Historically each app that consumed Cloud Scheduler / Pub/Sub push traffic
 * defined its own copy of these helpers (`apps/code-agent/.../internalAuth.ts`,
 * `apps/commands-agent/.../internalAuth.ts`, `apps/actions-agent/.../pubsubAuth.ts`,
 * etc.). They drifted into subtly different shapes despite covering the same
 * threat model. This module is the single home; consumers import from
 * `@intexuraos/common-http` rather than copy-pasting the helper.
 */
import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from './internalAuth.js';

export type InternalAuthStrategy = 'pubsub-oidc' | 'scheduler-oidc' | 'internal-token';

export type AuthResult =
  | { authenticated: true; strategy: InternalAuthStrategy }
  | { authenticated: false };

/**
 * Authenticate a Cloud Scheduler request.
 *
 * Cloud Scheduler attaches an OIDC bearer token; in production Cloud Run
 * validates that token at the infrastructure layer before the request reaches
 * the application. We accept a `Bearer …` Authorization header as proof of
 * scheduler-OIDC, otherwise we fall through to the shared
 * `INTEXURAOS_INTERNAL_AUTH_TOKEN` header strategy used by direct
 * service-to-service calls.
 */
export function authenticateInternalScheduler(request: FastifyRequest): AuthResult {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return { authenticated: true, strategy: 'scheduler-oidc' };
  }
  const result = validateInternalAuth(request);
  if (!result.valid) {
    return { authenticated: false };
  }
  return { authenticated: true, strategy: 'internal-token' };
}

/**
 * Authenticate a Pub/Sub push request.
 *
 * Pub/Sub push delivery sets `from: noreply@google.com` and (in production)
 * Cloud Run validates the OIDC token before invoking the handler. Direct
 * service-to-service calls fall back to the shared internal-auth header
 * strategy.
 */
export function authenticateInternalPubSub(request: FastifyRequest): AuthResult {
  const fromHeader = request.headers.from;
  if (typeof fromHeader === 'string' && fromHeader === 'noreply@google.com') {
    return { authenticated: true, strategy: 'pubsub-oidc' };
  }
  const result = validateInternalAuth(request);
  if (!result.valid) {
    return { authenticated: false };
  }
  return { authenticated: true, strategy: 'internal-token' };
}
