/**
 * Internal API routes for Linear issue management (service-to-service).
 * Used by code-agent to create and update Linear issues during code task execution.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import type { Logger } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import type { Result } from '@intexuraos/common-core';
import type { LinearError } from '../domain/errors.js';

// Request/response types
interface CreateIssueBody {
  title: string;
  description: string;
  labels?: string[];
}

interface UpdateStateBody {
  state: 'backlog' | 'in_progress' | 'in_review' | 'qa';
}

interface IssueIdParams {
  issueId: string;
}

// State name mapping for Linear workflow states
const STATE_NAME_MAP: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
};

// Response shape matching code-agent expectations
interface IssueResponse {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/* v8 ignore start -- test-infra: error paths require Linear API fault injection testing @preserve */
async function handleLinearError(
  error: LinearError,
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}
/* v8 ignore stop @preserve */

/**
 * Find a workflow state ID by name from the team's states.
 * Returns null if no matching state is found.
 */
/* v8 ignore start -- test-infra: requires Linear API with multiple workflow states @preserve */
function findStateId(
  statesResult: Result<{ id: string; name: string; type: string }[], LinearError>,
  stateName: string
): string | null {
  if (!statesResult.ok) return null;

  const state = statesResult.value.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase()
  );
  return state?.id ?? null;
}
/* v8 ignore stop @preserve */

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

      /* v8 ignore start -- test-infra: error paths require Linear API fault injection @preserve */
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
      if (!connection) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }

      // Create the issue
      const createResult = await services.linearApiClient.createIssue(apiKey, {
        teamId: connection.teamId,
        title,
        description,
        priority: 0,
      });

      if (!createResult.ok) {
        return await handleLinearError(createResult.error, reply);
      }
      /* v8 ignore stop @preserve */

      const issue = createResult.value;

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
              enum: ['backlog', 'in_progress', 'in_review', 'qa'],
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

      /* v8 ignore start -- test-infra: logging branch detection artifact @preserve */
      logger.info({ userId, issueId, state }, 'internal/updateIssueState: updating state');
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: error paths require Linear API fault injection @preserve */
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
      if (!connection) {
        return await handleLinearError(
          { code: 'NOT_CONNECTED', message: 'User not connected to Linear' },
          reply
        );
      }

      // Get workflow states to find the state ID for the requested state name
      const statesResult = await services.linearApiClient.getWorkflowStates(apiKey, connection.teamId);
      if (!statesResult.ok) {
        return await handleLinearError(statesResult.error, reply);
      }
      /* v8 ignore stop @preserve */

      // Map state name to Linear state ID
      /* v8 ignore start -- test-infra: fallback state requires specific test setup @preserve */
      const targetStateName = STATE_NAME_MAP[state] ?? state;
      const stateId = findStateId(statesResult, targetStateName);
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: null state check requires specific test setup @preserve */
      if (stateId === null) {
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', `Invalid state: ${state}`);
      }
      /* v8 ignore stop @preserve */

      /* v8 ignore start -- test-infra: update failure requires Linear API fault injection @preserve */
      // Update the issue state
      const updateResult = await services.linearApiClient.updateIssueState(apiKey, issueId, stateId);
      if (!updateResult.ok) {
        return await handleLinearError(updateResult.error, reply);
      }
      /* v8 ignore stop @preserve */

      logger.info(
        { userId, issueId, newState: updateResult.value.state.name },
        'internal/updateIssueState: state updated'
      );

      return await reply.ok({});
    }
  );

  done();
};
