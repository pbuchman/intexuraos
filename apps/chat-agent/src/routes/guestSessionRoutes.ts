/**
 * Guest Session Routes
 *
 * POST /guest-session — issue a server-signed guest session token.
 *
 * The returned token is an HS256 JWT bound to a server-generated opaque sub
 * claim. Clients must include the token as the `X-Guest-Session` header on
 * subsequent /chat calls; the route verifies the signature and rate-limits
 * by the verified sub, so rotating the header value cannot bypass the limit.
 *
 * This endpoint is unauthenticated (guests must be able to call it) but is
 * protected by an IP-based rate limit registered via @fastify/rate-limit at
 * the server level.
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const guestSessionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/guest-session',
    {
      schema: {
        operationId: 'issueGuestSession',
        summary: 'Issue a signed guest session token',
        description:
          'Returns a short-lived signed guest session token. The client MUST send this token as the X-Guest-Session header on subsequent /chat calls.',
        tags: ['chat'],
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['sessionToken', 'expiresAt'],
                properties: {
                  sessionToken: { type: 'string' },
                  expiresAt: { type: 'number' },
                },
              },
            },
          },
        },
      },
      config: {
        // Stricter IP-based limit for session minting (see server.ts).
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /guest-session',
      });
      const issued = await getServices().guestSessionSigner.issue();
      return await reply.ok({
        sessionToken: issued.token,
        expiresAt: issued.expiresAt,
      });
    }
  );
  done();
};
