/**
 * GET /code/github-pr-events route.
 *
 * Public endpoint for the web UI to query GitHub PR events.
 * Requires JWT authentication (via Auth0).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { JwtValidator } from '../codeRoutes.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

// Query params schema
const githubPREventsQuerySchema = {
  type: 'object',
  properties: {
    repository: { type: 'string', description: 'Repository name (e.g., "intexuraos/code-agent")' },
    limit: { type: 'number', minimum: 1, maximum: 100, default: 50, description: 'Maximum number of events to return' },
  },
  required: ['repository'],
};

// Response schema for a single event
const gitHubPREventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    githubEventId: { type: 'number' },
    repository: { type: 'string' },
    repositoryId: { type: 'number' },
    pullRequestNumber: { type: 'number' },
    pullRequestId: { type: 'number' },
    eventType: { type: 'string', enum: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'push', 'ping'] },
    action: { type: ['string', 'null'], enum: ['opened', 'closed', 'edited', 'synchronized', 'ready_for_review', 'converted_to_draft', 'submitted', 'dismissed', 'created', 'deleted', null] },
    senderLogin: { type: 'string' },
    senderId: { type: 'number' },
    senderType: { type: 'string' },
    title: { type: ['string', 'null'] },
    body: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    mergedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    processedAt: { type: 'string', format: 'date-time' },
    payload: { type: 'object' },
  },
  required: ['id', 'githubEventId', 'repository', 'repositoryId', 'pullRequestNumber', 'pullRequestId', 'eventType', 'action', 'senderLogin', 'senderId', 'senderType', 'title', 'body', 'state', 'mergedAt', 'createdAt', 'processedAt', 'payload'],
};

// Response schema for the endpoint
const githubPREventsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: gitHubPREventSchema,
        },
      },
      required: ['events'],
    },
  },
  required: ['success', 'data'],
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
};

// Repository format validation regex
const REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

const githubPREventsRoute: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.get<{
      Querystring: { repository: string; limit?: number };
    }>(
      '/code/github-pr-events',
      {
        schema: {
          querystring: githubPREventsQuerySchema,
          response: {
            200: githubPREventsResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: { repository: string; limit?: number } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/github-pr-events',
        });

        const { repository, limit = 50 } = request.query;

        // Validate repository format (owner/repo)
        if (!REPOSITORY_PATTERN.test(repository)) {
          request.log.warn({ repository }, 'Invalid repository format');
          return await reply.fail('INVALID_REQUEST', 'Repository must be in format "owner/repo"');
        }

        const { gitHubPREventRepo } = getServices();

        request.log.info({ repository, limit }, 'Fetching GitHub PR events');

        const result = await gitHubPREventRepo.findByRepository(repository, limit);

        /* v8 ignore start -- upstream: error handling for external database failures @preserve */
        if (!result.ok) {
          request.log.error({ error: result.error.message }, 'Failed to fetch GitHub PR events'); // @allow-result-access -- narrowed by !result.ok check
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch events');
        }
        /* v8 ignore stop @preserve */

        // Transform dates to ISO strings for JSON serialization
        const events: {
          id: string;
          githubEventId: number;
          repository: string;
          repositoryId: number;
          pullRequestNumber: number;
          pullRequestId: number;
          eventType: string;
          action: string | null;
          senderLogin: string;
          senderId: number;
          senderType: string;
          title: string | null;
          body: string | null;
          state: string | null;
          mergedAt: string | null;
          createdAt: string;
          processedAt: string;
          payload: unknown;
        }[] = result.value.map((event: GitHubPREvent) => ({ // @allow-result-access -- narrowed by !result.ok check above
          id: event.id,
          githubEventId: event.githubEventId,
          repository: event.repository,
          repositoryId: event.repositoryId,
          pullRequestNumber: event.pullRequestNumber,
          pullRequestId: event.pullRequestId,
          eventType: event.eventType,
          action: event.action,
          senderLogin: event.senderLogin,
          senderId: event.senderId,
          senderType: event.senderType,
          title: event.title,
          body: event.body,
          state: event.state,
          /* v8 ignore start -- upstream: mergedAt serialization branch for optional Date field @preserve */
          mergedAt: event.mergedAt ? event.mergedAt.toISOString() : null,
          /* v8 ignore stop @preserve */
          createdAt: event.createdAt.toISOString(),
          processedAt: event.processedAt.toISOString(),
          payload: event.payload,
        }));

        request.log.info({ count: events.length }, 'Returning GitHub PR events');

        return await reply.ok({ events });
      }
    );
  });
};

export default githubPREventsRoute;
