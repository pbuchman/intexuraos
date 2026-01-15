/**
 * List Issues Use Case
 *
 * Fetches Linear issues and groups them for dashboard display.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearError,
  LinearApiClient,
  LinearConnectionRepository,
  LinearIssue,
} from '../index.js';
import { mapStateToDashboardColumn } from '../models.js';

export interface ListIssuesDeps {
  linearApiClient: LinearApiClient;
  connectionRepository: LinearConnectionRepository;
  logger?: Logger;
}

export interface ListIssuesRequest {
  userId: string;
  /** Include archived (old completed) issues */
  includeArchive?: boolean;
}

export interface GroupedIssues {
  backlog: LinearIssue[];
  in_progress: LinearIssue[];
  in_review: LinearIssue[];
  done: LinearIssue[];
  archive: LinearIssue[];
}

export interface ListIssuesResponse {
  issues: GroupedIssues;
  teamName: string;
}

const DONE_RECENT_DAYS = 7;

export async function listIssues(
  request: ListIssuesRequest,
  deps: ListIssuesDeps
): Promise<Result<ListIssuesResponse, LinearError>> {
  const { userId, includeArchive = true } = request;
  const { linearApiClient, connectionRepository, logger } = deps;

  logger?.info({ userId, includeArchive }, 'listIssues: entry');

  // Get user's connection
  const connectionResult = await connectionRepository.getFullConnection(userId);
  if (!connectionResult.ok) {
    return err(connectionResult.error);
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'Linear not connected' });
  }

  // Fetch issues - get more days for archive
  const fetchDays = includeArchive ? 30 : DONE_RECENT_DAYS;
  const issuesResult = await linearApiClient.listIssues(connection.apiKey, connection.teamId, {
    completedSinceDays: fetchDays,
  });

  if (!issuesResult.ok) {
    return err(issuesResult.error);
  }

  const issues = issuesResult.value;
  logger?.info({ userId, totalIssues: issues.length }, 'Fetched issues');

  // Group issues by dashboard column
  const grouped: GroupedIssues = {
    backlog: [],
    in_progress: [],
    in_review: [],
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
      if (issue.completedAt !== null) {
        const completedDate = new Date(issue.completedAt);
        if (completedDate >= recentCutoff) {
          grouped.done.push(issue);
        } else if (includeArchive) {
          grouped.archive.push(issue);
        }
      } else {
        // No completedAt but in done state - treat as recent
        grouped.done.push(issue);
      }
    } else {
      grouped[column].push(issue);
    }
  }

  // Sort each column by updatedAt (most recent first)
  const sortByUpdated = (a: LinearIssue, b: LinearIssue): number =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  grouped.backlog.sort(sortByUpdated);
  grouped.in_progress.sort(sortByUpdated);
  grouped.in_review.sort(sortByUpdated);
  grouped.done.sort(sortByUpdated);
  grouped.archive.sort(sortByUpdated);

  logger?.info(
    {
      userId,
      backlog: grouped.backlog.length,
      in_progress: grouped.in_progress.length,
      in_review: grouped.in_review.length,
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
