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
  LinearIssueRepository,
} from '../index.js';
import type { GroupedIssues } from '../models.js';
import { buildIssueHierarchy } from '../issueTreeBuilder.js';
import { groupIssuesByDashboardColumn } from '../issueGrouper.js';

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

export interface ListIssuesResponse {
  issues: GroupedIssues;
  teamName: string;
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

  // Build parent-child relationships
  const { all: issues } = buildIssueHierarchy(syncedIssues);
  logger?.info(
    { userId, totalIssues: issues.length },
    'Built parent-child relationships'
  );

  // Group issues by dashboard column
  const grouped = groupIssuesByDashboardColumn(issues, { includeArchive });

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
