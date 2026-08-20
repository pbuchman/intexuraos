/**
 * Internal Routes for service-to-service communication.
 * POST /internal/research/draft - Create a draft research
 * POST /internal/llm/pubsub/process-research - Process research from Pub/Sub
 * POST /internal/llm/pubsub/process-llm-call - Process individual LLM call from Pub/Sub
 * POST /internal/llm/pubsub/report-analytics - Report LLM analytics from Pub/Sub
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage, ServiceErrorCodes } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { ServiceFeedback } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import {
  checkLlmCompletion,
  createDraftResearch,
  extractModelPreferences,
  processResearch,
  runSynthesis,
  type LlmResult,
  type ResearchModel,
  type TextGenerationClient,
} from '../domain/research/index.js';
import { formatLlmError } from '../domain/research/formatLlmError.js';
import {
  DEFAULT_PLATFORM_LLM_MODEL,
  getProviderForModel,
  LlmProviders,
} from '@intexuraos/llm-contract';
import { getServices, type DecryptedApiKeys } from '../services.js';
import { createSynthesisProviders } from './helpers/synthesisHelper.js';
import { handleAllCompleted } from './helpers/completionHandlers.js';
import {
  getUnsupportedHistoricalModels,
  getUnsupportedRetryMessage,
  getUnsupportedSynthesisMessage,
  isExecutableSynthesisModel,
  isRetryableStoredResearchModel,
} from './helpers/storedResearchModels.js';

const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

interface CreateDraftResearchBody {
  userId: string;
  title: string;
  prompt: string;
  originalMessage: string;
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

/**
 * Minimum character count for an LLM research result to be considered adequate.
 * Results below this threshold are flagged as `low_quality` and deprioritized
 * during synthesis. The 800-char threshold was chosen empirically — most useful
 * research responses are 1000+ characters; anything shorter typically indicates
 * a refusal, error message, or extremely shallow answer.
 */
