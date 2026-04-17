import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth, requireAuth } from '@intexuraos/common-http';
import { createLlmClient, type LlmClientConfig } from '@intexuraos/llm-factory';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { getServices } from '../services.js';
import { runDigestForGroup } from '../domain/usecases/runDigestForGroup.js';
import { yesterdayCet } from '../domain/usecases/yesterdayCet.js';
import { DIGEST_SUBSCRIPTIONS } from '../domain/digestSubscriptions.js';
import { runRequestSchema, runResponseSchema } from './digestSchemas.js';

const logger = createAppLogger({ name: 'digestRoutes' });

interface ChainNext {
  runId: string;
  remainingDates: readonly string[];
  fromDate: string;
  toDate: string;
}

interface RunBody {
  userId: string;
  groupKey: string;
  date: string;
  chainNext?: ChainNext;
}

function getDigestModel(): string {
  const m = process.env['INTEXURAOS_DIGEST_LLM_MODEL'];
  if (m === undefined || m === '') throw new Error('INTEXURAOS_DIGEST_LLM_MODEL not set');
  return m;
}

function getSelfBaseUrl(): string {
  const fromEnv = process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return 'http://localhost:8080';
}

function buildChainPost() {
  const base = getSelfBaseUrl();
  const token = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  return async (runId: string, userId: string, groupKey: string, date: string, remainingDates: readonly string[]): Promise<void> => {
    try {
      await fetch(`${base}/internal/notifications/digest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-auth': token },
        body: JSON.stringify({ userId, groupKey, date, chainNext: { runId, remainingDates, fromDate: date, toDate: date } }),
      });
    } catch (chainErr) {
      logger.error({ chainErr, runId, date }, 'chain: failed to POST next date');
    }
  };
}

function buildLlmClient(userId: string): ReturnType<typeof createLlmClient> {
  const model = getDigestModel();
  const apiKey = process.env['INTEXURAOS_OPENROUTER_API_KEY'] ?? '';
  const config: LlmClientConfig = {
    apiKey,
    model: model as LlmClientConfig['model'],
    userId,
    logger,
    usageSink: { log: () => Promise.resolve() },
    ownerType: 'system',
  };
  return createLlmClient(config);
}

export const digestRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: RunBody }>(
    '/internal/notifications/digest/run',
    {
      schema: {
        operationId: 'internalRunDigest',
        summary: 'Run digest for a specific (userId, groupKey, date)',
        tags: ['mobile-notifications'],
        body: runRequestSchema,
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { const: true, type: 'boolean' },
              data: runResponseSchema,
            },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const authResult = validateInternalAuth(req);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'missing or invalid internal auth');
      }
      const { userId, groupKey, date, chainNext } = req.body;
      const llmClient = buildLlmClient(userId);
      const modelId = getDigestModel();
      const holder = chainNext !== undefined ? 'backfill' : 'manual';
      const result = await runDigestForGroup(
        { llmClient, logger, modelId },
        { userId, groupKey, date, holder },
      );

      if (chainNext !== undefined) {
        const { runId, remainingDates } = chainNext;
        if (result.ok) {
          void getServices().backfillRunRepository.update(runId, {
            completedDates: [],
            currentDate: remainingDates[0] ?? null,
          });
          if (remainingDates.length > 0) {
            const next = remainingDates[0];
            if (next !== undefined) {
              setTimeout(() => {
                void buildChainPost()(runId, userId, groupKey, next, remainingDates.slice(1));
              }, 1000);
            }
          } else {
            void getServices().backfillRunRepository.update(runId, {
              status: 'completed',
              completedAt: new Date().toISOString(),
            });
          }
        } else {
          void getServices().backfillRunRepository.update(runId, {
            status: 'failed',
            failedDates: [{ date, error: JSON.stringify(result.error) }],
          });
        }
      }

      if (!result.ok) {
        if (result.error.code === 'lock-held') {
          return await reply.ok({ summaryDocId: '', generation: 0, messageCount: 0, modelId, regenerated: false, lockSkipped: true });
        }
        return await reply.fail('INTERNAL_ERROR', JSON.stringify(result.error));
      }
      return await reply.ok({
        summaryDocId: `${userId}_${groupKey}_${date}`,
        generation: result.value.generation,
        messageCount: result.value.summary.messageCount,
        modelId: result.value.modelId,
        regenerated: result.value.regenerated,
      });
    },
  );

  fastify.post(
    '/internal/notifications/digest/run-yesterday',
    {
      schema: {
        operationId: 'internalRunDigestYesterday',
        summary: 'Run digest for all subscriptions for yesterday (CET)',
        tags: ['mobile-notifications'],
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { const: true, type: 'boolean' },
              data: {
                type: 'object',
                required: ['dispatched', 'date'],
                properties: {
                  dispatched: { type: 'number' },
                  date: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const authResult = validateInternalAuth(req);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'missing internal auth');
      }
      const date = yesterdayCet();
      const results = await Promise.all(
        DIGEST_SUBSCRIPTIONS.map(async (sub) => {
          const llm = buildLlmClient(sub.userId);
          const r = await runDigestForGroup(
            { llmClient: llm, logger, modelId: getDigestModel() },
            { userId: sub.userId, groupKey: sub.groupKey, date, holder: 'cron' },
          );
          return r.ok ? 1 as const : 0 as const;
        }),
      );
      const dispatched: number = results.reduce<number>((a, b) => a + b, 0);
      return await reply.ok({ dispatched, date });
    },
  );

  // User-facing routes (Auth0 JWT required)

  interface BackfillRunParams {
    runId: string;
  }

  fastify.get<{ Params: BackfillRunParams }>(
    '/notifications/digests/backfill/:runId',
    {
      schema: {
        operationId: 'getBackfillRun',
        summary: 'Get backfill run status',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['runId'],
          properties: {
            runId: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const user = await requireAuth(req, reply);
      if (user === null) return;
      const { runId } = req.params;
      const result = await getServices().backfillRunRepository.findById(runId);
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      if (result.value === null) return await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Backfill run not found' } }); // @allow-raw-send -- 404 with typed body, reply.fail only supports 5xx
      return await reply.ok(result.value);
    },
  );

  interface DigestsQuerystring {
    groupKey: string;
    fromDate: string;
    toDate: string;
    limit?: number;
    cursor?: string;
  }

  fastify.get<{ Querystring: DigestsQuerystring }>(
    '/notifications/digests',
    {
      schema: {
        operationId: 'listDigests',
        summary: 'List daily digests for authenticated user',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['groupKey', 'fromDate', 'toDate'],
          properties: {
            groupKey: { type: 'string' },
            fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            toDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const user = await requireAuth(req, reply);
      if (user === null) return;
      const { groupKey, fromDate, toDate, limit = 30, cursor } = req.query;
      const result = await getServices().digestRepository.findInRange({
        userId: user.userId,
        groupKey,
        fromDate,
        toDate,
        limit,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      return await reply.ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
      });
    },
  );

  interface DigestParams {
    groupKey: string;
    date: string;
  }

  fastify.get<{ Params: DigestParams }>(
    '/notifications/digests/:groupKey/:date',
    {
      schema: {
        operationId: 'getDigestByDate',
        summary: 'Get digest for a specific group and date',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['groupKey', 'date'],
          properties: {
            groupKey: { type: 'string' },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const user = await requireAuth(req, reply);
      if (user === null) return;
      const { groupKey, date } = req.params;
      const result = await getServices().digestRepository.findByDate({ userId: user.userId, groupKey, date });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      if (result.value === null) return await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Digest not found' } }); // @allow-raw-send -- 404 with typed body, reply.fail only supports 5xx
      return await reply.ok(result.value);
    },
  );

  fastify.get<{ Params: DigestParams }>(
    '/notifications/digests/:groupKey/:date/state',
    {
      schema: {
        operationId: 'getDigestState',
        summary: 'Get group state snapshot for a specific date',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['groupKey', 'date'],
          properties: {
            groupKey: { type: 'string' },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          },
        },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const user = await requireAuth(req, reply);
      if (user === null) return;
      const { groupKey, date } = req.params;
      const result = await getServices().groupStateRepository.getByDate({ userId: user.userId, groupKey, date });
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);
      if (result.value === null) return await reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'State not found' } }); // @allow-raw-send -- 404 with typed body, reply.fail only supports 5xx
      return await reply.ok(result.value);
    },
  );

  done();
};
