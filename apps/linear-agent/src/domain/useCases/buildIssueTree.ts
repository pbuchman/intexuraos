/**
 * Builds a hierarchical tree structure from a flat list of synced Linear issues.
 */

import type { SyncedLinearIssue } from '../models.js';

/**
 * Build a tree structure from a flat list of issues.
 * Returns the root issue and all recursive descendants, or null if root not found.
 */
export function buildIssueTree(
  allIssues: SyncedLinearIssue[],
  rootId: string
): { root: SyncedLinearIssue; descendants: SyncedLinearIssue[] } | null {
  const root = allIssues.find((issue) => issue.id === rootId);
  if (root === undefined) return null;

  const byParent = new Map<string, SyncedLinearIssue[]>();
  for (const issue of allIssues) {
    if (issue.parentId === null) continue;
    const list = byParent.get(issue.parentId) ?? [];
    list.push(issue);
    byParent.set(issue.parentId, list);
  }

  const descendants: SyncedLinearIssue[] = [];
  let queueItem = byParent.get(root.id) ?? [];
  while (queueItem.length > 0) {
    const nextBatch = queueItem;
    queueItem = [];
    for (const node of nextBatch) {
      descendants.push(node);
      const children = byParent.get(node.id);
      if (children !== undefined) queueItem.push(...children);
    }
  }

  return { root, descendants };
}
