/**
 * LLM API Keys Routes
 *
 * GET    /users/:uid/settings/llm-keys           - Get configured LLM providers (masked)
 * PATCH  /users/:uid/settings/llm-keys           - Set/update a key for a provider
 * DELETE /users/:uid/settings/llm-keys/:provider - Remove a key for a provider
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { LlmProvider } from '../domain/settings/index.js';

/**
 * Mask an API key for display.
 * Shows first 4 and last 4 characters.
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
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
                  google: { type: 'string', nullable: true },
                  openai: { type: 'string', nullable: true },
                  anthropic: { type: 'string', nullable: true },
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

      return await reply.ok({
        google: llmApiKeys?.google !== undefined ? 'configured' : null,
        openai: llmApiKeys?.openai !== undefined ? 'configured' : null,
        anthropic: llmApiKeys?.anthropic !== undefined ? 'configured' : null,
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

      const { userSettingsRepository, encryptor } = getServices();

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
