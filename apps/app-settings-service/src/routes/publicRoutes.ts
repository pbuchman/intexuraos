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

      const missing: string[] = [];
      if (google === null) missing.push(LlmProviders.Google);
      if (openai === null) missing.push(LlmProviders.OpenAI);
      if (anthropic === null) missing.push(LlmProviders.Anthropic);
      if (perplexity === null) missing.push(LlmProviders.Perplexity);

      if (missing.length > 0) {
        request.log.error({ missingProviders: missing }, 'Missing pricing for providers');
        return await reply.fail(
          'INTERNAL_ERROR',
          `Missing pricing for providers: ${missing.join(', ')}`
        );
      }

      // At this point all providers are non-null (missing.length === 0 check above)
      // TypeScript doesn't narrow after array push checks, so we use non-null assertions
      const totalModels =
        Object.keys(google!.models).length +
        Object.keys(openai!.models).length +
        Object.keys(anthropic!.models).length +
        Object.keys(perplexity!.models).length;

      request.log.info(
        { userId: user.userId, totalModels },
        'Returning pricing for all providers'
      );

      return await reply.ok({
        google: google!,
        openai: openai!,
        anthropic: anthropic!,
        perplexity: perplexity!,
      });
    }
  );

  done();
};
