/**
 * Pure classifier used before the completion verifier runs.
 *
 * INT-1455 — distinguishes infra-layer failures (container/entrypoint aborted
 * before the runtime ever produced output) from real transcripts that the
 * verifier should grade.
 *
 * INT-1471 — runtime-aware: recognizes Codex session/turn markers so a Codex
 * attempt that failed mid-turn (e.g. usage-limit exit 1) is classified as
 * `ran`, which routes through the normal runtime-hard-error path instead of
 * the terminal WORKER_INFRA_FAILURE path.
 */

import type { WorkerRuntime } from '../runtime/types.js';
import type { InfraFailureSubReason } from '../../types/task.js';

export type { InfraFailureSubReason } from '../../types/task.js';

/** Attempts below this duration are treated as infra failures. Tunable. */
export const INFRA_FAILURE_MAX_DURATION_MS = 5_000;

const FIRST_ERROR_LINE_MAX_LENGTH = 500;

export type AttemptClassification =
  | { outcome: 'ran' }
  | {
      outcome: 'infra_failed';
      subReason: InfraFailureSubReason;
      firstErrorLine: string;
    };

export interface ClassifyAttemptInput {
  runtime: WorkerRuntime;
  logs: string;
  exitCode: number | undefined; // @allow-undefined-type -- orchestrator tracks optional exit codes
  durationMs: number;
  /**
   * Optional structural subset of `TaskResult` from the dispatcher. When the
   * dispatcher already has a successful result (non-empty `prUrl`), we treat
   * the attempt as "ran" regardless of the log-shape heuristics — the worker
   * objectively produced a PR, so any transcript-signal mismatch is noise.
   */
  result?: {
    prUrl?: string | null | undefined; // @allow-undefined-type -- TaskResult.prUrl is optional/nullable
  };
}

function hasClaudeRanSignal(lines: readonly string[]): boolean {
  const hasSessionInit = lines.some((line) => line.includes('[claude] Session init'));
  const hasClaudeOrToolLine = lines.some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('[claude]') || trimmed.startsWith('[tool]');
  });
  const hasStreamJsonInit = lines.some(
    (line) => line.includes('"type":"system"') && line.includes('"subtype":"init"')
  );
  const hasAssistantEvent = lines.some(
    (line) => line.includes('"type":"assistant"') || line.includes('"type":"tool_use"')
  );
  return hasSessionInit || hasClaudeOrToolLine || hasStreamJsonInit || hasAssistantEvent;
}

function hasCodexRanSignal(lines: readonly string[]): boolean {
  // Mirrors the markers emitted by workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts
  // and the raw JSON events produced by `codex exec --json` (thread.started,
  // turn.started). Any of these proves Codex authenticated and began a turn,
  // so a later non-zero exit (e.g. turn.failed from a usage-limit) must flow
  // through the runtime-hard-error path, not infra_failed.
  const hasCodexPrefix = lines.some((line) => {
    const trimmed = line.trimStart();
    return (
      trimmed.startsWith('[codex]') || trimmed.startsWith('[msg]') || trimmed.startsWith('[cmd]')
    );
  });
  const hasThreadStarted = lines.some((line) => line.includes('"type":"thread.started"'));
  const hasTurnStarted = lines.some((line) => line.includes('"type":"turn.started"'));
  const hasTurnCompleted = lines.some((line) => line.includes('"type":"turn.completed"'));
  const hasTurnFailed = lines.some((line) => line.includes('"type":"turn.failed"'));
  return hasCodexPrefix || hasThreadStarted || hasTurnStarted || hasTurnCompleted || hasTurnFailed;
}

export function classifyAttempt(input: ClassifyAttemptInput): AttemptClassification {
  const { runtime, logs, exitCode, durationMs, result } = input;

  // Short-circuit: if the dispatcher already captured a successful TaskResult
  // (non-empty `prUrl`), the attempt must be classified as "ran" regardless
  // of transcript-signal heuristics. This guards against future log-shape
  // drift where `getWorkerLogs()` output changes and the signals below go
  // stale — the PR URL is the ground truth for "agent produced output".
  const prUrl = result?.prUrl;
  if (prUrl !== undefined && prUrl !== null && prUrl !== '') {
    return { outcome: 'ran' };
  }

  const lines = logs.split('\n');

  const ran = runtime === 'codex' ? hasCodexRanSignal(lines) : hasClaudeRanSignal(lines);
  if (ran) {
    return { outcome: 'ran' };
  }

  if (exitCode !== undefined && exitCode !== 0) {
    return {
      outcome: 'infra_failed',
      subReason: 'container_exit_before_session_init',
      firstErrorLine: pickFirstErrorLine(lines, exitCode),
    };
  }

  if (durationMs < INFRA_FAILURE_MAX_DURATION_MS) {
    return {
      outcome: 'infra_failed',
      subReason: 'duration_below_threshold',
      firstErrorLine: pickFirstErrorLine(lines, exitCode),
    };
  }

  return {
    outcome: 'infra_failed',
    subReason: 'empty_transcript',
    firstErrorLine: pickFirstErrorLine(lines, exitCode),
  };
}

function pickFirstErrorLine(lines: readonly string[], exitCode: number | undefined): string {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^(fatal:|error:|panic:)/i.test(line)) {
      return truncate(line);
    }
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return `Container exited with code ${String(exitCode)} before producing agent output`;
  }
  return 'Attempt produced no agent or tool output';
}

function truncate(line: string): string {
  if (line.length <= FIRST_ERROR_LINE_MAX_LENGTH) return line;
  return line.slice(0, FIRST_ERROR_LINE_MAX_LENGTH);
}
