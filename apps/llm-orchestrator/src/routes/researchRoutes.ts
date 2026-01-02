/**
 * Research Routes
 *
 * POST   /research            - Create new research
 * POST   /research/draft      - Save research as draft
 * GET    /research            - List user's researches
 * GET    /research/:id        - Get single research
 * POST   /research/:id/approve - Approve draft research
 * POST   /research/:id/confirm - Confirm partial failure decision
 * DELETE /research/:id        - Delete research
 * DELETE /research/:id/share  - Remove public share access
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import {
  createDraftResearch,
  deleteResearch,
  type ExternalReport,
  getResearch,
  listResearches,
  type LlmProvider,
  type PartialFailureDecision,
  type Research,
  retryFailedLlms,
  runSynthesis,
  submitResearch,
  unshareResearch,
} from '../domain/research/index.js';
import { getServices } from '../services.js';
import {
  approveResearchResponseSchema,
  confirmPartialFailureBodySchema,
  confirmPartialFailureResponseSchema,
  createResearchBodySchema,
  createResearchResponseSchema,
  deleteResearchResponseSchema,
  getResearchResponseSchema,
  listResearchesQuerySchema,
  listResearchesResponseSchema,
  researchIdParamsSchema,
  saveDraftBodySchema,
  saveDraftResponseSchema,
  updateDraftBodySchema,
} from './schemas/index.js';

interface CreateResearchBody {
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm?: LlmProvider;
  externalReports?: { content: string; model?: string }[];
  skipSynthesis?: boolean;
}

interface SaveDraftBody {
  prompt: string;
  selectedLlms?: LlmProvider[];
  synthesisLlm?: LlmProvider;
  externalReports?: { content: string; model?: string }[];
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
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as CreateResearchBody;
      const { researchRepo, generateId, researchEventPublisher } = getServices();

      const submitParams: Parameters<typeof submitResearch>[0] = {
        userId: user.userId,
        prompt: body.prompt,
        selectedLlms: body.selectedLlms,
        synthesisLlm: body.synthesisLlm ?? body.selectedLlms[0] ?? 'google',
      };
      if (body.externalReports !== undefined) {
        submitParams.externalReports = body.externalReports;
      }
      if (body.skipSynthesis === true) {
        submitParams.skipSynthesis = true;
      }
      const result = await submitResearch(submitParams, { researchRepo, generateId });

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
      const { researchRepo, generateId, userServiceClient, createTitleGenerator } = getServices();

      // Get user's API keys to generate title
      const apiKeysResult = await userServiceClient.getApiKeys(user.userId);
      const apiKeys = apiKeysResult.ok ? apiKeysResult.value : {};

      // Generate title using Gemini if Google API key is available
      let title: string;
      if (apiKeys.google !== undefined) {
        const titleGenerator = createTitleGenerator(apiKeys.google);
        const titleResult = await titleGenerator.generateTitle(body.prompt);
        title = titleResult.ok ? titleResult.value : body.prompt.slice(0, 60);
      } else {
        // Fallback: use first 60 chars of prompt
        title = body.prompt.slice(0, 60);
      }

      // Create draft research
      const resolvedSelectedLlms = body.selectedLlms ?? ['google', 'openai', 'anthropic'];
      const draftParams: Parameters<typeof createDraftResearch>[0] = {
        id: generateId(),
        userId: user.userId,
        title,
        prompt: body.prompt,
        selectedLlms: resolvedSelectedLlms,
        synthesisLlm: body.synthesisLlm ?? resolvedSelectedLlms[0] ?? 'google',
      };
      if (body.externalReports !== undefined) {
        const now = new Date().toISOString();
        draftParams.externalReports = body.externalReports.map((report) => {
          const externalReport: ExternalReport = {
            id: generateId(),
            content: report.content,
            addedAt: now,
          };
          if (report.model !== undefined) {
            externalReport.model = report.model;
          }
          return externalReport;
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
      const { researchRepo, userServiceClient, createTitleGenerator } = getServices();

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
          const titleGenerator = createTitleGenerator(apiKeys.google);
          const titleResult = await titleGenerator.generateTitle(body.prompt);
          title = titleResult.ok ? titleResult.value : body.prompt.slice(0, 60);
        } else {
          title = body.prompt.slice(0, 60);
        }
      }

      // Update draft
      const updates: Partial<Research> = {
        title,
        prompt: body.prompt,
        selectedLlms: body.selectedLlms ?? existing.selectedLlms,
        synthesisLlm: body.synthesisLlm ?? existing.synthesisLlm,
      };

      if (body.externalReports !== undefined) {
        const now = new Date().toISOString();
        updates.externalReports = body.externalReports.map((report) => {
          const externalReport: ExternalReport = {
            id: crypto.randomUUID(),
            content: report.content,
            addedAt: now,
          };
          if (report.model !== undefined) {
            externalReport.model = report.model;
          }
          return externalReport;
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
        notificationSender,
        llmCallPublisher,
        createSynthesizer,
        shareStorage,
        shareConfig,
      } = getServices();
      const webAppUrl = process.env['INTEXURAOS_WEB_APP_URL'] ?? '';

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

          const synthesisProvider = research.synthesisLlm;
          const synthesisKey = apiKeysResult.value[synthesisProvider];
          if (synthesisKey === undefined) {
            return await reply.fail(
              'MISCONFIGURED',
              `API key required for synthesis with ${synthesisProvider}`
            );
          }

          await researchRepo.update(id, {
            partialFailure: {
              ...partialFailure,
              userDecision: 'proceed',
            },
          });

          const synthesizer = createSynthesizer(synthesisProvider, synthesisKey);
          const synthesisResult = await runSynthesis(id, {
            researchRepo,
            synthesizer,
            notificationSender,
            shareStorage,
            shareConfig,
            webAppUrl,
            reportLlmSuccess: (): void => {
              void userServiceClient.reportLlmSuccess(user.userId, synthesisProvider);
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
              message: `Retrying failed providers: ${(retryResult.retriedProviders ?? []).join(', ')}`,
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
      const { researchRepo, shareStorage } = getServices();

      const result = await unshareResearch(params.id, user.userId, {
        researchRepo,
        shareStorage,
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

  done();
};
