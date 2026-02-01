/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processLinearAction, validateIssue, generateIssueTitle } from '../domain/index.js';

interface ProcessActionBody {
  action: {
    id: string;
    userId: string;
    text: string;
    summary?: string;
  };
}

async function handleLinearError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ProcessActionBody }>(
    '/internal/linear/process-action',
    {
      schema: {
        operationId: 'processLinearAction',
        summary: 'Process a Linear action from natural language',
        description: 'Extracts Linear issue data from text and creates in Linear or saves as draft',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'object',
              required: ['id', 'userId', 'text'],
              properties: {
                id: { type: 'string', description: 'Action ID' },
                userId: { type: 'string', description: 'User ID' },
                text: { type: 'string', description: 'User message text' },
                summary: { type: 'string', description: 'Optional summary' },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  message: { type: 'string', description: 'Human-readable feedback message' },
                  resourceUrl: { type: 'string', description: 'URL to created resource (success only)' },
                  errorCode: { type: 'string', description: 'Error code for debugging (failure only)' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
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
    async (request: FastifyRequest<{ Body: ProcessActionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { action } = request.body;

      request.log.info(
        { actionId: action.id, userId: action.userId, textLength: action.text.length, hasSummary: action.summary !== undefined },
        'internal/processLinearAction: processing action'
      );

      const result = await processLinearAction(
        {
          actionId: action.id,
          userId: action.userId,
          text: action.text,
          ...(action.summary !== undefined && { summary: action.summary }),
        },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          failedIssueRepository: services.failedIssueRepository,
          extractionService: services.extractionService,
          processedActionRepository: services.processedActionRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      request.log.info(
        { actionId: action.id, status: result.value.status },
        'internal/processLinearAction: complete'
      );

      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Params: { identifier: string }; Querystring: { userId: string } }>(
    '/internal/linear/issues/:identifier',
    {
      schema: {
        operationId: 'validateIssue',
        summary: 'Validate a Linear issue exists and belongs to user team',
        description: 'Checks if an issue exists in Linear and belongs to the authenticated user team',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['identifier'],
          properties: {
            identifier: { type: 'string', description: 'Issue identifier (e.g., INT-123)' },
          },
        },
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', description: 'User ID for team validation' },
          },
        },
        response: {
          200: {
            description: 'Issue found and validated',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['id', 'identifier', 'title', 'url'],
                properties: {
                  id: { type: 'string', description: 'Linear issue ID' },
                  identifier: { type: 'string', description: 'Issue identifier (e.g., INT-123)' },
                  title: { type: 'string', description: 'Issue title' },
                  url: { type: 'string', description: 'URL to the issue in Linear' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          400: {
            description: 'Bad Request (invalid format)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          403: {
            description: 'Forbidden (not connected)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          404: {
            description: 'Issue not found or wrong team',
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
    async (request: FastifyRequest<{ Params: { identifier: string }; Querystring: { userId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { identifier } = request.params;
      const { userId } = request.query;
      const services = getServices();

      request.log.info(
        { identifier, userId },
        'internal/validateIssue: validating issue'
      );

      const result = await validateIssue(
        { identifier, userId },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        const { code, message } = result.error;

        if (code === 'NOT_FOUND' || code === 'WRONG_TEAM') {
          reply.status(404);
          return await reply.fail('NOT_FOUND', message);
        }
        if (code === 'NOT_CONNECTED') {
          reply.status(403);
          return await reply.fail('FORBIDDEN', message);
        }
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', message);
      }

      request.log.info(
        { identifier, issueId: result.value.id },
        'internal/validateIssue: issue validated'
      );

      return await reply.ok(result.value);
    }
  );

  fastify.post<{ Body: { description: string; userId: string } }>(
    '/internal/linear/issues/generate-title',
    {
      schema: {
        operationId: 'generateIssueTitle',
        summary: 'Generate an issue title from description using LLM',
        description: 'Uses LLM to generate a concise Linear issue title from a task description',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['description', 'userId'],
          properties: {
            description: { type: 'string', description: 'Task description to generate title from' },
            userId: { type: 'string', description: 'User ID for LLM client access' },
          },
        },
        response: {
          200: {
            description: 'Title generated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['title', 'issueType'],
                properties: {
                  title: { type: 'string', description: 'Generated issue title' },
                  issueType: {
                    type: 'string',
                    enum: ['feature', 'bug', 'refactor', 'research'],
                    description: 'Detected issue type',
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
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
    async (request: FastifyRequest<{ Body: { description: string; userId: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { description, userId } = request.body;
      const services = getServices();

      request.log.info(
        { userId, descriptionLength: description.length },
        'internal/generateIssueTitle: generating title'
      );

      const result = await generateIssueTitle(
        { description, userId },
        {
          userServiceClient: services.userServiceClient,
          logger: request.log,
        }
      );

      /* v8 ignore start -- ts-type: generateIssueTitle always returns ok() with fallback @preserve */
      if (!result.ok) {
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }
      /* v8 ignore stop @preserve */

      request.log.info(
        { title: result.value.title, issueType: result.value.issueType },
        'internal/generateIssueTitle: title generated'
      );

      return await reply.ok(result.value);
    }
  );

  done();
};
