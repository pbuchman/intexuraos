/**
 * Event update route — PATCH /calendar/events/:eventId.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { updateEvent, type UpdateEventRequest } from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import {
  buildUpdateEventInput,
  type EventParams,
  type UpdateEventBody,
} from './calendarHelpers.js';

export const eventUpdateRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.patch<{ Params: EventParams; Body: UpdateEventBody }>(
    '/calendar/events/:eventId',
    {
      schema: {
        operationId: 'updateCalendarEvent',
        summary: 'Update a calendar event',
        description: "Updates an existing event in the user's Google Calendar",
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string', description: 'Event ID' },
          },
        },
        body: {
          type: 'object',
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
            summary: { type: 'string', description: 'Event title' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Event location' },
            start: {
              type: 'object',
              properties: {
                dateTime: { type: 'string', format: 'date-time' },
                date: { type: 'string', format: 'date' },
                timeZone: { type: 'string' },
              },
            },
            end: {
              type: 'object',
              properties: {
                dateTime: { type: 'string', format: 'date-time' },
                date: { type: 'string', format: 'date' },
                timeZone: { type: 'string' },
              },
            },
            attendees: {
              type: 'array',
              items: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  optional: { type: 'boolean' },
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
      request: FastifyRequest<{ Params: EventParams; Body: UpdateEventBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { googleCalendarClient, userServiceClient } = getServices();
      const req: UpdateEventRequest = {
        userId: user.userId,
        eventId: request.params.eventId,
        event: buildUpdateEventInput(request.body),
      };
      if (request.body.calendarId !== undefined) {
        req.calendarId = request.body.calendarId;
      }

      const result = await updateEvent(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      return await reply.ok({ event: result.value });
    }
  );

  done();
};
