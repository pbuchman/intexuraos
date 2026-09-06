import type {
  MessageDigestInstructions,
  MessageDigestSchedule,
  MessageDigestSource,
} from './messageDigestDefinition.js';

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

export interface MessageDigestRun {
  version: 1;
  runId: string;
  userId: string;
  definitionId: string;
  definitionNameSnapshot: string;
  recordRole: 'canonical' | 'audit';
  visibilityMigrationId: string | null;
  /** Present after the normalized Firestore codec reads native or migrated records. */
  migrationDate?: string | null;
  provenance?: 'native' | 'legacy_mobile_notification' | 'private_whatsapp_replay';
  deliveryMode?: 'whatsapp' | 'silent';
  predecessorRunHash?: string | null;
  runHash?: string | null;
  sourceWatermarkHash?: string | null;
  sourceCandidateHash?: string | null;
  candidateHash?: string | null;
  definitionRevision: number;
  instructionRevision: string;
  trigger: 'manual' | 'scheduled';
  requestIdDigest: string;
  windowStart: string;
  windowEnd: string;
  scheduledBoundary: string;
  generationStatus: MessageDigestGenerationStatus;
  processingStage: MessageDigestProcessingStage;
  lease: {
    ownerDigest: string;
    fence: number;
    expiresAt: string;
    renewedAt: string;
  } | null;
  attempts: number;
  sourceSnapshot: MessageDigestSource;
  instructionsSnapshot: MessageDigestInstructions;
  scheduleSnapshot: MessageDigestSchedule;
  headline: string | null;
  summaryMarkdown: string | null;
  evidenceMessageRefs: string[];
  continuityMemoryMarkdown: string | null;
  effectiveMessageCount: number | null;
  promptVersion: string | null;
  model: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  } | null;
  delivery: {
    type: 'whatsapp_primary';
    status: 'not_sent' | 'pending' | 'sent' | 'ambiguous' | 'failed';
    idempotencyKey: string;
    acceptedAt: string | null;
    failedAt: string | null;
    failureCode: string | null;
    reconciliationAttempts: number;
    nextCheckAt: string | null;
    missingSince: string | null;
  };
  safeFailureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MessageDigestDispatchOutbox {
  version: 1;
  outboxId: string;
  userId: string;
  definitionId: string;
  runId: string;
  kind: 'run_request' | 'whatsapp_delivery';
  status: 'pending' | 'published' | 'terminal';
  payloadJson: string;
  payloadDigest: string;
  attempts: number;
  nextAttemptAt: string;
  claim: {
    ownerDigest: string;
    fence: number;
    expiresAt: string;
  } | null;
  publishedAt: string | null;
  terminalCode: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}
