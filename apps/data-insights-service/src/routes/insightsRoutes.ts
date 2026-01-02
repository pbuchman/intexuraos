/**
 * Public routes for insights endpoints.
 * GET /insights/summary - Get aggregated insights for the authenticated user
 * GET /insights/usage - Get usage statistics for the authenticated user
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';
import { aggregatedInsightsSchema } from './schemas.js';
import type { AggregatedInsights, ServiceUsage } from '../domain/insights/index.js';

export const insightsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/insights/summary',
    {
      preHandler: fastify.auth,
      schema: {
        operationId: 'getInsightsSummary',
        summary: 'Get insights summary',
        description: 'Get aggregated insights summary for the authenticated user.',
        tags: ['insights'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Insights summary',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: aggregatedInsightsSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId;
      const { aggregatedInsightsRepository } = getServices();

      const result = await aggregatedInsightsRepository.getByUserId(userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      const insights = result.value ?? createEmptyInsights(userId);

      return await reply.ok({
        userId: insights.userId,
        summary: insights.summary,
        usageByService: formatUsageByService(insights.usageByService),
        updatedAt: insights.updatedAt.toISOString(),
      });
    }
  );

  fastify.get(
    '/insights/usage',
    {
      preHandler: fastify.auth,
      schema: {
        operationId: 'getInsightsUsage',
        summary: 'Get usage statistics',
        description: 'Get usage statistics by service for the authenticated user.',
        tags: ['insights'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Usage statistics',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  services: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        serviceName: { type: 'string' },
                        totalEvents: { type: 'number' },
                        eventsLast7Days: { type: 'number' },
                        lastEventAt: { type: 'string', format: 'date-time', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId;
      const { aggregatedInsightsRepository } = getServices();

      const result = await aggregatedInsightsRepository.getByUserId(userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      const insights = result.value;
      const services =
        insights !== null
          ? Object.values(insights.usageByService).map((usage) => ({
              serviceName: usage.serviceName,
              totalEvents: usage.totalEvents,
              eventsLast7Days: usage.eventsLast7Days,
              lastEventAt: usage.lastEventAt !== null ? usage.lastEventAt.toISOString() : null,
            }))
          : [];

      return await reply.ok({ services });
    }
  );

  done();
};

function createEmptyInsights(userId: string): AggregatedInsights {
  return {
    userId,
    summary: {
      totalEvents: 0,
      eventsLast7Days: 0,
      eventsLast30Days: 0,
      mostActiveService: null,
    },
    usageByService: {},
    updatedAt: new Date(),
  };
}

function formatUsageByService(
  usageByService: Record<string, ServiceUsage>
): Record<string, object> {
  const formatted: Record<string, object> = {};
  for (const [key, usage] of Object.entries(usageByService)) {
    formatted[key] = {
      serviceName: usage.serviceName,
      totalEvents: usage.totalEvents,
      eventsLast7Days: usage.eventsLast7Days,
      lastEventAt: usage.lastEventAt !== null ? usage.lastEventAt.toISOString() : null,
    };
  }
  return formatted;
}
