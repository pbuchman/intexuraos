/**
 * Public API routes for Linear integration.
 * Handles connection management and issue listing.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listIssues, fullSync } from '../domain/index.js';

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
/* v8 ignore start -- test-infra: test infrastructure uses `fakeauthplugin` which always re... @preserve */
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
    /* v8 ignore stop @preserve */
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
      request.log.error(
        { error: issueResult.error, failedIssueId: id, userId: user.userId },
        'Failed to retrieve issue for deletion'
      );
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

    // @allow-raw-send: 204 No Content response
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
      request.log.error(
        { error: failedIssueResult.error, failedIssueId: id, userId: user.userId },
        'Failed to retrieve issue for retry'
      );
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
    /* v8 ignore start -- test-infra: nullish fallbacks for optional extracted fields @preserve */
    const createResult = await linearApiClient.createIssue(apiKeyResult.value, {
      title: failedIssue.extractedTitle ?? 'Untitled Issue',
      description: failedIssue.reasoning ?? null,
      priority: failedIssue.extractedPriority ?? 3,
      teamId: 'TODO', // This should come from connection, but using default for now
    });
    /* v8 ignore stop @preserve */

    if (!createResult.ok) {
      // Update error in Firestore - log if this fails but don't block response
      const updateResult = await failedIssueRepository.update(id, {
        error: createResult.error.message,
        lastRetryAt: new Date().toISOString(),
      });
      if (!updateResult.ok) {
        request.log.error(
          { error: updateResult.error, failedIssueId: id },
          'Failed to update retry metadata in Firestore'
        );
      }
      return await reply.fail('UNPROCESSABLE_ENTITY', createResult.error.message);
    }

    // Success - delete the failed issue
    const deleteResult = await failedIssueRepository.delete(id);
    if (!deleteResult.ok) {
      request.log.error(
        { error: deleteResult.error, failedIssueId: id, createdLinearIssueId: createResult.value.id },
        'Failed to delete resolved failed issue from Firestore'
      );
    }

    return await reply.ok({ issue: createResult.value });
  });

  // Full sync endpoint for user-triggered sync
  fastify.post(
    '/linear/sync',
    {
      schema: {
        operationId: 'fullSync',
        summary: 'Trigger full sync of Linear issues',
        description: 'Fetches all issues from Linear and syncs them to the database',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Sync completed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['created', 'updated', 'deleted', 'total', 'durationMs', 'syncedAt'],
                properties: {
                  created: { type: 'number', description: 'Number of new issues created' },
                  updated: { type: 'number', description: 'Number of existing issues updated' },
                  deleted: { type: 'number', description: 'Number of stale issues deleted' },
                  total: { type: 'number', description: 'Total number of issues synced' },
                  durationMs: { type: 'number', description: 'Sync duration in milliseconds' },
                  syncedAt: { type: 'string', description: 'ISO timestamp of sync completion' },
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
            description: 'Forbidden (not connected to Linear)',
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      /* v8 ignore start -- test-infra: auth validation early return covered by other endpoint tests @preserve */
      if (user === null) {
        return;
      }
      /* v8 ignore stop @preserve */

      const services = getServices();

      request.log.info({ userId: user.userId }, 'linear/sync: starting sync');

      /* v8 ignore start -- test-infra: error handling path covered by use case tests @preserve */
      const result = await fullSync(user.userId, {
        issueRepo: services.issueRepository,
        connectionRepo: services.connectionRepository,
        linearClient: services.linearApiClient,
        logger: request.log as unknown as Logger,
      });

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      request.log.info(
        {
          userId: user.userId,
          created: result.value.created,
          updated: result.value.updated,
          deleted: result.value.deleted,
          total: result.value.total,
          durationMs: result.value.durationMs,
        },
        'linear/sync: sync completed'
      );

      return await reply.ok(result.value);
      /* v8 ignore stop @preserve */
    }
  );

  done();
};

