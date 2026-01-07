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
                  google: { $ref: '#/components/schemas/ProviderPricing' },
                  openai: { $ref: '#/components/schemas/ProviderPricing' },
                  anthropic: { $ref: '#/components/schemas/ProviderPricing' },
                  perplexity: { $ref: '#/components/schemas/ProviderPricing' },
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
              error: { $ref: '#/components/schemas/ErrorBody' },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: '#/components/schemas/ErrorBody' },
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

      if (google === null || openai === null || anthropic === null || perplexity === null) {
        return await reply.fail('INTERNAL_ERROR', 'Unexpected null pricing');
      }

      const totalModels =
        Object.keys(google.models).length +
        Object.keys(openai.models).length +
        Object.keys(anthropic.models).length +
        Object.keys(perplexity.models).length;

      request.log.info(
        { userId: user.userId, totalModels },
        'Returning pricing for all providers'
      );

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
