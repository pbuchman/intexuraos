/**
 * List Issues Use Case
 *
 * Fetches Linear issues and groups them for dashboard display.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearConnectionRepository,
  LinearIssue,
  LinearIssueRepository,
  SyncedLinearIssue,
} from '../index.js';
import { mapStateToDashboardColumn } from '../models.js';

export interface ListIssuesDeps {
  issueRepository: LinearIssueRepository;
  connectionRepository: LinearConnectionRepository;
  logger?: Logger;
}

export interface ListIssuesRequest {
  userId: string;
  /** Include archived (old completed) issues */
  includeArchive?: boolean;
}

export interface GroupedIssues {
  todo: LinearIssue[];
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  to_test: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

export interface ListIssuesResponse {
  issues: GroupedIssues;
  teamName: string;
}

const DONE_RECENT_DAYS = 7;

/**
 * Convert SyncedLinearIssue to LinearIssue for API response.
 */
function syncedToLinearIssue(synced: SyncedLinearIssue): LinearIssue {
  return {
    id: synced.id,
    identifier: synced.identifier,
    title: synced.title,
    description: synced.description,
    priority: synced.priority,
    state: {
      id: '', // Not stored in SyncedLinearIssue, not critical for frontend
      name: synced.state,
      type: synced.stateType,
    },
    /* v8 ignore start -- ts-type: assigneeName always set when assigneeId is non-null @preserve */
    assignee: synced.assigneeId !== null ? { id: synced.assigneeId, name: synced.assigneeName ?? '' } : null,
    /* v8 ignore stop @preserve */
    url: synced.url,
    createdAt: synced.createdAt,
    updatedAt: synced.updatedAt,
    completedAt: null, // Derived from state, not stored separately
    parentId: synced.parentId,
    childCount: 0, // Will be calculated from children array
    children: [],
    labels: synced.labels,
  };
}

export async function listIssues(
  request: ListIssuesRequest,
  deps: ListIssuesDeps
): Promise<Result<ListIssuesResponse, LinearError>> {
  const { userId, includeArchive = true } = request;
  const { issueRepository, connectionRepository, logger } = deps;

  logger?.info({ userId, includeArchive }, 'listIssues: entry');

  // Get user's connection (for team name)
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'Linear not connected' });
  }

  // Fetch all issues from Firestore
  const issuesResult = await issueRepository.listByUserId(userId);

  if (!issuesResult.ok) {
    return err(issuesResult.error);
  }

  const syncedIssues = issuesResult.value;
  logger?.info({ userId, totalIssues: syncedIssues.length }, 'Fetched issues from Firestore');

  // Convert to LinearIssue and build parent-child relationships
  const issueMap = new Map<string, LinearIssue>();
  const topLevelIssues: LinearIssue[] = [];
  const childIssues: LinearIssue[] = [];

  // First pass: convert all issues
  for (const synced of syncedIssues) {
    const issue = syncedToLinearIssue(synced);
    issueMap.set(issue.id, issue);

    if (synced.parentId === null) {
      topLevelIssues.push(issue);
    } else {
      childIssues.push(issue);
    }
  }

  // Second pass: attach children to parents
  for (const child of childIssues) {
    /* v8 ignore start -- ts-type: childIssues only contains issues with parentId !== null from line 112-115, this is defensive narrowing for TypeScript @preserve */
    if (child.parentId !== null && child.parentId !== undefined) {
      const parent = issueMap.get(child.parentId);
      if (parent !== undefined) {
        parent.children.push(child);
        parent.childCount = parent.children.length;
      }
    }
    /* v8 ignore stop @preserve */
  }

  // Use all issues (including subtasks) for grouping
  // Subtasks will appear in their respective state groups alongside parent issues
  const issues = [...topLevelIssues, ...childIssues];
  logger?.info({ userId, totalIssues: issues.length, topLevel: topLevelIssues.length, subtasks: childIssues.length }, 'Built parent-child relationships');

  // Group issues by dashboard column
  const grouped: GroupedIssues = {
    todo: [],
    backlog: [],
    in_progress: [],
    in_review: [],
    to_test: [],
    done: [],
    archive: [],
  };

  const now = new Date();
  const recentCutoff = new Date(now);
  recentCutoff.setDate(now.getDate() - DONE_RECENT_DAYS);

  for (const issue of issues) {
    const column = mapStateToDashboardColumn(issue.state.type, issue.state.name);

    if (column === 'done') {
      // Check if issue is recent or archive
      // Use completedAt if available, otherwise use updatedAt as a proxy for completion time
      /* v8 ignore start -- upstream: SyncedLinearIssue doesn't include completedAt field, so this always uses updatedAt. True branch reserved for future when completedAt is added to sync pipeline @preserve */
      const completionDate = issue.completedAt !== null
        ? new Date(issue.completedAt)
        : new Date(issue.updatedAt);
      /* v8 ignore stop @preserve */

      if (completionDate >= recentCutoff) {
        grouped.done.push(issue);
      } else if (includeArchive) {
        grouped.archive.push(issue);
      }
    } else {
      grouped[column].push(issue);
    }
  }

  // Sort each column by updatedAt (most recent first)
  const sortByUpdated = (a: LinearIssue, b: LinearIssue): number =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  grouped.todo.sort(sortByUpdated);
  grouped.backlog.sort(sortByUpdated);
  grouped.in_progress.sort(sortByUpdated);
  grouped.in_review.sort(sortByUpdated);
  grouped.to_test.sort(sortByUpdated);
  grouped.done.sort(sortByUpdated);
  grouped.archive.sort(sortByUpdated);

  logger?.info(
    {
      userId,
      todo: grouped.todo.length,
      backlog: grouped.backlog.length,
      in_progress: grouped.in_progress.length,
      in_review: grouped.in_review.length,
      to_test: grouped.to_test.length,
      done: grouped.done.length,
      archive: grouped.archive.length,
    },
    'Issues grouped by column'
  );

  return ok({
    issues: grouped,
    teamName: connection.teamName,
  });
}
