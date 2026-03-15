/**
 * GET /code/github-pr-summaries route.
 *
 * Returns PRs with activity in the last 30 days, sorted by PR number descending.
 * Requires JWT authentication (via Auth0).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { CodeRoutesOptions } from './github-pre-events.js';

type GitHubPRStatus = 'open' | 'closed' | 'merged';

function deriveStatus(state: string | null, mergedAt: Date | null): GitHubPRStatus {
  if (mergedAt !== null) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

const githubPRSummariesResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      properties: {
        prs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repository: { type: 'string' },
              pullRequestNumber: { type: 'number' },
              title: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['open', 'closed', 'merged'] },
              lastActivityAt: { type: 'string', format: 'date-time' },
            },
            required: ['repository', 'pullRequestNumber', 'title', 'status', 'lastActivityAt'],
          },
        },
      },
      required: ['prs'],
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

const githubPRSummariesRoute: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.get(
      '/code/github-pr-summaries',
      {
        schema: {
          response: {
            200: githubPRSummariesResponseSchema,
            401: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/github-pr-summaries',
        });

        const { gitHubPRSummaryRepo } = getServices();

        const result = await gitHubPRSummaryRepo.findRecentlyActive(30);

        if (!result.ok) {
          request.log.error({ error: result.error.message }, 'Failed to fetch GitHub PR summaries'); // @allow-result-access -- narrowed by !result.ok
          return await reply.fail('INTERNAL_ERROR', 'Failed to fetch PR summaries');
        }

        // Derive status and sort by PR number descending
        const prs = result.value // @allow-result-access -- narrowed by !result.ok above
          .map((summary) => ({
            repository: summary.repository,
            pullRequestNumber: summary.pullRequestNumber,
            title: summary.title,
            status: deriveStatus(summary.state, summary.mergedAt),
            lastActivityAt: summary.lastActivityAt.toISOString(),
          }))
          .sort((a, b) => b.pullRequestNumber - a.pullRequestNumber);

        request.log.info({ count: prs.length }, 'Returning GitHub PR summaries');

        return await reply.ok({ prs });
      }
    );
  });
};

export default githubPRSummariesRoute;
