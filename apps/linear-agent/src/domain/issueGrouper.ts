/**
 * Groups issues by dashboard column with date-based archive logic.
 */

import type { LinearIssue } from './models.js';
import { mapStateToDashboardColumn, type GroupedIssues } from './models.js';

export const DONE_RECENT_DAYS = 7;

export interface GroupIssuesOptions {
  includeArchive?: boolean;
  doneDays?: number;
}

/**
 * Group issues by dashboard column and sort by updatedAt descending.
 *
 * Issues in 'done' column are split between 'done' (recent) and 'archive' (old)
 * based on the DONE_RECENT_DAYS cutoff unless includeArchive=false.
 */
export function groupIssuesByDashboardColumn(
  issues: LinearIssue[],
  options: GroupIssuesOptions
): GroupedIssues {
  const { includeArchive = true, doneDays = DONE_RECENT_DAYS } = options;

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
  recentCutoff.setDate(now.getDate() - doneDays);

  for (const issue of issues) {
    const column = mapStateToDashboardColumn(issue.state.type, issue.state.name);

    if (column === 'done') {
      // Use updatedAt as proxy for completion time since completedAt is always null
      // for SyncedLinearIssue (completedAt would require changes to sync pipeline)
      const completionDate = new Date(issue.updatedAt);

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

  return grouped;
}
