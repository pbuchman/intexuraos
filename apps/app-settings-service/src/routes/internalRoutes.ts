import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';


export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /internal/settings/pricing
   * Returns pricing configuration for all LLM providers.
   * Used by apps at startup to load pricing into PricingContext.
   */
  fastify.get(
    '/internal/settings/pricing',
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
              error: { type: 'string' },
            },
          },
          500: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
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
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { pricingRepository } = getServices();

      // Fetch all providers in parallel
      const [google, openai, anthropic, perplexity] = await Promise.all([
        pricingRepository.getByProvider('google'),
        pricingRepository.getByProvider('openai'),
        pricingRepository.getByProvider('anthropic'),
        pricingRepository.getByProvider('perplexity'),
      ]);

      // Check if any provider is missing
      const missing: string[] = [];
      if (google === null) missing.push('google');
      if (openai === null) missing.push('openai');
      if (anthropic === null) missing.push('anthropic');
      if (perplexity === null) missing.push('perplexity');

      if (missing.length > 0) {
        request.log.error({ missingProviders: missing }, 'Missing pricing for providers');
        reply.status(500);
        return { error: `Missing pricing for providers: ${missing.join(', ')}` };
      }

      // At this point all providers are non-null (missing.length === 0 check above)
      // TypeScript doesn't narrow after array push checks, so we do explicit checks
      if (google === null || openai === null || anthropic === null || perplexity === null) {
        // This should never happen given the checks above
        reply.status(500);
        return { error: 'Unexpected null pricing' };
      }

      const totalModels =
        Object.keys(google.models).length +
        Object.keys(openai.models).length +
        Object.keys(anthropic.models).length +
        Object.keys(perplexity.models).length;

      request.log.info({ totalModels }, 'Returning pricing for all providers');

      return {
        success: true,
        data: {
          google,
          openai,
          anthropic,
          perplexity,
        },
      };
    }
  );

  done();
};
