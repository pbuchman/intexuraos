import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { LlmProviders } from '@intexuraos/llm-contract';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { getServices } from '../services.js';

interface UsageCostsQuery {
  days?: string;
}

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

export const publicRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /settings/pricing
   * Returns pricing configuration for all LLM providers.
   * Requires user authentication (Bearer token).
   */
  fastify.get(
    '/settings/pricing',
    {
      schema: {
        operationId: 'getPricing',
        summary: 'Get LLM pricing for all providers',
        description: 'Public authenticated endpoint for retrieving LLM pricing configuration',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  google: { $ref: 'ProviderPricing#' },
                  openai: { $ref: 'ProviderPricing#' },
                  anthropic: { $ref: 'ProviderPricing#' },
                  perplexity: { $ref: 'ProviderPricing#' },
                  zai: { $ref: 'ProviderPricing#' },
                },
                required: ['google', 'openai', 'anthropic', 'perplexity', 'zai'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /settings/pricing',
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { pricingRepository } = getServices();

      const [google, openai, anthropic, perplexity, zai] = await Promise.all([
        pricingRepository.getByProvider(LlmProviders.Google),
        pricingRepository.getByProvider(LlmProviders.OpenAI),
        pricingRepository.getByProvider(LlmProviders.Anthropic),
        pricingRepository.getByProvider(LlmProviders.Perplexity),
        pricingRepository.getByProvider(LlmProviders.Zai),
      ]);

      // Check if any provider is missing - need individual null checks for TypeScript narrowing
      if (google === null) {
        request.log.error(
          { missingProviders: [LlmProviders.Google] },
          'Missing pricing for providers'
        );
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${LlmProviders.Google}`
        );
      }
      if (openai === null) {
        request.log.error(
          { missingProviders: [LlmProviders.OpenAI] },
          'Missing pricing for providers'
        );
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${LlmProviders.OpenAI}`
        );
      }
      if (anthropic === null) {
        request.log.error(
          { missingProviders: [LlmProviders.Anthropic] },
          'Missing pricing for providers'
        );
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${LlmProviders.Anthropic}`
        );
      }
      if (perplexity === null) {
        request.log.error(
          { missingProviders: [LlmProviders.Perplexity] },
          'Missing pricing for providers'
        );
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${LlmProviders.Perplexity}`
        );
      }
      if (zai === null) {
        request.log.error(
          { missingProviders: [LlmProviders.Zai] },
          'Missing pricing for providers'
        );
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${LlmProviders.Zai}`
        );
      }

      // At this point all providers are non-null (TypeScript can narrow from the early returns above)
      const totalModels =
        Object.keys(google.models).length +
        Object.keys(openai.models).length +
        Object.keys(anthropic.models).length +
        Object.keys(perplexity.models).length +
        Object.keys(zai.models).length;

      request.log.info({ userId: user.userId, totalModels }, 'Returning pricing for all providers');

      return await reply.ok({
        google,
        openai,
        anthropic,
        perplexity,
        zai,
      });
    }
  );

  /**
   * GET /settings/usage-costs
   * Returns aggregated LLM usage costs for the authenticated user.
   * Scoped by user, aggregated by day, with monthly and model breakdowns.
   */
  fastify.get<{ Querystring: UsageCostsQuery }>(
    '/settings/usage-costs',
    {
      schema: {
        operationId: 'getUsageCosts',
        summary: 'Get LLM usage costs for the authenticated user',
        description:
          'Returns aggregated LLM usage costs scoped by user, with monthly breakdown, by-model, and by-call-type views',
        tags: ['settings'],
        querystring: {
          type: 'object',
          properties: {
            days: {
              type: 'string',
              description: 'Number of days to fetch (default: 90, max: 365)',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: { $ref: 'AggregatedCosts#' },
            },
            required: ['success', 'data'],
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Querystring: UsageCostsQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /settings/usage-costs',
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      let days = DEFAULT_DAYS;
      if (request.query.days !== undefined) {
        const parsed = parseInt(request.query.days, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > MAX_DAYS) {
          return await reply.fail('INVALID_REQUEST', `days must be between 1 and ${String(MAX_DAYS)}`);
        }
        days = parsed;
      }

      const { usageStatsRepository } = getServices();

      try {
        const costs = await usageStatsRepository.getUserCosts(user.userId, days);

        request.log.info(
          {
            userId: user.userId,
            days,
            totalCostUsd: costs.totalCostUsd,
            totalCalls: costs.totalCalls,
            monthCount: costs.monthlyBreakdown.length,
            modelCount: costs.byModel.length,
          },
          'Returning usage costs for user'
        );

        return await reply.ok(costs);
      } catch (error) {
        request.log.error({ error: getErrorMessage(error) }, 'Failed to fetch usage costs');
        return await reply.fail('INTERNAL_ERROR', 'Failed to fetch usage costs');
      }
    }
  );

  done();
};
