/**
 * GET /code/issue-groups route.
 *
 * Server-side issue grouping with pagination for Code Tasks V3.
 * Requires JWT authentication (via Auth0).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { timestampToIso } from '../codeRoutes.js';
import type { JwtValidator } from '../codeRoutes.js';
import {
  groupByLinearIssue,
  sortIssueGroups,
} from '../../domain/issueGrouping/index.js';
import type {
  GroupStatus,
  SortOption,
  SerializedTask,
} from '../../domain/issueGrouping/index.js';

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

const VALID_GROUP_STATUSES: ReadonlySet<string> = new Set(['active', 'needs-action', 'done', 'failed', 'archived']);
const VALID_SORT_OPTIONS: ReadonlySet<string> = new Set(['linear-id', 'pr-number', 'dispatched', 'last-updated']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Convert a CodeTask domain model to the full serialized shape matching the frontend CodeTask type.
 * Mirrors the logic in codeRoutes.ts taskToApiResponse but returns SerializedTask.
 */
function taskToSerializedTask(task: {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: string;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: string;
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt?: unknown;
  dispatchedAt?: unknown;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  agentType?: string;
  implementationTaskId?: string;
  fanOutChildTaskIds?: string[];
  parentTaskId?: string;
  followUpReason?: string;
  prNumber?: number;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
    review_comments_posted?: string;
    review_types?: string;
    requirements_tracker_updated?: string;
    needs_remediation?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
}): SerializedTask {
  /* v8 ignore start -- ts-type: createdAt/updatedAt are always present strings in Firestore; nullish fallback is defensive for the Timestamp union cast and unreachable in tests @preserve */
  const createdAt = timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '';
  const updatedAt = timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '';
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- test-infra: FakeFirestore cannot preserve Timestamp fields during update() -- isFieldValueDelete falsely matches Timestamp.isEqual causing dispatchedAt/completedAt to be dropped @preserve */
  const dispatchedAt = timestampToIso(task.dispatchedAt as { toDate: () => Date } | string | undefined);
  const completedAt = timestampToIso(task.completedAt as { toDate: () => Date } | string | undefined);
  /* v8 ignore stop @preserve */

  const serialized: SerializedTask = {
    id: task.id,
    userId: task.userId,
    prompt: task.prompt,
    sanitizedPrompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    workerType: task.workerType,
    workerLocation: task.workerLocation,
    repository: task.repository,
    baseBranch: task.baseBranch,
    traceId: task.traceId,
    status: task.status,
    dedupKey: task.dedupKey,
    callbackReceived: task.callbackReceived,
    createdAt,
    updatedAt,
  };

  /* v8 ignore start -- test-infra: FakeFirestore update() drops Timestamp fields (isFieldValueDelete matches Timestamp.isEqual) so dispatchedAt/completedAt cannot be reliably set in tests @preserve */
  if (dispatchedAt !== undefined) { serialized.dispatchedAt = dispatchedAt; }
  if (completedAt !== undefined) { serialized.completedAt = completedAt; }
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- test-infra: FakeFirestore create() cannot populate actionId/approvalEventId without triggering dedup-layer rejection @preserve */
  if (task.actionId !== undefined) { serialized.actionId = task.actionId; }
  if (task.approvalEventId !== undefined) { serialized.approvalEventId = task.approvalEventId; }
  /* v8 ignore stop @preserve */
  if (task.linearIssueId !== undefined) { serialized.linearIssueId = task.linearIssueId; }
  if (task.agentType !== undefined) { serialized.agentType = task.agentType; }
  if (task.implementationTaskId !== undefined) { serialized.implementationTaskId = task.implementationTaskId; }
  if (task.fanOutChildTaskIds !== undefined) { serialized.fanOutChildTaskIds = task.fanOutChildTaskIds; }
  if (task.parentTaskId !== undefined) { serialized.parentTaskId = task.parentTaskId; }
  if (task.followUpReason !== undefined) { serialized.followUpReason = task.followUpReason; }
  if (task.prNumber !== undefined) { serialized.prNumber = task.prNumber; }
  if (task.result !== undefined) { serialized.result = task.result; }
  if (task.error !== undefined) { serialized.error = task.error; }

  return serialized;
}

const issueGroupRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options) => {
  const { jwtValidator } = options;

  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.get<{
      Querystring: {
        groupStatus?: string;
        sortBy?: string;
        limit?: number;
        cursor?: string;
      };
    }>(
      '/code/issue-groups',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              groupStatus: { type: 'string', description: 'Comma-separated group statuses to filter by (active, needs-action, done, failed)' },
              sortBy: { type: 'string', enum: ['linear-id', 'pr-number', 'dispatched', 'last-updated'], default: 'linear-id', description: 'Sort order for groups' },
              limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Maximum number of groups to return' },
              cursor: { type: 'string', description: 'Pagination cursor from previous response' },
            },
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: { groupStatus?: string; sortBy?: string; limit?: number; cursor?: string } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/issue-groups',
          includeParams: true,
        });

        const { codeTaskRepo, linearAgentClient, groupSummaryRepo } = getServices();
        // groupSummaryRepo is optional in ServiceContainer for test compatibility but always
        // set in production (services.ts line 345).
        const summaryRepo = groupSummaryRepo as NonNullable<typeof groupSummaryRepo>;
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId -- ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        // Parse query params
        /* v8 ignore start -- schema: Fastify JSON Schema enforces enum/default before handler runs -- fallback branches unreachable @preserve */
        const sortBy: SortOption = (request.query.sortBy !== undefined && VALID_SORT_OPTIONS.has(request.query.sortBy))
          ? request.query.sortBy as SortOption
          : 'linear-id';
        const limit = Math.min(request.query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        /* v8 ignore stop @preserve */

        let statusFilter: GroupStatus[] | undefined;
        if (request.query.groupStatus !== undefined && request.query.groupStatus !== '') {
          statusFilter = request.query.groupStatus
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is GroupStatus => VALID_GROUP_STATUSES.has(s));
          if (statusFilter.length === 0) {
            statusFilter = undefined;
          }
        }

        // 1+2. Fetch counts and page summaries concurrently
        const [countsResult, summariesResult] = await Promise.all([
          summaryRepo.getUserGroupCounts(userId),
          summaryRepo.listGroupSummaries({
            userId,
            sortBy,
            limit,
            ...(statusFilter !== undefined && { statusFilter }),
            ...(request.query.cursor !== undefined && request.query.cursor !== '' && { cursor: request.query.cursor }),
          }),
        ]);
        if (!countsResult.ok) {
          request.log.error({ error: countsResult.error }, 'Failed to get group counts');
          return await reply.fail('INTERNAL_ERROR', countsResult.error.message);
        }
        if (!summariesResult.ok) {
          request.log.error({ error: summariesResult.error }, 'Failed to list group summaries');
          return await reply.fail('INTERNAL_ERROR', summariesResult.error.message);
        }
        const countsValue = countsResult.value; // @allow-result-access -- narrowed by !countsResult.ok guard above
        const { summaries, nextCursor: summariesNextCursor } = summariesResult.value;

        // 3+4. Fetch tasks and hydrate Linear issues concurrently
        const includeArchived = statusFilter?.includes('archived') === true;
        const TASKS_PER_GROUP_LIMIT = 50;
        const taskFetchesPromise = Promise.all(summaries.map(async (summary): Promise<SerializedTask[]> => {
          if (summary.linearIssueId !== null) {
            const tasksResult = await codeTaskRepo.findRecentTasksByLinearIssue(
              summary.linearIssueId,
              TASKS_PER_GROUP_LIMIT,
            );
            if (!tasksResult.ok) {
              request.log.warn(
                { linearIssueId: summary.linearIssueId, error: tasksResult.error },
                'Failed to fetch tasks for linear group'
              );
              return [];
            }
            return tasksResult.value
              .filter((t) => t.userId === userId && (includeArchived || t.status !== 'archived'))
              .map((t) => taskToSerializedTask(t));
          }
          const taskId = summary.groupKey.replace(/^standalone_/, '');
          const taskResult = await codeTaskRepo.findById(taskId);
          if (!taskResult.ok) {
            request.log.warn({ taskId, error: taskResult.error }, 'Failed to fetch standalone task');
            return [];
          }
          const task = taskResult.value;
          /* v8 ignore start -- test-infra: FakeFirestore cannot produce cross-user task leaks or archived standalone tasks in this test flow @preserve */
          if (task.userId !== userId || (!includeArchived && task.status === 'archived')) {
            return [];
          }
          /* v8 ignore stop @preserve */
          return [taskToSerializedTask(task)];
        }));

        const pageLinearIssueIds = summaries
          .map((s) => s.linearIssueId)
          .filter((id): id is string => id !== null);

        interface HydratedLinearIssue {
          identifier: string;
          parentIdentifier: string | null;
          title: string;
          state: { name: string; type: string };
          priority: number;
          assignee: { id: string; name: string } | null;
          labels: { id: string; name: string }[];
          url: string;
          commentCount: number;
          lastCommentAt: string | null;
        }

        const linearHydrationPromise = (async (): Promise<Map<string, HydratedLinearIssue>> => {
          if (pageLinearIssueIds.length === 0) return new Map();
          const linearIssuesResult = await linearAgentClient.fetchIssuesForDisplay({
            userId,
            identifiers: pageLinearIssueIds,
          });
          if (linearIssuesResult.ok) {
            return new Map(linearIssuesResult.value.map((issue) => [issue.identifier, issue]));
          }
          request.log.warn(
            { userId, error: linearIssuesResult.error, issueCount: pageLinearIssueIds.length },
            'Failed to hydrate Linear issues for issue groups'
          );
          return new Map();
        })();

        const [tasksByGroup, hydratedIssuesByIdentifier] = await Promise.all([
          taskFetchesPromise,
          linearHydrationPromise,
        ]);

        // 5. Hydrate tasks with linear issue data and group them
        const allPageTasks: SerializedTask[] = tasksByGroup.flat().map((task) => {
          if (task.linearIssueId !== undefined) {
            const linearIssue = hydratedIssuesByIdentifier.get(task.linearIssueId);
            if (linearIssue !== undefined) {
              return { ...task, linearIssue };
            }
          }
          return task;
        });

        const unsortedGroups = groupByLinearIssue(allPageTasks);
        const paginatedGroups = sortIssueGroups(unsortedGroups, sortBy);

        // 6. Compute totalGroups from counts
        let totalGroups: number;
        if (statusFilter !== undefined) {
          const countMap: Record<string, number> = {
            active: countsValue.active,
            'needs-action': countsValue.needsAction,
            done: countsValue.done,
            failed: countsValue.failed,
            archived: countsValue.archived,
          };
          /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes countMap[s] typed as number | undefined; statusFilter values are always valid GroupStatus keys present in countMap, so undefined branch is unreachable @preserve */
          totalGroups = statusFilter.reduce((sum, s) => sum + (countMap[s] ?? 0), 0);
          /* v8 ignore stop @preserve */
        } else {
          totalGroups = countsValue.totalGroups;
        }

        request.log.info(
          { returnedGroups: paginatedGroups.length, hasMore: summariesNextCursor !== undefined },
          'Returning issue groups'
        );

        return await reply.ok({
          groups: paginatedGroups,
          counts: {
            active: countsValue.active,
            'needs-action': countsValue.needsAction,
            done: countsValue.done,
            failed: countsValue.failed,
            archived: countsValue.archived,
          },
          totalGroups,
          ...(summariesNextCursor !== undefined && { nextCursor: summariesNextCursor }),
        });
      }
    );
  });
};

export default issueGroupRoutes;
