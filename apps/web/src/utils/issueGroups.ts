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
 * Requires the `ready-to-merge` label on the task's Linear issue. This
 * naturally distinguishes execution-origin reviews (label set by webhook)
 * from planning-origin reviews (no label set after INT-1255).
 *
 * Covers two cases:
 * 1. An `implemented` task with its own `result.prUrl` and `ready-to-merge` label
 * 2. A `reviewed` task with a `prNumber` and `ready-to-merge` label
 *
 * Note: if the review task's Linear issue differs from the origin's (rare),
 * merge won't show on the detail page — the list view pipeline is authoritative.
 */
export function isTaskMergeable(task: {
  status: string;
  prNumber?: number;
  result?: { prUrl?: string; needs_remediation?: string };
  linearIssue?: { labels: { name: string }[] };
}): boolean {
  // Merge eligibility requires the ready-to-merge label on the Linear issue.
  // After the planning-origin review fix (INT-1255), only execution-origin
  // reviews get this label — planning-origin reviews intentionally do not,
  // so merge does not appear on their detail page.
  if (!hasMergeReadyLabel(task.linearIssue?.labels)) {
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
