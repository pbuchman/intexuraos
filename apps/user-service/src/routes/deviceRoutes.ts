/**
 * Device Authorization Flow Routes
 *
 * POST /auth/device/start - Start device authorization flow
 * POST /auth/device/poll  - Poll for token after user authorization
 */

import type { FastifyPluginCallback } from 'fastify';
import { isErr, getErrorMessage } from '@intexuraos/common-core';
import { handleValidationError } from '@intexuraos/common-http';
import type { AuthTokens, AuthTokenRepository } from '../domain/identity/index.js';
import { getServices } from '../services.js';
import {
  deviceStartRequestSchema,
  devicePollRequestSchema,
  isAuth0Error,
  type DeviceStartResponse,
  type TokenResponse,
} from './schemas.js';
import { postFormUrlEncoded, toFormUrlEncodedBody } from './httpClient.js';
import { loadAuth0Config } from './shared.js';

export const deviceRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /auth/device/start
  fastify.post(
    '/auth/device/start',
    {
      schema: {
        operationId: 'startDeviceAuth',
        summary: 'Start Device Authorization Flow',
        description: 'Start Device Authorization Flow. Returns device code and user code.',
        tags: ['auth'],
        body: {
          type: 'object',
          properties: {
            audience: { type: 'string', format: 'uri', description: 'API audience identifier' },
            scope: {
              type: 'string',
              description: 'OAuth scopes',
              default: 'openid profile email offline_access',
            },
          },
        },
        response: {
          200: {
            description: 'Device code issued successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  device_code: { type: 'string' },
                  user_code: { type: 'string' },
                  verification_uri: { type: 'string' },
                  verification_uri_complete: { type: 'string' },
                  expires_in: { type: 'number' },
                  interval: { type: 'number' },
                },
                required: [
                  'device_code',
                  'user_code',
                  'verification_uri',
                  'verification_uri_complete',
                  'expires_in',
                  'interval',
                ],
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
    async (request, reply) => {
      const config = loadAuth0Config();
      if (config === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH_AUDIENCE.'
        );
      }

      const parseResult = deviceStartRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { audience, scope } = parseResult.data;
      const deviceCodeUrl = `https://${config.domain}/oauth/device/code`;

      const formBody = [
        `client_id=${encodeURIComponent(config.clientId)}`,
        `audience=${encodeURIComponent(audience)}`,
        `scope=${encodeURIComponent(scope)}`,
      ].join('&');

      try {
        const httpRes = await postFormUrlEncoded(deviceCodeUrl, formBody);
        const responseBody: unknown = httpRes.body;

        if (httpRes.status < 200 || httpRes.status >= 300) {
          if (isAuth0Error(responseBody)) {
            return await reply.fail(
              'DOWNSTREAM_ERROR',
              responseBody.error_description ?? responseBody.error,
              {
                downstreamStatus: httpRes.status,
                endpointCalled: deviceCodeUrl,
              }
            );
          }
          return await reply.fail('DOWNSTREAM_ERROR', 'Auth0 device code request failed', {
            downstreamStatus: httpRes.status,
            endpointCalled: deviceCodeUrl,
          });
        }

        const data = responseBody as DeviceStartResponse;
        return await reply.ok(data);
      } catch (error) {
        return await reply.fail(
          'DOWNSTREAM_ERROR',
          `Auth0 request failed: ${getErrorMessage(error)}`,
          {
            endpointCalled: deviceCodeUrl,
          }
        );
      }
    }
  );

  // POST /auth/device/poll
  fastify.post(
    '/auth/device/poll',
    {
      schema: {
        operationId: 'pollDeviceAuth',
        summary: 'Poll for token',
        description:
          'Poll for token after user authorization. Returns CONFLICT (409) if authorization pending.',
        tags: ['auth'],
        body: {
          type: 'object',
          required: ['device_code'],
          properties: {
            device_code: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            description: 'Token issued successfully',
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
          409: {
            description: 'Authorization pending',
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
          'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH_AUDIENCE.'
        );
      }

      const parseResult = devicePollRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { device_code } = parseResult.data;
      const tokenUrl = `https://${config.domain}/oauth/token`;

      const formBody = toFormUrlEncodedBody({
        client_id: config.clientId,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      try {
        const httpRes = await postFormUrlEncoded(tokenUrl, formBody);
        const responseBody: unknown = httpRes.body;

        if (httpRes.status < 200 || httpRes.status >= 300) {
          if (isAuth0Error(responseBody)) {
            const errorCode = responseBody.error;

            // authorization_pending: user hasn't authorized yet
            // slow_down: polling too fast
            if (errorCode === 'authorization_pending' || errorCode === 'slow_down') {
              const message =
                errorCode === 'authorization_pending'
                  ? 'Authorization pending. User has not yet completed authentication.'
                  : 'Polling too fast. Increase interval between requests.';
              return await reply.fail('CONFLICT', message, {
                downstreamStatus: httpRes.status,
                endpointCalled: tokenUrl,
              });
            }

            // expired_token, access_denied, etc.
            return await reply.fail(
              'DOWNSTREAM_ERROR',
              responseBody.error_description ?? responseBody.error,
              {
                downstreamStatus: httpRes.status,
                endpointCalled: tokenUrl,
              }
            );
          }
          return await reply.fail('DOWNSTREAM_ERROR', 'Auth0 token request failed', {
            downstreamStatus: httpRes.status,
            endpointCalled: tokenUrl,
          });
        }

        const data = responseBody as TokenResponse;

        // Store refresh token if received (uses injected repository for testability)
        if (data.refresh_token !== undefined && data.refresh_token !== '') {
          const { authTokenRepository } = getServices();
          await storeRefreshToken(fastify, data, authTokenRepository);
        }

        return await reply.ok(data);
      } catch (error) {
        return await reply.fail(
          'DOWNSTREAM_ERROR',
          `Auth0 request failed: ${getErrorMessage(error)}`,
          {
            endpointCalled: tokenUrl,
          }
        );
      }
    }
  );

  done();
};

/**
 * Extract userId from access token and store refresh token.
 * Best-effort: logs warnings but doesn't fail the request.
 *
 * @param fastify - Fastify instance for logging
 * @param data - Token response from Auth0
 * @param tokenRepo - Repository for storing tokens (injected for testability)
 */
async function storeRefreshToken(
  fastify: { log: { warn: (obj: object, msg: string) => void } },
  data: TokenResponse,
  tokenRepo: AuthTokenRepository
): Promise<void> {
  try {
    // Extract userId from access token JWT (without verification, just for storage key)
    const tokenParts = data.access_token.split('.');
    if (tokenParts.length !== 3) return;

    const payloadPart = tokenParts[1];
    if (payloadPart === undefined) return;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = payload.sub as string;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (userId === '' || userId === null || userId === undefined) return;

    const authTokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token as string,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
      idToken: data.id_token,
    };

    const saveResult = await tokenRepo.saveTokens(userId, authTokens);
    if (isErr(saveResult)) {
      fastify.log.warn(
        { userId, errorMessage: saveResult.error.message },
        'Failed to save refresh token'
      );
    }
  } catch (tokenError) {
    fastify.log.warn({ error: tokenError }, 'Failed to extract userId from token');
  }
}
