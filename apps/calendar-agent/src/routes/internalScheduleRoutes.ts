import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateInternalScheduler, logIncomingRequest } from '@intexuraos/common-http';
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
        services.calendarScheduleRepository === undefined
        || services.whatsAppScheduleClient === undefined
      ) {
        return await reply.fail('MISCONFIGURED', 'Schedule services not configured');
      }

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
      if (!result.ok) {
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
