/**
 * Builds parent-child issue hierarchy from a flat list of synced issues.
 */

import type { LinearIssue, SyncedLinearIssue } from './models.js';
import { syncedToLinearIssue } from './syncedIssueMapper.js';

export interface IssueHierarchy {
  topLevel: LinearIssue[];
  subtasks: LinearIssue[];
  all: LinearIssue[];
}

/**
 * Convert synced issues to LinearIssues and build parent-child relationships.
 *
 * First pass: convert all issues, split into top-level and children
 * Second pass: attach children to parents, update childCount
 */
export function buildIssueHierarchy(syncedIssues: SyncedLinearIssue[]): IssueHierarchy {
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
    /* v8 ignore start -- ts-type: childIssues only contains issues with parentId !== null from first pass, this is defensive narrowing for TypeScript @preserve */
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
  const all = [...topLevelIssues, ...childIssues];

  return { topLevel: topLevelIssues, subtasks: childIssues, all };
}
