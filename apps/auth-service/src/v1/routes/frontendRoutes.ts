/**
 * Frontend Authentication Routes
 *
 * GET /v1/auth/login  - Redirect to Auth0 login (browser-based OAuth flow)
 * GET /v1/auth/logout - Clear session and redirect to Auth0 logout
 * GET /v1/auth/me     - Get current authenticated user info
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@praxos/common';
import { FirestoreAuthTokenRepository } from '@praxos/infra-firestore';
import { loadAuth0Config } from './shared.js';

export const frontendRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /v1/auth/login
  fastify.get(
    '/v1/auth/login',
    {
      schema: {
        operationId: 'frontendLogin',
        summary: 'Initiate browser login',
        description:
          'Redirects to Auth0 authorization page for browser-based authentication. ' +
          'After successful authentication, Auth0 redirects back to the specified redirect_uri ' +
          'with an authorization code that can be exchanged for tokens.',
        tags: ['auth'],
        querystring: {
          type: 'object',
          properties: {
            redirect_uri: {
              type: 'string',
              description: 'URI to redirect after successful authentication',
            },
            state: {
              type: 'string',
              description: 'State parameter for CSRF protection (recommended)',
            },
          },
        },
        response: {
          302: {
            description: 'Redirect to Auth0 authorization page',
            type: 'null',
          },
          400: {
            description: 'Missing required parameters',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Service misconfigured',
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
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH_AUDIENCE.'
        );
      }

      const query = request.query as Record<string, string | undefined>;
      const redirectUri = query['redirect_uri'];
      const state = query['state'];

      if (redirectUri === undefined || redirectUri === '') {
        return await reply.fail('INVALID_REQUEST', 'redirect_uri is required');
      }

      // Build Auth0 authorization URL for browser-based flow
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access',
        audience: config.audience,
      });

      if (state !== undefined && state !== '') {
        params.set('state', state);
      }

      const auth0AuthUrl = `https://${config.domain}/authorize?${params.toString()}`;

      return await reply.code(302).redirect(auth0AuthUrl);
    }
  );

  // GET /v1/auth/logout
  fastify.get(
    '/v1/auth/logout',
    {
      schema: {
        operationId: 'frontendLogout',
        summary: 'Logout and clear session',
        description:
          'Clears the user session (deletes stored refresh token) and redirects to Auth0 logout. ' +
          'After Auth0 logout completes, the user is redirected to the specified return_to URI.',
        tags: ['auth'],
        querystring: {
          type: 'object',
          properties: {
            return_to: {
              type: 'string',
              description: 'URI to redirect after logout completes',
            },
          },
        },
        response: {
          302: {
            description: 'Redirect to Auth0 logout page',
            type: 'null',
          },
          400: {
            description: 'Missing required parameters',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Service misconfigured',
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
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH_AUDIENCE.'
        );
      }

      const query = request.query as Record<string, string | undefined>;
      const returnTo = query['return_to'];

      if (returnTo === undefined || returnTo === '') {
        return await reply.fail('INVALID_REQUEST', 'return_to is required');
      }

      // If user is authenticated, clear their stored refresh token
      // Best-effort: we don't require auth for logout (user might have expired token)
      const user = request.user;
      if (user !== undefined) {
        try {
          const tokenRepo = new FirestoreAuthTokenRepository();
          await tokenRepo.deleteTokens(user.userId);
        } catch {
          // Best-effort cleanup, failure is acceptable
        }
      }

      // Build Auth0 logout URL
      const params = new URLSearchParams({
        client_id: config.clientId,
        returnTo,
      });

      const auth0LogoutUrl = `https://${config.domain}/v2/logout?${params.toString()}`;

      return await reply.code(302).redirect(auth0LogoutUrl);
    }
  );

  // GET /v1/auth/me
  fastify.get(
    '/v1/auth/me',
    {
      schema: {
        operationId: 'getCurrentUser',
        summary: 'Get current user info',
        description:
          'Returns the authenticated user information from the JWT token. ' +
          'Used by frontend to check authentication state and get user profile.',
        tags: ['auth'],
        response: {
          200: {
            description: 'User info retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  userId: { type: 'string', description: 'User ID (JWT sub claim)' },
                  email: { type: 'string', description: 'User email (if available)' },
                  name: { type: 'string', description: 'User name (if available)' },
                  picture: { type: 'string', description: 'User avatar URL (if available)' },
                  hasRefreshToken: {
                    type: 'boolean',
                    description: 'Whether a refresh token is stored for this user',
                  },
                },
                required: ['userId', 'hasRefreshToken'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized - invalid or missing token',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Service misconfigured',
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

      // Check if user has stored refresh token
      let hasRefreshToken = false;
      try {
        const tokenRepo = new FirestoreAuthTokenRepository();
        const result = await tokenRepo.hasRefreshToken(user.userId);
        if (result.ok) {
          hasRefreshToken = result.value;
        }
      } catch {
        // Best-effort check, default to false on error
      }

      // Extract profile claims from JWT
      const claims = user.claims;
      const email = typeof claims['email'] === 'string' ? claims['email'] : undefined;
      const name = typeof claims['name'] === 'string' ? claims['name'] : undefined;
      const picture = typeof claims['picture'] === 'string' ? claims['picture'] : undefined;

      const responseData: Record<string, unknown> = {
        userId: user.userId,
        hasRefreshToken,
      };

      // Only add optional fields if they have values
      if (email !== undefined) {
        responseData['email'] = email;
      }
      if (name !== undefined) {
        responseData['name'] = name;
      }
      if (picture !== undefined) {
        responseData['picture'] = picture;
      }

      return await reply.ok(responseData);
    }
  );

  done();
};
