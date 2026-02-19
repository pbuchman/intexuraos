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
import { extractEventUrl } from './extractEventUrl.js';

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

// Query params schema
const githubPREventsQuerySchema = {
  type: 'object',
  properties: {
    repository: { type: 'string', description: 'Optional repository name (e.g., "intexuraos/code-agent"). If omitted, returns events from all repositories.' },
    pullRequestNumber: { type: 'number', minimum: 1, description: 'Optional PR number. Requires repository to also be set. Returns events for the specific PR oldest-first.' },
    limit: { type: 'number', minimum: 1, maximum: 200, default: 50, description: 'Maximum number of events to return' },
  },
};

// Response schema for a single event (only fields used by the UI)
const gitHubPREventSchema = {
  type: 'object',
  properties: {
    pullRequestNumber: { type: 'number' },
    title: { type: ['string', 'null'] },
    repository: { type: 'string' },
    eventType: { type: 'string', enum: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'issue_comment', 'push', 'ping'] },
    action: { type: ['string', 'null'], enum: ['opened', 'closed', 'edited', 'synchronized', 'ready_for_review', 'converted_to_draft', 'submitted', 'dismissed', 'created', 'deleted', null] },
    senderLogin: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    eventUrl: { type: ['string', 'null'] },
    body: { type: ['string', 'null'] },
  },
  required: ['pullRequestNumber', 'title', 'repository', 'eventType', 'action', 'senderLogin', 'createdAt', 'eventUrl', 'body'],
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
      Querystring: { repository?: string; pullRequestNumber?: number; limit?: number };
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
      async (request: FastifyRequest<{ Querystring: { repository?: string; pullRequestNumber?: number; limit?: number } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/github-pr-events',
        });

        const { repository, pullRequestNumber, limit = 50 } = request.query;

        // Validate repository format if provided
        if (repository !== undefined && !REPOSITORY_PATTERN.test(repository)) {
          request.log.warn({ repository }, 'Invalid repository format');
          return await reply.fail('INVALID_REQUEST', 'Repository must be in format "owner/repo"');
        }

        // pullRequestNumber requires repository
        if (pullRequestNumber !== undefined && repository === undefined) {
          return await reply.fail('INVALID_REQUEST', 'pullRequestNumber requires repository to also be set');
        }

        const { gitHubPREventRepo } = getServices();

        request.log.info({ repository: repository ?? 'all', pullRequestNumber, limit }, 'Fetching GitHub PR events');

        let result;
        if (repository !== undefined && pullRequestNumber !== undefined) {
          // Per-PR fetch: returns events oldest-first (reversed from stored desc order)
          const prResult = await gitHubPREventRepo.findByPullRequest(repository, pullRequestNumber);
          if (!prResult.ok) {
            request.log.error({ error: prResult.error.message }, 'Failed to fetch GitHub PR events'); // @allow-result-access -- narrowed by !prResult.ok
            return await reply.fail('INTERNAL_ERROR', 'Failed to fetch events');
          }
          // Reverse to get oldest-first (findByPullRequest returns desc)
          result = { ok: true as const, value: [...prResult.value].reverse() };
        } else {
          // Repository or all-repos fetch
          result =
            repository !== undefined
              ? await gitHubPREventRepo.findByRepository(repository, limit)
              : await gitHubPREventRepo.findAll(limit);
        }

        /* v8 ignore start -- upstream: error handling for external database failures @preserve */
        if (!result.ok) {
          request.log.error({ error: result.error.message }, 'Failed to fetch GitHub PR events'); // @allow-result-access -- narrowed by !result.ok check
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch events');
        }
        /* v8 ignore stop @preserve */

        // Return only fields used by the UI
        const events: {
          pullRequestNumber: number;
          title: string | null;
          repository: string;
          eventType: string;
          action: string | null;
          senderLogin: string;
          createdAt: string;
          eventUrl: string | null;
          body: string | null;
        }[] = result.value.map((event: GitHubPREvent) => ({ // @allow-result-access -- narrowed by !result.ok check above
          pullRequestNumber: event.pullRequestNumber,
          title: event.title,
          repository: event.repository,
          eventType: event.eventType,
          action: event.action,
          senderLogin: event.senderLogin,
          createdAt: event.createdAt.toISOString(),
          eventUrl: extractEventUrl(event.eventType, event.payload),
          body: event.body,
        }));

        request.log.info({ count: events.length }, 'Returning GitHub PR events');

        return await reply.ok({ events });
      }
    );
  });
};

export default githubPREventsRoute;
