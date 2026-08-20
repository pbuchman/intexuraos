/**
 * Deduplication logic for CodeTask creation.
 *
 * Produces the dedupKey and runs the active dedup checks inside a Firestore
 * transaction so that Firestore's transaction retries re-run the checks.
 */

/* eslint-disable */

import type {
  CollectionReference,
  Transaction as FirestoreTransaction,
} from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../../domain/models/codeTask.js';
import type {
  CreateTaskInput,
  RepositoryError,
} from '../../domain/repositories/codeTaskRepository.js';
import { ACTIVE_TASK_STATUSES, isMergeConflictTaskData } from './task-constants.js';

// Re-export shared symbols for existing importers (back-compat).
export { ACTIVE_TASK_STATUSES, isMergeConflictTaskData };

/** 5-minute window for prompt-based dedup (design line 1544). */
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/** Fetch up to 5 candidates for app-level active-status filtering. */
export const DEDUP_CANDIDATE_LIMIT = 5;

/**
 * Errors that `checkDedupLayers` can return. A strict subset of
 * `RepositoryError` — the dedup-specific codes plus existingTaskId payload.
 */
export type DedupError = Extract<
  RepositoryError,
  | { code: 'DUPLICATE_PROMPT' }
  | { code: 'ACTIVE_TASK_EXISTS' }
>;

/**
 * Compute the dedup key for a task.
 * Normalizes the prompt (trim, collapse whitespace, lowercase) and hashes
 * it alongside the userId (and linearIssueId when present).
 *
 * Design lines 1542-1547.
 */
export function generateDedupKey(
  userId: string,
  prompt: string,
  linearIssueId?: string
): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  // Include linearIssueId when present so the same default prompt
  // ("Implement exactly as described...") produces distinct keys for different issues.
  const input =
    linearIssueId !== undefined ? userId + linearIssueId + normalized : userId + normalized;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Run dedup checks against the code_tasks collection inside a
 * transaction. Returns a DedupError if a duplicate is found, or `null` when
 * creation should proceed.
 *
 * Layer 1: dedupKey within 5-minute window, active status (design 1543-1554).
 *          Skipped for retried tasks or follow-up implementation tasks.
 * Layer 2: active task for same Linear issue, non-review (design 448-458).
 */
export async function checkDedupLayers(
  transaction: FirestoreTransaction,
  collection: CollectionReference,
  input: CreateTaskInput,
  deps: { logger: Logger; dedupKey: string; now: Date; skipPromptDedup?: boolean }
): Promise<Result<null, DedupError>> {
  const { logger, dedupKey, now } = deps;
  const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_MS);

  // Layer 1: dedupKey within 5-minute window
  if (
    input.retriedFrom === undefined &&
    input.followUpReason !== 'execution_implement' &&
    deps.skipPromptDedup !== true
  ) {
    const dedupQuery = collection
      .where('dedupKey', '==', dedupKey)
      .where('createdAt', '>', Timestamp.fromDate(dedupWindowStart))
      .limit(DEDUP_CANDIDATE_LIMIT);
    const dedupSnapshot = await transaction.get(dedupQuery);

    const activeStatuses: readonly string[] = ACTIVE_TASK_STATUSES;
    const activeMatch = dedupSnapshot.docs.find((doc) =>
      activeStatuses.includes(String(doc.data()['status']))
    );
    if (activeMatch !== undefined) {
      logger.info(
        {
          dedupLayer: 1,
          dedupType: 'DUPLICATE_PROMPT',
          existingTaskId: activeMatch.id,
          dedupKey,
        },
        'Dedup triggered: duplicate prompt within 5 minutes'
      );
      return err({
        code: 'DUPLICATE_PROMPT',
        message: 'Duplicate prompt within 5 minutes',
        existingTaskId: activeMatch.id,
      });
    }
  }

  // Layer 2: active task for Linear issue (non-review, non-merge-conflict)
  if (
    input.linearIssueId !== undefined &&
    input.agentType !== 'review' &&
    input.systemPromptHash !== MERGE_CONFLICT_SYSTEM_PROMPT_HASH
  ) {
    const linearQuery = collection
      .where('linearIssueId', '==', input.linearIssueId)
      .where('status', 'in', ACTIVE_TASK_STATUSES);
    const linearSnapshot = await transaction.get(linearQuery);

    for (const existingTask of linearSnapshot.docs) {
      const existingData = existingTask.data();
      if (
        existingData['agentType'] === 'review' ||
        existingData['systemPromptHash'] === MERGE_CONFLICT_SYSTEM_PROMPT_HASH
      ) {
        continue;
      }

      logger.info(
        {
          dedupLayer: 2,
          dedupType: 'ACTIVE_TASK_EXISTS',
          existingTaskId: existingTask.id,
          linearIssueId: input.linearIssueId,
        },
        'Dedup triggered: active task exists for Linear issue'
      );
      return err({
        code: 'ACTIVE_TASK_EXISTS',
        message: 'Active task exists for Linear issue',
        existingTaskId: existingTask.id,
      });
    }
  }

  return ok(null);
}
