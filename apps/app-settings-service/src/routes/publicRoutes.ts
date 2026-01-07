import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { LlmProviders } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';

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
                },
                required: ['google', 'openai', 'anthropic', 'perplexity'],
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

      const [google, openai, anthropic, perplexity] = await Promise.all([
        pricingRepository.getByProvider(LlmProviders.Google),
        pricingRepository.getByProvider(LlmProviders.OpenAI),
        pricingRepository.getByProvider(LlmProviders.Anthropic),
        pricingRepository.getByProvider(LlmProviders.Perplexity),
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

      // At this point all providers are non-null (TypeScript can narrow from the early returns above)
      const totalModels =
        Object.keys(google.models).length +
        Object.keys(openai.models).length +
        Object.keys(anthropic.models).length +
        Object.keys(perplexity.models).length;

      request.log.info({ userId: user.userId, totalModels }, 'Returning pricing for all providers');

      return await reply.ok({
        google,
        openai,
        anthropic,
        perplexity,
      });
    }
  );

  done();
};
