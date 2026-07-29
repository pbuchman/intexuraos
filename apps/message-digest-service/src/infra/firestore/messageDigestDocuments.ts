import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  MessageDigestDefinition,
  MessageDigestDefinitionStatus as DomainMessageDigestDefinitionStatus,
  MessageDigestState,
} from '../../domain/models/messageDigestDefinition.js';
import type {
  MessageDigestErasureRequest,
  MessageDigestMigrationActivation,
} from '../../domain/models/messageDigestErasure.js';
import type {
  MessageDigestDispatchOutbox,
  MessageDigestRun,
} from '../../domain/models/messageDigestRun.js';

export const MESSAGE_DIGEST_DEFINITIONS_COLLECTION = 'message_digest_definitions';
export const MESSAGE_DIGEST_RUNS_COLLECTION = 'message_digest_runs';
export const MESSAGE_DIGEST_STATES_COLLECTION = 'message_digest_states';
export const MESSAGE_DIGEST_DISPATCH_OUTBOX_COLLECTION = 'message_digest_dispatch_outbox';
export const MESSAGE_DIGEST_ERASURE_REQUESTS_COLLECTION = 'message_digest_erasure_requests';
export const MESSAGE_DIGEST_MIGRATION_ACTIVATIONS_COLLECTION =
  'message_digest_migration_activations';

const isoTimestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const definitionIdSchema = z.string().regex(/^md_[A-Za-z0-9_-]{3,120}$/u);
const runIdSchema = z.string().regex(/^mdr_[A-Za-z0-9_-]{3,160}$/u);
const outboxIdSchema = z.string().regex(/^mdo_[A-Za-z0-9_-]{3,160}$/u);
const erasureRequestIdSchema = z.string().regex(/^mde_[A-Za-z0-9_-]{3,160}$/u);
const migrationIdSchema = z.string().regex(/^mdm_[A-Za-z0-9_-]{3,160}$/u);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const boundedPrivateIdSchema = z.string().trim().min(1).max(512);
const userIdSchema = z.string().trim().min(1).max(256);
const sourceRevisionSchema = z.string().trim().min(1).max(4096);

export const MessageDigestDefinitionStatusSchema = z.enum([
  'migrating',
  'active',
  'paused',
  'deleting',
]);
export type MessageDigestDefinitionStatus = DomainMessageDigestDefinitionStatus;

export const MessageDigestSourceSchema = z
  .object({
    type: z.literal('private_whatsapp'),
    sourceAccountId: boundedPrivateIdSchema,
    generationId: boundedPrivateIdSchema,
    chatId: boundedPrivateIdSchema,
    chatType: z.enum(['group', 'direct']),
    displayName: z.string().trim().min(1).max(200),
    messageCount: z.number().int().nonnegative().optional(),
    participantCount: z.number().int().nonnegative().optional(),
    lastActivityAt: isoTimestampSchema.optional(),
    sourceRevision: sourceRevisionSchema,
  })
  .strict();

export const MessageDigestInstructionsSchema = z
  .object({
    templateId: z.enum(['fishing_group', 'direct_sentiment', 'custom']),
    text: z.string().trim().min(20).max(4_000),
    revision: z.string().trim().min(1).max(64),
  })
  .strict();

const messageDigestLocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const messageDigestTimeZoneSchema = z.string().trim().min(1).max(100);
export const MessageDigestScheduleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('daily'),
      localTime: messageDigestLocalTimeSchema,
      timeZone: messageDigestTimeZoneSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('weekdays'),
      localTime: messageDigestLocalTimeSchema,
      timeZone: messageDigestTimeZoneSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('weekly'),
      weekday: z.enum([
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ]),
      localTime: messageDigestLocalTimeSchema,
      timeZone: messageDigestTimeZoneSchema,
    })
    .strict(),
]);

const messageDigestGenerationStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'skipped_no_activity',
]);
const messageDigestProcessingStageSchema = z.enum([
  'queued',
  'reading_messages',
  'aggregating',
  'repairing',
  'completed',
  'failed',
  'skipped_no_activity',
]);
const messageDigestDeliveryStatusSchema = z.enum([
  'not_sent',
  'pending',
  'sent',
  'ambiguous',
  'failed',
]);

