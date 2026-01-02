/**
 * Internal routes for service-to-service communication.
 * POST /internal/analytics/events - Ingest analytics event from other services
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createAnalyticsEventRequestSchema, analyticsEventSchema } from './schemas.js';

interface CreateAnalyticsEventBody {
  userId: string;
  sourceService: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/analytics/events',
    {
      schema: {
        operationId: 'createAnalyticsEvent',
        summary: 'Ingest analytics event (internal)',
        description:
          'Internal endpoint for service-to-service communication. Other services call this to report analytics events.',
        tags: ['internal'],
        body: createAnalyticsEventRequestSchema,
        response: {
          200: {
            description: 'Analytics event created',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: analyticsEventSchema,
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/analytics/events',
        bodyPreviewLength: 300,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for analytics/events endpoint'
        );
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const body = request.body as CreateAnalyticsEventBody;
      const { analyticsEventRepository } = getServices();

      const result = await analyticsEventRepository.create({
        userId: body.userId,
        sourceService: body.sourceService,
        eventType: body.eventType,
        payload: body.payload,
        timestamp: body.timestamp !== undefined ? new Date(body.timestamp) : undefined,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok({
        ...result.value,
        timestamp: result.value.timestamp.toISOString(),
        createdAt: result.value.createdAt.toISOString(),
      });
    }
  );

  done();
};
