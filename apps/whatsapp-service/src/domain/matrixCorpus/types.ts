/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Closed-schema refinements intentionally recheck discriminants for persistence safety. */
import {
  matrixCorpusAttestedIngestPayloadV1Schema,
  matrixCorpusCapabilityTokenSchema,
  matrixCorpusCapabilityConsumeFactsV1Schema,
  matrixCorpusCapabilityV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
  matrixCorpusSignedIngestV1Schema,
  matrixCorpusSignedTerminalControlV1Schema,
  matrixCorpusTerminalControlV1Schema,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusCapabilityConsumeFactsV1,
  type MatrixCorpusCapabilityIssueRequestV1,
  type MatrixCorpusCapabilityV1,
  type MatrixCorpusTerminalControlV1,
} from '@intexuraos/http-contracts';
import type { Logger } from '@intexuraos/common-core';
import { z } from 'zod';

import {
  matrixCorpusControlStatusResultSchema,
  matrixCorpusCurrentAcceptanceResultSchema,
  matrixCorpusTerminalAuthoritativeWinnerV1Schema,
  type MatrixCorpusControlStatusResult,
  type MatrixCorpusCurrentAcceptanceResult,
  type MatrixCorpusTerminalAuthoritativeWinnerV1,
} from './ports/intexAgentMatrixCorpusClient.js';
import type { IntexAgentMatrixCorpusClient } from './ports/intexAgentMatrixCorpusClient.js';
import type { MatrixCorpusRepository } from './ports/matrixCorpusRepository.js';

export { matrixCorpusCapabilityIssueRequestV1Schema } from '@intexuraos/http-contracts';

export const MATRIX_CORPUS_RUNTIME_AUDIENCE = 'hetzner-prod' as const;
export const MATRIX_CORPUS_MAX_RENEW_RECEIPTS_PER_RUN = 400 as const;
export const MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN = 800 as const;
export const MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY = 2 as const;
export const MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN = 64 as const;
export const MATRIX_CORPUS_MAX_CLEANUP_CHUNK_RECEIPTS_PER_RUN = 64 as const;
export const MATRIX_CORPUS_MAX_CLEANUP_MUTATED_DOCUMENTS_PER_CHUNK = 100 as const;
export const MATRIX_CORPUS_MAX_CLEANUP_CHILD_DELETES_PER_CHUNK = 96 as const;
export const MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN =
  MATRIX_CORPUS_MAX_CLEANUP_CHUNK_RECEIPTS_PER_RUN *
  MATRIX_CORPUS_MAX_CLEANUP_CHILD_DELETES_PER_CHUNK;

export type MatrixCorpusRuntimeAudience = typeof MATRIX_CORPUS_RUNTIME_AUDIENCE;

export const matrixCorpusRuntimeAudienceSchema = z.literal(MATRIX_CORPUS_RUNTIME_AUDIENCE);
export const matrixCorpusLeasePhaseSchema = z.enum([
  'provisioning',
  'active',
  'quiescing',
  'release_pending',
  'abandon_pending',
  'released',
  'abandoned',
]);
export type MatrixCorpusLeasePhase = z.infer<typeof matrixCorpusLeasePhaseSchema>;

export const matrixCorpusCapabilityPhaseSchema = z.enum(['start', 'turn', 'confirmation']);
export type MatrixCorpusCapabilityPhase = z.infer<typeof matrixCorpusCapabilityPhaseSchema>;

export const matrixCorpusOutboxStatusSchema = z.enum(['pending', 'claimed', 'published', 'closed']);
export type MatrixCorpusOutboxStatus = z.infer<typeof matrixCorpusOutboxStatusSchema>;

export const matrixCorpusTerminalKindSchema = z.enum(['release', 'abandoned']);
export type MatrixCorpusTerminalKind = z.infer<typeof matrixCorpusTerminalKindSchema>;

export const matrixCorpusOperationNameSchema = z.enum([
  'acquire',
  'activate',
  'renew',
  'quiesce',
  'release',
]);
export type MatrixCorpusOperationName = z.infer<typeof matrixCorpusOperationNameSchema>;

export const matrixCorpusControlCodeSchema = z.enum([
  'ACQUIRED',
  'ACTIVATED',
  'LEASE_RENEWED',
  'CAPABILITY_ISSUED',
  'MATRIX_SEND_PROOF_RECORDED',
  'INGEST_ENQUEUED',
  'QUIESCED',
  'RELEASE_PENDING',
  'ABANDON_PENDING',
  'TRANSPORT_STATUS',
  'RUN_CLEANUP_PROGRESS',
  'RUN_CLEANED',
  'OUTBOX_CLAIMED',
  'OUTBOX_CLAIM_RENEWED',
  'OUTBOX_ACKNOWLEDGED',
  'ALREADY_APPLIED',
  'RUN_ALREADY_ACTIVE',
  'NOT_FOUND',
  'LEASE_EXPIRED',
  'STALE_FENCE',
  'PHASE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CAPABILITY_REPLAY',
  'CAPABILITY_EXPIRED',
  'CAPABILITY_REVOKED',
  'CAPABILITY_MISMATCH',
  'TRANSPORT_REPLAY',
  'TERMINAL_RECEIPT_LIMIT',
  'CLAIM_CONFLICT',
  'NOT_READY',
  'CORRUPT_STATE',
]);
export type MatrixCorpusControlCode = z.infer<typeof matrixCorpusControlCodeSchema>;

export const matrixCorpusCorruptRecordKindSchema = z.enum([
  'input_contract',
  'command',
  'lease',
  'lease_history',
  'renew_receipt',
  'issuance_receipt',
  'capability',
  'transport_receipt',
  'ingest_outbox',
  'terminal_outbox',
  'cleanup_progress',
  'dependency_result',
  'repository_result',
]);
export type MatrixCorpusCorruptRecordKind = z.infer<typeof matrixCorpusCorruptRecordKindSchema>;

export const matrixCorpusRawIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const matrixCorpusRawTransportMessageIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7E]+$/);
export const matrixCorpusLeaseTtlMsSchema = z.number().int().min(1).max(300_000);
export const matrixCorpusCapabilityTtlMsSchema = z.number().int().min(1).max(300_000);

const nonNegativeBoundedIntegerSchema = z.number().int().min(0).max(1_000_000);
const cleanupProgressRevisionSchema = z.number().int().min(0).max(63);
const cleanupProgressCommittedRevisionSchema = z.number().int().min(1).max(63);
const cleanupFinalRevisionSchema = z.number().int().min(1).max(64);
const cleanupRemainingChildCountSchema = z.number().int().min(1).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN);
function hasCleanupProgressBudget(committedRevision: number, remainingChildCount: number): boolean {
  return (
    remainingChildCount <=
    (MATRIX_CORPUS_MAX_CLEANUP_CHUNK_RECEIPTS_PER_RUN - committedRevision) *
      MATRIX_CORPUS_MAX_CLEANUP_CHILD_DELETES_PER_CHUNK
  );
}
const booleanDrainSchema = z
  .object({
    consumedCapabilityCount: nonNegativeBoundedIntegerSchema,
    terminalIntexMarkerCount: nonNegativeBoundedIntegerSchema,
    terminalOutboxCount: nonNegativeBoundedIntegerSchema,
    replyOrDeliveryWorkInFlight: nonNegativeBoundedIntegerSchema,
    drained: z.boolean(),
  })
  .strict();
const outboxClaimPurposeSchema = z.enum(['publish', 'terminal_marker_recovery']);
function hasExactFiveMinuteTtl(start: string, end: string): boolean {
  const duration = Date.parse(end) - Date.parse(start);
  return duration > 0 && duration <= 300_000;
}
const outboxClaimSchema = z
  .object({
    ownerDigest: matrixCorpusKeyedDigestSchema,
    purpose: outboxClaimPurposeSchema,
    claimedAt: matrixCorpusRfc3339TimestampSchema,
    expiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine((claim) => hasExactFiveMinuteTtl(claim.claimedAt, claim.expiresAt), {
    message: 'Claim expiry must be positive and at most five minutes',
  });
export const matrixCorpusOutboxClaimV1Schema = outboxClaimSchema;
export type MatrixCorpusOutboxClaimV1 = z.infer<typeof matrixCorpusOutboxClaimV1Schema>;

export const matrixCorpusLeaseBindingV1Schema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
  })
  .strict();
export type MatrixCorpusLeaseBindingV1 = z.infer<typeof matrixCorpusLeaseBindingV1Schema>;
const exactlyOne = (values: readonly (string | null)[]): boolean =>
  values.filter((value) => value !== null).length === 1;

