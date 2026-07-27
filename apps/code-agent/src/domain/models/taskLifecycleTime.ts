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
  status: TaskStatus;
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

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export class TaskLifecycleTimeInvariantError extends Error {
  constructor(status: TaskStatus) {
    super(
      `Task lifecycle timestamp invariant violated for status ${status}: no valid timestamp candidate`,
    );
    this.name = 'TaskLifecycleTimeInvariantError';
  }
}

function timestampFromValidDate(value: unknown): Timestamp | undefined {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? Timestamp.fromDate(value)
    : undefined;
}

function hasToDate(value: unknown): value is { toDate: () => unknown } {
  if (typeof value !== 'object' || value === null || !('toDate' in value)) {
    return false;
  }
  const candidate = value as { toDate?: unknown };
  return typeof candidate.toDate === 'function';
}

export function normalizeTaskLifecycleTimestamp(value: unknown): Timestamp | undefined {
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return timestampFromValidDate(value);
  }
  if (typeof value === 'string') {
    if (!ISO_DATE_TIME.test(value)) {
      return undefined;
    }
    return timestampFromValidDate(new Date(value));
  }
  if (!hasToDate(value)) {
    return undefined;
  }
  try {
    return timestampFromValidDate(value.toDate());
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
  const terminal = isTerminalTaskStatus(task.status);
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
