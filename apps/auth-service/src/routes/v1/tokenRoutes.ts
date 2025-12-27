/**
 * Token Management Routes
 *
 * POST /v1/auth/refresh - Refresh access token using stored refresh token
 */

import type { FastifyPluginCallback } from 'fastify';
import { isErr, handleValidationError } from '@intexuraos/common';
import type { AuthTokens } from '../../domain/identity/index.js';
import { refreshTokenRequestSchema } from './schemas.js';
import { loadAuth0Config } from './shared.js';
import { getServices } from '../../services.js';

export const tokenRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/auth/refresh
  fastify.post(
    '/v1/auth/refresh',
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
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID.'
        );
      }

      const parseResult = refreshTokenRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { userId } = parseResult.data;

      try {
        const { authTokenRepository, auth0Client } = getServices();

        if (auth0Client === null) {
          return await reply.fail(
            'MISCONFIGURED',
            'Auth0 is not configured for refresh operations.'
          );
        }

        // Get stored refresh token
        const refreshTokenResult = await authTokenRepository.getRefreshToken(userId);
        if (isErr(refreshTokenResult)) {
          return await reply.fail(
            'INTERNAL_ERROR',
            `Failed to retrieve refresh token: ${refreshTokenResult.error.message}`
          );
        }

        // After isErr check, result must be successful
        const refreshToken = (refreshTokenResult as { ok: true; value: string | null }).value;
        if (refreshToken === null) {
          return await reply.fail(
            'UNAUTHORIZED',
            'No refresh token found. User must re-authenticate.'
          );
        }

        // Refresh access token
        const refreshResult = await auth0Client.refreshAccessToken(refreshToken);
        if (isErr(refreshResult)) {
          const error = refreshResult.error;

          // If invalid_grant, delete stored token and require reauth
          if (error.code === 'INVALID_GRANT') {
            await authTokenRepository.deleteTokens(userId);
            return await reply.fail(
              'UNAUTHORIZED',
              'Refresh token is invalid or expired. User must re-authenticate.'
            );
          }

          return await reply.fail('DOWNSTREAM_ERROR', `Token refresh failed: ${error.message}`);
        }

        if (!refreshResult.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Unexpected error state');
        }

        const newTokens = refreshResult.value;

        // Store updated tokens (including new refresh token if rotation enabled)
        const tokensToStore: AuthTokens = {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken ?? refreshToken,
          tokenType: newTokens.tokenType,
          expiresIn: newTokens.expiresIn,
          scope: newTokens.scope,
          idToken: newTokens.idToken,
        };

        const saveResult = await authTokenRepository.saveTokens(userId, tokensToStore);
        if (isErr(saveResult)) {
          fastify.log.warn(
            { userId, errorMessage: saveResult.error.message },
            'Failed to save refreshed tokens'
          );
        }

        // Return access token to client (never return refresh token in response)
        return await reply.ok({
          access_token: newTokens.accessToken,
          token_type: newTokens.tokenType,
          expires_in: newTokens.expiresIn,
          scope: newTokens.scope,
          id_token: newTokens.idToken,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return await reply.fail('INTERNAL_ERROR', `Token refresh failed: ${message}`);
      }
    }
  );

  done();
};
