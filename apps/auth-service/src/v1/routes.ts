import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { isErr } from '@praxos/common';
import { Auth0ClientImpl, loadAuth0Config as loadAuth0ConfigFromInfra } from '@praxos/infra-auth0';
import { FirestoreAuthTokenRepository } from '@praxos/infra-firestore';
import type { AuthTokens } from '@praxos/domain-identity';
import {
  deviceStartRequestSchema,
  devicePollRequestSchema,
  refreshTokenRequestSchema,
  isAuth0Error,
  type DeviceStartResponse,
  type TokenResponse,
  type AuthConfigResponse,
} from './schemas.js';
import { postFormUrlEncoded, toFormUrlEncodedBody } from './httpClient.js';

/**
 * Auth0 configuration from environment.
 */
interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
  jwksUrl: string;
  issuer: string;
}

/**
 * Load Auth0 config from environment.
 * Returns null if required vars are missing.
 */
function loadAuth0Config(): Auth0Config | null {
  const domain = process.env['AUTH0_DOMAIN'];
  const clientId = process.env['AUTH0_CLIENT_ID'];
  const audience = process.env['AUTH_AUDIENCE'];

  if (
    domain === undefined ||
    domain === '' ||
    clientId === undefined ||
    clientId === '' ||
    audience === undefined ||
    audience === ''
  ) {
    return null;
  }

  return {
    domain,
    clientId,
    audience,
    jwksUrl: `https://${domain}/.well-known/jwks.json`,
    issuer: `https://${domain}/`,
  };
}

/**
 * Handle Zod validation errors.
 */
function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}

/**
 * V1 auth routes plugin.
 * Implements Device Authorization Flow helpers.
 */
export const v1AuthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/auth/device/start
  fastify.post(
    '/v1/auth/device/start',
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
        const message = error instanceof Error ? error.message : 'Unknown error';
        return await reply.fail('DOWNSTREAM_ERROR', `Auth0 request failed: ${message}`, {
          endpointCalled: deviceCodeUrl,
        });
      }
    }
  );

  // POST /v1/auth/device/poll
  fastify.post(
    '/v1/auth/device/poll',
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

        // Store refresh token if received
        if (data.refresh_token !== undefined && data.refresh_token !== '') {
          try {
            // Extract userId from access token JWT (without verification, just for storage key)
            const tokenParts = data.access_token.split('.');
            if (tokenParts.length === 3) {
              const payloadPart = tokenParts[1];
              if (payloadPart !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const userId = payload.sub as string;

                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (userId !== '' && userId !== null && userId !== undefined) {
                  const tokenRepo = new FirestoreAuthTokenRepository();
                  const authTokens: AuthTokens = {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
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
                }
              }
            }
          } catch (tokenError) {
            // Log but don't fail the request
            fastify.log.warn({ error: tokenError }, 'Failed to extract userId from token');
          }
        }

        return await reply.ok(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return await reply.fail('DOWNSTREAM_ERROR', `Auth0 request failed: ${message}`, {
          endpointCalled: tokenUrl,
        });
      }
    }
  );

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
        const tokenRepo = new FirestoreAuthTokenRepository();
        const auth0ClientConfig = loadAuth0ConfigFromInfra();
        if (auth0ClientConfig === null) {
          return await reply.fail(
            'MISCONFIGURED',
            'Auth0 is not configured for refresh operations.'
          );
        }
        const auth0Client = new Auth0ClientImpl(auth0ClientConfig);

        // Get stored refresh token
        const refreshTokenResult = await tokenRepo.getRefreshToken(userId);
        if (isErr(refreshTokenResult)) {
          return await reply.fail(
            'INTERNAL_ERROR',
            `Failed to retrieve refresh token: ${refreshTokenResult.error.message}`
          );
        }

        if (!refreshTokenResult.ok) {
          // Should never reach here due to isErr check above, but TypeScript needs this
          return await reply.fail('INTERNAL_ERROR', 'Unexpected error state');
        }

        if (refreshTokenResult.value === null) {
          return await reply.fail(
            'UNAUTHORIZED',
            'No refresh token found. User must re-authenticate.'
          );
        }

        const refreshToken = refreshTokenResult.value;

        // Refresh access token
        const refreshResult = await auth0Client.refreshAccessToken(refreshToken);
        if (isErr(refreshResult)) {
          const error = refreshResult.error;

          // If invalid_grant, delete stored token and require reauth
          if (error.code === 'INVALID_GRANT') {
            await tokenRepo.deleteTokens(userId);
            return await reply.fail(
              'UNAUTHORIZED',
              'Refresh token is invalid or expired. User must re-authenticate.'
            );
          }

          return await reply.fail('DOWNSTREAM_ERROR', `Token refresh failed: ${error.message}`);
        }

        if (!refreshResult.ok) {
          // Should never reach here due to isErr check above, but TypeScript needs this
          return await reply.fail('INTERNAL_ERROR', 'Unexpected error state');
        }

        const newTokens = refreshResult.value;

        // Store updated tokens (including new refresh token if rotation enabled)
        const tokensToStore: AuthTokens = {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken ?? refreshToken, // use new RT if provided, else keep old
          tokenType: newTokens.tokenType,
          expiresIn: newTokens.expiresIn,
          scope: newTokens.scope,
          idToken: newTokens.idToken,
        };

        const saveResult = await tokenRepo.saveTokens(userId, tokensToStore);
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

  // GET /v1/auth/config
  fastify.get(
    '/v1/auth/config',
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
