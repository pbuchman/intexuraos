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
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Container crash with OOM/SIGKILL (exit 137)
  it.each([
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 137'],
    ['TASK_FATAL_EXIT_CODE', 'Worker process terminated with signal 137'],
    ['TASK_COMPLETION_VERIFICATION_FAILED', 'fatal_exit_code_137: container killed'],
  ])('returns "retry" for exit-137 pattern in code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Container stopped / Docker issues
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Container returned 409 Conflict'],
    ['RESUME_ATTEMPT_FAILED', 'Docker request timed out after 30s'],
  ])('returns "retry" for Docker transient in code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('retry' satisfies FailureVerdict);
  });

  // Rate limit — retry after cooloff
  it('returns "retry_after_cooloff" for 429 rate limit', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'API returned 429 Too Many Requests'))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // AI quality failures — ask the user's configured LLM
  it.each([
    ['EXECUTION_AGENT_ENFORCEMENT_FAILED', 'Missing required output fields'],
    ['PLANNING_AGENT_ENFORCEMENT_FAILED', 'Plan document not found'],
    ['PULL_REQUEST_AGENT_ENFORCEMENT_FAILED', 'PR URL missing from output'],
    ['REVIEW_AGENT_ENFORCEMENT_FAILED', 'Review summary missing'],
  ])('returns "ask_llm" for enforcement code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('ask_llm' satisfies FailureVerdict);
  });

  // Permanent failures
  it.each([
    ['RESUME_ATTEMPT_FAILED', 'Codex session state not found'],
    ['TASK_RESUMED_HARD_ERROR', 'Process exited with exit code: 1'],
    ['UNKNOWN_FAILURE', 'Task failed without error details'],
    ['some_new_error', 'Unexpected error'],
  ])('returns "fail" for permanent error code "%s"', (code, message) => {
    expect(classifyFailure(code, message)).toBe('fail' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with exit 1 AND 429 should be rate limit, not permanent
  it('prioritizes 429 over exit code 1 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'exit code: 1 after 429 rate limit'))
      .toBe('retry_after_cooloff' satisfies FailureVerdict);
  });

  // Edge: TASK_RESUMED_HARD_ERROR with both exit 137 and 429 should be retry (137 checked first)
  it('prioritizes exit 137 over 429 in TASK_RESUMED_HARD_ERROR', () => {
    expect(classifyFailure('TASK_RESUMED_HARD_ERROR', 'exit code: 137 after 429'))
      .toBe('retry' satisfies FailureVerdict);
  });
});
