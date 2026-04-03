const AGENT_TYPE_LABELS: Record<string, string> = {
  planning: 'Planning',
  execution: 'Execution',
  pull_request: 'PR Task',
  review: 'Review',
  remediation: 'Remediation',
  merge: 'Merge',
};

export function getAgentTypeLabel(agentType: string): string {
  const label = AGENT_TYPE_LABELS[agentType];
  if (label !== undefined) {
    return label;
  }
  // Capitalize first letter for unknown agent types
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}

// Mirrors packages/common-core/src/labels.ts normalizeLabel — local copy avoids
// barrel import that pulls in node:crypto, breaking jsdom browser tests.
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

/** Value of `needs_remediation` when the review passed without requiring fixes. */
const REMEDIATION_NOT_NEEDED = '0';

/** Labels that gate the Implement button (backward compat includes `code-task`). */
const IMPLEMENTATION_READY_LABELS: ReadonlySet<string> = new Set([
  'ready-to-implement',
  'code-task',
]);

/**
 * Checks if a task's Linear labels indicate it's ready for implementation.
 *
 * Returns true (show Implement button) when:
 * - `ready-to-implement` label exists (new gated behavior)
 * - `code-task` label exists (backward compat for pre-existing planned tasks)
 * - labels are undefined or empty (graceful fallback when Linear hydration fails or issue has no labels)
 *
 * Returns false (hide Implement button) when:
 * - labels array has items but contains neither `ready-to-implement` nor `code-task`
 */
export function hasImplementationReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return true;
  }
  return labels.some((l) => IMPLEMENTATION_READY_LABELS.has(normalizeLabel(l.name)));
}

/**
 * Checks if a task's Linear labels indicate it's ready for merge.
 *
 * Unlike `hasImplementationReadyLabel`, this returns false for undefined/empty labels —
 * the `ready-to-merge` label is set deterministically by the review-outcome handler,
 * so there is no legacy-data fallback needed.
 */
export function hasMergeReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return false;
  }
  return labels.some((l) => normalizeLabel(l.name) === 'ready-to-merge');
}

/**
 * Determines if a single task is merge-ready for the detail view.
 *
 * Covers three cases:
 * 1. An `implemented` task with its own `result.prUrl` and `ready-to-merge` label
 * 2. A `reviewed` task with a `prNumber` and `ready-to-merge` label — the reviewed
 *    task won't have `result.prUrl` but the merge URL can be constructed from
 *    `repository` + `prNumber`.
 * 3. A `reviewed` task with a `prNumber` and `result.needs_remediation === '0'` —
 *    fallback for review tasks / external PRs where the `ready-to-merge` label was
 *    set on the origin task's Linear issue, not the review task's.
 */
export function isTaskMergeable(task: {
  status: string;
  prNumber?: number;
  result?: { prUrl?: string; needs_remediation?: string };
  linearIssue?: { labels: { name: string }[] };
}): boolean {
  const hasLabel = hasMergeReadyLabel(task.linearIssue?.labels);
  const passedReview = task.status === 'reviewed' && task.result?.needs_remediation === REMEDIATION_NOT_NEEDED;

  if (!hasLabel && !passedReview) {
    return false;
  }
  return (
    (task.status === 'implemented' && task.result?.prUrl !== undefined) ||
    (task.status === 'reviewed' && task.prNumber !== undefined)
  );
}

/**
 * Extracts the merge URL for a single task (detail view).
 *
 * Prefers `result.prUrl`; falls back to constructing from `repository` + `prNumber`.
 */
export function getTaskMergeUrl(task: {
  repository: string;
  prNumber?: number;
  result?: { prUrl?: string };
}): string | undefined {
  if (task.result?.prUrl !== undefined) {
    return task.result.prUrl;
  }
  if (task.prNumber !== undefined) {
    return `https://github.com/${task.repository}/pull/${String(task.prNumber)}`;
  }
  return undefined;
}
