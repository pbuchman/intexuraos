import { describe, expect, it } from 'vitest';
import { classifyFailure, type FailureVerdict } from '../../../domain/utils/classifyFailure.js';

describe('classifyFailure', () => {
  // Infrastructure — always retry
  it.each([
    ['SETUP_FAILED', 'Docker tmpfs mount failed'],
    ['dispatch_failed', 'Worker returned 503'],
    ['queue_timeout', 'Task exceeded queue TTL'],
    ['queue_full', 'Queue capacity exceeded'],
    ['worker_unavailable', 'All worker health probes failed'],
    ['network_error', 'Connection refused'],
  ])('returns "retry" for infrastructure error code "%s"', (code, message) => {
    expect(classifyFailure({ code, message })).toBe('retry' satisfies FailureVerdict);
  });

  // Container crash with OOM/SIGKILL (exit 137)
  it.each([
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 137'],
    ['TASK_FATAL_EXIT_CODE', 'Worker process terminated with signal 137'],
    ['TASK_COMPLETION_VERIFICATION_FAILED', 'fatal_exit_code_137: container killed'],
  ])('returns "retry" for exit-137 pattern in code "%s"', (code, message) => {
    expect(classifyFailure({ code, message })).toBe('retry' satisfies FailureVerdict);
  });

  // Container stopped / Docker issues
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Container returned 409 Conflict'],
    ['RESUME_ATTEMPT_FAILED', 'Docker request timed out after 30s'],
  ])('returns "retry" for Docker transient in code "%s"', (code, message) => {
    expect(classifyFailure({ code, message })).toBe('retry' satisfies FailureVerdict);
  });

  // Rate limit — retry after cooloff
  it('returns "retry_after_cooloff" for 429 rate limit', () => {
    expect(classifyFailure({ code: 'TASK_RESUMED_HARD_ERROR', message: 'API returned 429 Too Many Requests' }))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // AI quality failures — ask the user's configured LLM
  it.each([
    ['EXECUTION_AGENT_ENFORCEMENT_FAILED', 'Missing required output fields'],
    ['PLANNING_AGENT_ENFORCEMENT_FAILED', 'Plan document not found'],
    ['PULL_REQUEST_AGENT_ENFORCEMENT_FAILED', 'PR URL missing from output'],
    ['REVIEW_AGENT_ENFORCEMENT_FAILED', 'Review summary missing'],
  ])('returns "ask_llm" for enforcement code "%s"', (code, message) => {
    expect(classifyFailure({ code, message })).toBe('ask_llm' satisfies FailureVerdict);
  });

  // Exit-code-override: orchestrator ran verifier-pass but worker exited non-zero.
  // Underlying cause is usually transient (git lock, stale container). Always retry.
  it('returns "retry" for TASK_EXIT_CODE_OVERRIDE (regression guard — see fix/auto-retry-exit-code-override)', () => {
    expect(classifyFailure({ code: 'TASK_EXIT_CODE_OVERRIDE', message: 'Non-zero exit code (255) overrides verifier passed decision' }))
      .toBe('retry' satisfies FailureVerdict);
  });

  // Orchestrator remediation hint — honor the orchestrator's retry signal as fallback.
  // Guards against classifier/orchestrator drift when new orchestrator error codes are added.
  it('returns "retry" when remediation.action is "retry" on an otherwise-unknown error code', () => {
    expect(classifyFailure({
      code: 'some_future_orchestrator_error',
      message: 'Transient infra glitch',
      remediation: { action: 'retry' },
    })).toBe('retry' satisfies FailureVerdict);
  });

  // Remediation.action=retry must not override more-specific nuanced verdicts (e.g. cooloff, ask_llm).
  it('prefers specific verdict over remediation.action for rate limit', () => {
    expect(classifyFailure({
      code: 'TASK_RESUMED_HARD_ERROR',
      message: 'API returned 429 Too Many Requests',
      remediation: { action: 'retry' },
    })).toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  it('prefers specific verdict over remediation.action for enforcement failures', () => {
    expect(classifyFailure({
      code: 'EXECUTION_AGENT_ENFORCEMENT_FAILED',
      message: 'Missing fields',
      remediation: { action: 'retry' },
    })).toBe('ask_llm' satisfies FailureVerdict);
  });

  // Permanent failures
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Codex session state not found'],
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 1'],
    ['UNKNOWN_FAILURE', 'Task failed without error details'],
    ['some_new_error', 'Unexpected error'],
  ])('returns "fail" for permanent error code "%s"', (code, message) => {
    expect(classifyFailure({ code, message })).toBe('fail' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with exit 1 AND 429 should be rate limit, not permanent
  it('prioritizes 429 over exit code 1 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure({ code: 'TASK_RESUMED_HARD_ERROR', message: 'exit code: 1 after 429 rate limit' }))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with both exit 137 and 429 should be retry (137 checked first)
  it('prioritizes exit 137 over 429 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure({ code: 'TASK_RESUMED_HARD_ERROR', message: 'exit code: 137 after 429' }))
      .toBe('retry' satisfies FailureVerdict);
  });

  // INT-1454: WORKTREE_LOST is terminal — orchestrator could not repair the
  // worktree metadata and every `git` command in a subsequent attempt would
  // exit 128. Silent infinite retries would burn attempts for no gain.
  it('returns "fail" for WORKTREE_LOST even when orchestrator attaches a retry remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKTREE_LOST',
        message: 'Worktree metadata missing and repair failed for /tmp/worktrees/task-x',
        remediation: { action: 'retry' },
      })
    ).toBe('fail' satisfies FailureVerdict);
  });

  it('returns "fail" for WORKTREE_LOST without remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKTREE_LOST',
        message: 'Worktree metadata missing and repair failed',
      })
    ).toBe('fail' satisfies FailureVerdict);
  });

  // INT-1455: WORKER_INFRA_FAILURE is terminal — the verifier was skipped
  // because the attempt never produced a Claude transcript. Re-running Claude
  // cannot fix container/entrypoint failures.
  it('returns "fail" for WORKER_INFRA_FAILURE even when orchestrator attaches a retry remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKER_INFRA_FAILURE',
        message: 'fatal: not a git repository',
        remediation: { action: 'retry' },
      })
    ).toBe('fail' satisfies FailureVerdict);
  });

  it('returns "fail" for WORKER_INFRA_FAILURE without remediation', () => {
    expect(
      classifyFailure({
        code: 'WORKER_INFRA_FAILURE',
        message: 'fatal: not a git repository',
      })
    ).toBe('fail' satisfies FailureVerdict);
  });
});
