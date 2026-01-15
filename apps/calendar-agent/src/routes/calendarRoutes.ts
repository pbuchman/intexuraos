/**
 * Calendar API routes.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getFreeBusy,
  type ListEventsRequest,
  type GetEventRequest,
  type CreateEventRequest,
  type UpdateEventRequest,
  type DeleteEventRequest,
  type GetFreeBusyRequest,
  type CreateEventInput,
  type UpdateEventInput,
  type ListEventsInput,
  type FailedEventFilters,
} from '../domain/index.js';

interface ListEventsQuery {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  q?: string;
}

interface EventParams {
  eventId: string;
}

interface CalendarIdQuery {
  calendarId?: string;
}

interface CreateEventBody {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; optional?: boolean }[];
}

interface UpdateEventBody {
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; optional?: boolean }[];
}

interface FreeBusyBody {
  timeMin: string;
  timeMax: string;
  items?: { id: string }[];
}

async function handleCalendarError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'TOKEN_ERROR') {
    reply.status(401);
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'NOT_FOUND') {
    reply.status(404);
    return await reply.fail('NOT_FOUND', error.message);
  }
  if (error.code === 'INVALID_REQUEST') {
    reply.status(400);
    return await reply.fail('INVALID_REQUEST', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

function buildListEventsOptions(query: ListEventsQuery): ListEventsInput {
  const options: ListEventsInput = {};
  if (query.timeMin !== undefined) options.timeMin = query.timeMin;
  if (query.timeMax !== undefined) options.timeMax = query.timeMax;
  if (query.maxResults !== undefined) options.maxResults = query.maxResults;
  if (query.q !== undefined) options.q = query.q;
  return options;
}

function buildCreateEventInput(body: CreateEventBody): CreateEventInput {
  const input: CreateEventInput = {
    summary: body.summary,
    start: body.start,
    end: body.end,
  };
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.attendees !== undefined) input.attendees = body.attendees;
  return input;
}

function buildUpdateEventInput(body: UpdateEventBody): UpdateEventInput {
  const input: UpdateEventInput = {};
  if (body.summary !== undefined) input.summary = body.summary;
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.start !== undefined) input.start = body.start;
  if (body.end !== undefined) input.end = body.end;
  if (body.attendees !== undefined) input.attendees = body.attendees;
  return input;
}

export const calendarRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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

  interface FailedEventsQuery {
    limit?: number;
  }

  fastify.get<{ Querystring: FailedEventsQuery }>(
    '/calendar/failed-events',
    {
      schema: {
        operationId: 'listFailedEvents',
        summary: 'List failed calendar event extractions',
        description: 'Lists failed calendar event extractions for manual review',
        tags: ['calendar'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of events (default: 10)' },
          },
        },
        response: {
          200: {
              description: 'Success',
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                data: {
                  type: 'object',
                  properties: {
                    failedEvents: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          userId: { type: 'string' },
                          actionId: { type: 'string' },
                          originalText: { type: 'string' },
                          summary: { type: 'string' },
                          start: { type: ['string', 'null'] },
                          end: { type: ['string', 'null'] },
                          location: { type: ['string', 'null'] },
                          description: { type: ['string', 'null'] },
                          error: { type: 'string' },
                          reasoning: { type: 'string' },
                          createdAt: { type: 'string' },
                        },
                      },
                    },
                  },
                },
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
    async (request: FastifyRequest<{ Querystring: FailedEventsQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { failedEventRepository } = getServices();
      const filters: FailedEventFilters = {};
      if (request.query.limit !== undefined) {
        filters.limit = request.query.limit;
      }

      const result = await failedEventRepository.list(user.userId, filters);

      if (!result.ok) {
        reply.status(500);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok({ failedEvents: result.value });
    }
  );

  done();
};
