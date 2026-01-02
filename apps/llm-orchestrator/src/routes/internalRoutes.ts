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
  type LlmProvider,
} from '../domain/research/index.js';
import { getServices, type DecryptedApiKeys } from '../services.js';
import { llmProviderSchema, researchSchema } from './schemas/index.js';

interface CreateDraftResearchBody {
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
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
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

interface LlmCallEvent {
  type: 'llm.call';
  researchId: string;
  userId: string;
  provider: LlmProvider;
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
          required: ['userId', 'title', 'prompt', 'selectedLlms'],
          properties: {
            userId: { type: 'string', description: 'User ID' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            prompt: { type: 'string', minLength: 10, maxLength: 20000 },
            selectedLlms: {
              type: 'array',
              items: llmProviderSchema,
              minItems: 1,
              maxItems: 3,
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
      // Log incoming request BEFORE auth check (for debugging)
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

      const createParams: Parameters<typeof createDraftResearch>[0] = {
        id: generateId(),
        userId: body.userId,
        title: body.title,
        prompt: body.prompt,
        selectedLlms: body.selectedLlms,
        synthesisLlm: 'anthropic',
      };
      if (body.sourceActionId !== undefined) {
        createParams.sourceActionId = body.sourceActionId;
      }
      const research = createDraftResearch(createParams);

      const saveResult = await researchRepo.save(research);

      if (!saveResult.ok) {
        return await reply.fail('INTERNAL_ERROR', saveResult.error.message);
      }

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

        const researchSettingsResult = await userServiceClient.getResearchSettings(research.userId);
        const searchMode = researchSettingsResult.ok
          ? researchSettingsResult.value.searchMode
          : 'deep';

        request.log.info(
          { researchId: event.researchId, searchMode },
          'Using search mode for research'
        );

        const synthesisProvider = research.synthesisLlm;
        const synthesisKey = apiKeys[synthesisProvider];
        if (synthesisKey === undefined) {
          await researchRepo.update(event.researchId, {
            status: 'failed',
            synthesisError: `API key required for synthesis with ${synthesisProvider}`,
          });
          request.log.error(
            { researchId: event.researchId, provider: synthesisProvider },
            'API key missing for synthesis'
          );
          return { success: false, error: 'API key missing' };
        }

        const synthesizer = services.createSynthesizer(synthesisProvider, synthesisKey);

        const deps: Parameters<typeof processResearch>[1] = {
          researchRepo,
          llmCallPublisher: services.llmCallPublisher,
          synthesizer,
          reportLlmSuccess: (provider): void => {
            void userServiceClient.reportLlmSuccess(research.userId, provider);
          },
        };

        if (apiKeys.google !== undefined) {
          deps.titleGenerator = services.createTitleGenerator(apiKeys.google);
        }

        await processResearch(event.researchId, deps);

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
        await userServiceClient.reportLlmSuccess(event.userId, event.provider);
        request.log.debug({ provider: event.provider, userId: event.userId }, 'Analytics reported');
      } catch (error) {
        request.log.warn(
          { provider: event.provider, error: getErrorMessage(error) },
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
          provider: event.provider,
          messageId: body.message.messageId,
        },
        'Processing LLM call event'
      );

      const services = getServices();
      const { researchRepo, userServiceClient, notificationSender } = services;

      try {
        const researchResult = await researchRepo.findById(event.researchId);
        if (!researchResult.ok || researchResult.value === null) {
          request.log.error({ researchId: event.researchId }, 'Research not found for LLM call');
          return { success: false, error: 'Research not found' };
        }
        const research = researchResult.value;

        const existingResult = research.llmResults.find((r) => r.provider === event.provider);
        if (existingResult?.status === 'completed' || existingResult?.status === 'failed') {
          request.log.info(
            {
              researchId: event.researchId,
              provider: event.provider,
              status: existingResult.status,
            },
            'LLM call already processed, skipping (idempotency)'
          );
          return { success: true };
        }

        const apiKeysResult = await userServiceClient.getApiKeys(event.userId);
        if (!apiKeysResult.ok) {
          request.log.error(
            { researchId: event.researchId, userId: event.userId },
            'Failed to fetch API keys'
          );
          await researchRepo.updateLlmResult(event.researchId, event.provider, {
            status: 'failed',
            error: 'Failed to fetch API keys',
            completedAt: new Date().toISOString(),
          });
          return { success: false, error: 'Failed to fetch API keys' };
        }

        const apiKey = apiKeysResult.value[event.provider];
        if (apiKey === undefined) {
          request.log.error(
            { researchId: event.researchId, provider: event.provider },
            'API key missing for provider'
          );
          await researchRepo.updateLlmResult(event.researchId, event.provider, {
            status: 'failed',
            error: `API key missing for ${event.provider}`,
            completedAt: new Date().toISOString(),
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.provider,
            `API key missing for ${event.provider}`
          );

          const keyMissingCompletionAction = await checkLlmCompletion(event.researchId, {
            researchRepo,
          });
          request.log.info(
            { researchId: event.researchId, action: keyMissingCompletionAction.type },
            'LLM completion check after API key missing failure'
          );

          return { success: false, error: 'API key missing' };
        }

        const researchSettingsResult = await userServiceClient.getResearchSettings(event.userId);
        const searchMode = researchSettingsResult.ok
          ? researchSettingsResult.value.searchMode
          : 'deep';

        const startedAt = new Date().toISOString();
        await researchRepo.updateLlmResult(event.researchId, event.provider, {
          status: 'processing',
          startedAt,
        });

        request.log.info(
          { researchId: event.researchId, provider: event.provider, searchMode },
          'Starting LLM research call'
        );

        const llmProvider = services.createResearchProvider(event.provider, apiKey, searchMode);
        const startTime = Date.now();
        const llmResult = await llmProvider.research(event.prompt);
        const durationMs = Date.now() - startTime;

        if (!llmResult.ok) {
          request.log.error(
            {
              researchId: event.researchId,
              provider: event.provider,
              error: llmResult.error.message,
              durationMs,
            },
            'LLM research call failed'
          );
          await researchRepo.updateLlmResult(event.researchId, event.provider, {
            status: 'failed',
            error: llmResult.error.message,
            completedAt: new Date().toISOString(),
            durationMs,
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.provider,
            llmResult.error.message
          );

          const failCompletionAction = await checkLlmCompletion(event.researchId, { researchRepo });
          request.log.info(
            { researchId: event.researchId, action: failCompletionAction.type },
            'LLM completion check after failure'
          );

          return { success: true };
        }

        request.log.info(
          {
            researchId: event.researchId,
            provider: event.provider,
            durationMs,
            contentLength: llmResult.value.content.length,
          },
          'LLM research call succeeded'
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
        await researchRepo.updateLlmResult(event.researchId, event.provider, updateData);

        void userServiceClient.reportLlmSuccess(event.userId, event.provider);

        const completionAction = await checkLlmCompletion(event.researchId, { researchRepo });

        switch (completionAction.type) {
          case 'pending':
            request.log.info(
              { researchId: event.researchId },
              'LLM completion check: still waiting for other providers'
            );
            break;
          case 'all_completed': {
            request.log.info(
              { researchId: event.researchId },
              'All LLMs completed, triggering synthesis'
            );

            const freshResearch = await researchRepo.findById(event.researchId);
            if (!freshResearch.ok || freshResearch.value === null) {
              request.log.error(
                { researchId: event.researchId },
                'Research not found for synthesis'
              );
              break;
            }

            const synthesisProvider = freshResearch.value.synthesisLlm;
            const synthesisKey = apiKeysResult.value[synthesisProvider];
            if (synthesisKey === undefined) {
              request.log.error(
                { researchId: event.researchId, provider: synthesisProvider },
                'API key missing for synthesis provider'
              );
              await researchRepo.update(event.researchId, {
                status: 'failed',
                synthesisError: `API key required for synthesis with ${synthesisProvider}`,
                completedAt: new Date().toISOString(),
              });
              break;
            }

            const synthesizer = services.createSynthesizer(synthesisProvider, synthesisKey);
            const synthesisResult = await runSynthesis(event.researchId, {
              researchRepo,
              synthesizer,
              notificationSender,
              reportLlmSuccess: (): void => {
                void userServiceClient.reportLlmSuccess(event.userId, synthesisProvider);
              },
            });

            if (synthesisResult.ok) {
              request.log.info(
                { researchId: event.researchId },
                'Synthesis completed successfully'
              );
            } else {
              request.log.error(
                { researchId: event.researchId, error: synthesisResult.error },
                'Synthesis failed'
              );
            }
            break;
          }
          case 'all_failed':
            request.log.warn(
              { researchId: event.researchId },
              'All LLMs failed, research marked as failed'
            );
            break;
          case 'partial_failure':
            request.log.warn(
              { researchId: event.researchId, failedProviders: completionAction.failedProviders },
              'Partial failure detected, awaiting user confirmation'
            );
            break;
        }

        return { success: true };
      } catch (error) {
        request.log.error(
          { researchId: event.researchId, provider: event.provider, error: getErrorMessage(error) },
          'LLM call processing failed unexpectedly'
        );
        await researchRepo.updateLlmResult(event.researchId, event.provider, {
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
