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
  encodeCursor,
  decodeCursor,
} from '../../domain/issueGrouping/index.js';
import type {
  GroupStatus,
  SortOption,
  SerializedTask,
  IssueGroup,
} from '../../domain/issueGrouping/index.js';

export interface CodeRoutesOptions {
  jwtValidator: JwtValidator;
}

const VALID_GROUP_STATUSES: ReadonlySet<string> = new Set(['active', 'needs-action', 'done', 'failed']);
const VALID_SORT_OPTIONS: ReadonlySet<string> = new Set(['linear-id', 'pr-number', 'created-time', 'started-time']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Convert a CodeTask domain model to the serialized shape needed for issue grouping.
 * Includes fields required by the grouping/pipeline logic (e.g., needs_remediation).
 */
function taskToSerializedTask(task: {
  id: string;
  status: string;
  createdAt: unknown;
  updatedAt: unknown;
  dispatchedAt?: unknown;
  linearIssueId?: string;
  agentType?: string;
  implementationTaskId?: string;
  prNumber?: number;
  repository: string;
  result?: {
    prUrl?: string;
    needs_remediation?: string;
  };
}): SerializedTask {
  /* v8 ignore start -- test-infra: FakeFirestore cannot preserve Timestamp fields during update() -- isFieldValueDelete falsely matches Timestamp.isEqual causing dispatchedAt/updatedAt to be dropped @preserve */
  const dispatchedAt = timestampToIso(task.dispatchedAt as { toDate: () => Date } | string | undefined);

  const serialized: SerializedTask = {
    id: task.id,
    status: task.status,
    createdAt: timestampToIso(task.createdAt as { toDate: () => Date } | string | undefined) ?? '',
    updatedAt: timestampToIso(task.updatedAt as { toDate: () => Date } | string | undefined) ?? '',
    repository: task.repository,
  };

  if (dispatchedAt !== undefined) {
    serialized.dispatchedAt = dispatchedAt;
  }
  /* v8 ignore stop @preserve */
  if (task.linearIssueId !== undefined) {
    serialized.linearIssueId = task.linearIssueId;
  }
  if (task.agentType !== undefined) {
    serialized.agentType = task.agentType;
  }
  if (task.implementationTaskId !== undefined) {
    serialized.implementationTaskId = task.implementationTaskId;
  }
  if (task.prNumber !== undefined) {
    serialized.prNumber = task.prNumber;
  }
  if (task.result !== undefined) {
    serialized.result = task.result;
  }

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
              sortBy: { type: 'string', enum: ['linear-id', 'pr-number', 'created-time', 'started-time'], default: 'linear-id', description: 'Sort order for groups' },
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

        const { codeTaskRepo, linearAgentClient } = getServices();
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

        let startIndex = 0;
        if (request.query.cursor !== undefined && request.query.cursor !== '') {
          try {
            const decoded = decodeCursor(request.query.cursor);
            startIndex = decoded.index;
          } catch {
            request.log.warn({ cursor: request.query.cursor }, 'Invalid pagination cursor, starting from beginning');
            startIndex = 0;
          }
        }

        const listResult = await codeTaskRepo.listAllNonArchived(userId);
        if (!listResult.ok) {
          request.log.error({ error: listResult.error }, 'Failed to list non-archived tasks');
          return await reply.fail('INTERNAL_ERROR', listResult.error.message);
        }

        const serializedTasks: SerializedTask[] = listResult.value.map((task) => taskToSerializedTask(task));

        const linearIssueIds = Array.from(
          new Set(
            listResult.value
              .map((task) => task.linearIssueId)
              .filter((issueId): issueId is string => issueId !== undefined)
          )
        );

        let hydratedIssuesByIdentifier = new Map<string, {
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
        }>();

        if (linearIssueIds.length > 0) {
          const linearIssuesResult = await linearAgentClient.fetchIssuesForDisplay({
            userId,
            identifiers: linearIssueIds,
          });

          if (linearIssuesResult.ok) {
            hydratedIssuesByIdentifier = new Map(
              linearIssuesResult.value.map((issue) => [issue.identifier, issue])
            );
          } else {
            request.log.warn(
              { userId, error: linearIssuesResult.error, issueCount: linearIssueIds.length },
              'Failed to hydrate Linear issues for issue groups'
            );
          }
        }

        const hydratedTasks: SerializedTask[] = serializedTasks.map((task) => {
          if (task.linearIssueId !== undefined) {
            const linearIssue = hydratedIssuesByIdentifier.get(task.linearIssueId);
            if (linearIssue !== undefined) {
              return { ...task, linearIssue };
            }
          }
          return task;
        });

        const allGroups = groupByLinearIssue(hydratedTasks);

        const globalCounts: Record<GroupStatus, number> = {
          active: 0,
          'needs-action': 0,
          done: 0,
          failed: 0,
        };
        for (const group of allGroups) {
          globalCounts[group.aggregateStatus] += 1;
        }

        let filteredGroups: IssueGroup[];
        if (statusFilter !== undefined) {
          const statusSet = new Set<GroupStatus>(statusFilter);
          filteredGroups = allGroups.filter((g) => statusSet.has(g.aggregateStatus));
        } else {
          filteredGroups = allGroups;
        }

        const sortedGroups = sortIssueGroups(filteredGroups, sortBy);

        const paginatedGroups = sortedGroups.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < sortedGroups.length;
        const nextCursor = hasMore ? encodeCursor(startIndex + limit) : undefined;

        request.log.info(
          {
            totalGroups: allGroups.length,
            filteredGroups: filteredGroups.length,
            returnedGroups: paginatedGroups.length,
            hasMore,
          },
          'Returning issue groups'
        );

        return await reply.ok({
          groups: paginatedGroups,
          counts: globalCounts,
          totalGroups: filteredGroups.length,
          ...(nextCursor !== undefined && { nextCursor }),
        });
      }
    );
  });
};

export default issueGroupRoutes;
