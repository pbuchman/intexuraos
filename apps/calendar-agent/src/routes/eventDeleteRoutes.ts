/**
 * Event deletion route — DELETE /calendar/events/:eventId.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { deleteEvent, type DeleteEventRequest } from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import { type EventParams, type CalendarIdQuery } from './calendarHelpers.js';

export const eventDeleteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.delete<{ Params: EventParams; Querystring: CalendarIdQuery }>(
    '/calendar/events/:eventId',
    {
      schema: {
        operationId: 'deleteCalendarEvent',
        summary: 'Delete a calendar event',
        description: "Deletes an event from the user's Google Calendar",
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string', description: 'Event ID' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
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
          404: {
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
    async (
      request: FastifyRequest<{ Params: EventParams; Querystring: CalendarIdQuery }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { googleCalendarClient, userServiceClient } = getServices();
      const req: DeleteEventRequest = {
        userId: user.userId,
        eventId: request.params.eventId,
      };
      if (request.query.calendarId !== undefined) {
        req.calendarId = request.query.calendarId;
      }

      const result = await deleteEvent(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
