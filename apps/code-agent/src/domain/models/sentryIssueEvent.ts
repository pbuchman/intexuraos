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
  codeTaskId?: string | undefined;
  linearIssueId?: string | undefined;
}

export interface ReserveSentryIssueEventInput {
  event: NormalizedSentryIssueEvent;
  receivedAt: Date;
  payload: unknown;
}

export interface ReserveSentryIssueEventResult {
  created: boolean;
  record: SentryIssueEventRecord;
}
