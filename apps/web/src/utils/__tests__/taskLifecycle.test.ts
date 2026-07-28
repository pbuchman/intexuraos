import { describe, expect, it } from 'vitest';
import type { CodeTask, CodeTaskStatus } from '@/types';
import {
  formatTaskDuration,
  formatTaskRelativeTime,
  getTaskLifecycleVerb,
} from '../taskLifecycle.js';

type LifecycleTask = CodeTask & {
  statusChangedAt: string;
  completedAt?: string;
};

function createTask(overrides: Partial<LifecycleTask> = {}): LifecycleTask {
  return {
    id: 'task-lifecycle',
    userId: 'user-1',
    prompt: 'Fix the lifecycle clock',
    sanitizedPrompt: 'Fix the lifecycle clock',
    systemPromptHash: 'hash-1',
    workerType: 'codex',
    workerLocation: 'home-dev',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: 'failed',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: '2026-07-27T12:00:00.000Z',
    dispatchedAt: '2026-07-27T12:01:00.000Z',
    statusChangedAt: '2026-07-27T12:03:00.000Z',
    completedAt: '2026-07-27T12:03:00.000Z',
    updatedAt: '2026-07-27T13:30:00.000Z',
    ...overrides,
  };
}

describe('task lifecycle presentation', () => {
  it.each<[CodeTaskStatus, string]>([
    ['queued', 'Queued'],
    ['dispatched', 'Dispatched'],
    ['running', 'Running'],
    ['planned', 'Planned'],
    ['implemented', 'Implemented'],
    ['reviewed', 'Reviewed'],
    ['failed', 'Failed'],
    ['interrupted', 'Interrupted'],
    ['cancelled', 'Cancelled'],
    ['archived', 'Archived'],
  ])('maps %s to the exact lifecycle verb %s', (status, expected) => {
    expect(getTaskLifecycleVerb(status)).toBe(expected);
  });

  it('keeps relative text relative after seven days', () => {
    expect(
      formatTaskRelativeTime(
        '2026-07-01T12:00:00.000Z',
        new Date('2026-07-27T12:00:00.000Z').getTime(),
      ),
    ).toBe('26d ago');
  });

  it('uses completedAt instead of later technical updatedAt for a terminal task', () => {
    expect(formatTaskDuration(createTask())).toBe('2m 0s');
  });

  it('treats reviewed as terminal', () => {
    expect(formatTaskDuration(createTask({ status: 'reviewed' }))).toBe('2m 0s');
  });

  it('uses the preserved completion when an archived task has a later archive event', () => {
    expect(formatTaskDuration(createTask({
      status: 'archived',
      statusChangedAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
    }))).toBe('2m 0s');
  });

  it('uses the current clock for an active task', () => {
    expect(formatTaskDuration(
      createTask({
        status: 'running',
        completedAt: undefined,
        updatedAt: '2026-07-27T12:02:00.000Z',
      }),
      new Date('2026-07-27T12:06:00.000Z').getTime(),
    )).toBe('5m 0s');
  });

  it('reports Never started for a terminal dispatch failure without dispatchedAt', () => {
    expect(formatTaskDuration(createTask({
      dispatchedAt: undefined,
      status: 'failed',
    }))).toBe('Never started');
  });
});
