import { Timestamp } from '@google-cloud/firestore';
import type { TaskStatus } from './codeTask.js';

export type TaskLifecycleTimeSource =
  | 'status_changed'
  | 'completed'
  | 'dispatch_terminal_cause'
  | 'dispatch_terminal'
  | 'dispatched'
  | 'queued'
  | 'legacy_updated'
  | 'created';

export interface ResolvedTaskLifecycleTime {
  at: Timestamp;
  source: TaskLifecycleTimeSource;
}

export interface CodeTaskLifecycleShape {
  /** Runtime-only compatibility for one retained legacy document. Never writable. */
  status: TaskStatus | 'completed';
  statusChangedAt?: unknown;
  completedAt?: unknown;
  dispatchStatus?: {
    terminal: boolean;
    lastSeenAt: unknown;
    terminalCause?: {
      lastSeenAt: unknown;
    };
  };
  dispatchedAt?: unknown;
  queuedAt?: unknown;
  updatedAt?: unknown;
  createdAt: unknown;
}

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

export class TaskLifecycleTimeInvariantError extends Error {
  constructor(status: CodeTaskLifecycleShape['status']) {
    super(
      `Task lifecycle timestamp invariant violated for status ${status}: no valid timestamp candidate`,
    );
    this.name = 'TaskLifecycleTimeInvariantError';
  }
}

function timestampFromValidDate(value: unknown): Timestamp | undefined {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return undefined;
  }
  try {
    return Timestamp.fromDate(value);
  } catch {
    return undefined;
  }
}

function isValidIsoDateTime(value: string): boolean {
  const match = ISO_DATE_TIME.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const leapDay = Number(year % 4 === 0) - Number(year % 100 === 0) + Number(year % 400 === 0);
  const daysInMonth = month === 2
    ? 28 + leapDay
    : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

  return year >= 1
    && month >= 1
    && month <= 12
    && daysInMonth !== undefined
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}

export function normalizeTaskLifecycleTimestamp(value: unknown): Timestamp | undefined {
  try {
    if (value instanceof Timestamp) {
      const candidateDate = value.toDate();
      if (!(candidateDate instanceof Date)) {
        return undefined;
      }
      const candidateMillis = candidateDate.getTime();
      if (!Number.isFinite(candidateMillis)) {
        return undefined;
      }
      const materialized = new Timestamp(value.seconds, value.nanoseconds);
      if (materialized.toDate().getTime() !== candidateMillis) {
        return undefined;
      }
      return materialized;
    }
    if (value instanceof Date) {
      return timestampFromValidDate(value);
    }
    if (typeof value === 'string') {
      if (!isValidIsoDateTime(value)) {
        return undefined;
      }
      return timestampFromValidDate(new Date(value));
    }
    if (typeof value !== 'object' || value === null || !('toDate' in value)) {
      return undefined;
    }
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate !== 'function') {
      return undefined;
    }
    return timestampFromValidDate(Reflect.apply(toDate, value, []));
  } catch {
    return undefined;
  }
}

const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'queued',
  'dispatched',
  'running',
]);

const COMPLETION_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'planned',
  'implemented',
  'reviewed',
  'failed',
  'interrupted',
  'cancelled',
]);

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export function isCompletionTaskStatus(status: TaskStatus): boolean {
  return COMPLETION_TASK_STATUSES.has(status);
}

export function isArchivalTaskStatus(status: TaskStatus): boolean {
  return status === 'archived';
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return isCompletionTaskStatus(status) || isArchivalTaskStatus(status);
}

export function resolveTaskLifecycleTime(
  task: CodeTaskLifecycleShape
): ResolvedTaskLifecycleTime {
  const terminal = task.status === 'completed' || isTerminalTaskStatus(task.status);
  const candidates: readonly {
    enabled: boolean;
    value: unknown;
    source: TaskLifecycleTimeSource;
  }[] = [
    { enabled: true, value: task.statusChangedAt, source: 'status_changed' },
    { enabled: terminal, value: task.completedAt, source: 'completed' },
    {
      enabled: terminal,
      value: task.dispatchStatus?.terminalCause?.lastSeenAt,
      source: 'dispatch_terminal_cause',
    },
    {
      enabled: terminal && task.dispatchStatus?.terminal === true,
      value: task.dispatchStatus?.lastSeenAt,
      source: 'dispatch_terminal',
    },
    {
      enabled: task.status === 'dispatched' || task.status === 'running',
      value: task.dispatchedAt,
      source: 'dispatched',
    },
    {
      enabled: task.status === 'queued',
      value: task.queuedAt,
      source: 'queued',
    },
    { enabled: true, value: task.updatedAt, source: 'legacy_updated' },
    { enabled: true, value: task.createdAt, source: 'created' },
  ];

  for (const candidate of candidates) {
    if (!candidate.enabled) continue;
    const at = normalizeTaskLifecycleTimestamp(candidate.value);
    if (at !== undefined) {
      return { at, source: candidate.source };
    }
  }

  throw new TaskLifecycleTimeInvariantError(task.status);
}
