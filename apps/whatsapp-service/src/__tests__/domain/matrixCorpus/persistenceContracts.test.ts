/* eslint-disable @typescript-eslint/explicit-function-return-type -- Contract fixtures preserve inferred literal result types. */
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import * as matrixCorpusContracts from '../../../domain/matrixCorpus/types.js';

const digest = 'a'.repeat(64);
const otherDigest = 'b'.repeat(64);
const runId = 'run_1';
const userId = 'user_1';
const leaseFence = '1';
const acquiredAt = '2026-07-20T00:00:00.000Z';
const expiresAt = '2026-07-20T00:05:00.000Z';
const tooLateExpiresAt = '2026-07-20T00:05:00.001Z';
const beforeAcquiredAt = '2026-07-19T23:59:59.999Z';
const beforeAcquiredExpiry = '2026-07-20T00:04:59.999Z';
const targetRunId = 'target_run_1';
const targetLeaseFence = '2';
const targetRunFenceDigest = 'c'.repeat(64);
const targetLeaseSlotDigest = 'd'.repeat(64);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`Test fixture is missing ${label}`);
  return value as Record<string, unknown>;
}

function acquireReceipt() {
  return {
    version: 1,
    operation: 'acquire' as const,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    resultCode: 'ACQUIRED' as const,
    replayProjection: {
      operation: 'acquire' as const,
      result: 'acquired' as const,
      runId,
      leaseFence,
      phase: 'provisioning' as const,
      acquiredAt,
      expiresAt,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function activateReceipt() {
  return {
    version: 1,
    operation: 'activate' as const,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    resultCode: 'ACTIVATED' as const,
    replayProjection: {
      operation: 'activate' as const,
      result: 'activated' as const,
      runId,
      leaseFence,
      phase: 'active' as const,
      activatedAt: acquiredAt,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function quiesceReceipt() {
  return {
    version: 1,
    operation: 'quiesce' as const,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    resultCode: 'QUIESCED' as const,
    replayProjection: {
      operation: 'quiesce' as const,
      result: 'quiesced' as const,
      runId,
      leaseFence,
      phase: 'quiescing' as const,
      quiescedAt: acquiredAt,
      drained: true,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function releaseReceipt() {
  return {
    version: 1,
    operation: 'release' as const,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    resultCode: 'RELEASE_PENDING' as const,
    replayProjection: {
      operation: 'release' as const,
      result: 'release_pending' as const,
      runId,
      leaseFence,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      createdAt: acquiredAt,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function renewReceipt() {
  return {
    version: 1,
    idempotencyKeyDigest: digest,
    runId,
    userId,
    leaseFence,
    canonicalRequestDigest: digest,
    replayProjection: {
      operation: 'renew' as const,
      result: 'renewed' as const,
      runId,
      leaseFence,
      phase: 'active' as const,
      renewedAt: acquiredAt,
      expiresAt,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function issuanceReceipt() {
  return {
    version: 1,
    matrixIdempotencyKeyDigest: digest,
    runId,
    userId,
    leaseFence,
    scenarioId: 'scenario_1',
    phase: 'start' as const,
    turnIndex: 0,
    issueRequestDigest: digest,
    capabilityDigest: digest,
    replayProjection: {
      operation: 'issue' as const,
      result: 'issued' as const,
      runId,
      scenarioId: 'scenario_1',
      phase: 'start' as const,
      turnIndex: 0,
      issuedAt: acquiredAt,
      expiresAt,
    },
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function lease(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runtimeAudience: 'hetzner-prod' as const,
    runId,
    userId,
    matrixRoomBindingDigest: digest,
    whatsappAccountBindingDigest: digest,
    whatsappSenderBindingDigest: digest,
    runFenceDigest: digest,
    phase: 'provisioning' as const,
    leaseFence,
    fenceEpoch: leaseFence,
    acquiredAt,
    activatedAt: null,
    renewedAt: acquiredAt,
    expiresAt,
    quiescedAt: null,
    releasedAt: null,
    abandonedAt: null,
    operationReceipts: {
      acquire: acquireReceipt(),
      activate: null,
      quiesce: null,
      release: null,
    },
    renewReceiptIds: [],
    capabilityIssuanceReceiptIds: [],
    unconsumedCapability: null,
    capabilityDigests: [],
    terminalFailureReceiptRefs: [],
    nonterminalIngestOutboxIds: [],
    ingestOutboxIds: [],
    terminalControlOutboxIds: [],
    transportReceiptIds: [],
    drain: {
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      drained: false,
    },
    terminalWinner: null,
    cleanupProgress: null,
    finalCleanupReceipt: null,
    ...overrides,
  };
}

function history(overrides: Record<string, unknown> = {}) {
  return {
    ...lease(),
    leaseSlotDigest: digest,
    ...overrides,
  };
}

function quiescingLease(overrides: Record<string, unknown> = {}) {
  return lease({
    phase: 'quiescing',
    activatedAt: acquiredAt,
    quiescedAt: acquiredAt,
    operationReceipts: {
      acquire: acquireReceipt(),
      activate: activateReceipt(),
      quiesce: quiesceReceipt(),
      release: null,
    },
    drain: {
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      drained: true,
    },
    ...overrides,
  });
}

function releasePendingLease(overrides: Record<string, unknown> = {}) {
  return lease({
    phase: 'release_pending',
    activatedAt: acquiredAt,
    quiescedAt: acquiredAt,
    operationReceipts: {
      acquire: acquireReceipt(),
      activate: activateReceipt(),
      quiesce: quiesceReceipt(),
      release: releaseReceipt(),
    },
    ...overrides,
  });
}

function releasedLease(overrides: Record<string, unknown> = {}) {
  return releasePendingLease({
    phase: 'released',
    releasedAt: acquiredAt,
    terminalControlOutboxIds: ['event_1'],
    terminalWinner: {
      kind: 'release',
      eventId: 'event_1',
      payloadDigest: digest,
      outcome: 'completed_passed',
      acknowledgedAt: acquiredAt,
    },
    ...overrides,
  });
}

function ingestPayload() {
  return {
    version: 1 as const,
    kind: 'matrix_corpus_ingest_payload' as const,
    ordinaryIngest: {
      type: 'intex.message.ingest' as const,
      userId,
      messageId: 'message_1',
      text: 'private natural text',
      sourceType: 'whatsapp_text' as const,
      timestamp: acquiredAt,
    },
    context: {
      version: 1 as const,
      kind: 'matrix_corpus' as const,
      runtimeAudience: 'hetzner-prod' as const,
      leaseFence,
      ingestReceiptId: 'receipt_1',
      runId,
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      turnIndex: 0,
      phase: 'start' as const,
      startNewSession: true,
      promptNormalizationVersion: 1,
      promptDigest: digest,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: {
        version: 1 as const,
        calls: [],
        forbiddenSelections: [],
        unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
      },
      mockProfileDigest: digest,
      expectedToolSchedule: [],
      currentDateTime: acquiredAt,
      timeZone: 'Europe/Warsaw',
    },
  };
}

function ingestOutbox(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    ingestOutboxId: 'outbox_1',
    ingestReceiptId: 'receipt_1',
    runId,
    userId,
    leaseFence,
    payload: ingestPayload(),
    payloadDigest: digest,
    status: 'pending' as const,
    claim: null,
    publisherReceiptDigest: null,
    publishedAt: null,
    terminalMarker: null,
    closedReason: null,
    acknowledgementReceipts: [],
    lastClaimRenewal: null,
    closedAt: null,
    createdAt: acquiredAt,
    ...overrides,
  };
}

function terminalOutbox(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    terminalControlId: 'event_1',
    eventId: 'event_1',
    runId,
    userId,
    leaseFence,
    kind: 'abandoned' as const,
    payload: {
      version: 1 as const,
      kind: 'abandoned' as const,
      eventId: 'event_1',
      runId,
      userId,
      leaseFence,
      createdAt: acquiredAt,
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    },
    payloadDigest: digest,
    status: 'pending' as const,
    claim: null,
    acknowledgedAt: null,
    closedReason: null,
    lastClaimRenewal: null,
    closedAt: null,
    createdAt: acquiredAt,
    ...overrides,
  };
}

function ingestDeliveryAttestation(overrides: Record<string, unknown> = {}) {
  return {
    generation: 1,
    issuedAt: acquiredAt,
    expiresAt,
    envelope: {
      version: 1 as const,
      kind: 'matrix_corpus_ingest' as const,
      ingestReceiptId: 'receipt_1',
      leaseFence,
      payloadDigest: digest,
      attestation: 'e30.e30.AA',
    },
    ...overrides,
  };
}

function terminalDeliveryAttestation(overrides: Record<string, unknown> = {}) {
  return {
    generation: 1,
    issuedAt: acquiredAt,
    expiresAt,
    envelope: {
      version: 1 as const,
      kind: 'matrix_corpus_terminal_control' as const,
      eventId: 'event_1',
      leaseFence,
      payloadDigest: digest,
      attestation: 'e30.e30.AA',
    },
    ...overrides,
  };
}

function acquireCommand(expiresAtValue: string) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId,
    userId,
    matrixRoomBindingDigest: digest,
    whatsappAccountBindingDigest: digest,
    whatsappSenderBindingDigest: digest,
    leaseSlotDigest: digest,
    runFenceDigest: digest,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    now: acquiredAt,
    expiresAt: expiresAtValue,
    acquisitionReadiness: { kind: 'admission_ready' as const, current: 'absent' as const },
  };
}

function renewCommand(expiresAtValue: string) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId,
    userId,
    leaseFence,
    leaseSlotDigest: digest,
    runFenceDigest: digest,
    idempotencyKeyDigest: digest,
    canonicalRequestDigest: digest,
    now: acquiredAt,
    expiresAt: expiresAtValue,
  };
}

function cleanupProgressProjection(
  committedRevision = 1,
  remainingChildCount = 1,
  overrides: Record<string, unknown> = {}
) {
  return {
    operation: 'cleanup' as const,
    result: 'progress' as const,
    targetRunId,
    targetLeaseFence,
    targetRunFenceDigest,
    committedRevision,
    remainingChildCount,
    chunkCommittedAt: acquiredAt,
    ...overrides,
  };
}

function cleanupProgressReceipt(
  expectedRevision = 0,
  committedRevision = expectedRevision + 1,
  remainingChildCount = 1,
  projectionOverrides: Record<string, unknown> = {}
) {
  return {
    version: 1 as const,
    idempotencyKeyDigest: expectedRevision.toString(16).padStart(64, '0'),
    canonicalRequestDigest: digest,
    expectedRevision,
    committedRevision,
    replayProjection: cleanupProgressProjection(committedRevision, remainingChildCount, projectionOverrides),
    resultDigest: digest,
    recordedAt: acquiredAt,
  };
}

function cleanupProgress(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    targetRunId,
    targetLeaseFence,
    targetRunFenceDigest,
    revision: 1,
    cursor: { kind: 'renew_receipt' as const, nextIndex: 0 },
    remaining: {
      renewReceiptIds: [digest],
      capabilityIssuanceReceiptIds: [],
      capabilityDigests: [],
      transportReceiptIds: [],
      ingestOutboxIds: [],
      terminalControlOutboxIds: [],
    },
    chunkReceipts: [cleanupProgressReceipt()],
    ...overrides,
  };
}

function targetHistory(overrides: Record<string, unknown> = {}) {
  const targetAcquireReceipt = acquireReceipt();
  return history({
    runId: targetRunId,
    leaseFence: targetLeaseFence,
    fenceEpoch: targetLeaseFence,
    runFenceDigest: targetRunFenceDigest,
    phase: 'abandoned' as const,
    abandonedAt: acquiredAt,
    terminalControlOutboxIds: ['target_event'],
    terminalWinner: {
      kind: 'abandoned' as const,
      eventId: 'target_event',
      payloadDigest: digest,
      outcome: 'provisioning_rolled_back' as const,
      acknowledgedAt: acquiredAt,
    },
    operationReceipts: {
      acquire: {
        ...targetAcquireReceipt,
        replayProjection: {
          ...targetAcquireReceipt.replayProjection,
          runId: targetRunId,
          leaseFence: targetLeaseFence,
        },
      },
      activate: null,
      quiesce: null,
      release: null,
    },
    leaseSlotDigest: targetLeaseSlotDigest,
    ...overrides,
  });
}

function currentHistoryPair(current: Record<string, unknown> = lease()) {
  return {
    leaseSlotDigest: digest,
    current,
    history: { ...current, leaseSlotDigest: digest },
  };
}

describe('Matrix corpus persistence contracts', () => {
  it('binds generation-numbered delivery attestations to immutable outbox identity', () => {
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(
        ingestOutbox({ deliveryAttestation: ingestDeliveryAttestation() })
      ).success
    ).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
        terminalOutbox({ deliveryAttestation: terminalDeliveryAttestation() })
      ).success
    ).toBe(true);

    for (const deliveryAttestation of [
      ingestDeliveryAttestation({ generation: 0 }),
      ingestDeliveryAttestation({ expiresAt: tooLateExpiresAt }),
      ingestDeliveryAttestation({
        envelope: { ...ingestDeliveryAttestation().envelope, ingestReceiptId: 'receipt_changed' },
      }),
      ingestDeliveryAttestation({
        envelope: { ...ingestDeliveryAttestation().envelope, payloadDigest: otherDigest },
      }),
    ])
      expect(
        matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(
          ingestOutbox({ deliveryAttestation })
        ).success
      ).toBe(false);

    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
        terminalOutbox({
          deliveryAttestation: terminalDeliveryAttestation({
            envelope: {
              ...terminalDeliveryAttestation().envelope,
              eventId: 'event_changed',
            },
          }),
        })
      ).success
    ).toBe(false);
  });
  it('requires the persisted current run-fence address', () => {
    const current = lease();
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(current).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...current,
        runFenceDigest: undefined,
      }).success
    ).toBe(false);
  });

  it('rejects a malformed persisted current run-fence address', () => {
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        lease({ runFenceDigest: 'malformed-run-fence-digest' })
      ).success
    ).toBe(false);
  });

  it('exports a strict current/history pair that rejects a mismatched child address', () => {
    const pairSchema = matrixCorpusContracts.matrixCorpusCurrentLeaseHistoryPairV1Schema;
    const current = lease();
    expect(pairSchema.safeParse({ leaseSlotDigest: digest, current, history: history() }).success).toBe(true);
    expect(
      pairSchema.safeParse({
        leaseSlotDigest: digest,
        current,
        history: history({ runFenceDigest: otherDigest }),
      }).success
    ).toBe(false);
  });

  it('rejects a current/history pair whose outer lease-slot address differs from history', () => {
    const result = matrixCorpusContracts.matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
      leaseSlotDigest: otherDigest,
      current: lease(),
      history: history(),
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.message)).toContain('Lease slot address must match history');
  });

  it('accepts exactly five minutes and rejects one extra millisecond for lease authority', () => {
    expect(matrixCorpusContracts.acquireProvisioningLeaseCommandSchema.safeParse(acquireCommand(expiresAt)).success).toBe(
      true
    );
    expect(
      matrixCorpusContracts.acquireProvisioningLeaseCommandSchema.safeParse(acquireCommand(tooLateExpiresAt)).success
    ).toBe(false);
    expect(matrixCorpusContracts.renewLeaseCommandSchema.safeParse(renewCommand(expiresAt)).success).toBe(true);
    expect(matrixCorpusContracts.renewLeaseCommandSchema.safeParse(renewCommand(tooLateExpiresAt)).success).toBe(false);
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease()).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease({ expiresAt: tooLateExpiresAt })).success
    ).toBe(false);
  });

  it('rejects a lease renewed before it was acquired even with an otherwise valid TTL', () => {
    const result = matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
      lease({ renewedAt: beforeAcquiredAt, expiresAt: beforeAcquiredExpiry })
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'Lease TTL must be current, positive, and bounded'
      );
  });

  it('bounds persisted and returned acquire, renew, and issue projections to five minutes', () => {
    const projections = [
      {
        operation: 'acquire' as const,
        result: 'acquired' as const,
        runId,
        leaseFence,
        phase: 'provisioning' as const,
        acquiredAt,
        expiresAt,
      },
      {
        operation: 'renew' as const,
        result: 'renewed' as const,
        runId,
        leaseFence,
        phase: 'active' as const,
        renewedAt: acquiredAt,
        expiresAt,
      },
      {
        operation: 'issue' as const,
        result: 'issued' as const,
        runId,
        scenarioId: 'scenario_1',
        phase: 'start' as const,
        turnIndex: 0,
        issuedAt: acquiredAt,
        expiresAt,
      },
    ];
    for (const projection of projections) {
      expect(matrixCorpusContracts.matrixCorpusPersistedReplayProjectionV1Schema.safeParse(projection).success).toBe(
        true
      );
      expect(
        matrixCorpusContracts.matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
          ...projection,
          expiresAt: tooLateExpiresAt,
        }).success
      ).toBe(false);
    }
  });

  it('bounds fresh and replay acquire, renew, and issue results to five minutes', () => {
    const results: readonly (readonly [ZodType, Record<string, unknown>])[] = [
      [
        matrixCorpusContracts.provisioningLeaseResultSchema,
        {
          code: 'ACQUIRED' as const,
          runId,
          leaseFence,
          phase: 'provisioning' as const,
          acquiredAt,
          expiresAt,
        },
      ],
      [
        matrixCorpusContracts.provisioningLeaseResultSchema,
        {
          code: 'ALREADY_APPLIED' as const,
          operation: 'acquire' as const,
          result: 'acquired' as const,
          runId,
          leaseFence,
          phase: 'provisioning' as const,
          acquiredAt,
          expiresAt,
        },
      ],
      [
        matrixCorpusContracts.leaseRenewResultSchema,
        {
          code: 'LEASE_RENEWED' as const,
          runId,
          leaseFence,
          phase: 'active' as const,
          renewedAt: acquiredAt,
          expiresAt,
        },
      ],
      [
        matrixCorpusContracts.leaseRenewResultSchema,
        {
          code: 'ALREADY_APPLIED' as const,
          operation: 'renew' as const,
          result: 'renewed' as const,
          runId,
          leaseFence,
          phase: 'active' as const,
          renewedAt: acquiredAt,
          expiresAt,
        },
      ],
      [
        matrixCorpusContracts.capabilityIssueResultSchema,
        {
          code: 'CAPABILITY_ISSUED' as const,
          runId,
          scenarioId: 'scenario_1',
          phase: 'start' as const,
          turnIndex: 0,
          issuedAt: acquiredAt,
          expiresAt,
        },
      ],
      [
        matrixCorpusContracts.capabilityIssueResultSchema,
        {
          code: 'ALREADY_APPLIED' as const,
          operation: 'issue' as const,
          result: 'issued' as const,
          runId,
          scenarioId: 'scenario_1',
          phase: 'start' as const,
          turnIndex: 0,
          issuedAt: acquiredAt,
          expiresAt,
        },
      ],
    ];
    for (const [schema, result] of results) {
      expect(schema.safeParse(result).success).toBe(true);
      expect(schema.safeParse({ ...result, expiresAt: tooLateExpiresAt }).success).toBe(false);
    }
  });

  it('correlates lifecycle receipts to their parent lease and timestamp', () => {
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease()).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        lease({ operationReceipts: { acquire: null, activate: null, quiesce: null, release: null } })
      ).success
    ).toBe(false);

    const active = lease({
      phase: 'active',
      activatedAt: acquiredAt,
      operationReceipts: { acquire: acquireReceipt(), activate: activateReceipt(), quiesce: null, release: null },
    });
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(active).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...active,
        operationReceipts: {
          ...active.operationReceipts,
          activate: { ...activateReceipt(), recordedAt: expiresAt },
        },
      }).success
    ).toBe(false);

    const releasePending = lease({
      phase: 'release_pending',
      activatedAt: acquiredAt,
      quiescedAt: acquiredAt,
      operationReceipts: {
        acquire: acquireReceipt(),
        activate: activateReceipt(),
        quiesce: quiesceReceipt(),
        release: releaseReceipt(),
      },
    });
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(releasePending).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...releasePending,
        operationReceipts: { ...releasePending.operationReceipts, release: null },
      }).success
    ).toBe(false);
  });

  it('rejects acquire, quiesce, and release receipt run, fence, and timestamp mismatches', () => {
    const acquire = acquireReceipt();
    const quiesce = quiesceReceipt();
    const release = releaseReceipt();
    const cases = [
      {
        record: lease(),
        slot: 'acquire' as const,
        receipt: { ...acquire, replayProjection: { ...acquire.replayProjection, runId: 'run_2' } },
      },
      {
        record: lease(),
        slot: 'acquire' as const,
        receipt: { ...acquire, replayProjection: { ...acquire.replayProjection, leaseFence: '2' } },
      },
      { record: lease(), slot: 'acquire' as const, receipt: { ...acquire, recordedAt: expiresAt } },
      {
        record: quiescingLease(),
        slot: 'quiesce' as const,
        receipt: { ...quiesce, replayProjection: { ...quiesce.replayProjection, runId: 'run_2' } },
      },
      {
        record: quiescingLease(),
        slot: 'quiesce' as const,
        receipt: { ...quiesce, replayProjection: { ...quiesce.replayProjection, leaseFence: '2' } },
      },
      { record: quiescingLease(), slot: 'quiesce' as const, receipt: { ...quiesce, recordedAt: expiresAt } },
      {
        record: releasePendingLease(),
        slot: 'release' as const,
        receipt: { ...release, replayProjection: { ...release.replayProjection, runId: 'run_2' } },
      },
      {
        record: releasePendingLease(),
        slot: 'release' as const,
        receipt: { ...release, replayProjection: { ...release.replayProjection, leaseFence: '2' } },
      },
      { record: releasePendingLease(), slot: 'release' as const, receipt: { ...release, recordedAt: expiresAt } },
    ];
    for (const entry of cases) {
      expect(matrixCorpusContracts.matrixCorpusOperationReceiptV1Schema.safeParse(entry.receipt).success).toBe(true);
      expect(
        matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
          ...entry.record,
          operationReceipts: { ...entry.record.operationReceipts, [entry.slot]: entry.receipt },
        }).success
      ).toBe(false);
    }
  });

  it('accepts automatic quiescence without an explicit quiesce receipt', () => {
    const automaticQuiesce = quiescingLease({
      operationReceipts: {
        acquire: acquireReceipt(),
        activate: activateReceipt(),
        quiesce: null,
        release: null,
      },
    });
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(automaticQuiesce).success).toBe(true);
  });

  it('exports strict history-child receipt validators for renew and issuance correlations', () => {
    const renewSchema = matrixCorpusContracts.matrixCorpusLeaseHistoryRenewReceiptPairV1Schema;
    const issuanceSchema = matrixCorpusContracts.matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema;
    const retainedRenewReceipt = renewReceipt();
    const renewedHistory = history({ renewReceiptIds: [digest] });
    expect(renewSchema.safeParse({ history: renewedHistory, receipt: retainedRenewReceipt }).success).toBe(true);
    expect(
      renewSchema.safeParse({ history: renewedHistory, receipt: { ...retainedRenewReceipt, runId: 'run_2' } }).success
    ).toBe(false);

    const retainedIssuanceReceipt = issuanceReceipt();
    const issuedHistory = history({ capabilityIssuanceReceiptIds: [digest] });
    expect(issuanceSchema.safeParse({ history: issuedHistory, receipt: retainedIssuanceReceipt }).success).toBe(true);
    expect(
      issuanceSchema.safeParse({
        history: issuedHistory,
        receipt: {
          ...retainedIssuanceReceipt,
          replayProjection: { ...retainedIssuanceReceipt.replayProjection, issuedAt: expiresAt },
        },
      }).success
    ).toBe(false);

    const renewPairCases = [
      {
        history: history({ renewReceiptIds: [otherDigest] }),
        receipt: retainedRenewReceipt,
      },
      {
        history: renewedHistory,
        receipt: { ...retainedRenewReceipt, userId: 'user_2' },
      },
      {
        history: renewedHistory,
        receipt: {
          ...retainedRenewReceipt,
          leaseFence: '2',
          replayProjection: { ...retainedRenewReceipt.replayProjection, leaseFence: '2' },
        },
      },
    ];
    for (const pair of renewPairCases) {
      expect(matrixCorpusContracts.matrixCorpusRenewReceiptV1Schema.safeParse(pair.receipt).success).toBe(true);
      const result = renewSchema.safeParse(pair);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.message)).toContain(
          'Renew receipt must be an exact history child'
        );
    }

    const issuancePairCases = [
      {
        history: history({ capabilityIssuanceReceiptIds: [otherDigest] }),
        receipt: retainedIssuanceReceipt,
      },
      {
        history: issuedHistory,
        receipt: { ...retainedIssuanceReceipt, userId: 'user_2' },
      },
      {
        history: issuedHistory,
        receipt: { ...retainedIssuanceReceipt, leaseFence: '2' },
      },
    ];
    for (const pair of issuancePairCases) {
      expect(matrixCorpusContracts.matrixCorpusCapabilityIssuanceReceiptV1Schema.safeParse(pair.receipt).success).toBe(
        true
      );
      const result = issuanceSchema.safeParse(pair);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.map((issue) => issue.message)).toContain(
          'Issuance receipt must be an exact history child'
        );
    }
  });

  it('contains every child reference and derives transport-status drained', () => {
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        lease({ unconsumedCapability: { digest: otherDigest, phase: 'start' } })
      ).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease({ nonterminalIngestOutboxIds: ['outbox_1'] }))
        .success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        lease({
          terminalFailureReceiptRefs: [{ transportReceiptId: otherDigest, capabilityDigest: otherDigest }],
        })
      ).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.transportStatusResultSchema.safeParse({
        code: 'TRANSPORT_STATUS',
        runId,
        leaseFence,
        phase: 'quiescing',
        consumedCapabilityCount: 1,
        terminalIntexMarkerCount: 1,
        terminalOutboxCount: 1,
        replyOrDeliveryWorkInFlight: 0,
        nonterminalIngestOutboxCount: 0,
        drained: false,
      }).success
    ).toBe(false);
  });

  it('separately rejects terminal failure receipts with a foreign transport or capability child', () => {
    const retainedFailure = lease({
      capabilityDigests: [digest],
      transportReceiptIds: [digest],
      terminalFailureReceiptRefs: [{ transportReceiptId: digest, capabilityDigest: digest }],
    });
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(retainedFailure).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...retainedFailure,
        terminalFailureReceiptRefs: [{ transportReceiptId: otherDigest, capabilityDigest: digest }],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...retainedFailure,
        terminalFailureReceiptRefs: [{ transportReceiptId: digest, capabilityDigest: otherDigest }],
      }).success
    ).toBe(false);
  });

  it('requires a terminal winner to belong to the retained terminal outbox children', () => {
    const released = releasedLease();
    const winner = requireRecord(released.terminalWinner, 'terminal winner');
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(released).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...released,
        terminalWinner: { ...winner, eventId: 'event_2' },
      }).success
    ).toBe(false);
  });

  it('rejects released leases without prior activation or quiescence', () => {
    const released = releasedLease();
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...released,
        activatedAt: null,
        operationReceipts: { ...released.operationReceipts, activate: null },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse({
        ...released,
        quiescedAt: null,
        operationReceipts: { ...released.operationReceipts, quiesce: null },
      }).success
    ).toBe(false);
  });

  it('rejects release-pending leases with outstanding authority, transport, counts, or work', () => {
    const pending = releasePendingLease();
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(pending).success).toBe(true);
    const outstandingStates = [
      {
        ...pending,
        capabilityDigests: [digest],
        unconsumedCapability: { digest, phase: 'start' as const },
      },
      {
        ...pending,
        ingestOutboxIds: ['outbox_1'],
        nonterminalIngestOutboxIds: ['outbox_1'],
      },
      {
        ...pending,
        drain: {
          consumedCapabilityCount: 1,
          terminalIntexMarkerCount: 0,
          terminalOutboxCount: 1,
          replyOrDeliveryWorkInFlight: 0,
          drained: false,
        },
      },
      {
        ...pending,
        drain: {
          consumedCapabilityCount: 1,
          terminalIntexMarkerCount: 1,
          terminalOutboxCount: 0,
          replyOrDeliveryWorkInFlight: 0,
          drained: false,
        },
      },
      {
        ...pending,
        drain: { ...pending.drain, replyOrDeliveryWorkInFlight: 1 },
      },
    ];
    for (const state of outstandingStates)
      expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(state).success).toBe(false);
  });

  it('retains a historical publication acknowledgement across later recovery authority', () => {
    const publicationAt = acquiredAt;
    const publicationExpiry = '2026-07-20T00:05:00.000Z';
    const recoveryExpiry = '2026-07-20T00:10:00.000Z';
    const publisherReceiptDigest = otherDigest;
    const publicationReceipt = {
      version: 1 as const,
      ownerDigest: digest,
      claimPurpose: 'publish' as const,
      expectedClaimExpiresAt: publicationExpiry,
      outcome: {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest,
        publishedAt: publicationAt,
      },
      acknowledgedAt: publicationAt,
      drained: false,
    };
    const published = ingestOutbox({
      status: 'published' as const,
      claim: {
        ownerDigest: otherDigest,
        purpose: 'terminal_marker_recovery' as const,
        claimedAt: publicationExpiry,
        expiresAt: recoveryExpiry,
      },
      publisherReceiptDigest,
      publishedAt: publicationAt,
      acknowledgementReceipts: [publicationReceipt],
      lastClaimRenewal: {
        ownerDigest: otherDigest,
        purpose: 'terminal_marker_recovery' as const,
        previousClaimExpiresAt: '2026-07-20T00:09:00.000Z',
        claimExpiresAt: recoveryExpiry,
      },
    });
    expect(matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(published).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusIngestAcknowledgementReceiptV1Schema.safeParse({
        ...publicationReceipt,
        drained: true,
      }).success
    ).toBe(false);
    const prePublicationRenewed = {
      ...published,
      claim: {
        ownerDigest: digest,
        purpose: 'terminal_marker_recovery' as const,
        claimedAt: acquiredAt,
        expiresAt: publicationExpiry,
      },
      lastClaimRenewal: {
        ownerDigest: digest,
        purpose: 'publish' as const,
        previousClaimExpiresAt: '2026-07-20T00:01:00.000Z',
        claimExpiresAt: publicationExpiry,
      },
    };
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(prePublicationRenewed).success
    ).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...prePublicationRenewed,
        claim: {
          ...prePublicationRenewed.claim,
          ownerDigest: otherDigest,
        },
        lastClaimRenewal: {
          ...prePublicationRenewed.lastClaimRenewal,
          ownerDigest: otherDigest,
        },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...prePublicationRenewed,
        claim: {
          ...prePublicationRenewed.claim,
          purpose: 'terminal_marker_recovery' as const,
          claimedAt: publicationExpiry,
          expiresAt: recoveryExpiry,
        },
        lastClaimRenewal: {
          ...prePublicationRenewed.lastClaimRenewal,
          previousClaimExpiresAt: '2026-07-20T00:09:00.000Z',
          claimExpiresAt: recoveryExpiry,
        },
      }).success
    ).toBe(false);

    const markerAt = '2026-07-20T00:06:00.000Z';
    const terminalMarker = { kind: 'completed' as const, digest, recordedAt: markerAt };
    const publishedWithMarker = {
      ...published,
      terminalMarker,
      acknowledgementReceipts: [
        publicationReceipt,
        {
          version: 1 as const,
          ownerDigest: otherDigest,
          claimPurpose: 'terminal_marker_recovery' as const,
          expectedClaimExpiresAt: recoveryExpiry,
          outcome: {
            kind: 'terminal_marker_acknowledged' as const,
            publisherReceiptDigest,
            publishedAt: publicationAt,
            terminalMarker,
            replyOrDeliveryWorkInFlight: 0 as const,
          },
          acknowledgedAt: markerAt,
          drained: true,
        },
      ],
    };
    expect(matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(publishedWithMarker).success).toBe(
      true
    );
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...publishedWithMarker,
        acknowledgementReceipts: [
          publicationReceipt,
          { ...publishedWithMarker.acknowledgementReceipts[1], claimPurpose: 'publish' as const },
        ],
      }).success
    ).toBe(false);
  });

  it('enforces the ingest status lattice and cooperative closure proof', () => {
    const claimed = ingestOutbox({
      status: 'claimed' as const,
      claim: {
        ownerDigest: digest,
        purpose: 'publish' as const,
        claimedAt: acquiredAt,
        expiresAt,
      },
    });
    expect(matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(claimed).success).toBe(true);

    const cooperativeClosed = ingestOutbox({
      status: 'closed' as const,
      claim: {
        ownerDigest: digest,
        purpose: 'publish' as const,
        claimedAt: acquiredAt,
        expiresAt,
      },
      closedReason: 'quiesced' as const,
      closedAt: acquiredAt,
      acknowledgementReceipts: [
        {
          version: 1 as const,
          ownerDigest: digest,
          claimPurpose: 'publish' as const,
          expectedClaimExpiresAt: expiresAt,
          outcome: {
            kind: 'claimed_not_published_closed' as const,
            reason: 'quiesced' as const,
            closedAt: acquiredAt,
          },
          acknowledgedAt: acquiredAt,
          drained: true,
        },
      ],
    });
    expect(matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(cooperativeClosed).success).toBe(
      true
    );
    const cooperativeClaim = requireRecord(cooperativeClosed.claim, 'cooperative close claim');
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...cooperativeClosed,
        claim: { ...cooperativeClaim, ownerDigest: otherDigest },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...cooperativeClosed,
        claim: { ...cooperativeClaim, expiresAt: '2026-07-20T00:04:00.000Z' },
      }).success
    ).toBe(false);

    const atomicClosed = ingestOutbox({
      status: 'closed' as const,
      closedReason: 'abandoned' as const,
      closedAt: acquiredAt,
    });
    const ingestClaim = requireRecord(claimed.claim, 'claimed ingest claim');
    expect(matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(atomicClosed).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...claimed,
        claim: { ...ingestClaim, purpose: 'terminal_marker_recovery' as const },
      }).success
    ).toBe(false);
  });

  it('retains only the latest claim renewal while allowing late exact replay inputs', () => {
    const renewal = {
      ownerDigest: digest,
      previousClaimExpiresAt: '2026-07-20T00:01:00.000Z',
      claimExpiresAt: expiresAt,
    };
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
        terminalOutbox({
          status: 'claimed' as const,
          claim: {
            ownerDigest: digest,
            purpose: 'publish' as const,
            claimedAt: acquiredAt,
            expiresAt,
          },
          lastClaimRenewal: renewal,
        })
      ).success
    ).toBe(true);

    const replayedExpiry = '2026-07-19T00:01:00.000Z';
    const replayedNewExpiry = '2026-07-19T00:02:00.000Z';
    const common = {
      runtimeAudience: 'hetzner-prod' as const,
      runId,
      userId,
      leaseFence,
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      ownerDigest: digest,
      now: acquiredAt,
    };
    expect(
      matrixCorpusContracts.renewIngestOutboxClaimInputSchema.safeParse({
        ...common,
        ingestOutboxId: 'outbox_1',
        payloadDigest: digest,
        purpose: 'publish' as const,
        expectedClaimExpiresAt: replayedExpiry,
        newClaimExpiresAt: replayedNewExpiry,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusContracts.renewTerminalControlOutboxClaimInputSchema.safeParse({
        ...common,
        terminalControlId: 'event_1',
        eventId: 'event_1',
        payloadDigest: digest,
        expectedClaimExpiresAt: replayedExpiry,
        newClaimExpiresAt: replayedNewExpiry,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusContracts.acknowledgeIngestOutboxInputSchema.safeParse({
        ...common,
        ingestOutboxId: 'outbox_1',
        ingestReceiptId: 'receipt_1',
        payloadDigest: digest,
        claimPurpose: 'publish' as const,
        expectedClaimExpiresAt: replayedExpiry,
        outcome: {
          kind: 'publication_acknowledged' as const,
          publisherReceiptDigest: digest,
          publishedAt: acquiredAt,
        },
      }).success
    ).toBe(true);
    expect(
      matrixCorpusContracts.acknowledgeTerminalControlInputSchema.safeParse({
        ...common,
        requestTerminalControlId: 'event_1',
        requestEventId: 'event_1',
        requestPayloadDigest: digest,
        expectedClaimExpiresAt: replayedExpiry,
        authoritativeWinner: {
          kind: 'release' as const,
          eventId: 'event_2',
          payloadDigest: digest,
          outcome: 'completed_passed' as const,
          acknowledgedAt: acquiredAt,
        },
      }).success
    ).toBe(true);
  });

  it('rejects every fresh and replay claim-renew result that does not extend its prior expiry', () => {
    const nonMonotonicExpiry = '2026-07-20T00:01:00.000Z';
    const ingestProjection = {
      outboxKind: 'ingest' as const,
      ingestOutboxId: 'outbox_1',
      runId,
      leaseFence,
      ownerDigest: digest,
      purpose: 'publish' as const,
      previousClaimExpiresAt: nonMonotonicExpiry,
      claimExpiresAt: nonMonotonicExpiry,
    };
    const terminalProjection = {
      outboxKind: 'terminal' as const,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId,
      leaseFence,
      ownerDigest: digest,
      previousClaimExpiresAt: nonMonotonicExpiry,
      claimExpiresAt: nonMonotonicExpiry,
    };
    const invalidResults = [
      { code: 'OUTBOX_CLAIM_RENEWED' as const, ...ingestProjection },
      { code: 'ALREADY_APPLIED' as const, operation: 'renew_claim' as const, ...ingestProjection },
      { code: 'OUTBOX_CLAIM_RENEWED' as const, ...terminalProjection },
      { code: 'ALREADY_APPLIED' as const, operation: 'renew_claim' as const, ...terminalProjection },
    ];

    expect(invalidResults.map((result) => matrixCorpusContracts.claimRenewResultSchema.safeParse(result).success)).toEqual(
      [false, false, false, false]
    );
  });

  it('correlates returned ingest acknowledgement time with its immutable outcome', () => {
    const result = {
      code: 'OUTBOX_ACKNOWLEDGED' as const,
      outboxKind: 'ingest' as const,
      ingestOutboxId: 'outbox_1',
      runId,
      leaseFence,
      payloadDigest: digest,
      outcome: {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest: digest,
        publishedAt: acquiredAt,
      },
      acknowledgedAt: acquiredAt,
      drained: false,
    };
    expect(matrixCorpusContracts.acknowledgeResultSchema.safeParse(result).success).toBe(true);
    expect(
      matrixCorpusContracts.acknowledgeResultSchema.safeParse({
        ...result,
        acknowledgedAt: expiresAt,
      }).success
    ).toBe(false);
    expect(matrixCorpusContracts.acknowledgeResultSchema.safeParse({ ...result, drained: true }).success).toBe(false);
  });

  it('enforces the terminal outbox state lattice and local immutable correlations', () => {
    const pending = terminalOutbox();
    expect(matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(pending).success).toBe(true);
    const claimed = terminalOutbox({
      status: 'claimed' as const,
      claim: { ownerDigest: digest, purpose: 'publish' as const, claimedAt: acquiredAt, expiresAt },
      lastClaimRenewal: {
        ownerDigest: digest,
        previousClaimExpiresAt: '2026-07-20T00:01:00.000Z',
        claimExpiresAt: expiresAt,
      },
    });
    const terminalClaim = requireRecord(claimed.claim, 'claimed terminal claim');
    const terminalClaimRenewal = requireRecord(
      claimed.lastClaimRenewal,
      'claimed terminal renewal'
    );
    expect(matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(claimed).success).toBe(true);
    const published = terminalOutbox({
      status: 'published' as const,
      claim: { ownerDigest: digest, purpose: 'publish' as const, claimedAt: acquiredAt, expiresAt },
      acknowledgedAt: acquiredAt,
    });
    expect(matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(published).success).toBe(true);
    const closed = terminalOutbox({
      status: 'closed' as const,
      closedReason: 'superseded_by_authoritative_winner' as const,
      closedAt: acquiredAt,
    });
    expect(matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(closed).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...claimed,
        claim: { ...terminalClaim, purpose: 'terminal_marker_recovery' as const },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...claimed,
        lastClaimRenewal: { ...terminalClaimRenewal, ownerDigest: otherDigest },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...pending,
        payload: { ...pending.payload, createdAt: expiresAt },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...closed,
        closedReason: 'expired_unclaimed_release' as const,
      }).success
    ).toBe(false);
  });

  it('requires target-owned cleanup identity on progress, replay, and every cleanup result', () => {
    const progress = cleanupProgress();
    const projection = cleanupProgressProjection();
    const results = [
      {
        code: 'RUN_CLEANUP_PROGRESS' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        committedRevision: 1,
        remainingChildCount: 1,
        chunkCommittedAt: acquiredAt,
      },
      {
        code: 'RUN_CLEANED' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        finalRevision: 1,
        cleanedAt: acquiredAt,
      },
      {
        code: 'ALREADY_APPLIED' as const,
        operation: 'cleanup' as const,
        result: 'progress' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        committedRevision: 1,
        remainingChildCount: 1,
        chunkCommittedAt: acquiredAt,
      },
      {
        code: 'ALREADY_APPLIED' as const,
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        finalRevision: 1,
        cleanedAt: acquiredAt,
      },
    ];

    expect(matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse(progress).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...progress,
        targetRunFenceDigest: undefined,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...progress,
        targetRunFenceDigest: 'malformed-target-run-fence-digest',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({ ...progress, ownerRunId: runId }).success
    ).toBe(false);
    expect(matrixCorpusContracts.matrixCorpusPersistedReplayProjectionV1Schema.safeParse(projection).success).toBe(
      true
    );
    expect(
      matrixCorpusContracts.matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        ...projection,
        targetRunFenceDigest: undefined,
      }).success
    ).toBe(false);
    expect(results.map((result) => matrixCorpusContracts.cleanupResultSchema.safeParse(result).success)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      results.map((result) =>
        matrixCorpusContracts.cleanupResultSchema.safeParse({ ...result, targetRunFenceDigest: undefined }).success
      )
    ).toEqual([false, false, false, false]);
  });

  it('bounds incomplete cleanup progress and reserves its final transaction', () => {
    const base = cleanupProgress();
    expect(matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse(base).success).toBe(true);
    const cleanedReceipt = {
      ...cleanupProgressReceipt(63, 64, 1),
      replayProjection: {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        finalRevision: 64,
        cleanedAt: acquiredAt,
      },
    };
    expect(matrixCorpusContracts.matrixCorpusCleanupChunkReceiptV1Schema.safeParse(cleanedReceipt).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({ ...base, revision: 64 }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...base,
        cursor: null,
        remaining: {
          renewReceiptIds: [],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: [],
          transportReceiptIds: [],
          ingestOutboxIds: [],
          terminalControlOutboxIds: [],
        },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({ ...base, chunkReceipts: [] }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...base,
        revision: 2,
        chunkReceipts: [
          cleanupProgressReceipt(0, 1, 2),
          cleanupProgressReceipt(2, 3, 1),
        ],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...base,
        revision: 2,
        chunkReceipts: [
          cleanupProgressReceipt(0, 1, 2),
          cleanupProgressReceipt(0, 1, 1),
        ],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...base,
        chunkReceipts: [
          {
            ...cleanupProgressReceipt(),
            replayProjection: {
              operation: 'cleanup' as const,
              result: 'cleaned' as const,
              targetRunId,
              targetLeaseFence,
              targetRunFenceDigest,
              finalRevision: 1,
              cleanedAt: acquiredAt,
            },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupChunkReceiptV1Schema.safeParse({
        ...cleanedReceipt,
        expectedRevision: 64,
        committedRevision: 65,
        replayProjection: { ...cleanedReceipt.replayProjection, finalRevision: 65 },
      }).success
    ).toBe(false);

    const childIds = Array.from({ length: 6_144 }, (_, index) => index.toString(16).padStart(64, '0'));
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...cleanupProgress({ revision: 0, chunkReceipts: [], cursor: { kind: 'capability' as const, nextIndex: 0 } }),
        remaining: {
          renewReceiptIds: [],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: childIds,
          transportReceiptIds: [digest],
          ingestOutboxIds: [],
          terminalControlOutboxIds: [],
        },
      }).success
    ).toBe(false);

    const insufficientBudgetReceipts = Array.from({ length: 63 }, (_, index) =>
      cleanupProgressReceipt(index, index + 1, 159 - index)
    );
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse(
        cleanupProgress({
          revision: 63,
          remaining: {
            renewReceiptIds: Array.from({ length: 97 }, (_, index) => index.toString(16).padStart(64, '0')),
            capabilityIssuanceReceiptIds: [],
            capabilityDigests: [],
            transportReceiptIds: [],
            ingestOutboxIds: [],
            terminalControlOutboxIds: [],
          },
          chunkReceipts: insufficientBudgetReceipts,
        })
      ).success
    ).toBe(false);
  });

  it('rejects cleanup commands that name an impossible progress revision', () => {
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      currentRunId: runId,
      userId,
      currentLeaseFence: leaseFence,
      leaseSlotDigest: digest,
      currentRunFenceDigest: digest,
      targetRunId,
      targetLeaseFence,
      targetRunFenceDigest,
      expectedRevision: 63,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      now: acquiredAt,
    };
    expect(matrixCorpusContracts.cleanupExactRunCommandSchema.safeParse(command).success).toBe(true);
    expect(
      matrixCorpusContracts.cleanupExactRunCommandSchema.safeParse({ ...command, expectedRevision: 64 }).success
    ).toBe(false);
  });

  it('enforces cleanup receipt deletion deltas and persisted remaining totals', () => {
    const twoReceipts = [cleanupProgressReceipt(0, 1, 2), cleanupProgressReceipt(1, 2, 1)];
    const valid = cleanupProgress({
      revision: 2,
      remaining: {
        renewReceiptIds: [digest],
        capabilityIssuanceReceiptIds: [],
        capabilityDigests: [],
        transportReceiptIds: [],
        ingestOutboxIds: [],
        terminalControlOutboxIds: [],
      },
      chunkReceipts: twoReceipts,
    });
    expect(matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse(valid).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...valid,
        chunkReceipts: [cleanupProgressReceipt(0, 1, 1), cleanupProgressReceipt(1, 2, 1)],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...valid,
        chunkReceipts: [cleanupProgressReceipt(0, 1, 98), cleanupProgressReceipt(1, 2, 1)],
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse({
        ...valid,
        chunkReceipts: [cleanupProgressReceipt(0, 1, 3), cleanupProgressReceipt(1, 2, 2)],
      }).success
    ).toBe(false);
  });

  it('exports a strict target-owned cleanup lease set with sorted contained child references', () => {
    interface StrictSchema { safeParse(input: unknown): { success: boolean } }
    const cleanupLeaseSetSchema = Reflect.get(
      matrixCorpusContracts,
      'matrixCorpusCleanupLeaseSetV1Schema'
    ) as StrictSchema | undefined;
    expect(cleanupLeaseSetSchema).toBeDefined();
    if (cleanupLeaseSetSchema === undefined) return;

    const target = targetHistory({
      renewReceiptIds: [digest, otherDigest],
      cleanupProgress: cleanupProgress({
        remaining: {
          renewReceiptIds: [digest, otherDigest],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: [],
          transportReceiptIds: [],
          ingestOutboxIds: [],
          terminalControlOutboxIds: [],
        },
        chunkReceipts: [cleanupProgressReceipt(0, 1, 2)],
      }),
    });
    const current = lease();
    const valid = { currentPair: currentHistoryPair(current), targetHistory: target };
    expect(cleanupLeaseSetSchema.safeParse(valid).success).toBe(true);
    expect(
      cleanupLeaseSetSchema.safeParse({
        ...valid,
        targetHistory: targetHistory({
          renewReceiptIds: [digest, otherDigest],
          cleanupProgress: cleanupProgress({
            remaining: {
              renewReceiptIds: [otherDigest, digest],
              capabilityIssuanceReceiptIds: [],
              capabilityDigests: [],
              transportReceiptIds: [],
              ingestOutboxIds: [],
              terminalControlOutboxIds: [],
            },
          }),
        }),
      }).success
    ).toBe(false);
    expect(
      cleanupLeaseSetSchema.safeParse({
        ...valid,
        targetHistory: targetHistory({
          renewReceiptIds: [digest],
          cleanupProgress: cleanupProgress({
            remaining: {
              renewReceiptIds: [digest, digest],
              capabilityIssuanceReceiptIds: [],
              capabilityDigests: [],
              transportReceiptIds: [],
              ingestOutboxIds: [],
              terminalControlOutboxIds: [],
            },
          }),
        }),
      }).success
    ).toBe(false);
    expect(
      cleanupLeaseSetSchema.safeParse({
        ...valid,
        targetHistory: targetHistory({
          cleanupProgress: cleanupProgress({
            remaining: {
              renewReceiptIds: [otherDigest],
              capabilityIssuanceReceiptIds: [],
              capabilityDigests: [],
              transportReceiptIds: [],
              ingestOutboxIds: [],
              terminalControlOutboxIds: [],
            },
          }),
        }),
      }).success
    ).toBe(false);
    for (const progressOverride of [
      { targetRunId: 'target_run_2' },
      { targetLeaseFence: '3' },
      { targetRunFenceDigest: otherDigest },
    ]) {
      expect(
        cleanupLeaseSetSchema.safeParse({
          ...valid,
          targetHistory: targetHistory({ cleanupProgress: cleanupProgress(progressOverride) }),
        }).success
      ).toBe(false);
    }
  });

  it('restricts cleanup progress and final receipts to their target-owned lifecycles', () => {
    const progress = cleanupProgress();
    const finalCleanupReceipt = {
      ...cleanupProgressReceipt(0, 1, 1),
      replayProjection: {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        finalRevision: 1,
        cleanedAt: acquiredAt,
      },
    };
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease({ cleanupProgress: progress })).success).toBe(
      false
    );
    expect(matrixCorpusContracts.matrixCorpusLeaseHistoryV1Schema.safeParse(history({ cleanupProgress: progress })).success).toBe(
      false
    );
    expect(matrixCorpusContracts.matrixCorpusLeaseHistoryV1Schema.safeParse(targetHistory({ cleanupProgress: progress })).success).toBe(
      true
    );
    expect(
      matrixCorpusContracts.matrixCorpusLeaseHistoryV1Schema.safeParse(
        targetHistory({ cleanupProgress: null, finalCleanupReceipt })
      ).success
    ).toBe(false);
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease({ finalCleanupReceipt })).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        quiescingLease({ finalCleanupReceipt })
      ).success
    ).toBe(false);
  });

  it('accepts the complete 63-progress-plus-final cleanup trajectory', () => {
    const chunkReceipts = Array.from({ length: 63 }, (_, index) =>
      cleanupProgressReceipt(index, index + 1, 63 - index)
    );
    const progress = cleanupProgress({
      revision: 63,
      remaining: {
        renewReceiptIds: [digest],
        capabilityIssuanceReceiptIds: [],
        capabilityDigests: [],
        transportReceiptIds: [],
        ingestOutboxIds: [],
        terminalControlOutboxIds: [],
      },
      chunkReceipts,
    });
    expect(matrixCorpusContracts.matrixCorpusCleanupProgressV1Schema.safeParse(progress).success).toBe(true);
    const finalCleanupReceipt = {
      ...cleanupProgressReceipt(63, 64, 1),
      replayProjection: {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId,
        targetLeaseFence,
        targetRunFenceDigest,
        finalRevision: 64,
        cleanedAt: acquiredAt,
      },
    };
    const current = lease({ finalCleanupReceipt });
    expect(
      matrixCorpusContracts.matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse(currentHistoryPair(current)).success
    ).toBe(true);
  });

  it('allows a provisioning successor to resume target-owned progress while rejecting a stale pair', () => {
    interface StrictSchema { safeParse(input: unknown): { success: boolean } }
    const cleanupLeaseSetSchema = Reflect.get(
      matrixCorpusContracts,
      'matrixCorpusCleanupLeaseSetV1Schema'
    ) as StrictSchema | undefined;
    expect(cleanupLeaseSetSchema).toBeDefined();
    if (cleanupLeaseSetSchema === undefined) return;

    const target = targetHistory({ renewReceiptIds: [digest], cleanupProgress: cleanupProgress() });
    const successor = lease({ runId: 'successor_run_1', leaseFence: '3', fenceEpoch: '3', runFenceDigest: otherDigest });
    const successorAcquire = acquireReceipt();
    const successorCurrent = {
      ...successor,
      operationReceipts: {
        ...successor.operationReceipts,
        acquire: {
          ...successorAcquire,
          replayProjection: {
            ...successorAcquire.replayProjection,
            runId: 'successor_run_1',
            leaseFence: '3',
          },
        },
      },
    };
    const successorPair = currentHistoryPair(successorCurrent);
    expect(cleanupLeaseSetSchema.safeParse({ currentPair: successorPair, targetHistory: target }).success).toBe(true);
    expect(
      cleanupLeaseSetSchema.safeParse({
        currentPair: { ...successorPair, current: lease() },
        targetHistory: target,
      }).success
    ).toBe(false);
  });

  it('bounds the first cleanup receipt deletion against the target-history baseline', () => {
    interface StrictSchema { safeParse(input: unknown): { success: boolean } }
    const cleanupLeaseSetSchema = Reflect.get(
      matrixCorpusContracts,
      'matrixCorpusCleanupLeaseSetV1Schema'
    ) as StrictSchema | undefined;
    expect(cleanupLeaseSetSchema).toBeDefined();
    if (cleanupLeaseSetSchema === undefined) return;

    const currentPair = currentHistoryPair();
    const zeroDeletionTarget = targetHistory({
      renewReceiptIds: [digest],
      cleanupProgress: cleanupProgress({
        remaining: {
          renewReceiptIds: [digest],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: [],
          transportReceiptIds: [],
          ingestOutboxIds: [],
          terminalControlOutboxIds: ['target_event'],
        },
        chunkReceipts: [cleanupProgressReceipt(0, 1, 2)],
      }),
    });
    const capabilityDigests = Array.from({ length: 98 }, (_, index) => index.toString(16).padStart(64, '0'));
    const firstCapabilityDigest = capabilityDigests[0] ?? digest;
    const excessiveDeletionTarget = targetHistory({
      capabilityDigests,
      cleanupProgress: cleanupProgress({
        cursor: { kind: 'capability' as const, nextIndex: 0 },
        remaining: {
          renewReceiptIds: [],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: [firstCapabilityDigest],
          transportReceiptIds: [],
          ingestOutboxIds: [],
          terminalControlOutboxIds: [],
        },
        chunkReceipts: [cleanupProgressReceipt(0, 1, 1)],
      }),
    });
    expect(
      [zeroDeletionTarget, excessiveDeletionTarget].map((targetHistory) =>
        cleanupLeaseSetSchema.safeParse({ currentPair, targetHistory }).success
      )
    ).toEqual([false, false]);
  });

  it('rejects every partial current-target identity collision', () => {
    interface StrictSchema { safeParse(input: unknown): { success: boolean } }
    const cleanupLeaseSetSchema = Reflect.get(
      matrixCorpusContracts,
      'matrixCorpusCleanupLeaseSetV1Schema'
    ) as StrictSchema | undefined;
    expect(cleanupLeaseSetSchema).toBeDefined();
    if (cleanupLeaseSetSchema === undefined) return;

    function provisioningCurrent(currentRunId: string, currentLeaseFence: string, currentRunFenceDigest: string) {
      const current = lease({
        runId: currentRunId,
        leaseFence: currentLeaseFence,
        fenceEpoch: currentLeaseFence,
        runFenceDigest: currentRunFenceDigest,
      });
      const acquire = acquireReceipt();
      return {
        ...current,
        operationReceipts: {
          ...current.operationReceipts,
          acquire: {
            ...acquire,
            replayProjection: {
              ...acquire.replayProjection,
              runId: currentRunId,
              leaseFence: currentLeaseFence,
            },
          },
        },
      };
    }

    const target = targetHistory({ renewReceiptIds: [digest], cleanupProgress: cleanupProgress() });
    const partialCurrentPairs = [
      currentHistoryPair(provisioningCurrent(targetRunId, '3', otherDigest)),
      currentHistoryPair(provisioningCurrent('successor_run_1', targetLeaseFence, otherDigest)),
      currentHistoryPair(provisioningCurrent('successor_run_1', '3', targetRunFenceDigest)),
    ];
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      currentRunId: runId,
      userId,
      currentLeaseFence: leaseFence,
      leaseSlotDigest: digest,
      currentRunFenceDigest: digest,
      targetRunId,
      targetLeaseFence,
      targetRunFenceDigest,
      expectedRevision: 0,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      now: acquiredAt,
    };
    const finalReceipt = {
      ...cleanupProgressReceipt(0, 1, 1),
      replayProjection: {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId: runId,
        targetLeaseFence: leaseFence,
        targetRunFenceDigest: digest,
        finalRevision: 1,
        cleanedAt: acquiredAt,
      },
    };
    expect([
      ...partialCurrentPairs.map((currentPair) => cleanupLeaseSetSchema.safeParse({ currentPair, targetHistory: target }).success),
      ...[
        { ...command, currentRunId: targetRunId },
        { ...command, currentLeaseFence: targetLeaseFence },
        { ...command, currentRunFenceDigest: targetRunFenceDigest },
      ].map((candidate) => matrixCorpusContracts.cleanupExactRunCommandSchema.safeParse(candidate).success),
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(lease({ finalCleanupReceipt: finalReceipt })).success,
    ]).toEqual([false, false, false, false, false, false, false]);
  });

  it('counts terminal-failure references only through their contained transport children', () => {
    const childIds = Array.from({ length: 6_143 }, (_, index) => index.toString(16).padStart(64, '0'));
    const firstChildId = childIds[0] ?? digest;
    const exactLimit = lease({
      capabilityDigests: [firstChildId],
      transportReceiptIds: childIds,
      terminalFailureReceiptRefs: [{ transportReceiptId: firstChildId, capabilityDigest: firstChildId }],
    });
    expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(exactLimit).success).toBe(true);
    expect(
      matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(
        lease({
          capabilityDigests: [firstChildId],
          transportReceiptIds: [...childIds, 'f'.repeat(64)],
        })
      ).success
    ).toBe(false);
  });

  it('covers every persisted receipt failure alternative', () => {
    expect(
      matrixCorpusContracts.canonicalMatrixCorpusPersistedReplayProjectionV1(
        quiesceReceipt().replayProjection
      )
    ).toContain('"drained":true');
    expect(
      matrixCorpusContracts.canonicalMatrixCorpusPersistedReplayProjectionV1(
        cleanupProgressProjection()
      )
    ).toContain('"committedRevision":1');

    expect(
      matrixCorpusContracts.matrixCorpusRenewReceiptV1Schema.safeParse({
        ...renewReceipt(),
        replayProjection: acquireReceipt().replayProjection,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusCapabilityIssuanceReceiptV1Schema.safeParse({
        ...issuanceReceipt(),
        replayProjection: acquireReceipt().replayProjection,
      }).success
    ).toBe(false);

    const transportReceipt = {
      version: 1 as const,
      transportMessageIdDigest: digest,
      capabilityDigest: digest,
      runId,
      leaseFence,
      userId,
      promptDigest: digest,
      ingressRequestDigest: digest,
      ingestReceiptId: 'receipt_1',
      ingestOutboxId: 'outbox_1',
      acceptedAt: acquiredAt,
      recordedAt: acquiredAt,
      terminalFailureCode: null,
    };
    expect(matrixCorpusContracts.matrixCorpusTransportReceiptV1Schema.safeParse(transportReceipt).success).toBe(
      true
    );
    expect(
      matrixCorpusContracts.matrixCorpusTransportReceiptV1Schema.safeParse({
        ...transportReceipt,
        ingestOutboxId: null,
        acceptedAt: null,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusTransportReceiptV1Schema.safeParse({
        ...transportReceipt,
        ingestReceiptId: null,
        ingestOutboxId: null,
        acceptedAt: null,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusTransportReceiptV1Schema.safeParse({
        ...transportReceipt,
        terminalFailureCode: 'CAPABILITY_REPLAY',
      }).success
    ).toBe(false);

    const publicationReceipt = {
      version: 1 as const,
      ownerDigest: digest,
      claimPurpose: 'publish' as const,
      expectedClaimExpiresAt: expiresAt,
      outcome: {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest: digest,
        publishedAt: acquiredAt,
      },
      acknowledgedAt: acquiredAt,
      drained: false,
    };
    expect(
      matrixCorpusContracts.matrixCorpusIngestAcknowledgementReceiptV1Schema.safeParse({
        ...publicationReceipt,
        acknowledgedAt: expiresAt,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(
        ingestOutbox({ acknowledgementReceipts: [publicationReceipt, publicationReceipt] })
      ).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(
        ingestOutbox({
          acknowledgementReceipts: [
            {
              ...publicationReceipt,
              outcome: {
                kind: 'claimed_not_published_closed' as const,
                reason: 'quiesced' as const,
                closedAt: acquiredAt,
              },
              drained: true,
            },
            publicationReceipt,
          ],
        })
      ).success
    ).toBe(false);
    expect(
      matrixCorpusContracts.matrixCorpusIngestOutboxRecordV1Schema.safeParse(
        ingestOutbox({ publisherReceiptDigest: digest })
      ).success
    ).toBe(false);

    expect(
      matrixCorpusContracts.matrixCorpusCleanupChunkReceiptV1Schema.safeParse({
        ...cleanupProgressReceipt(),
        replayProjection: cleanupProgressProjection(2, 1),
      }).success
    ).toBe(false);
  });

  it('rejects every terminal-outbox state mismatch branch', () => {
    const claim = {
      ownerDigest: digest,
      purpose: 'publish' as const,
      claimedAt: acquiredAt,
      expiresAt,
    };
    for (const invalid of [
      terminalOutbox({ claim }),
      terminalOutbox({ status: 'claimed', claim, acknowledgedAt: acquiredAt }),
      terminalOutbox({ status: 'published', acknowledgedAt: acquiredAt }),
      terminalOutbox({
        status: 'closed',
        claim,
        closedReason: 'superseded_by_authoritative_winner',
        closedAt: acquiredAt,
      }),
    ])
      expect(
        matrixCorpusContracts.matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(invalid)
          .success
      ).toBe(false);
  });

  it('rejects every remaining lease invariant branch', () => {
    const abandonedWinner = {
      kind: 'abandoned' as const,
      eventId: 'event_1',
      payloadDigest: digest,
      outcome: 'stopped_not_evaluated' as const,
      acknowledgedAt: acquiredAt,
    };
    const distinctTransportIds = [1, 2, 3].map((value) =>
      value.toString(16).padStart(64, '0')
    );
    const invalidLeases = [
      lease({ fenceEpoch: '2' }),
      lease({
        operationReceipts: {
          acquire: activateReceipt(),
          activate: null,
          quiesce: null,
          release: null,
        },
      }),
      lease({ renewReceiptIds: [digest, digest] }),
      lease({
        capabilityDigests: [digest],
        transportReceiptIds: [digest],
        terminalFailureReceiptRefs: [
          { transportReceiptId: digest, capabilityDigest: digest },
          { transportReceiptId: digest, capabilityDigest: digest },
        ],
      }),
      lease({
        capabilityDigests: [digest],
        transportReceiptIds: distinctTransportIds,
        terminalFailureReceiptRefs: distinctTransportIds.map((transportReceiptId) => ({
          transportReceiptId,
          capabilityDigest: digest,
        })),
      }),
      lease({ activatedAt: acquiredAt }),
      lease({ releasedAt: acquiredAt }),
      lease({ abandonedAt: acquiredAt }),
      lease({ phase: 'active' }),
      lease({ phase: 'quiescing' }),
      lease({
        phase: 'abandon_pending',
        terminalControlOutboxIds: ['event_1'],
        terminalWinner: abandonedWinner,
      }),
      lease({
        phase: 'abandoned',
        abandonedAt: acquiredAt,
        terminalControlOutboxIds: ['event_1'],
        terminalWinner: { ...abandonedWinner, kind: 'release' },
      }),
    ];
    for (const invalid of invalidLeases)
      expect(matrixCorpusContracts.matrixCorpusLeaseV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('checks every cleanup lease-set boundary and accepts a receipt-free initial progress', () => {
    const currentPair = currentHistoryPair();
    const target = targetHistory({ renewReceiptIds: [digest], cleanupProgress: cleanupProgress() });
    const noReceiptTarget = targetHistory({
      renewReceiptIds: [digest],
      cleanupProgress: cleanupProgress({ revision: 0, chunkReceipts: [] }),
    });
    const results = [
      matrixCorpusContracts.matrixCorpusCleanupLeaseSetV1Schema.safeParse({
        currentPair: currentHistoryPair(quiescingLease()),
        targetHistory: target,
      }).success,
      matrixCorpusContracts.matrixCorpusCleanupLeaseSetV1Schema.safeParse({
        currentPair,
        targetHistory: history(),
      }).success,
      matrixCorpusContracts.matrixCorpusCleanupLeaseSetV1Schema.safeParse({
        currentPair,
        targetHistory: targetHistory({
          userId: 'user_2',
          renewReceiptIds: [digest],
          cleanupProgress: cleanupProgress(),
        }),
      }).success,
      matrixCorpusContracts.matrixCorpusCleanupLeaseSetV1Schema.safeParse({
        currentPair,
        targetHistory: targetHistory({ cleanupProgress: null }),
      }).success,
      matrixCorpusContracts.matrixCorpusCleanupLeaseSetV1Schema.safeParse({
        currentPair,
        targetHistory: noReceiptTarget,
      }).success,
    ];
    expect(results).toEqual([false, false, false, false, true]);
  });
});
