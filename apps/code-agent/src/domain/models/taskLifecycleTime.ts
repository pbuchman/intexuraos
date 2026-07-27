import type { Timestamp } from '@google-cloud/firestore';
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
  statusChangedAt?: Timestamp;
  completedAt?: Timestamp;
  dispatchStatus?: {
    terminal: boolean;
    lastSeenAt: Timestamp;
    terminalCause?: {
      lastSeenAt: Timestamp;
    };
  };
  dispatchedAt?: Timestamp;
  queuedAt?: Timestamp;
  updatedAt?: Timestamp;
  createdAt: Timestamp;
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
  if (task.statusChangedAt !== undefined) {
    return { at: task.statusChangedAt, source: 'status_changed' };
  }
  if (isTerminalTaskStatus(task.status) && task.completedAt !== undefined) {
    return { at: task.completedAt, source: 'completed' };
  }
  if (
    isTerminalTaskStatus(task.status)
    && task.dispatchStatus?.terminalCause !== undefined
  ) {
    return {
      at: task.dispatchStatus.terminalCause.lastSeenAt,
      source: 'dispatch_terminal_cause',
    };
  }
  if (
    isTerminalTaskStatus(task.status)
    && task.dispatchStatus?.terminal === true
  ) {
    return { at: task.dispatchStatus.lastSeenAt, source: 'dispatch_terminal' };
  }
  if (
    (task.status === 'dispatched' || task.status === 'running')
    && task.dispatchedAt !== undefined
  ) {
    return { at: task.dispatchedAt, source: 'dispatched' };
  }
  if (task.status === 'queued' && task.queuedAt !== undefined) {
    return { at: task.queuedAt, source: 'queued' };
  }
  if (task.updatedAt !== undefined) {
    return { at: task.updatedAt, source: 'legacy_updated' };
  }
  return { at: task.createdAt, source: 'created' };
}
