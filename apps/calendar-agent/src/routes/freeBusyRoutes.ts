/**
 * Free/busy routes — query calendar availability.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { getFreeBusy, type GetFreeBusyRequest } from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import type { FreeBusyBody } from './calendarHelpers.js';

export const freeBusyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: FreeBusyBody }>(
    '/calendar/freebusy',
    {
      schema: {
        operationId: 'getFreeBusy',
        summary: 'Get free/busy information',
        description: 'Gets free/busy information for calendars',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['timeMin', 'timeMax'],
          properties: {
            timeMin: { type: 'string', format: 'date-time', description: 'Start of the interval' },
            timeMax: { type: 'string', format: 'date-time', description: 'End of the interval' },
            items: {
              type: 'array',
              description: 'Calendars to check (default: primary)',
              items: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'string', description: 'Calendar ID' },
                },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          400: {
            description: 'Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          403: {
            description: 'Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: FreeBusyBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { googleCalendarClient, userServiceClient } = getServices();
      const req: GetFreeBusyRequest = {
        userId: user.userId,
        input: {
          timeMin: request.body.timeMin,
          timeMax: request.body.timeMax,
        },
      };
      if (request.body.items !== undefined) {
        req.input.items = request.body.items;
      }

      const result = await getFreeBusy(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      const calendars: Record<string, { busy: { start: string; end: string }[] }> = {};
      for (const [calendarId, slots] of result.value.entries()) {
        calendars[calendarId] = { busy: slots };
      }

      return await reply.ok({ calendars });
    }
  );

  done();
};
