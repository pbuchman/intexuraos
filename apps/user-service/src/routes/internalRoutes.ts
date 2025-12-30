/**
 * Internal Routes for service-to-service communication.
 * These routes are authenticated via X-Internal-Auth header.
 *
 * GET /internal/users/:uid/llm-keys - Get decrypted LLM API keys for a user
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../services.js';
import type { LlmProvider } from '../domain/settings/index.js';

/**
 * Validate internal service-to-service authentication.
 * Reads INTERNAL_AUTH_TOKEN at runtime to support test injection.
 */
function validateInternalAuth(request: FastifyRequest): boolean {
  const internalAuthToken = process.env['INTERNAL_AUTH_TOKEN'] ?? '';
  if (internalAuthToken === '') {
    return false;
  }
  const authHeader = request.headers['x-internal-auth'];
  return authHeader === internalAuthToken;
}

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
      if (!validateInternalAuth(request)) {
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
      };
    }
  );

  done();
};
