/**
 * Shared constants and shape helpers for CodeTask Firestore modules.
 *
 * Lives here (rather than in task-dedup.ts or task-query-builder.ts) so the
 * dedup and query-builder modules can stay independent of each other. Import
 * these from this module in both places.
 */

import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../../domain/models/codeTask.js';

/** Task statuses that still block dedup (everything else is terminal). */
export const ACTIVE_TASK_STATUSES = ['queued', 'dispatched', 'running'] as const;

/** Task statuses representing in-flight worker execution (dispatched or running). */
export const DISPATCHED_OR_RUNNING_STATUSES = ['dispatched', 'running'] as const;

/** Default upper bound for the `listQueued` repository method. */
export const LIST_QUEUED_DEFAULT_LIMIT = 200;

/**
 * Minimal shape accepted from query snapshots. Query snapshots always
 * return populated data — `QueryDocumentSnapshot.data()` is non-nullable
 * in the Firestore type hierarchy, so we mirror that here.
 */
export interface DocLike {
  id: string;
  data(): Record<string, unknown>;
}

/**
 * Whether a task document represents a merge-conflict follow-up.
 * Used to exclude these from dedup/PR-routing queries that should target
 * the canonical task.
 */
export function isMergeConflictTaskData(data: Record<string, unknown>): boolean {
  return (
    data['followUpReason'] === 'merge_conflict' ||
    data['systemPromptHash'] === MERGE_CONFLICT_SYSTEM_PROMPT_HASH
  );
}
