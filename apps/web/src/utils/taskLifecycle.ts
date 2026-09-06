import type { CodeTask, CodeTaskDispatchStatusReason, CodeTaskStatus } from '@/types';
import { formatElapsedTime } from './dateFormat.js';

const TASK_LIFECYCLE_VERBS = {
  queued: 'Queued',
  dispatched: 'Dispatched',
  running: 'Running',
  planned: 'Planned',
  implemented: 'Implemented',
  reviewed: 'Reviewed',
  failed: 'Failed',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  archived: 'Archived',
} satisfies Record<CodeTaskStatus, string>;

const TERMINAL_STATUSES: ReadonlySet<CodeTaskStatus> = new Set([
  'planned',
  'implemented',
  'reviewed',
  'failed',
  'interrupted',
  'cancelled',
  'archived',
]);

const DISPATCH_REASON_LABELS = {
  no_enabled_workers: 'No enabled workers',
  workers_unreachable: 'Workers unreachable',
  worker_health_contract_mismatch: 'Worker health information incomplete',
  workers_at_capacity: 'Workers at capacity',
  codex_auth_unavailable: 'Codex authorization unavailable',
  claude_auth_unavailable: 'Claude authorization unavailable',
  provider_auth_unavailable: 'Provider authorization unavailable',
  docker_unavailable: 'Worker runtime unavailable',
  disk_unavailable: 'Worker storage unavailable',
  unknown_worker_type: 'Unknown worker type',
  worker_unavailable: 'Worker unavailable',
  worker_busy: 'Worker busy',
  at_capacity: 'Queue at capacity',
  network_error: 'Network error',
  dispatch_failed: 'Dispatch failed',
  invalid_response: 'Invalid worker response',
  queue_full: 'Dispatch queue full',
  queue_timeout: 'Dispatch queue timeout',
  retry_expired: 'Dispatch retry expired',
  retry_exhausted: 'Dispatch retries exhausted',
  missing_pr_branch: 'Pull request branch unavailable',
  scheduled_wait: 'Waiting for scheduled dispatch',
  active_task_blocked: 'Waiting for active task',
} satisfies Record<CodeTaskDispatchStatusReason, string>;

const AUTH_DISPATCH_REMEDIATIONS: Partial<Record<CodeTaskDispatchStatusReason, string>> = {
  codex_auth_unavailable: 'Choose a worker with active Codex authorization, or configure authorization on a worker intended to run Codex tasks.',
  claude_auth_unavailable: 'Choose a worker with active Claude authorization, or configure authorization on a worker intended to run Claude tasks.',
  provider_auth_unavailable: 'Choose a worker with active provider authorization, or configure authorization on a worker intended to run these tasks.',
};

export function getTaskLifecycleVerb(status: CodeTaskStatus): string {
  return TASK_LIFECYCLE_VERBS[status];
}

export function isTerminalTaskStatus(status: CodeTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function getDispatchReasonLabel(reason: CodeTaskDispatchStatusReason): string {
  return DISPATCH_REASON_LABELS[reason];
}

export function formatDispatchDiagnosticText(text: string): string {
  return Object.entries(DISPATCH_REASON_LABELS).reduce(
    (formatted, [reason, label]) => formatted.split(reason).join(label.toLowerCase()),
    text
  );
}

export function getDispatchRemediationText(
  reason: CodeTaskDispatchStatusReason,
  remediation: string
): string {
  return AUTH_DISPATCH_REMEDIATIONS[reason] ?? formatDispatchDiagnosticText(remediation);
}

export function formatTaskRelativeTime(isoDate: string, nowMs: number = Date.now()): string {
  const eventMs = new Date(isoDate).getTime();
  const diffMs = nowMs - eventMs;
  const isFuture = diffMs < 0;
  const absoluteSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const absoluteMinutes = Math.floor(absoluteSeconds / 60);
  const absoluteHours = Math.floor(absoluteMinutes / 60);
  const absoluteDays = Math.floor(absoluteHours / 24);

  if (absoluteSeconds < 60) return isFuture ? 'in < 1m' : 'just now';
  if (absoluteMinutes < 60) {
    return isFuture ? `in ${String(absoluteMinutes)}m` : `${String(absoluteMinutes)}m ago`;
  }
  if (absoluteHours < 24) {
    return isFuture ? `in ${String(absoluteHours)}h` : `${String(absoluteHours)}h ago`;
  }
  return isFuture ? `in ${String(absoluteDays)}d` : `${String(absoluteDays)}d ago`;
}

export function formatTaskDuration(task: CodeTask, nowMs: number = Date.now()): string {
  const terminal = isTerminalTaskStatus(task.status);
  if (terminal && task.dispatchedAt === undefined) return 'Never started';

  const startAt = task.dispatchedAt ?? task.createdAt;
  const endAt = terminal ? task.completedAt : undefined;
  if (terminal && endAt === undefined) return 'Duration unavailable';

  const endMs = endAt === undefined ? nowMs : new Date(endAt).getTime();
  const startMs = new Date(startAt).getTime();
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return formatElapsedTime(seconds);
}
