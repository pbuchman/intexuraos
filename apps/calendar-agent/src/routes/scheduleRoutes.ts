import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getDailyLookaheadSchedule } from '../domain/schedules/getDailyLookaheadSchedule.js';
import { upsertDailyLookaheadSchedule } from '../domain/schedules/upsertDailyLookaheadSchedule.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import { getServices } from '../services.js';
import type { CalendarSchedule, MatrixDeliveryStatus } from '../domain/index.js';

interface UpsertScheduleBody {
  enabled: boolean;
  localTime: string;
  timeZone: string;
}

interface CalendarDailyLookaheadSettingsResponse {
  schedule: {
    enabled: boolean;
    localTime: string;
    timeZone?: string;
    nextRunAt?: string;
    lastRunAt?: string;
  };
  delivery: MatrixDeliveryStatus;
}

function toSettingsResponse(input: {
  schedule: CalendarSchedule | null;
  delivery: MatrixDeliveryStatus;
}): CalendarDailyLookaheadSettingsResponse {
  if (input.schedule === null) {
    return {
      schedule: {
        enabled: false,
        localTime: '08:00',
      },
      delivery: input.delivery,
    };
  }

  return {
    schedule: {
      enabled: input.schedule.status === 'active',
      localTime: input.schedule.cadence.localTime,
      timeZone: input.schedule.cadence.timeZone,
      nextRunAt: input.schedule.nextRunAt,
      ...(input.schedule.lastRunAt !== undefined ? { lastRunAt: input.schedule.lastRunAt } : {}),
    },
    delivery: input.delivery,
  };
}

export const scheduleRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/schedules/calendar-daily-lookahead',
    {
      schema: {
        operationId: 'getCalendarDailyLookaheadSchedule',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      if (
        services.calendarScheduleRepository === undefined
        || services.whatsAppScheduleClient === undefined
      ) {
        return await reply.fail('MISCONFIGURED', 'Schedule services not configured');
      }

      const result = await getDailyLookaheadSchedule(user.userId, {
        scheduleRepository: services.calendarScheduleRepository,
        whatsAppScheduleClient: services.whatsAppScheduleClient,
      });
      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }
      return await reply.ok(toSettingsResponse(result.value));
    }
  );

  fastify.put<{ Body: UpsertScheduleBody }>(
    '/schedules/calendar-daily-lookahead',
    {
      schema: {
        operationId: 'upsertCalendarDailyLookaheadSchedule',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['enabled', 'localTime', 'timeZone'],
          properties: {
            enabled: { type: 'boolean' },
            localTime: { type: 'string' },
            timeZone: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: UpsertScheduleBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      if (
        services.calendarScheduleRepository === undefined
        || services.whatsAppScheduleClient === undefined
      ) {
        return await reply.fail('MISCONFIGURED', 'Schedule services not configured');
      }

      const result = await upsertDailyLookaheadSchedule(
        {
          userId: user.userId,
          enabled: request.body.enabled,
          localTime: request.body.localTime,
          timeZone: request.body.timeZone,
          now: new Date().toISOString(),
        },
        {
          scheduleRepository: services.calendarScheduleRepository,
          whatsAppScheduleClient: services.whatsAppScheduleClient,
        }
      );
      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }
      return await reply.ok(toSettingsResponse(result.value));
    }
  );

  done();
};
