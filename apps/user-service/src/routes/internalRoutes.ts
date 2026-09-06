/**
 * Internal Routes for service-to-service communication.
 * These routes are authenticated via X-Internal-Auth header.
 *
 * GET /internal/users/:uid/llm-keys - Get decrypted LLM API keys for a user
 * POST /internal/users/:uid/llm-keys/:provider/last-used - Update last used timestamp
 * GET /internal/users/:uid/research-settings - Get research settings for a user
 * GET /internal/users/:uid/oauth/google/token - Get valid Google OAuth token for a user
 * GET /internal/users/:uid/settings - Get user settings preferences (LLM and transcription)
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest, type InternalAuthResult } from '@intexuraos/common-http';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  INTEX_AGENT_MODEL_OPTIONS,
  normalizeLlmModelPreferenceForRead,
} from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import type { LlmPreferences, LlmProvider } from '../domain/settings/index.js';
import { getValidAccessToken, OAuthProviders } from '../domain/oauth/index.js';

function internalAuthFailureLogContext(reason: InternalAuthResult['reason']): Record<string, unknown> {
  return {
    reason,
    [SKIP_SENTRY_KEY]: reason === 'token_mismatch',
  };
}

const INTEG_AGENT_MODEL_IDS = INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => id);

function normalizeLegacyLlmPreferences(
  preferences: LlmPreferences | undefined
): LlmPreferences | undefined {
  if (preferences === undefined) return undefined;

  const normalized = { ...preferences };
  if (normalized.defaultModel !== undefined) {
    normalized.defaultModel = normalizeLlmModelPreferenceForRead(normalized.defaultModel);
  }
  if (normalized.fallbackModel !== undefined) {
    normalized.fallbackModel = normalizeLlmModelPreferenceForRead(normalized.fallbackModel);
  }
  return normalized;
}

function intexAgentProjectionConsistencySchema(): Readonly<Record<string, unknown>> {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          explicitModel: { const: null },
          effectiveModel: { const: DEFAULT_INTEX_AGENT_MODEL },
          source: { const: 'default_absent' },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      },
      ...INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => ({
        type: 'object',
        properties: {
          explicitModel: { const: id },
          effectiveModel: { const: id },
          source: { const: 'explicit' },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      })),
    ],
  };
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/internal/users/:uid/settings/intex-agent-runtime',
    {
      schema: {
        operationId: 'getIntexAgentRuntimeSettings',
        summary: 'Get Intex Agent runtime settings (internal)',
        description: 'Returns the narrow, platform-key-backed Intex Agent runtime projection.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: { uid: { type: 'string', description: 'User ID' } },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'Intex Agent runtime settings',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { const: 'available' },
                      effectiveModel: {
                        type: 'string',
                        enum: INTEG_AGENT_MODEL_IDS,
                      },
                      explicitModel: {
                        type: ['string', 'null'],
                        enum: [...INTEG_AGENT_MODEL_IDS, null],
                      },
                      source: { type: 'string', enum: ['explicit', 'default_absent'] },
                      revision: { type: 'integer', minimum: 0 },
                      timeZone: { type: 'string' },
                    },
                    allOf: [intexAgentProjectionConsistencySchema()],
                    required: ['status', 'effectiveModel', 'explicitModel', 'source', 'revision', 'timeZone'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { const: 'unavailable' },
                      effectiveModel: { const: DEFAULT_INTEX_AGENT_MODEL },
                      source: { const: 'platform_default' },
                      timeZone: { type: 'string' },
                    },
                    required: ['status', 'effectiveModel', 'source', 'timeZone'],
                  },
                ],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
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
        message: 'GET /internal/users/:uid/settings/intex-agent-runtime',
        bodyPreviewLength: 0,
        includeParams: false,
        includeHeaders: false,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for users/:uid/settings/intex-agent-runtime endpoint'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for users/:uid/settings/intex-agent-runtime endpoint'
        );
      }

      const params = request.params as { uid: string };
      const { userSettingsRepository, intexAgentModelAvailability } = getServices();
      const available = await intexAgentModelAvailability.isAvailableForUser(params.uid);
      const timezoneResult = await userSettingsRepository.getTimezonePreference(params.uid);
      if (!timezoneResult.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to load Intex Agent runtime settings');
      }
      const timeZone = timezoneResult.value ?? 'UTC';

      if (!available) {
        return await reply.ok({
          status: 'unavailable',
          effectiveModel: DEFAULT_INTEX_AGENT_MODEL,
          source: 'platform_default',
          timeZone,
        });
      }

      try {
        const selectorResult = await userSettingsRepository.getIntexAgentModelState(params.uid);
        if (!selectorResult.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to load Intex Agent runtime settings');
        }
        if (selectorResult.value.status === 'invalid_stored_value') {
          return await reply.fail('INTERNAL_ERROR', 'Intex Agent model selector state is invalid');
        }
        const explicitModel = selectorResult.value.explicitModel;
        return await reply.ok({
          status: 'available',
          effectiveModel: explicitModel ?? DEFAULT_INTEX_AGENT_MODEL,
          explicitModel,
          source: explicitModel === null ? ('default_absent' as const) : ('explicit' as const),
          revision: selectorResult.value.revision,
          timeZone,
        });
      } catch {
        return await reply.fail('INTERNAL_ERROR', 'Failed to load Intex Agent runtime settings');
      }
    }
  );

  // GET /internal/users/:uid/llm-keys
  fastify.get(
    '/internal/users/:uid/llm-keys',
    {
      schema: {
        operationId: 'getInternalLlmApiKeys',
        summary: 'Get decrypted LLM API keys (internal)',
        description:
          'Internal endpoint for service-to-service communication. Returns decrypted API keys.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'Decrypted LLM API keys',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  openai: { type: 'string', nullable: true },
                  anthropic: { type: 'string', nullable: true },
                  perplexity: { type: 'string', nullable: true },
                  openrouter: { type: 'string', nullable: true },
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
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: 'Received request to /internal/users/:uid/llm-keys',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for users/:uid/llm-keys endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for users/:uid/llm-keys endpoint');
      }

      const params = request.params as { uid: string };
      const { userSettingsRepository, encryptor } = getServices();

      const result = await userSettingsRepository.getSettings(params.uid);

      if (!result.ok) {
        return await reply.ok({
          openai: null,
          anthropic: null,
          perplexity: null,
          openrouter: null,
        });
      }

      const settings = result.value;
      const llmApiKeys = settings?.llmApiKeys;

      // Decrypt keys for service-to-service use
      // Returns null (not undefined) to ensure JSON serialization preserves the key
      const getDecryptedKey = (provider: LlmProvider): string | null => {
        const encryptedKey = llmApiKeys?.[provider];
        if (encryptedKey === undefined || encryptor === null) return null;
        const decrypted = encryptor.decrypt(encryptedKey);
        if (!decrypted.ok) return null;
        return decrypted.value;
      };

      return await reply.ok({
        openai: getDecryptedKey('openai'),
        anthropic: getDecryptedKey('anthropic'),
        perplexity: getDecryptedKey('perplexity'),
        openrouter: getDecryptedKey('openrouter'),
      });
    }
  );

  // POST /internal/users/:uid/llm-keys/:provider/last-used
  fastify.post(
    '/internal/users/:uid/llm-keys/:provider/last-used',
    {
      schema: {
        operationId: 'updateInternalLlmLastUsed',
        summary: 'Update LLM last used timestamp (internal)',
        description:
          'Internal endpoint for service-to-service communication. Updates the testedAt timestamp for an LLM provider.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
            provider: {
              type: 'string',
              enum: ['openai', 'anthropic', 'perplexity', 'openrouter'],
              description: 'LLM provider',
            },
          },
          required: ['uid', 'provider'],
        },
        response: {
          204: {
            description: 'Timestamp updated successfully',
            type: 'null',
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: 'Received request to /internal/users/:uid/llm-keys/:provider/last-used',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for llm-keys/:provider/last-used endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for llm-keys/:provider/last-used endpoint');
      }

      const params = request.params as { uid: string; provider: LlmProvider };
      const { userSettingsRepository } = getServices();

      await userSettingsRepository.updateLlmLastUsed(params.uid, params.provider);

      reply.status(204);
      return;
    }
  );

  // GET /internal/users/:uid/oauth/google/token
  fastify.get(
    '/internal/users/:uid/oauth/google/token',
    {
      schema: {
        operationId: 'getInternalGoogleOAuthToken',
        summary: 'Get valid Google OAuth token (internal)',
        description:
          'Internal endpoint for service-to-service communication. Returns a valid Google OAuth access token, refreshing if necessary.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'Valid OAuth access token',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['accessToken', 'email'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'No OAuth connection found',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Service misconfigured',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
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
        message: 'Received request to /internal/users/:uid/oauth/google/token',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for oauth/google/token endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for oauth/google/token endpoint');
      }

      const params = request.params as { uid: string };
      const { oauthConnectionRepository, googleOAuthClient } = getServices();

      if (googleOAuthClient === null) {
        return await reply.fail('MISCONFIGURED', 'Google OAuth is not configured');
      }

      const result = await getValidAccessToken(
        { userId: params.uid, provider: OAuthProviders.GOOGLE },
        { oauthConnectionRepository, googleOAuthClient, logger: request.log }
      );

      if (!result.ok) {
        if (result.error.code === 'CONNECTION_NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok({
        accessToken: result.value.accessToken,
        email: result.value.email,
      });
    }
  );

  // GET /internal/users/:uid/settings
  fastify.get(
    '/internal/users/:uid/settings',
    {
      schema: {
        operationId: 'getInternalUserSettings',
        summary: 'Get user settings preferences (internal)',
        description:
          'Internal endpoint for service-to-service communication. Returns user settings preferences including LLM and transcription preferences.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'User LLM preferences',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  llmPreferences: {
                    type: 'object',
                    properties: {
                      defaultModel: { type: 'string' },
                      fallbackModel: { type: 'string' },
                    },
                  },
                  transcriptionPreferences: {
                    type: 'object',
                    properties: {
                      provider: { type: 'string' },
                    },
                  },
                  timezone: { type: 'string' },
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
              success: { type: 'boolean', const: false },
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
        message: 'Received request to /internal/users/:uid/settings',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for users/:uid/settings endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for users/:uid/settings endpoint');
      }

      const params = request.params as { uid: string };
      const { userSettingsRepository } = getServices();

      const result = await userSettingsRepository.getSettings(params.uid);

      if (!result.ok) {
        request.log.error(
          { userId: params.uid, error: result.error.message },
          'Failed to fetch user settings'
        );
        // Return empty preferences on error instead of failing
        return await reply.ok({ llmPreferences: undefined, transcriptionPreferences: undefined, timezone: undefined });
      }

      const settings = result.value;
      return await reply.ok({
        llmPreferences: normalizeLegacyLlmPreferences(settings?.llmPreferences),
        transcriptionPreferences: settings?.transcriptionPreferences,
        timezone: settings?.timezone,
      });
    }
  );

  // GET /internal/users/:uid/oauth/github/token
  fastify.get(
    '/internal/users/:uid/oauth/github/token',
    {
      schema: {
        operationId: 'getInternalGitHubOAuthToken',
        summary: 'Get GitHub OAuth token (internal)',
        description:
          'Internal endpoint for service-to-service communication. Returns the stored GitHub OAuth access token.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'GitHub OAuth access token',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                  username: { type: 'string' },
                },
                required: ['accessToken', 'username'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'No GitHub OAuth connection found',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
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
        message: 'Received request to /internal/users/:uid/oauth/github/token',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for oauth/github/token endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for oauth/github/token endpoint');
      }

      const params = request.params as { uid: string };
      const { oauthConnectionRepository } = getServices();

      const result = await oauthConnectionRepository.getConnection(params.uid, OAuthProviders.GITHUB);

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const connection = result.value;

      if (connection === null) {
        return await reply.fail('NOT_FOUND', 'No GitHub OAuth connection found for this user');
      }

      return await reply.ok({
        accessToken: connection.tokens.accessToken,
        username: connection.email,
      });
    }
  );

  // GET /internal/users/by-github-username/:username
  fastify.get(
    '/internal/users/by-github-username/:username',
    {
      schema: {
        operationId: 'getInternalUserByGitHubUsername',
        summary: 'Find user by GitHub username (internal)',
        description:
          'Internal endpoint for service-to-service communication. Finds a user by their GitHub username.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'GitHub username' },
          },
          required: ['username'],
        },
        response: {
          200: {
            description: 'User found',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  username: { type: 'string' },
                },
                required: ['userId', 'username'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'No user found with this GitHub username',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
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
        message: 'Received request to /internal/users/by-github-username/:username',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          internalAuthFailureLogContext(authResult.reason),
          'Internal auth failed for users/by-github-username/:username endpoint'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for users/by-github-username/:username endpoint');
      }

      const params = request.params as { username: string };
      const { oauthConnectionRepository } = getServices();

      const result = await oauthConnectionRepository.findByProviderEmail(
        OAuthProviders.GITHUB,
        params.username
      );

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const connection = result.value;

      if (connection === null) {
        return await reply.fail('NOT_FOUND', `No user found with GitHub username: ${params.username}`);
      }

      return await reply.ok({
        userId: connection.userId,
        username: connection.email,
      });
    }
  );

  done();
};
