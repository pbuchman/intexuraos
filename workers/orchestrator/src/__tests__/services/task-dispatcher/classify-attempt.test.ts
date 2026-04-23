import { describe, expect, it } from 'vitest';
import {
  classifyAttempt,
  INFRA_FAILURE_MAX_DURATION_MS,
} from '../../../services/task-dispatcher/classify-attempt.js';

const sessionInit =
  '[claude] Session init: model=claude-sonnet-4-6 tools=3 mode=bypassPermissions v2.1.41';

describe('classifyAttempt', () => {
  it('returns "ran" when Claude emitted a Session init line (exit 0)', () => {
    const logs = `${sessionInit}\n[claude] Hello world\n`;
    expect(classifyAttempt({ logs, exitCode: 0, durationMs: 60_000 })).toEqual({ outcome: 'ran' });
  });

  it('returns "ran" when Claude emitted a Session init line even with non-zero exit', () => {
    const logs = `${sessionInit}\n[claude] partial output\n`;
    expect(classifyAttempt({ logs, exitCode: 1, durationMs: 60_000 })).toEqual({ outcome: 'ran' });
  });

  it('returns infra_failed with container_exit_before_session_init when exitCode != 0 and no Session init', () => {
    const logs = '[entrypoint] starting run-attempt\nfatal: not a git repository\n';
    const result = classifyAttempt({ logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toContain('fatal: not a git repository');
  });

  it('returns infra_failed with duration_below_threshold when duration < threshold and no transcript lines', () => {
    const result = classifyAttempt({ logs: '', exitCode: 0, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('duration_below_threshold');
  });

  it('duration threshold is exactly 5s (INFRA_FAILURE_MAX_DURATION_MS)', () => {
    expect(INFRA_FAILURE_MAX_DURATION_MS).toBe(5_000);
    const atThreshold = classifyAttempt({
      logs: '',
      exitCode: 0,
      durationMs: INFRA_FAILURE_MAX_DURATION_MS,
    });
    expect(atThreshold.outcome).toBe('infra_failed');
    if (atThreshold.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(atThreshold.subReason).toBe('empty_transcript');
  });

  it('returns infra_failed with empty_transcript when no [claude]/[tool] lines and duration >= threshold', () => {
    const logs = '[orchestrator] starting\n[entrypoint] ready\n';
    const result = classifyAttempt({ logs, exitCode: 0, durationMs: 30_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('empty_transcript');
  });

  it('returns ran when a [tool] line appears (no session init, but Claude is producing tool events)', () => {
    const logs = '[tool] Read file=/repo/README.md\n';
    expect(classifyAttempt({ logs, exitCode: 0, durationMs: 30_000 })).toEqual({ outcome: 'ran' });
  });

  it('firstErrorLine is truncated to 500 chars', () => {
    const longError = 'fatal: ' + 'x'.repeat(600);
    const logs = `[entrypoint] booting\n${longError}\n`;
    const result = classifyAttempt({ logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.firstErrorLine.length).toBeLessThanOrEqual(500);
    expect(result.firstErrorLine).toContain('fatal: ');
  });

  it('falls back to a generic firstErrorLine when no obvious error line exists', () => {
    const result = classifyAttempt({ logs: '', exitCode: 128, durationMs: 100 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toBe(
      'Container exited with code 128 before producing Claude output'
    );
  });
});
