/**
 * Internal Routes for service-to-service communication.
 * POST /internal/research/draft - Create a draft research
 * POST /internal/llm/pubsub/process-research - Process research from Pub/Sub
 * POST /internal/llm/pubsub/report-analytics - Report LLM analytics from Pub/Sub
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import {
  createDraftResearch,
  processResearch,
  type LlmProvider,
} from '../domain/research/index.js';
import { getServices } from '../services.js';
import { llmProviderSchema, researchSchema } from './schemas/index.js';
import { createLlmProviders, createSynthesizer, createTitleGenerator } from '../infra/llm/index.js';
import type { DecryptedApiKeys } from '../infra/user/index.js';

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
        event = JSON.parse(decoded) as ResearchProcessEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        return { success: false, error: 'Invalid message format' };
      }

      if (event.type !== 'research.process') {
        request.log.warn({ type: event.type }, 'Unexpected event type');
        return { success: false, error: 'Unexpected event type' };
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

      const { researchRepo, userServiceClient, notificationSender } = getServices();

      try {
        const researchResult = await researchRepo.findById(event.researchId);
        if (!researchResult.ok || researchResult.value === null) {
          request.log.error({ researchId: event.researchId }, 'Research not found');
          return { success: false, error: 'Research not found' };
        }
        const research = researchResult.value;

        const apiKeysResult = await userServiceClient.getApiKeys(research.userId);
        const apiKeys: DecryptedApiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

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

        const llmProviders = createLlmProviders(apiKeys);
        const synthesizer = createSynthesizer(synthesisProvider, synthesisKey);

        const deps: Parameters<typeof processResearch>[1] = {
          researchRepo,
          llmProviders,
          synthesizer,
          notificationSender,
          reportLlmSuccess: (provider): void => {
            void userServiceClient.reportLlmSuccess(research.userId, provider);
          },
        };

        if (apiKeys.google !== undefined) {
          deps.titleGenerator = createTitleGenerator(apiKeys.google);
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
        event = JSON.parse(decoded) as LlmAnalyticsEvent;
      } catch {
        request.log.error(
          { messageId: body.message.messageId },
          'Failed to decode analytics message'
        );
        return { success: false };
      }

      if (event.type !== 'llm.report') {
        request.log.warn({ type: event.type }, 'Unexpected analytics event type');
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

  done();
};