const messageDigestLatestRunProjectionSchema = z
  .object({
    runId: runIdSchema,
    startedAt: isoTimestampSchema,
    generationStatus: messageDigestGenerationStatusSchema,
    processingStage: messageDigestProcessingStageSchema,
    deliveryStatus: messageDigestDeliveryStatusSchema,
  })
  .strict()
  .superRefine((latestRun, context) => {
    if (!isCoherentGenerationStage(latestRun.generationStatus, latestRun.processingStage)) {
      context.addIssue({
        code: 'custom',
        message: 'Latest-run generation status and processing stage conflict',
        path: ['processingStage'],
      });
    }
  });

export const MessageDigestDefinitionDocumentSchema = z
  .object({
    version: z.literal(1),
    definitionId: definitionIdSchema,
    userId: userIdSchema,
    name: z.string().trim().min(1).max(80),
    nameSortKey: z.string().trim().min(1).max(200),
    status: MessageDigestDefinitionStatusSchema,
    listStatus: z.enum(['active', 'paused', 'needs_attention']),
    attentionCode: z.string().trim().min(1).max(128).nullable(),
    revision: z.number().int().positive(),
    erasureEpoch: z.number().int().nonnegative(),
    activeErasureRequestId: erasureRequestIdSchema.nullable(),
    hasRuns: z.boolean(),
    source: MessageDigestSourceSchema,
    instructions: MessageDigestInstructionsSchema,
    schedule: MessageDigestScheduleSchema,
    delivery: z
      .object({
        type: z.literal('whatsapp_primary'),
        readinessObservationVersion: z.string().trim().min(1).max(512),
        readinessObservedAt: isoTimestampSchema,
      })
      .strict(),
    checkpointAt: isoTimestampSchema,
    nextRunAt: isoTimestampSchema,
    lastRunAt: isoTimestampSchema.nullable(),
    latestRun: messageDigestLatestRunProjectionSchema.nullable().default(null),
    createRequestIdDigest: sha256Schema,
    activeMigrationId: migrationIdSchema.nullable(),
    legacyAlias: z
      .object({
        groupKey: z.string().trim().min(1).max(200),
      })
      .strict()
      .nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (Date.parse(definition.updatedAt) < Date.parse(definition.createdAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Definition update precedes creation',
        path: ['updatedAt'],
      });
    }
    if (definition.status === 'active' && definition.listStatus === 'paused') {
      context.addIssue({
        code: 'custom',
        message: 'Active definition cannot have paused list status',
        path: ['listStatus'],
      });
    }
    if (definition.status === 'paused' && definition.listStatus === 'active') {
      context.addIssue({
        code: 'custom',
        message: 'Paused definition cannot have active list status',
        path: ['listStatus'],
      });
    }
    if (definition.listStatus === 'needs_attention' && definition.attentionCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'Needs-attention projection requires a safe code',
        path: ['attentionCode'],
      });
    }
    if (definition.listStatus !== 'needs_attention' && definition.attentionCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Attention code requires needs-attention projection',
        path: ['attentionCode'],
      });
    }
    if (
      (definition.status === 'deleting') !== (definition.activeErasureRequestId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Deleting definition must retain exactly one active erasure request',
        path: ['activeErasureRequestId'],
      });
    }
  });

export const MessageDigestPendingWindowSchema = z
  .object({
    runId: runIdSchema,
    trigger: z.enum(['manual', 'scheduled']),
    requestIdDigest: sha256Schema,
    windowStart: isoTimestampSchema,
    windowEnd: isoTimestampSchema,
    definitionRevision: z.number().int().positive(),
    stateRevision: z.number().int().positive(),
    erasureEpoch: z.number().int().nonnegative(),
    reservedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.windowEnd) <= Date.parse(window.windowStart)) {
      context.addIssue({
        code: 'custom',
        message: 'Pending window must advance its checkpoint',
        path: ['windowEnd'],
      });
    }
  });

