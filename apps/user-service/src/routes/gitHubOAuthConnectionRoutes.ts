/**
 * GitHub OAuth Connection Routes
 *
 * POST   /oauth/connections/github/initiate - Start GitHub OAuth flow
 * GET    /oauth/connections/github/callback - Handle GitHub OAuth callback
 * GET    /oauth/connections/github/status   - Get connection status
 * DELETE /oauth/connections/github          - Disconnect GitHub OAuth connection
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  initiateGitHubOAuthFlow,
  exchangeGitHubOAuthCode,
  disconnectGitHubProvider,
  OAuthProviders,
} from '../domain/oauth/index.js';

export const gitHubOAuthConnectionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /oauth/connections/github/initiate
  fastify.post(
    '/oauth/connections/github/initiate',
    {
      schema: {
        operationId: 'initiateGitHubOAuth',
        summary: 'Initiate GitHub OAuth flow',
        description: 'Generate authorization URL to redirect user to GitHub for OAuth consent.',
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
        message: 'Received request to POST /oauth/connections/github/initiate',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { gitHubOAuthClient } = getServices();

      if (gitHubOAuthClient === null) {
        return await reply.fail('MISCONFIGURED', 'GitHub OAuth is not configured');
      }

      const protocol = String(request.headers['x-forwarded-proto'] ?? 'http');
      /* v8 ignore start -- test-infra: Fastify app.inject() always sets host header, cannot simulate missing host @preserve */
      const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost');
      /* v8 ignore stop @preserve */
      const redirectUri = `${protocol}://${host}/oauth/connections/github/callback`;

      const result = initiateGitHubOAuthFlow(
        { userId: user.userId, provider: OAuthProviders.GITHUB, redirectUri },
        { gitHubOAuthClient, logger: request.log }
      );

      /* v8 ignore start -- test-infra: fake OAuth client always succeeds @preserve */
      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to initiate OAuth flow');
      }
      /* v8 ignore stop @preserve */

      return await reply.ok({
        authorizationUrl: result.value.authorizationUrl,
      });
    }
  );

  // GET /oauth/connections/github/callback
  fastify.get(
    '/oauth/connections/github/callback',
    {
      schema: {
        operationId: 'handleGitHubOAuthCallback',
        summary: 'Handle GitHub OAuth callback',
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
        message: 'Received request to GET /oauth/connections/github/callback',
      });

      const query = request.query as { code?: string; state?: string; error?: string };

      const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] ?? 'http://localhost:5173';
      const successRedirect = `${webAppUrl}/#/settings/github?oauth_success=true`;
      const errorRedirect = (msg: string): string =>
        `${webAppUrl}/#/settings/github?oauth_error=${encodeURIComponent(msg)}`;

      if (query.error !== undefined && query.error !== '') {
        return await reply.redirect(errorRedirect(query.error));
      }

      if (query.code === undefined || query.code === '' || query.state === undefined || query.state === '') {
        return await reply.redirect(errorRedirect('Missing code or state parameter'));
      }

      const { oauthConnectionRepository, gitHubOAuthClient } = getServices();

      if (gitHubOAuthClient === null) {
        return await reply.redirect(errorRedirect('GitHub OAuth is not configured'));
      }

      const result = await exchangeGitHubOAuthCode(
        { code: query.code, state: query.state },
        { oauthConnectionRepository, gitHubOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        request.log.warn(
          { error: result.error.message, code: result.error.code },
          'GitHub OAuth code exchange failed'
        );
        return await reply.redirect(errorRedirect(result.error.message));
      }

      return await reply.redirect(successRedirect);
    }
  );

  // GET /oauth/connections/github/status
  fastify.get(
    '/oauth/connections/github/status',
    {
      schema: {
        operationId: 'getGitHubOAuthStatus',
        summary: 'Get GitHub OAuth connection status',
        description: 'Check if user has connected their GitHub account.',
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
                  username: { type: 'string', nullable: true },
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

      const result = await oauthConnectionRepository.getConnectionPublic(user.userId, OAuthProviders.GITHUB);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const connection = result.value;

      if (connection === null) {
        return await reply.ok({
          connected: false,
          username: null,
          scopes: null,
          createdAt: null,
          updatedAt: null,
        });
      }

      return await reply.ok({
        connected: true,
        username: connection.email,
        scopes: connection.scopes,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      });
    }
  );

  // DELETE /oauth/connections/github
  fastify.delete(
    '/oauth/connections/github',
    {
      schema: {
        operationId: 'disconnectGitHubOAuth',
        summary: 'Disconnect GitHub OAuth',
        description: 'Remove GitHub OAuth connection and revoke access.',
        tags: ['oauth'],
        response: {
          200: {
            description: 'Connection removed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
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

      const { oauthConnectionRepository, gitHubOAuthClient } = getServices();

      if (gitHubOAuthClient === null) {
        return await reply.fail('MISCONFIGURED', 'GitHub OAuth is not configured');
      }

      const result = await disconnectGitHubProvider(
        { userId: user.userId, provider: OAuthProviders.GITHUB },
        { oauthConnectionRepository, gitHubOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({});
    }
  );

  done();
};
