import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { LlmProvider } from '../domain/ports/index.js';
import { getServices } from '../services.js';

const VALID_PROVIDERS: LlmProvider[] = ['google', 'openai', 'anthropic', 'perplexity'];

function isValidProvider(provider: string): provider is LlmProvider {
  return VALID_PROVIDERS.includes(provider as LlmProvider);
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /internal/settings/pricing/:provider
   * Returns pricing configuration for a specific LLM provider.
   */
  fastify.get<{ Params: { provider: string } }>(
    '/settings/pricing/:provider',
    {
      schema: {
        operationId: 'getPricingByProvider',
        summary: 'Get LLM pricing for a provider (internal)',
        description: 'Internal endpoint for retrieving LLM pricing configuration by provider',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              description: 'LLM provider name (google, openai, anthropic, perplexity)',
            },
          },
          required: ['provider'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: VALID_PROVIDERS },
              models: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    inputPricePerMillion: { type: 'number' },
                    outputPricePerMillion: { type: 'number' },
                    cacheReadMultiplier: { type: 'number' },
                    cacheWriteMultiplier: { type: 'number' },
                    webSearchCostPerCall: { type: 'number' },
                    groundingCostPerRequest: { type: 'number' },
                    imagePricing: {
                      type: 'object',
                      properties: {
                        '1024x1024': { type: 'number' },
                        '1536x1024': { type: 'number' },
                        '1024x1536': { type: 'number' },
                      },
                    },
                    useProviderCost: { type: 'boolean' },
                  },
                  required: ['inputPricePerMillion', 'outputPricePerMillion'],
                },
              },
              updatedAt: { type: 'string' },
            },
            required: ['provider', 'models', 'updatedAt'],
          },
          401: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          404: {
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
        message: `Received request to GET /internal/settings/pricing/${request.params.provider}`,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for get pricing');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { provider } = request.params;

      if (!isValidProvider(provider)) {
        request.log.warn({ provider }, 'Invalid provider requested');
        reply.status(404);
        return { error: `Unknown provider: ${provider}` };
      }

      const { pricingRepository } = getServices();
      const pricing = await pricingRepository.getByProvider(provider);

      if (pricing === null) {
        request.log.warn({ provider }, 'Pricing not found for provider');
        reply.status(404);
        return { error: `Pricing not found for provider: ${provider}` };
      }

      request.log.info(
        { provider, modelCount: Object.keys(pricing.models).length },
        'Returning pricing for provider'
      );

      return pricing;
    }
  );

  done();
};
