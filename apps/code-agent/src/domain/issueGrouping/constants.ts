/**
 * Status sets and labels for issue grouping.
 */

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'dispatched', 'queued']);

export const NON_ARCHIVED_STATUSES = [
  'queued', 'dispatched', 'running', 'planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled',
] as const;

/** Value of `needs_remediation` when the review passed without requiring fixes. */
export const REMEDIATION_NOT_NEEDED = '0';

export const AGENT_TYPE_LABELS: Record<string, string> = {
  planning: 'Planning',
  execution: 'Execution',
  pull_request: 'PR Task',
  review: 'Review',
  remediation: 'Remediation',
  merge: 'Merge',
};