export const MIN_QUALITY_CHARS = 800;

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
          required: ['userId', 'title', 'prompt', 'originalMessage'],
          properties: {
            userId: { type: 'string', description: 'User ID' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            prompt: { type: 'string', minLength: 10, maxLength: 20000 },
            originalMessage: {
              type: 'string',
              minLength: 1,
              maxLength: 20000,
              description: 'Original user message for extracting model preferences',
            },
            sourceActionId: { type: 'string', description: 'ID of the originating action' },
          },
        },
        response: {
          200: {
            description: 'Draft research created',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  message: { type: 'string', description: 'Human-readable feedback message' },
                  resourceUrl: { type: 'string', description: 'URL to created resource (success only)' },
                  errorCode: { type: 'string', description: 'Error code for debugging (failure only)' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['failed'] },
                  message: { type: 'string', description: 'Error message' },
                  errorCode: { type: 'string', description: 'Error code for debugging' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
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
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for research/draft endpoint');
      }

      const body = request.body as CreateDraftResearchBody;
      const { researchRepo, generateId, userServiceClient, webAppUrl } = getServices();
      const researchId = generateId();

      // Extract model preferences from original message using LLM
      request.log.info(
        { researchId, userId: body.userId, originalMessageLength: body.originalMessage.length },
        '[1.0] Extracting model preferences from original message'
      );

      let selectedModels: ResearchModel[] = [];
      let synthesisModel: ResearchModel | undefined;

      // Get user's API keys to determine available models
      const apiKeysResult = await userServiceClient.getApiKeys(body.userId);
      if (apiKeysResult.ok) {
        // Get user's LLM client for extraction
        const llmClientResult = await userServiceClient.getLlmClient(body.userId);
        if (llmClientResult.ok) {
          // Cast to TextGenerationClient - structurally compatible with LlmGenerateClient
          const llmClient = llmClientResult.value as TextGenerationClient;
          const extractionResult = await extractModelPreferences(body.originalMessage, {
            llmClient,
            availableKeys: apiKeysResult.value,
            logger: request.log,
          });
          selectedModels = extractionResult.selectedModels;
          synthesisModel = extractionResult.synthesisModel;

          request.log.info(
            {
              researchId,
              selectedModels,
              synthesisModel,
            },
            '[1.0] Model preferences extracted'
          );
        } else {
          request.log.warn(
            { researchId, error: llmClientResult.error.message },
            '[1.0] Failed to get LLM client for extraction, using empty models'
          );
        }
      } else {
        request.log.warn(
          { researchId, error: apiKeysResult.error.message },
          '[1.0] Failed to get API keys for extraction, using empty models'
        );
      }

      request.log.info(
        { researchId, userId: body.userId, modelsCount: selectedModels.length },
        '[1.1] Creating draft research object'
      );

      const createParams: Parameters<typeof createDraftResearch>[0] = {
        id: researchId,
        userId: body.userId,
        title: body.title,
        prompt: body.prompt,
        selectedModels,
        synthesisModel: synthesisModel ?? DEFAULT_PLATFORM_LLM_MODEL,
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
        const feedback: ServiceFeedback = {
          status: 'failed',
          message: saveResult.error.message,
          errorCode: ServiceErrorCodes.EXTERNAL_API_ERROR,
        };
        void reply.status(500);
        return await reply.ok(feedback);
      }

      const resourceUrl = buildWebAppResourceUrl(webAppUrl, `/#/research/${researchId}`);
      const feedback: ServiceFeedback = {
        status: 'completed',
        message: `Research "${body.title}" created successfully`,
        resourceUrl,
      };

      request.log.info({ researchId }, '[1.3] Draft research created successfully');
      return await reply.ok(feedback);
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
            oneOf: [
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: true },
                  data: {
                    type: 'object',
                    properties: {},
                    additionalProperties: true,
                  },
                  diagnostics: { $ref: 'Diagnostics#' },
                },
                required: ['success'],
              },
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                },
                required: ['success'],
              },
            ],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
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
          return await reply.fail('UNAUTHORIZED', 'Internal auth failed for process-research endpoint');
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
          // PubSub ack pattern: always return 200 OK, errors logged separately
          return await reply.ok({});
        }
        event = parsed as ResearchProcessEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        // PubSub ack pattern: always return 200 OK, errors logged separately
        return await reply.ok({});
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
          // PubSub ack pattern: always return 200 OK, errors logged separately
          return await reply.ok({});
        }
        const research = researchResult.value;

        const unsupportedPendingModels = getUnsupportedHistoricalModels(
          research.llmResults
            .filter((result) => result.status === 'pending')
            .map((result) => result.model)
        );
        if (unsupportedPendingModels.length > 0) {
          await researchRepo.update(event.researchId, {
            status: 'failed',
            synthesisError: getUnsupportedRetryMessage(unsupportedPendingModels),
          });
          request.log.error(
            { researchId: event.researchId, models: unsupportedPendingModels },
            'Research contains non-executable pending models'
          );
          return await reply.ok({});
        }

        const apiKeysResult = await userServiceClient.getApiKeys(research.userId);
        const apiKeys: DecryptedApiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

        const synthesisModel = research.synthesisModel;
        const synthesisProvider = 'openrouter';
        if (research.skipSynthesis !== true && !isExecutableSynthesisModel(synthesisModel)) {
          await researchRepo.update(event.researchId, {
            status: 'failed',
            synthesisError: getUnsupportedSynthesisMessage(synthesisModel),
          });
          request.log.error(
            { researchId: event.researchId, model: synthesisModel },
            'Unsupported synthesis model'
          );
          return await reply.ok({});
        }
        const synthesisKey = apiKeys.openrouter;
        if (synthesisKey === undefined) {
          await researchRepo.update(event.researchId, {
            status: 'failed',
            synthesisError:
              research.skipSynthesis === true
                ? 'OpenRouter API key required for research'
                : `API key required for synthesis with ${synthesisModel}`,
          });
          request.log.error(
            { researchId: event.researchId, model: synthesisModel },
            'OpenRouter API key missing for research processing'
          );
          // PubSub ack pattern: always return 200 OK, errors logged separately
          return await reply.ok({});
        }

        const synthesisProviders =
          research.skipSynthesis === true
            ? undefined
            : createSynthesisProviders(
                synthesisModel,
                apiKeys,
                research.userId,
                services,
                request.log,
                event.researchId
              );

        const deps: Parameters<typeof processResearch>[1] = {
          researchRepo,
          llmCallPublisher: services.llmCallPublisher,
          logger: request.log,
          reportLlmSuccess: (): void => {
            void userServiceClient.reportLlmSuccess(research.userId, 'openrouter');
          },
        };

        if (synthesisProviders !== undefined) {
          deps.synthesizer = synthesisProviders.synthesizer;
        }

        deps.titleGenerator = services.createTitleGenerator(
          DEFAULT_PLATFORM_LLM_MODEL,
          synthesisKey,
          research.userId,
          request.log,
          event.researchId
        );

        deps.contextInferrer =
          synthesisProviders?.contextInferrer ??
          services.createContextInferrer(
            DEFAULT_PLATFORM_LLM_MODEL,
            synthesisKey,
            research.userId,
            request.log,
            event.researchId
          );

        const processResult = await processResearch(event.researchId, deps);

        // For enhanced researches where all LLM results are already completed,
        // trigger synthesis immediately
        if (processResult.triggerSynthesis && synthesisProviders !== undefined) {
          request.log.info({ researchId: event.researchId }, 'Triggering synthesis directly');

          await runSynthesis(event.researchId, {
            researchRepo,
            synthesizer: synthesisProviders.synthesizer,
            notificationSender: services.notificationSender,
            shareStorage: services.shareStorage,
            shareConfig: services.shareConfig,
            imageServiceClient: services.imageServiceClient,
            contextInferrer: deps.contextInferrer,
            userId: research.userId,
            webAppUrl: services.webAppUrl,
            /* v8 ignore start -- upstream: callback only invoked by runSynthesis which is tested via domain unit tests; route test cannot trigger callback execution @preserve */
            reportLlmSuccess: (): void => {
              void userServiceClient.reportLlmSuccess(research.userId, synthesisProvider);
            },
            logger: {
              info: (obj: object, msg?: string): void => {
                request.log.info({ researchId: event.researchId, ...obj }, msg);
              },
              error: (obj: object, msg?: string): void => {
                const message = typeof msg === 'string' ? msg : typeof obj === 'string' ? obj : undefined;
                const context = typeof obj === 'string' ? {} : obj;
                request.log.error({ researchId: event.researchId, ...context }, message);
              },
              warn: (obj: object, msg?: string): void => {
                request.log.warn({ researchId: event.researchId, ...obj }, msg);
              },
              debug: (obj: object, msg?: string): void => {
                request.log.debug({ researchId: event.researchId, ...obj }, msg);
              },
            },
            /* v8 ignore stop @preserve */
            notionServiceClient: services.notionServiceClient,
            researchExportSettings: services.researchExportSettings,
            researchCostSummaryClient: services.researchCostSummaryClient ?? null,
          });
        } else if (processResult.triggerSynthesis) {
          await handleAllCompleted({
            researchId: event.researchId,
            userId: research.userId,
            researchRepo,
            apiKeys,
            services,
            userServiceClient,
            notificationSender: services.notificationSender,
            shareStorage: services.shareStorage,
            shareConfig: services.shareConfig,
            imageServiceClient: services.imageServiceClient,
            webAppUrl: services.webAppUrl,
            logger: request.log,
          });
        }

        request.log.info({ researchId: event.researchId }, 'Research processed successfully');
        return await reply.ok({});
      } catch (error) {
        request.log.error(
          { researchId: event.researchId, error: getErrorMessage(error) },
          'Research processing failed'
        );
        return await reply.fail('INTERNAL_ERROR', getErrorMessage(error));
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
            oneOf: [
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: true },
                  data: {
                    type: 'object',
                    properties: {},
                    additionalProperties: true,
                  },
                  diagnostics: { $ref: 'Diagnostics#' },
                },
                required: ['success'],
              },
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                },
                required: ['success'],
              },
            ],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
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
          return await reply.fail('UNAUTHORIZED', 'Internal auth failed for report-analytics endpoint');
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
          return await reply.ok({});
        }
        event = parsed as LlmAnalyticsEvent;
      } catch {
        request.log.error(
          { messageId: body.message.messageId },
          'Failed to decode analytics message'
        );
        return await reply.ok({});
      }

      const { userServiceClient } = getServices();

      try {
        const provider = getProviderForModel(event.model);
        if (provider !== LlmProviders.OpenRouter) {
          request.log.info(
            { model: event.model, userId: event.userId },
            'Ignored analytics for a historical direct-provider model'
          );
          return await reply.ok({});
        }
        await userServiceClient.reportLlmSuccess(event.userId, provider);
        request.log.info({ model: event.model, userId: event.userId }, 'Analytics reported');
      } catch (error) {
        request.log.warn(
          { model: event.model, error: getErrorMessage(error) },
          'Failed to report analytics'
        );
      }

      return await reply.ok({});
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
            oneOf: [
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: true },
                  data: {
                    type: 'object',
                    properties: {},
                    additionalProperties: true,
                  },
                  diagnostics: { $ref: 'Diagnostics#' },
                },
                required: ['success'],
              },
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                },
                required: ['success'],
              },
            ],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
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
          return await reply.fail('UNAUTHORIZED', 'Internal auth failed for process-llm-call endpoint');
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
          return await reply.ok({});
        }
        event = parsed as LlmCallEvent;
      } catch {
        request.log.error(
          { messageId: body.message.messageId },
          'Failed to decode LLM call message'
        );
        return await reply.ok({});
      }

      if (
        typeof event.researchId !== 'string' ||
        typeof event.userId !== 'string' ||
        typeof event.model !== 'string' ||
        typeof event.prompt !== 'string'
      ) {
        request.log.warn(
          { messageId: body.message.messageId },
          'Invalid LLM call event payload'
        );
        return await reply.ok({});
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
      const { researchRepo, userServiceClient, notificationSender, shareStorage, shareConfig, webAppUrl } =
        services;

      try {
        request.log.info(
          { researchId: event.researchId, model: event.model },
          '[3.1.1] Loading research from database'
        );
        const researchResult = await researchRepo.findById(event.researchId);
        if (!researchResult.ok || researchResult.value === null) {
          request.log.error({ researchId: event.researchId }, '[3.1.1] Research not found');
          return await reply.ok({});
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
          return await reply.ok({});
        }

        if (!isRetryableStoredResearchModel(event.model)) {
          const error = `Direct or unsupported LLM model '${event.model}' is disabled`;
          request.log.warn(
            { researchId: event.researchId, model: event.model },
            '[3.1.3] Refusing non-executable LLM model'
          );
          await researchRepo.updateLlmResult(event.researchId, event.model, {
            status: 'failed',
            error,
            completedAt: new Date().toISOString(),
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.model,
            error
          );
          await checkLlmCompletion(event.researchId, {
            researchRepo,
            logger: request.log as unknown as Logger,
          });
          return await reply.ok({});
        }

        const modelProvider = 'openrouter';

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
          return await reply.ok({});
        }

        const apiKey = apiKeysResult.value.openrouter;
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
            logger: request.log as unknown as Logger,
          });
          request.log.info(
            { researchId: event.researchId, action: keyMissingCompletionAction.type },
            '[3.5] LLM completion check after API key missing failure'
          );

          return await reply.ok({});
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
          request.log
        );
        const startTime = Date.now();
        const llmResult = await llmProvider.research(event.prompt, research.researchContext, {
          researchId: event.researchId,
          promptType: 'research-web-search',
        });
        const durationMs = Date.now() - startTime;

        if (!llmResult.ok) {
          const rawError = llmResult.error.message;
          const formattedError = formatLlmError(rawError);

          request.log.warn(
            {
              researchId: event.researchId,
              model: event.model,
              rawError,
              durationMs,
              [SKIP_SENTRY_KEY]: true,
            },
            '[3.3] LLM research call failed'
          );
          await researchRepo.updateLlmResult(event.researchId, event.model, {
            status: 'failed',
            error: formattedError,
            completedAt: new Date().toISOString(),
            durationMs,
          });
          void notificationSender.sendLlmFailure(
            event.userId,
            event.researchId,
            event.model,
            formattedError
          );

          const failCompletionAction = await checkLlmCompletion(event.researchId, {
            researchRepo,
            logger: request.log as unknown as Logger,
          });
          request.log.info(
            { researchId: event.researchId, action: failCompletionAction.type },
            '[3.5] LLM completion check after failure'
          );

          return await reply.ok({});
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

        const qualityFlag: LlmResult['qualityFlag'] =
          llmResult.value.content.length < MIN_QUALITY_CHARS ? 'low_quality' : undefined;

        if (qualityFlag === 'low_quality') {
          request.log.warn(
            { model: event.model, contentLength: llmResult.value.content.length },
            '[3.3.1] LLM result flagged as low_quality (below minimum length threshold)'
          );
        }

        const updateData: Parameters<typeof researchRepo.updateLlmResult>[2] = {
          status: 'completed',
          result: llmResult.value.content,
          completedAt: new Date().toISOString(),
          durationMs,
        };

        if (qualityFlag !== undefined) {
          updateData.qualityFlag = qualityFlag;
        }

        if (llmResult.value.sources !== undefined) {
          updateData.sources = llmResult.value.sources;
        }

        if (usage !== undefined) {
          updateData.inputTokens = usage.inputTokens;
          updateData.outputTokens = usage.outputTokens;
          if (usage.costUsd !== undefined) {
            updateData.costUsd = usage.costUsd;
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
        const completionAction = await checkLlmCompletion(event.researchId, {
          researchRepo,
          logger: request.log as unknown as Logger,
        });

        switch (completionAction.type) {
          case 'pending':
            request.log.info(
              { researchId: event.researchId },
              '[3.5.1] Still waiting for other LLM providers'
            );
            break;
          case 'all_completed':
            await handleAllCompleted({
              researchId: event.researchId,
              userId: event.userId,
              researchRepo,
              apiKeys: apiKeysResult.value,
              services,
              userServiceClient,
              notificationSender,
              shareStorage,
              shareConfig,
              imageServiceClient: services.imageServiceClient,
              webAppUrl,
              logger: request.log,
            });
            break;
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

        return await reply.ok({});
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
        // PubSub ack pattern: always return 200 OK, errors logged separately
        return await reply.ok({});
      }
    }
  );

  done();
};

function buildWebAppResourceUrl(webAppUrl: string, path: string): string {
  const baseUrl = webAppUrl.length > 0 ? webAppUrl : DEFAULT_WEB_APP_URL;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}${path}`;
}
