import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { getServices } from '../services.js';

interface UsageCostsQuery {
  days?: string;
}

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

export const publicRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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
