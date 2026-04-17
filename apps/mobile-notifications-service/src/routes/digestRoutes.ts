import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { createLlmClient, type LlmClientConfig } from '@intexuraos/llm-factory';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { runDigestForGroup } from '../domain/usecases/runDigestForGroup.js';
import { yesterdayCet } from '../domain/usecases/yesterdayCet.js';
import { DIGEST_SUBSCRIPTIONS } from '../domain/digestSubscriptions.js';
import { runRequestSchema, runResponseSchema } from './digestSchemas.js';

const logger = createAppLogger({ name: 'digestRoutes' });

interface RunBody {
  userId: string;
  groupKey: string;
  date: string;
}

function getDigestModel(): string {
  const m = process.env['INTEXURAOS_DIGEST_LLM_MODEL'];
  if (m === undefined || m === '') throw new Error('INTEXURAOS_DIGEST_LLM_MODEL not set');
  return m;
}

function buildLlmClient(userId: string) {
  const model = getDigestModel();
  const apiKey = process.env['INTEXURAOS_OPENROUTER_API_KEY'] ?? '';
  const config: LlmClientConfig = {
    apiKey,
    model: model as LlmClientConfig['model'],
    userId,
    logger,
    usageSink: { record: async () => undefined },
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
      const { userId, groupKey, date } = req.body;
      const llmClient = buildLlmClient(userId);
      const modelId = getDigestModel();
      const result = await runDigestForGroup(
        { llmClient, logger, modelId },
        { userId, groupKey, date, holder: 'manual' },
      );
      if (!result.ok) {
        if (result.error.code === 'lock-held') {
          return await reply.ok({ summaryDocId: '', generation: 0, messageCount: 0, modelId, regenerated: false, lockSkipped: true });
        }
        return await reply.fail('DIGEST_FAILED', JSON.stringify(result.error));
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
          return r.ok ? 1 : 0;
        }),
      );
      const dispatched = results.reduce((a, b) => a + b, 0);
      return await reply.ok({ dispatched, date });
    },
  );

  done();
};
