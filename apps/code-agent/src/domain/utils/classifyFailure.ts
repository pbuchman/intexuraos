/**
 * Pure failure classifier for task completion errors.
 *
 * Determines whether a task failure is retryable, needs cooloff,
 * should be triaged by a user-selected LLM, or is permanent.
 *
 * This classifies TASK COMPLETION failures (worker ran but failed).
 * Distinct from retryableErrors.ts which classifies DISPATCH failures.
 *
 * INT-1375: Self-healing failure triage.
 */

import type { TaskError } from '../models/codeTask.js';

export type FailureVerdict = 'retry' | 'retry_after_cooloff' | 'ask_llm' | 'fail';

/** Infrastructure error codes that always indicate transient failures. */
const INFRA_RETRY_CODES = new Set([
  'SETUP_FAILED',
  'dispatch_failed',
  'queue_timeout',
  'queue_full',
  'worker_unavailable',
  'network_error',
  // Verifier ran and passed but worker exited non-zero. Root causes observed so
  // far (git lock file, stale container state) are transient. The orchestrator
  // attaches remediation.action=retry; we also match by code for belt-and-suspenders.
  'TASK_EXIT_CODE_OVERRIDE',
]);

export function classifyFailure(error: TaskError): FailureVerdict {
  const { code: errorCode, message: errorMessage, remediation } = error;

  // INT-1454: Worktree metadata was lost on adoption and could not be
  // repaired. The task's in-container state is unrecoverable; silently
  // looping on retries would just repeat exit-128 for every git command.
  // Fail permanently so the UI surfaces it.
  if (errorCode === 'WORKTREE_LOST') {
    return 'fail';
  }

  // INT-1455: Worker infra failure — the container exited before Claude ever
  // ran (git worktree lost, entrypoint crash, image pull failure, etc.).
  // Re-dispatching Claude cannot fix infra; surface it as terminal so users
  // see the real cause instead of a policy-looking "missing fields" message.
  if (errorCode === 'WORKER_INFRA_FAILURE') {
    return 'fail';
  }

  // Infrastructure — always retry
  if (INFRA_RETRY_CODES.has(errorCode)) {
    return 'retry';
  }

  // Container crash — retry if signal kill (OOM/SIGKILL = exit 137).
  // INT-1457: TASK_RUNTIME_HARD_ERROR is the normal-path counterpart to
  // TASK_RESUMED_HARD_ERROR — classify identically.
  if (
    errorCode === 'TASK_RESUMED_HARD_ERROR' ||
    errorCode === 'TASK_FATAL_EXIT_CODE' ||
    errorCode === 'TASK_RUNTIME_HARD_ERROR'
  ) {
    if (errorMessage.includes('137')) {
      return 'retry';
    }
    // Rate limit — retry after cooloff (check AFTER 137 so 137+429 = retry).
    // Claude runtime errors commonly say "Task failed: rate limited" without
    // the 429 substring, so match either form.
    if (/429|rate limit/i.test(errorMessage)) {
      return 'retry_after_cooloff';
    }
  }

  if (errorCode === 'TASK_COMPLETION_VERIFICATION_FAILED' && errorMessage.includes('fatal_exit_code_137')) {
    return 'retry';
  }

  // Container stopped/Docker issues — retry
  if (errorCode === 'RESUME_ATTEMPT_FAILED') {
    if (errorMessage.includes('409') || errorMessage.includes('timed out')) {
      return 'retry';
    }
  }

  // AI quality failures — ask the user's configured LLM
  if (errorCode.endsWith('_ENFORCEMENT_FAILED')) {
    return 'ask_llm';
  }

  // Orchestrator remediation hint — honor it as a fallback before defaulting to fail.
  // The orchestrator has direct context (exit code, verifier result) this classifier
  // only sees via stringified code/message. Guards against drift when new orchestrator
  // error codes are added without a matching classifier branch.
  if (remediation?.action === 'retry') {
    return 'retry';
  }

  // Everything else — permanent failure
  return 'fail';
}
