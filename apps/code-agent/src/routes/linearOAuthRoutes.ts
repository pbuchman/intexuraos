/**
 * Linear OAuth routes for agent app installation.
 *
 * Handles the OAuth flow for installing IntexuraOS as a Linear Agent:
 * - GET /oauth/linear/install → Redirect to Linear authorization URL
 * - GET /oauth/linear/callback → Exchange code for token, store credentials
 *
 * Uses actor=app mode for workspace-level installation.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { loadConfig } from '../config.js';

const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

/**
 * Required OAuth scopes for the Linear Agent app.
 */
const OAUTH_SCOPES = [
  'app:assignable',
  'app:mentionable',
  'read',
  'write',
  'issues:create',
].join(',');

/**
 * In-memory state store for CSRF protection.
 * Keyed by state token, value is creation timestamp.
 * States expire after 10 minutes.
 */
const stateStore = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Clean expired states from the store.
 */
function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [state, timestamp] of stateStore) {
    if (now - timestamp > STATE_TTL_MS) {
      stateStore.delete(state);
    }
  }
}

/**
 * Query Linear GraphQL API for the viewer ID (app user ID).
 */
async function queryViewerId(accessToken: string): Promise<string> {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
    },
    body: JSON.stringify({
      query: 'query Me { viewer { id } }',
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear API returned ${String(response.status)}`);
  }

  const data = await response.json() as { data?: { viewer?: { id?: string } } };
  const viewerId = data.data?.viewer?.id;

  if (viewerId === undefined) {
    throw new Error('Failed to retrieve viewer ID from Linear API');
  }

  return viewerId;
}

export const linearOAuthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /oauth/linear/install - Redirect to Linear authorization
  fastify.get(
    '/oauth/linear/install',
    {
      schema: {
        operationId: 'linearOAuthInstall',
        summary: 'Start Linear OAuth installation flow',
        description: 'Redirects to Linear authorization URL with actor=app mode for workspace-level installation.',
        tags: ['oauth', 'linear'],
        response: {
          302: {
            description: 'Redirect to Linear authorization',
            type: 'null',
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /oauth/linear/install',
      });

      const config = loadConfig();

      // Generate random state for CSRF protection
      const state = randomBytes(32).toString('hex');

      // Store state with timestamp
      cleanExpiredStates();
      stateStore.set(state, Date.now());

      // Build redirect URL
      const redirectUri = config.linearOAuthRedirectUri;
      const params = new URLSearchParams({
        client_id: config.linearClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES,
        state,
        actor: 'app',
      });

      const authorizationUrl = `${LINEAR_AUTHORIZE_URL}?${params.toString()}`;

      request.log.info(
        { redirectUri, scopes: OAUTH_SCOPES },
        'Redirecting to Linear OAuth authorization'
      );

      return await reply.redirect(authorizationUrl);
    }
  );

  // GET /oauth/linear/callback - Handle OAuth callback
  fastify.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
    };
  }>(
    '/oauth/linear/callback',
    {
      schema: {
        operationId: 'linearOAuthCallback',
        summary: 'Handle Linear OAuth callback',
        description: 'Exchanges authorization code for access token and stores credentials.',
        tags: ['oauth', 'linear'],
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'OAuth installation successful',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  appUserId: { type: 'string' },
                },
                required: ['message', 'appUserId'],
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid callback parameters',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /oauth/linear/callback',
      });

      const { code, state, error: oauthError } = request.query;

      // Check for OAuth error
      if (oauthError !== undefined) {
        request.log.warn({ error: oauthError }, 'Linear OAuth error');
        return await reply.fail('DOWNSTREAM_ERROR', `Linear OAuth error: ${oauthError}`);
      }

      // Validate required parameters
      if (code === undefined || state === undefined) {
        return await reply.fail('INVALID_REQUEST', 'Missing code or state parameter');
      }

      // Validate state (CSRF protection)
      const stateTimestamp = stateStore.get(state);
      if (stateTimestamp === undefined) {
        return await reply.fail('INVALID_REQUEST', 'Invalid or expired state parameter');
      }

      // Check state expiry
      if (Date.now() - stateTimestamp > STATE_TTL_MS) {
        stateStore.delete(state);
        return await reply.fail('INVALID_REQUEST', 'State parameter has expired');
      }

      // Consume state (one-time use)
      stateStore.delete(state);

      const config = loadConfig();

      try {
        // Exchange code for access token
        const tokenResponse = await fetch(LINEAR_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.linearOAuthRedirectUri,
            client_id: config.linearClientId,
            client_secret: config.linearClientSecret,
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          request.log.error(
            { status: tokenResponse.status, body: errorText },
            'Linear token exchange failed'
          );
          return await reply.fail('DOWNSTREAM_ERROR', 'Failed to exchange authorization code');
        }

        const tokenData = await tokenResponse.json() as {
          access_token?: string;
          token_type?: string;
          expires_in?: number;
        };

        const accessToken = tokenData.access_token;
        if (accessToken === undefined) {
          return await reply.fail('DOWNSTREAM_ERROR', 'No access token in response');
        }

        // Query viewer.id (app user ID in the workspace)
        const appUserId = await queryViewerId(accessToken);

        // Store credentials
        const { linearOAuthRepo } = getServices();
        const saveResult = await linearOAuthRepo.save({
          accessToken,
          appUserId,
          workspaceId: 'default', // Single workspace for now
          installedAt: new Date().toISOString(),
          installedBy: 'oauth-flow',
        });

        if (!saveResult.ok) {
          request.log.error(
            { error: saveResult.error },
            'Failed to store Linear OAuth credentials'
          );
          return await reply.fail('INTERNAL_ERROR', 'Failed to store credentials');
        }

        request.log.info(
          { appUserId },
          'Linear OAuth installation successful'
        );

        return await reply.ok({
          message: 'Linear app installed successfully',
          appUserId,
        });
      } catch (error) {
        request.log.error({ error }, 'Linear OAuth callback error');
        return await reply.fail('INTERNAL_ERROR', 'OAuth callback processing failed');
      }
    }
  );

  done();
};
