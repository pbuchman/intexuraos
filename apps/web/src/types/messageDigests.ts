export type MessageDigestChatType = 'group' | 'direct';
export type MessageDigestDefinitionStatus = 'active' | 'paused' | 'deleting';
export type MessageDigestEffectiveStatus =
  | MessageDigestDefinitionStatus
  | 'needs_attention';
export type MessageDigestInstructionTemplateId =
  | 'fishing_group'
  | 'direct_sentiment'
  | 'custom';
export type MessageDigestGenerationStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped_no_activity';
export type MessageDigestProcessingStage =
  | 'queued'
  | 'reading_messages'
  | 'aggregating'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'skipped_no_activity';
export type MessageDigestDeliveryStatus =
  | 'not_sent'
  | 'pending'
  | 'sent'
  | 'ambiguous'
  | 'failed';

export type MessageDigestWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type MessageDigestSchedule =
  | { kind: 'daily'; localTime: string; timeZone: string }
  | { kind: 'weekdays'; localTime: string; timeZone: string }
  | {
      kind: 'weekly';
      weekday: MessageDigestWeekday;
      localTime: string;
      timeZone: string;
    };

export interface MessageDigestInstructions {
  templateId: MessageDigestInstructionTemplateId;
  text: string;
}

export interface MessageDigestSourceSummary {
  chatId: string;
  chatType: MessageDigestChatType;
  displayName: string;
  messageCount?: number;
  participantCount?: number;
  lastActivityAt?: string;
}

