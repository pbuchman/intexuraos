import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { TaskStatus } from '../../../domain/models/codeTask.js';
import {
  isActiveTaskStatus,
  isArchivalTaskStatus,
  isCompletionTaskStatus,
  normalizeTaskLifecycleTimestamp,
  resolveMissingTaskCompletionTime,
  resolveTaskLifecycleTime,
  TaskLifecycleTimeInvariantError,
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

  it('preserves exact Firestore nanoseconds while materializing a fresh Timestamp', () => {
    const statusChangedAt = new Timestamp(1_750_000_000, 123_456_789);

    const resolved = resolveTaskLifecycleTime(baseTask('running', { statusChangedAt }));

    expect(resolved.at).not.toBe(statusChangedAt);
    expect(resolved.at.seconds).toBe(1_750_000_000);
    expect(resolved.at.nanoseconds).toBe(123_456_789);
    expect(resolved.source).toBe('status_changed');
  });

  it('treats runtime-legacy completed as terminal without adding it to writable TaskStatus', () => {
    const completedAt = new Timestamp(1_773_886_013, 707_000_000);
    const resolved = resolveTaskLifecycleTime({
      status: 'completed',
      completedAt,
      updatedAt: timestamp('2026-03-19T02:14:34.998Z'),
      createdAt: timestamp('2026-03-19T01:00:00.000Z'),
    });

    expect(resolved.source).toBe('completed');
    expect(resolved.at.seconds).toBe(completedAt.seconds);
    expect(resolved.at.nanoseconds).toBe(completedAt.nanoseconds);
    expect(isCompletionTaskStatus('completed' as TaskStatus)).toBe(false);
  });

  it('normalizes the exact maximum Firestore Timestamp', () => {
    const maximum = new Timestamp(253_402_300_799, 999_999_999);

    const normalized = normalizeTaskLifecycleTimestamp(maximum);

    expect(normalized).toBeDefined();
    expect(normalized).not.toBe(maximum);
    expect(normalized?.seconds).toBe(253_402_300_799);
    expect(normalized?.nanoseconds).toBe(999_999_999);
  });

  it('resolves the exact maximum Firestore Timestamp as status_changed', () => {
    const resolved = resolveTaskLifecycleTime(baseTask('running', {
      statusChangedAt: new Timestamp(253_402_300_799, 999_999_999),
    }));

    expect(resolved.at.seconds).toBe(253_402_300_799);
    expect(resolved.at.nanoseconds).toBe(999_999_999);
    expect(resolved.source).toBe('status_changed');
  });

  it('skips invalid empty and malformed candidates before valid terminal dispatch evidence', () => {
    const dispatchFailureAt = timestamp('2026-07-27T08:03:00.000Z');
    const resolved = resolveTaskLifecycleTime(baseTask('failed', {
      statusChangedAt: '' as never,
      completedAt: { toDate: (): never => { throw new Error('malformed timestamp'); } } as never,
      dispatchStatus: {
        terminal: true,
        lastSeenAt: timestamp('2026-07-27T08:04:00.000Z'),
        terminalCause: { lastSeenAt: dispatchFailureAt },
      },
    }));

    expect(resolved.at.toMillis()).toBe(dispatchFailureAt.toMillis());
    expect(resolved.source).toBe('dispatch_terminal_cause');
  });

  it.each([
    { name: 'null', value: null },
    { name: 'non-ISO string', value: 'not-an-iso-date' },
    { name: 'impossible ISO calendar date', value: '2026-02-30T08:01:00Z' },
    { name: 'invalid Date', value: new Date(Number.NaN) },
    { name: 'finite Date outside the Firestore range', value: new Date(Date.UTC(10_000, 0, 1)) },
    { name: 'plain object', value: {} },
    { name: 'object with non-function toDate', value: { toDate: 'not-a-function' } },
    { name: 'object whose toDate returns an invalid Date', value: { toDate: (): Date => new Date(Number.NaN) } },
    {
      name: 'object whose toDate getter throws',
      value: Object.defineProperty({}, 'toDate', {
        get: (): never => { throw new Error('getter trap'); },
      }),
    },
    {
      name: 'proxy whose reflection trap throws',
      value: new Proxy({}, {
        has: (): never => { throw new Error('reflection trap'); },
      }),
    },
    {
      name: 'Timestamp proxy whose toDate access throws',
      value: new Proxy(timestamp('2026-07-27T08:01:00.000Z'), {
        get: (target, property, receiver): unknown => {
          if (property === 'toDate') throw new Error('timestamp getter trap');
          return Reflect.get(target, property, receiver);
        },
      }),
    },
    {
      name: 'Timestamp proxy whose toDate call throws',
      value: new Proxy(timestamp('2026-07-27T08:01:00.000Z'), {
        get: (target, property, receiver): unknown => property === 'toDate'
          ? (): never => { throw new Error('timestamp call trap'); }
          : Reflect.get(target, property, receiver),
      }),
    },
    {
      name: 'Timestamp proxy whose seconds access throws',
      value: new Proxy(new Timestamp(1_750_000_000, 123_456_789), {
        get: (target, property, receiver): unknown => {
          if (property === 'toDate') return target.toDate.bind(target);
          if (property === 'seconds') throw new Error('timestamp seconds trap');
          return Reflect.get(target, property, receiver);
        },
      }),
    },
    {
      name: 'Timestamp proxy whose toDate disagrees with its components',
      value: new Proxy(new Timestamp(1_750_000_000, 123_456_789), {
        get: (target, property, receiver): unknown => property === 'toDate'
          ? (): Date => new Date(1_750_000_001_000)
          : Reflect.get(target, property, receiver),
      }),
    },
    {
      name: 'Timestamp prototype impostor',
      value: Object.create(Timestamp.prototype) as Timestamp,
    },
  ])('skips an invalid $name candidate and uses the next valid timestamp', ({ value }) => {
    const resolved = resolveTaskLifecycleTime(baseTask('planned', {
      statusChangedAt: value as never,
    }));

    expect(resolved.at.toMillis()).toBe(legacyUpdatedAt.toMillis());
    expect(resolved.source).toBe('legacy_updated');
  });

  it('normalizes a valid structural toDate lifecycle timestamp', () => {
    const resolved = resolveTaskLifecycleTime(baseTask('running', {
      statusChangedAt: {
        toDate: (): Date => new Date('2026-07-27T08:01:00.000Z'),
      } as never,
    }));

    expect(resolved.at.toDate().toISOString()).toBe('2026-07-27T08:01:00.000Z');
    expect(resolved.source).toBe('status_changed');
  });

  it('normalizes a valid ISO lifecycle string when compatibility input intentionally supplies one', () => {
    const resolved = resolveTaskLifecycleTime(baseTask('running', {
      statusChangedAt: '2026-07-27T08:01:00.000Z' as never,
    }));

    expect(resolved.at.toDate().toISOString()).toBe('2026-07-27T08:01:00.000Z');
    expect(resolved.source).toBe('status_changed');
  });

  it.each([
    {
      name: 'positive offset',
      value: '2026-07-27T10:01:00+02:00',
      expected: '2026-07-27T08:01:00.000Z',
    },
    {
      name: 'negative offset with minutes',
      value: '2026-07-27T02:31:00-05:30',
      expected: '2026-07-27T08:01:00.000Z',
    },
  ])('normalizes a valid ISO lifecycle string with a $name', ({ value, expected }) => {
    const resolved = resolveTaskLifecycleTime(baseTask('running', {
      statusChangedAt: value,
    }));

    expect(resolved.at.toDate().toISOString()).toBe(expected);
    expect(resolved.source).toBe('status_changed');
  });

  it('fails fast when every lifecycle timestamp candidate is invalid', () => {
    expect(() => resolveTaskLifecycleTime({
      status: 'failed',
      statusChangedAt: Object.create(Timestamp.prototype) as Timestamp,
      completedAt: Object.defineProperty({}, 'toDate', {
        get: (): never => { throw new Error('getter trap'); },
      }),
      dispatchStatus: {
        terminal: true,
        lastSeenAt: { toDate: 'not-a-function' },
        terminalCause: {
          lastSeenAt: new Proxy({}, {
            has: (): never => { throw new Error('reflection trap'); },
          }),
        },
      },
      updatedAt: { toDate: (): Date => new Date(Number.NaN) },
      createdAt: {},
    })).toThrowError(TaskLifecycleTimeInvariantError);
  });
});

