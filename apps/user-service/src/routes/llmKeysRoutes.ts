/**
 * LLM API Keys Routes
 *
 * GET    /users/:uid/settings/llm-keys           - Get configured LLM providers (masked)
 * PATCH  /users/:uid/settings/llm-keys           - Set/update a key for a provider
 * DELETE /users/:uid/settings/llm-keys/:provider - Remove a key for a provider
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import {
  DEFAULT_PLATFORM_LLM_MODEL,
  DEFAULT_INTEX_AGENT_MODEL,
  EXECUTABLE_LLM_PROVIDERS,
  getProviderForModel,
  INTEX_AGENT_MODEL_OPTIONS,
  isLegacyGoogleModel,
  LlmProviders,
  type ExecutableLlmProvider,
} from '@intexuraos/llm-contract';
import type { EncryptedValue } from '../infra/encryption.js';
import { getServices } from '../services.js';
import { type LlmTestResult, maskApiKey } from '../domain/settings/index.js';
import { formatLlmError } from '../domain/settings/formatLlmError.js';

const INTEG_AGENT_MODEL_IDS = INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => id);
type DeletableLlmProvider = ExecutableLlmProvider | typeof LlmProviders.Google;

function normalizeLegacyPreference(model: string | undefined): string | null {
  if (model === undefined) return null;
  if (isLegacyGoogleModel(model)) {
    return DEFAULT_PLATFORM_LLM_MODEL;
  }
  return model;
}
const INTEG_AGENT_SELECTOR_OPTIONS_SCHEMA = {
  type: 'array',
  minItems: INTEX_AGENT_MODEL_OPTIONS.length,
  maxItems: INTEX_AGENT_MODEL_OPTIONS.length,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { id: { type: 'string' }, label: { type: 'string' } },
    required: ['id', 'label'],
  },
  allOf: [
    {
      type: 'array',
      minItems: INTEX_AGENT_MODEL_OPTIONS.length,
      maxItems: INTEX_AGENT_MODEL_OPTIONS.length,
      items: INTEX_AGENT_MODEL_OPTIONS.map(({ id, label }) => ({ const: { id, label } })),
      additionalItems: false,
    },
  ],
} as const;

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

export const llmKeysRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /users/:uid/settings/llm-keys
  fastify.get(
    '/users/:uid/settings/llm-keys',
    {
      schema: {
        operationId: 'getLlmApiKeys',
        summary: 'Get configured LLM API keys',
        description:
          'Get which LLM providers have API keys configured. Returns masked key indicators.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'LLM API keys status retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  defaultModel: { type: 'string', nullable: true },
                  fallbackModel: { type: 'string', nullable: true },
                  openai: { type: 'string', nullable: true },
                  anthropic: { type: 'string', nullable: true },
                  perplexity: { type: 'string', nullable: true },
                  openrouter: { type: 'string', nullable: true },
                  testResults: {
                    type: 'object',
                    properties: {
                      openai: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          status: { type: 'string', enum: ['success', 'failure'] },
                          message: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                        required: ['status', 'message', 'testedAt'],
                      },
                      anthropic: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          status: { type: 'string', enum: ['success', 'failure'] },
                          message: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                        required: ['status', 'message', 'testedAt'],
                      },
                      perplexity: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          status: { type: 'string', enum: ['success', 'failure'] },
                          message: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                        required: ['status', 'message', 'testedAt'],
                      },
                      openrouter: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          status: { type: 'string', enum: ['success', 'failure'] },
                          message: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                        required: ['status', 'message', 'testedAt'],
                      },
                    },
                  },
                  intexAgentModelSelector: {
                    oneOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          status: { const: 'available' },
                          explicitModel: {
                            type: ['string', 'null'],
                            enum: [...INTEG_AGENT_MODEL_IDS, null],
                          },
                          effectiveModel: {
                            type: 'string',
                            enum: INTEG_AGENT_MODEL_IDS,
                          },
                          source: { type: 'string', enum: ['explicit', 'default_absent'] },
                          revision: { type: 'integer', minimum: 0 },
                          options: INTEG_AGENT_SELECTOR_OPTIONS_SCHEMA,
                        },
                        allOf: [intexAgentProjectionConsistencySchema()],
                        required: ['status', 'explicitModel', 'effectiveModel', 'source', 'revision', 'options'],
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: { status: { const: 'unavailable' } },
                        required: ['status'],
                      },
                    ],
                  },
                },
                required: ['defaultModel', 'fallbackModel', 'openai', 'anthropic', 'perplexity', 'openrouter', 'testResults', 'intexAgentModelSelector'],
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
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
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
        message: 'GET /users/:uid/settings/llm-keys',
        bodyPreviewLength: 0,
        includeParams: false,
        includeHeaders: false,
      });

      try {
        const user = await requireAuth(request, reply);
        if (!user) {
          return;
        }

        const params = request.params as { uid: string };

        if (params.uid !== user.userId) {
          return await reply.fail('FORBIDDEN', 'Cannot access other user settings');
        }

        const { userSettingsRepository, intexAgentModelAvailability } = getServices();
        const available = await intexAgentModelAvailability.isAvailableForUser(params.uid);
        const selectorResult = await userSettingsRepository.getIntexAgentModelState(params.uid);

        if (!selectorResult.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to load Intex Agent model selector');
        }
        if (selectorResult.value.status === 'invalid_stored_value') {
          return await reply.fail('INTERNAL_ERROR', 'Intex Agent model selector state is invalid');
        }

        const result = await userSettingsRepository.getSettings(params.uid);

        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to get LLM keys');
        }

        const settings = result.value;
        const llmApiKeys = settings?.llmApiKeys;
        const llmTestResults = settings?.llmTestResults;
        const { encryptor } = getServices();

        // Decrypt and mask keys for display
        const getMaskedKey = (encryptedKey: EncryptedValue | undefined): string | null => {
          if (encryptedKey === undefined || encryptor === null) return null;
          const decrypted = encryptor.decrypt(encryptedKey);
          if (!decrypted.ok) return null;
          return maskApiKey(decrypted.value);
        };

        return await reply.ok({
          defaultModel: normalizeLegacyPreference(settings?.llmPreferences?.defaultModel),
          fallbackModel: normalizeLegacyPreference(settings?.llmPreferences?.fallbackModel),
          openai: getMaskedKey(llmApiKeys?.openai),
          anthropic: getMaskedKey(llmApiKeys?.anthropic),
          perplexity: getMaskedKey(llmApiKeys?.perplexity),
          openrouter: getMaskedKey(llmApiKeys?.openrouter),
          testResults: {
            openai: llmTestResults?.openai ?? null,
            anthropic: llmTestResults?.anthropic ?? null,
            perplexity: llmTestResults?.perplexity ?? null,
            openrouter: llmTestResults?.openrouter ?? null,
          },
          intexAgentModelSelector: available
            ? {
                status: 'available' as const,
                explicitModel: selectorResult.value.explicitModel,
                effectiveModel: selectorResult.value.explicitModel ?? DEFAULT_INTEX_AGENT_MODEL,
                source: selectorResult.value.explicitModel === null ? ('default_absent' as const) : ('explicit' as const),
                revision: selectorResult.value.revision,
                options: INTEX_AGENT_MODEL_OPTIONS.map(({ id, label }) => ({ id, label })),
              }
            : { status: 'unavailable' as const },
        });
      } catch (_error) {
        request.log.error('Unhandled error in getLlmApiKeys');
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', 'Failed to get LLM keys');
      }
    }
  );

  // PATCH /users/:uid/settings/llm-keys
  fastify.patch(
    '/users/:uid/settings/llm-keys',
    {
      schema: {
        operationId: 'updateLlmApiKey',
        summary: 'Set or update an LLM API key',
        description: 'Encrypt and store an API key for the specified LLM provider.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        body: {
          type: 'object',
          required: ['provider', 'apiKey'],
          properties: {
            provider: {
              type: 'string',
              enum: EXECUTABLE_LLM_PROVIDERS,
              description: 'LLM provider name',
            },
            apiKey: {
              type: 'string',
              minLength: 10,
              description: 'API key to store',
            },
          },
        },
        response: {
          200: {
            description: 'API key stored successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
                  masked: { type: 'string' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
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
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          503: {
            description: 'Encryption not configured',
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
        message: 'PATCH /users/:uid/settings/llm-keys',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body = request.body as { provider: ExecutableLlmProvider; apiKey: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      const { userSettingsRepository, encryptor, llmValidator } = getServices();

      // Validate API key with actual provider (skipped if llmValidator is null, e.g., in tests)
      if (llmValidator !== null) {
        const validationResult = await llmValidator.validateKey(
          body.provider,
          body.apiKey,
          params.uid
        );
        if (!validationResult.ok) {
          return await reply.fail('INVALID_REQUEST', validationResult.error.message);
        }
      }

      if (encryptor === null) {
        return await reply.fail('MISCONFIGURED', 'Encryption is not configured');
      }

      const encryptResult = encryptor.encrypt(body.apiKey);
      if (!encryptResult.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to encrypt API key');
      }

      const updateResult = await userSettingsRepository.updateLlmApiKey(
        params.uid,
        body.provider,
        encryptResult.value
      );

      if (!updateResult.ok) {
        return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
      }

      return await reply.ok({
        provider: body.provider,
        masked: maskApiKey(body.apiKey),
      });
    }
  );

  // POST /users/:uid/settings/llm-keys/:provider/test
  fastify.post(
    '/users/:uid/settings/llm-keys/:provider/test',
    {
      schema: {
        operationId: 'testLlmApiKey',
        summary: 'Test an LLM API key',
        description: 'Make a test request to the LLM provider with a sample prompt.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
            provider: {
              type: 'string',
              enum: EXECUTABLE_LLM_PROVIDERS,
              description: 'LLM provider name',
            },
          },
          required: ['uid', 'provider'],
        },
        response: {
          200: {
            description: 'Test completed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['success', 'failure'] },
                  message: { type: 'string' },
                  testedAt: { type: 'string' },
                },
                required: ['status', 'message', 'testedAt'],
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
          404: {
            description: 'API key not configured',
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
        message: 'POST /users/:uid/settings/llm-keys/:provider/test',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string; provider: ExecutableLlmProvider };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot test other user settings');
      }

      const { userSettingsRepository, encryptor, llmValidator } = getServices();

      if (encryptor === null) {
        return await reply.fail('MISCONFIGURED', 'Encryption is not configured');
      }

      if (llmValidator === null) {
        return await reply.fail('MISCONFIGURED', 'LLM validation is not configured');
      }

      const result = await userSettingsRepository.getSettings(params.uid);
      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const settings = result.value;
      const encryptedKey = settings?.llmApiKeys?.[params.provider];

      if (encryptedKey === undefined) {
        return await reply.fail('NOT_FOUND', 'API key not configured for this provider');
      }

      const decrypted = encryptor.decrypt(encryptedKey);
      if (!decrypted.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to decrypt API key');
      }

      const providerNameMap: Record<ExecutableLlmProvider, string> = {
        openai: 'GPT',
        anthropic: 'Claude',
        perplexity: 'Perplexity',
        openrouter: 'OpenRouter',
      };
      const providerName = providerNameMap[params.provider];
      const testPrompt = `Introduce yourself as ${providerName} and welcome the user to their intelligent workspace. Say you're here to intelligently improve their experience. Keep it to 2-3 sentences. Start with "Hi! I'm ${providerName}."`;
      const testResult = await llmValidator.testRequest(
        params.provider,
        decrypted.value,
        testPrompt,
        params.uid
      );

      const testedAt = new Date().toISOString();

      if (!testResult.ok) {
        const rawError = testResult.error.message;
        request.log.warn({ provider: params.provider, rawError }, 'LLM test failed');

        const formattedMessage = formatLlmError(rawError);
        const llmTestResult: LlmTestResult = {
          status: 'failure',
          message: formattedMessage,
          testedAt,
        };
        await userSettingsRepository.updateLlmTestResult(params.uid, params.provider, llmTestResult);
        return await reply.ok({
          status: 'failure',
          message: formattedMessage,
          testedAt,
        });
      }

      const llmTestResult: LlmTestResult = {
        status: 'success',
        message: testResult.value.content,
        testedAt,
      };
      await userSettingsRepository.updateLlmTestResult(params.uid, params.provider, llmTestResult);

      return await reply.ok({
        status: 'success',
        message: testResult.value.content,
        testedAt,
      });
    }
  );

  // DELETE /users/:uid/settings/llm-keys/:provider
  fastify.delete(
    '/users/:uid/settings/llm-keys/:provider',
    {
      schema: {
        operationId: 'deleteLlmApiKey',
        summary: 'Delete an LLM API key',
        description: 'Remove the stored API key for the specified LLM provider.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
            provider: {
              type: 'string',
              enum: [...EXECUTABLE_LLM_PROVIDERS, LlmProviders.Google],
              description: 'LLM provider name',
            },
          },
          required: ['uid', 'provider'],
        },
        response: {
          200: {
            description: 'API key deleted successfully',
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
          403: {
            description: 'Forbidden',
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
      logIncomingRequest(request, { message: 'DELETE /users/:uid/settings/llm-keys/:provider' });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string; provider: DeletableLlmProvider };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot delete other user settings');
      }

      const { userSettingsRepository } = getServices();

      const deleteResult = await userSettingsRepository.deleteLlmApiKey(
        params.uid,
        params.provider
      );

      if (!deleteResult.ok) {
        return await reply.fail('INTERNAL_ERROR', deleteResult.error.message);
      }

      // Cascade: clear defaultModel/fallbackModel if they belong to the deleted provider
      const settingsResult = await userSettingsRepository.getSettings(params.uid);
      if (settingsResult.ok) {
        const prefs = settingsResult.value?.llmPreferences;
        const currentDefault = prefs?.defaultModel;
        const currentFallback = prefs?.fallbackModel;

        let shouldClearAll = false;
        if (currentDefault !== undefined) {
          const defaultProvider = getProviderForModel(currentDefault);
          if (defaultProvider === params.provider) {
            shouldClearAll = true;
          }
        }

        let shouldClearFallback = false;
        if (currentFallback !== undefined) {
          const fallbackProvider = getProviderForModel(currentFallback);
          if (fallbackProvider === params.provider) {
            shouldClearFallback = true;
          }
        }

        if (shouldClearAll) {
          const clearResult = await userSettingsRepository.clearLlmPreferences(params.uid);
          if (!clearResult.ok) {
            request.log.warn({ userId: params.uid }, 'Failed to cascade-clear LLM preferences after key deletion');
          }
        } else if (shouldClearFallback && currentDefault !== undefined) {
          const clearResult = await userSettingsRepository.updateLlmPreferences(params.uid, currentDefault, null);
          if (!clearResult.ok) {
            request.log.warn({ userId: params.uid }, 'Failed to cascade-clear fallback model after key deletion');
          }
        }
      }

      return await reply.ok({});
    }
  );

  done();
};
