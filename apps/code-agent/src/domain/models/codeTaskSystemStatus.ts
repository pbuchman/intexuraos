import type { CodeTaskDispatchBlockerReason } from '../services/codeTaskDispatchBlockers.js';

export type CodeTaskSystemStatusComponent = 'code-task-dispatch';
export type CodeTaskSystemStatusState = 'active' | 'resolved';
export type CodeTaskSystemStatusSeverity = 'warning' | 'critical';

export interface CodeTaskSystemStatus {
  readonly id: string;
  readonly userId: string;
  readonly component: CodeTaskSystemStatusComponent;
  readonly status: CodeTaskSystemStatusState;
  readonly severity: CodeTaskSystemStatusSeverity;
  readonly workerType: string;
  readonly reason: CodeTaskDispatchBlockerReason;
  readonly message: string;
  readonly remediation: string;
  readonly affectedTaskCount: number;
  readonly exampleTaskIds: readonly string[];
  readonly workerNames: readonly string[];
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt?: Date;
  readonly lastNotifiedAt?: Date;
}

export interface UpsertCodeTaskSystemStatusInput {
  readonly userId: string;
  readonly workerType: string;
  readonly reason: CodeTaskDispatchBlockerReason;
  readonly severity: CodeTaskSystemStatusSeverity;
  readonly message: string;
  readonly remediation: string;
  readonly affectedTaskCount: number;
  readonly exampleTaskIds: readonly string[];
  readonly workerNames: readonly string[];
}
