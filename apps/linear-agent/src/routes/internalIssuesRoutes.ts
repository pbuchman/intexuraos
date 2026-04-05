/**
 * Internal API routes for Linear issue management (service-to-service).
 * Used by code-agent to create and update Linear issues during code task execution.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import type { Logger } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { handleLinearError } from './routeUtils.js';
import {
  STATE_NAME_MAP,
  findStateId,
  toCommentSummary,
  buildIssueDisplayResponse,
  type IssueDisplayResponse,
  resolveDesiredLabelIds,
  buildIssueTree,
} from '../domain/index.js';

// Request/response types
interface CreateIssueBody {
  title: string;
  description: string;
  labels?: string[];
}

interface UpdateStateBody {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}

interface IssueIdParams {
  issueId: string;
}

interface AddCommentBody {
  body: string;
}

interface UpdateIssueMetadataBody {
  assigneeId?: string | null;
  addLabels?: string[];
  removeLabels?: string[];
}

// Response shape matching code-agent expectations
interface IssueResponse {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export const internalIssuesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/issues - Create a Linear issue
  fastify.post<{ Body: CreateIssueBody }>(
    '/internal/issues',
    {
      schema: {
        operationId: 'createIssueInternal',
        summary: 'Create a Linear issue (internal)',
        description: 'Creates a Linear issue using the authenticated user connection. Used by code-agent.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string', description: 'Issue title' },
            description: { type: 'string', description: 'Issue description' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Optional labels' },
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
                required: ['id', 'identifier', 'title', 'url'],
                properties: {
                  id: { type: 'string' },
                  identifier: { type: 'string' },
                  title: { type: 'string' },
                  url: { type: 'string' },
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
            description: 'Forbidden - User not connected to Linear',
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
    async (request: FastifyRequest<{ Body: CreateIssueBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (userId === undefined || typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { title, description } = request.body;
      // labels accepted for future use when LinearApiClient supports them
      void request.body.labels;
      const logger = request.log as Logger;

      logger.info({ userId, title }, 'internal/createIssue: creating issue');

      const services = getServices();

      // Get user's API key and connection
      const apiKeyResult = await services.connectionRepository.getApiKey(userId);
      if (!apiKeyResult.ok) {
        return await handleLinearError(apiKeyResult.error, reply);
      }

      const apiKey = apiKeyResult.value;
      if (apiKey === null) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }

      const connectionResult = await services.connectionRepository.getFullConnection(userId);
      if (!connectionResult.ok) {
        return await handleLinearError(connectionResult.error, reply);
      }

      const connection = connectionResult.value;
      /* v8 ignore start -- upstream: FakeLinearConnectionRepository cannot return null after getApiKey succeeded; TOCTOU race untestable with synchronous fakes @preserve */
      if (!connection) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }
      /* v8 ignore stop @preserve */

      // Create the issue
      const createResult = await services.linearApiClient.createIssue(apiKey, { // @allow-result-access -- apiKey guarded by if (!apiKeyResult.ok) above
        teamId: connection.teamId, // @allow-result-access -- connection guarded by if (!connectionResult.ok) above
        title,
        description,
        priority: 0,
      });

      if (!createResult.ok) {
        return await handleLinearError(createResult.error, reply);
      }

      const issue = createResult.value; // @allow-result-access -- guarded by if (!createResult.ok) above

      logger.info(
        { userId, issueId: issue.id, identifier: issue.identifier },
        'internal/createIssue: issue created'
      );

      // Return response format matching code-agent expectations
      const responseData: IssueResponse = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      };

      return await reply.ok(responseData);
    }
  );

  // POST /internal/linear/issues/:issueId/comments - Add comment to issue (internal)
  fastify.post<{ Params: IssueIdParams; Body: AddCommentBody }>(
    '/internal/linear/issues/:issueId/comments',
    async (request, reply) => {
      logIncomingRequest(request);
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { issueId } = request.params;
      const services = getServices();

      const apiKeyResult = await services.connectionRepository.getApiKey(userId);
      if (!apiKeyResult.ok) return await handleLinearError(apiKeyResult.error, reply);
      if (apiKeyResult.value === null) {
        return await handleLinearError({ code: 'NOT_CONNECTED', message: 'User not connected to Linear' }, reply);
      }

      const commentResult = await services.linearApiClient.createComment(
        apiKeyResult.value, // @allow-result-access -- guarded by if (!apiKeyResult.ok) above
        issueId,
        request.body.body
      );
      if (!commentResult.ok) return await handleLinearError(commentResult.error, reply);
      return await reply.ok({ id: commentResult.value.id }); // @allow-result-access -- guarded by if (!commentResult.ok) above
    }
  );

  // PATCH /internal/linear/issues/:issueId/metadata - Update assignee/labels by name (internal)
  fastify.patch<{ Params: IssueIdParams; Body: UpdateIssueMetadataBody }>(
    '/internal/linear/issues/:issueId/metadata',
    async (request, reply) => {
      logIncomingRequest(request);
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { issueId } = request.params;
      const services = getServices();
      let issueResult = await services.issueRepository.findById(issueId);
      if (!issueResult.ok) return await handleLinearError(issueResult.error, reply);

      if (issueResult.value === null) {
        issueResult = await services.issueRepository.findByIdentifier(issueId, userId);
        if (!issueResult.ok) return await handleLinearError(issueResult.error, reply);
      }

      if (issueResult.value === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${issueId} not found`);
      }
      const syncedIssue = issueResult.value; // @allow-result-access -- guarded by findById/findByIdentifier !ok checks and null check above

      // Ownership check: return 404 (not 403) to prevent information leakage
      if (syncedIssue.userId !== userId) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${issueId} not found`);
      }

      const apiKeyResult = await services.connectionRepository.getApiKey(userId);
      if (!apiKeyResult.ok) return await handleLinearError(apiKeyResult.error, reply);
      if (apiKeyResult.value === null) {
        return await handleLinearError({ code: 'NOT_CONNECTED', message: 'User not connected to Linear' }, reply);
      }

      const labelsResult = await services.linearApiClient.listIssueLabels(apiKeyResult.value, syncedIssue.teamId); // @allow-result-access -- guarded by if (!apiKeyResult.ok) and null check above
      if (!labelsResult.ok) return await handleLinearError(labelsResult.error, reply);

      const availableLabels = labelsResult.value; // @allow-result-access -- guarded by if (!labelsResult.ok) above
      /* v8 ignore start -- schema: Fastify schema validates addLabels/removeLabels as optional arrays; ?? [] fallback unreachable when schema-validated request provides them @preserve */
      const { labelIds: desiredLabelIds, droppedLabels } = resolveDesiredLabelIds(
        syncedIssue.labels,
        request.body.addLabels ?? [],
        request.body.removeLabels ?? [],
        availableLabels
      );
      /* v8 ignore stop @preserve */

      if (droppedLabels.length > 0) {
        request.log.warn({ issueId, droppedLabels }, 'Requested labels not found in team — dropped');
      }

      const updateResult = await services.linearApiClient.updateIssue(apiKeyResult.value, syncedIssue.id, { // @allow-result-access -- guarded by if (!apiKeyResult.ok) and null check above
        ...(request.body.assigneeId !== undefined && { assigneeId: request.body.assigneeId }),
        labelIds: desiredLabelIds,
      });
      if (!updateResult.ok) return await handleLinearError(updateResult.error, reply);

      // Write-through: update the Firestore cache with the actual labels from Linear.
      // This prevents stale label data from being served by fetchIssuesForDisplay
      // until the next Linear webhook arrives.
      const updatedLabels = updateResult.value.labels.map((l) => ({ // @allow-result-access -- guarded by if (!updateResult.ok) above
        id: l.id,
        name: l.name,
        color: l.color,
      }));
      const saveResult = await services.issueRepository.save({
        ...syncedIssue,
        labels: updatedLabels,
        syncedAt: new Date().toISOString(),
      });
      if (!saveResult.ok) {
        request.log.warn(
          { issueId, error: saveResult.error },
          'updateIssueMetadata: write-through cache update failed (best-effort)'
        );
      }

      // Best-effort: notify code-agent to recompute group summary with updated labels.
      // This mirrors what processWebhook does when it receives a label-change webhook.
      void services.codeAgentClient.notifyGroupSummaryRecompute({
        userId,
        linearIssueId: syncedIssue.identifier,
        labels: updatedLabels.map((l) => ({ id: l.id, name: l.name })),
        sourceTimestamp: new Date().toISOString(),
      }).catch((notifyErr: unknown) => {
        request.log.warn(
          { issueId, error: notifyErr },
          'updateIssueMetadata: failed to notify code-agent of label change (best-effort)'
        );
      });

      return await reply.ok({
        id: updateResult.value.id, // @allow-result-access -- guarded by if (!updateResult.ok) above
        labels: updateResult.value.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
        assignee: updateResult.value.assignee ?? null,
        droppedLabels,
      });
    }
  );

  // PATCH /internal/issues/:issueId/state - Update issue state
  fastify.patch<{ Params: IssueIdParams; Body: UpdateStateBody }>(
    '/internal/issues/:issueId/state',
    {
      schema: {
        operationId: 'updateIssueStateInternal',
        summary: 'Update Linear issue state (internal)',
        description: 'Updates the workflow state of a Linear issue using the authenticated user connection.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['issueId'],
          properties: {
            issueId: { type: 'string', description: 'Linear issue ID' },
          },
        },
        body: {
          type: 'object',
          required: ['state'],
          properties: {
            state: {
              type: 'string',
              enum: ['backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done'],
              description: 'Target workflow state',
            },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object', properties: {} },
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
            description: 'Forbidden - User not connected to Linear',
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
      request: FastifyRequest<{ Params: IssueIdParams; Body: UpdateStateBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (userId === undefined || typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { issueId } = request.params;
      const { state } = request.body;
      const logger = request.log as Logger;

      logger.info({ userId, issueId, state }, 'internal/updateIssueState: updating state');

      const services = getServices();

      // Get user's API key and connection
      const apiKeyResult = await services.connectionRepository.getApiKey(userId);
      if (!apiKeyResult.ok) {
        return await handleLinearError(apiKeyResult.error, reply);
      }

      const apiKey = apiKeyResult.value;
      if (apiKey === null) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }

      const connectionResult = await services.connectionRepository.getFullConnection(userId);
      if (!connectionResult.ok) {
        return await handleLinearError(connectionResult.error, reply);
      }

      const connection = connectionResult.value;
      /* v8 ignore start -- upstream: FakeLinearConnectionRepository cannot return null after getApiKey succeeded; TOCTOU race untestable with synchronous fakes @preserve */
      if (!connection) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }
      /* v8 ignore stop @preserve */

      // Get workflow states to find the state ID for the requested state name
      const statesResult = await services.linearApiClient.getWorkflowStates(apiKey, connection.teamId);
      if (!statesResult.ok) {
        return await handleLinearError(statesResult.error, reply);
      }

      // Map state name to Linear state ID
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces ?? on STATE_NAME_MAP lookup; statesResult.value safe after .ok check @preserve */
      const targetStateName = STATE_NAME_MAP[state] ?? state;
      const stateId = findStateId(statesResult.value, targetStateName); // @allow-result-access -- statesResult.ok checked above
      /* v8 ignore stop @preserve */

      if (stateId === null) {
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', `Invalid state: ${state}`);
      }

      // Update the issue state
      const updateResult = await services.linearApiClient.updateIssueState(apiKey, issueId, stateId);
      if (!updateResult.ok) {
        return await handleLinearError(updateResult.error, reply);
      }

      logger.info(
        { userId, issueId, newState: updateResult.value.state.name }, // @allow-result-access -- guarded by if (!updateResult.ok) above
        'internal/updateIssueState: state updated'
      );

      return await reply.ok({});
    }
  );

  fastify.post<{ Body: { identifiers: string[] } }>(
    '/internal/linear/issues/display-batch',
    {
      schema: {
        operationId: 'getLinearIssuesDisplayBatchInternal',
        summary: 'Get multiple Linear issues for display (internal)',
        description: 'Fetches multiple Linear issues with display data. Missing identifiers are omitted.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['identifiers'],
          properties: {
            identifiers: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
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
                properties: {
                  issues: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        identifier: { type: 'string' },
                        title: { type: 'string' },
                        state: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            type: { type: 'string' },
                          },
                          required: ['name', 'type'],
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
                            required: ['id', 'name'],
                          },
                        },
                        url: { type: 'string' },
                        commentCount: { type: 'number' },
                        lastCommentAt: { type: ['string', 'null'] },
                        parentIdentifier: { type: ['string', 'null'] },
                      },
                      required: ['identifier', 'title', 'state', 'priority', 'assignee', 'labels', 'url', 'commentCount', 'lastCommentAt', 'parentIdentifier'],
                    },
                  },
                },
                required: ['issues'],
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
    async (request: FastifyRequest<{ Body: { identifiers: string[] } }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const services = getServices();

      // 1. Batch-fetch all issues
      const issuesResult = await services.issueRepository.findByIdentifiers(
        request.body.identifiers, userId
      );
      if (!issuesResult.ok) {
        reply.status(500);
        return await handleLinearError(issuesResult.error, reply);
      }

      const foundIssues = issuesResult.value; // @allow-result-access -- guarded by if (!issuesResult.ok) above
      if (foundIssues.length === 0) {
        return await reply.ok({ issues: [] });
      }

      // 2. Batch-fetch comment summaries
      const issueIds = foundIssues.map((issue) => issue.id);
      const summariesResult = await services.commentRepository.getCommentSummaries(issueIds);
      if (!summariesResult.ok) {
        reply.status(500);
        return await handleLinearError(summariesResult.error, reply);
      }

      // 2.5 Batch-resolve parent identifiers for subtasks
      const uniqueParentIds = [...new Set(
        foundIssues
          .map((issue) => issue.parentId)
          .filter((parentId): parentId is string => parentId !== null)
      )];
      const parentIdentifierMap = new Map<string, string>();
      if (uniqueParentIds.length > 0) {
        const parentResults = await Promise.all(
          uniqueParentIds.map((parentId) => services.issueRepository.findById(parentId))
        );

        for (const parentResult of parentResults) {
          if (!parentResult.ok) {
            reply.status(500);
            return await handleLinearError(parentResult.error, reply);
          }
          if (parentResult.value !== null) {
            parentIdentifierMap.set(parentResult.value.id, parentResult.value.identifier);
          }
        }
      }

      // 3. Assemble response (preserve input identifier order)
      const summaryMap = new Map(summariesResult.value.map((s) => [s.issueId, s])); // @allow-result-access -- guarded by if (!summariesResult.ok) above
      const identifierOrder = new Map(
        request.body.identifiers.map((id, idx) => [id, idx])
      );
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces undefined check; Map.get() always returns a value because all found issues have identifiers in the input map @preserve */
      const sortedIssues = [...foundIssues].sort(
        (a, b) => (identifierOrder.get(a.identifier) ?? 0) - (identifierOrder.get(b.identifier) ?? 0)
      );
      /* v8 ignore stop @preserve */

      const issues: IssueDisplayResponse[] = sortedIssues.map((issue) => {
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces undefined check; Map.get() always returns a value because getCommentSummaries guarantees an entry for every issueId @preserve */
        const summary = summaryMap.get(issue.id) ?? { commentCount: 0, lastCommentAt: null };
        /* v8 ignore stop @preserve */
        const parentIdentifier = issue.parentId !== null
          ? (parentIdentifierMap.get(issue.parentId) ?? null)
          : null;
        return buildIssueDisplayResponse(issue, summary, parentIdentifier);
      });

      return await reply.ok({ issues });
    }
  );

  // GET /internal/linear/issues/:identifier - Get issue with comment data
  fastify.get<{ Params: { identifier: string } }>(
    '/internal/linear/issues/:identifier',
    {
      schema: {
        operationId: 'getLinearIssueInternal',
        summary: 'Get Linear issue with comment data (internal)',
        description: 'Fetches a Linear issue with comment count and last comment timestamp. Used by code-agent.',
        tags: ['internal'],
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
                  parentIdentifier: { type: ['string', 'null'] },
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

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { identifier } = request.params;
      const services = getServices();
      const logger = request.log as unknown as Logger;

      logger.info({ identifier, userId }, 'internal/getLinearIssue: fetching issue');

      // Find issue by identifier, scoped to the requesting user
      const issueResult = await services.issueRepository.findByIdentifier(identifier, userId);
      if (!issueResult.ok) {
        logger.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
        reply.status(500);
        return await handleLinearError(issueResult.error, reply);
      }

      const issue = issueResult.value;
      if (issue === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      // Get comments (count and last comment timestamp from single query)
      const commentsResult = await services.commentRepository.listByIssueId(issue.id);
      if (!commentsResult.ok) {
        logger.error({ error: commentsResult.error, issueId: issue.id, identifier }, 'Failed to fetch comments');
        reply.status(500);
        return await handleLinearError(commentsResult.error, reply);
      }

      let parentIdentifier: string | null = null;
      if (issue.parentId !== null) {
        const parentIssueResult = await services.issueRepository.findById(issue.parentId);
        if (!parentIssueResult.ok) {
          logger.error({ error: parentIssueResult.error, parentId: issue.parentId, identifier }, 'Failed to fetch parent issue');
          reply.status(500);
          return await handleLinearError(parentIssueResult.error, reply);
        }

        parentIdentifier = parentIssueResult.value?.identifier ?? null;
      }

      const displayIssue = buildIssueDisplayResponse(
        issue,
        toCommentSummary(commentsResult.value),
        parentIdentifier
      ); // @allow-result-access -- guarded by if (!commentsResult.ok) above

      return await reply.ok({
        id: issue.id,
        identifier: issue.identifier,
        parentIdentifier: displayIssue.parentIdentifier,
        title: issue.title,
        description: issue.description,
        state: displayIssue.state,
        priority: displayIssue.priority,
        assignee: displayIssue.assignee,
        labels: displayIssue.labels,
        url: displayIssue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        commentCount: displayIssue.commentCount,
        lastCommentAt: displayIssue.lastCommentAt,
      });
    }
  );

  // GET /internal/linear/issues/:identifier/context - Return issue description + comments
  // No userId scoping — this is a service-to-service call from code-agent;
  // orchestrator has no user context during deep validation.
  fastify.get<{ Params: { identifier: string } }>(
    '/internal/linear/issues/:identifier/context',
    {
      schema: {
        operationId: 'getLinearIssueContextInternal',
        summary: 'Get Linear issue context (description + comments) (internal)',
        description: 'Fetches a Linear issue description and comments for context. Used by code-agent.',
        tags: ['internal'],
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
                  description: { type: ['string', 'null'] },
                  comments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        body: { type: 'string' },
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
          404: {
            description: 'Issue not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          502: {
            description: 'Bad Gateway',
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

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { identifier } = request.params;
      const services = getServices();
      const logger = request.log as unknown as Logger;

      logger.info({ identifier }, 'internal/getLinearIssueContext: fetching issue context');

      // Find issue by identifier (no userId scoping — service-to-service call)
      const issueResult = await services.issueRepository.findByIdentifier(identifier);
      if (!issueResult.ok) {
        logger.error({ error: issueResult.error, identifier }, 'Failed to fetch issue');
        return await handleLinearError(issueResult.error, reply);
      }

      const issue = issueResult.value;
      if (issue === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${identifier} not found`);
      }

      // Get comments for the issue
      const commentsResult = await services.commentRepository.listByIssueId(issue.id);
      if (!commentsResult.ok) {
        logger.error({ error: commentsResult.error, issueId: issue.id, identifier }, 'Failed to fetch comments');
        return await handleLinearError(commentsResult.error, reply);
      }

      // Filter empty/whitespace bodies to match old fetchLinearIssueContext behavior,
      // then sort newest first, cap at 100 to match the old Linear GraphQL first:100 limit.
      const COMMENT_LIMIT = 100;
      const sortedComments = [...commentsResult.value] // @allow-result-access -- guarded by if (!commentsResult.ok) above
        .filter((c) => c.body.trim() !== '')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, COMMENT_LIMIT)
        .map((c) => ({ body: c.body, createdAt: c.createdAt }));

      return await reply.ok({
        description: issue.description !== null && issue.description !== '' ? issue.description : null,
        comments: sortedComments,
      });
    }
  );

  // GET /internal/issues/:issueId/tree - Return issue + recursive descendants from local sync
  fastify.get<{ Params: IssueIdParams }>(
    '/internal/issues/:issueId/tree',
    async (request, reply) => {
      logIncomingRequest(request);
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      const { issueId } = request.params;
      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const services = getServices();
      const allIssuesResult = await services.issueRepository.listByUserId(userId);
      if (!allIssuesResult.ok) return await handleLinearError(allIssuesResult.error, reply);

      const tree = buildIssueTree(allIssuesResult.value, issueId); // @allow-result-access -- guarded by if (!allIssuesResult.ok) above
      if (tree === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${issueId} not found`);
      }

      return await reply.ok({
        root: {
          id: tree.root.id,
          identifier: tree.root.identifier,
          url: tree.root.url,
          parentId: tree.root.parentId,
          labels: tree.root.labels.map((l) => l.name),
          assigneeId: tree.root.assigneeId,
          state: tree.root.state,
        },
        descendants: tree.descendants.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          parentId: issue.parentId,
          labels: issue.labels.map((l) => l.name),
          assigneeId: issue.assigneeId,
          state: issue.state,
        })),
      });
    }
  );

  // GET /internal/linear/issues/:issueId/direct-children - Return live direct children from Linear
  fastify.get<{ Params: IssueIdParams }>(
    '/internal/linear/issues/:issueId/direct-children',
    async (request, reply) => {
      logIncomingRequest(request);
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { issueId } = request.params;
      const services = getServices();
      const apiKeyResult = await services.connectionRepository.getApiKey(userId);
      if (!apiKeyResult.ok) {
        return await handleLinearError(apiKeyResult.error, reply);
      }
      if (apiKeyResult.value === null) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply,
        );
      }

      const childrenResult = await services.linearApiClient.getDirectChildren(apiKeyResult.value, issueId);
      if (!childrenResult.ok) {
        return await handleLinearError(childrenResult.error, reply);
      }
      if (childrenResult.value === null) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', `Issue ${issueId} not found`);
      }

      return await reply.ok(
        childrenResult.value.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          parentId: issue.parentId ?? null,
          labels: issue.labels.map((label) => label.name),
          assigneeId: issue.assignee?.id ?? null,
          state: issue.state.name,
        })),
      );
    },
  );

  done();
};
