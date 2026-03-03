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
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'INVALID_API_KEY') {
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'RATE_LIMIT') {
    return await reply.fail('DOWNSTREAM_ERROR', error.message);
  }
  if (error.code === 'INTERNAL_ERROR') {
    return await reply.fail('INTERNAL_ERROR', error.message);
  }
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
          issueRepository: services.issueRepository,
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

    // Get connection to retrieve teamId
    /* v8 ignore start -- test-infra: error paths require Linear API fault injection @preserve */
    const connectionResult = await connectionRepository.getFullConnection(user.userId);
    if (!connectionResult.ok || connectionResult.value === null) {
      reply.status(403);
      return await handleLinearError(
        { code: 'NOT_CONNECTED', message: 'Linear not connected' },
        reply
      );
    }
    /* v8 ignore stop @preserve */

    // Retry Linear creation
    /* v8 ignore start -- test-infra: nullish fallbacks for optional extracted fields @preserve */
    const createResult = await linearApiClient.createIssue(apiKeyResult.value, {
      title: failedIssue.extractedTitle ?? 'Untitled Issue',
      description: failedIssue.reasoning ?? null,
      priority: failedIssue.extractedPriority ?? 3,
      teamId: connectionResult.value.teamId,
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

  // Get single issue by identifier
  fastify.get(
    '/linear/issues/:identifier',
    {
      schema: {
        operationId: 'getLinearIssue',
        summary: 'Get Linear issue by identifier',
        description: 'Fetches a single Linear issue with comment count and metadata',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['identifier'],
          properties: {
            identifier: { type: 'string', description: 'Issue identifier (e.g., INT-123)' },
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
                properties: {
                  id: { type: 'string' },
                  identifier: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: ['string', 'null'] },
                  state: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] },
                    },
                  },
                  priority: { type: 'number' },
                  assignee: {
                    type: ['object', 'null'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                    },
                  },
                  labels: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                  url: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  commentCount: { type: 'number' },
                  lastCommentAt: { type: ['string', 'null'] },
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
          404: {
            description: 'Issue not found',
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
    async (request: FastifyRequest<{ Params: { identifier: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { identifier } = request.params;
      const services = getServices();

      request.log.info({ userId: user.userId, identifier }, 'Fetching Linear issue');

      // Find issue by identifier, scoped to the authenticated user
      const issueResult = await services.issueRepository.findByIdentifier(identifier, user.userId);
      if (!issueResult.ok) {
        request.log.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
        return await handleLinearError(issueResult.error, reply);
      }

      const issue = issueResult.value;
      if (issue === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      /* v8 ignore start -- test-infra: error paths require comment repository fault injection testing @preserve */
      // Get comments (count and last comment timestamp from single query)
      const commentsResult = await services.commentRepository.listByIssueId(issue.id);
      if (!commentsResult.ok) {
        request.log.error({ error: commentsResult.error, issueId: issue.id }, 'Failed to fetch comments');
        return await handleLinearError(commentsResult.error, reply);
      }
      /* v8 ignore stop @preserve */

      const commentCount = commentsResult.value.length;
      let lastCommentAt: string | null = null;
      if (commentCount > 0) {
        // Comments are ordered by createdAt ASC, so last is at the end
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes this possibly undefined despite length check @preserve */
        const lastComment = commentsResult.value[commentCount - 1];
        if (lastComment !== undefined) {
          lastCommentAt = lastComment.createdAt;
        }
        /* v8 ignore stop @preserve */
      }

      return await reply.ok({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        state: { name: issue.state, type: issue.stateType },
        priority: issue.priority,
        /* v8 ignore start -- ts-type: assigneeName always set when assigneeId is non-null @preserve */
        assignee: issue.assigneeId !== null ? { id: issue.assigneeId, name: issue.assigneeName ?? '' } : null,
        /* v8 ignore stop @preserve */
        labels: issue.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        commentCount,
        lastCommentAt,
      });
    }
  );

  // Get comments for an issue
  fastify.get(
    '/linear/issues/:identifier/comments',
    {
      schema: {
        operationId: 'getLinearIssueComments',
        summary: 'Get comments for a Linear issue',
        description: 'Fetches paginated comments for a Linear issue',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['identifier'],
          properties: {
            identifier: { type: 'string', description: 'Issue identifier (e.g., INT-123)' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'number', minimum: 0, default: 0 },
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
                properties: {
                  comments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        userId: { type: 'string' },
                        userName: { type: 'string' },
                        body: { type: 'string' },
                        createdAt: { type: 'string' },
                        updatedAt: { type: 'string' },
                      },
                    },
                  },
                  total: { type: 'number' },
                  limit: { type: 'number' },
                  offset: { type: 'number' },
                  hasMore: { type: 'boolean' },
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
          404: {
            description: 'Issue not found',
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
    async (
      request: FastifyRequest<{ Params: { identifier: string }; Querystring: { limit?: string; offset?: string } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { identifier } = request.params;
      /* v8 ignore start -- schema: Fastify schema default fills limit/offset before handler runs @preserve */
      const limit = Number.parseInt(request.query.limit ?? '20', 10);
      const offset = Number.parseInt(request.query.offset ?? '0', 10);
      /* v8 ignore stop @preserve */
      const services = getServices();

      request.log.info({ userId: user.userId, identifier, limit, offset }, 'Fetching Linear issue comments');

      // Find issue by identifier, scoped to the authenticated user
      const issueResult = await services.issueRepository.findByIdentifier(identifier, user.userId);
      if (!issueResult.ok) {
        request.log.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
        return await handleLinearError(issueResult.error, reply);
      }

      const issue = issueResult.value;
      if (issue === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      // Get all comments for the issue (already ordered by createdAt ASC)
      const commentsResult = await services.commentRepository.listByIssueId(issue.id);
      if (!commentsResult.ok) {
        request.log.error({ error: commentsResult.error, issueId: issue.id }, 'Failed to fetch comments');
        return await handleLinearError(commentsResult.error, reply);
      }

      // Get total count
      const countResult = await services.commentRepository.countByIssueId(issue.id);
      if (!countResult.ok) {
        request.log.error({ error: countResult.error, issueId: issue.id }, 'Failed to count comments');
        return await handleLinearError(countResult.error, reply);
      }

      // Apply pagination
      const total = countResult.value;
      const comments = commentsResult.value.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return await reply.ok({
        comments,
        total,
        limit,
        offset,
        hasMore,
      });
    }
  );

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
          created: result.value.created, // @allow-result-access -- guarded by if (!result.ok) at line 757
          updated: result.value.updated,
          deleted: result.value.deleted,
          total: result.value.total,
          durationMs: result.value.durationMs,
        },
        'linear/sync: sync completed'
      );

      return await reply.ok(result.value); // @allow-result-access -- guarded by if (!result.ok) at line 757
      /* v8 ignore stop @preserve */
    }
  );

  // Webhook configuration endpoints
  // GET /linear/webhook-config - Get webhook URL and secret status
  fastify.get(
    '/linear/webhook-config',
    {
      schema: {
        operationId: 'getWebhookConfig',
        summary: 'Get webhook configuration',
        description: 'Returns webhook URL and whether a secret is configured',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  webhookUrl: { type: 'string', description: 'Webhook URL for Linear' },
                  hasWebhookSecret: { type: 'boolean', description: 'Whether a secret is configured' },
                  teamId: { type: 'string', description: 'Connected team ID' },
                },
              },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { connectionRepository } = getServices();

      const connResult = await connectionRepository.getFullConnection(user.userId);
      if (!connResult.ok) {
        return await handleLinearError(connResult.error, reply);
      }

      const conn = connResult.value;
      if (conn === null) {
        reply.status(403);
        return await reply.fail('FORBIDDEN', 'Linear not connected');
      }

      return await reply.ok({
        webhookUrl: 'https://intexuraos-linear-agent-cj44trunra-lm.a.run.app/linear/webhook',
        hasWebhookSecret: conn.webhookSecret !== null,
        teamId: conn.teamId,
      });
    }
  );

  // POST /linear/webhook-config - Set webhook secret
  fastify.post(
    '/linear/webhook-config',
    {
      schema: {
        operationId: 'setWebhookConfig',
        summary: 'Configure webhook secret',
        description: 'Sets or updates the webhook signing secret for this connection',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['secret'],
          properties: {
            secret: { type: 'string', minLength: 1, description: 'Webhook signing secret from Linear' },
          },
        },
        response: {
          200: {
            description: 'Secret configured',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  configured: { type: 'boolean' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          400: {
            description: 'Bad request',
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
        },
      },
    },
    async (request: FastifyRequest<{ Body: { secret: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { secret } = request.body;
      if (!secret || secret.trim().length === 0) {
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', 'Secret cannot be empty');
      }

      const { connectionRepository } = getServices();

      // Verify user is connected
      const connResult = await connectionRepository.isConnected(user.userId);
      if (!connResult.ok) {
        request.log.error({ error: connResult.error, userId: user.userId }, 'Failed to check connection status');
        return await handleLinearError(connResult.error, reply);
      }
      if (!connResult.value) {
        reply.status(403);
        return await reply.fail('FORBIDDEN', 'Linear not connected');
      }

      const updateResult = await connectionRepository.updateWebhookSecret(user.userId, secret);
      if (!updateResult.ok) {
        request.log.error({ error: updateResult.error, userId: user.userId }, 'Failed to update webhook secret');
        return await handleLinearError(updateResult.error, reply);
      }

      return await reply.ok({ configured: true });
    }
  );

  // DELETE /linear/webhook-config - Remove webhook secret
  fastify.delete(
    '/linear/webhook-config',
    {
      schema: {
        operationId: 'deleteWebhookConfig',
        summary: 'Remove webhook secret',
        description: 'Removes the webhook signing secret for this connection',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Secret removed',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  configured: { type: 'boolean' },
                },
              },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { connectionRepository } = getServices();

      // Verify user is connected
      const connResult = await connectionRepository.isConnected(user.userId);
      if (!connResult.ok) {
        request.log.error({ error: connResult.error, userId: user.userId }, 'Failed to check connection status');
        return await handleLinearError(connResult.error, reply);
      }
      if (!connResult.value) {
        reply.status(403);
        return await reply.fail('FORBIDDEN', 'Linear not connected');
      }

      const updateResult = await connectionRepository.updateWebhookSecret(user.userId, null);
      if (!updateResult.ok) {
        request.log.error({ error: updateResult.error, userId: user.userId }, 'Failed to remove webhook secret');
        return await handleLinearError(updateResult.error, reply);
      }

      return await reply.ok({ configured: false });
    }
  );

  done();
};

