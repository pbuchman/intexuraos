import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { TaskStatus } from '../../../domain/models/codeTask.js';
import {
  isActiveTaskStatus,
  isArchivalTaskStatus,
  isCompletionTaskStatus,
  resolveTaskLifecycleTime,
  type CodeTaskLifecycleShape,
  type TaskLifecycleTimeSource,
} from '../../../domain/models/taskLifecycleTime.js';

const timestamp = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));

const createdAt = timestamp('2026-07-27T08:00:00.000Z');
const legacyUpdatedAt = timestamp('2026-07-27T08:07:00.000Z');

const baseTask = (
  status: TaskStatus,
  overrides: Partial<CodeTaskLifecycleShape> = {}
): CodeTaskLifecycleShape => ({
  status,
  createdAt,
  updatedAt: legacyUpdatedAt,
  ...overrides,
});

describe('resolveTaskLifecycleTime', () => {
  const cases: readonly {
    name: string;
    task: CodeTaskLifecycleShape;
    expectedAt: Timestamp;
    expectedSource: TaskLifecycleTimeSource;
  }[] = [
    {
      name: 'prefers persisted statusChangedAt over every fallback',
      task: baseTask('failed', {
        statusChangedAt: timestamp('2026-07-27T08:01:00.000Z'),
        completedAt: timestamp('2026-07-27T08:02:00.000Z'),
        dispatchStatus: {
          terminal: true,
          lastSeenAt: timestamp('2026-07-27T08:04:00.000Z'),
          terminalCause: { lastSeenAt: timestamp('2026-07-27T08:03:00.000Z') },
        },
        dispatchedAt: timestamp('2026-07-27T08:05:00.000Z'),
        queuedAt: timestamp('2026-07-27T08:06:00.000Z'),
      }),
      expectedAt: timestamp('2026-07-27T08:01:00.000Z'),
      expectedSource: 'status_changed',
    },
    {
      name: 'uses completedAt for a terminal task before dispatch evidence',
      task: baseTask('failed', {
        completedAt: timestamp('2026-07-27T08:02:00.000Z'),
        dispatchStatus: {
          terminal: true,
          lastSeenAt: timestamp('2026-07-27T08:04:00.000Z'),
          terminalCause: { lastSeenAt: timestamp('2026-07-27T08:03:00.000Z') },
        },
      }),
      expectedAt: timestamp('2026-07-27T08:02:00.000Z'),
      expectedSource: 'completed',
    },
    {
      name: 'uses terminal dispatch cause evidence before terminal dispatch evidence',
      task: baseTask('failed', {
        dispatchStatus: {
          terminal: true,
          lastSeenAt: timestamp('2026-07-27T08:04:00.000Z'),
          terminalCause: { lastSeenAt: timestamp('2026-07-27T08:03:00.000Z') },
        },
      }),
      expectedAt: timestamp('2026-07-27T08:03:00.000Z'),
      expectedSource: 'dispatch_terminal_cause',
    },
    {
      name: 'uses terminal dispatch evidence when no terminal cause exists',
      task: baseTask('failed', {
        dispatchStatus: {
          terminal: true,
          lastSeenAt: timestamp('2026-07-27T08:04:00.000Z'),
        },
      }),
      expectedAt: timestamp('2026-07-27T08:04:00.000Z'),
      expectedSource: 'dispatch_terminal',
    },
    {
      name: 'uses dispatchedAt only for dispatched or running tasks',
      task: baseTask('running', {
        dispatchedAt: timestamp('2026-07-27T08:05:00.000Z'),
        queuedAt: timestamp('2026-07-27T08:06:00.000Z'),
      }),
      expectedAt: timestamp('2026-07-27T08:05:00.000Z'),
      expectedSource: 'dispatched',
    },
    {
      name: 'uses queuedAt only for queued tasks',
      task: baseTask('queued', {
        queuedAt: timestamp('2026-07-27T08:06:00.000Z'),
      }),
      expectedAt: timestamp('2026-07-27T08:06:00.000Z'),
      expectedSource: 'queued',
    },
    {
      name: 'uses legacy updatedAt before the defensive createdAt fallback',
      task: baseTask('planned'),
      expectedAt: legacyUpdatedAt,
      expectedSource: 'legacy_updated',
    },
    {
      name: 'uses createdAt when malformed legacy data has no mutation time',
      task: {
        status: 'planned',
        createdAt,
      },
      expectedAt: createdAt,
      expectedSource: 'created',
    },
  ];

  it.each(cases)('$name', ({ task, expectedAt, expectedSource }) => {
    const resolved = resolveTaskLifecycleTime(task);

    expect(resolved.at.toMillis()).toBe(expectedAt.toMillis());
    expect(resolved.source).toBe(expectedSource);
  });
});

describe('task lifecycle status predicates', () => {
  it('separates active, completion, and archival statuses', () => {
    expect((['queued', 'dispatched', 'running'] as const).every(isActiveTaskStatus)).toBe(true);
    expect(
      (['planned', 'implemented', 'reviewed', 'failed', 'interrupted', 'cancelled'] as const)
        .every(isCompletionTaskStatus)
    ).toBe(true);
    expect(isArchivalTaskStatus('archived')).toBe(true);
    expect(isCompletionTaskStatus('archived')).toBe(false);
    expect(isActiveTaskStatus('failed')).toBe(false);
  });
});
