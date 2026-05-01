// prompt-version-exempt: pending migration to PromptBuilder (INT-1533 Task 2)
import type { CompletionAgentType } from '../completion-verifier.js';
import { getLast50Lines } from '../completion-verifier.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { Task, TaskResult } from '../../types/task.js';
import type { Logger } from '@intexuraos/common-core';

export const FATAL_EXIT_CODE_PREFIX = 'fatal_exit_code_';

export const INACTIVITY_RESTART_PROMPT = `Your previous session became unresponsive (no output for 10 minutes) and was terminated.
Continue working on the task from where you left off. Review your progress so far and
resume the next incomplete step.`;

export function getTaskEventUrl(webhookUrl: string): string {
  return webhookUrl.replace('/internal/webhooks/task-complete', '/internal/webhooks/task-event');
}

export function hasFatalExitCodeField(missingFields: string[]): string | undefined {
  return missingFields.find((f) => f.startsWith(FATAL_EXIT_CODE_PREFIX));
}

/**
 * [INT-1470] Deliverable-only resume prompt. Telemetry-only misses
 * (`memory_ids_used` / `memory_ids_rejected` / `memory_acknowledgment`) are
 * now accepted with `telemetryAccepted: true` rather than retried, so this
 * prompt only needs to cover deliverable misses (`outcome`, `pr`, `summary`,
 * `linear_issue`, `plan_pr`, etc.). The removed telemetry branch used to
 * auto-continue the session asking the agent to re-emit memory fields it
 * had already either emitted or skipped — a no-op in practice.
 */
export function buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string,
  _executionMemoryContext?: ExecutionMemoryPromptContext // @allow-undefined-type -- signature preserved for caller compat; telemetry branch removed so context is unused
): string {
  const transcript = getLast50Lines(rawLogs);

  return [
    '[AUTO-CONTINUE ATTEMPT]',
    'Your last response was missing required fields for the completion verifier.',
    '',
    `Missing fields: ${missingFields.join(', ')}`,
    '',
    'Please ensure your final message includes all required information.',
    `Agent type: ${agentType}`,
    '',
    'Last 50 lines of transcript for reference:',
    transcript,
    '',
    'Constraints:',
    '- Do not restart from scratch.',
    '- Continue from current repository/worktree state.',
  ].join('\n');
}

export function buildResumePreamble(task?: Task): string {
  const prViewCommand =
    task?.continuationPrNumber !== undefined
      ? `gh pr view ${String(task.continuationPrNumber)} --json state,mergedAt,number 2>/dev/null || echo "NO_PR"`
      : 'gh pr view --json state,mergedAt,number 2>/dev/null || echo "NO_PR"';

  const openInstructions =
    task?.continuationPrBranch !== undefined
      ? {
          lines: [
            'If PR is OPEN:',
            '  1. Continue on current local branch normally',
            `  2. Push updates with: git push origin HEAD:${task.continuationPrBranch}`,
            '  3. Check for unaddressed PR comments:',
          ],
          finalStep: '  4. If the message below references a PR comment or review, address it',
        }
      : {
          lines: [
            'If PR is OPEN:',
            '  1. Continue on current branch normally',
            '  2. Check for unaddressed PR comments:',
          ],
          finalStep: '  3. If the message below references a PR comment or review, address it',
        };

  return [
    '[RESUME PRE-FLIGHT — MANDATORY]',
    'Before making ANY changes, check your PR state:',
    `  ${prViewCommand}`,
    '',
    'If PR is MERGED or CLOSED or NO_PR:',
    '  1. git fetch origin',
    '  2. git checkout -b followup/<short-desc> origin/development',
    '  3. After changes → create NEW PR targeting development',
    '  4. Do NOT push to the old branch',
    '',
    ...openInstructions.lines,
    '     gh api /repos/{owner}/{repo}/pulls/{number}/comments --jq "[.[] | select(.user.login != \\"intexuraos-code-worker[bot]\\")] | length"',
    openInstructions.finalStep,
    '---',
    '',
  ].join('\n');
}

export function buildActiveGoalSection(task: Task | undefined, prompt: string): string {
  const preamble = buildResumePreamble(task);
  const goalText = prompt.startsWith(preamble) ? prompt.slice(preamble.length) : prompt;
  return [
    '',
    '',
    '[ACTIVE GOAL — HIGHEST PRIORITY]',
    'A new user message has been received. This is your PRIMARY task.',
    'Complete this goal before doing anything else. If context was compacted,',
    'this section survives and takes absolute priority over conversation history.',
    '',
    goalText,
  ].join('\n');
}

export function parseRebaseResultOutput(
  output: string,
  taskId: string,
  logger: Logger
): TaskResult['rebaseResult'] | undefined {
  try {
    const parsed = JSON.parse(output) as {
      attempted?: boolean;
      success?: boolean;
      conflictFiles?: string[];
    };
    if (parsed.attempted === true && typeof parsed.success === 'boolean') {
      return {
        attempted: parsed.attempted,
        success: parsed.success,
        ...(parsed.conflictFiles !== undefined && { conflictFiles: parsed.conflictFiles }),
      };
    }
    return undefined;
  } catch (parseError) {
    logger.warn({ taskId, error: parseError }, 'Failed to parse rebase result');
    return undefined;
  }
}

export function parseContinuationPrOutput(
  taskId: string,
  prOutput: string,
  logger: Logger
):
  | {
      url?: string;
      number?: number;
      headRefName?: string;
      title?: string;
      state?: string;
      mergedAt?: string | null;
    }
  | undefined {
  try {
    return JSON.parse(prOutput) as {
      url?: string;
      number?: number;
      headRefName?: string;
      title?: string;
      state?: string;
      mergedAt?: string | null;
    };
  } catch {
    logger.warn({ taskId, prOutput }, 'Failed to parse continuation PR output');
    return undefined;
  }
}
