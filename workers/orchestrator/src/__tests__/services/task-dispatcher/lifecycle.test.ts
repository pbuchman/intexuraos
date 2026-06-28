import { describe, it, expect } from 'vitest';
import {
  resolveTaskRuntime,
  getRuntimeDisplayName,
  pickCompletionAgentType,
  pickAgentLabel,
  describeAgent,
  pickTaskLifecycleEvent,
  pickAgentStatusLabel,
} from '../../../services/task-dispatcher/lifecycle.js';
import type { Task } from '../../../types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    workerType: 'sonnet' as Task['workerType'],
    prompt: 'do work',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    webhookUrl: 'https://example.test/webhook',
    webhookSecret: 'secret',
    status: 'running',
    worktreePath: '/tmp/wt',
    containerId: 'container-1',
    linearIssueLabels: [],
    startedAt: new Date(0).toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    verificationHistory: [],
    ...overrides,
  };
}

describe('resolveTaskRuntime', () => {
  it('prefers task.runtime when pinned', () => {
    expect(resolveTaskRuntime(makeTask({ runtime: 'codex' }))).toBe('codex');
  });

  it('falls back to the worker type when runtime is absent', () => {
    const task = makeTask();
    delete task.runtime;
    expect(resolveTaskRuntime(task)).toBe('claude');
  });
});

describe('getRuntimeDisplayName', () => {
  it('returns "Codex" for codex runtime', () => {
    expect(getRuntimeDisplayName(makeTask({ runtime: 'codex' }))).toBe('Codex');
  });
  it('returns "Claude" for claude runtime', () => {
    expect(getRuntimeDisplayName(makeTask({ runtime: 'claude' }))).toBe('Claude');
  });
  it('falls back to the worker type runtime when task.runtime is absent', () => {
    const task = makeTask();
    delete task.runtime;
    expect(getRuntimeDisplayName(task)).toBe('Claude');
  });
});

describe('pickCompletionAgentType', () => {
  it('maps pull_request agentType to "pull_request"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'pull_request' }))).toBe('pull_request');
  });
  it('maps the pr-comment Linear label to "pull_request" even without agentType', () => {
    const task = makeTask({ linearIssueLabels: ['PR-Comment'] });
    delete task.agentType;
    expect(pickCompletionAgentType(task)).toBe('pull_request');
  });
  it('maps review agentType to "review"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'review' }))).toBe('review');
  });
  it('maps remediation agentType to "remediation"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'remediation' }))).toBe('remediation');
  });
  it('maps execution agentType to "execution"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'execution' }))).toBe('execution');
  });
  it('maps planning agentType to "planning"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'planning' }))).toBe('planning');
  });
  it('maps ask_agent agentType to "ask_agent"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'ask_agent' }))).toBe('ask_agent');
  });
  it('maps sentry agentType to "sentry"', () => {
    expect(pickCompletionAgentType(makeTask({ agentType: 'sentry' }))).toBe('sentry');
  });
  it('falls back to "execution" when the task has the code-task label', () => {
    const task = makeTask({ linearIssueLabels: ['code-task'] });
    delete task.agentType;
    expect(pickCompletionAgentType(task)).toBe('execution');
  });
  it('falls back to "planning" when no agent signals are present', () => {
    const task = makeTask();
    delete task.agentType;
    expect(pickCompletionAgentType(task)).toBe('planning');
  });
});

describe('pickAgentLabel', () => {
  it('returns "Pull Request Agent" for pr-comment tasks', () => {
    const task = makeTask({ linearIssueLabels: ['pr-comment'] });
    delete task.agentType;
    expect(pickAgentLabel(task)).toBe('Pull Request Agent');
  });
  it('returns "Pull Request Agent" when agentType is pull_request', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'pull_request' }))).toBe('Pull Request Agent');
  });
  it('returns "Review Agent" for review tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'review' }))).toBe('Review Agent');
  });
  it('returns "Remediation Agent" for remediation tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'remediation' }))).toBe('Remediation Agent');
  });
  it('returns "Execution Agent" for execution tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'execution' }))).toBe('Execution Agent');
  });
  it('returns "Planning Agent" for planning tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'planning' }))).toBe('Planning Agent');
  });
  it('returns "Ask Agent" for ask_agent tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'ask_agent' }))).toBe('Ask Agent');
  });
  it('returns "Sentry Agent" for sentry tasks', () => {
    expect(pickAgentLabel(makeTask({ agentType: 'sentry' }))).toBe('Sentry Agent');
  });
  it('returns "Execution Agent" for code-task-labeled tasks without agentType', () => {
    const task = makeTask({ linearIssueLabels: ['code-task'] });
    delete task.agentType;
    expect(pickAgentLabel(task)).toBe('Execution Agent');
  });
  it('falls back to "Planning Agent" when no agent signals are present', () => {
    const task = makeTask();
    delete task.agentType;
    expect(pickAgentLabel(task)).toBe('Planning Agent');
  });
});

describe('describeAgent', () => {
  it.each([
    ['Pull Request Agent', 'PR comment'],
    ['Review Agent', 'read-only'],
    ['Remediation Agent', 'review findings'],
    ['Ask Agent', 'interactive'],
    ['Sentry Agent', 'Sentry issue'],
    ['Execution Agent', 'implement autonomously'],
    ['Planning Agent', 'planning artifacts'],
  ])('returns the %s tagline containing %j', (label, expectedSubstring) => {
    expect(describeAgent(label)).toContain(expectedSubstring);
  });

  it('falls through to the Planning Agent description for unknown labels', () => {
    expect(describeAgent('Mystery Agent')).toBe(
      'Planning Agent — create planning artifacts only, no implementation coding'
    );
  });
});

describe('pickTaskLifecycleEvent', () => {
  it('maps completed -> task_completed', () => {
    expect(pickTaskLifecycleEvent('completed')).toBe('task_completed');
  });
  it('maps failed -> task_failed', () => {
    expect(pickTaskLifecycleEvent('failed')).toBe('task_failed');
  });
  it('maps interrupted -> task_interrupted', () => {
    expect(pickTaskLifecycleEvent('interrupted')).toBe('task_interrupted');
  });
  it('maps cancelled -> undefined (no lifecycle event fired)', () => {
    expect(pickTaskLifecycleEvent('cancelled')).toBeUndefined();
  });
});

describe('pickAgentStatusLabel', () => {
  it('returns "implemented" for execution and remediation', () => {
    expect(pickAgentStatusLabel('execution')).toBe('implemented');
    expect(pickAgentStatusLabel('remediation')).toBe('implemented');
  });
  it('returns "reviewed" for review', () => {
    expect(pickAgentStatusLabel('review')).toBe('reviewed');
  });
  it('returns "planned" for planning', () => {
    expect(pickAgentStatusLabel('planning')).toBe('planned');
  });
  it('returns "implemented" for sentry', () => {
    expect(pickAgentStatusLabel('sentry')).toBe('implemented');
  });
  it('returns undefined for unmapped or missing agent types', () => {
    expect(pickAgentStatusLabel('ask_agent')).toBeUndefined();
    expect(pickAgentStatusLabel(undefined)).toBeUndefined();
  });
});
