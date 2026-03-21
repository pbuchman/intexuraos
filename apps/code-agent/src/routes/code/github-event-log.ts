import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { CodeRoutesOptions } from './github-pre-events.js';
import type { GitHubEventLogEntry } from '../../domain/models/gitHubEventLogEntry.js';
import type { GitHubWebhookAuditEvent } from '../../domain/models/gitHubWebhookAuditEvent.js';
import type { EventDecision, EventDecisionReviewType } from '../../domain/models/eventDecision.js';
import { ALL_REVIEW_TYPES } from '../../domain/constants/reviewTypes.js';
import { VISIBLE_EVENT_TYPES } from '../../domain/constants/visibleEventTypes.js';

interface GitHubEventLogRow {
  id: string;
  decisionId: string | null;
  normalizedEventId: string | null;
  deliveryId: string | null;
  githubEventName: string;
  eventType: string;
  action: string | null;
  repository: string | null;
  repositoryId: number | null;
  pullRequestNumber: number | null;
  pullRequestId: number | null;
  senderLogin: string | null;
  senderType: string | null;
  authPassedAt: string;
  updatedAt: string;
  decisionState: 'pending' | 'completed';
  decisionOutcome: 'dispatch' | 'skip' | 'request_review' | null;
  decidedBy: 'hard_rules' | 'github_agent' | 'webhook_route' | null;
  reason: string | null;
  dispatchAction: 'create_task' | 'send_message' | 'create_review_task' | null;
  reviewTypes: EventDecisionReviewType[];
  taskId: string | null;
  workerType: string | null;
  decisionLatencyMs: number | null;
}

const listQuerySchema = {
  type: 'object',
  properties: {
    limit: { type: 'number', minimum: 1, maximum: 100, default: 100 },
    cursor: { type: 'string' },
  },
};

const rowsBodySchema = {
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string' },
    },
  },
  required: ['ids'],
};

const rowSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    decisionId: { type: ['string', 'null'] },
    normalizedEventId: { type: ['string', 'null'] },
    deliveryId: { type: ['string', 'null'] },
    githubEventName: { type: 'string' },
    eventType: { type: 'string' },
    action: { type: ['string', 'null'] },
    repository: { type: ['string', 'null'] },
    repositoryId: { type: ['number', 'null'] },
    pullRequestNumber: { type: ['number', 'null'] },
    pullRequestId: { type: ['number', 'null'] },
    senderLogin: { type: ['string', 'null'] },
    senderType: { type: ['string', 'null'] },
    authPassedAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    decisionState: { type: 'string', enum: ['pending', 'completed'] },
    decisionOutcome: { type: ['string', 'null'], enum: ['dispatch', 'skip', 'request_review', null] },
    decidedBy: { type: ['string', 'null'], enum: ['hard_rules', 'github_agent', 'webhook_route', null] },
    reason: { type: ['string', 'null'] },
    dispatchAction: { type: ['string', 'null'], enum: ['create_task', 'send_message', 'create_review_task', null] },
    reviewTypes: {
      type: 'array',
      items: { type: 'string', enum: [...ALL_REVIEW_TYPES] },
    },
    taskId: { type: ['string', 'null'] },
    workerType: { type: ['string', 'null'] },
    decisionLatencyMs: { type: ['number', 'null'] },
  },
  required: [
    'id',
    'decisionId',
    'normalizedEventId',
    'deliveryId',
    'githubEventName',
    'eventType',
    'action',
    'repository',
    'repositoryId',
    'pullRequestNumber',
    'pullRequestId',
    'senderLogin',
    'senderType',
    'authPassedAt',
    'updatedAt',
    'decisionState',
    'decisionOutcome',
    'decidedBy',
    'reason',
    'dispatchAction',
    'reviewTypes',
    'taskId',
    'workerType',
    'decisionLatencyMs',
  ],
};

const rowsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: rowSchema,
        },
        nextCursor: { type: 'string' },
      },
      required: ['rows'],
    },
  },
  required: ['success', 'data'],
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
};

function buildRow(
  entry: GitHubEventLogEntry,
  auditEvent: GitHubWebhookAuditEvent | undefined,
  decision: EventDecision | undefined,
): GitHubEventLogRow {
  const dispatchParams = decision?.dispatchParams;

  return {
    id: entry.id,
    decisionId: decision?.id ?? entry.decisionId,
    normalizedEventId: decision?.normalizedEventId ?? null,
    deliveryId: auditEvent?.deliveryId ?? null,
    githubEventName: entry.githubEventName,
    eventType: entry.eventType,
    action: entry.action,
    repository: auditEvent?.repository ?? entry.repository,
    repositoryId: auditEvent?.repositoryId ?? null,
    pullRequestNumber: auditEvent?.pullRequestNumber ?? entry.pullRequestNumber,
    pullRequestId: auditEvent?.pullRequestId ?? null,
    senderLogin: decision?.senderLogin ?? auditEvent?.senderLogin ?? null,
    senderType: auditEvent?.senderType ?? null,
    authPassedAt: entry.authPassedAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    decisionState: entry.decisionState,
    decisionOutcome: entry.decisionOutcome,
    decidedBy: decision?.decidedBy ?? null,
    reason: decision?.reason ?? null,
    dispatchAction: decision?.dispatchAction ?? null,
    reviewTypes: dispatchParams?.reviewTypes ?? [],
    taskId: dispatchParams?.taskId ?? null,
    workerType: dispatchParams?.workerType ?? null,
    decisionLatencyMs: decision?.decisionLatencyMs ?? null,
  };
}

