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
import { serializeWatch } from './serializeWatch.js';

const GITHUB_API = 'https://api.github.com';

/** Branches that cannot be used as merge queue base branches. */
const BLOCKED_BASE_BRANCHES = new Set(['main']);

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function getUserId(request: FastifyRequest): string {
  /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
  return (request as unknown as { user?: { userId?: string } }).user?.userId ?? '';
  /* v8 ignore stop @preserve */
}

const GITHUB_FETCH_TIMEOUT_MS = 10_000;

async function resolveGitHubUsername(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { login?: string };
    return data.login ?? null;
  } catch {
    return null;
  }
}

const mergeQueueRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);
    fastify.addHook('onRequest', async (request, reply) => {
      const userId = getUserId(request);
      /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
      if (userId === '') {
        return await reply.fail('UNAUTHORIZED', 'Missing user identity');
      }
      /* v8 ignore stop @preserve */
    });

    // POST /code/merge-queue/watch — create a new merge queue watch
    fastify.post(
      '/code/merge-queue/watch',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/merge-queue/watch',
        });

        const userId = getUserId(request);
        const body = request.body as { owner?: string; repo?: string; baseBranch?: string; excludedPrNumbers?: unknown } | undefined;
        const owner = body?.owner ?? '';
        const repo = body?.repo ?? '';
        const baseBranch = body?.baseBranch ?? '';

        if (owner === '' || repo === '' || baseBranch === '') {
          return await reply.fail('INVALID_REQUEST', 'owner, repo, and baseBranch are required');
        }

        if (BLOCKED_BASE_BRANCHES.has(baseBranch)) {
          return await reply.fail('INVALID_REQUEST', `Merge queue cannot be enabled for the ${baseBranch} branch`);
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
        let repoData: { permissions?: { push?: boolean } };
        try {
          const repoResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
            headers: githubHeaders(token),
            signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
          });
          if (!repoResponse.ok) {
            return await reply.fail('INTERNAL_ERROR', 'Failed to verify repository access');
          }
          repoData = (await repoResponse.json()) as { permissions?: { push?: boolean } };
        } catch {
          return await reply.fail('INTERNAL_ERROR', 'GitHub API request failed');
        }
        if (repoData.permissions?.push !== true) {
          return await reply.code(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You do not have push access to this repository' },
          });
        }

        // Lenient parse: invalid excludedPrNumbers silently defaults to [] (creation is lenient; PUT is strict)
        const rawExcluded = body?.excludedPrNumbers;
        const excludedPrNumbers: number[] = Array.isArray(rawExcluded) && rawExcluded.every((n): n is number => Number.isInteger(n) && (n as number) > 0)
          ? rawExcluded
          : [];

        // Create the watch
        const createResult = await mergeQueueWatchRepo.create({
          userId,
          gitHubUsername,
          owner,
          repo,
          baseBranch,
          excludedPrNumbers,
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

        return await reply.ok(serializeWatch(createResult.value));
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

    // PUT /code/merge-queue/watch/:watchId/exclusions — set excluded PRs
    fastify.put(
      '/code/merge-queue/watch/:watchId/exclusions',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to PUT /code/merge-queue/watch/:watchId/exclusions',
        });

        const userId = getUserId(request);
        const { watchId } = request.params as { watchId: string };
        const body = request.body as { excludedPrNumbers?: unknown } | undefined;

        const rawExcluded = body?.excludedPrNumbers;
        if (!Array.isArray(rawExcluded) || !rawExcluded.every((n): n is number => Number.isInteger(n) && (n as number) > 0)) {
          return await reply.fail('INVALID_REQUEST', 'excludedPrNumbers must be an array of positive integers');
        }

        const excludedPrNumbers: number[] = rawExcluded;

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
            error: { code: 'FORBIDDEN', message: 'Not authorized to modify this watch' },
          });
        }

        if (findResult.value.status !== 'active') {
          return await reply.code(409).send({
            success: false,
            error: { code: 'CONFLICT', message: 'Cannot modify exclusions on a non-active watch' },
          });
        }

        const updateResult = await mergeQueueWatchRepo.update(watchId, { excludedPrNumbers });
        if (!updateResult.ok) {
          request.log.error({ error: updateResult.error }, 'Failed to update watch exclusions');
          return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
        }

        return await reply.ok({ excludedPrNumbers });
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

        const watches = result.value.map(serializeWatch);
        return await reply.ok({ watches });
      }
    );

    // GET /code/merge-queue/branches — list branches with open PR counts (reads from Firestore)
    fastify.get(
      '/code/merge-queue/branches',
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/merge-queue/branches',
        });

        const query = request.query as { owner?: string; repo?: string };

        if (query.owner === undefined || query.repo === undefined) {
          return await reply.fail('INVALID_REQUEST', 'owner and repo query parameters are required');
        }

        const { gitHubPRSummaryRepo } = getServices();
        const repository = `${query.owner}/${query.repo}`;

        const summariesResult = await gitHubPRSummaryRepo.findOpenByRepository(repository);
        if (!summariesResult.ok) {
          request.log.error({ error: summariesResult.error }, 'Failed to load open PR summaries');
          return await reply.fail('INTERNAL_ERROR', summariesResult.error.message);
        }

        // Group by baseBranch (include all, flag blocked branches)
        const branchCounts = new Map<string, number>();
        for (const summary of summariesResult.value) {
          if (summary.baseBranch === null) continue;
          const current = branchCounts.get(summary.baseBranch) ?? 0;
          branchCounts.set(summary.baseBranch, current + 1);
        }

        const branches = Array.from(branchCounts.entries()).map(([name, openPrCount]) => ({
          name,
          openPrCount,
          blocked: BLOCKED_BASE_BRANCHES.has(name),
        }));

        return await reply.ok({ branches });
      }
    );

    // GET /code/merge-queue/prs — list PRs for a specific base branch (reads from Firestore)
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
        const repository = `${owner}/${repo}`;
        const { userServiceClient, mergeQueueWatchRepo, gitHubPRSummaryRepo } = getServices();

        const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
        if (!tokenResult.ok) {
          request.log.error({ error: tokenResult.error }, 'Failed to resolve GitHub token');
          return await reply.fail('INTERNAL_ERROR', 'Failed to resolve GitHub token');
        }
        const token = tokenResult.value.accessToken;

        // Resolve the requesting user's GitHub username (for eligibility check)
        const gitHubUsername = await resolveGitHubUsername(token);

        // Find active watch for this user+branch to determine eligibility
        const watchResult = await mergeQueueWatchRepo.findActiveByUserAndBranch(userId, owner, repo, baseBranch);
        const activeWatch = watchResult.ok ? watchResult.value : null;

        const summariesResult = await gitHubPRSummaryRepo.findOpenByBaseBranch(repository, baseBranch);
        if (!summariesResult.ok) {
          request.log.error({ error: summariesResult.error }, 'Failed to load PR summaries');
          return await reply.fail('INTERNAL_ERROR', summariesResult.error.message);
        }

        const pullRequests = summariesResult.value.map((summary) => {
          const eligibleUsername = activeWatch !== null ? activeWatch.gitHubUsername : gitHubUsername;
          const authorIsEligible = ALLOWED_BOTS.has(summary.authorLogin ?? '') ||
            (eligibleUsername !== null && summary.authorLogin === eligibleUsername);

          return {
            number: summary.pullRequestNumber,
            title: summary.title,
            author: summary.authorLogin,
            authorIsEligible,
            mergeConflictStatus: summary.mergeConflictStatus,
            createdAt: summary.firstSeenAt.toISOString(),
            htmlUrl: `https://github.com/${owner}/${repo}/pull/${String(summary.pullRequestNumber)}`,
          };
        });

        return await reply.ok({ pullRequests });
      }
    );
  });
};

export default mergeQueueRoutes;
