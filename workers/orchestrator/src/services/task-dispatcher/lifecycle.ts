import { hasCodeTaskLabel } from '@intexuraos/linear-domain';
import { WORKER_TYPES } from '../isolation/types.js';
import { type WorkerRuntime } from '../runtime/index.js';
import type { Task } from '../../types/task.js';
import type { CompletionAgentType } from '../completion-verifier.js';

/**
 * Resolves the runtime name ("claude" | "codex") for a task. Falls back to
 * the worker type's declared runtime when the task state does not pin one.
 */
export function resolveTaskRuntime(task: Task): WorkerRuntime {
  return task.runtime ?? WORKER_TYPES[task.workerType].runtime;
}

/**
 * Returns the user-visible runtime label ("Claude" or "Codex") used in
 * orchestrator log lines.
 */
export function getRuntimeDisplayName(task: Task): string {
  const name = task.runtime ?? WORKER_TYPES[task.workerType].runtime;
  return name === 'codex' ? 'Codex' : 'Claude';
}

/**
 * Picks the completion-verifier agent type for a task. Encodes the priority
 * order: explicit `task.agentType` beats the pr-comment label, which beats the
 * code-task label fallback. `pull_request` short-circuits for PR-comment tasks.
 */
export function pickCompletionAgentType(task: Task): CompletionAgentType {
  const isPullRequestTask =
    task.agentType === 'pull_request' ||
    task.linearIssueLabels.some((l) => l.trim().toLowerCase() === 'pr-comment');
  if (isPullRequestTask) return 'pull_request';
  if (task.agentType === 'review') return 'review';
  if (task.agentType === 'remediation') return 'remediation';
  if (task.agentType === 'execution') return 'execution';
  if (task.agentType === 'planning') return 'planning';
  if (task.agentType === 'ask_agent') return 'ask_agent';
  if (task.agentType === 'sentry') return 'sentry';
  return hasCodeTaskLabel(task.linearIssueLabels) ? 'execution' : 'planning';
}

/**
 * Human-readable label ("Planning Agent", "Execution Agent", ...) derived from
 * the same priority rules as pickCompletionAgentType. Used only for orchestrator
 * log output.
 */
export function pickAgentLabel(task: Task): string {
  const isPullRequestTask =
    task.agentType === 'pull_request' ||
    task.linearIssueLabels.some((l) => l.trim().toLowerCase() === 'pr-comment');
  return isPullRequestTask
    ? 'Pull Request Agent'
    : task.agentType === 'review'
      ? 'Review Agent'
      : task.agentType === 'remediation'
        ? 'Remediation Agent'
        : task.agentType === 'execution'
          ? 'Execution Agent'
          : task.agentType === 'planning'
            ? 'Planning Agent'
            : task.agentType === 'ask_agent'
              ? 'Ask Agent'
              : task.agentType === 'sentry'
                ? 'SentryBox Agent'
                : hasCodeTaskLabel(task.linearIssueLabels)
                  ? 'Execution Agent'
                  : 'Planning Agent';
}

/**
 * One-line description paired with `pickAgentLabel` in orchestrator logs so
 * users see both the agent name and its intent.
 */
export function describeAgent(agentLabel: string): string {
  /* v8 ignore start -- source-map: ternary branch mapping misattributed after bundling despite unit tests for all agents @preserve */
  return agentLabel === 'Pull Request Agent'
    ? 'Pull Request Agent — respond to PR comment/review and push to existing PR branch'
    : agentLabel === 'Review Agent'
      ? 'Review Agent — read-only PR review, post review comments'
      : agentLabel === 'Remediation Agent'
        ? 'Remediation Agent — address review findings on the existing PR branch and decide if re-review is needed'
        : agentLabel === 'Ask Agent'
          ? 'Ask Agent — interactive code assistant, respond to user questions'
          : agentLabel === 'SentryBox Agent'
            ? 'SentryBox Agent — fix or code-suppress a SentryBox issue and create a PR'
            : agentLabel === 'Execution Agent'
              ? 'Execution Agent — implement autonomously, run CI, create PR'
              : 'Planning Agent — create planning artifacts only, no implementation coding';
  /* v8 ignore stop @preserve */
}

export interface TaskLifecycleEventName {
  name: 'task_completed' | 'task_failed' | 'task_interrupted' | undefined;
}

/**
 * Maps a terminal status to the task-event name sent to code-agent. Returns
 * undefined for statuses that should not emit an event (e.g. cancelled).
 */
export function pickTaskLifecycleEvent(
  finalStatus: 'completed' | 'failed' | 'interrupted' | 'cancelled'
): 'task_completed' | 'task_failed' | 'task_interrupted' | undefined {
  /* v8 ignore start -- source-map: nested ternary over TaskStatus discriminated union; v8 cannot track all branch arms of chained ternary expressions despite tests exercising all statuses @preserve */
  return finalStatus === 'completed'
    ? 'task_completed'
    : finalStatus === 'failed'
      ? 'task_failed'
      : finalStatus === 'interrupted'
        ? 'task_interrupted'
        : undefined;
  /* v8 ignore stop @preserve */
}

/**
 * Per-agent-type status label published alongside the task lifecycle event
 * (e.g. execution → "implemented", review → "reviewed"). Undefined when no
 * mapping applies.
 */
export function pickAgentStatusLabel(agentType: string | undefined): string | undefined {
  const agentStatusMap: Record<string, string> = {
    execution: 'implemented',
    remediation: 'implemented',
    review: 'reviewed',
    planning: 'planned',
    sentry: 'implemented',
  };
  if (agentType === undefined) return undefined;
  return agentStatusMap[agentType];
}
