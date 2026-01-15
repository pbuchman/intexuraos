/**
 * Research Routes
 *
 * POST   /research             - Create new research
 * POST   /research/draft       - Save research as draft
 * GET    /research             - List user's researches
 * GET    /research/:id         - Get single research
 * POST   /research/:id/approve - Approve draft research
 * POST   /research/:id/confirm  - Confirm partial failure decision
 * POST   /research/:id/retry    - Retry from failed status
 * POST   /research/:id/enhance  - Create enhanced research from completed
 * DELETE /research/:id          - Delete research
 * DELETE /research/:id/share    - Remove public share access
 * PATCH  /research/:id/favourite - Toggle favourite status
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { Logger } from 'pino';
import {
  createDraftResearch,
  createLlmResults,
  deleteResearch,
  enhanceResearch,
  type InputContext,
  getResearch,
  listResearches,
  type PartialFailureDecision,
  type Research,
  type ResearchModel,
  retryFailedLlms,
  retryFromFailed,
  runSynthesis,
  submitResearch,
  toggleResearchFavourite,
  unshareResearch,
  generateContextLabels,
} from '../domain/research/index.js';
import { getProviderForModel, LlmModels } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import { createSynthesisProviders } from './helpers/synthesisHelper.js';
import {
  approveResearchResponseSchema,
  confirmPartialFailureBodySchema,
  confirmPartialFailureResponseSchema,
  createResearchBodySchema,
  createResearchResponseSchema,
  deleteResearchResponseSchema,
  enhanceResearchBodySchema,
  enhanceResearchResponseSchema,
  getResearchResponseSchema,
  listResearchesQuerySchema,
  listResearchesResponseSchema,
  researchIdParamsSchema,
  retryFromFailedResponseSchema,
  saveDraftBodySchema,
  saveDraftResponseSchema,
  toggleFavouriteBodySchema,
  toggleFavouriteResponseSchema,
  updateDraftBodySchema,
  validateInputBodySchema,
  validateInputResponseSchema,
  improveInputBodySchema,
  improveInputResponseSchema,
} from './schemas/index.js';

interface CreateResearchBody {
  prompt: string;
  selectedModels: ResearchModel[];
  synthesisModel?: ResearchModel;
  inputContexts?: { content: string; label?: string }[];
  skipSynthesis?: boolean;
}

interface SaveDraftBody {
  prompt: string;
  selectedModels?: ResearchModel[];
  synthesisModel?: ResearchModel;
  inputContexts?: { content: string; label?: string }[];
}

interface ListResearchesQuery {
  limit?: number;
  cursor?: string;
}

interface ResearchIdParams {
  id: string;
}

interface ConfirmPartialFailureBody {
  action: PartialFailureDecision;
}

interface EnhanceResearchBody {
  additionalModels?: ResearchModel[];
  additionalContexts?: { content: string; label?: string }[];
  synthesisModel?: ResearchModel;
  removeContextIds?: string[];
}

export const researchRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /research
  fastify.post(
    '/research',
    {
      schema: {
        operationId: 'createResearch',
        summary: 'Create new research',
        description: 'Submit a research prompt to be processed by multiple LLMs.',
        tags: ['research'],
        body: createResearchBodySchema,
        response: {
          201: createResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /research',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as CreateResearchBody;
      const {
        researchRepo,
        generateId,
        researchEventPublisher,
        userServiceClient,
        createTitleGenerator,
        pricingContext,
      } = getServices();

      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      const apiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

      const submitParams: Parameters<typeof submitResearch>[0] = {
        userId: user.userId,
        prompt: body.prompt,
        selectedModels: body.selectedModels,
        synthesisModel: body.synthesisModel ?? body.selectedModels[0] ?? LlmModels.Gemini25Pro,
      };
      if (body.inputContexts !== undefined) {
        const contextsWithLabels = await generateContextLabels(
          body.inputContexts,
          apiKeys.google,
          user.userId,
          createTitleGenerator,
          pricingContext.getPricing(LlmModels.Gemini25Flash),
          request.log
        );
        submitParams.inputContexts = contextsWithLabels;
      }
      if (body.skipSynthesis === true) {
        submitParams.skipSynthesis = true;
      }
      const result = await submitResearch(submitParams, {
        researchRepo,
        generateId,
        logger: request.log as unknown as Logger,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      // Publish to Pub/Sub for async processing
      await researchEventPublisher.publishProcessResearch({
        type: 'research.process',
        researchId: result.value.id,
        userId: user.userId,
        triggeredBy: 'create',
      });

      return await reply.code(201).ok(result.value);
    }
  );

  // POST /research/draft
  fastify.post(
    '/research/draft',
    {
      schema: {
        operationId: 'saveDraft',
        summary: 'Save research as draft',
        description: 'Save a research draft with auto-generated title for later completion.',
        tags: ['research'],
        body: saveDraftBodySchema,
        response: {
          201: saveDraftResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as SaveDraftBody;
      const { researchRepo, generateId, userServiceClient, createTitleGenerator, pricingContext } =
        getServices();

      // Get user's API keys to generate title
      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      const apiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

      // Generate title using Gemini if Google API key is available
      let title: string;
      if (apiKeys.google !== undefined) {
        const titleGenerator = createTitleGenerator(
          LlmModels.Gemini25Flash,
          apiKeys.google,
          user.userId,
          pricingContext.getPricing(LlmModels.Gemini25Flash),
          request.log
        );
        const titleResult = await titleGenerator.generateTitle(body.prompt);
        title = titleResult.ok ? titleResult.value.title : body.prompt.slice(0, 60);
      } else {
        // Fallback: use first 60 chars of prompt
        title = body.prompt.slice(0, 60);
      }

      // Create draft research (no default models - user must select before approving)
      const selectedModels = body.selectedModels ?? [];
      const draftParams: Parameters<typeof createDraftResearch>[0] = {
        id: generateId(),
        userId: user.userId,
        title,
        prompt: body.prompt,
        selectedModels,
        synthesisModel: body.synthesisModel ?? selectedModels[0] ?? LlmModels.Gemini25Pro,
      };
      if (body.inputContexts !== undefined) {
        const contextsWithLabels = await generateContextLabels(
          body.inputContexts,
          apiKeys.google,
          user.userId,
          createTitleGenerator,
          pricingContext.getPricing(LlmModels.Gemini25Flash),
          request.log
        );
        const now = new Date().toISOString();
        draftParams.inputContexts = contextsWithLabels.map((ctx) => {
          const inputContext: InputContext = {
            id: generateId(),
            content: ctx.content,
            addedAt: now,
          };
          if (ctx.label !== undefined) {
            inputContext.label = ctx.label;
          }
          return inputContext;
        });
      }
      const draft = createDraftResearch(draftParams);

      // Save draft
      const saveResult = await researchRepo.save(draft);
      if (!saveResult.ok) {
        return await reply.fail('INTERNAL_ERROR', saveResult.error.message);
      }

      return await reply.code(201).ok({ id: draft.id });
    }
  );

  // PATCH /research/:id
  fastify.patch(
    '/research/:id',
    {
      schema: {
        operationId: 'updateDraft',
        summary: 'Update draft research',
        description: 'Update an existing draft research. Only drafts can be updated.',
        tags: ['research'],
        params: researchIdParamsSchema,
        body: updateDraftBodySchema,
        response: {
          200: getResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { id } = request.params as { id: string };
      const body = request.body as SaveDraftBody;
      const { researchRepo, generateId, userServiceClient, createTitleGenerator, pricingContext } =
        getServices();

      // Get existing research
      const existingResult = await researchRepo.findById(id);
      if (!existingResult.ok) {
        return await reply.fail('INTERNAL_ERROR', existingResult.error.message);
      }
      if (existingResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      const existing = existingResult.value;

      // Check ownership
      if (existing.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Not authorized to update this research');
      }

      // Can only update drafts
      if (existing.status !== 'draft') {
        return await reply.fail('CONFLICT', 'Can only update draft research');
      }

      // Get user's API keys to regenerate title if prompt changed
      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      const apiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

      // Regenerate title if prompt changed
      let title = existing.title;
      if (body.prompt !== existing.prompt) {
        if (apiKeys.google !== undefined) {
          const titleGenerator = createTitleGenerator(
            LlmModels.Gemini25Flash,
            apiKeys.google,
            user.userId,
            pricingContext.getPricing(LlmModels.Gemini25Flash),
            request.log
          );
          const titleResult = await titleGenerator.generateTitle(body.prompt);
          title = titleResult.ok ? titleResult.value.title : body.prompt.slice(0, 60);
        } else {
          title = body.prompt.slice(0, 60);
        }
      }

      // Update draft
      const newSelectedModels = body.selectedModels ?? existing.selectedModels;
      const updates: Partial<Research> = {
        title,
        prompt: body.prompt,
        selectedModels: newSelectedModels,
        synthesisModel: body.synthesisModel ?? existing.synthesisModel,
        llmResults: createLlmResults(newSelectedModels),
      };

      if (body.inputContexts !== undefined) {
        const contextsWithLabels = await generateContextLabels(
          body.inputContexts,
          apiKeys.google,
          user.userId,
          createTitleGenerator,
          pricingContext.getPricing(LlmModels.Gemini25Flash),
          request.log
        );
        const now = new Date().toISOString();
        updates.inputContexts = contextsWithLabels.map((ctx) => {
          const inputContext: InputContext = {
            id: generateId(),
            content: ctx.content,
            addedAt: now,
          };
          if (ctx.label !== undefined) {
            inputContext.label = ctx.label;
          }
          return inputContext;
        });
      }

      const updateResult = await researchRepo.update(id, updates);
      if (!updateResult.ok) {
        return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
      }

      // Return updated research
      const updatedResult = await researchRepo.findById(id);
      if (!updatedResult.ok || updatedResult.value === null) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to retrieve updated research');
      }

      return await reply.ok(updatedResult.value);
    }
  );

  // POST /research/validate-input
  fastify.post(
    '/research/validate-input',
    {
      schema: {
        operationId: 'validateInput',
        summary: 'Validate research input quality',
        description:
          'Validates input quality and optionally returns improvement suggestion for weak prompts.',
        tags: ['research'],
        body: validateInputBodySchema,
        response: {
          200: validateInputResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as { prompt: string; includeImprovement?: boolean };
      const { userServiceClient, createInputValidator, pricingContext, generateId } = getServices();
      const requestId = generateId();
      const startTime = Date.now();

      // Get Google API key
      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      if (!apiKeysResult.ok) {
        request.log.error({ requestId }, 'Failed to fetch API keys');
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch API keys');
      }

      const googleKey = apiKeysResult.value.google;
      if (googleKey === undefined) {
        request.log.error({ requestId }, 'Google API key not configured');
        return await reply.fail('MISCONFIGURED', 'Google API key required for validation');
      }

      const validator = createInputValidator(
        LlmModels.Gemini25Flash,
        googleKey,
        user.userId,
        pricingContext.getPricing(LlmModels.Gemini25Flash),
        request.log
      );

      // Validate
      const validationResult = await validator.validateInput(body.prompt);
      if (!validationResult.ok) {
        request.log.error(
          {
            requestId,
            errorCode: validationResult.error.code,
            errorMessage: validationResult.error.message,
          },
          'Validation failed'
        );
        return await reply.code(500).send({
          success: false,
          error: {
            code: validationResult.error.code,
            message: validationResult.error.message,
          },
          diagnostics: { requestId, durationMs: Date.now() - startTime },
        });
      }

      const { quality, reason } = validationResult.value;
      let improvedPrompt: string | null = null;

      // Get improvement if requested and quality is WEAK_BUT_VALID
      if (body.includeImprovement === true && quality === 1) {
        const improvementResult = await validator.improveInput(body.prompt);
        if (improvementResult.ok) {
          improvedPrompt = improvementResult.value.improvedPrompt;
        }
      }

      return await reply.code(200).send({
        success: true,
        data: { quality, reason, improvedPrompt },
        diagnostics: { requestId, durationMs: Date.now() - startTime },
      });
    }
  );

  // POST /research/improve-input
  fastify.post(
    '/research/improve-input',
    {
      schema: {
        operationId: 'improveInput',
        summary: 'Improve research input',
        description: 'Force-improves input regardless of quality.',
        tags: ['research'],
        body: improveInputBodySchema,
        response: {
          200: improveInputResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as { prompt: string };
      const { userServiceClient, createInputValidator, pricingContext, generateId } = getServices();
      const requestId = generateId();
      const startTime = Date.now();

      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      if (!apiKeysResult.ok) {
        request.log.error({ requestId }, 'Failed to fetch API keys');
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch API keys');
      }

      const googleKey = apiKeysResult.value.google;
      if (googleKey === undefined) {
        request.log.error({ requestId }, 'Google API key not configured');
        return await reply.fail('MISCONFIGURED', 'Google API key required for improvement');
      }

      const validator = createInputValidator(
        LlmModels.Gemini25Flash,
        googleKey,
        user.userId,
        pricingContext.getPricing(LlmModels.Gemini25Flash),
        request.log
      );

      const result = await validator.improveInput(body.prompt);
      if (!result.ok) {
        request.log.warn(
          { requestId, errorCode: result.error.code, errorMessage: result.error.message },
          'Improvement failed, returning original prompt'
        );
        return await reply.code(200).send({
          success: true,
          data: { improvedPrompt: body.prompt },
          diagnostics: { requestId, durationMs: Date.now() - startTime },
        });
      }

      return await reply.code(200).send({
        success: true,
        data: { improvedPrompt: result.value.improvedPrompt },
        diagnostics: { requestId, durationMs: Date.now() - startTime },
      });
    }
  );

  // GET /research
  fastify.get(
    '/research',
    {
      schema: {
        operationId: 'listResearches',
        summary: 'List researches',
        description: "Get a paginated list of the user's researches.",
        tags: ['research'],
        querystring: listResearchesQuerySchema,
        response: {
          200: listResearchesResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const query = request.query as ListResearchesQuery;
      const { researchRepo } = getServices();

      const params: { userId: string; limit?: number; cursor?: string } = {
        userId: user.userId,
      };
      if (query.limit !== undefined) {
        params.limit = query.limit;
      }
      if (query.cursor !== undefined) {
        params.cursor = query.cursor;
      }

      const result = await listResearches(params, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // GET /research/:id
  fastify.get(
    '/research/:id',
    {
      schema: {
        operationId: 'getResearch',
        summary: 'Get research',
        description: 'Get details of a specific research.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: getResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo } = getServices();

      const result = await getResearch(params.id, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      // Check ownership
      if (result.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      return await reply.ok(result.value);
    }
  );

  // POST /research/:id/approve
  fastify.post(
    '/research/:id/approve',
    {
      schema: {
        operationId: 'approveResearch',
        summary: 'Approve draft research',
        description: 'Approve a draft research and start processing.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: approveResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo, researchEventPublisher } = getServices();

      const existing = await getResearch(params.id, { researchRepo });

      if (!existing.ok) {
        return await reply.fail('INTERNAL_ERROR', existing.error.message);
      }

      if (existing.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      if (existing.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      if (existing.value.status !== 'draft') {
        return await reply.fail('CONFLICT', 'Research is not in draft status');
      }

      // Require at least one source: either models or input contexts
      const hasModels = existing.value.selectedModels.length > 0;
      const hasContexts =
        existing.value.inputContexts !== undefined && existing.value.inputContexts.length > 0;
      if (!hasModels && !hasContexts) {
        return await reply.fail(
          'INVALID_REQUEST',
          'Select at least one model or provide input context before starting research'
        );
      }

      const updateResult = await researchRepo.update(params.id, { status: 'pending' });

      if (!updateResult.ok) {
        return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
      }

      // Publish to Pub/Sub for async processing
      await researchEventPublisher.publishProcessResearch({
        type: 'research.process',
        researchId: params.id,
        userId: user.userId,
        triggeredBy: 'approve',
      });

      return await reply.ok(updateResult.value);
    }
  );

  // POST /research/:id/confirm
  fastify.post(
    '/research/:id/confirm',
    {
      schema: {
        operationId: 'confirmPartialFailure',
        summary: 'Confirm partial failure decision',
        description:
          'Submit user decision for handling partial LLM failures: proceed with successful results, retry failed providers, or cancel.',
        tags: ['research'],
        params: researchIdParamsSchema,
        body: confirmPartialFailureBodySchema,
        response: {
          200: confirmPartialFailureResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { id } = request.params as ResearchIdParams;
      const body = request.body as ConfirmPartialFailureBody;
      const {
        researchRepo,
        userServiceClient,
        imageServiceClient,
        notificationSender,
        llmCallPublisher,
        shareStorage,
        shareConfig,
        webAppUrl,
      } = getServices();

      const existing = await getResearch(id, { researchRepo });

      if (!existing.ok) {
        return await reply.fail('INTERNAL_ERROR', existing.error.message);
      }

      if (existing.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      if (existing.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      if (existing.value.status !== 'awaiting_confirmation') {
        return await reply.fail('CONFLICT', 'Research is not awaiting confirmation');
      }

      const research = existing.value;

      if (research.partialFailure === undefined) {
        return await reply.fail('CONFLICT', 'No partial failure info found');
      }

      const partialFailure = research.partialFailure;

      switch (body.action) {
        case 'proceed': {
          const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
          if (!apiKeysResult.ok) {
            return await reply.fail('INTERNAL_ERROR', 'Failed to fetch API keys');
          }

          const synthesisModel = research.synthesisModel;
          const synthesisProvider = getProviderForModel(synthesisModel);
          const synthesisKey = apiKeysResult.value[synthesisProvider];
          if (synthesisKey === undefined) {
            return await reply.fail(
              'MISCONFIGURED',
              `API key required for synthesis with ${synthesisModel}`
            );
          }

          await researchRepo.update(id, {
            partialFailure: {
              ...partialFailure,
              userDecision: 'proceed',
            },
          });

          const { synthesizer, contextInferrer } = createSynthesisProviders(
            synthesisModel,
            apiKeysResult.value,
            user.userId,
            getServices(),
            request.log
          );

          const synthesisResult = await runSynthesis(id, {
            researchRepo,
            synthesizer,
            notificationSender,
            shareStorage,
            shareConfig,
            imageServiceClient,
            ...(contextInferrer !== undefined && { contextInferrer }),
            userId: user.userId,
            webAppUrl,
            reportLlmSuccess: (): void => {
              void userServiceClient.reportLlmSuccess(user.userId, synthesisProvider);
            },
            logger: {
              info: (obj: object, msg?: string): void => {
                request.log.info({ researchId: id, ...obj }, msg);
              },
              error: (obj: object, msg?: string): void => {
                const message = typeof msg === 'string' ? msg : typeof obj === 'string' ? obj : undefined;
                const context = typeof obj === 'string' ? {} : obj;
                request.log.error({ researchId: id, ...context }, message);
              },
              warn: (obj: object, msg?: string): void => {
                request.log.warn({ researchId: id, ...obj }, msg);
              },
              debug: (obj: object, msg?: string): void => {
                request.log.debug({ researchId: id, ...obj }, msg);
              },
            },
          });

          if (synthesisResult.ok) {
            return await reply.ok({
              action: 'proceed',
              message: 'Synthesis completed successfully',
            });
          }
          return await reply.fail('INTERNAL_ERROR', synthesisResult.error ?? 'Synthesis failed');
        }

        case 'retry': {
          await researchRepo.update(id, {
            partialFailure: {
              ...partialFailure,
              userDecision: 'retry',
            },
          });

          const retryResult = await retryFailedLlms(id, { researchRepo, llmCallPublisher });

          if (retryResult.ok) {
            return await reply.ok({
              action: 'retry',
              message: `Retrying failed models: ${(retryResult.retriedModels ?? []).join(', ')}`,
            });
          }
          return await reply.fail('INTERNAL_ERROR', retryResult.error ?? 'Retry failed');
        }

        case 'cancel': {
          await researchRepo.update(id, {
            status: 'failed',
            synthesisError: 'Cancelled by user',
            completedAt: new Date().toISOString(),
            partialFailure: {
              ...partialFailure,
              userDecision: 'cancel',
            },
          });

          return await reply.ok({ action: 'cancel', message: 'Research cancelled' });
        }
      }
    }
  );

  // POST /research/:id/retry
  fastify.post(
    '/research/:id/retry',
    {
      schema: {
        operationId: 'retryFromFailed',
        summary: 'Retry from failed status',
        description:
          'Retry a failed research by re-running failed LLMs or synthesis. Idempotent: returns success if nothing to retry.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: retryFromFailedResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { id } = request.params as ResearchIdParams;
      const {
        researchRepo,
        userServiceClient,
        imageServiceClient,
        notificationSender,
        llmCallPublisher,
        shareStorage,
        shareConfig,
        webAppUrl,
      } = getServices();

      const existing = await getResearch(id, { researchRepo });

      if (!existing.ok) {
        return await reply.fail('INTERNAL_ERROR', existing.error.message);
      }

      if (existing.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      if (existing.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      const research = existing.value;

      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      if (!apiKeysResult.ok) {
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch API keys');
      }

      const synthesisModel = research.synthesisModel;
      const synthesisProvider = getProviderForModel(synthesisModel);
      const synthesisKey = apiKeysResult.value[synthesisProvider];
      if (synthesisKey === undefined) {
        return await reply.fail(
          'MISCONFIGURED',
          `API key required for synthesis with ${synthesisModel}`
        );
      }

      const { synthesizer, contextInferrer } = createSynthesisProviders(
        synthesisModel,
        apiKeysResult.value,
        user.userId,
        getServices(),
        request.log
      );

      const retryResult = await retryFromFailed(id, {
        researchRepo,
        llmCallPublisher,
        synthesisDeps: {
          synthesizer,
          ...(contextInferrer !== undefined && { contextInferrer }),
          notificationSender,
          shareStorage,
          shareConfig,
          imageServiceClient,
          userId: user.userId,
          webAppUrl,
          reportLlmSuccess: (): void => {
            void userServiceClient.reportLlmSuccess(user.userId, synthesisProvider);
          },
          imageApiKeys: apiKeysResult.value,
          logger: request.log,
        },
      });

      if (!retryResult.ok) {
        if (retryResult.error?.startsWith('Cannot retry from status') === true) {
          return await reply.fail('CONFLICT', retryResult.error);
        }
        return await reply.fail('INTERNAL_ERROR', retryResult.error ?? 'Retry failed');
      }

      const messages: Record<string, string> = {
        retried_llms: `Retrying failed models: ${(retryResult.retriedModels ?? []).join(', ')}`,
        retried_synthesis: 'Re-running synthesis',
        already_completed: 'Research is already completed',
      };

      return await reply.ok({
        action: retryResult.action,
        message: messages[retryResult.action ?? 'already_completed'],
        ...(retryResult.retriedModels !== undefined && {
          retriedModels: retryResult.retriedModels,
        }),
      });
    }
  );

  // POST /research/:id/enhance
  fastify.post(
    '/research/:id/enhance',
    {
      schema: {
        operationId: 'enhanceResearch',
        summary: 'Enhance completed research',
        description:
          'Create a new research based on a completed one, reusing successful LLM results and adding new providers or contexts.',
        tags: ['research'],
        params: researchIdParamsSchema,
        body: enhanceResearchBodySchema,
        response: {
          201: enhanceResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { id } = request.params as ResearchIdParams;
      const body = request.body as EnhanceResearchBody;
      const {
        researchRepo,
        generateId,
        researchEventPublisher,
        userServiceClient,
        createTitleGenerator,
        pricingContext,
      } = getServices();

      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      const apiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

      const enhanceInput: Parameters<typeof enhanceResearch>[0] = {
        sourceResearchId: id,
        userId: user.userId,
      };
      if (body.additionalModels !== undefined) {
        enhanceInput.additionalModels = body.additionalModels;
      }
      if (body.additionalContexts !== undefined) {
        const contextsWithLabels = await generateContextLabels(
          body.additionalContexts,
          apiKeys.google,
          user.userId,
          createTitleGenerator,
          pricingContext.getPricing(LlmModels.Gemini25Flash),
          request.log
        );
        enhanceInput.additionalContexts = contextsWithLabels;
      }
      if (body.synthesisModel !== undefined) {
        enhanceInput.synthesisModel = body.synthesisModel;
      }
      if (body.removeContextIds !== undefined) {
        enhanceInput.removeContextIds = body.removeContextIds;
      }

      const result = await enhanceResearch(enhanceInput, {
        researchRepo,
        generateId,
        logger: request.log as unknown as Logger,
      });

      if (!result.ok) {
        switch (result.error.type) {
          case 'NOT_FOUND':
            return await reply.fail('NOT_FOUND', 'Research not found');
          case 'FORBIDDEN':
            return await reply.fail('FORBIDDEN', 'Access denied');
          case 'INVALID_STATUS':
            return await reply.fail(
              'CONFLICT',
              `Cannot enhance research in ${result.error.status} status`
            );
          case 'NO_CHANGES':
            return await reply.fail('CONFLICT', 'At least one change is required');
          case 'REPO_ERROR':
            return await reply.fail('INTERNAL_ERROR', result.error.error.message);
        }
      }

      // Publish to Pub/Sub for async processing
      await researchEventPublisher.publishProcessResearch({
        type: 'research.process',
        researchId: result.value.id,
        userId: user.userId,
        triggeredBy: 'create',
      });

      return await reply.code(201).ok(result.value);
    }
  );

  // DELETE /research/:id
  fastify.delete(
    '/research/:id',
    {
      schema: {
        operationId: 'deleteResearch',
        summary: 'Delete research',
        description: 'Delete a specific research.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: deleteResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo } = getServices();

      // Check ownership first
      const existing = await getResearch(params.id, { researchRepo });
      if (!existing.ok || existing.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      if (existing.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      const result = await deleteResearch(params.id, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(null);
    }
  );

  // DELETE /research/:id/share - Remove public share access
  fastify.delete(
    '/research/:id/share',
    {
      schema: {
        operationId: 'unshareResearch',
        summary: 'Remove public share access',
        description:
          'Remove public share access for a research by deleting the shared HTML and clearing shareInfo.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: deleteResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo, shareStorage, imageServiceClient } = getServices();

      const result = await unshareResearch(params.id, user.userId, {
        researchRepo,
        shareStorage,
        imageServiceClient,
        logger: request.log,
      });

      if (!result.ok) {
        if (result.error === 'Research not found') {
          return await reply.fail('NOT_FOUND', result.error);
        }
        if (result.error === 'Access denied') {
          return await reply.fail('FORBIDDEN', result.error);
        }
        if (result.error === 'Research is not shared') {
          return await reply.fail('CONFLICT', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error ?? 'Failed to unshare');
      }

      return await reply.ok(null);
    }
  );

  // PATCH /research/:id/favourite - Toggle favourite status
  fastify.patch(
    '/research/:id/favourite',
    {
      schema: {
        operationId: 'toggleFavourite',
        summary: 'Toggle research favourite status',
        description: 'Mark or unmark a research as a favourite.',
        tags: ['research'],
        params: researchIdParamsSchema,
        body: toggleFavouriteBodySchema,
        response: {
          200: toggleFavouriteResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { id } = request.params as ResearchIdParams;
      const body = request.body as { favourite: boolean };
      const { researchRepo } = getServices();

      const result = await toggleResearchFavourite(
        { researchId: id, userId: user.userId, favourite: body.favourite },
        { researchRepo }
      );

      if (!result.ok) {
        switch (result.error.type) {
          case 'NOT_FOUND':
            return await reply.fail('NOT_FOUND', 'Research not found');
          case 'FORBIDDEN':
            return await reply.fail('FORBIDDEN', 'Access denied');
          case 'REPO_ERROR':
            return await reply.fail('INTERNAL_ERROR', result.error.error.message);
        }
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