export const MessageDigestStateDocumentSchema = z
  .object({
    version: z.literal(1),
    definitionId: definitionIdSchema,
    userId: userIdSchema,
    revision: z.number().int().positive(),
    checkpointAt: isoTimestampSchema,
    continuityMemoryMarkdown: z.string().max(8_000),
    precedingRunId: runIdSchema.nullable(),
    precedingRunHash: sha256Schema.nullable(),
    pendingWindow: MessageDigestPendingWindowSchema.nullable(),
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.pendingWindow !== null &&
      Date.parse(state.pendingWindow.windowStart) !== Date.parse(state.checkpointAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending window must begin at the state checkpoint',
        path: ['pendingWindow', 'windowStart'],
      });
    }
  });

const leaseSchema = z
  .object({
    ownerDigest: sha256Schema,
    fence: z.number().int().positive(),
    expiresAt: isoTimestampSchema,
    renewedAt: isoTimestampSchema,
  })
  .strict();

const deliveryAuthorizationSchema = z
  .object({
    ownerDigest: sha256Schema,
    fence: z.number().int().positive(),
    expiresAt: isoTimestampSchema,
    renewedAt: isoTimestampSchema,
    releasedAt: isoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.renewedAt) > Date.parse(authorization.expiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery authorization renewal must not follow expiry',
        path: ['renewedAt'],
      });
    }
    if (
      authorization.releasedAt !== null &&
      (Date.parse(authorization.releasedAt) < Date.parse(authorization.renewedAt) ||
        Date.parse(authorization.releasedAt) > Date.parse(authorization.expiresAt))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery authorization release must fall within its lease window',
        path: ['releasedAt'],
      });
    }
  });

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict();

