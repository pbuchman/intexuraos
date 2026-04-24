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
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 60_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns "ran" when Claude emitted a Session init line even with non-zero exit', () => {
    const logs = `${sessionInit}\n[claude] partial output\n`;
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 1, durationMs: 60_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns infra_failed with container_exit_before_session_init when exitCode != 0 and no Session init', () => {
    const logs = '[entrypoint] starting run-attempt\nfatal: not a git repository\n';
    const result = classifyAttempt({ runtime: 'claude', logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toContain('fatal: not a git repository');
  });

  it('returns infra_failed with duration_below_threshold when duration < threshold and no transcript lines', () => {
    const result = classifyAttempt({ runtime: 'claude', logs: '', exitCode: 0, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('duration_below_threshold');
  });

  it('duration threshold is exactly 5s (INFRA_FAILURE_MAX_DURATION_MS)', () => {
    expect(INFRA_FAILURE_MAX_DURATION_MS).toBe(5_000);
    const atThreshold = classifyAttempt({
      runtime: 'claude',
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
    const result = classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 30_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('empty_transcript');
  });

  it('returns ran when a [tool] line appears (no session init, but Claude is producing tool events)', () => {
    const logs = '[tool] Read file=/repo/README.md\n';
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 30_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns ran when logs contain a stream-JSON system init event (no [claude] prefix)', () => {
    const logs =
      '2026-04-23T20:38:46.971Z {"type":"system","subtype":"init","session_id":"abc","tools":[{"name":"Read"}],"model":"claude-sonnet-4-6"}\n';
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 60_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns ran when logs contain a stream-JSON assistant event alone', () => {
    const logs =
      '2026-04-23T20:39:06.934Z {"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}\n';
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 60_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns ran when a TaskResult with prUrl is present, even if transcript signals are missing', () => {
    expect(
      classifyAttempt({
        runtime: 'claude',
        logs: '',
        exitCode: 0,
        durationMs: 60_000,
        result: { prUrl: 'https://github.com/org/repo/pull/1' },
      })
    ).toEqual({ outcome: 'ran' });
  });

  it('does not short-circuit when result.prUrl is null — falls through to heuristics', () => {
    const res = classifyAttempt({
      runtime: 'claude',
      logs: '',
      exitCode: 0,
      durationMs: 1_000,
      result: { prUrl: null },
    });
    expect(res.outcome).toBe('infra_failed');
    if (res.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(res.subReason).toBe('duration_below_threshold');
  });

  it("does not short-circuit when result.prUrl is '' — falls through to heuristics", () => {
    const res = classifyAttempt({
      runtime: 'claude',
      logs: '',
      exitCode: 0,
      durationMs: 1_000,
      result: { prUrl: '' },
    });
    expect(res.outcome).toBe('infra_failed');
    if (res.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(res.subReason).toBe('duration_below_threshold');
  });

  it('returns ran when a tool_use stream-JSON event is present without any other Claude signals', () => {
    const logs = '{"type":"tool_use","id":"abc","name":"Read","input":{}}';
    expect(classifyAttempt({ runtime: 'claude', logs, exitCode: 0, durationMs: 30_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('firstErrorLine is truncated to 500 chars', () => {
    const longError = 'fatal: ' + 'x'.repeat(600);
    const logs = `[entrypoint] booting\n${longError}\n`;
    const result = classifyAttempt({ runtime: 'claude', logs, exitCode: 128, durationMs: 1_000 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.firstErrorLine.length).toBeLessThanOrEqual(500);
    expect(result.firstErrorLine).toContain('fatal: ');
  });

  it('falls back to a generic firstErrorLine when no obvious error line exists', () => {
    const result = classifyAttempt({ runtime: 'claude', logs: '', exitCode: 128, durationMs: 100 });
    expect(result.outcome).toBe('infra_failed');
    if (result.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(result.subReason).toBe('container_exit_before_session_init');
    expect(result.firstErrorLine).toBe(
      'Container exited with code 128 before producing agent output'
    );
  });

  it('returns "ran" when a Codex attempt emitted a thread.started event (exit 1 from rate limit)', () => {
    const logs =
      '[entrypoint] GitHub token loaded and git credential configured\n' +
      '[codex] Session started: thread=019dc00d-fb13-7e30-b21d-a77982c54bab\n' +
      '[codex] Turn started\n' +
      "[error] You've hit your usage limit.\n" +
      '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}\n' +
      '[entrypoint] Codex attempt finished with exit code: 1\n';
    expect(classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 4_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns "ran" when Codex logs contain only a stream-JSON thread.started event', () => {
    const logs = '2026-04-24T17:13:54.013Z {"type":"thread.started","thread_id":"t-1"}\n';
    expect(classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 3_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('returns "ran" when Codex logs contain a turn.started event', () => {
    const logs = '{"type":"turn.started"}\n';
    expect(classifyAttempt({ runtime: 'codex', logs, exitCode: 1, durationMs: 3_000 })).toEqual({
      outcome: 'ran',
    });
  });

  it('uses runtime-agnostic wording in the generic fallback firstErrorLine', () => {
    const claudeResult = classifyAttempt({
      runtime: 'claude',
      logs: '',
      exitCode: 128,
      durationMs: 100,
    });
    expect(claudeResult.outcome).toBe('infra_failed');
    if (claudeResult.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(claudeResult.firstErrorLine).toBe(
      'Container exited with code 128 before producing agent output'
    );

    const codexResult = classifyAttempt({
      runtime: 'codex',
      logs: '',
      exitCode: 1,
      durationMs: 100,
    });
    expect(codexResult.outcome).toBe('infra_failed');
    if (codexResult.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(codexResult.firstErrorLine).toBe(
      'Container exited with code 1 before producing agent output'
    );
  });

  it('claude runtime still treats codex-only signals as NOT ran (runtime is honored, not just any JSON)', () => {
    // Defensive: a stray `thread.started` in claude logs (unexpected) must not be
    // treated as a claude attempt having run — the runtime param is load-bearing.
    const logs = '{"type":"thread.started","thread_id":"x"}\n';
    const res = classifyAttempt({ runtime: 'claude', logs, exitCode: 1, durationMs: 1_000 });
    expect(res.outcome).toBe('infra_failed');
    if (res.outcome !== 'infra_failed') throw new Error('type narrowing');
    expect(res.subReason).toBe('container_exit_before_session_init');
  });
});
