import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';

/**
 * Validates authentication for PubSub push or internal requests.
 * - PubSub push requests: validated via OIDC by Cloud Run (identified by from: noreply@google.com)
 * - Direct service calls: validated via x-internal-auth header
 */
export async function validatePubSubOrInternalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  endpointLog?: string
): Promise<boolean> {
  const fromHeader = request.headers.from;
  const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

  if (isPubSubPush) {
    request.log.info(
      { from: fromHeader, userAgent: request.headers['user-agent'] },
      'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
    );
    return true;
  }

  const authResult = validateInternalAuth(request);
  if (!authResult.valid) {
    /* v8 ignore start -- ts-type: endpointLog always provided in practice @preserve */
    const endpoint = endpointLog ?? 'endpoint';
    /* v8 ignore stop @preserve */
    request.log.warn({ reason: authResult.reason }, `Internal auth failed for ${endpoint}`);
    await reply.fail('UNAUTHORIZED', `Internal auth failed for ${endpoint}`);
    return false;
  }

  return true;
}
