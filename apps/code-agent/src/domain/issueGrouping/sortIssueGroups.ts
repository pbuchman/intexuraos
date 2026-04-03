/**
 * Sorting functions for issue groups.
 * Ported from apps/web/src/utils/issueGroups.ts lines 34-44, 417-482.
 */

import type { IssueGroup, SortOption } from './types.js';

const LINEAR_ID_REGEX = /\w+-(\d+)/;

export function parseLinearIssueNumber(id: string): number | null {
  const match = LINEAR_ID_REGEX.exec(id);
  if (match === null) {
    return null;
  }
  const num = match[1];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard -- capture group 1 always defined when LINEAR_ID_REGEX matches @preserve */
  if (num === undefined) {
    return null;
  }
  /* v8 ignore stop @preserve */
  return Number(num);
}

/** Comparator for pr-number sort. Exported for direct testing. */
export function comparePrNumber(a: IssueGroup, b: IssueGroup): number {
  const aNum = a.pipeline.pr !== null ? Number(a.pipeline.pr.number) : null;
  const bNum = b.pipeline.pr !== null ? Number(b.pipeline.pr.number) : null;

  // Both have PR: sort desc
  if (aNum !== null && bNum !== null) return bNum - aNum;
  // Only one has PR: the one with PR sorts first
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  // Neither has PR: fall back to updatedAt desc
  return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
}

/** Comparator for started-time sort. Exported for direct testing. */
export function compareStartedTime(a: IssueGroup, b: IssueGroup): number {
  const aDispatched = a.mostRecentDispatchedAt;
  const bDispatched = b.mostRecentDispatchedAt;

  // Both have dispatchedAt: sort desc
  if (aDispatched !== undefined && bDispatched !== undefined) {
    return bDispatched.localeCompare(aDispatched);
  }
  // Only one has dispatchedAt: the one with dispatchedAt sorts first
  if (aDispatched !== undefined) return -1;
  if (bDispatched !== undefined) return 1;
  // Neither has dispatchedAt: fall back to createdAt desc
  return b.latestTask.createdAt.localeCompare(a.latestTask.createdAt);
}

export function sortIssueGroups(groups: IssueGroup[], sortBy: SortOption): IssueGroup[] {
  const sorted = [...groups];

  if (sortBy === 'linear-id') {
    // Sort by Linear issue number descending; standalone (null linearIssueId) groups sort first.
    sorted.sort((a, b) => {
      const aNum = a.linearIssueId !== null ? parseLinearIssueNumber(a.linearIssueId) : null;
      const bNum = b.linearIssueId !== null ? parseLinearIssueNumber(b.linearIssueId) : null;

      if (aNum === null && bNum === null) {
        return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
      }
      if (aNum === null) return -1;
      if (bNum === null) return 1;
      if (aNum !== bNum) return bNum - aNum;
      return b.latestTask.updatedAt.localeCompare(a.latestTask.updatedAt);
    });
    return sorted;
  }

  if (sortBy === 'pr-number') {
    sorted.sort(comparePrNumber);
    return sorted;
  }

  // created-time: sort by createdAt desc
  if (sortBy === 'created-time') {
    sorted.sort((a, b) => b.latestTask.createdAt.localeCompare(a.latestTask.createdAt));
    return sorted;
  }

  // started-time (final variant): sort by most recent dispatchedAt desc
  sorted.sort(compareStartedTime);
  return sorted;
}
