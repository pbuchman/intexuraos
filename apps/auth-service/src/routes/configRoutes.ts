/**
 * Auth Configuration Routes
 *
 * GET /auth/config - Get non-secret auth configuration
 */

import type { FastifyPluginCallback } from 'fastify';
import type { AuthConfigResponse } from './schemas.js';
import { loadAuth0Config } from './shared.js';

export const configRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /auth/config
  fastify.get(
    '/auth/config',
    {
      schema: {
        operationId: 'getAuthConfig',
        summary: 'Get auth configuration',
        description: 'Get non-secret auth configuration for troubleshooting.',
        tags: ['auth'],
        response: {
          200: {
            description: 'Auth configuration',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  issuer: { type: 'string' },
                  audience: { type: 'string' },
                  jwksUrl: { type: 'string' },
                },
                required: ['domain', 'issuer', 'audience', 'jwksUrl'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          503: {
            description: 'Service misconfigured',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH_AUDIENCE.'
        );
      }

      const data: AuthConfigResponse = {
        domain: config.domain,
        issuer: config.issuer,
        audience: config.audience,
        jwksUrl: config.jwksUrl,
      };

      return await reply.ok(data);
    }
  );

  done();
};
