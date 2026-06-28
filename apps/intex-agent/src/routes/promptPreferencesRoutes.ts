import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';
import { PromptPreferencesError } from '../domain/preferences/promptPreferences.js';

const preferenceItemBodySchema = {
  type: 'object',
  required: ['text', 'expectedVersion'],
  properties: {
    text: { type: 'string' },
    expectedVersion: { type: 'integer', minimum: 0 },
  },
} as const;

const deletePreferenceItemBodySchema = {
  type: 'object',
  required: ['expectedVersion'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 0 },
  },
} as const;

interface PreferenceItemBody {
  text: string;
  expectedVersion: number;
}

interface DeletePreferenceItemBody {
  expectedVersion: number;
}

interface PreferenceItemParams {
  itemId: string;
}

interface VersionParams {
  version: string;
}

export const promptPreferencesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/preferences/prompt',
    {
      schema: {
        operationId: 'getIntexAgentPromptPreferences',
        summary: 'Get INTEX Agent prompt preferences',
        description: 'Get current itemized INTEX Agent prompt preferences for the authenticated user.',
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

      const { promptPreferencesRepository } = getServices();
      const preferences = await promptPreferencesRepository.getCurrent(user.userId);
      return await reply.ok(preferences);
    }
  );

  fastify.post<{ Body: PreferenceItemBody }>(
    '/preferences/prompt/items',
    {
      schema: {
        operationId: 'addIntexAgentPromptPreferenceItem',
        summary: 'Add INTEX Agent prompt preference',
        description: 'Add one itemized prompt preference for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        body: preferenceItemBodySchema,
      },
    },
    async (request: FastifyRequest<{ Body: PreferenceItemBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      try {
        const { promptPreferencesRepository } = getServices();
        const preferences = await promptPreferencesRepository.addItem({
          userId: user.userId,
          text: request.body.text,
          expectedVersion: request.body.expectedVersion,
          updatedBy: { actor: 'web_ui', userId: user.userId },
        });
        return await reply.ok(preferences);
      } catch (error) {
        return await sendPromptPreferencesError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: PreferenceItemParams; Body: PreferenceItemBody }>(
    '/preferences/prompt/items/:itemId',
    {
      schema: {
        operationId: 'updateIntexAgentPromptPreferenceItem',
        summary: 'Update INTEX Agent prompt preference',
        description: 'Update one current itemized prompt preference for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['itemId'],
          properties: {
            itemId: { type: 'string' },
          },
        },
        body: preferenceItemBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: PreferenceItemParams; Body: PreferenceItemBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      try {
        const { promptPreferencesRepository } = getServices();
        const preferences = await promptPreferencesRepository.updateItem({
          userId: user.userId,
          itemId: request.params.itemId,
          text: request.body.text,
          expectedVersion: request.body.expectedVersion,
          updatedBy: { actor: 'web_ui', userId: user.userId },
        });
        return await reply.ok(preferences);
      } catch (error) {
        return await sendPromptPreferencesError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: PreferenceItemParams; Body: DeletePreferenceItemBody }>(
    '/preferences/prompt/items/:itemId',
    {
      schema: {
        operationId: 'deleteIntexAgentPromptPreferenceItem',
        summary: 'Delete INTEX Agent prompt preference',
        description: 'Remove one item from current INTEX Agent prompt preferences.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['itemId'],
          properties: {
            itemId: { type: 'string' },
          },
        },
        body: deletePreferenceItemBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: PreferenceItemParams; Body: DeletePreferenceItemBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      try {
        const { promptPreferencesRepository } = getServices();
        const preferences = await promptPreferencesRepository.deleteItem({
          userId: user.userId,
          itemId: request.params.itemId,
          expectedVersion: request.body.expectedVersion,
          updatedBy: { actor: 'web_ui', userId: user.userId },
        });
        return await reply.ok(preferences);
      } catch (error) {
        return await sendPromptPreferencesError(reply, error);
      }
    }
  );

  fastify.get(
    '/preferences/prompt/versions',
    {
      schema: {
        operationId: 'listIntexAgentPromptPreferenceVersions',
        summary: 'List INTEX Agent prompt preference versions',
        description: 'List immutable prompt-preference version summaries for the authenticated user.',
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

      const { promptPreferencesRepository } = getServices();
      const versions = await promptPreferencesRepository.listVersions(user.userId);
      return await reply.ok(versions);
    }
  );

  fastify.get<{ Params: VersionParams }>(
    '/preferences/prompt/versions/:version',
    {
      schema: {
        operationId: 'getIntexAgentPromptPreferenceVersion',
        summary: 'Get INTEX Agent prompt preference version',
        description: 'Get one immutable prompt-preference version snapshot for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['version'],
          properties: {
            version: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: VersionParams }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const parsedVersion = parsePositiveInteger(request.params.version);
      if (parsedVersion === null) {
        return await reply.fail('INVALID_REQUEST', 'version must be a positive integer');
      }

      const { promptPreferencesRepository } = getServices();
      const version = await promptPreferencesRepository.getVersion(user.userId, parsedVersion);
      if (version === null) {
        return await reply.fail('NOT_FOUND', 'Preference version not found');
      }
      return await reply.ok(version);
    }
  );

  done();
};

async function sendPromptPreferencesError(
  reply: FastifyReply,
  error: unknown
): Promise<FastifyReply> {
  if (error instanceof PromptPreferencesError) {
    if (error.code === 'VERSION_CONFLICT') {
      return await reply.fail('VERSION_CONFLICT', error.message, undefined, {
        current: error.current ?? null,
      });
    }
    return await reply.fail(error.code, error.message);
  }

  return await reply.fail('INTERNAL_ERROR', 'Internal error');
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
