import type { MessageDigestSchedule as CalendarMessageDigestSchedule } from '../schedules/messageDigestSchedule.js';

export type MessageDigestDefinitionStatus = 'migrating' | 'active' | 'paused' | 'deleting';

export interface MessageDigestSource {
  type: 'private_whatsapp';
  sourceAccountId: string;
  generationId: string;
  chatId: string;
  chatType: 'group' | 'direct';
  displayName: string;
  messageCount?: number | undefined;
  participantCount?: number | undefined;
  lastActivityAt?: string | undefined;
  sourceRevision: string;
}

export interface MessageDigestInstructions {
  templateId: 'fishing_group' | 'direct_sentiment' | 'custom';
  text: string;
  revision: string;
}

export type MessageDigestSchedule = CalendarMessageDigestSchedule;

export interface MessageDigestLatestRunProjection {
  runId: string;
  startedAt: string;
  generationStatus: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped_no_activity';
  processingStage:
    | 'queued'
    | 'reading_messages'
    | 'aggregating'
    | 'repairing'
    | 'completed'
    | 'failed'
    | 'skipped_no_activity';
  deliveryStatus: 'not_sent' | 'pending' | 'sent' | 'ambiguous' | 'failed';
}

export interface MessageDigestDefinition {
  version: 1;
  definitionId: string;
  userId: string;
  name: string;
  nameSortKey: string;
  status: MessageDigestDefinitionStatus;
  listStatus: 'active' | 'paused' | 'needs_attention';
  attentionCode: string | null;
  revision: number;
  erasureEpoch: number;
  activeErasureRequestId: string | null;
  hasRuns: boolean;
  source: MessageDigestSource;
  instructions: MessageDigestInstructions;
  schedule: MessageDigestSchedule;
  delivery: {
    type: 'whatsapp_primary';
    readinessObservationVersion: string;
    readinessObservedAt: string;
  };
  checkpointAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  /** Missing only on legacy records before the normalized Firestore codec has read them. */
  latestRun?: MessageDigestLatestRunProjection | null;
  createRequestIdDigest: string;
  activeMigrationId: string | null;
  legacyAlias: { groupKey: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDigestPendingWindow {
  runId: string;
  trigger: 'manual' | 'scheduled';
  requestIdDigest: string;
  windowStart: string;
  windowEnd: string;
  definitionRevision: number;
  stateRevision: number;
  erasureEpoch: number;
  reservedAt: string;
}

export interface MessageDigestState {
  version: 1;
  definitionId: string;
  userId: string;
  revision: number;
  checkpointAt: string;
  continuityMemoryMarkdown: string;
  precedingRunId: string | null;
  precedingRunHash: string | null;
  pendingWindow: MessageDigestPendingWindow | null;
  updatedAt: string;
}
