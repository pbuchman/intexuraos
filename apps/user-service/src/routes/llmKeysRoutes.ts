/**
 * LLM API Keys Routes
 *
 * GET    /users/:uid/settings/llm-keys           - Get configured LLM providers (masked)
 * PATCH  /users/:uid/settings/llm-keys           - Set/update a key for a provider
 * DELETE /users/:uid/settings/llm-keys/:provider - Remove a key for a provider
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import type { EncryptedValue } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { maskApiKey, type LlmProvider, type LlmTestResult } from '../domain/settings/index.js';

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
                  google: { type: 'string', nullable: true },
                  openai: { type: 'string', nullable: true },
                  anthropic: { type: 'string', nullable: true },
                  testResults: {
                    type: 'object',
                    properties: {
                      google: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          response: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                      },
                      openai: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          response: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                      },
                      anthropic: {
                        type: 'object',
                        nullable: true,
                        properties: {
                          response: { type: 'string' },
                          testedAt: { type: 'string' },
                        },
                      },
                    },
                  },
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
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot access other user settings');
      }

      const { userSettingsRepository } = getServices();
      const result = await userSettingsRepository.getSettings(params.uid);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
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
        google: getMaskedKey(llmApiKeys?.google),
        openai: getMaskedKey(llmApiKeys?.openai),
        anthropic: getMaskedKey(llmApiKeys?.anthropic),
        testResults: {
          google: llmTestResults?.google ?? null,
          openai: llmTestResults?.openai ?? null,
          anthropic: llmTestResults?.anthropic ?? null,
        },
      });
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
              enum: ['google', 'openai', 'anthropic'],
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
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body = request.body as { provider: LlmProvider; apiKey: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      const { userSettingsRepository, encryptor, llmValidator } = getServices();

      // Validate API key with actual provider (skipped if llmValidator is null, e.g., in tests)
      if (llmValidator !== null) {
        const validationResult = await llmValidator.validateKey(body.provider, body.apiKey);
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
              enum: ['google', 'openai', 'anthropic'],
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
                  response: { type: 'string' },
                  testedAt: { type: 'string' },
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
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string; provider: LlmProvider };

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

      const providerName =
        params.provider === 'google' ? 'Gemini' : params.provider === 'openai' ? 'GPT' : 'Claude';
      const testPrompt = `Introduce yourself as ${providerName} and welcome the user to their intelligent workspace. Say you're here to intelligently improve their experience. Keep it to 2-3 sentences. Start with "Hi! I'm ${providerName}."`;
      const testResult = await llmValidator.testRequest(
        params.provider,
        decrypted.value,
        testPrompt
      );

      if (!testResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', testResult.error.message);
      }

      // Save the test result with timestamp
      const llmTestResult: LlmTestResult = {
        response: testResult.value.content,
        testedAt: new Date().toISOString(),
      };
      await userSettingsRepository.updateLlmTestResult(params.uid, params.provider, llmTestResult);

      return await reply.ok({
        response: testResult.value.content,
        testedAt: llmTestResult.testedAt,
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
              enum: ['google', 'openai', 'anthropic'],
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
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string; provider: LlmProvider };

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

      return await reply.ok(undefined);
    }
  );

  done();
};
