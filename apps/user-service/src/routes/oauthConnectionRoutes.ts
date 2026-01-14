/**
 * OAuth Connection Routes
 *
 * POST   /oauth/connections/google/initiate - Start OAuth flow
 * GET    /oauth/connections/google/callback - Handle OAuth callback
 * GET    /oauth/connections/google/status   - Get connection status
 * DELETE /oauth/connections/google          - Disconnect OAuth connection
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  initiateOAuthFlow,
  exchangeOAuthCode,
  disconnectProvider,
  OAuthProviders,
} from '../domain/oauth/index.js';

export const oauthConnectionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /oauth/connections/google/initiate
  fastify.post(
    '/oauth/connections/google/initiate',
    {
      schema: {
        operationId: 'initiateGoogleOAuth',
        summary: 'Initiate Google OAuth flow',
        description: 'Generate authorization URL to redirect user to Google for OAuth consent.',
        tags: ['oauth'],
        response: {
          200: {
            description: 'Authorization URL generated',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  authorizationUrl: { type: 'string' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'OAuth not configured',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /oauth/connections/google/initiate',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { googleOAuthClient } = getServices();

      if (googleOAuthClient === null) {
        return await reply.fail('MISCONFIGURED', 'Google OAuth is not configured');
      }

      const protocol = String(request.headers['x-forwarded-proto'] ?? 'http');
      const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost');
      const redirectUri = `${protocol}://${host}/oauth/connections/google/callback`;

      const result = initiateOAuthFlow(
        { userId: user.userId, provider: OAuthProviders.GOOGLE, redirectUri },
        { googleOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to initiate OAuth flow');
      }

      return await reply.ok({
        authorizationUrl: result.value.authorizationUrl,
      });
    }
  );

  // GET /oauth/connections/google/callback
  fastify.get(
    '/oauth/connections/google/callback',
    {
      schema: {
        operationId: 'handleGoogleOAuthCallback',
        summary: 'Handle Google OAuth callback',
        description: 'Exchange authorization code for tokens and store connection.',
        tags: ['oauth'],
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
          },
        },
        response: {
          302: {
            description: 'Redirect to frontend',
            type: 'null',
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /oauth/connections/google/callback',
      });

      const query = request.query as { code?: string; state?: string; error?: string };

      const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] ?? 'http://localhost:5173';
      const successRedirect = `${webAppUrl}/#/settings/calendar?oauth_success=true`;
      const errorRedirect = (msg: string): string =>
        `${webAppUrl}/#/settings/calendar?oauth_error=${encodeURIComponent(msg)}`;

      if (query.error !== undefined && query.error !== '') {
        return await reply.redirect(errorRedirect(query.error));
      }

      if (query.code === undefined || query.code === '' || query.state === undefined || query.state === '') {
        return await reply.redirect(errorRedirect('Missing code or state parameter'));
      }

      const { oauthConnectionRepository, googleOAuthClient } = getServices();

      if (googleOAuthClient === null) {
        return await reply.redirect(errorRedirect('Google OAuth is not configured'));
      }

      const result = await exchangeOAuthCode(
        { code: query.code, state: query.state },
        { oauthConnectionRepository, googleOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        request.log.warn(
          { error: result.error.message, code: result.error.code },
          'OAuth code exchange failed'
        );
        return await reply.redirect(errorRedirect(result.error.message));
      }

      return await reply.redirect(successRedirect);
    }
  );

  // GET /oauth/connections/google/status
  fastify.get(
    '/oauth/connections/google/status',
    {
      schema: {
        operationId: 'getGoogleOAuthStatus',
        summary: 'Get Google OAuth connection status',
        description: 'Check if user has connected their Google account.',
        tags: ['oauth'],
        response: {
          200: {
            description: 'Connection status retrieved',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                  email: { type: 'string', nullable: true },
                  scopes: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
                  },
                  createdAt: { type: 'string', nullable: true },
                  updatedAt: { type: 'string', nullable: true },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { oauthConnectionRepository } = getServices();

      const result = await oauthConnectionRepository.getConnectionPublic(user.userId, OAuthProviders.GOOGLE);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const connection = result.value;

      if (connection === null) {
        return await reply.ok({
          connected: false,
          email: null,
          scopes: null,
          createdAt: null,
          updatedAt: null,
        });
      }

      return await reply.ok({
        connected: true,
        email: connection.email,
        scopes: connection.scopes,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      });
    }
  );

  // DELETE /oauth/connections/google
  fastify.delete(
    '/oauth/connections/google',
    {
      schema: {
        operationId: 'disconnectGoogleOAuth',
        summary: 'Disconnect Google OAuth',
        description: 'Remove Google OAuth connection and revoke access.',
        tags: ['oauth'],
        response: {
          200: {
            description: 'Connection removed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { oauthConnectionRepository, googleOAuthClient } = getServices();

      if (googleOAuthClient === null) {
        return await reply.fail('MISCONFIGURED', 'Google OAuth is not configured');
      }

      const result = await disconnectProvider(
        { userId: user.userId, provider: OAuthProviders.GOOGLE },
        { oauthConnectionRepository, googleOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(undefined);
    }
  );

  done();
};
