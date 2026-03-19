import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';

export type InternalAuthStrategy = 'scheduler-oidc' | 'internal-token';

/**
 * Authenticate a Cloud Scheduler request.
 *
 * SECURITY NOTE: The OIDC token is NOT validated at the application layer. In production,
 * Cloud Run validates the OIDC token at the infrastructure level before the request reaches
 * this handler. In the current Terraform config, code-agent uses allow_unauthenticated=true
 * (required for external webhooks), so this OIDC trust relies on Cloud Run's ingress settings
 * and IAM invoker configuration — NOT on the Bearer header alone. If Cloud Run ingress is
 * changed to allow all traffic, endpoints using this helper would need application-level OIDC
 * validation.
 *
 * For defense in depth, direct internal callers should prefer the x-internal-auth header path.
 */
export function authenticateInternalScheduler(
  request: FastifyRequest
): { authenticated: true; strategy: InternalAuthStrategy } | { authenticated: false } {
  const authHeader = request.headers.authorization;
  const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

  if (isOidcAuth) {
    return { authenticated: true, strategy: 'scheduler-oidc' };
  }

  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    return { authenticated: false };
  }

  return { authenticated: true, strategy: 'internal-token' };
}
