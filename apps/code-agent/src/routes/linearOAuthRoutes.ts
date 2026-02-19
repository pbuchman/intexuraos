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
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
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

const OAUTH_STATE_COLLECTION = 'linear_oauth_states';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Query Linear GraphQL API for the viewer ID (app user ID).
 * Returns Result instead of throwing for explicit error handling.
 */
interface QueryViewerIdError {
  code: 'downstream_error' | 'internal_error';
  message: string;
}

async function queryViewerId(
  accessToken: string
): Promise<Result<string, QueryViewerIdError>> {
  try {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: 'query Me { viewer { id } }',
      }),
    });

    if (!response.ok) {
      return err({
        code: 'downstream_error',
        message: `Linear API returned ${String(response.status)}`,
      });
    }

    const data = await response.json() as { data?: { viewer?: { id?: string } } };
    const viewerId = data.data?.viewer?.id;

    if (viewerId === undefined) {
      return err({
        code: 'downstream_error',
        message: 'Failed to retrieve viewer ID from Linear API',
      });
    }

    return ok(viewerId);
  } catch (error) {
    const message = getErrorMessage(error);
    return err({
      code: 'internal_error',
      message: `Viewer ID query failed: ${message}`,
    });
  }
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
      const { firestore } = getServices();

      // Generate random state for CSRF protection
      const state = randomBytes(32).toString('hex');

      // Store state in Firestore with TTL
      const now = Date.now();
      await firestore.collection(OAUTH_STATE_COLLECTION).doc(state).set({
        createdAt: now,
        expiresAt: now + STATE_TTL_MS,
      });

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
      const { firestore, linearOAuthRepo } = getServices();

      // Check for OAuth error
      if (oauthError !== undefined) {
        request.log.warn({ error: oauthError }, 'Linear OAuth error');
        return await reply.fail('DOWNSTREAM_ERROR', `Linear OAuth error: ${oauthError}`);
      }

      // Validate required parameters
      if (code === undefined || state === undefined) {
        return await reply.fail('INVALID_REQUEST', 'Missing code or state parameter');
      }

      // Validate state (CSRF protection) via Firestore
      const stateDoc = await firestore.collection(OAUTH_STATE_COLLECTION).doc(state).get();
      if (!stateDoc.exists) {
        return await reply.fail('INVALID_REQUEST', 'Invalid or expired state parameter');
      }

      const stateData = stateDoc.data() as { createdAt: number; expiresAt: number };

      // Check state expiry
      if (Date.now() > stateData.expiresAt) {
        await firestore.collection(OAUTH_STATE_COLLECTION).doc(state).delete();
        return await reply.fail('INVALID_REQUEST', 'State parameter has expired');
      }

      // Consume state (one-time use)
      await firestore.collection(OAUTH_STATE_COLLECTION).doc(state).delete();

      const config = loadConfig();

      // Exchange code for access token
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(LINEAR_TOKEN_URL, {
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
      } catch (error) {
        request.log.error({ error }, 'Linear token exchange network error');
        return await reply.fail('DOWNSTREAM_ERROR', 'Failed to connect to Linear token endpoint');
      }

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
      const viewerResult = await queryViewerId(accessToken);
      if (!viewerResult.ok) {
        request.log.error(
          { error: viewerResult.error },
          'Failed to query Linear viewer ID'
        );
        return await reply.fail('DOWNSTREAM_ERROR', viewerResult.error.message);
      }
      const appUserId = viewerResult.value;

      // Store credentials
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
    }
  );

  done();
};
