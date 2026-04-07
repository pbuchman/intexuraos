/**
 * GET /code/github-pr-events route.
 *
 * Public endpoint for the web UI to query GitHub PR events.
 * Requires JWT authentication (via Auth0).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { Result } from '@intexuraos/common-core';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { JwtValidator } from '../codeRoutes.js';
import type { GitHubPREvent } from '../../domain/models/gitHubPREvent.js';
import type { RepositoryError } from '../../domain/repositories/gitHubPREventRepository.js';
import { extractEventUrl } from './extractEventUrl.js';

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

type PayloadObject = Record<string, unknown>;

/**
 * Extract the comment/review ID from a webhook payload so we can
 * deduplicate created → edited sequences for the same comment.
 */
function extractCommentKey(eventType: string, payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as PayloadObject;

  if (eventType === 'issue_comment' || eventType === 'pull_request_review_comment') {
    const comment = p['comment'];
    if (typeof comment === 'object' && comment !== null) {
      const id = (comment as PayloadObject)['id'];
      if (typeof id === 'number') return `${eventType}:${String(id)}`;
    }
  }

  if (eventType === 'pull_request_review') {
    const review = p['review'];
    if (typeof review === 'object' && review !== null) {
      const id = (review as PayloadObject)['id'];
      if (typeof id === 'number') return `${eventType}:${String(id)}`;
    }
  }

  return null;
}

/**
 * Deduplicate comment events so each comment appears once at its
 * original position but with the latest body content.
 */
function deduplicateCommentEvents(events: GitHubPREvent[]): GitHubPREvent[] {
  // First pass: find the latest version of each comment
  const latestByKey = new Map<string, GitHubPREvent>();
  for (const event of events) {
    const key = extractCommentKey(event.eventType, event.payload);
    if (key !== null) {
      latestByKey.set(key, event);
    }
  }

  // Second pass: emit each comment once (first occurrence position, latest body)
  const seen = new Set<string>();
  const result: GitHubPREvent[] = [];

  for (const event of events) {
    const key = extractCommentKey(event.eventType, event.payload);
    if (key === null) {
      result.push(event);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    const latest = latestByKey.get(key);
    /* v8 ignore start -- ts-type: Map.get after Map.set with same key always returns defined @preserve */
    if (latest === undefined) {
      result.push(event);
      continue;
    }
    /* v8 ignore stop @preserve */

    // Keep original position and action, use latest body and payload
    result.push({
      ...event,
      body: latest.body,
      payload: latest.payload,
    });
  }

  return result;
}

/**
 * Show PR description body once at the first pull_request event with the latest content.
 * Consistent with comment dedup: first occurrence position, latest body.
 * GitHub sends the full PR body on every synchronize event — this prevents
 * the same "Summary" section from rendering multiple times in the timeline.
 */
function deduplicatePRBody(events: GitHubPREvent[]): GitHubPREvent[] {
  // Find first and last pull_request events with non-empty body
  let firstPRBodyIndex = -1;
  let latestBody: string | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event?.eventType === 'pull_request' && event.body !== null && event.body !== '') {
      if (firstPRBodyIndex === -1) firstPRBodyIndex = i;
      latestBody = event.body;
    }
  }

  if (firstPRBodyIndex === -1) return events;

  return events.map((event, i) => {
    if (event.eventType !== 'pull_request' || event.body === null || event.body === '') return event;
    if (i === firstPRBodyIndex) return { ...event, body: latestBody };
    return { ...event, body: null };
  });
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

        let result: Result<GitHubPREvent[], RepositoryError>;
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

        if (!result.ok) {
          request.log.error({ error: result.error.message }, 'Failed to fetch GitHub PR events'); // @allow-result-access -- narrowed by !result.ok check
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch events');
        }

        // Deduplicate comment events (created → edited) so each comment appears once
        const dedupedEvents = deduplicateCommentEvents(result.value); // @allow-result-access -- narrowed by !result.ok check above
        // Deduplicate PR body so it only shows on the most recent pull_request event
        const finalEvents = deduplicatePRBody(dedupedEvents);

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
        }[] = finalEvents.map((event: GitHubPREvent) => ({
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