async function hydrateRows(entries: GitHubEventLogEntry[]): Promise<GitHubEventLogRow[]> {
  const { gitHubWebhookAuditEventRepo, eventDecisionRepo } = getServices();
  const ids = entries.map((entry) => entry.id);

  const auditEvents = gitHubWebhookAuditEventRepo !== undefined
    ? await gitHubWebhookAuditEventRepo.findByIds(ids)
    : { ok: true as const, value: [] };
  const decisions = eventDecisionRepo.findByEventIds !== undefined
    ? await eventDecisionRepo.findByEventIds(ids)
    : { ok: true as const, value: [] };

  if (!auditEvents.ok) {
    throw new Error(auditEvents.error.message);
  }
  if (!decisions.ok) {
    throw new Error(decisions.error.message);
  }

  const auditById = new Map(auditEvents.value.map((event) => [event.id, event]));
  const decisionByEventId = new Map(decisions.value.map((decision) => [decision.eventId, decision]));

  return entries.map((entry) => buildRow(
    entry,
    auditById.get(entry.id),
    decisionByEventId.get(entry.id),
  ));
}

const githubEventLogRoute: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((secured) => {
    secured.addHook('onRequest', jwtValidator);

    secured.get<{
      Querystring: { limit?: number; cursor?: string };
    }>(
      '/code/github-event-log',
      {
        schema: {
          querystring: listQuerySchema,
          response: {
            200: rowsResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (
        request: FastifyRequest<{ Querystring: { limit?: number; cursor?: string } }>,
        reply: FastifyReply,
      ) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/github-event-log',
        });

        const { gitHubEventLogEntryRepo } = getServices();
        if (gitHubEventLogEntryRepo === undefined) {
          return await reply.fail('INTERNAL_ERROR', 'GitHub event log repository is not configured');
        }

        /* v8 ignore start -- schema: Fastify query schema default always populates limit, so nullish fallback is not reachable at runtime @preserve */
        const limit = request.query.limit ?? 100;
        /* v8 ignore stop @preserve */
        const cursor = request.query.cursor;
        if (cursor !== undefined) {
          const cursorDate = new Date(cursor);
          if (Number.isNaN(cursorDate.getTime())) {
            return await reply.fail('INVALID_REQUEST', 'Cursor must be a valid ISO date string');
          }
        }

        const result = await gitHubEventLogEntryRepo.listRecent({
          limit,
          ...(cursor !== undefined && { cursor }),
          eventTypes: VISIBLE_EVENT_TYPES,
        });

        if (!result.ok) {
          request.log.error({ error: result.error }, 'Failed to list GitHub event log entries');
          return await reply.fail('INTERNAL_ERROR', 'Failed to list GitHub event log entries');
        }

        try {
          const rows = await hydrateRows(result.value.entries);
          return await reply.ok({
            rows,
            ...(result.value.nextCursor !== undefined && { nextCursor: result.value.nextCursor }),
          });
        } catch (error) {
          request.log.error({ error }, 'Failed to hydrate GitHub event log rows');
          return await reply.fail('INTERNAL_ERROR', 'Failed to hydrate GitHub event log rows');
        }
      }
    );

    secured.get<{
      Params: { id: string };
    }>(
      '/code/github-event-log/:id/payload',
      {
        schema: {
          params: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  properties: {
                    payload: {},
                  },
                  required: ['payload'],
                },
              },
              required: ['success', 'data'],
            },
            401: errorResponseSchema,
            404: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: `Received request to GET /code/github-event-log/${request.params.id}/payload`,
        });

        const { gitHubWebhookAuditEventRepo } = getServices();
        if (gitHubWebhookAuditEventRepo === undefined) {
          return await reply.fail('INTERNAL_ERROR', 'GitHub webhook audit event repository is not configured');
        }

        const result = await gitHubWebhookAuditEventRepo.findByIds([request.params.id]);
        if (!result.ok) {
          request.log.error({ error: result.error }, 'Failed to load audit event');
          return await reply.fail('INTERNAL_ERROR', 'Failed to load audit event');
        }

        const auditEvent = result.value[0];
        if (auditEvent === undefined) {
          return await reply.fail('NOT_FOUND', `Audit event not found for id: ${request.params.id}`);
        }

        return await reply.ok({ payload: auditEvent.payload ?? null });
      }
    );

    secured.post<{
      Body: { ids: string[] };
    }>(
      '/code/github-event-log/rows',
      {
        schema: {
          body: rowsBodySchema,
          response: {
            200: rowsResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request: FastifyRequest<{ Body: { ids: string[] } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/github-event-log/rows',
        });

        const { gitHubEventLogEntryRepo } = getServices();
        if (gitHubEventLogEntryRepo === undefined) {
          return await reply.fail('INTERNAL_ERROR', 'GitHub event log repository is not configured');
        }

        const result = await gitHubEventLogEntryRepo.findByIds(request.body.ids);
        if (!result.ok) {
          request.log.error({ error: result.error }, 'Failed to load GitHub event log entries');
          return await reply.fail('INTERNAL_ERROR', 'Failed to load GitHub event log entries');
        }

        const entryById = new Map(result.value.map((entry) => [entry.id, entry]));
        const orderedEntries = request.body.ids
          .map((id) => entryById.get(id))
          .filter((entry): entry is GitHubEventLogEntry => entry !== undefined);

        try {
          const rows = await hydrateRows(orderedEntries);
          return await reply.ok({ rows });
        } catch (error) {
          request.log.error({ error }, 'Failed to hydrate GitHub event log rows');
          return await reply.fail('INTERNAL_ERROR', 'Failed to hydrate GitHub event log rows');
        }
      }
    );
  });
};

export default githubEventLogRoute;
