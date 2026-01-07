/**
 * Internal Routes for service-to-service communication.
 * POST /internal/research/draft - Create a draft research
 * POST /internal/llm/pubsub/process-research - Process research from Pub/Sub
 * POST /internal/llm/pubsub/process-llm-call - Process individual LLM call from Pub/Sub
 * POST /internal/llm/pubsub/report-analytics - Report LLM analytics from Pub/Sub
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import {
  checkLlmCompletion,
  createDraftResearch,
  processResearch,
  runSynthesis,
  calculateAccurateCost,
  type ResearchModel,
} from '../domain/research/index.js';
import { getProviderForModel } from '@intexuraos/llm-contract';
import { getServices, type DecryptedApiKeys } from '../services.js';
import { supportedModelSchema, researchSchema } from './schemas/index.js';

interface CreateDraftResearchBody {
  userId: string;
  title: string;
  prompt: string;
  selectedModels: ResearchModel[];
  sourceActionId?: string;
}

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface ResearchProcessEvent {
  type: 'research.process';
  researchId: string;
  userId: string;
  triggeredBy: 'create' | 'approve';
}

interface LlmAnalyticsEvent {
  type: 'llm.report';
  researchId: string;
  userId: string;
  model: ResearchModel;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

interface LlmCallEvent {
  type: 'llm.call';
  researchId: string;
  userId: string;
  model: ResearchModel;
  prompt: string;
}

function isPubSubPush(request: FastifyRequest): boolean {
  const fromHeader = request.headers.from;
  return typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/research/draft',
    {
      schema: {
        operationId: 'createInternalResearchDraft',
        summary: 'Create draft research (internal)',
        description:
          'Internal endpoint for service-to-service communication. Creates a draft research that requires user approval.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'title', 'prompt', 'selectedModels'],
          properties: {
            userId: { type: 'string', description: 'User ID' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            prompt: { type: 'string', minLength: 10, maxLength: 20000 },
            selectedModels: {
              type: 'array',
              items: supportedModelSchema,
              minItems: 1,
              maxItems: 6,
            },
            sourceActionId: { type: 'string', description: 'ID of the originating action' },
          },
        },
        response: {
          200: {
            description: 'Draft research created',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: researchSchema,
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
      logIncomingRequest(request, {
        message: 'Received request to /internal/research/draft',
        bodyPreviewLength: 500,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for research/draft endpoint'
        );
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const body = request.body as CreateDraftResearchBody;
      const { researchRepo, generateId } = getServices();
      const researchId = generateId();

      request.log.info(
        { researchId, userId: body.userId, modelsCount: body.selectedModels.length },
        '[1.1] Creating draft research object'
      );

      const createParams: Parameters<typeof createDraftResearch>[0] = {
        id: researchId,
        userId: body.userId,
        title: body.title,
        prompt: body.prompt,
        selectedModels: body.selectedModels,
        synthesisModel: body.selectedModels[0] ?? LlmModels.Gemini25Pro,
      };
      if (body.sourceActionId !== undefined) {
        createParams.sourceActionId = body.sourceActionId;
      }
      const research = createDraftResearch(createParams);

      request.log.info({ researchId }, '[1.2] Saving draft research to database');
      const saveResult = await researchRepo.save(research);

      if (!saveResult.ok) {
        request.log.error(
          { researchId, error: saveResult.error.message },
          '[1.2] Failed to save draft research'
        );
        return await reply.fail('INTERNAL_ERROR', saveResult.error.message);
      }

      request.log.info({ researchId }, '[1.3] Draft research created successfully');
      return await reply.ok(saveResult.value);
    }
  );

  fastify.post(
    '/internal/llm/pubsub/process-research',
    {
      schema: {
        operationId: 'processResearchPubSub',
        summary: 'Process research from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives research process events and executes research synchronously.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Message acknowledged',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
            required: ['success'],
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
      logIncomingRequest(request, {
        message: 'Received PubSub push to /internal/llm/pubsub/process-research',
        bodyPreviewLength: 500,
      });

      if (isPubSubPush(request)) {
        request.log.info(
          { from: request.headers.from },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for process-research endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let event: ResearchProcessEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        const parsed: unknown = JSON.parse(decoded);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('type' in parsed) ||
          (parsed as { type: unknown }).type !== 'research.process'
        ) {
          const eventType =
            typeof parsed === 'object' && parsed !== null && 'type' in parsed
              ? (parsed as { type: unknown }).type
              : 'unknown';
          request.log.warn({ type: eventType }, 'Unexpected event type');
          return { success: false, error: 'Unexpected event type' };
        }
        event = parsed as ResearchProcessEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        return { success: false, error: 'Invalid message format' };
      }

      request.log.info(
        {
          researchId: event.researchId,
          userId: event.userId,
          triggeredBy: event.triggeredBy,
          messageId: body.message.messageId,
        },
        'Processing research event'
      );

      const services = getServices();
      const { researchRepo, userServiceClient } = services;

      try {
        const researchResult = await researchRepo.findById(event.researchId);
        if (!researchResult.ok || researchResult.value === null) {
          request.log.error({ researchId: event.researchId }, 'Research not found');
          return { success: false, error: 'Research not found' };
        }
        const research = researchResult.value;

        const apiKeysResult = await userServiceClient.getApiKeys(research.userId);
        const apiKeys: DecryptedApiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

        const synthesisModel = research.synthesisModel;
        const synthesisProvider = getProviderForModel(synthesisModel);
        const synthesisKey = apiKeys[synthesisProvider];
        if (synthesisKey === undefined) {
          await researchRepo.update(event.researchId, {
            status: 'failed',
            synthesisError: `API key required for synthesis with ${synthesisModel}`,
          });
          request.log.error(
            { researchId: event.researchId, model: synthesisModel },
            'API key missing for synthesis'
          );
          return { success: false, error: 'API key missing' };
        }

        const synthesizer = services.createSynthesizer(
          synthesisModel,
          synthesisKey,
          research.userId,
          services.pricingContext.getPricing(synthesisModel)
        );

        const deps: Parameters<typeof processResearch>[1] = {
          researchRepo,
          llmCallPublisher: services.llmCallPublisher,
          logger: request.log,
          synthesizer,
          reportLlmSuccess: (model): void => {
            void userServiceClient.reportLlmSuccess(research.userId, getProviderForModel(model));
          },
        };

        if (apiKeys.google !== undefined) {
          deps.titleGenerator = services.createTitleGenerator(
            LlmModels.Gemini25Flash,
            apiKeys.google,
            research.userId,
            services.pricingContext.getPricing(LlmModels.Gemini25Flash)
          );
          deps.contextInferrer = services.createContextInferrer(
            LlmModels.Gemini25Flash,
            apiKeys.google,
            research.userId,
            services.pricingContext.getPricing(LlmModels.Gemini25Flash),
            request.log
          );
        }

        const processResult = await processResearch(event.researchId, deps);

        // For enhanced researches where all LLM results are already completed,
        // trigger synthesis immediately
        if (processResult.triggerSynthesis) {
          request.log.info({ researchId: event.researchId }, 'Triggering synthesis directly');

          const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] ?? '';
          await runSynthesis(event.researchId, {
            researchRepo,
            synthesizer,
            notificationSender: services.notificationSender,
            shareStorage: services.shareStorage,
            shareConfig: services.shareConfig,
            imageServiceClient: services.imageServiceClient,
            ...(deps.contextInferrer !== undefined && { contextInferrer: deps.contextInferrer }),
            userId: research.userId,
            webAppUrl,
            reportLlmSuccess: (): void => {
              void userServiceClient.reportLlmSuccess(research.userId, synthesisProvider);
            },
            logger: {
              info: (msg: string): void => {
                request.log.info({ researchId: event.researchId }, msg);
              },
              error: (obj: object, msg: string): void => {
                request.log.error({ researchId: event.researchId, ...obj }, msg);
              },
            },
            imageApiKeys: apiKeys,
          });
        }

        request.log.info({ researchId: event.researchId }, 'Research processed successfully');
        return { success: true };
      } catch (error) {
        request.log.error(
          { researchId: event.researchId, error: getErrorMessage(error) },
          'Research processing failed'
        );
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  fastify.post(
    '/internal/llm/pubsub/report-analytics',
    {
      schema: {
        operationId: 'reportAnalyticsPubSub',
        summary: 'Report LLM analytics from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives LLM analytics events and reports to user-service.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Message acknowledged',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
            required: ['success'],
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
      logIncomingRequest(request, {
        message: 'Received PubSub push to /internal/llm/pubsub/report-analytics',
        bodyPreviewLength: 300,
      });

      if (isPubSubPush(request)) {
        request.log.info(
          { from: request.headers.from },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for report-analytics endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let event: LlmAnalyticsEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        const parsed: unknown = JSON.parse(decoded);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('type' in parsed) ||
          (parsed as { type: unknown }).type !== 'llm.report'
        ) {
          const eventType =
            typeof parsed === 'object' && parsed !== null && 'type' in parsed
              ? (parsed as { type: unknown }).type
              : 'unknown';
          request.log.warn({ type: eventType }, 'Unexpected analytics event type');
          return { success: false };
        }
        event = parsed as LlmAnalyticsEvent;
      } catch {
        request.log.error(
          { messageId: body.message.messageId },
          'Failed to decode analytics message'
        );
        return { success: false };
      }

      const { userServiceClient } = getServices();

      try {
        await userServiceClient.reportLlmSuccess(event.userId, getProviderForModel(event.model));
        request.log.info({ model: event.model, userId: event.userId }, 'Analytics reported');
      } catch (error) {
        request.log.warn(
          { model: event.model, error: getErrorMessage(error) },
          'Failed to report analytics'
        );
      }

      return { success: true };
    }
  );

  fastify.post(
    '/internal/llm/pubsub/process-llm-call',
    {
      schema: {
        operationId: 'processLlmCallPubSub',
        summary: 'Process individual LLM call from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives individual LLM call requests and executes them in separate Cloud Run instances.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Message acknowledged',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
            required: ['success'],
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
      logIncomingRequest(request, {
        message: 'Received PubSub push to /internal/llm/pubsub/process-llm-call',
        bodyPreviewLength: 500,
      });

      if (isPubSubPush(request)) {
        request.log.info(
          { from: request.headers.from },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for process-llm-call endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let event: LlmCallEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        const parsed: unknown = JSON.parse(decoded);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('type' in parsed) ||
          (parsed as { type: unknown }).type !== 'llm.call'
        ) {
          const eventType =
            typeof parsed === 'object' && parsed !== null && 'type' in parsed
              ? (parsed as { type: unknown }).type
              : 'unknown';
          request.log.warn({ type: eventType }, 'Unexpected LLM call event type');
          return { success: false, error: 'Unexpected event type' };
        }
        event = parsed as LlmCallEvent;
      } catch {
        request.log.error(
          { messageId: body.message.messageId },
          'Failed to decode LLM call message'
        );
        return { success: false, error: 'Invalid message format' };
      }

      request.log.info(
        {
          researchId: event.researchId,
          userId: event.userId,
          model: event.model,
          messageId: body.message.messageId,
        },
        '[3.1] Processing LLM call event'
      );

      const services = getServices();
      const { researchRepo, userServiceClient, notificationSender, shareStorage, shareConfig } =
        services;
      const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] ?? '';
      const modelProvider = getProviderForModel(event.model);

      try {
        request.log.info(
          { researchId: event.researchId, model: event.model },
          '[3.1.1] Loading research from database'
        );
        const researchResult = await researchRepo.findById(event.researchId);
        if (!researchResult.ok || researchResult.value === null) {
          request.log.error({ researchId: event.researchId }, '[3.1.1] Research not found');
          return { success: false, error: 'Research not found' };
        }
        const research = researchResult.value;

        const existingResult = research.llmResults.find((r) => r.model === event.model);
        if (existingResult?.status === 'completed' || existingResult?.status === 'failed') {
          request.log.info(
            {
              researchId: event.researchId,
              model: event.model,
              status: existingResult.status,
            },
            '[3.1.2] LLM call already processed, skipping (idempotency)'
          );
          return { success: true };
        }

        request.log.info(
          { researchId: event.researchId, model: event.model, provider: modelProvider },
          '[3.2] Fetching API keys from user-service'
        );
        const apiKeysResult = await userServiceClient.getApiKeys(event.userId);
        if (!apiKeysResult.ok) {
          request.log.error(
            { researchId: event.researchId, userId: event.userId },
            '[3.2] Failed to fetch API keys'
          );
          await researchRepo.updateLlmResult(event.researchId, event.model, {
            status: 'failed',
            error: 'Failed to fetch API keys',
            completedAt: new Date().toISOString(),
          });
          return { success: false, error: 'Failed to fetch API keys' };
        }

        const apiKey = apiKeysResult.value[modelProvider];
        if (apiKey === undefined) {
          request.log.error(
            { researchId: event.researchId, model: event.model },
            '[3.2] API key missing for model'
          );
          await researchRepo.updateLlmResult(event.researchId, event.model, {
            status: 'failed',
            error: `API key missing for ${event.model}`,
            completedAt: new Date().toISOString(),
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.model,
            `API key missing for ${event.model}`
          );

          const keyMissingCompletionAction = await checkLlmCompletion(event.researchId, {
            researchRepo,
          });
          request.log.info(
            { researchId: event.researchId, action: keyMissingCompletionAction.type },
            '[3.5] LLM completion check after API key missing failure'
          );

          return { success: false, error: 'API key missing' };
        }

        const startedAt = new Date().toISOString();
        await researchRepo.updateLlmResult(event.researchId, event.model, {
          status: 'processing',
          startedAt,
        });

        request.log.info(
          { researchId: event.researchId, model: event.model },
          '[3.3] Starting LLM research call'
        );

        const llmProvider = services.createResearchProvider(
          event.model,
          apiKey,
          event.userId,
          services.pricingContext.getPricing(event.model)
        );
        const startTime = Date.now();
        const llmResult = await llmProvider.research(event.prompt);
        const durationMs = Date.now() - startTime;

        if (!llmResult.ok) {
          request.log.error(
            {
              researchId: event.researchId,
              model: event.model,
              error: llmResult.error.message,
              durationMs,
            },
            '[3.3] LLM research call failed'
          );
          await researchRepo.updateLlmResult(event.researchId, event.model, {
            status: 'failed',
            error: llmResult.error.message,
            completedAt: new Date().toISOString(),
            durationMs,
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.model,
            llmResult.error.message
          );

          const failCompletionAction = await checkLlmCompletion(event.researchId, { researchRepo });
          request.log.info(
            { researchId: event.researchId, action: failCompletionAction.type },
            '[3.5] LLM completion check after failure'
          );

          return { success: true };
        }

        const usage = llmResult.value.usage;
        request.log.info(
          {
            researchId: event.researchId,
            model: event.model,
            durationMs,
            contentLength: llmResult.value.content.length,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
          },
          '[3.3] LLM research call succeeded'
        );

        const updateData: Parameters<typeof researchRepo.updateLlmResult>[2] = {
          status: 'completed',
          result: llmResult.value.content,
          completedAt: new Date().toISOString(),
          durationMs,
        };
        if (llmResult.value.sources !== undefined) {
          updateData.sources = llmResult.value.sources;
        }

        if (usage !== undefined) {
          updateData.inputTokens = usage.inputTokens;
          updateData.outputTokens = usage.outputTokens;

          const pricing = await services.pricingRepo.findByProviderAndModel(
            modelProvider,
            event.model
          );
          if (pricing !== null) {
            updateData.costUsd = calculateAccurateCost(usage, pricing);
          } else {
            request.log.warn(
              { model: event.model },
              'Pricing not found for model, cost not calculated'
            );
          }
        }

        request.log.info(
          { researchId: event.researchId, model: event.model },
          '[3.4] Saving LLM result to database'
        );
        await researchRepo.updateLlmResult(event.researchId, event.model, updateData);

        void userServiceClient.reportLlmSuccess(event.userId, modelProvider);

        request.log.info(
          { researchId: event.researchId, model: event.model },
          '[3.5] Checking LLM completion status'
        );
        const completionAction = await checkLlmCompletion(event.researchId, { researchRepo });

        switch (completionAction.type) {
          case 'pending':
            request.log.info(
              { researchId: event.researchId },
              '[3.5.1] Still waiting for other LLM providers'
            );
            break;
          case 'all_completed': {
            const freshResearch = await researchRepo.findById(event.researchId);
            if (!freshResearch.ok || freshResearch.value === null) {
              request.log.error(
                { researchId: event.researchId },
                '[3.5.2] Research not found for synthesis'
              );
              break;
            }

            if (freshResearch.value.skipSynthesis === true) {
              request.log.info(
                { researchId: event.researchId },
                '[3.5.2] All LLMs completed, skipping synthesis (skipSynthesis flag)'
              );
              const now = new Date();
              const startedAt = new Date(freshResearch.value.startedAt);
              await researchRepo.update(event.researchId, {
                status: 'completed',
                completedAt: now.toISOString(),
                totalDurationMs: now.getTime() - startedAt.getTime(),
              });
              void notificationSender.sendResearchComplete(
                freshResearch.value.userId,
                event.researchId,
                freshResearch.value.title,
                `${webAppUrl}/#/research/${event.researchId}`
              );
              break;
            }

            request.log.info(
              { researchId: event.researchId },
              '[3.5.2] All LLMs completed, triggering synthesis (Phase 4)'
            );

            const synthesisModel = freshResearch.value.synthesisModel;
            const synthesisProvider = getProviderForModel(synthesisModel);
            const synthesisKey = apiKeysResult.value[synthesisProvider];
            if (synthesisKey === undefined) {
              request.log.error(
                { researchId: event.researchId, model: synthesisModel },
                '[3.5.2] API key missing for synthesis model'
              );
              await researchRepo.update(event.researchId, {
                status: 'failed',
                synthesisError: `API key required for synthesis with ${synthesisModel}`,
                completedAt: new Date().toISOString(),
              });
              break;
            }

            const synthesizer = services.createSynthesizer(
              synthesisModel,
              synthesisKey,
              event.userId,
              services.pricingContext.getPricing(synthesisModel)
            );
            const contextInferrer =
              apiKeysResult.value.google !== undefined
                ? services.createContextInferrer(
                    LlmModels.Gemini25Flash,
                    apiKeysResult.value.google,
                    event.userId,
                    services.pricingContext.getPricing(LlmModels.Gemini25Flash),
                    request.log
                  )
                : undefined;
            const synthesisResult = await runSynthesis(event.researchId, {
              researchRepo,
              synthesizer,
              notificationSender,
              shareStorage,
              shareConfig,
              imageServiceClient: services.imageServiceClient,
              ...(contextInferrer !== undefined && { contextInferrer }),
              userId: event.userId,
              webAppUrl,
              reportLlmSuccess: (): void => {
                void userServiceClient.reportLlmSuccess(event.userId, synthesisProvider);
              },
              logger: {
                info: (msg: string): void => {
                  request.log.info({ researchId: event.researchId }, msg);
                },
                error: (obj: object, msg: string): void => {
                  request.log.error({ researchId: event.researchId, ...obj }, msg);
                },
              },
              imageApiKeys: apiKeysResult.value,
            });

            if (synthesisResult.ok) {
              request.log.info(
                { researchId: event.researchId },
                '[4.END] Synthesis completed successfully'
              );
            } else {
              request.log.error(
                { researchId: event.researchId, error: synthesisResult.error },
                '[4.END] Synthesis failed'
              );
            }
            break;
          }
          case 'all_failed':
            request.log.warn(
              { researchId: event.researchId },
              '[3.5.3] All LLMs failed, research marked as failed'
            );
            break;
          case 'partial_failure':
            request.log.warn(
              { researchId: event.researchId, failedModels: completionAction.failedModels },
              '[3.5.4] Partial failure detected, awaiting user confirmation'
            );
            break;
        }

        return { success: true };
      } catch (error) {
        request.log.error(
          { researchId: event.researchId, model: event.model, error: getErrorMessage(error) },
          '[3.ERR] LLM call processing failed unexpectedly'
        );
        await researchRepo.updateLlmResult(event.researchId, event.model, {
          status: 'failed',
          error: getErrorMessage(error),
          completedAt: new Date().toISOString(),
        });
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  done();
};
