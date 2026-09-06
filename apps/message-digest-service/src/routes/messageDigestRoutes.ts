import type { FastifyPluginAsync } from 'fastify';
import { getSafeRequestRoute, logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type {
  MessageDigestDefinition,
  MessageDigestSchedule,
} from '../domain/models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../domain/models/messageDigestRun.js';
import { createMessageDigest } from '../domain/usecases/createMessageDigest.js';
import { dispatchMessageDigestOutbox } from '../domain/usecases/dispatchMessageDigestOutbox.js';
import {
  eraseMessageDigest,
  getMessageDigestErasure,
  resumeMessageDigestErasure,
} from '../domain/usecases/eraseMessageDigest.js';
import { getMessageDigestDeliveryReadiness } from '../domain/usecases/getMessageDigestDeliveryReadiness.js';
import { getMessageDigest, queryMessageDigests } from '../domain/usecases/queryMessageDigests.js';
import { previewMessageDigest } from '../domain/usecases/previewMessageDigest.js';
import { previewMessageDigestSchedule } from '../domain/usecases/previewMessageDigestSchedule.js';
import { prepareMessageDigestRun } from '../domain/usecases/prepareMessageDigestRun.js';
import {
  getMessageDigestRun,
  queryMessageDigestRuns,
} from '../domain/usecases/queryMessageDigestRuns.js';
import { reconcileMessageDigestDelivery } from '../domain/usecases/reconcileMessageDigestDelivery.js';
import { retryMessageDigestRun } from '../domain/usecases/retryMessageDigestRun.js';
import {
  getMessageDigestRunRequestOutboxId,
  reserveMessageDigestRun,
} from '../domain/usecases/reserveMessageDigestRun.js';
import { updateMessageDigest } from '../domain/usecases/updateMessageDigest.js';
import { getServices } from '../services.js';
import {
  createMessageDigestBodySchema,
  definitionParamsSchema,
  erasureParamsSchema,
  idempotencyHeadersSchema,
  listMessageDigestRunsQuerySchema,
  listMessageDigestsQuerySchema,
  messageDigestResponseSchema,
  previewMessageDigestBodySchema,
  reserveMessageDigestRunBodySchema,
  runParamsSchema,
  schedulePreviewBodySchema,
  updateMessageDigestBodySchema,
} from './messageDigestSchemas.js';
import { sendMessageDigestRouteError } from './routeErrors.js';

interface DefinitionParams {
  definitionId: string;
}

interface RunParams extends DefinitionParams {
  runId: string;
}

interface ErasureParams {
  erasureRequestId: string;
}

interface IdempotencyHeaders {
  'idempotency-key': string;
}

interface CreateBody {
  status: 'active' | 'paused';
  name: string;
  source: { chatId: string };
  instructions: {
    templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
    text: string;
  };
  schedule: MessageDigestSchedule;
}

interface UpdateBody {
  expectedRevision: number;
  patch: {
    name?: string | undefined;
    source?: { chatId: string } | undefined;
    instructions?: CreateBody['instructions'] | undefined;
    schedule?: CreateBody['schedule'] | undefined;
    status?: 'active' | 'paused' | undefined;
  };
}

interface PreviewBody {
  source: CreateBody['source'];
  instructions: CreateBody['instructions'];
  schedule: CreateBody['schedule'];
}

interface ReserveRunBody {
  preparationToken: string;
}

interface ListQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  query?: string | undefined;
  chatType?: 'group' | 'direct' | undefined;
  status?: 'active' | 'paused' | 'needs_attention' | undefined;
  sort?: 'name' | 'updatedAt' | 'nextRunAt' | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

interface ListRunsQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  generationStatus?: MessageDigestRun['generationStatus'] | undefined;
  deliveryStatus?: MessageDigestRun['delivery']['status'] | undefined;
  sort?: 'windowStart' | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

export const messageDigestRoutes: FastifyPluginAsync = (app) => {
  app.addHook('onRequest', (request, _reply, done) => {
    logIncomingRequest(request, {
      message: 'Message Digest public request',
      bodyPreviewLength: 0,
      includeHeaders: false,
      includeParams: false,
      additionalFields: {
        method: request.method,
        route: getSafeRequestRoute(request),
      },
    });
    done();
  });

  app.get<{ Querystring: ListQuery }>(
    '/',
    {
      schema: {
        operationId: 'listMessageDigests',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        querystring: listMessageDigestsQuerySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await queryMessageDigests(
        {
          userId: user.userId,
          ...request.query,
        },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({
        items: result.items.map(toPublicDefinition),
        nextCursor: result.nextCursor,
      });
    }
  );

  app.post<{ Body: CreateBody; Headers: IdempotencyHeaders }>(
    '/',
    {
      schema: {
        operationId: 'createMessageDigest',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        headers: idempotencyHeadersSchema,
        body: createMessageDigestBodySchema,
        response: messageDigestResponseSchema(201),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await createMessageDigest(
        {
          userId: user.userId,
          requestId: request.headers['idempotency-key'],
          ...request.body,
        },
        {
          store: services.messageDigestStore,
          whatsappClient: services.messageDigestWhatsAppClient,
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.status(result.disposition === 'created' ? 201 : 200).ok({
        disposition: result.disposition,
        activationAdjusted: result.activationAdjusted,
        definition: toPublicDefinition(result.definition),
      });
    }
  );

  app.get<{ Params: DefinitionParams }>(
    '/:definitionId',
    {
      schema: {
        operationId: 'getMessageDigest',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await getMessageDigest(
        { userId: user.userId, definitionId: request.params.definitionId },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ definition: toPublicDefinition(result.definition) });
    }
  );

  app.patch<{ Params: DefinitionParams; Body: UpdateBody }>(
    '/:definitionId',
    {
      schema: {
        operationId: 'updateMessageDigest',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        body: updateMessageDigestBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await updateMessageDigest(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          expectedRevision: request.body.expectedRevision,
          patch: request.body.patch,
        },
        {
          store: services.messageDigestStore,
          whatsappClient: services.messageDigestWhatsAppClient,
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ definition: toPublicDefinition(result.definition) });
    }
  );

  app.delete<{ Params: DefinitionParams; Headers: IdempotencyHeaders }>(
    '/:definitionId',
    {
      schema: {
        operationId: 'deleteMessageDigest',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        headers: idempotencyHeadersSchema,
        response: messageDigestResponseSchema(202),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await eraseMessageDigest(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          requestId: request.headers['idempotency-key'],
        },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.status(result.status === 'completed' ? 200 : 202).ok({
        erasure: result,
      });
    }
  );

  app.get<{ Params: ErasureParams }>(
    '/erasures/:erasureRequestId',
    {
      schema: {
        operationId: 'getMessageDigestErasure',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: erasureParamsSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await getMessageDigestErasure(
        { userId: user.userId, erasureRequestId: request.params.erasureRequestId },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ erasure: result });
    }
  );

  app.post<{ Params: ErasureParams }>(
    '/erasures/:erasureRequestId/resume',
    {
      schema: {
        operationId: 'resumeMessageDigestErasure',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: erasureParamsSchema,
        response: messageDigestResponseSchema(202),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await resumeMessageDigestErasure(
        { userId: user.userId, erasureRequestId: request.params.erasureRequestId },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.status(result.status === 'completed' ? 200 : 202).ok({
        erasure: result,
      });
    }
  );

  app.get(
    '/delivery-readiness',
    {
      schema: {
        operationId: 'getMessageDigestDeliveryReadiness',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await getMessageDigestDeliveryReadiness(
        { userId: user.userId },
        { whatsappClient: getServices().messageDigestWhatsAppClient }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ readiness: result.readiness });
    }
  );

  app.post<{
    Body: { schedule: CreateBody['schedule']; evaluatedAt?: string | undefined };
  }>(
    '/schedule-preview',
    {
      schema: {
        operationId: 'previewMessageDigestSchedule',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        body: schedulePreviewBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = previewMessageDigestSchedule({
        schedule: request.body.schedule,
        evaluatedAt: request.body.evaluatedAt ?? new Date().toISOString(),
      });
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ preview: result.preview });
    }
  );

  app.post<{ Body: PreviewBody }>(
    '/preview',
    {
      schema: {
        operationId: 'previewMessageDigest',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        body: previewMessageDigestBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await previewMessageDigest(
        {
          userId: user.userId,
          correlationId: request.id,
          ...request.body,
        },
        {
          whatsappClient: services.messageDigestWhatsAppClient,
          aggregator: services.messageDigestAggregator,
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ preview: result.preview });
    }
  );

  app.post<{ Params: DefinitionParams }>(
    '/:definitionId/run/prepare',
    {
      schema: {
        operationId: 'prepareMessageDigestRun',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await prepareMessageDigestRun(
        { userId: user.userId, definitionId: request.params.definitionId },
        {
          store: services.messageDigestStore,
          whatsappClient: services.messageDigestWhatsAppClient,
          preparationTokens: services.runPreparationTokens,
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({ preparation: result.preparation });
    }
  );

  app.post<{
    Params: DefinitionParams;
    Body: ReserveRunBody;
    Headers: IdempotencyHeaders;
  }>(
    '/:definitionId/run',
    {
      schema: {
        operationId: 'reserveMessageDigestRun',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        headers: idempotencyHeadersSchema,
        body: reserveMessageDigestRunBodySchema,
        response: {
          ...messageDigestResponseSchema(),
          ...messageDigestResponseSchema(202),
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await reserveMessageDigestRun(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          requestId: request.headers['idempotency-key'],
          preparationToken: request.body.preparationToken,
        },
        {
          store: services.messageDigestStore,
          whatsappClient: services.messageDigestWhatsAppClient,
          preparationTokens: services.runPreparationTokens,
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);

      let dispatchDisposition = 'not_requested';
      if (result.disposition === 'reserved') {
        const dispatched = await dispatchMessageDigestOutbox(
          {
            outboxId: getMessageDigestRunRequestOutboxId(result.run.runId),
            workerId: `public-run:${request.id}`,
          },
          {
            store: services.messageDigestStore,
            runRequestPublisher: services.messageDigestRunPublisher,
            whatsappPublisher: services.whatsappSendPublisher,
          }
        );
        dispatchDisposition = dispatched.ok ? dispatched.disposition : 'deferred';
      }
      return await reply.status(result.disposition === 'reserved' ? 202 : 200).ok({
        disposition: result.disposition,
        dispatchDisposition,
        run: toPublicRun(result.run),
      });
    }
  );

  app.get<{ Params: DefinitionParams; Querystring: ListRunsQuery }>(
    '/:definitionId/runs',
    {
      schema: {
        operationId: 'listMessageDigestRuns',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: definitionParamsSchema,
        querystring: listMessageDigestRunsQuerySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const result = await queryMessageDigestRuns(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          ...request.query,
        },
        { store: getServices().messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({
        items: result.items.map(toPublicRun),
        nextCursor: result.nextCursor,
      });
    }
  );

  app.get<{ Params: RunParams }>(
    '/:definitionId/runs/:runId',
    {
      schema: {
        operationId: 'getMessageDigestRun',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: runParamsSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await getMessageDigestRun(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          runId: request.params.runId,
        },
        { store: services.messageDigestStore }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);

      let run = result.run;
      if (run.generationStatus === 'completed' && run.delivery.status === 'pending') {
        const reconciled = await reconcileMessageDigestDelivery(
          {
            userId: user.userId,
            definitionId: request.params.definitionId,
            runId: request.params.runId,
          },
          {
            store: services.messageDigestStore,
            whatsappClient: services.messageDigestWhatsAppClient,
          }
        );
        if (reconciled.ok && reconciled.disposition !== 'deferred') run = reconciled.run;
      }
      return await reply.ok({ run: toPublicRun(run) });
    }
  );

  app.post<{ Params: RunParams; Headers: IdempotencyHeaders }>(
    '/:definitionId/runs/:runId/retry',
    {
      schema: {
        operationId: 'retryMessageDigestRun',
        tags: ['message-digests'],
        security: [{ bearerAuth: [] }],
        params: runParamsSchema,
        headers: idempotencyHeadersSchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const services = getServices();
      const result = await retryMessageDigestRun(
        {
          userId: user.userId,
          definitionId: request.params.definitionId,
          runId: request.params.runId,
          requestId: request.headers['idempotency-key'],
        },
        {
          store: services.messageDigestStore,
          whatsappClient: services.messageDigestWhatsAppClient,
          dispatchOutbox: async (outboxId) =>
            await dispatchMessageDigestOutbox(
              { outboxId, workerId: `public-retry:${request.id}` },
              {
                store: services.messageDigestStore,
                runRequestPublisher: services.messageDigestRunPublisher,
                whatsappPublisher: services.whatsappSendPublisher,
              }
            ),
        }
      );
      if (!result.ok) return await sendMessageDigestRouteError(reply, result.code);
      return await reply.ok({
        disposition: result.disposition,
        stage: result.stage,
        run: toPublicRun(result.run),
      });
    }
  );
  return Promise.resolve();
};

export function toPublicDefinition(definition: MessageDigestDefinition): Record<string, unknown> {
  return {
    id: definition.definitionId,
    name: definition.name,
    status: definition.status,
    listStatus: definition.listStatus,
    attentionCode: definition.attentionCode,
    revision: definition.revision,
    sourceLocked: definition.hasRuns,
    erasureRequestId:
      definition.status === 'deleting' ? definition.activeErasureRequestId : null,
    source: {
      chatId: definition.source.chatId,
      chatType: definition.source.chatType,
      displayName: definition.source.displayName,
      ...(definition.source.messageCount === undefined
        ? {}
        : { messageCount: definition.source.messageCount }),
      ...(definition.source.participantCount === undefined
        ? {}
        : { participantCount: definition.source.participantCount }),
      ...(definition.source.lastActivityAt === undefined
        ? {}
        : { lastActivityAt: definition.source.lastActivityAt }),
    },
    instructions: {
      templateId: definition.instructions.templateId,
      text: definition.instructions.text,
    },
    schedule: definition.schedule,
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: definition.checkpointAt,
    nextRunAt: definition.nextRunAt,
    lastRunAt: definition.lastRunAt,
    latestRun:
      definition.latestRun === undefined || definition.latestRun === null
        ? null
        : {
            id: definition.latestRun.runId,
            startedAt: definition.latestRun.startedAt,
            generationStatus: definition.latestRun.generationStatus,
            processingStage: definition.latestRun.processingStage,
            deliveryStatus: definition.latestRun.deliveryStatus,
          },
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export function toPublicRun(run: MessageDigestRun): Record<string, unknown> {
  return {
    id: run.runId,
    definitionId: run.definitionId,
    definitionRevision: run.definitionRevision,
    trigger: run.trigger,
    window: {
      start: run.windowStart,
      end: run.windowEnd,
      scheduledBoundary: run.scheduledBoundary,
    },
    generationStatus: run.generationStatus,
    processingStage: run.processingStage,
    attempts: run.attempts,
    source: {
      chatType: run.sourceSnapshot.chatType,
      displayName: run.sourceSnapshot.displayName,
    },
    instructions: {
      templateId: run.instructionsSnapshot.templateId,
      text: run.instructionsSnapshot.text,
      revision: run.instructionsSnapshot.revision,
    },
    schedule: run.scheduleSnapshot,
    content:
      run.headline === null || run.summaryMarkdown === null
        ? null
        : {
            headline: run.headline,
            summaryMarkdown: run.summaryMarkdown,
            evidenceMessageRefs: run.evidenceMessageRefs,
          },
    effectiveMessageCount: run.effectiveMessageCount,
    promptVersion: run.promptVersion,
    model: run.model,
    usage:
      run.usage === null
        ? null
        : {
            inputTokens: run.usage.inputTokens,
            outputTokens: run.usage.outputTokens,
            totalTokens: run.usage.totalTokens,
          },
    delivery: {
      type: run.delivery.type,
      status: run.delivery.status,
      acceptedAt: run.delivery.acceptedAt,
      failedAt: run.delivery.failedAt,
      failureCode: run.delivery.failureCode,
    },
    safeFailureCode: run.safeFailureCode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  };
}
