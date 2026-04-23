/**
 * Pure classifier used before the completion verifier runs.
 *
 * INT-1455 — distinguishes infra-layer failures (container/entrypoint aborted
 * before Claude ever produced output) from real Claude transcripts that the
 * verifier should grade. Short-circuiting infra failures keeps the verifier's
 * "missing memory fields" error reserved for actual transcript defects.
 */

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
  logs: string;
  exitCode: number | undefined; // @allow-undefined-type -- orchestrator tracks optional exit codes
  durationMs: number;
}

export function classifyAttempt(input: ClassifyAttemptInput): AttemptClassification {
  const { logs, exitCode, durationMs } = input;
  const lines = logs.split('\n');

  // Detection signals for "Claude actually ran". The raw `getWorkerLogs()`
  // stream returned by `isolation/worker-ops` is (a) Docker container stdout
  // with RFC3339 timestamps and (b) the orchestrator's `attemptLogBuffer` —
  // which is the raw stdout of `claude --print --output-format stream-json`.
  // Neither source contains the `[claude]`/`[tool]` prefixes; those are added
  // by the in-process `claude-log-processor` and pushed to Firestore AFTER
  // `getWorkerLogs()` has already returned. So the load-bearing signals here
  // are `hasStreamJsonInit` and `hasAssistantEvent`, which detect the raw
  // stream-JSON events the container actually emits. The `[claude]`/`[tool]`
  // checks remain as belt-and-suspenders in case formatted output ever leaks
  // back into `getWorkerLogs()` (e.g. if attemptLogBuffer wiring changes).
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

  if (hasSessionInit || hasClaudeOrToolLine || hasStreamJsonInit || hasAssistantEvent) {
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
    return `Container exited with code ${String(exitCode)} before producing Claude output`;
  }
  return 'Attempt produced no Claude or tool output';
}

function truncate(line: string): string {
  if (line.length <= FIRST_ERROR_LINE_MAX_LENGTH) return line;
  return line.slice(0, FIRST_ERROR_LINE_MAX_LENGTH);
}
