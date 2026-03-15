import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { LlmProviders } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /internal/settings/pricing
   * Returns pricing configuration for all LLM providers.
   * Used by apps at startup to load pricing into PricingContext.
   */
  fastify.get(
    '/settings/pricing',
    {
      schema: {
        operationId: 'getAllPricing',
        summary: 'Get LLM pricing for all providers (internal)',
        description: 'Internal endpoint for retrieving all LLM pricing configuration',
        tags: ['internal'],
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
            required: ['success', 'error'],
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
        },
        security: [{ internalAuth: [] }],
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/settings/pricing',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for get all pricing');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for get all pricing');
      }

      const { pricingRepository } = getServices();

      // Fetch all providers in parallel (no ZAI)
      const [google, openai, anthropic, perplexity] = await Promise.all([
        pricingRepository.getByProvider(LlmProviders.Google),
        pricingRepository.getByProvider(LlmProviders.OpenAI),
        pricingRepository.getByProvider(LlmProviders.Anthropic),
        pricingRepository.getByProvider(LlmProviders.Perplexity),
      ]);

      // Check if any provider is missing - need individual null checks for TypeScript narrowing
      if (google === null) {
        request.log.error({ missingProviders: ['google'] }, 'Missing pricing for providers');
        return await reply.fail('INTERNAL_ERROR', 'Missing pricing for providers: google');
      }
      if (openai === null) {
        request.log.error({ missingProviders: ['openai'] }, 'Missing pricing for providers');
        return await reply.fail('INTERNAL_ERROR', 'Missing pricing for providers: openai');
      }
      if (anthropic === null) {
        request.log.error({ missingProviders: ['anthropic'] }, 'Missing pricing for providers');
        return await reply.fail('INTERNAL_ERROR', 'Missing pricing for providers: anthropic');
      }
      if (perplexity === null) {
        request.log.error({ missingProviders: ['perplexity'] }, 'Missing pricing for providers');
        return await reply.fail('INTERNAL_ERROR', 'Missing pricing for providers: perplexity');
      }

      // At this point all providers are non-null (TypeScript can narrow from the early returns above)
      const totalModels =
        Object.keys(google.models).length +
        Object.keys(openai.models).length +
        Object.keys(anthropic.models).length +
        Object.keys(perplexity.models).length;

      request.log.info({ totalModels }, 'Returning pricing for all providers');

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