export const MessageDigestRunDocumentSchema = z
  .object({
    version: z.literal(1),
    runId: runIdSchema,
    userId: userIdSchema,
    definitionId: definitionIdSchema,
    definitionNameSnapshot: z.string().trim().min(1).max(80),
    recordRole: z.enum(['canonical', 'audit']),
    visibilityMigrationId: migrationIdSchema.nullable(),
    migrationDate: localDateSchema.nullable().default(null),
    provenance: z
      .enum(['native', 'legacy_mobile_notification', 'private_whatsapp_replay'])
      .default('native'),
    deliveryMode: z.enum(['whatsapp', 'silent']).default('whatsapp'),
    predecessorRunHash: sha256Schema.nullable().default(null),
    runHash: sha256Schema.nullable().default(null),
    sourceWatermarkHash: sha256Schema.nullable().default(null),
    sourceCandidateHash: sha256Schema.nullable().default(null),
    candidateHash: sha256Schema.nullable().default(null),
    definitionRevision: z.number().int().positive(),
    instructionRevision: z.string().trim().min(1).max(64),
    trigger: z.enum(['manual', 'scheduled']),
    requestIdDigest: sha256Schema,
    windowStart: isoTimestampSchema,
    windowEnd: isoTimestampSchema,
    scheduledBoundary: isoTimestampSchema,
    generationStatus: messageDigestGenerationStatusSchema,
    processingStage: messageDigestProcessingStageSchema,
    lease: leaseSchema.nullable(),
    deliveryAuthorization: deliveryAuthorizationSchema.nullable().default(null),
    attempts: z.number().int().nonnegative(),
    sourceSnapshot: MessageDigestSourceSchema,
    instructionsSnapshot: MessageDigestInstructionsSchema,
    scheduleSnapshot: MessageDigestScheduleSchema,
    headline: z.string().trim().min(1).max(200).nullable(),
    summaryMarkdown: z.string().max(12_000).nullable(),
    evidenceMessageRefs: z.array(z.string().regex(/^[0-9a-f]{64}$/u)).max(1_000),
    continuityMemoryMarkdown: z.string().max(8_000).nullable(),
    effectiveMessageCount: z.number().int().nonnegative().nullable(),
    promptVersion: z.string().trim().min(1).max(64).nullable(),
    model: z.string().trim().min(1).max(200).nullable(),
    usage: usageSchema.nullable(),
    delivery: z
      .object({
        type: z.literal('whatsapp_primary'),
        status: messageDigestDeliveryStatusSchema,
        idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u),
        acceptedAt: isoTimestampSchema.nullable(),
        failedAt: isoTimestampSchema.nullable(),
        failureCode: z.string().trim().min(1).max(128).nullable(),
        reconciliationAttempts: z.number().int().nonnegative(),
        nextCheckAt: isoTimestampSchema.nullable(),
        missingSince: isoTimestampSchema.nullable(),
      })
      .strict(),
    safeFailureCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (Date.parse(run.windowEnd) <= Date.parse(run.windowStart)) {
      context.addIssue({
        code: 'custom',
        message: 'Run window must be non-empty',
        path: ['windowEnd'],
      });
    }
    if (!isCoherentGenerationStage(run.generationStatus, run.processingStage)) {
      context.addIssue({
        code: 'custom',
        message: 'Generation status and processing stage conflict',
        path: ['processingStage'],
      });
    }
    if (run.generationStatus === 'failed' && run.safeFailureCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed run requires a safe failure code',
        path: ['safeFailureCode'],
      });
    }
    if ((run.delivery.status === 'pending') !== (run.delivery.nextCheckAt !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Pending delivery must retain exactly one next reconciliation time',
        path: ['delivery', 'nextCheckAt'],
      });
    }
    if (run.delivery.status !== 'pending' && run.delivery.missingSince !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Only a pending delivery may retain first-missing time',
        path: ['delivery', 'missingSince'],
      });
    }
    const migrated = run.provenance !== 'native';
    if (
      migrated &&
      (run.recordRole !== 'canonical' ||
        run.migrationDate === null ||
        run.deliveryMode !== 'silent' ||
        run.runHash === null ||
        run.candidateHash === null ||
        run.delivery.status !== 'not_sent' ||
        run.generationStatus === 'queued' ||
        run.generationStatus === 'processing' ||
        run.generationStatus === 'failed')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Migrated run requires a complete silent canonical proof',
        path: ['provenance'],
      });
    }
    if (
      run.provenance === 'private_whatsapp_replay' &&
      (run.sourceWatermarkHash === null || run.sourceCandidateHash === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Private WhatsApp replay requires source proof hashes',
        path: ['sourceCandidateHash'],
      });
    }
    if (
      run.provenance === 'legacy_mobile_notification' &&
      (run.sourceWatermarkHash !== null || run.sourceCandidateHash !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Legacy import must keep unavailable source proofs explicit',
        path: ['sourceCandidateHash'],
      });
    }
    if (
      !migrated &&
      (run.migrationDate !== null ||
        run.deliveryMode !== 'whatsapp' ||
        run.predecessorRunHash !== null ||
        run.runHash !== null ||
        run.sourceWatermarkHash !== null ||
        run.sourceCandidateHash !== null ||
        run.candidateHash !== null ||
        run.visibilityMigrationId !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Native run cannot carry migration-only proof fields',
        path: ['provenance'],
      });
    }
  });

function isCoherentGenerationStage(
  generationStatus: z.infer<typeof messageDigestGenerationStatusSchema>,
  processingStage: z.infer<typeof messageDigestProcessingStageSchema>
): boolean {
  return (
    (generationStatus === 'queued' && processingStage === 'queued') ||
    (generationStatus === 'processing' &&
      ['reading_messages', 'aggregating', 'repairing'].includes(processingStage)) ||
    (generationStatus === 'completed' && processingStage === 'completed') ||
    (generationStatus === 'failed' && processingStage === 'failed') ||
    (generationStatus === 'skipped_no_activity' && processingStage === 'skipped_no_activity')
  );
}

const dispatchClaimSchema = z
  .object({
    ownerDigest: sha256Schema,
    fence: z.number().int().positive(),
    expiresAt: isoTimestampSchema,
  })
  .strict();