export interface MessageDigestDefinition {
  id: string;
  name: string;
  status: MessageDigestDefinitionStatus;
  listStatus: Exclude<MessageDigestEffectiveStatus, 'deleting'>;
  attentionCode: string | null;
  revision: number;
  sourceLocked: boolean;
  erasureRequestId: string | null;
  source: MessageDigestSourceSummary;
  instructions: MessageDigestInstructions;
  schedule: MessageDigestSchedule;
  delivery: { type: 'whatsapp_primary' };
  checkpointAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  latestRun: {
    id: string;
    startedAt: string;
    generationStatus: MessageDigestGenerationStatus;
    processingStage: MessageDigestProcessingStage;
    deliveryStatus: MessageDigestDeliveryStatus;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDigestRun {
  id: string;
  definitionId: string;
  definitionRevision: number;
  trigger: 'manual' | 'scheduled';
  window: {
    start: string;
    end: string;
    scheduledBoundary: string;
  };
  generationStatus: MessageDigestGenerationStatus;
  processingStage: MessageDigestProcessingStage;
  attempts: number;
  source: {
    chatType: MessageDigestChatType;
    displayName: string;
  };
  instructions: MessageDigestInstructions & { revision: string };
  schedule: MessageDigestSchedule;
  content: {
    headline: string;
    summaryMarkdown: string;
    evidenceMessageRefs: string[];
  } | null;
  effectiveMessageCount: number | null;
  promptVersion: string | null;
  model: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  delivery: {
    type: 'whatsapp_primary';
    status: MessageDigestDeliveryStatus;
    acceptedAt: string | null;
    failedAt: string | null;
    failureCode: string | null;
  };
  safeFailureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateMessageDigestInput {
  status: 'active' | 'paused';
  name: string;
  source: { chatId: string };
  instructions: MessageDigestInstructions;
  schedule: MessageDigestSchedule;
}

export interface UpdateMessageDigestCommand {
  expectedRevision: number;
  patch: {
    name?: string;
    source?: { chatId: string };
    instructions?: MessageDigestInstructions;
    schedule?: MessageDigestSchedule;
    status?: 'active' | 'paused';
  };
}

export interface PreviewMessageDigestInput {
  source: { chatId: string };
  instructions: MessageDigestInstructions;
  schedule: MessageDigestSchedule;
}

export interface ListMessageDigestsOptions {
  cursor?: string;
  limit?: number;
  query?: string;
  chatType?: MessageDigestChatType;
  status?: 'active' | 'paused' | 'needs_attention';
  sort?: 'name' | 'updatedAt' | 'nextRunAt';
  direction?: 'asc' | 'desc';
}

export interface ListMessageDigestRunsOptions {
  cursor?: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  generationStatus?: MessageDigestGenerationStatus;
  deliveryStatus?: MessageDigestDeliveryStatus;
  sort?: 'windowStart';
  direction?: 'asc' | 'desc';
}

export interface ListMessageDigestsResponse {
  items: MessageDigestDefinition[];
  nextCursor: string | null;
}

export interface ListMessageDigestRunsResponse {
  items: MessageDigestRun[];
  nextCursor: string | null;
}

export interface CreateMessageDigestResponse {
  disposition: 'created' | 'existing';
  activationAdjusted: 'delivery_setup_required' | null;
  definition: MessageDigestDefinition;
}

export type MessageDigestDeliveryReadiness =
  | {
      status: 'ready';
      maskedPrimaryNumber?: string;
      observationVersion: string;
      observedAt: string;
    }
  | {
      status: 'mapping_missing' | 'disconnected' | 'delivery_disabled';
      observationVersion: string;
      observedAt: string;
    };

export interface MessageDigestSchedulePreview {
  evaluatedAt: string;
  precedingBoundary: string;
  nextBoundary: string;
  timeZone: string;
}

export interface MessageDigestPreview {
  status: 'generated' | 'no_activity';
  window: { start: string; end: string; timeZone: string };
  source: { chatType: MessageDigestChatType; displayName: string };
  deliveryReadiness:
    | { status: 'ready'; maskedPrimaryNumber?: string }
    | { status: 'mapping_missing' | 'disconnected' | 'delivery_disabled' };
  messageCount: number;
  content: { headline: string; summaryMarkdown: string } | null;
}

export interface MessageDigestRunPreparation {
  token: string;
  preparedAt: string;
  window: { start: string; end: string; timeZone: string };
  source: { chatType: MessageDigestChatType; displayName: string };
  deliveryReadiness: { status: 'ready'; maskedPrimaryNumber?: string };
}

export interface ConfirmMessageDigestRunResponse {
  disposition: 'reserved' | 'existing';
  dispatchDisposition:
    | 'not_requested'
    | 'published'
    | 'retry_scheduled'
    | 'deferred'
    | 'terminal';
  run: MessageDigestRun;
}

export interface RetryMessageDigestRunResponse {
  disposition: 'retried' | 'existing';
  stage: 'generation' | 'delivery';
  run: MessageDigestRun;
}

export interface ResolveLegacyMessageDigestRunResponse {
  definitionId: string;
  runId: string;
}

export type MessageDigestErasureStage =
  | 'quiescing'
  | 'runs'
  | 'outbox'
  | 'state'
  | 'definition'
  | 'legacy'
  | 'completed';

export interface MessageDigestErasure {
  erasureRequestId: string;
  definitionId: string;
  status: 'in_progress' | 'completed';
  stage: MessageDigestErasureStage;
  deletedCounts: {
    runs: number;
    outbox: number;
    state: number;
    definition: number;
    legacy: number;
  };
  updatedAt: string;
  completedAt: string | null;
  nextAction: 'resume_delete' | null;
}

const DEFINITION_STATUS_LABELS: Record<MessageDigestEffectiveStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  deleting: 'Deleting',
  needs_attention: 'Needs attention',
};

const GENERATION_STATUS_LABELS: Record<MessageDigestGenerationStatus, string> = {
  queued: 'Queued',
  processing: 'Generating',
  completed: 'Completed',
  failed: 'Failed',
  skipped_no_activity: 'Skipped — no new messages',
};

const DELIVERY_STATUS_LABELS: Record<MessageDigestDeliveryStatus, string> = {
  not_sent: 'Not sent',
  pending: 'Pending',
  sent: 'Sent',
  ambiguous: 'Send status needs review',
  failed: 'Failed',
};

export function getMessageDigestStatusLabel(status: MessageDigestEffectiveStatus): string {
  return DEFINITION_STATUS_LABELS[status];
}

export function getMessageDigestGenerationStatusLabel(
  status: MessageDigestGenerationStatus
): string {
  return GENERATION_STATUS_LABELS[status];
}

export function getMessageDigestDeliveryStatusLabel(status: MessageDigestDeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

export function getMessageDigestSourceTypeLabel(chatType: MessageDigestChatType): string {
  return chatType === 'group' ? 'Group' : 'Direct';
}

export function getMessageDigestScheduleLabel(schedule: MessageDigestSchedule): string {
  if (schedule.kind === 'daily') return `Daily at ${schedule.localTime}`;
  if (schedule.kind === 'weekdays') return `Weekdays at ${schedule.localTime}`;
  const weekdayLabels: Record<MessageDigestWeekday, string> = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  };
  return `Every ${weekdayLabels[schedule.weekday]} at ${schedule.localTime}`;
}

export function maskMessageDigestPrimaryNumber(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return 'Primary WhatsApp';
  const markerIndex = Math.max(
    value.lastIndexOf('•'),
    value.lastIndexOf('*'),
    value.lastIndexOf('x'),
    value.lastIndexOf('X')
  );
  const safeSuffix = markerIndex >= 0 ? value.slice(markerIndex + 1) : value;
  const digits = safeSuffix.replace(/\D/gu, '').slice(-4);
  return digits === '' ? 'Primary WhatsApp' : `•••• ${digits}`;
}

export function isValidMessageDigestTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function formatMessageDigestDateTime(instant: string, timeZone: string): string {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp) || !isValidMessageDigestTimeZone(timeZone)) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(timestamp);
}
