/**
 * Public API routes for Linear integration.
 * Handles connection management and issue listing.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listIssues } from '../domain/index.js';

interface ConnectionBody {
  apiKey: string;
  teamId: string;
  teamName: string;
}

interface ValidateBody {
  apiKey: string;
}

async function handleLinearError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'INVALID_API_KEY') {
    reply.status(401);
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'RATE_LIMIT') {
    reply.status(429);
    return await reply.fail('DOWNSTREAM_ERROR', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

export const linearRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Get connection status
  fastify.get('/linear/connection', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { connectionRepository } = getServices();

    const result = await connectionRepository.getConnection(user.userId);
    if (!result.ok) {
      return await handleLinearError(result.error, reply);
    }

    return await reply.ok(result.value);
  });

  // Validate API key and get teams
  fastify.post<{ Body: ValidateBody }>(
    '/linear/connection/validate',
    async (request: FastifyRequest<{ Body: ValidateBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const { apiKey } = request.body;
      const { linearApiClient } = getServices();

      const result = await linearApiClient.validateAndGetTeams(apiKey);
      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok({ teams: result.value });
    }
  );

  // Save connection
  fastify.post<{ Body: ConnectionBody }>(
    '/linear/connection',
    async (request: FastifyRequest<{ Body: ConnectionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { apiKey, teamId, teamName } = request.body;
      const { connectionRepository } = getServices();

      const result = await connectionRepository.save(user.userId, apiKey, teamId, teamName);
      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok(result.value);
    }
  );

  // Disconnect
  fastify.delete('/linear/connection', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { connectionRepository } = getServices();

    const result = await connectionRepository.disconnect(user.userId);
    if (!result.ok) {
      return await handleLinearError(result.error, reply);
    }

    return await reply.ok(result.value);
  });

  // List issues (grouped for dashboard)
  fastify.get<{ Querystring: { includeArchive?: string } }>(
    '/linear/issues',
    async (
      request: FastifyRequest<{ Querystring: { includeArchive?: string } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const includeArchive = request.query.includeArchive !== 'false';
      const services = getServices();

      const result = await listIssues(
        { userId: user.userId, includeArchive },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok(result.value);
    }
  );

  // List failed issue extractions
  fastify.get(
    '/linear/failed-issues',
    {
      schema: {
        operationId: 'listFailedIssues',
        summary: 'List failed Linear issue extractions',
        description: 'Lists failed Linear issue extractions for manual review',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  failedIssues: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        userId: { type: 'string' },
                        actionId: { type: 'string' },
                        originalText: { type: 'string' },
                        extractedTitle: { type: ['string', 'null'] },
                        extractedPriority: { type: ['number', 'null'] },
                        error: { type: 'string' },
                        reasoning: { type: ['string', 'null'] },
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
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Server error',
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { failedIssueRepository } = getServices();
      const result = await failedIssueRepository.listByUser(user.userId);

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok({ failedIssues: result.value });
    }
  );

  // Delete a failed issue
  fastify.delete('/linear/failed-issues/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { id } = request.params as { id: string };
    const { failedIssueRepository } = getServices();

    const issueResult = await failedIssueRepository.getById(id);
    if (!issueResult.ok) {
      reply.status(404);
      return await reply.fail('NOT_FOUND', 'Failed issue not found');
    }

    const issue = issueResult.value;
    if (issue.userId !== user.userId) {
      reply.status(404);
      return await reply.fail('NOT_FOUND', 'Failed issue not found');
    }

    const deleteResult = await failedIssueRepository.delete(id);
    if (!deleteResult.ok) {
      return await handleLinearError(deleteResult.error, reply);
    }

    reply.status(204);
    return await reply.send();
  });

  // Retry creating a Linear issue from a failed attempt
  fastify.post('/linear/failed-issues/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { id } = request.params as { id: string };
    const services = getServices();
    const { failedIssueRepository, linearApiClient, connectionRepository } = services;

    const failedIssueResult = await failedIssueRepository.getById(id);
    if (!failedIssueResult.ok) {
      reply.status(404);
      return await reply.fail('NOT_FOUND', 'Failed issue not found');
    }

    const failedIssue = failedIssueResult.value;
    if (failedIssue.userId !== user.userId) {
      reply.status(404);
      return await reply.fail('NOT_FOUND', 'Failed issue not found');
    }

    // Get API key for retrying the Linear creation
    const apiKeyResult = await connectionRepository.getApiKey(user.userId);
    if (!apiKeyResult.ok || apiKeyResult.value === null) {
      reply.status(403);
      return await handleLinearError(
        { code: 'NOT_CONNECTED', message: 'Linear not connected' },
        reply
      );
    }

    // Retry Linear creation
    const createResult = await linearApiClient.createIssue(apiKeyResult.value, {
      title: failedIssue.extractedTitle ?? 'Untitled Issue',
      description: failedIssue.reasoning ?? null,
      priority: failedIssue.extractedPriority ?? 3,
      teamId: 'TODO', // This should come from connection, but using default for now
    });

    if (!createResult.ok) {
      // Update error in Firestore
      await failedIssueRepository.update(id, {
        error: createResult.error.message,
        lastRetryAt: new Date().toISOString(),
      });
      return await reply.status(422).send({
        success: false,
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: createResult.error.message,
        },
      });
    }

    // Success - delete the failed issue
    await failedIssueRepository.delete(id);

    return await reply.ok({ issue: createResult.value });
  });

  done();
};
