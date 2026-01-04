/**
 * Internal Routes for service-to-service communication.
 * These routes are authenticated via X-Internal-Auth header.
 *
 * GET /internal/users/:uid/llm-keys - Get decrypted LLM API keys for a user
 * POST /internal/users/:uid/llm-keys/:provider/last-used - Update last used timestamp
 * GET /internal/users/:uid/research-settings - Get research settings for a user
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { LlmProvider } from '../domain/settings/index.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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
              google: { type: 'string', nullable: true },
              openai: { type: 'string', nullable: true },
              anthropic: { type: 'string', nullable: true },
              perplexity: { type: 'string', nullable: true },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
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
          { reason: authResult.reason },
          'Internal auth failed for users/:uid/llm-keys endpoint'
        );
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const params = request.params as { uid: string };
      const { userSettingsRepository, encryptor } = getServices();

      const result = await userSettingsRepository.getSettings(params.uid);

      if (!result.ok) {
        return {
          google: null,
          openai: null,
          anthropic: null,
        };
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

      return {
        google: getDecryptedKey('google'),
        openai: getDecryptedKey('openai'),
        anthropic: getDecryptedKey('anthropic'),
        perplexity: getDecryptedKey('perplexity'),
      };
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
              enum: ['google', 'openai', 'anthropic'],
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
              error: { type: 'string' },
            },
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
          { reason: authResult.reason },
          'Internal auth failed for llm-keys/:provider/last-used endpoint'
        );
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const params = request.params as { uid: string; provider: LlmProvider };
      const { userSettingsRepository } = getServices();

      await userSettingsRepository.updateLlmLastUsed(params.uid, params.provider);

      reply.status(204);
      return;
    }
  );

  done();
};
