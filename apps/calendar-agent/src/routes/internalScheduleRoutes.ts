import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateInternalScheduler,
  validateInternalAuth,
  logIncomingRequest,
} from '@intexuraos/common-http';
import { runDueSchedules } from '../domain/schedules/runDueSchedules.js';
import { getServices } from '../services.js';

const DEFAULT_BATCH_SIZE = 25;

export const internalScheduleRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/calendar/schedules/tick',
    {
      schema: {
        operationId: 'tickCalendarSchedules',
        tags: ['internal'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      if (
        services.calendarScheduleRepository === undefined ||
        services.whatsAppScheduleClient === undefined
      ) {
        return await reply.fail('MISCONFIGURED', 'Schedule services not configured');
      }

      const heartbeat = services.jobHeartbeatStore;
      const token = await heartbeat?.start('calendar_schedule_tick');
      try {
        const result = await runDueSchedules(
          {
            now: new Date().toISOString(),
            batchSize: DEFAULT_BATCH_SIZE,
            leaseOwnerId: request.id,
          },
          {
            scheduleRepository: services.calendarScheduleRepository,
            whatsAppScheduleClient: services.whatsAppScheduleClient,
            logger: request.log,
          }
        );
        if (token !== undefined)
          await heartbeat?.finish(
            token,
            result.ok && result.value.failed === 0 ? 'succeeded' : 'failed'
          );
        if (!result.ok) {
          reply.status(500);
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }

        return await reply.ok(result.value);
      } catch (error) {
        if (token !== undefined) await heartbeat?.finish(token, 'failed');
        throw error;
      }
    }
  );

  fastify.get(
    '/internal/monitoring/status',
    {
      schema: {
        operationId: 'getCalendarMonitoringStatus',
        tags: ['internal'],
        response: {
          200: {
            description: 'Scheduler and notification monitoring status',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: { type: 'object', additionalProperties: true },
            },
            required: ['success', 'data'],
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received scheduler monitoring request',
        bodyPreviewLength: 0,
      });
      if (!validateInternalAuth(request).valid)
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      const services = getServices();
      if (
        services.jobHeartbeatStore === undefined ||
        services.calendarScheduleRepository?.monitoring === undefined
      )
        return await reply.fail('MISCONFIGURED', 'Monitoring services unavailable');
      const observedAt = new Date().toISOString();
      return await reply.ok({
        schemaVersion: 1,
        observedAt,
        jobs: await services.jobHeartbeatStore.list(['calendar_schedule_tick']),
        notifications: await services.calendarScheduleRepository.monitoring(observedAt),
      });
    }
  );
  done();
};