describe('resolveMissingTaskCompletionTime', () => {
  const failureAt = timestamp('2026-07-27T08:01:00.000Z');
  const terminalAt = timestamp('2026-07-27T08:02:00.000Z');
  const archivedAt = timestamp('2026-07-27T08:03:00.000Z');
  const metadataAt = timestamp('2026-07-27T08:04:00.000Z');
  const explicitAt = timestamp('2026-07-27T08:00:30.000Z');

  const archivedTask = (overrides: Partial<CodeTaskLifecycleShape> = {}): CodeTaskLifecycleShape =>
    baseTask('archived', {
      statusChangedAt: archivedAt,
      updatedAt: metadataAt,
      dispatchStatus: {
        terminal: true,
        lastSeenAt: terminalAt,
        terminalCause: { lastSeenAt: failureAt },
      },
      ...overrides,
    });

  it('prefers valid explicit completion over every archived fallback', () => {
    const resolved = resolveMissingTaskCompletionTime(archivedTask(), {
      explicitCompletedAt: explicitAt,
    });

    expect(resolved.at.toMillis()).toBe(explicitAt.toMillis());
    expect(resolved.source).toBe('explicit_completed');
  });

  it('prefers terminal cause before terminal dispatch and archived statusChangedAt', () => {
    const preciseFailureAt = new Timestamp(1_775_000_000, 123_456_789);
    const resolved = resolveMissingTaskCompletionTime(archivedTask({
      dispatchStatus: {
        terminal: true,
        lastSeenAt: terminalAt,
        terminalCause: { lastSeenAt: preciseFailureAt },
      },
    }));

    expect(resolved.source).toBe('dispatch_terminal_cause');
    expect(resolved.at.seconds).toBe(preciseFailureAt.seconds);
    expect(resolved.at.nanoseconds).toBe(preciseFailureAt.nanoseconds);
  });

  it('falls back through terminal dispatch, archived status, updatedAt, then createdAt', () => {
    const withoutDispatch = archivedTask();
    delete withoutDispatch.dispatchStatus;
    const withoutDispatchOrStatus = archivedTask();
    delete withoutDispatchOrStatus.dispatchStatus;
    delete withoutDispatchOrStatus.statusChangedAt;
    const cases: {
      task: CodeTaskLifecycleShape;
      expectedAt: Timestamp;
      expectedSource: TaskLifecycleTimeSource;
    }[] = [
      {
        task: archivedTask({ dispatchStatus: { terminal: true, lastSeenAt: terminalAt } }),
        expectedAt: terminalAt,
        expectedSource: 'dispatch_terminal',
      },
      {
        task: withoutDispatch,
        expectedAt: archivedAt,
        expectedSource: 'status_changed',
      },
      {
        task: withoutDispatchOrStatus,
        expectedAt: metadataAt,
        expectedSource: 'legacy_updated',
      },
      {
        task: {
          status: 'archived',
          createdAt,
          queuedAt: timestamp('2026-07-27T08:06:00.000Z'),
          dispatchedAt: timestamp('2026-07-27T08:07:00.000Z'),
        },
        expectedAt: createdAt,
        expectedSource: 'created',
      },
    ];

    for (const candidate of cases) {
      const resolved = resolveMissingTaskCompletionTime(candidate.task);
      expect(resolved.at.toMillis()).toBe(candidate.expectedAt.toMillis());
      expect(resolved.source).toBe(candidate.expectedSource);
    }
  });

  it('uses a completion-terminal statusChangedAt before dispatch evidence', () => {
    const resolved = resolveMissingTaskCompletionTime(baseTask('failed', {
      statusChangedAt: archivedAt,
      dispatchStatus: {
        terminal: true,
        lastSeenAt: terminalAt,
        terminalCause: { lastSeenAt: failureAt },
      },
    }));

    expect(resolved.at.toMillis()).toBe(archivedAt.toMillis());
    expect(resolved.source).toBe('status_changed');
  });

  it('uses the write fallback for an active task instead of treating active timestamps as completion', () => {
    const writeAt = new Timestamp(1_775_100_000, 987_654_321);
    const resolved = resolveMissingTaskCompletionTime(baseTask('running', {
      statusChangedAt: archivedAt,
      dispatchedAt: terminalAt,
    }), { activeFallbackAt: writeAt });

    expect(resolved.source).toBe('write_time');
    expect(resolved.at.seconds).toBe(writeAt.seconds);
    expect(resolved.at.nanoseconds).toBe(writeAt.nanoseconds);
  });

  it('rejects an invalid explicit completion instead of silently falling back', () => {
    expect(() => resolveMissingTaskCompletionTime(archivedTask(), {
      explicitCompletedAt: new Date(Number.NaN),
    })).toThrowError('Invalid explicit task completion timestamp');
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
