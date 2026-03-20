/**
 * Merge queue routes — JWT-authenticated endpoints for the web UI.
 *
 * Allows users to create/cancel watches and view branch/PR status
 * for the merge queue feature.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { CodeRoutesOptions } from '../code/github-pre-events.js';
import { ALLOWED_BOTS } from '../webhooks/github.js';

const GITHUB_API = 'https://api.github.com';

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function getUserId(request: FastifyRequest): string {
  /* v8 ignore start -- ts-type: FastifyRequest type lacks user.userId augmentation; JWT hook always sets it on authenticated routes @preserve */
  return (request as unknown as { user?: { userId?: string } }).user?.userId ?? '';
  /* v8 ignore stop @preserve */
}

async function resolveGitHubUsername(token: string): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: githubHeaders(token),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { login?: string };
  return data.login ?? null;
}

const mergeQueueRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    // POST /code/merge-queue/watch — create a new merge queue watch
    fastify.post(
      '/code/merge-queue/watch',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/merge-queue/watch',
        });

        const userId = getUserId(request);
        const body = request.body as { owner?: string; repo?: string; baseBranch?: string } | undefined;
        const owner = body?.owner ?? '';
        const repo = body?.repo ?? '';
        const baseBranch = body?.baseBranch ?? '';

        if (owner === '' || repo === '' || baseBranch === '') {
          return await reply.fail('INVALID_REQUEST', 'owner, repo, and baseBranch are required');
        }

        const { userServiceClient, mergeQueueWatchRepo } = getServices();

        const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
        if (!tokenResult.ok) {
          request.log.error({ error: tokenResult.error }, 'Failed to resolve GitHub token');
          return await reply.fail('INTERNAL_ERROR', 'Failed to resolve GitHub token');
        }
        const token = tokenResult.value.accessToken;

        // Resolve GitHub username
        const gitHubUsername = await resolveGitHubUsername(token);
        if (gitHubUsername === null) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to resolve GitHub username');
        }

        // Verify push access
        const repoResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
          headers: githubHeaders(token),
        });
        if (!repoResponse.ok) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to verify repository access');
        }
        const repoData = (await repoResponse.json()) as { permissions?: { push?: boolean } };
        if (repoData.permissions?.push !== true) {
          return await reply.code(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You do not have push access to this repository' },
          });
        }

        // Create the watch
        const createResult = await mergeQueueWatchRepo.create({
          userId,
          gitHubUsername,
          owner,
          repo,
          baseBranch,
        });

        if (!createResult.ok) {
          if (createResult.error.code === 'CONFLICT') {
            return await reply.code(409).send({
              success: false,
              error: { code: 'CONFLICT', message: 'Watch already exists' },
            });
          }
          request.log.error({ error: createResult.error }, 'Failed to create merge queue watch');
          return await reply.fail('INTERNAL_ERROR', createResult.error.message);
        }

        return await reply.ok(createResult.value);
      }
    );

    // DELETE /code/merge-queue/watch/:watchId — cancel a watch
    fastify.delete(
      '/code/merge-queue/watch/:watchId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to DELETE /code/merge-queue/watch/:watchId',
        });

        const userId = getUserId(request);
        const { watchId } = request.params as { watchId: string };

        const { mergeQueueWatchRepo } = getServices();

        const findResult = await mergeQueueWatchRepo.findById(watchId);
        if (!findResult.ok) {
          if (findResult.error.code === 'NOT_FOUND') {
            return await reply.code(404).send({
              success: false,
              error: { code: 'NOT_FOUND', message: findResult.error.message },
            });
          }
          return await reply.fail('INTERNAL_ERROR', findResult.error.message);
        }

        if (findResult.value.userId !== userId) {
          return await reply.code(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized to cancel this watch' },
          });
        }

        const updateResult = await mergeQueueWatchRepo.update(watchId, {
          status: 'cancelled',
          cancelledAt: new Date(),
        });

        if (!updateResult.ok) {
          request.log.error({ error: updateResult.error }, 'Failed to cancel merge queue watch');
          return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        return await reply.ok({ success: true });
      }
    );

    // GET /code/merge-queue/watches — list watches for a user+repo
    fastify.get(
      '/code/merge-queue/watches',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/merge-queue/watches',
        });

        const userId = getUserId(request);
        const query = request.query as { owner?: string; repo?: string };

        if (query.owner === undefined || query.repo === undefined) {
          return await reply.fail('INVALID_REQUEST', 'owner and repo query parameters are required');
        }

        const { mergeQueueWatchRepo } = getServices();

        const result = await mergeQueueWatchRepo.findByUserAndRepo(userId, query.owner, query.repo);
        if (!result.ok) {
          request.log.error({ error: result.error }, 'Failed to fetch merge queue watches');
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }

        return await reply.ok({ watches: result.value });
      }
    );

    // GET /code/merge-queue/branches — list branches with open PR counts
    fastify.get(
      '/code/merge-queue/branches',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/merge-queue/branches',
        });

        const userId = getUserId(request);
        const query = request.query as { owner?: string; repo?: string };

        if (query.owner === undefined || query.repo === undefined) {
          return await reply.fail('INVALID_REQUEST', 'owner and repo query parameters are required');
        }

        const { userServiceClient, gitHubPRClient } = getServices();

        const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
        if (!tokenResult.ok) {
          request.log.error({ error: tokenResult.error }, 'Failed to resolve GitHub token');
          return await reply.fail('INTERNAL_ERROR', 'Failed to resolve GitHub token');
        }
        const token = tokenResult.value.accessToken;

        const prsResult = await gitHubPRClient.listAllOpenPullRequests(token, query.owner, query.repo);
        if (!prsResult.ok) {
          request.log.error({ error: prsResult.error }, 'Failed to list open pull requests');
          return await reply.fail('INTERNAL_ERROR', prsResult.error.message);
        }

        // Group by baseBranch and count
        const branchCounts = new Map<string, number>();
        for (const pr of prsResult.value) {
          const current = branchCounts.get(pr.baseBranch) ?? 0;
          branchCounts.set(pr.baseBranch, current + 1);
        }

        const branches = Array.from(branchCounts.entries()).map(([name, openPrCount]) => ({
          name,
          openPrCount,
        }));

        return await reply.ok({ branches });
      }
    );

    // GET /code/merge-queue/prs — list PRs for a specific base branch
    fastify.get(
      '/code/merge-queue/prs',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/merge-queue/prs',
        });

        const userId = getUserId(request);
        const query = request.query as { owner?: string; repo?: string; baseBranch?: string };

        if (query.owner === undefined || query.repo === undefined || query.baseBranch === undefined) {
          return await reply.fail('INVALID_REQUEST', 'owner, repo, and baseBranch query parameters are required');
        }

        const { owner, repo, baseBranch } = query;
        const { userServiceClient, gitHubPRClient, mergeQueueWatchRepo } = getServices();

        const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
        if (!tokenResult.ok) {
          request.log.error({ error: tokenResult.error }, 'Failed to resolve GitHub token');
          return await reply.fail('INTERNAL_ERROR', 'Failed to resolve GitHub token');
        }
        const token = tokenResult.value.accessToken;

        // Resolve the requesting user's GitHub username
        const gitHubUsername = await resolveGitHubUsername(token);

        // Find active watch for this user+branch to determine eligibility
        const watchResult = await mergeQueueWatchRepo.findActiveByUserAndBranch(userId, owner, repo, baseBranch);
        const activeWatch = watchResult.ok ? watchResult.value : null;

        const prsResult = await gitHubPRClient.listOpenPullRequestsByBaseBranch(token, owner, repo, baseBranch);
        if (!prsResult.ok) {
          request.log.error({ error: prsResult.error }, 'Failed to list PRs by base branch');
          return await reply.fail('INTERNAL_ERROR', prsResult.error.message);
        }

        // For each PR, get details then check status in parallel
        const pullRequests = await Promise.all(
          prsResult.value.map(async (pr) => {
            const detailsResult = await gitHubPRClient.getPullRequestDetails(token, owner, repo, pr.number);

            const mergeable = detailsResult.ok ? detailsResult.value.mergeable : null;
            const mergeableState = detailsResult.ok ? detailsResult.value.mergeableState : null;

            // Use headSha from details for check status lookup
            let checksStatus = 'pending';
            if (detailsResult.ok) {
              const checksResult = await gitHubPRClient.getCombinedCheckStatus(
                token, owner, repo, detailsResult.value.headSha
              );
              checksStatus = checksResult.ok ? checksResult.value.state : 'pending';
            }

            // authorIsEligible: true if author is the requesting user or an allowed bot
            const eligibleUsername = activeWatch !== null ? activeWatch.gitHubUsername : gitHubUsername;
            const authorIsEligible = ALLOWED_BOTS.has(pr.authorLogin) ||
              (eligibleUsername !== null && pr.authorLogin === eligibleUsername);

            return {
              number: pr.number,
              title: pr.title,
              author: pr.authorLogin,
              authorIsEligible,
              mergeable,
              mergeableState,
              checksStatus,
              createdAt: pr.createdAt,
              htmlUrl: `https://github.com/${owner}/${repo}/pull/${String(pr.number)}`,
            };
          })
        );

        return await reply.ok({ pullRequests });
      }
    );
  });
};

export default mergeQueueRoutes;
