/**
 * Event creation route — POST /calendar/events.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createEvent, type CreateEventRequest } from '../domain/index.js';
import { handleCalendarError } from './calendarErrorHandler.js';
import { buildCreateEventInput, type CreateEventBody } from './calendarHelpers.js';

export const eventCreateRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateEventBody }>(
    '/calendar/events',
    {
      schema: {
        operationId: 'createCalendarEvent',
        summary: 'Create a calendar event',
        description: "Creates a new event in the user's Google Calendar",
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['summary', 'start', 'end'],
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
          201: {
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
    async (request: FastifyRequest<{ Body: CreateEventBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { googleCalendarClient, userServiceClient } = getServices();
      const req: CreateEventRequest = {
        userId: user.userId,
        event: buildCreateEventInput(request.body),
      };
      if (request.body.calendarId !== undefined) {
        req.calendarId = request.body.calendarId;
      }

      const result = await createEvent(req, { googleCalendarClient, userServiceClient, logger: request.log });

      if (!result.ok) {
        return await handleCalendarError(result.error, reply);
      }

      reply.status(201);
      return await reply.ok({ event: result.value });
    }
  );

  done();
};
