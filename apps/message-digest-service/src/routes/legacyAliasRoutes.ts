import type { FastifyPluginAsync } from 'fastify';
import { getSafeRequestRoute, logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { resolveLegacyDigestRun } from '../domain/usecases/queryLegacyMessageDigests.js';
import { getServices } from '../services.js';
import { messageDigestResponseSchema } from './messageDigestSchemas.js';

interface LegacyAliasParams {
  groupKey: string;
  date: string;
}

const legacyAliasParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['groupKey', 'date'],
  properties: {
    groupKey: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

export const legacyAliasRoutes: FastifyPluginAsync = (app) => {
  app.get<{ Params: LegacyAliasParams }>(
    '/legacy-runs/:groupKey/:date',
    {
      schema: {
        operationId: 'resolveLegacyMessageDigestRun',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: legacyAliasParamsSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Message Digest legacy alias request',
        bodyPreviewLength: 0,
        includeHeaders: false,
        includeParams: false,
        additionalFields: {
          method: request.method,
          route: getSafeRequestRoute(request),
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await resolveLegacyDigestRun(
        {
          userId: user.userId,
          legacyGroupKey: request.params.groupKey,
          date: request.params.date,
        },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await reply.fail('NOT_FOUND', 'Message Digest run not found');
      return await reply.ok({
        definitionId: result.definitionId,
        runId: result.runId,
      });
    }
  );
  return Promise.resolve();
};