export const MessageDigestDispatchOutboxDocumentSchema = z
  .object({
    version: z.literal(1),
    outboxId: outboxIdSchema,
    userId: userIdSchema,
    definitionId: definitionIdSchema,
    runId: runIdSchema,
    kind: z.enum(['run_request', 'whatsapp_delivery']),
    status: z.enum(['pending', 'published', 'terminal']),
    payloadJson: z.string().min(2).max(256_000),
    payloadDigest: sha256Schema,
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: isoTimestampSchema,
    claim: dispatchClaimSchema.nullable(),
    publishedAt: isoTimestampSchema.nullable(),
    terminalCode: z.string().trim().min(1).max(128).nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((outbox, context) => {
    const actualDigest = createHash('sha256').update(outbox.payloadJson, 'utf8').digest('hex');
    if (actualDigest !== outbox.payloadDigest) {
      context.addIssue({
        code: 'custom',
        message: 'Dispatch payload digest mismatch',
        path: ['payloadDigest'],
      });
    }
    if (outbox.status === 'published' && outbox.publishedAt === null) {
      context.addIssue({
        code: 'custom',
        message: 'Published dispatch requires timestamp',
        path: ['publishedAt'],
      });
    }
    if (outbox.status === 'terminal' && outbox.terminalCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal dispatch requires code',
        path: ['terminalCode'],
      });
    }
  });

const erasedCountsSchema = z
  .object({
    runs: z.number().int().nonnegative(),
    outbox: z.number().int().nonnegative(),
    state: z.number().int().nonnegative(),
    definition: z.number().int().nonnegative(),
    legacy: z.number().int().nonnegative(),
  })
  .strict();

export const MessageDigestErasureRequestDocumentSchema = z
  .object({
    version: z.literal(1),
    erasureRequestId: erasureRequestIdSchema,
    requestIdDigest: sha256Schema,
    userId: userIdSchema,
    definitionId: definitionIdSchema,
    erasureEpoch: z.number().int().positive(),
    stage: z.enum([
      'quiescing',
      'runs',
      'outbox',
      'state',
      'definition',
      'legacy',
      'completed',
    ]),
    cursor: z.string().max(512).nullable(),
    deletedCounts: erasedCountsSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
    expiresAt: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.stage === 'completed' &&
      (request.completedAt === null || request.expiresAt === null || request.cursor !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed erasure must be a content-free expiring tombstone',
        path: ['stage'],
      });
    }
  });

