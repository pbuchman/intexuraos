/**
 * Token Management Routes
 *
 * POST /auth/refresh - Refresh access token using stored refresh token
 */

import type { FastifyPluginCallback } from 'fastify';
import { handleValidationError } from '@intexuraos/common-http';
import { refreshAccessToken, type RefreshAccessTokenErrorCode } from '../domain/identity/index.js';
import { refreshTokenRequestSchema } from './schemas.js';
import { loadAuth0Config } from './shared.js';
import { getServices } from '../services.js';

/**
 * Map domain error codes to HTTP error codes.
 */
function mapErrorCode(
  code: RefreshAccessTokenErrorCode
): 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' | 'INTERNAL_ERROR' {
  switch (code) {
    case 'NOT_FOUND':
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'DOWNSTREAM_ERROR':
      return 'DOWNSTREAM_ERROR';
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR';
  }
}

export const tokenRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /auth/refresh
  fastify.post(
    '/auth/refresh',
    {
      schema: {
        operationId: 'refreshToken',
        summary: 'Refresh access token',
        description: 'Refresh access token using stored refresh token.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', minLength: 1, description: 'User ID (from JWT sub claim)' },
          },
        },
        response: {
          200: {
            description: 'Token refreshed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  access_token: { type: 'string' },
                  token_type: { type: 'string' },
                  expires_in: { type: 'number' },
                  scope: { type: 'string' },
                  id_token: { type: 'string' },
                },
                required: ['access_token', 'token_type', 'expires_in'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Refresh token invalid or not found - re-authentication required',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
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
    async (request, reply) => {
      // Validate configuration
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID.'
        );
      }

      // Parse request
      const parseResult = refreshTokenRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { userId } = parseResult.data;
      const { authTokenRepository, auth0Client } = getServices();

      // Validate Auth0 client is available
      if (auth0Client === null) {
        return await reply.fail('MISCONFIGURED', 'Auth0 is not configured for refresh operations.');
      }

      // Execute use-case
      const result = await refreshAccessToken(
        { userId },
        {
          authTokenRepository,
          auth0Client,
          logger: {
            warn: (obj, msg): void => {
              fastify.log.warn(obj, msg);
            },
          },
        }
      );

      // Map result to HTTP response
      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        access_token: result.value.accessToken,
        token_type: result.value.tokenType,
        expires_in: result.value.expiresIn,
        scope: result.value.scope,
        id_token: result.value.idToken,
      });
    }
  );

  done();
};
