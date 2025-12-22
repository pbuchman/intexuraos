/**
 * OAuth2 Routes (ChatGPT Actions Compatible)
 *
 * POST /v1/auth/oauth/token     - Exchange authorization code for tokens
 * GET  /v1/auth/oauth/authorize - Redirect to Auth0 authorization page
 */

import type { FastifyPluginCallback } from 'fastify';
import { oauthTokenRequestSchema, isAuth0Error, type TokenResponse } from '../schemas.js';
import { postFormUrlEncoded, toFormUrlEncodedBody } from '../httpClient.js';
import { loadAuth0Config } from './shared.js';

export const oauthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/auth/oauth/token
  fastify.post(
    '/v1/auth/oauth/token',
    {
      schema: {
        operationId: 'oauthToken',
        summary: 'OAuth2 Token Endpoint',
        description:
          'Exchange authorization code for tokens (Authorization Code flow). Compatible with ChatGPT Actions OAuth.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['grant_type', 'client_id', 'client_secret'],
          properties: {
            grant_type: {
              type: 'string',
              enum: ['authorization_code', 'refresh_token'],
              description: 'OAuth2 grant type',
            },
            code: {
              type: 'string',
              description: 'Authorization code (required for authorization_code grant)',
            },
            redirect_uri: {
              type: 'string',
              format: 'uri',
              description: 'Redirect URI (required for authorization_code grant)',
            },
            refresh_token: {
              type: 'string',
              description: 'Refresh token (required for refresh_token grant)',
            },
            client_id: { type: 'string', minLength: 1 },
            client_secret: { type: 'string', minLength: 1 },
            code_verifier: { type: 'string', description: 'PKCE code verifier (optional)' },
          },
        },
        response: {
          200: {
            description: 'Token issued successfully',
            type: 'object',
            properties: {
              access_token: { type: 'string' },
              token_type: { type: 'string' },
              expires_in: { type: 'number' },
              refresh_token: { type: 'string' },
              scope: { type: 'string' },
              id_token: { type: 'string' },
            },
            required: ['access_token', 'token_type', 'expires_in'],
          },
          400: {
            description: 'Invalid request or server error',
            type: 'object',
            properties: {
              error: { type: 'string' },
              error_description: { type: 'string' },
            },
          },
          401: {
            description: 'Invalid client credentials',
            type: 'object',
            properties: {
              error: { type: 'string' },
              error_description: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.status(400).send({
          error: 'server_error',
          error_description: 'Auth0 is not configured',
        });
      }

      const parseResult = oauthTokenRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        const details = parseResult.error.errors.map((e) => e.message).join(', ');
        return await reply.status(400).send({
          error: 'invalid_request',
          error_description: details,
        });
      }

      const {
        grant_type,
        code,
        redirect_uri,
        refresh_token,
        client_id,
        client_secret,
        code_verifier,
      } = parseResult.data;

      const tokenUrl = `https://${config.domain}/oauth/token`;

      // Build form body based on grant type
      const formParams: Record<string, string> = {
        grant_type,
        client_id,
        client_secret,
      };

      if (grant_type === 'authorization_code') {
        if (code === undefined || code === '') {
          return await reply.status(400).send({
            error: 'invalid_request',
            error_description: 'code is required for authorization_code grant',
          });
        }
        if (redirect_uri === undefined || redirect_uri === '') {
          return await reply.status(400).send({
            error: 'invalid_request',
            error_description: 'redirect_uri is required for authorization_code grant',
          });
        }
        formParams['code'] = code;
        formParams['redirect_uri'] = redirect_uri;
        if (code_verifier !== undefined && code_verifier !== '') {
          formParams['code_verifier'] = code_verifier;
        }
      } else {
        // grant_type === 'refresh_token'
        if (refresh_token === undefined || refresh_token === '') {
          return await reply.status(400).send({
            error: 'invalid_request',
            error_description: 'refresh_token is required for refresh_token grant',
          });
        }
        formParams['refresh_token'] = refresh_token;
      }

      const formBody = toFormUrlEncodedBody(formParams);

      try {
        const httpRes = await postFormUrlEncoded(tokenUrl, formBody);
        const responseBody: unknown = httpRes.body;

        if (httpRes.status < 200 || httpRes.status >= 300) {
          if (isAuth0Error(responseBody)) {
            const statusCode = httpRes.status === 401 ? 401 : 400;
            return await reply.status(statusCode).send({
              error: responseBody.error,
              error_description: responseBody.error_description ?? responseBody.error,
            });
          }
          return await reply.status(400).send({
            error: 'server_error',
            error_description: 'Token exchange failed',
          });
        }

        // Return OAuth2-compliant response (flat structure, not wrapped)
        const data = responseBody as TokenResponse;
        return await reply.status(200).send({
          access_token: data.access_token,
          token_type: data.token_type,
          expires_in: data.expires_in,
          refresh_token: data.refresh_token,
          scope: data.scope,
          id_token: data.id_token,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return await reply.status(400).send({
          error: 'server_error',
          error_description: message,
        });
      }
    }
  );

  // GET /v1/auth/oauth/authorize
  fastify.get(
    '/v1/auth/oauth/authorize',
    {
      schema: {
        operationId: 'oauthAuthorize',
        summary: 'OAuth2 Authorization Endpoint',
        description:
          'Redirects to Auth0 authorization page. Used by ChatGPT Actions to initiate OAuth flow.',
        tags: ['auth'],
        querystring: {
          type: 'object',
          properties: {
            response_type: { type: 'string', description: 'OAuth response type (code)' },
            client_id: { type: 'string', description: 'Client ID' },
            redirect_uri: { type: 'string', description: 'Redirect URI after authorization' },
            scope: { type: 'string', description: 'OAuth scopes' },
            state: { type: 'string', description: 'State parameter for CSRF protection' },
            audience: { type: 'string', description: 'API audience' },
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
              error: { type: 'string' },
              error_description: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.status(400).send({
          error: 'server_error',
          error_description: 'Auth0 is not configured',
        });
      }

      const query = request.query as Record<string, string | undefined>;
      const responseType = query['response_type'] ?? 'code';
      const clientId = query['client_id'] ?? config.clientId;
      const redirectUri = query['redirect_uri'];
      const scope = query['scope'] ?? 'openid profile email offline_access';
      const state = query['state'] ?? '';
      const audience = query['audience'] ?? config.audience;

      if (redirectUri === undefined || redirectUri === '') {
        return await reply.status(400).send({
          error: 'invalid_request',
          error_description: 'redirect_uri is required',
        });
      }

      // Build Auth0 authorization URL
      const params = new URLSearchParams({
        response_type: responseType,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        audience,
      });

      if (state !== '') {
        params.set('state', state);
      }

      const auth0AuthUrl = `https://${config.domain}/authorize?${params.toString()}`;

      return await reply.code(302).redirect(auth0AuthUrl);
    }
  );

  done();
};