export const MessageDigestMigrationActivationDocumentSchema = z
  .object({
    version: z.literal(1),
    migrationId: migrationIdSchema,
    userId: userIdSchema,
    definitionId: definitionIdSchema,
    legacyGroupKey: z.string().trim().min(1).max(200).nullable().default(null),
    status: z.enum(['preparing', 'staging', 'active', 'rollback_pending', 'failed']),
    leaseOwnerDigest: sha256Schema.nullable(),
    leaseExpiresAt: isoTimestampSchema.nullable(),
    step: z.string().trim().min(1).max(128),
    cutoverDeadline: isoTimestampSchema,
    baselineHash: sha256Schema.nullable(),
    replayHash: sha256Schema.nullable(),
    verificationHash: sha256Schema.nullable().default(null),
    safeCounts: z.record(z.number().int().nonnegative()),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((activation, context) => {
    if (
      activation.status === 'active' &&
      (activation.legacyGroupKey === null ||
        activation.baselineHash === null ||
        activation.replayHash === null ||
        activation.verificationHash === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Active migration requires complete safe verification proofs',
        path: ['status'],
      });
    }
  });

export type MessageDigestDefinitionDocument = MessageDigestDefinition;
export type MessageDigestStateDocument = MessageDigestState;
export type MessageDigestDeliveryAuthorizationDocument = z.infer<
  typeof deliveryAuthorizationSchema
>;
export type MessageDigestRunDocument = MessageDigestRun & {
  deliveryAuthorization: MessageDigestDeliveryAuthorizationDocument | null;
};
export type MessageDigestDispatchOutboxDocument = MessageDigestDispatchOutbox;
export type MessageDigestErasureRequestDocument = MessageDigestErasureRequest;
export type MessageDigestMigrationActivationDocument = MessageDigestMigrationActivation;

export function canTransitionMessageDigestDefinitionStatus(
  current: MessageDigestDefinitionStatus,
  next: MessageDigestDefinitionStatus
): boolean {
  if (current === next) return true;
  if (current === 'deleting') return false;
  if (current === 'migrating') return next === 'active' || next === 'deleting';
  if (next === 'deleting') return true;
  return (current === 'active' && next === 'paused') || (current === 'paused' && next === 'active');
}

interface CursorIssueInput {
  kind:
    | 'definitions'
    | 'due_definitions'
    | 'runs'
    | 'legacy_runs'
    | 'ready_dispatches'
    | 'pending_deliveries';
  queryFingerprint: string;
  values: readonly (string | number | null)[];
}

interface CursorReadBinding {
  kind: CursorIssueInput['kind'];
  queryFingerprint: string;
}

interface CursorEnvelope extends CursorIssueInput {
  version: 1;
  issuedAt: number;
  expiresAt: number;
}

export interface MessageDigestCursorCodec {
  issue(input: CursorIssueInput): string;
  read(cursor: string, binding: CursorReadBinding): CursorReadResult;
}

type CursorReadResult =
  | { ok: true; value: (string | number | null)[] }
  | {
      ok: false;
      error: { code: 'INVALID_CURSOR'; message: 'Invalid Message Digest cursor' };
    };

const cursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum([
      'definitions',
      'due_definitions',
      'runs',
      'legacy_runs',
      'ready_dispatches',
      'pending_deliveries',
    ]),
    queryFingerprint: z.string().min(1).max(256),
    values: z.array(z.union([z.string().max(512), z.number().finite(), z.null()])).max(8),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export function createMessageDigestCursorCodec(config: {
  secret: string;
  now?: (() => number) | undefined;
  ttlMs?: number | undefined;
}): MessageDigestCursorCodec {
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? 24 * 60 * 60 * 1000;
  if (config.secret.length === 0 || !Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Invalid Message Digest cursor configuration');
  }
  const key = createHash('sha256')
    .update('message-digest-cursor-v1\0', 'utf8')
    .update(config.secret, 'utf8')
    .digest();

  return {
    issue(input): string {
      const issuedAt = now();
      const envelope: CursorEnvelope = {
        version: 1,
        kind: input.kind,
        queryFingerprint: input.queryFingerprint,
        values: [...input.values],
        issuedAt,
        expiresAt: issuedAt + ttlMs,
      };
      const parsed = cursorEnvelopeSchema.parse(envelope);
      const payload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
      const signature = createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
      return `mdc1.${payload}.${signature}`;
    },

    read(cursor, binding): CursorReadResult {
      try {
        const parts = cursor.split('.');
        if (parts.length !== 3 || parts[0] !== 'mdc1') return invalidCursor();
        const [, payload, suppliedSignature] = parts as [string, string, string];
        const expectedSignature = createHmac('sha256', key).update(payload, 'utf8').digest();
        const suppliedBytes = Buffer.from(suppliedSignature, 'base64url');
        if (
          suppliedBytes.length !== expectedSignature.length ||
          !timingSafeEqual(suppliedBytes, expectedSignature)
        ) {
          return invalidCursor();
        }
        const envelope = cursorEnvelopeSchema.safeParse(
          JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
        );
        if (!envelope.success) return invalidCursor();
        const currentTime = now();
        if (
          envelope.data.kind !== binding.kind ||
          envelope.data.queryFingerprint !== binding.queryFingerprint ||
          envelope.data.issuedAt > currentTime + 30_000 ||
          envelope.data.expiresAt <= currentTime ||
          envelope.data.expiresAt - envelope.data.issuedAt !== ttlMs
        ) {
          return invalidCursor();
        }
        return { ok: true, value: envelope.data.values };
      } catch {
        return invalidCursor();
      }
    },
  };
}

function invalidCursor(): {
  ok: false;
  error: { code: 'INVALID_CURSOR'; message: 'Invalid Message Digest cursor' };
} {
  return {
    ok: false,
    error: { code: 'INVALID_CURSOR', message: 'Invalid Message Digest cursor' },
  };
}
