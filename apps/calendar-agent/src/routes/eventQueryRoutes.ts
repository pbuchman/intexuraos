/**
 * Event query routes — read-only event operations (list, get).
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  listEvents,
  getEvent,
  type ListEventsRequest,
  type GetEventRequest,
} from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import {
  buildListEventsOptions,
  type ListEventsQuery,
  type EventParams,
  type CalendarIdQuery,
} from './calendarHelpers.js';

export const eventQueryRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: ListEventsQuery }>(
    '/calendar/events',
    {
      schema: {
        operationId: 'listCalendarEvents',
        summary: 'List calendar events',
        description: "Lists events from the user's Google Calendar",
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
            timeMin: { type: 'string', format: 'date-time', description: 'Lower bound for event start time' },
            timeMax: { type: 'string', format: 'date-time', description: 'Upper bound for event start time' },
            maxResults: { type: 'integer', minimum: 1, maximum: 2500, description: 'Maximum number of events' },
            q: { type: 'string', description: 'Free text search terms' },
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
    async (request: FastifyRequest<{ Querystring: ListEventsQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { googleCalendarClient, userServiceClient } = getServices();
      const req: ListEventsRequest = {
        userId: user.userId,
        options: buildListEventsOptions(request.query),
      };
      if (request.query.calendarId !== undefined) {
        req.calendarId = request.query.calendarId;
      }

      const result = await listEvents(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      return await reply.ok({ events: result.value });
    }
  );

  fastify.get<{ Params: EventParams; Querystring: CalendarIdQuery }>(
    '/calendar/events/:eventId',
    {
      schema: {
        operationId: 'getCalendarEvent',
        summary: 'Get a calendar event',
        description: "Gets a specific event from the user's Google Calendar",
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
      const req: GetEventRequest = {
        userId: user.userId,
        eventId: request.params.eventId,
      };
      if (request.query.calendarId !== undefined) {
        req.calendarId = request.query.calendarId;
      }

      const result = await getEvent(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      return await reply.ok({ event: result.value });
    }
  );

  done();
};
