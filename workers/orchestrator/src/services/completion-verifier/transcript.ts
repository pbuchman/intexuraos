import { stripDockerHeaders } from '../log-formatter.js';

const FATAL_EXIT_CODE_PATTERN =
  /\[entrypoint\] (?:Claude|Codex) attempt finished with exit code: (137|139)/;

export const MIN_MEANINGFUL_TRANSCRIPT_LINES = 5;

const INFRASTRUCTURE_LINE_PREFIXES = ['[orchestrator]', '[hook]', '[entrypoint]', '[system]'];

export function countMeaningfulTranscriptLines(nonEmptyLines: readonly string[]): number {
  let count = 0;
  for (const line of nonEmptyLines) {
    if (INFRASTRUCTURE_LINE_PREFIXES.some((p) => line.trim().startsWith(p))) continue;
    count += 1;
  }
  return count;
}

export function detectFatalExitCode(rawLogs: string): number | undefined {
  // Only search last 5 lines to avoid false positives from stream-json fixtures.
  const match = FATAL_EXIT_CODE_PATTERN.exec(rawLogs.split('\n').slice(-5).join('\n'));
  if (match?.[1] !== undefined) return Number(match[1]);
  return undefined;
}

export function getLast50Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-50).join('\n');
}

export function getLast50ClaudeLines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs)
    .split('\n')
    .filter((l) => l.startsWith('[claude]'))
    .slice(-50)
    .join('\n');
}

export function getLast20Lines(rawLogs: string): string {
  return stripDockerHeaders(rawLogs).split('\n').slice(-20).join('\n');
}