export const matrixCorpusPersistedReplayProjectionV1Schema = z.union([
  z
    .object({
      operation: z.literal('acquire'),
      result: z.literal('acquired'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('provisioning'),
      acquiredAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('activate'),
      result: z.literal('activated'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      activatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('renew'),
      result: z.literal('renewed'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      renewedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('issue'),
      result: z.literal('issued'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('consume'),
      result: z.literal('enqueued'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      ingestReceiptId: matrixCorpusSafeIdSchema,
      ingestOutboxId: matrixCorpusSafeIdSchema,
      acceptedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('quiesce'),
      result: z.literal('quiesced'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('quiescing'),
      quiescedAt: matrixCorpusRfc3339TimestampSchema,
      drained: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('release'),
      result: z.literal('release_pending'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      createdAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((projection) => projection.terminalControlId === projection.eventId, {
      message: 'Release terminal identifiers must match',
    }),
  z
    .object({
      operation: z.literal('abandon'),
      result: z.literal('abandon_pending'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('abandon_pending'),
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      reconciledAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((projection) => projection.terminalControlId === projection.eventId, {
      message: 'Abandoned terminal identifiers must match',
    }),
  z
    .object({
      operation: z.literal('cleanup'),
      result: z.literal('progress'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      committedRevision: cleanupProgressCommittedRevisionSchema,
      remainingChildCount: cleanupRemainingChildCountSchema,
      chunkCommittedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('cleanup'),
      result: z.literal('cleaned'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      finalRevision: cleanupFinalRevisionSchema,
      cleanedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]).superRefine((projection, context) => {
  const hasInvalidTtl =
    (projection.operation === 'acquire' &&
      !hasExactFiveMinuteTtl(projection.acquiredAt, projection.expiresAt)) ||
    (projection.operation === 'renew' && !hasExactFiveMinuteTtl(projection.renewedAt, projection.expiresAt)) ||
    (projection.operation === 'issue' && !hasExactFiveMinuteTtl(projection.issuedAt, projection.expiresAt));
  if (hasInvalidTtl)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Replay projection TTL must be positive and at most five minutes',
    });
  if (
    projection.operation === 'cleanup' &&
    projection.result === 'progress' &&
    !hasCleanupProgressBudget(projection.committedRevision, projection.remainingChildCount)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress exceeds remaining transaction budget' });
});
export type MatrixCorpusPersistedReplayProjectionV1 = z.infer<
  typeof matrixCorpusPersistedReplayProjectionV1Schema
>;

function canonicalizeReplayProjectionValue(value: unknown): string {
  if (typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalizeReplayProjectionValue(nestedValue)}`)
    .join(',')}}`;
}

export function canonicalMatrixCorpusPersistedReplayProjectionV1(
  input: MatrixCorpusPersistedReplayProjectionV1
): string {
  return canonicalizeReplayProjectionValue(matrixCorpusPersistedReplayProjectionV1Schema.parse(input));
}

export const matrixCorpusOperationReceiptV1Schema = z
  .object({
    version: z.literal(1),
    operation: z.enum(['acquire', 'activate', 'quiesce', 'release']),
    idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
    resultCode: z.enum(['ACQUIRED', 'ACTIVATED', 'QUIESCED', 'RELEASE_PENDING']),
    replayProjection: matrixCorpusPersistedReplayProjectionV1Schema,
    resultDigest: matrixCorpusSha256DigestSchema,
    recordedAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedCode = {
      acquire: 'ACQUIRED',
      activate: 'ACTIVATED',
      quiesce: 'QUIESCED',
      release: 'RELEASE_PENDING',
    } as const;
    if (
      receipt.replayProjection.operation !== receipt.operation ||
      receipt.resultCode !== expectedCode[receipt.operation]
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Operation receipt result correlation mismatch',
      });
  });
export type MatrixCorpusOperationReceiptV1 = z.infer<typeof matrixCorpusOperationReceiptV1Schema>;

export const matrixCorpusRenewReceiptV1Schema = z
  .object({
    version: z.literal(1),
    idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
    replayProjection: matrixCorpusPersistedReplayProjectionV1Schema,
    resultDigest: matrixCorpusSha256DigestSchema,
    recordedAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const projection = receipt.replayProjection;
    if (projection.operation !== 'renew' || projection.result !== 'renewed') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Renew receipt must retain renew projection' });
      return;
    }
    if (
      projection.runId !== receipt.runId ||
      projection.leaseFence !== receipt.leaseFence ||
      projection.renewedAt !== receipt.recordedAt
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Renew receipt correlation mismatch' });
  });
export type MatrixCorpusRenewReceiptV1 = z.infer<typeof matrixCorpusRenewReceiptV1Schema>;

export const matrixCorpusCapabilityIssuanceReceiptV1Schema = z
  .object({
    version: z.literal(1),
    matrixIdempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    phase: matrixCorpusCapabilityPhaseSchema,
    turnIndex: z.number().int().min(0).max(19),
    issueRequestDigest: matrixCorpusSha256DigestSchema,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    replayProjection: matrixCorpusPersistedReplayProjectionV1Schema,
    resultDigest: matrixCorpusSha256DigestSchema,
    recordedAt: matrixCorpusRfc3339TimestampSchema,
    matrixSendProof: z
      .object({
        version: z.literal(1),
        matrixEventIdDigest: matrixCorpusKeyedDigestSchema,
        matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
        messageTextDigest: matrixCorpusSha256DigestSchema,
        recordedAt: matrixCorpusRfc3339TimestampSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const projection = receipt.replayProjection;
    if (projection.operation !== 'issue' || projection.result !== 'issued') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issuance receipt must retain issue projection' });
      return;
    }
    if (
      projection.runId !== receipt.runId ||
      projection.scenarioId !== receipt.scenarioId ||
      projection.phase !== receipt.phase ||
      projection.turnIndex !== receipt.turnIndex ||
      projection.issuedAt !== receipt.recordedAt
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issuance receipt correlation mismatch' });
  });
export type MatrixCorpusCapabilityIssuanceReceiptV1 = z.infer<
  typeof matrixCorpusCapabilityIssuanceReceiptV1Schema
>;

export const matrixCorpusTerminalFailureReceiptRefV1Schema = z
  .object({
    transportReceiptId: matrixCorpusKeyedDigestSchema,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
  })
  .strict();
export type MatrixCorpusTerminalFailureReceiptRefV1 = z.infer<
  typeof matrixCorpusTerminalFailureReceiptRefV1Schema
>;

export const matrixCorpusTransportReceiptV1Schema = z
  .object({
    version: z.literal(1),
    transportMessageIdDigest: matrixCorpusKeyedDigestSchema,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    userId: matrixCorpusSafeIdSchema,
    promptDigest: matrixCorpusSha256DigestSchema,
    ingressRequestDigest: matrixCorpusSha256DigestSchema,
    ingestReceiptId: matrixCorpusSafeIdSchema.nullable(),
    ingestOutboxId: matrixCorpusSafeIdSchema.nullable(),
    acceptedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    recordedAt: matrixCorpusRfc3339TimestampSchema,
    terminalFailureCode: z
      .enum([
        'CAPABILITY_REPLAY',
        'CAPABILITY_EXPIRED',
        'CAPABILITY_REVOKED',
        'CAPABILITY_MISMATCH',
        'TRANSPORT_REPLAY',
        'TERMINAL_RECEIPT_LIMIT',
      ])
      .nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const accepted = exactlyOne([receipt.ingestReceiptId, receipt.ingestOutboxId, receipt.acceptedAt]);
    const fullyAccepted =
      receipt.ingestReceiptId !== null &&
      receipt.ingestOutboxId !== null &&
      receipt.acceptedAt !== null;
    const failed =
      receipt.ingestReceiptId === null &&
      receipt.ingestOutboxId === null &&
      receipt.acceptedAt === null &&
      receipt.terminalFailureCode !== null;
    if (!fullyAccepted && !failed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: accepted
          ? 'Transport receipt acceptance fields must be all present or all absent'
          : 'Transport receipt requires an accepted ingest or terminal failure',
      });
    }
    if (fullyAccepted && receipt.terminalFailureCode !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Accepted transport receipt cannot also retain terminal failure',
      });
  });
export type MatrixCorpusTransportReceiptV1 = z.infer<typeof matrixCorpusTransportReceiptV1Schema>;

export const matrixCorpusIngestAcknowledgementOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('publication_acknowledged'),
      publisherReceiptDigest: matrixCorpusSha256DigestSchema,
      publishedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('terminal_marker_acknowledged'),
      publisherReceiptDigest: matrixCorpusSha256DigestSchema,
      publishedAt: matrixCorpusRfc3339TimestampSchema,
      terminalMarker: z
        .object({
          kind: z.enum(['completed', 'failed']),
          digest: matrixCorpusSha256DigestSchema,
          recordedAt: matrixCorpusRfc3339TimestampSchema,
        })
        .strict(),
      replyOrDeliveryWorkInFlight: z.literal(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('claimed_not_published_closed'),
      reason: z.enum(['quiesced', 'abandoned', 'capability_replay']),
      closedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
]);
export type MatrixCorpusIngestAcknowledgementOutcome = z.infer<
  typeof matrixCorpusIngestAcknowledgementOutcomeSchema
>;

export const matrixCorpusIngestAcknowledgementReceiptV1Schema = z
  .object({
    version: z.literal(1),
    ownerDigest: matrixCorpusKeyedDigestSchema,
    claimPurpose: outboxClaimPurposeSchema,
    expectedClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    outcome: matrixCorpusIngestAcknowledgementOutcomeSchema,
    acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    drained: z.boolean(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedAcknowledgedAt =
      receipt.outcome.kind === 'publication_acknowledged'
        ? receipt.outcome.publishedAt
        : receipt.outcome.kind === 'terminal_marker_acknowledged'
          ? receipt.outcome.terminalMarker.recordedAt
          : receipt.outcome.closedAt;
    if (receipt.acknowledgedAt !== expectedAcknowledgedAt)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acknowledgement receipt time must match outcome' });
    if (receipt.outcome.kind === 'publication_acknowledged' && receipt.drained)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Publication acknowledgement receipt cannot report drained',
      });
  });
export type MatrixCorpusIngestAcknowledgementReceiptV1 = z.infer<
  typeof matrixCorpusIngestAcknowledgementReceiptV1Schema
>;

const matrixCorpusIngestAcknowledgementReceiptsSchema = z
  .array(matrixCorpusIngestAcknowledgementReceiptV1Schema)
  .max(2)
  .superRefine((receipts, context) => {
    const kinds = receipts.map((receipt) => receipt.outcome.kind);
    if (new Set(kinds).size !== kinds.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acknowledgement outcome kinds must be unique' });
    const validSequence =
      kinds.length === 0 ||
      (kinds.length === 1 &&
        (kinds[0] === 'publication_acknowledged' || kinds[0] === 'claimed_not_published_closed')) ||
      (kinds.length === 2 &&
        kinds[0] === 'publication_acknowledged' &&
        kinds[1] === 'terminal_marker_acknowledged');
    if (!validSequence)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acknowledgement receipt sequence is invalid' });
  });

export const matrixCorpusIngestClaimRenewalV1Schema = z
  .object({
    ownerDigest: matrixCorpusKeyedDigestSchema,
    purpose: outboxClaimPurposeSchema,
    previousClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine((renewal) => Date.parse(renewal.claimExpiresAt) > Date.parse(renewal.previousClaimExpiresAt), {
    message: 'Ingest claim renewal must extend prior expiry',
  });
export type MatrixCorpusIngestClaimRenewalV1 = z.infer<typeof matrixCorpusIngestClaimRenewalV1Schema>;

const matrixCorpusDeliveryAttestationWindowShape = {
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  issuedAt: matrixCorpusRfc3339TimestampSchema,
  expiresAt: matrixCorpusRfc3339TimestampSchema,
} as const;

export const matrixCorpusIngestDeliveryAttestationV1Schema = z
  .object({
    ...matrixCorpusDeliveryAttestationWindowShape,
    envelope: matrixCorpusSignedIngestV1Schema.nullable(),
  })
  .strict()
  .refine((value) => hasExactFiveMinuteTtl(value.issuedAt, value.expiresAt), {
    message: 'Ingest delivery attestation window must be positive and at most five minutes',
  });
export type MatrixCorpusIngestDeliveryAttestationV1 = z.infer<
  typeof matrixCorpusIngestDeliveryAttestationV1Schema
>;

export const matrixCorpusIngestOutboxRecordV1Schema = z
  .object({
    version: z.literal(1),
    ingestOutboxId: matrixCorpusSafeIdSchema,
    ingestReceiptId: matrixCorpusSafeIdSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    payload: matrixCorpusAttestedIngestPayloadV1Schema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    status: matrixCorpusOutboxStatusSchema,
    claim: outboxClaimSchema.nullable(),
    publisherReceiptDigest: matrixCorpusSha256DigestSchema.nullable(),
    publishedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    terminalMarker: z
      .object({
        kind: z.enum(['completed', 'failed']),
        digest: matrixCorpusSha256DigestSchema,
        recordedAt: matrixCorpusRfc3339TimestampSchema,
      })
      .strict()
      .nullable(),
    closedReason: z.enum(['quiesced', 'abandoned', 'capability_replay']).nullable(),
    acknowledgementReceipts: matrixCorpusIngestAcknowledgementReceiptsSchema,
    lastClaimRenewal: matrixCorpusIngestClaimRenewalV1Schema.nullable(),
    deliveryAttestation: matrixCorpusIngestDeliveryAttestationV1Schema.optional(),
    closedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    createdAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((outbox, context) => {
    if (
      outbox.ingestReceiptId !== outbox.payload.context.ingestReceiptId ||
      outbox.runId !== outbox.payload.context.runId ||
      outbox.leaseFence !== outbox.payload.context.leaseFence ||
      outbox.userId !== outbox.payload.ordinaryIngest.userId
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ingest outbox immutable payload correlation mismatch',
      });
    if (
      outbox.deliveryAttestation?.envelope !== null &&
      outbox.deliveryAttestation?.envelope !== undefined &&
      (outbox.deliveryAttestation.envelope.ingestReceiptId !== outbox.ingestReceiptId ||
        outbox.deliveryAttestation.envelope.leaseFence !== outbox.leaseFence ||
        outbox.deliveryAttestation.envelope.payloadDigest !== outbox.payloadDigest)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ingest delivery attestation correlation mismatch',
      });
    const published = outbox.publisherReceiptDigest !== null && outbox.publishedAt !== null;
    if ((outbox.publisherReceiptDigest === null) !== (outbox.publishedAt === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Publisher receipt and published timestamp must be paired',
      });
    const hasClosure = outbox.closedReason !== null && outbox.closedAt !== null;
    const hasNoClosure = outbox.closedReason === null && outbox.closedAt === null;
    const acknowledgements = outbox.acknowledgementReceipts;
    const publicationReceipt = acknowledgements[0];
    const markerReceipt = acknowledgements[1];
    if (outbox.lastClaimRenewal !== null) {
      const renewalMatchesClaim =
        outbox.claim !== null &&
        outbox.lastClaimRenewal.ownerDigest === outbox.claim.ownerDigest &&
        outbox.lastClaimRenewal.claimExpiresAt === outbox.claim.expiresAt;
      const isPrePublicationRenewal =
        outbox.status === 'published' &&
        outbox.claim?.purpose === 'terminal_marker_recovery' &&
        outbox.lastClaimRenewal.purpose === 'publish' &&
        publicationReceipt?.ownerDigest === outbox.lastClaimRenewal.ownerDigest &&
        publicationReceipt.expectedClaimExpiresAt === outbox.lastClaimRenewal.claimExpiresAt;
      if (!renewalMatchesClaim || (!isPrePublicationRenewal && outbox.lastClaimRenewal.purpose !== outbox.claim?.purpose))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Last ingest claim renewal must match retained claim' });
    }
    if (outbox.status === 'pending') {
      if (
        outbox.claim !== null ||
        published ||
        outbox.terminalMarker !== null ||
        !hasNoClosure ||
        acknowledgements.length !== 0 ||
        outbox.lastClaimRenewal !== null
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pending ingest outbox cannot retain progress' });
    }
    if (outbox.status === 'claimed') {
      if (
        outbox.claim?.purpose !== 'publish' ||
        published ||
        outbox.terminalMarker !== null ||
        !hasNoClosure ||
        acknowledgements.length !== 0
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Claimed ingest outbox has invalid state' });
    }
    if (outbox.status === 'published') {
      const publicationMatches =
        publicationReceipt?.claimPurpose === 'publish' &&
        publicationReceipt.outcome.kind === 'publication_acknowledged' &&
        publicationReceipt.outcome.publisherReceiptDigest === outbox.publisherReceiptDigest &&
        publicationReceipt.outcome.publishedAt === outbox.publishedAt;
      const markerMatches =
        outbox.terminalMarker === null
          ? acknowledgements.length === 1
          : markerReceipt?.claimPurpose === 'terminal_marker_recovery' &&
            markerReceipt.outcome.kind === 'terminal_marker_acknowledged' &&
            markerReceipt.outcome.publisherReceiptDigest === outbox.publisherReceiptDigest &&
            markerReceipt.outcome.publishedAt === outbox.publishedAt &&
            markerReceipt.outcome.terminalMarker.kind === outbox.terminalMarker.kind &&
            markerReceipt.outcome.terminalMarker.digest === outbox.terminalMarker.digest &&
            markerReceipt.outcome.terminalMarker.recordedAt === outbox.terminalMarker.recordedAt;
      if (
        !published ||
        outbox.claim?.purpose !== 'terminal_marker_recovery' ||
        !hasNoClosure ||
        !publicationMatches ||
        !markerMatches
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Published ingest outbox has invalid state' });
    }
    if (outbox.status === 'closed') {
      const atomic =
        outbox.claim === null &&
        !published &&
        outbox.terminalMarker === null &&
        hasClosure &&
        acknowledgements.length === 0 &&
        outbox.lastClaimRenewal === null;
      const cooperativeReceipt = acknowledgements[0];
      const cooperative =
        outbox.claim?.purpose === 'publish' &&
        !published &&
        outbox.terminalMarker === null &&
        hasClosure &&
        acknowledgements.length === 1 &&
        cooperativeReceipt?.claimPurpose === 'publish' &&
        cooperativeReceipt.ownerDigest === outbox.claim.ownerDigest &&
        cooperativeReceipt.expectedClaimExpiresAt === outbox.claim.expiresAt &&
        cooperativeReceipt.outcome.kind === 'claimed_not_published_closed' &&
        cooperativeReceipt.outcome.reason === outbox.closedReason &&
        cooperativeReceipt.outcome.closedAt === outbox.closedAt;
      if (!atomic && !cooperative)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Closed ingest outbox has invalid state' });
    }
  });
export type MatrixCorpusIngestOutboxRecordV1 = z.infer<
  typeof matrixCorpusIngestOutboxRecordV1Schema
>;
export const matrixCorpusIngestOutboxV1Schema = matrixCorpusIngestOutboxRecordV1Schema;
export type MatrixCorpusIngestOutboxV1 = MatrixCorpusIngestOutboxRecordV1;

export const matrixCorpusTerminalClaimRenewalV1Schema = z
  .object({
    ownerDigest: matrixCorpusKeyedDigestSchema,
    previousClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine((renewal) => Date.parse(renewal.claimExpiresAt) > Date.parse(renewal.previousClaimExpiresAt), {
    message: 'Terminal claim renewal must extend prior expiry',
  });
export type MatrixCorpusTerminalClaimRenewalV1 = z.infer<typeof matrixCorpusTerminalClaimRenewalV1Schema>;

export const matrixCorpusTerminalDeliveryAttestationV1Schema = z
  .object({
    ...matrixCorpusDeliveryAttestationWindowShape,
    envelope: matrixCorpusSignedTerminalControlV1Schema.nullable(),
  })
  .strict()
  .refine((value) => hasExactFiveMinuteTtl(value.issuedAt, value.expiresAt), {
    message: 'Terminal delivery attestation window must be positive and at most five minutes',
  });
export type MatrixCorpusTerminalDeliveryAttestationV1 = z.infer<
  typeof matrixCorpusTerminalDeliveryAttestationV1Schema
>;

export const matrixCorpusTerminalControlOutboxRecordV1Schema = z
  .object({
    version: z.literal(1),
    terminalControlId: matrixCorpusSafeIdSchema,
    eventId: matrixCorpusSafeIdSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    kind: matrixCorpusTerminalKindSchema,
    payload: matrixCorpusTerminalControlV1Schema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    status: matrixCorpusOutboxStatusSchema,
    claim: outboxClaimSchema.nullable(),
    acknowledgedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    closedReason: z.enum(['expired_unclaimed_release', 'superseded_by_authoritative_winner']).nullable(),
    lastClaimRenewal: matrixCorpusTerminalClaimRenewalV1Schema.nullable(),
    deliveryAttestation: matrixCorpusTerminalDeliveryAttestationV1Schema.optional(),
    closedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
    createdAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((outbox, context) => {
    if (
      outbox.terminalControlId !== outbox.eventId ||
      outbox.payload.eventId !== outbox.eventId ||
      outbox.payload.runId !== outbox.runId ||
      outbox.payload.userId !== outbox.userId ||
      outbox.payload.leaseFence !== outbox.leaseFence ||
      outbox.payload.kind !== outbox.kind ||
      outbox.payload.createdAt !== outbox.createdAt
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal outbox immutable payload correlation mismatch',
      });
    if (
      outbox.deliveryAttestation?.envelope !== null &&
      outbox.deliveryAttestation?.envelope !== undefined &&
      (outbox.deliveryAttestation.envelope.eventId !== outbox.eventId ||
        outbox.deliveryAttestation.envelope.leaseFence !== outbox.leaseFence ||
        outbox.deliveryAttestation.envelope.payloadDigest !== outbox.payloadDigest)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal delivery attestation correlation mismatch',
      });
    if (outbox.claim !== null && outbox.claim.purpose !== 'publish')
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal claim must use publish purpose' });
    if (
      outbox.lastClaimRenewal !== null &&
      (outbox.lastClaimRenewal.ownerDigest !== outbox.claim?.ownerDigest ||
        outbox.lastClaimRenewal.claimExpiresAt !== outbox.claim.expiresAt)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Last terminal claim renewal must match retained claim' });
    const hasClosure = outbox.closedReason !== null && outbox.closedAt !== null;
    const hasNoClosure = outbox.closedReason === null && outbox.closedAt === null;
    if (
      outbox.status === 'pending' &&
      (outbox.claim !== null || outbox.acknowledgedAt !== null || !hasNoClosure || outbox.lastClaimRenewal !== null)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pending terminal outbox has invalid state' });
    if (
      outbox.status === 'claimed' &&
      (outbox.claim === null || outbox.acknowledgedAt !== null || !hasNoClosure)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Claimed terminal outbox has invalid state' });
    if (
      outbox.status === 'published' &&
      (outbox.claim === null || outbox.acknowledgedAt === null || !hasNoClosure)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Published terminal outbox has invalid state' });
    if (
      outbox.status === 'closed' &&
      (outbox.claim !== null || outbox.acknowledgedAt !== null || !hasClosure || outbox.lastClaimRenewal !== null)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Closed terminal outbox has invalid state' });
    if (outbox.closedReason === 'expired_unclaimed_release' && outbox.kind !== 'release')
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Expired terminal closure requires release intent' });
  });
export type MatrixCorpusTerminalControlOutboxRecordV1 = z.infer<
  typeof matrixCorpusTerminalControlOutboxRecordV1Schema
>;
export const matrixCorpusTerminalControlOutboxV1Schema = matrixCorpusTerminalControlOutboxRecordV1Schema;
export type MatrixCorpusTerminalControlOutboxV1 = MatrixCorpusTerminalControlOutboxRecordV1;

export const matrixCorpusCleanupChunkReceiptV1Schema = z
  .object({
    version: z.literal(1),
    idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
    expectedRevision: z.number().int().min(0).max(63),
    committedRevision: cleanupFinalRevisionSchema,
    replayProjection: matrixCorpusPersistedReplayProjectionV1Schema,
    resultDigest: matrixCorpusSha256DigestSchema,
    recordedAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const projection = receipt.replayProjection;
    if (projection.operation !== 'cleanup' || receipt.committedRevision !== receipt.expectedRevision + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup receipt revision correlation mismatch' });
      return;
    }
    if (
      (projection.result === 'progress' &&
        (projection.committedRevision !== receipt.committedRevision ||
          projection.chunkCommittedAt !== receipt.recordedAt)) ||
      (projection.result === 'cleaned' &&
        (projection.finalRevision !== receipt.committedRevision || projection.cleanedAt !== receipt.recordedAt))
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup replay projection mismatch' });
  });
export type MatrixCorpusCleanupChunkReceiptV1 = z.infer<typeof matrixCorpusCleanupChunkReceiptV1Schema>;

const cleanupChildRefsSchema = z
  .object({
    renewReceiptIds: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
    capabilityIssuanceReceiptIds: z
      .array(matrixCorpusKeyedDigestSchema)
      .max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
    capabilityDigests: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
    transportReceiptIds: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
    ingestOutboxIds: z.array(matrixCorpusSafeIdSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
    terminalControlOutboxIds: z
      .array(matrixCorpusSafeIdSchema)
      .max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
  })
  .strict()
  .superRefine((refs, context) => {
    for (const [name, values] of Object.entries(refs)) {
      if (!isBytewiseStrictlySorted(values))
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be bytewise sorted and unique` });
    }
  });
export type MatrixCorpusCleanupChildRefsV1 = z.infer<typeof cleanupChildRefsSchema>;

const matrixCorpusCleanupChildKindSchema = z.enum([
  'renew_receipt',
  'issuance_receipt',
  'capability',
  'transport_receipt',
  'ingest_outbox',
  'terminal_outbox',
]);
const matrixCorpusCleanupCursorV1Schema = z
  .object({
    kind: matrixCorpusCleanupChildKindSchema,
    nextIndex: z.number().int().min(0).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN - 1),
  })
  .strict();

function firstRemainingCleanupKind(
  remaining: MatrixCorpusCleanupChildRefsV1
): z.infer<typeof matrixCorpusCleanupChildKindSchema> | null {
  if (remaining.renewReceiptIds.length > 0) return 'renew_receipt';
  if (remaining.capabilityIssuanceReceiptIds.length > 0) return 'issuance_receipt';
  if (remaining.capabilityDigests.length > 0) return 'capability';
  if (remaining.transportReceiptIds.length > 0) return 'transport_receipt';
  if (remaining.ingestOutboxIds.length > 0) return 'ingest_outbox';
  if (remaining.terminalControlOutboxIds.length > 0) return 'terminal_outbox';
  return null;
}

function cleanupRemainingCount(remaining: MatrixCorpusCleanupChildRefsV1): number {
  return (
    remaining.renewReceiptIds.length +
    remaining.capabilityIssuanceReceiptIds.length +
    remaining.capabilityDigests.length +
    remaining.transportReceiptIds.length +
    remaining.ingestOutboxIds.length +
    remaining.terminalControlOutboxIds.length
  );
}

function isBytewiseStrictlySorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

export const matrixCorpusCleanupProgressV1Schema = z
  .object({
    version: z.literal(1),
    targetRunId: matrixCorpusSafeIdSchema,
    targetLeaseFence: matrixCorpusDecimalFenceSchema,
    targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
    revision: cleanupProgressRevisionSchema,
    cursor: matrixCorpusCleanupCursorV1Schema.nullable(),
    remaining: cleanupChildRefsSchema,
    chunkReceipts: z
      .array(matrixCorpusCleanupChunkReceiptV1Schema)
      .max(MATRIX_CORPUS_MAX_CLEANUP_CHUNK_RECEIPTS_PER_RUN - 1),
  })
  .strict()
  .superRefine((progress, context) => {
    const receiptIds = progress.chunkReceipts.map((receipt) => receipt.idempotencyKeyDigest);
    if (new Set(receiptIds).size !== receiptIds.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup receipt digests must be unique' });
    if (progress.chunkReceipts.length !== progress.revision)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup receipt count must equal revision' });
    const firstKind = firstRemainingCleanupKind(progress.remaining);
    if (
      (firstKind === null && progress.cursor !== null) ||
      (firstKind !== null &&
        (progress.cursor?.kind !== firstKind || progress.cursor.nextIndex !== 0))
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup cursor must select first remaining kind' });
    const remainingChildCount = cleanupRemainingCount(progress.remaining);
    if (remainingChildCount === 0)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress must retain remaining children' });
    if (remainingChildCount > MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup aggregate reference bound exceeded' });
    if (!hasCleanupProgressBudget(progress.revision, remainingChildCount))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress exceeds remaining transaction budget' });
    let previousRemainingChildCount: number | null = null;
    for (const [index, receipt] of progress.chunkReceipts.entries()) {
      const projection = receipt.replayProjection;
      if (
        receipt.expectedRevision !== index ||
        receipt.committedRevision !== index + 1 ||
        projection.operation !== 'cleanup' ||
        projection.result !== 'progress'
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress receipt trajectory is invalid' });
        continue;
      }
      if (
        projection.targetRunId !== progress.targetRunId ||
        projection.targetLeaseFence !== progress.targetLeaseFence ||
        projection.targetRunFenceDigest !== progress.targetRunFenceDigest
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress receipt target mismatch' });
      if (
        previousRemainingChildCount !== null &&
        (previousRemainingChildCount - projection.remainingChildCount < 1 ||
          previousRemainingChildCount - projection.remainingChildCount >
            MATRIX_CORPUS_MAX_CLEANUP_CHILD_DELETES_PER_CHUNK)
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup receipt deletion delta is invalid' });
      previousRemainingChildCount = projection.remainingChildCount;
    }
    if (previousRemainingChildCount !== null && previousRemainingChildCount !== remainingChildCount)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup final receipt remaining count mismatch' });
  });
export type MatrixCorpusCleanupProgressV1 = z.infer<typeof matrixCorpusCleanupProgressV1Schema>;

const operationReceiptsSchema = z
  .object({
    acquire: matrixCorpusOperationReceiptV1Schema.nullable(),
    activate: matrixCorpusOperationReceiptV1Schema.nullable(),
    quiesce: matrixCorpusOperationReceiptV1Schema.nullable(),
    release: matrixCorpusOperationReceiptV1Schema.nullable(),
  })
  .strict()
  .superRefine((receipts, context) => {
    for (const [operation, receipt] of Object.entries(receipts)) {
      if (receipt !== null && receipt.operation !== operation)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Operation receipt slot mismatch' });
    }
  });

const leaseRecordShape = {
  version: z.literal(1),
  runtimeAudience: matrixCorpusRuntimeAudienceSchema,
  runId: matrixCorpusSafeIdSchema,
  userId: matrixCorpusSafeIdSchema,
  matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
  whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
  whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
  runFenceDigest: matrixCorpusKeyedDigestSchema,
  phase: matrixCorpusLeasePhaseSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  fenceEpoch: matrixCorpusDecimalFenceSchema,
  acquiredAt: matrixCorpusRfc3339TimestampSchema,
  activatedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
  renewedAt: matrixCorpusRfc3339TimestampSchema,
  expiresAt: matrixCorpusRfc3339TimestampSchema,
  quiescedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
  releasedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
  abandonedAt: matrixCorpusRfc3339TimestampSchema.nullable(),
  operationReceipts: operationReceiptsSchema,
  renewReceiptIds: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_RENEW_RECEIPTS_PER_RUN),
  capabilityIssuanceReceiptIds: z
    .array(matrixCorpusKeyedDigestSchema)
    .max(MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN),
  unconsumedCapability: z
    .object({
      digest: matrixCorpusKeyedDigestSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
    })
    .strict()
    .nullable(),
  capabilityDigests: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
  terminalFailureReceiptRefs: z
    .array(matrixCorpusTerminalFailureReceiptRefV1Schema)
    .max(MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN),
  nonterminalIngestOutboxIds: z.array(matrixCorpusSafeIdSchema).max(1),
  ingestOutboxIds: z.array(matrixCorpusSafeIdSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
  terminalControlOutboxIds: z.array(matrixCorpusSafeIdSchema).max(2),
  transportReceiptIds: z.array(matrixCorpusKeyedDigestSchema).max(MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN),
  drain: booleanDrainSchema,
  terminalWinner: matrixCorpusTerminalAuthoritativeWinnerV1Schema.nullable(),
  cleanupProgress: matrixCorpusCleanupProgressV1Schema.nullable(),
  finalCleanupReceipt: matrixCorpusCleanupChunkReceiptV1Schema.nullable(),
} as const;

function hasUniqueItems(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const matrixCorpusLeaseRecordBaseSchema = z.object(leaseRecordShape).strict();
type MatrixCorpusLeaseRecordBase = z.infer<typeof matrixCorpusLeaseRecordBaseSchema>;

function refineMatrixCorpusLeaseRecord(
  lease: MatrixCorpusLeaseRecordBase,
  context: z.RefinementCtx
): void {
  if (lease.fenceEpoch !== lease.leaseFence)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Fence epoch must equal lease fence' });
  if (
    Date.parse(lease.acquiredAt) > Date.parse(lease.renewedAt) ||
    !hasExactFiveMinuteTtl(lease.renewedAt, lease.expiresAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lease TTL must be current, positive, and bounded' });
  const lists = [
    lease.renewReceiptIds,
    lease.capabilityIssuanceReceiptIds,
    lease.capabilityDigests,
    lease.nonterminalIngestOutboxIds,
    lease.ingestOutboxIds,
    lease.terminalControlOutboxIds,
    lease.transportReceiptIds,
  ];
  if (lists.some((list) => !hasUniqueItems(list)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lease child references must be unique' });
  const terminalFailureReceiptIds = lease.terminalFailureReceiptRefs.map(
    (reference) => reference.transportReceiptId
  );
  if (!hasUniqueItems(terminalFailureReceiptIds))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal failure receipt ids must be unique' });
  if (lease.unconsumedCapability !== null && !lease.capabilityDigests.includes(lease.unconsumedCapability.digest))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unconsumed capability must be a lease child' });
  if (lease.nonterminalIngestOutboxIds.some((id) => !lease.ingestOutboxIds.includes(id)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Nonterminal ingest outbox must be a lease child' });
  if (
    lease.terminalFailureReceiptRefs.some(
      (reference) =>
        !lease.transportReceiptIds.includes(reference.transportReceiptId) ||
        !lease.capabilityDigests.includes(reference.capabilityDigest)
    )
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal failure receipt must be contained by lease children' });
  if (lease.terminalWinner !== null && !lease.terminalControlOutboxIds.includes(lease.terminalWinner.eventId))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal winner must be a lease child' });
  const perCapability = new Map<string, number>();
  for (const ref of lease.terminalFailureReceiptRefs) {
    perCapability.set(ref.capabilityDigest, (perCapability.get(ref.capabilityDigest) ?? 0) + 1);
  }
  if ([...perCapability.values()].some((count) => count > MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal failures exceed capability bound' });
  const cleanupReferenceCount =
    lease.renewReceiptIds.length +
    lease.capabilityIssuanceReceiptIds.length +
    lease.capabilityDigests.length +
    lease.transportReceiptIds.length +
    lease.ingestOutboxIds.length +
    lease.terminalControlOutboxIds.length;
  if (cleanupReferenceCount > MATRIX_CORPUS_MAX_CLEANUP_REFERENCES_PER_RUN)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lease cleanup reference bound exceeded' });
  if (
    lease.finalCleanupReceipt !== null &&
    (lease.finalCleanupReceipt.replayProjection.operation !== 'cleanup' ||
      lease.finalCleanupReceipt.replayProjection.result !== 'cleaned')
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Final cleanup receipt must be terminal cleanup' });
  if (lease.finalCleanupReceipt !== null && lease.phase !== 'provisioning')
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Final cleanup receipt requires provisioning lease' });
  const finalCleanupProjection = lease.finalCleanupReceipt?.replayProjection;
  if (
    finalCleanupProjection?.operation === 'cleanup' &&
    finalCleanupProjection.result === 'cleaned' &&
    (finalCleanupProjection.targetRunId === lease.runId ||
      finalCleanupProjection.targetLeaseFence === lease.leaseFence ||
      finalCleanupProjection.targetRunFenceDigest === lease.runFenceDigest)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup target identity must differ from current lease' });
  const drained =
    lease.phase === 'quiescing' &&
    lease.unconsumedCapability === null &&
    lease.nonterminalIngestOutboxIds.length === 0 &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalIntexMarkerCount &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalOutboxCount &&
    lease.drain.replyOrDeliveryWorkInFlight === 0;
  if (lease.drain.drained !== drained)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Drain flag must be derived from lease state' });
  const acquire = lease.operationReceipts.acquire;
  if (
    acquire?.replayProjection.operation !== 'acquire' ||
    acquire.replayProjection.runId !== lease.runId ||
    acquire.replayProjection.leaseFence !== lease.leaseFence ||
    acquire.replayProjection.acquiredAt !== lease.acquiredAt ||
    acquire.recordedAt !== lease.acquiredAt
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acquire receipt must correlate with lease' });
  const activate = lease.operationReceipts.activate;
  if ((lease.activatedAt === null) !== (activate === null))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Activation timestamp and receipt must be paired' });
  if (
    activate !== null &&
    (activate.replayProjection.operation !== 'activate' ||
      activate.replayProjection.runId !== lease.runId ||
      activate.replayProjection.leaseFence !== lease.leaseFence ||
      activate.replayProjection.activatedAt !== lease.activatedAt ||
      activate.recordedAt !== lease.activatedAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Activate receipt must correlate with lease' });
  const quiesce = lease.operationReceipts.quiesce;
  if (
    quiesce !== null &&
    (lease.quiescedAt === null ||
      quiesce.replayProjection.operation !== 'quiesce' ||
      quiesce.replayProjection.runId !== lease.runId ||
      quiesce.replayProjection.leaseFence !== lease.leaseFence ||
      quiesce.replayProjection.quiescedAt !== lease.quiescedAt ||
      quiesce.recordedAt !== lease.quiescedAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quiesce receipt must correlate with lease' });
  const release = lease.operationReceipts.release;
  if (
    release !== null &&
    (release.replayProjection.operation !== 'release' ||
      release.replayProjection.runId !== lease.runId ||
      release.replayProjection.leaseFence !== lease.leaseFence ||
      release.replayProjection.createdAt !== release.recordedAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Release receipt must correlate with lease' });
  if (lease.phase !== 'released' && lease.releasedAt !== null)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only released lease may retain release timestamp' });
  if (lease.phase !== 'abandoned' && lease.abandonedAt !== null)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only abandoned lease may retain abandonment timestamp' });
  if (
    lease.phase === 'provisioning' &&
    (lease.activatedAt !== null || lease.quiescedAt !== null || lease.terminalWinner !== null)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provisioning lease lifecycle mismatch' });
  if (
    lease.phase === 'active' &&
    (lease.activatedAt === null || lease.quiescedAt !== null || lease.terminalWinner !== null)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Active lease lifecycle mismatch' });
  if (
    (lease.phase === 'quiescing' || lease.phase === 'release_pending') &&
    (lease.activatedAt === null || lease.quiescedAt === null || lease.terminalWinner !== null)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quiesced lease lifecycle mismatch' });
  if (
    (lease.phase === 'release_pending' || lease.phase === 'released') &&
    (lease.activatedAt === null ||
      lease.quiescedAt === null ||
      release === null ||
      lease.unconsumedCapability !== null ||
      lease.nonterminalIngestOutboxIds.length !== 0 ||
      lease.drain.consumedCapabilityCount !== lease.drain.terminalIntexMarkerCount ||
      lease.drain.consumedCapabilityCount !== lease.drain.terminalOutboxCount ||
      lease.drain.replyOrDeliveryWorkInFlight !== 0)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Release lifecycle must be fully quiesced and drained' });
  if (lease.phase === 'abandon_pending' && lease.terminalWinner !== null)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Pending abandonment cannot have terminal winner' });
  if (
    lease.phase === 'released' &&
    (lease.releasedAt === null || lease.abandonedAt !== null || lease.terminalWinner?.kind !== 'release')
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Released lease winner mismatch' });
  if (
    lease.phase === 'abandoned' &&
    (lease.abandonedAt === null || lease.releasedAt !== null || lease.terminalWinner?.kind !== 'abandoned')
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Abandoned lease winner mismatch' });
}

export const matrixCorpusLeaseV1Schema = matrixCorpusLeaseRecordBaseSchema.superRefine((lease, context) => {
  refineMatrixCorpusLeaseRecord(lease, context);
  if (lease.cleanupProgress !== null)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Current lease cannot retain cleanup progress' });
});
export type MatrixCorpusLeaseV1 = z.infer<typeof matrixCorpusLeaseV1Schema>;

export const matrixCorpusLeaseHistoryV1Schema = z
  .object({
    ...leaseRecordShape,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
  })
  .strict()
  .superRefine((history, context) => {
    refineMatrixCorpusLeaseRecord(history, context);
    const progress = history.cleanupProgress;
    if (progress !== null) {
      if (history.phase !== 'released' && history.phase !== 'abandoned')
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress requires terminal target history' });
      if (
        progress.targetRunId !== history.runId ||
        progress.targetLeaseFence !== history.leaseFence ||
        progress.targetRunFenceDigest !== history.runFenceDigest
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress must match target history' });
    }
  });
export type MatrixCorpusLeaseHistoryV1 = z.infer<typeof matrixCorpusLeaseHistoryV1Schema>;

export const matrixCorpusCurrentLeaseHistoryPairV1Schema = z
  .object({
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    current: matrixCorpusLeaseV1Schema,
    history: matrixCorpusLeaseHistoryV1Schema,
  })
  .strict()
  .superRefine((pair, context) => {
    const { leaseSlotDigest, ...historyCurrentFields } = pair.history;
    if (pair.leaseSlotDigest !== leaseSlotDigest)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Lease slot address must match history' });
    if (JSON.stringify(pair.current) !== JSON.stringify(historyCurrentFields))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Current and history leases must be identical' });
  });
export type MatrixCorpusCurrentLeaseHistoryPairV1 = z.infer<
  typeof matrixCorpusCurrentLeaseHistoryPairV1Schema
>;

function remainingCleanupRefsAreContained(
  remaining: MatrixCorpusCleanupChildRefsV1,
  targetHistory: MatrixCorpusLeaseHistoryV1
): boolean {
  return (
    remaining.renewReceiptIds.every((id) => targetHistory.renewReceiptIds.includes(id)) &&
    remaining.capabilityIssuanceReceiptIds.every((id) =>
      targetHistory.capabilityIssuanceReceiptIds.includes(id)
    ) &&
    remaining.capabilityDigests.every((digest) => targetHistory.capabilityDigests.includes(digest)) &&
    remaining.transportReceiptIds.every((id) => targetHistory.transportReceiptIds.includes(id)) &&
    remaining.ingestOutboxIds.every((id) => targetHistory.ingestOutboxIds.includes(id)) &&
    remaining.terminalControlOutboxIds.every((id) => targetHistory.terminalControlOutboxIds.includes(id))
  );
}

export const matrixCorpusCleanupLeaseSetV1Schema = z
  .object({
    currentPair: matrixCorpusCurrentLeaseHistoryPairV1Schema,
    targetHistory: matrixCorpusLeaseHistoryV1Schema,
  })
  .strict()
  .superRefine((leaseSet, context) => {
    const current = leaseSet.currentPair.current;
    const target = leaseSet.targetHistory;
    const progress = target.cleanupProgress;
    if (current.phase !== 'provisioning')
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup requires provisioning current lease' });
    if (target.phase !== 'released' && target.phase !== 'abandoned')
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup requires terminal target history' });
    if (current.userId !== target.userId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup current and target users must match' });
    if (
      current.runId === target.runId ||
      current.leaseFence === target.leaseFence ||
      current.runFenceDigest === target.runFenceDigest
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup current and target identities must differ' });
    if (progress === null)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup target history requires progress' });
    else {
      if (!remainingCleanupRefsAreContained(progress.remaining, target))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup remaining children must belong to target history' });
      const firstReceipt = progress.chunkReceipts[0];
      if (
        firstReceipt?.replayProjection.operation === 'cleanup' &&
        firstReceipt.replayProjection.result === 'progress'
      ) {
        const initialDeletionCount = cleanupRemainingCount(target) - firstReceipt.replayProjection.remainingChildCount;
        if (
          initialDeletionCount < 1 ||
          initialDeletionCount > MATRIX_CORPUS_MAX_CLEANUP_CHILD_DELETES_PER_CHUNK
        )
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'Initial cleanup receipt deletion delta is invalid' });
      }
    }
  });
export type MatrixCorpusCleanupLeaseSetV1 = z.infer<typeof matrixCorpusCleanupLeaseSetV1Schema>;

export const matrixCorpusLeaseHistoryRenewReceiptPairV1Schema = z
  .object({
    history: matrixCorpusLeaseHistoryV1Schema,
    receipt: matrixCorpusRenewReceiptV1Schema,
  })
  .strict()
  .superRefine((pair, context) => {
    if (
      pair.receipt.runId !== pair.history.runId ||
      pair.receipt.userId !== pair.history.userId ||
      pair.receipt.leaseFence !== pair.history.leaseFence ||
      !pair.history.renewReceiptIds.includes(pair.receipt.idempotencyKeyDigest)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Renew receipt must be an exact history child' });
  });
export type MatrixCorpusLeaseHistoryRenewReceiptPairV1 = z.infer<
  typeof matrixCorpusLeaseHistoryRenewReceiptPairV1Schema
>;

export const matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema = z
  .object({
    history: matrixCorpusLeaseHistoryV1Schema,
    receipt: matrixCorpusCapabilityIssuanceReceiptV1Schema,
  })
  .strict()
  .superRefine((pair, context) => {
    if (
      pair.receipt.runId !== pair.history.runId ||
      pair.receipt.userId !== pair.history.userId ||
      pair.receipt.leaseFence !== pair.history.leaseFence ||
      !pair.history.capabilityIssuanceReceiptIds.includes(pair.receipt.matrixIdempotencyKeyDigest)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issuance receipt must be an exact history child' });
  });
export type MatrixCorpusLeaseHistoryIssuanceReceiptPairV1 = z.infer<
  typeof matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema
>;

const operationInputBaseShape = {
  runtimeAudience: matrixCorpusRuntimeAudienceSchema,
  runId: matrixCorpusSafeIdSchema,
  userId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  idempotencyKey: matrixCorpusRawIdempotencyKeySchema,
} as const;
const operationCommandBaseShape = {
  runtimeAudience: matrixCorpusRuntimeAudienceSchema,
  runId: matrixCorpusSafeIdSchema,
  userId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  leaseSlotDigest: matrixCorpusKeyedDigestSchema,
  runFenceDigest: matrixCorpusKeyedDigestSchema,
  idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
  canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
  now: matrixCorpusRfc3339TimestampSchema,
} as const;

export const acquireProvisioningLeaseInputSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
    idempotencyKey: matrixCorpusRawIdempotencyKeySchema,
  })
  .strict();
export type AcquireProvisioningLeaseInput = z.infer<typeof acquireProvisioningLeaseInputSchema>;

export const activateRunInputSchema = z.object(operationInputBaseShape).strict();
export type ActivateRunInput = z.infer<typeof activateRunInputSchema>;
export const renewLeaseInputSchema = z.object(operationInputBaseShape).strict();
export type RenewLeaseInput = z.infer<typeof renewLeaseInputSchema>;
export const quiesceRunInputSchema = z.object(operationInputBaseShape).strict();
export type QuiesceRunInput = z.infer<typeof quiesceRunInputSchema>;

export const releaseRunInputSchema = z
  .object({
    ...operationInputBaseShape,
    contextFinalizationTombstoneDigest: matrixCorpusSha256DigestSchema,
    terminalCandidateDigest: matrixCorpusSha256DigestSchema,
    artifactStageDigest: matrixCorpusSha256DigestSchema,
  })
  .strict();
export type ReleaseRunInput = z.infer<typeof releaseRunInputSchema>;

export const consumeCapabilityAndEnqueueIngestInputSchema = z
  .object({
    rawCapability: matrixCorpusCapabilityTokenSchema,
    transportMessageId: matrixCorpusRawTransportMessageIdSchema,
    facts: matrixCorpusCapabilityConsumeFactsV1Schema,
  })
  .strict();
export type ConsumeCapabilityAndEnqueueIngestInput = z.infer<
  typeof consumeCapabilityAndEnqueueIngestInputSchema
>;

export const abandonExpiredRunInputSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    observedRunId: matrixCorpusSafeIdSchema,
    observedUserId: matrixCorpusSafeIdSchema,
    observedLeaseFence: matrixCorpusDecimalFenceSchema,
  })
  .strict();
export type AbandonExpiredRunInput = z.infer<typeof abandonExpiredRunInputSchema>;

export const getTransportStatusInputSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
  })
  .strict();
export type GetTransportStatusInput = z.infer<typeof getTransportStatusInputSchema>;

export const acquireProvisioningLeaseCommandSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
    now: matrixCorpusRfc3339TimestampSchema,
    expiresAt: matrixCorpusRfc3339TimestampSchema,
    acquisitionReadiness: matrixCorpusCurrentAcceptanceResultSchema,
  })
  .strict()
  .refine((command) => hasExactFiveMinuteTtl(command.now, command.expiresAt), {
    message: 'Lease expiry must be positive and at most five minutes after command time',
  });
export type AcquireProvisioningLeaseCommand = z.infer<typeof acquireProvisioningLeaseCommandSchema>;

export const activateRunCommandSchema = z
  .object({
    ...operationCommandBaseShape,
    controlStatus: matrixCorpusControlStatusResultSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.controlStatus.kind === 'status' &&
      (command.controlStatus.runId !== command.runId ||
        command.controlStatus.userId !== command.userId ||
        command.controlStatus.leaseFence !== command.leaseFence ||
        !command.controlStatus.contextReady ||
        !command.controlStatus.manifestReady ||
        !command.controlStatus.preflightProjectionReady ||
        !command.controlStatus.retentionReconciled)
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Activation status proof correlation mismatch' });
  });
export type ActivateRunCommand = z.infer<typeof activateRunCommandSchema>;

export const renewLeaseCommandSchema = z
  .object({
    ...operationCommandBaseShape,
    expiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine((command) => hasExactFiveMinuteTtl(command.now, command.expiresAt), {
    message: 'Lease expiry must be positive and at most five minutes after command time',
  });
export type RenewLeaseCommand = z.infer<typeof renewLeaseCommandSchema>;

export const issueCapabilityCommandSchema = z
  .object({
    now: matrixCorpusRfc3339TimestampSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    capability: matrixCorpusCapabilityV1Schema,
  })
  .strict();
export type IssueCapabilityCommand = z.infer<typeof issueCapabilityCommandSchema>;

export const recordMatrixSendProofInputSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
    idempotencyKey: matrixCorpusRawIdempotencyKeySchema,
    rawCapability: matrixCorpusCapabilityTokenSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(20),
    phase: matrixCorpusCapabilityPhaseSchema,
    turnIndex: z.number().int().min(0).max(19),
    matrixEventId: z.string().min(2).max(4_096).regex(/^\$[^\s]+$/u),
    matrixRoomId: z.string().min(4).max(255).regex(/^![^\s:]+:[^\s]+$/u),
    messageText: z.string().min(1).max(8_192),
  })
  .strict();
export type RecordMatrixSendProofInput = z.infer<typeof recordMatrixSendProofInputSchema>;

export const recordMatrixSendProofCommandSchema = z
  .object({
    now: matrixCorpusRfc3339TimestampSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    matrixIdempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    matrixEventIdDigest: matrixCorpusKeyedDigestSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    messageTextDigest: matrixCorpusSha256DigestSchema,
    promptDigest: matrixCorpusSha256DigestSchema,
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    scenarioId: matrixCorpusSafeIdSchema,
    scenarioNumber: z.number().int().min(1).max(20),
    phase: matrixCorpusCapabilityPhaseSchema,
    turnIndex: z.number().int().min(0).max(19),
  })
  .strict();
export type RecordMatrixSendProofCommand = z.infer<typeof recordMatrixSendProofCommandSchema>;

export const consumeCapabilityAndEnqueueIngestCommandSchema = z
  .object({
    now: matrixCorpusRfc3339TimestampSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    capabilityDigest: matrixCorpusKeyedDigestSchema,
    transportMessageIdDigest: matrixCorpusKeyedDigestSchema,
    ingestReceiptId: matrixCorpusSafeIdSchema,
    ingestOutboxId: matrixCorpusSafeIdSchema,
    facts: matrixCorpusCapabilityConsumeFactsV1Schema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    ingressRequestDigest: matrixCorpusSha256DigestSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.facts.ingressRequest.capabilityDigest !== command.capabilityDigest ||
      command.facts.ingressRequest.transportMessageIdDigest !== command.transportMessageIdDigest ||
      command.facts.ingressRequest.ingestReceiptId !== command.ingestReceiptId ||
      command.facts.ingressRequest.ingestOutboxId !== command.ingestOutboxId ||
      command.facts.ingressRequest.payloadDigest !== command.payloadDigest ||
      command.facts.ingressRequestDigest !== command.ingressRequestDigest
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Consume command facts correlation mismatch' });
  });
export type ConsumeCapabilityAndEnqueueIngestCommand = z.infer<
  typeof consumeCapabilityAndEnqueueIngestCommandSchema
>;

export const quiesceRunCommandSchema = z.object(operationCommandBaseShape).strict();
export type QuiesceRunCommand = z.infer<typeof quiesceRunCommandSchema>;

export const releaseRunCommandSchema = z
  .object({
    ...operationCommandBaseShape,
    controlStatus: matrixCorpusControlStatusResultSchema,
    terminalControlId: matrixCorpusSafeIdSchema,
    terminalControl: matrixCorpusTerminalControlV1Schema,
    terminalPayloadDigest: matrixCorpusSha256DigestSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const payload = command.terminalControl;
    if (
      payload.kind !== 'release' ||
      command.terminalControlId !== payload.eventId ||
      payload.runId !== command.runId ||
      payload.userId !== command.userId ||
      payload.leaseFence !== command.leaseFence
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Release terminal command correlation mismatch' });
    if (command.controlStatus.kind === 'status') {
      if (
        command.controlStatus.runId !== command.runId ||
        command.controlStatus.userId !== command.userId ||
        command.controlStatus.leaseFence !== command.leaseFence ||
        command.controlStatus.lifecycle !== 'finalizing' ||
        command.controlStatus.contextFinalizationTombstoneDigest === null ||
        command.controlStatus.terminalCandidateDigest === null ||
        command.controlStatus.artifactStageDigest === null ||
        command.controlStatus.contextFinalizationTombstoneDigest !== payload.tombstoneDigest ||
        command.controlStatus.terminalCandidateDigest !== payload.terminalCandidateDigest ||
        command.controlStatus.artifactStageDigest !== payload.artifactStageDigest
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Release status proof correlation mismatch' });
    }
  });
export type ReleaseRunCommand = z.infer<typeof releaseRunCommandSchema>;

export const abandonExpiredRunCommandSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    observedRunId: matrixCorpusSafeIdSchema,
    observedUserId: matrixCorpusSafeIdSchema,
    observedLeaseFence: matrixCorpusDecimalFenceSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    now: matrixCorpusRfc3339TimestampSchema,
    terminalControlId: matrixCorpusSafeIdSchema,
    terminalControl: matrixCorpusTerminalControlV1Schema,
    terminalPayloadDigest: matrixCorpusSha256DigestSchema,
    trigger: z.enum(['lease_expired', 'evaluator_abort']).optional(),
  })
  .strict()
  .superRefine((command, context) => {
    const payload = command.terminalControl;
    if (
      payload.kind !== 'abandoned' ||
      payload.eventId !== command.terminalControlId ||
      payload.runId !== command.observedRunId ||
      payload.userId !== command.observedUserId ||
      payload.leaseFence !== command.observedLeaseFence
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Abandon terminal command correlation mismatch' });
  });
export type AbandonExpiredRunCommand = z.infer<typeof abandonExpiredRunCommandSchema>;

export const getTransportStatusCommandSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    runFenceDigest: matrixCorpusKeyedDigestSchema,
    now: matrixCorpusRfc3339TimestampSchema,
  })
  .strict();
export type GetTransportStatusCommand = z.infer<typeof getTransportStatusCommandSchema>;

export const cleanupExactRunCommandSchema = z
  .object({
    runtimeAudience: matrixCorpusRuntimeAudienceSchema,
    currentRunId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    currentLeaseFence: matrixCorpusDecimalFenceSchema,
    leaseSlotDigest: matrixCorpusKeyedDigestSchema,
    currentRunFenceDigest: matrixCorpusKeyedDigestSchema,
    targetRunId: matrixCorpusSafeIdSchema,
    targetLeaseFence: matrixCorpusDecimalFenceSchema,
    targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
    expectedRevision: cleanupProgressRevisionSchema,
    idempotencyKeyDigest: matrixCorpusKeyedDigestSchema,
    canonicalRequestDigest: matrixCorpusKeyedDigestSchema,
    now: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine(
    (command) =>
      command.currentRunId !== command.targetRunId &&
      command.currentLeaseFence !== command.targetLeaseFence &&
      command.currentRunFenceDigest !== command.targetRunFenceDigest,
    { message: 'Cleanup current and target identities must differ' }
  );
export type CleanupExactRunCommand = z.infer<typeof cleanupExactRunCommandSchema>;

const claimInputBaseShape = {
  runtimeAudience: matrixCorpusRuntimeAudienceSchema,
  runId: matrixCorpusSafeIdSchema,
  userId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  leaseSlotDigest: matrixCorpusKeyedDigestSchema,
  runFenceDigest: matrixCorpusKeyedDigestSchema,
  ownerDigest: matrixCorpusKeyedDigestSchema,
  now: matrixCorpusRfc3339TimestampSchema,
} as const;

export const claimPendingIngestOutboxInputSchema = z
  .object({
    ...claimInputBaseShape,
    ingestOutboxId: matrixCorpusSafeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    purpose: outboxClaimPurposeSchema,
    claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine((input) => hasExactFiveMinuteTtl(input.now, input.claimExpiresAt), {
    message: 'Ingest claim expiry must be positive and at most five minutes',
  });
export type ClaimPendingIngestOutboxInput = z.infer<typeof claimPendingIngestOutboxInputSchema>;

export const renewIngestOutboxClaimInputSchema = z
  .object({
    ...claimInputBaseShape,
    ingestOutboxId: matrixCorpusSafeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    purpose: outboxClaimPurposeSchema,
    expectedClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    newClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .refine(
    (input) => Date.parse(input.newClaimExpiresAt) > Date.parse(input.expectedClaimExpiresAt),
    {
      message: 'Renewed ingest claim must extend prior expiry',
    }
  );
export type RenewIngestOutboxClaimInput = z.infer<typeof renewIngestOutboxClaimInputSchema>;

export const acknowledgeIngestOutboxInputSchema = z
  .object({
    ...claimInputBaseShape,
    ingestOutboxId: matrixCorpusSafeIdSchema,
    ingestReceiptId: matrixCorpusSafeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    claimPurpose: outboxClaimPurposeSchema,
    expectedClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    outcome: matrixCorpusIngestAcknowledgementOutcomeSchema,
  })
  .strict();
export type AcknowledgeIngestOutboxInput = z.infer<typeof acknowledgeIngestOutboxInputSchema>;

export const claimPendingTerminalControlOutboxInputSchema = z
  .object({
    ...claimInputBaseShape,
    terminalControlId: matrixCorpusSafeIdSchema,
    eventId: matrixCorpusSafeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.terminalControlId !== input.eventId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal claim identifiers must match' });
    if (!hasExactFiveMinuteTtl(input.now, input.claimExpiresAt))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal claim expiry must be positive and at most five minutes',
      });
  });
export type ClaimPendingTerminalControlOutboxInput = z.infer<
  typeof claimPendingTerminalControlOutboxInputSchema
>;

export const renewTerminalControlOutboxClaimInputSchema = z
  .object({
    ...claimInputBaseShape,
    terminalControlId: matrixCorpusSafeIdSchema,
    eventId: matrixCorpusSafeIdSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    expectedClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    newClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.terminalControlId !== input.eventId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal renewal identifiers must match' });
    if (Date.parse(input.newClaimExpiresAt) <= Date.parse(input.expectedClaimExpiresAt))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal renewal must extend prior expiry',
      });
  });
export type RenewTerminalControlOutboxClaimInput = z.infer<
  typeof renewTerminalControlOutboxClaimInputSchema
>;

export const acknowledgeTerminalControlInputSchema = z
  .object({
    ...claimInputBaseShape,
    requestTerminalControlId: matrixCorpusSafeIdSchema,
    requestEventId: matrixCorpusSafeIdSchema,
    requestPayloadDigest: matrixCorpusSha256DigestSchema,
    expectedClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    authoritativeWinner: matrixCorpusTerminalAuthoritativeWinnerV1Schema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.requestTerminalControlId !== input.requestEventId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal acknowledgement request identifiers must match',
      });
  });
export type AcknowledgeTerminalControlInput = z.infer<typeof acknowledgeTerminalControlInputSchema>;

const corruptFailureSchema = z
  .object({
    code: z.literal('CORRUPT_STATE'),
    recordKind: matrixCorpusCorruptRecordKindSchema,
  })
  .strict();
const phaseFailureSchema = z
  .object({
    code: z.literal('PHASE_CONFLICT'),
    actualPhase: matrixCorpusLeasePhaseSchema,
  })
  .strict();
const expiredFailureSchema = z
  .object({
    code: z.literal('LEASE_EXPIRED'),
    expiresAt: matrixCorpusRfc3339TimestampSchema,
  })
  .strict();
const staticFailureSchemas = [
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  z.object({ code: z.literal('IDEMPOTENCY_CONFLICT') }).strict(),
  corruptFailureSchema,
] as const;
const phaseStaticFailureSchemas = [phaseFailureSchema, ...staticFailureSchemas] as const;
const expiryPhaseStaticFailureSchemas = [expiredFailureSchema, ...phaseStaticFailureSchemas] as const;

export const provisioningLeaseResultSchema = z.union([
  z
    .object({
      code: z.literal('ACQUIRED'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('provisioning'),
      acquiredAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('acquire'),
      result: z.literal('acquired'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('provisioning'),
      acquiredAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z.object({ code: z.literal('RUN_ALREADY_ACTIVE') }).strict(),
  z.object({ code: z.literal('IDEMPOTENCY_CONFLICT') }).strict(),
  z.object({ code: z.literal('NOT_READY'), gate: z.literal('admission') }).strict(),
  corruptFailureSchema,
]).superRefine((result, context) => {
  if (
    (result.code === 'ACQUIRED' || result.code === 'ALREADY_APPLIED') &&
    !hasExactFiveMinuteTtl(result.acquiredAt, result.expiresAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acquire result TTL must be positive and bounded' });
});
export type ProvisioningLeaseResult = z.infer<typeof provisioningLeaseResultSchema>;

export const activationResultSchema = z.union([
  z
    .object({
      code: z.literal('ACTIVATED'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      activatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('activate'),
      result: z.literal('activated'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      activatedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  ...expiryPhaseStaticFailureSchemas,
  z.object({ code: z.literal('NOT_READY'), gate: z.literal('activation') }).strict(),
]);
export type ActivationResult = z.infer<typeof activationResultSchema>;

export const leaseRenewResultSchema = z.union([
  z
    .object({
      code: z.literal('LEASE_RENEWED'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      renewedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('renew'),
      result: z.literal('renewed'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('active'),
      renewedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  ...expiryPhaseStaticFailureSchemas,
]).superRefine((result, context) => {
  if (
    (result.code === 'LEASE_RENEWED' || result.code === 'ALREADY_APPLIED') &&
    !hasExactFiveMinuteTtl(result.renewedAt, result.expiresAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Renew result TTL must be positive and bounded' });
});
export type LeaseRenewResult = z.infer<typeof leaseRenewResultSchema>;

const capabilityIssueFailureSchemas = [
  ...expiryPhaseStaticFailureSchemas,
  z.object({ code: z.literal('CAPABILITY_REPLAY') }).strict(),
  z.object({ code: z.literal('CAPABILITY_EXPIRED') }).strict(),
  z.object({ code: z.literal('CAPABILITY_REVOKED') }).strict(),
] as const;
const capabilityConsumeFailureSchemas = [
  expiredFailureSchema,
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  phaseFailureSchema,
  corruptFailureSchema,
  z.object({ code: z.literal('CAPABILITY_REPLAY') }).strict(),
  z.object({ code: z.literal('CAPABILITY_EXPIRED') }).strict(),
  z.object({ code: z.literal('CAPABILITY_REVOKED') }).strict(),
] as const;

export const capabilityIssueResultSchema = z.union([
  z
    .object({
      code: z.literal('CAPABILITY_ISSUED'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('issue'),
      result: z.literal('issued'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      issuedAt: matrixCorpusRfc3339TimestampSchema,
      expiresAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  ...capabilityIssueFailureSchemas,
]).superRefine((result, context) => {
  if (
    (result.code === 'CAPABILITY_ISSUED' || result.code === 'ALREADY_APPLIED') &&
    !hasExactFiveMinuteTtl(result.issuedAt, result.expiresAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Issue result TTL must be positive and bounded' });
});
export type CapabilityIssueResult = z.infer<typeof capabilityIssueResultSchema>;

const matrixSendProofProjectionShape = {
  runId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  scenarioId: matrixCorpusSafeIdSchema,
  phase: matrixCorpusCapabilityPhaseSchema,
  turnIndex: z.number().int().min(0).max(19),
  recordedAt: matrixCorpusRfc3339TimestampSchema,
} as const;

export const matrixSendProofResultSchema = z.union([
  z
    .object({ code: z.literal('MATRIX_SEND_PROOF_RECORDED'), ...matrixSendProofProjectionShape })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('record_matrix_send_proof'),
      ...matrixSendProofProjectionShape,
    })
    .strict(),
  ...expiryPhaseStaticFailureSchemas,
  z.object({ code: z.literal('CAPABILITY_MISMATCH') }).strict(),
]);
export type MatrixSendProofResult = z.infer<typeof matrixSendProofResultSchema>;

export const capabilityConsumeResultSchema = z.union([
  z
    .object({
      code: z.literal('INGEST_ENQUEUED'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      ingestReceiptId: matrixCorpusSafeIdSchema,
      ingestOutboxId: matrixCorpusSafeIdSchema,
      acceptedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('consume'),
      result: z.literal('enqueued'),
      runId: matrixCorpusSafeIdSchema,
      scenarioId: matrixCorpusSafeIdSchema,
      phase: matrixCorpusCapabilityPhaseSchema,
      turnIndex: z.number().int().min(0).max(19),
      ingestReceiptId: matrixCorpusSafeIdSchema,
      ingestOutboxId: matrixCorpusSafeIdSchema,
      acceptedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  ...capabilityConsumeFailureSchemas,
  z.object({ code: z.literal('CAPABILITY_MISMATCH') }).strict(),
  z.object({ code: z.literal('TRANSPORT_REPLAY') }).strict(),
  z.object({ code: z.literal('TERMINAL_RECEIPT_LIMIT') }).strict(),
]);
export type CapabilityConsumeResult = z.infer<typeof capabilityConsumeResultSchema>;

export const quiesceResultSchema = z.union([
  z
    .object({
      code: z.literal('QUIESCED'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('quiescing'),
      quiescedAt: matrixCorpusRfc3339TimestampSchema,
      drained: z.boolean(),
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('quiesce'),
      result: z.literal('quiesced'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('quiescing'),
      quiescedAt: matrixCorpusRfc3339TimestampSchema,
      drained: z.boolean(),
    })
    .strict(),
  ...expiryPhaseStaticFailureSchemas,
]);
export type QuiesceResult = z.infer<typeof quiesceResultSchema>;

export const releaseResultSchema = z.union([
  z
    .object({
      code: z.literal('RELEASE_PENDING'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      createdAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((result) => result.terminalControlId === result.eventId, {
      message: 'Release result terminal identifiers must match',
    }),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('release'),
      result: z.literal('release_pending'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      createdAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((result) => result.terminalControlId === result.eventId, {
      message: 'Release replay terminal identifiers must match',
    }),
  ...expiryPhaseStaticFailureSchemas,
  z.object({ code: z.literal('NOT_READY'), gate: z.literal('release') }).strict(),
]);
export type ReleaseResult = z.infer<typeof releaseResultSchema>;

export const abandonPendingResultSchema = z.union([
  z
    .object({
      code: z.literal('ABANDON_PENDING'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('abandon_pending'),
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      reconciledAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((result) => result.terminalControlId === result.eventId, {
      message: 'Abandon result terminal identifiers must match',
    }),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('abandon'),
      result: z.literal('abandon_pending'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: z.literal('abandon_pending'),
      terminalControlId: matrixCorpusSafeIdSchema,
      eventId: matrixCorpusSafeIdSchema,
      reconciledAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict()
    .refine((result) => result.terminalControlId === result.eventId, {
      message: 'Abandon replay terminal identifiers must match',
    }),
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  phaseFailureSchema,
  z.object({ code: z.literal('NOT_READY'), gate: z.literal('abandon') }).strict(),
  corruptFailureSchema,
]);
export type AbandonPendingResult = z.infer<typeof abandonPendingResultSchema>;

export const transportStatusResultSchema = z.union([
  z
    .object({
      code: z.literal('TRANSPORT_STATUS'),
      runId: matrixCorpusSafeIdSchema,
      leaseFence: matrixCorpusDecimalFenceSchema,
      phase: matrixCorpusLeasePhaseSchema,
      consumedCapabilityCount: nonNegativeBoundedIntegerSchema,
      terminalIntexMarkerCount: nonNegativeBoundedIntegerSchema,
      terminalOutboxCount: nonNegativeBoundedIntegerSchema,
      replyOrDeliveryWorkInFlight: nonNegativeBoundedIntegerSchema,
      nonterminalIngestOutboxCount: z.number().int().min(0).max(1),
      drained: z.boolean(),
    })
    .strict(),
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  expiredFailureSchema,
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  corruptFailureSchema,
]).superRefine((result, context) => {
  if (result.code !== 'TRANSPORT_STATUS') return;
  const drained =
    result.phase === 'quiescing' &&
    result.nonterminalIngestOutboxCount === 0 &&
    result.consumedCapabilityCount === result.terminalIntexMarkerCount &&
    result.consumedCapabilityCount === result.terminalOutboxCount &&
    result.replyOrDeliveryWorkInFlight === 0;
  if (result.drained !== drained)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Transport status drain flag must be derived' });
});
export type TransportStatusResult = z.infer<typeof transportStatusResultSchema>;

export const cleanupResultSchema = z.union([
  z
    .object({
      code: z.literal('RUN_CLEANUP_PROGRESS'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      committedRevision: cleanupProgressCommittedRevisionSchema,
      remainingChildCount: cleanupRemainingChildCountSchema,
      chunkCommittedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('RUN_CLEANED'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      finalRevision: cleanupFinalRevisionSchema,
      cleanedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('cleanup'),
      result: z.literal('progress'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      committedRevision: cleanupProgressCommittedRevisionSchema,
      remainingChildCount: cleanupRemainingChildCountSchema,
      chunkCommittedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('cleanup'),
      result: z.literal('cleaned'),
      targetRunId: matrixCorpusSafeIdSchema,
      targetLeaseFence: matrixCorpusDecimalFenceSchema,
      targetRunFenceDigest: matrixCorpusKeyedDigestSchema,
      finalRevision: cleanupFinalRevisionSchema,
      cleanedAt: matrixCorpusRfc3339TimestampSchema,
    })
    .strict(),
  ...phaseStaticFailureSchemas,
]).superRefine((result, context) => {
  if (
    (result.code === 'RUN_CLEANUP_PROGRESS' ||
      (result.code === 'ALREADY_APPLIED' && result.operation === 'cleanup' && result.result === 'progress')) &&
    !hasCleanupProgressBudget(result.committedRevision, result.remainingChildCount)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cleanup progress exceeds remaining transaction budget' });
});
export type CleanupResult = z.infer<typeof cleanupResultSchema>;

const ingestClaimProjectionSchema = z
  .object({
    outboxKind: z.literal('ingest'),
    ingestOutboxId: matrixCorpusSafeIdSchema,
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    ownerDigest: matrixCorpusKeyedDigestSchema,
    purpose: outboxClaimPurposeSchema,
    claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
    payload: matrixCorpusAttestedIngestPayloadV1Schema,
    payloadDigest: matrixCorpusSha256DigestSchema,
  })
  .strict();
const terminalClaimProjectionShape = {
  outboxKind: z.literal('terminal'),
  terminalControlId: matrixCorpusSafeIdSchema,
  eventId: matrixCorpusSafeIdSchema,
  runId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  ownerDigest: matrixCorpusKeyedDigestSchema,
  claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  payload: matrixCorpusTerminalControlV1Schema,
  payloadDigest: matrixCorpusSha256DigestSchema,
} as const;
const claimFailureSchemas = [
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  expiredFailureSchema,
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  phaseFailureSchema,
  z.object({ code: z.literal('CLAIM_CONFLICT') }).strict(),
  corruptFailureSchema,
] as const;
const acknowledgementFailureSchemas = [
  z.object({ code: z.literal('NOT_FOUND') }).strict(),
  z.object({ code: z.literal('STALE_FENCE') }).strict(),
  phaseFailureSchema,
  z.object({ code: z.literal('CLAIM_CONFLICT') }).strict(),
  corruptFailureSchema,
] as const;

export const ingestClaimResultSchema = z.union([
  z.object({ code: z.literal('OUTBOX_CLAIMED') }).merge(ingestClaimProjectionSchema).strict(),
  z
    .object({ code: z.literal('ALREADY_APPLIED'), operation: z.literal('claim_ingest') })
    .merge(ingestClaimProjectionSchema)
    .strict(),
  ...claimFailureSchemas,
]);
export type IngestClaimResult = z.infer<typeof ingestClaimResultSchema>;

export const terminalClaimResultSchema = z.union([
  z
    .object({ code: z.literal('OUTBOX_CLAIMED'), ...terminalClaimProjectionShape })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.terminalControlId !== projection.eventId ||
        projection.payload.eventId !== projection.eventId ||
        projection.payload.runId !== projection.runId ||
        projection.payload.leaseFence !== projection.leaseFence
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal claim correlation mismatch' });
    }),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('claim_terminal'),
      ...terminalClaimProjectionShape,
    })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.terminalControlId !== projection.eventId ||
        projection.payload.eventId !== projection.eventId ||
        projection.payload.runId !== projection.runId ||
        projection.payload.leaseFence !== projection.leaseFence
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Terminal claim replay correlation mismatch' });
    }),
  ...claimFailureSchemas,
]);
export type TerminalClaimResult = z.infer<typeof terminalClaimResultSchema>;

const ingestClaimRenewalProjectionShape = {
  outboxKind: z.literal('ingest'),
  ingestOutboxId: matrixCorpusSafeIdSchema,
  runId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  ownerDigest: matrixCorpusKeyedDigestSchema,
  purpose: outboxClaimPurposeSchema,
  previousClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
} as const;
const terminalClaimRenewalProjectionShape = {
  outboxKind: z.literal('terminal'),
  terminalControlId: matrixCorpusSafeIdSchema,
  eventId: matrixCorpusSafeIdSchema,
  runId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  ownerDigest: matrixCorpusKeyedDigestSchema,
  previousClaimExpiresAt: matrixCorpusRfc3339TimestampSchema,
  claimExpiresAt: matrixCorpusRfc3339TimestampSchema,
} as const;
export const claimRenewResultSchema = z.union([
  z
    .object({ code: z.literal('OUTBOX_CLAIM_RENEWED'), ...ingestClaimRenewalProjectionShape })
    .strict(),
  z
    .object({ code: z.literal('OUTBOX_CLAIM_RENEWED'), ...terminalClaimRenewalProjectionShape })
    .strict()
    .refine((projection) => projection.terminalControlId === projection.eventId, {
      message: 'Terminal claim renewal identifiers must match',
    }),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('renew_claim'),
      ...ingestClaimRenewalProjectionShape,
    })
    .strict(),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('renew_claim'),
      ...terminalClaimRenewalProjectionShape,
    })
    .strict()
    .refine((projection) => projection.terminalControlId === projection.eventId, {
      message: 'Terminal claim renewal replay identifiers must match',
    }),
  ...claimFailureSchemas,
]).superRefine((result, context) => {
  if (
    'claimExpiresAt' in result &&
    Date.parse(result.claimExpiresAt) <= Date.parse(result.previousClaimExpiresAt)
  )
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Claim-renew result must extend prior expiry' });
});
export type ClaimRenewResult = z.infer<typeof claimRenewResultSchema>;

const ingestAcknowledgementProjectionSchema = z
  .object({
    outboxKind: z.literal('ingest'),
    ingestOutboxId: matrixCorpusSafeIdSchema,
    runId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    payloadDigest: matrixCorpusSha256DigestSchema,
    outcome: matrixCorpusIngestAcknowledgementOutcomeSchema,
    acknowledgedAt: matrixCorpusRfc3339TimestampSchema,
    drained: z.boolean(),
  })
  .strict();
export const acknowledgeResultSchema = z.union([
  z
    .object({ code: z.literal('OUTBOX_ACKNOWLEDGED') })
    .merge(ingestAcknowledgementProjectionSchema)
    .strict(),
  z
    .object({ code: z.literal('ALREADY_APPLIED'), operation: z.literal('acknowledge_ingest') })
    .merge(ingestAcknowledgementProjectionSchema)
    .strict(),
  ...acknowledgementFailureSchemas,
]).superRefine((result, context) => {
  if (!('outcome' in result)) return;
  const expectedAcknowledgedAt =
    result.outcome.kind === 'publication_acknowledged'
      ? result.outcome.publishedAt
      : result.outcome.kind === 'terminal_marker_acknowledged'
        ? result.outcome.terminalMarker.recordedAt
        : result.outcome.closedAt;
  if (result.acknowledgedAt !== expectedAcknowledgedAt)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acknowledgement result time must match outcome' });
  if (result.outcome.kind === 'publication_acknowledged' && result.drained)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Publication acknowledgement result cannot report drained',
    });
});
export type AcknowledgeResult = z.infer<typeof acknowledgeResultSchema>;

const terminalAcknowledgementProjectionShape = {
  outboxKind: z.literal('terminal'),
  requestTerminalControlId: matrixCorpusSafeIdSchema,
  requestEventId: matrixCorpusSafeIdSchema,
  runId: matrixCorpusSafeIdSchema,
  leaseFence: matrixCorpusDecimalFenceSchema,
  requestPayloadDigest: matrixCorpusSha256DigestSchema,
  authoritativeWinner: matrixCorpusTerminalAuthoritativeWinnerV1Schema,
  leasePhase: z.enum(['released', 'abandoned']),
} as const;
export const terminalControlAcknowledgementResultSchema = z.union([
  z
    .object({ code: z.literal('OUTBOX_ACKNOWLEDGED'), ...terminalAcknowledgementProjectionShape })
    .strict()
    .refine(
      (projection) =>
        projection.requestTerminalControlId === projection.requestEventId &&
        ((projection.authoritativeWinner.kind === 'release' && projection.leasePhase === 'released') ||
          (projection.authoritativeWinner.kind === 'abandoned' && projection.leasePhase === 'abandoned')),
      {
        message: 'Terminal acknowledgement request and final phase must match winner',
      }
    ),
  z
    .object({
      code: z.literal('ALREADY_APPLIED'),
      operation: z.literal('acknowledge_terminal'),
      ...terminalAcknowledgementProjectionShape,
    })
    .strict()
    .refine(
      (projection) =>
        projection.requestTerminalControlId === projection.requestEventId &&
        ((projection.authoritativeWinner.kind === 'release' && projection.leasePhase === 'released') ||
          (projection.authoritativeWinner.kind === 'abandoned' && projection.leasePhase === 'abandoned')),
      {
        message: 'Terminal acknowledgement replay request and final phase must match winner',
      }
    ),
  ...acknowledgementFailureSchemas,
]);
export type TerminalControlAcknowledgementResult = z.infer<
  typeof terminalControlAcknowledgementResultSchema
>;

export interface MatrixCorpusClock {
  now(): string;
}

export type MatrixCorpusDigestDomain =
  | 'imc-lease-slot-v1'
  | 'imc-run-fence-v1'
  | 'imc-capability-v1'
  | 'imc-transport-v1'
  | 'imc-matrix-idempotency-v1'
  | 'imc-matrix-event-v1'
  | 'imc-operation-idempotency-v1'
  | 'imc-operation-request-v1'
  | 'imc-terminal-v1'
  | 'imc-claim-owner-v1';

export interface MatrixCorpusKeyedDigestPort {
  digest(domain: MatrixCorpusDigestDomain, parts: readonly string[]): string;
}

export interface MatrixCorpusSha256Port {
  digestCanonical(canonicalJson: string): string;
}

export interface MatrixCorpusIdPort {
  ingestReceiptId(): string;
  ingestOutboxId(): string;
}

export interface MatrixCorpusControlDependencies {
  readonly repository: MatrixCorpusRepository;
  readonly clock: MatrixCorpusClock;
  readonly digests: MatrixCorpusKeyedDigestPort;
  readonly sha256: MatrixCorpusSha256Port;
  readonly ids: MatrixCorpusIdPort;
  readonly intexAgent: IntexAgentMatrixCorpusClient;
  readonly logger: Logger;
  readonly leaseTtlMs: number;
  readonly capabilityTtlMs: number;
}

export type {
  MatrixCorpusAttestedIngestPayloadV1,
  MatrixCorpusCapabilityConsumeFactsV1,
  MatrixCorpusCapabilityIssueRequestV1,
  MatrixCorpusCapabilityV1,
  MatrixCorpusControlStatusResult,
  MatrixCorpusCurrentAcceptanceResult,
  MatrixCorpusTerminalAuthoritativeWinnerV1,
  MatrixCorpusTerminalControlV1,
};
