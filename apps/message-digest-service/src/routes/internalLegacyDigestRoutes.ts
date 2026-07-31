import type { FastifyPluginAsync } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  queryLegacyDigestDefinitions,
  queryLegacyDigestRuns,
} from '../domain/usecases/queryLegacyMessageDigests.js';
import { getServices } from '../services.js';
import { messageDigestResponseSchema } from './messageDigestSchemas.js';

interface LegacyDefinitionQueryBody {
  userId: string;
  legacyGroupKey: string;
}

interface LegacyRunQueryBody extends LegacyDefinitionQueryBody {
  fromDate?: string | undefined;
  toDate?: string | undefined;
  terms?: string[] | undefined;
  limit: number;
  cursor?: string | undefined;
}

const aliasProperties = {
  userId: { type: 'string', minLength: 1, maxLength: 256 },
  legacyGroupKey: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  },
} as const;

const legacyDefinitionQueryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'legacyGroupKey'],
  properties: aliasProperties,
} as const;

const legacyRunQueryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'legacyGroupKey', 'limit'],
  properties: {
    ...aliasProperties,
    fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    toDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    terms: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string', minLength: 1, maxLength: 4_096 },
  },
} as const;

export const internalLegacyDigestRoutes: FastifyPluginAsync = (app) => {
  app.post<{ Body: LegacyDefinitionQueryBody }>(
    '/internal/message-digests/definitions/query',
    {
      schema: {
        operationId: 'queryLegacyMessageDigestDefinitions',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: legacyDefinitionQueryBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      logLegacyQuery(request, 'definitions');
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Message Digest internal authentication failed');
      }
      const result = await queryLegacyDigestDefinitions(request.body, {
        store: getServices().messageDigestStore,
      });
      if (!result.ok) return await reply.fail('INVALID_REQUEST', 'Invalid legacy digest query');
      return await reply.ok({ items: result.items });
    }
  );

  app.post<{ Body: LegacyRunQueryBody }>(
    '/internal/message-digests/runs/query',
    {
      schema: {
        operationId: 'queryLegacyMessageDigestRuns',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: legacyRunQueryBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      logLegacyQuery(request, 'runs');
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Message Digest internal authentication failed');
      }
      const result = await queryLegacyDigestRuns(request.body, {
        store: getServices().messageDigestStore,
      });
      if (!result.ok) return await reply.fail('INVALID_REQUEST', 'Invalid legacy digest query');
      return await reply.ok({
        items: result.items,
        truncated: result.truncated,
        nextCursor: result.nextCursor,
      });
    }
  );
  return Promise.resolve();
};

function logLegacyQuery(
  request: Parameters<typeof logIncomingRequest>[0],
  operation: 'definitions' | 'runs'
): void {
  logIncomingRequest(request, {
    message: 'Received bounded legacy Message Digest query',
    bodyPreviewLength: 0,
    includeHeaders: false,
    includeParams: false,
    additionalFields: { operation },
  });
}
