/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processLinearAction } from '../domain/index.js';

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

  done();
};
