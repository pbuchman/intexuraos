import type { FastifyInstance } from 'fastify';

export const providerPricingSchema = {
  $id: 'ProviderPricing',
  type: 'object',
  required: ['provider', 'models', 'updatedAt'],
  properties: {
    provider: { type: 'string', enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'] },
    models: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['inputPricePerMillion', 'outputPricePerMillion'],
        properties: {
          inputPricePerMillion: { type: 'number', minimum: 0 },
          outputPricePerMillion: { type: 'number', minimum: 0 },
          cacheReadMultiplier: { type: 'number', minimum: 0 },
          cacheWriteMultiplier: { type: 'number', minimum: 0 },
          webSearchCostPerCall: { type: 'number', minimum: 0 },
          groundingCostPerRequest: { type: 'number', minimum: 0 },
          imagePricing: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
          useProviderCost: { type: 'boolean' },
        },
      },
    },
    updatedAt: { type: 'string' },
  },
} as const;

export function registerPricingSchemas(app: FastifyInstance): void {
  app.addSchema(providerPricingSchema);
}
