import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { ProviderPricing } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';

export const pricingRoutes: FastifyPluginCallback = (app, _opts, done) => {
  // POST /internal/pricing — write pricing for a provider (internal, X-Internal-Auth)
  app.post(
    '/internal/pricing',
    {
      schema: {
        operationId: 'internalWritePricing',
        summary: 'Write LLM pricing for a provider (internal)',
        tags: ['pricing'],
        body: { $ref: 'ProviderPricing#' },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: { type: 'object', properties: {}, additionalProperties: true },
            },
            required: ['success', 'data'],
          },
          401: {
            type: 'object',
            properties: { success: { type: 'boolean', const: false }, error: { $ref: 'ErrorBody#' } },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal pricing write' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for pricing write');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const body = request.body as ProviderPricing;
      const { pricingRepository } = getServices();
      await pricingRepository.setByProvider(body.provider, body);

      request.log.info({ provider: body.provider }, 'Pricing written successfully');
      return await reply.ok({ provider: body.provider });
    },
  );

  // GET /internal/pricing — read all pricing (internal, X-Internal-Auth)
  // This is the endpoint consumer apps call via fetchAllPricing() at boot.
  app.get(
    '/internal/pricing',
    {
      schema: {
        operationId: 'internalGetAllPricing',
        summary: 'Get all LLM pricing (internal)',
        description: 'Internal endpoint for consumer apps to fetch pricing at boot via fetchAllPricing().',
        tags: ['pricing'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                required: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                properties: {
                  google: { $ref: 'ProviderPricing#' },
                  openai: { $ref: 'ProviderPricing#' },
                  anthropic: { $ref: 'ProviderPricing#' },
                  perplexity: { $ref: 'ProviderPricing#' },
                  openrouter: { $ref: 'ProviderPricing#' },
                },
              },
            },
            required: ['success', 'data'],
          },
          401: {
            type: 'object',
            properties: { success: { type: 'boolean', const: false }, error: { $ref: 'ErrorBody#' } },
            required: ['success', 'error'],
          },
          500: {
            type: 'object',
            properties: { success: { type: 'boolean', const: false }, error: { $ref: 'ErrorBody#' } },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal pricing read' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for pricing read');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const { pricingRepository } = getServices();
      try {
        const all = await pricingRepository.getAll();
        return await reply.ok(all);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to read pricing');
        return await reply.fail('INTERNAL_ERROR', 'Failed to read pricing');
      }
    },
  );

  // GET /llm-usage/pricing — read all pricing (public, Auth0 bearer)
  app.get(
    '/llm-usage/pricing',
    {
      schema: {
        operationId: 'getAllPricing',
        summary: 'Get all LLM pricing',
        description: 'Returns pricing for google, openai, anthropic, perplexity, and openrouter.',
        tags: ['pricing'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                required: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                properties: {
                  google: { $ref: 'ProviderPricing#' },
                  openai: { $ref: 'ProviderPricing#' },
                  anthropic: { $ref: 'ProviderPricing#' },
                  perplexity: { $ref: 'ProviderPricing#' },
                  openrouter: { $ref: 'ProviderPricing#' },
                },
              },
            },
            required: ['success', 'data'],
          },
          401: {
            type: 'object',
            properties: { success: { type: 'boolean', const: false }, error: { $ref: 'ErrorBody#' } },
            required: ['success', 'error'],
          },
          500: {
            type: 'object',
            properties: { success: { type: 'boolean', const: false }, error: { $ref: 'ErrorBody#' } },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Public pricing read' });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { pricingRepository } = getServices();
      try {
        const all = await pricingRepository.getAll();
        return await reply.ok(all);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to read pricing');
        return await reply.fail('INTERNAL_ERROR', 'Failed to read pricing');
      }
    },
  );

  done();
};
