import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';

const MAX_INSTRUCTIONS_LENGTH = 5000;

const putPreferencesBodySchema = {
  type: 'object',
  required: ['instructions'],
  properties: {
    instructions: { type: 'string', maxLength: MAX_INSTRUCTIONS_LENGTH },
  },
} as const;

function normalizeInstructions(value: string): string {
  return value.trim();
}

export const preferencesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/preferences',
    {
      schema: {
        operationId: 'getIntexAgentPreferences',
        summary: 'Get INTEX Agent preferences',
        description: 'Get per-user instructions/preferences injected into the INTEX Agent prompt.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { preferencesRepository } = getServices();
      const preferences = await preferencesRepository.getPreferences(user.userId);
      return await reply.ok({
        instructions: preferences?.instructions ?? '',
        updatedAt: preferences?.updatedAt ?? null,
      });
    }
  );

  fastify.put<{ Body: { instructions: string } }>(
    '/preferences',
    {
      schema: {
        operationId: 'saveIntexAgentPreferences',
        summary: 'Save INTEX Agent preferences',
        description:
          'Save per-user instructions/preferences injected into the INTEX Agent prompt. Overwrites existing preferences for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        body: putPreferencesBodySchema,
      },
    },
    async (request: FastifyRequest<{ Body: { instructions: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const instructions = normalizeInstructions(request.body.instructions);
      if (instructions === '') {
        return await reply.fail(
          'INVALID_REQUEST',
          'instructions cannot be empty. Send DELETE /preferences to clear preferences.'
        );
      }

      const { preferencesRepository } = getServices();
      const saved = await preferencesRepository.savePreferences(user.userId, { instructions });
      return await reply.ok({
        instructions: saved.instructions,
        updatedAt: saved.updatedAt,
      });
    }
  );

  fastify.delete(
    '/preferences',
    {
      schema: {
        operationId: 'clearIntexAgentPreferences',
        summary: 'Clear INTEX Agent preferences',
        description:
          'Clear per-user instructions/preferences for the INTEX Agent prompt.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { preferencesRepository } = getServices();
      await preferencesRepository.deletePreferences(user.userId);
      return await reply.ok({ instructions: '', updatedAt: null });
    }
  );

  done();
};

export const preferencesRouteConfig = {
  MAX_INSTRUCTIONS_LENGTH,
} as const;