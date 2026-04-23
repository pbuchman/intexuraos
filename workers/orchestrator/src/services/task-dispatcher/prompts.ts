import type { CompletionAgentType } from '../completion-verifier.js';
import { getLast50Lines } from '../completion-verifier.js';
import type { ExecutionMemoryPromptContext } from '../../types/execution-memory.js';
import type { Task, TaskResult } from '../../types/task.js';
import type { Logger } from '@intexuraos/common-core';

export const FATAL_EXIT_CODE_PREFIX = 'fatal_exit_code_';

export const INACTIVITY_RESTART_PROMPT = `Your previous session became unresponsive (no output for 10 minutes) and was terminated.
Continue working on the task from where you left off. Review your progress so far and
resume the next incomplete step.`;

const MEMORY_FIELDS = [
  'memory_acknowledgment',
  'memory_ids_used_invalid',
  'memory_ids_rejected_invalid',
  'memory_ids_overlap',
  'memory_ids_unaccounted',
  'memory_usage_summary',
  'memory_ids_used',
  'memory_ids_rejected',
];

export function getTaskEventUrl(webhookUrl: string): string {
  return webhookUrl.replace('/internal/webhooks/task-complete', '/internal/webhooks/task-event');
}

export function hasFatalExitCodeField(missingFields: string[]): string | undefined {
  return missingFields.find((f) => f.startsWith(FATAL_EXIT_CODE_PREFIX));
}

export function buildMissingFieldsPrompt(
  agentType: CompletionAgentType,
  missingFields: string[],
  rawLogs: string,
  executionMemoryContext?: ExecutionMemoryPromptContext
): string {
  const transcript = getLast50Lines(rawLogs);
  const hasMemoryFailures = missingFields.some((field) => MEMORY_FIELDS.includes(field));
  const hasAckFailure = missingFields.includes('memory_acknowledgment');

  const triplet = hasMemoryFailures
    ? [
        '',
        'EXECUTION MEMORY REPORTING FAILURE:',
        'You were injected with execution memories but did not properly report their usage.',
        'You MUST include in your final output:',
        '1. memory_ids_used: comma-separated IDs of memories you applied',
        '2. memory_ids_rejected: comma-separated IDs of memories you found irrelevant',
        '3. memory_usage_summary: one sentence about how memories influenced your work',
        'Every injected memory must appear in either used or rejected. No ID may be missing.',
        'If you did not use any memory, put all IDs in memory_ids_rejected.',
      ]
    : [];

  const ackGuidance = hasAckFailure
    ? buildMemoryAcknowledgmentGuidance(executionMemoryContext)
    : [];

  return [
    '[AUTO-CONTINUE ATTEMPT]',
    'Your last response was missing required fields for the completion verifier.',
    '',
    `Missing fields: ${missingFields.join(', ')}`,
    ...ackGuidance,
    ...triplet,
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

function buildMemoryAcknowledgmentGuidance(
  context: ExecutionMemoryPromptContext | undefined // @allow-undefined-type -- function parameter, not optional property
): string[] {
  const idLines =
    context !== undefined && context.matchedMemories.length > 0
      ? [
          'Injected memory IDs you MUST acknowledge (one bullet per ID):',
          ...context.matchedMemories.map(
            (memory, index) =>
              `- [${String(index + 1)}] ${memory.memoryId} — "${memory.title}" — APPLICABLE|NOT APPLICABLE because <one-sentence reason>`
          ),
          '',
        ]
      : [];

  return [
    '',
    'MEMORY ACKNOWLEDGMENT BLOCK MISSING:',
    'The completion verifier requires this exact block, EACH bullet on the start of a new line with no leading characters other than "- ":',
    '',
    '📋 **Execution Memories Received:**',
    'I have received and reviewed <N> execution memories for this task:',
    '- [<n>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because <one-sentence reason>',
    '',
    'Emit the block verbatim BEFORE your final REVIEW_AGENT_FINAL / PLAN_AGENT_FINAL / (etc.) block.',
    'Do NOT inline the bullets as the value of a field — they must be standalone lines that start with "- [".',
    ...idLines,
  ];
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
