export type SentryWebhookResource = 'issue' | 'event_alert';

export interface NormalizedSentryIssueEvent {
  resource: SentryWebhookResource;
  action: string;
  organizationSlug: string;
  projectSlug: string;
  projectId: string | undefined;
  issueId: string;
  issueShortId: string | undefined;
  issueTitle: string;
  issueUrl: string;
  status: string | undefined;
  eventId: string | undefined;
  sourceEnvironment?: string;
  sourceTaskId?: string;
  sourceDispatchAttemptId?: string;
  sourceTraceId?: string;
}

export type SentryIssueEventParseError =
  | { code: 'UNSUPPORTED_RESOURCE'; message: string }
  | { code: 'INVALID_PAYLOAD'; message: string };

export interface SentryIssueTaskContext {
  organizationSlug: string;
  projectSlug: string;
  projectId?: string | undefined;
  issueId: string;
  issueShortId?: string | undefined;
  issueUrl: string;
  title: string;
  action: string;
  eventId?: string | undefined;
  receivedAt: string;
}

export interface SentryIssueEventRecord {
  dedupeKey: string;
  transitionKey: string;
  recordType: 'transition' | 'issue' | 'correlation';
  correlationKey?: string | undefined;
  state: SentryTaskReservationState;
  organizationSlug: string;
  projectSlug: string;
  projectId?: string | undefined;
  issueId: string;
  issueShortId?: string | undefined;
  issueTitle: string;
  issueUrl: string;
  action: string;
  resource: NormalizedSentryIssueEvent['resource'];
  status?: string | undefined;
  eventId?: string | undefined;
  receivedAt: Date;
  latestReceivedAt: Date;
  duplicateCount: number;
  payload: unknown;
  proposedCodeTaskId: string;
  leaseToken?: string | undefined;
  leaseExpiresAt?: Date | undefined;
  leaseOwner?: string | undefined;
  failureReason?: string | undefined;
  codeTaskId?: string | undefined;
  linearIssueId?: string | undefined;
}

export type SentryTaskReservationState = 'reserved' | 'task_created' | 'failed';

export interface AcquireSentryTaskReservationInput {
  event: NormalizedSentryIssueEvent;
  receivedAt: Date;
  proposedCodeTaskId: string;
  leaseOwner: string;
  leaseDurationMs: number;
  payload: unknown;
  /** Optimistic compare-and-swap after the caller verifies a linked task is non-blocking. */
  replaceLinkedCodeTaskId?: string | undefined;
}

export type AcquireSentryTaskReservationResult =
  | {
    kind: 'acquired';
    transitionKey: string;
    issueKey: string;
    reservationKey?: string | undefined;
    idempotencyKey?: string | undefined;
    leaseToken: string;
    codeTaskId: string;
    linearIssueId?: string | undefined;
  }
  | { kind: 'duplicate'; codeTaskId?: string | undefined }
  | { kind: 'retryable' }
  | {
    kind: 'inspect_linked_task';
    codeTaskId: string;
    transitionKey: string;
    issueKey: string;
  };

export interface CompleteSentryTaskReservationInput {
  transitionKey: string;
  issueKey: string;
  reservationKey?: string | undefined;
  leaseToken: string;
  codeTaskId: string;
  linearIssueId?: string | undefined;
}

export interface CheckpointSentryLinearIssueInput {
  transitionKey: string;
  issueKey: string;
  reservationKey?: string | undefined;
  leaseToken: string;
  linearIssueId: string;
}

export interface FailSentryTaskReservationInput {
  transitionKey: string;
  issueKey: string;
  reservationKey?: string | undefined;
  leaseToken: string;
  reason: string;
  codeTaskId?: string | undefined;
  linearIssueId?: string | undefined;
}
