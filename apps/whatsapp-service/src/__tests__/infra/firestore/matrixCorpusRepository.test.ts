/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function -- Test fixtures preserve inferred literal result types and use explicit no-op setup callbacks. */
import { createFakeFirestore, type Firestore } from '@intexuraos/infra-firestore';
import { describe, expect, it } from 'vitest';

import {
  FirestoreMatrixCorpusDeliveryRepository,
  FirestoreMatrixCorpusLeaseBindingAuthorization,
  FirestoreMatrixCorpusRepository,
  FirestoreMatrixCorpusSignedEnvelopeStore,
  MATRIX_CORPUS_CAPABILITIES_COLLECTION,
  MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION,
  MATRIX_CORPUS_RUN_LEASES_COLLECTION,
  MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION,
  MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION,
} from '../../../infra/firestore/matrixCorpusRepository.js';
import { FirestoreMatrixCorpusRecoveryScanner } from '../../../infra/firestore/matrixCorpusRecoveryScanner.js';
import type {
  ConsumeCapabilityAndEnqueueIngestCommand,
  MatrixCorpusLeaseV1,
} from '../../../domain/matrixCorpus/types.js';

const timestamp = '2026-07-20T10:00:00.000Z';
const claimExpiresAt = '2026-07-20T10:01:00.000Z';
const firstJwsExpiresAt = '2026-07-20T10:05:00.000Z';
const digest = 'a'.repeat(64);
const runFenceDigest = 'b'.repeat(64);
const ownerDigest = 'c'.repeat(64);
const payloadDigest = 'd'.repeat(64);
const leaseSlotDigest = digest;

function lifecycleRepository(firestore: Firestore) {
  return new FirestoreMatrixCorpusRepository({
    firestore,
    replayProjectionDigest: { digest: () => 'e'.repeat(64) },
  });
}

function acquireLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_lifecycle',
    userId: 'private_user_fixture',
    matrixRoomBindingDigest: '7'.repeat(64),
    whatsappAccountBindingDigest: '8'.repeat(64),
    whatsappSenderBindingDigest: '9'.repeat(64),
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: '1'.repeat(64),
    canonicalRequestDigest: '2'.repeat(64),
    now: timestamp,
    expiresAt: '2026-07-20T10:05:00.000Z',
    acquisitionReadiness: { kind: 'admission_ready' as const, current: 'absent' as const },
  };
}

function activateLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_lifecycle',
    userId: 'private_user_fixture',
    leaseFence: '1',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: '3'.repeat(64),
    canonicalRequestDigest: '4'.repeat(64),
    now: '2026-07-20T10:00:01.000Z',
    controlStatus: {
      kind: 'status' as const,
      runId: 'run_lifecycle',
      userId: 'private_user_fixture',
      leaseFence: '1',
      lifecycle: 'running' as const,
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
      contextFinalizationTombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    },
  };
}

function renewLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_lifecycle',
    userId: 'private_user_fixture',
    leaseFence: '1',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: '5'.repeat(64),
    canonicalRequestDigest: '6'.repeat(64),
    now: '2026-07-20T10:00:02.000Z',
    expiresAt: '2026-07-20T10:05:02.000Z',
  };
}

function operationReceipt(operation: 'acquire' | 'activate') {
  if (operation === 'acquire')
    return {
      version: 1 as const,
      operation,
      idempotencyKeyDigest: '1'.repeat(64),
      canonicalRequestDigest: '2'.repeat(64),
      resultCode: 'ACQUIRED' as const,
      replayProjection: {
        operation,
        result: 'acquired' as const,
        runId: 'run_1',
        leaseFence: '7',
        phase: 'provisioning' as const,
        acquiredAt: timestamp,
        expiresAt: '2026-07-20T10:05:00.000Z',
      },
      resultDigest: '3'.repeat(64),
      recordedAt: timestamp,
    };
  return {
    version: 1 as const,
    operation,
    idempotencyKeyDigest: '4'.repeat(64),
    canonicalRequestDigest: '5'.repeat(64),
    resultCode: 'ACTIVATED' as const,
    replayProjection: {
      operation,
      result: 'activated' as const,
      runId: 'run_1',
      leaseFence: '7',
      phase: 'active' as const,
      activatedAt: timestamp,
    },
    resultDigest: '6'.repeat(64),
    recordedAt: timestamp,
  };
}

function lease() {
  return {
    version: 1 as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    matrixRoomBindingDigest: '7'.repeat(64),
    whatsappAccountBindingDigest: '8'.repeat(64),
    whatsappSenderBindingDigest: '9'.repeat(64),
    runFenceDigest,
    phase: 'active' as const,
    leaseFence: '7',
    fenceEpoch: '7',
    acquiredAt: timestamp,
    activatedAt: timestamp,
    renewedAt: timestamp,
    expiresAt: '2026-07-20T10:05:00.000Z',
    quiescedAt: null,
    releasedAt: null,
    abandonedAt: null,
    operationReceipts: {
      acquire: operationReceipt('acquire'),
      activate: operationReceipt('activate'),
      quiesce: null,
      release: null,
    },
    renewReceiptIds: [],
    capabilityIssuanceReceiptIds: [],
    unconsumedCapability: null,
    capabilityDigests: [],
    terminalFailureReceiptRefs: [],
    nonterminalIngestOutboxIds: ['outbox_1'],
    ingestOutboxIds: ['outbox_1'],
    terminalControlOutboxIds: [],
    transportReceiptIds: [],
    drain: {
      consumedCapabilityCount: 1,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      drained: false,
    },
    terminalWinner: null,
    cleanupProgress: null,
    finalCleanupReceipt: null,
  };
}

function ingestPayload() {
  return {
    version: 1 as const,
    kind: 'matrix_corpus_ingest_payload' as const,
    ordinaryIngest: {
      type: 'intex.message.ingest' as const,
      userId: 'private_user_fixture',
      messageId: 'private_message_fixture',
      text: 'private natural-text fixture',
      sourceType: 'whatsapp_text' as const,
      timestamp,
    },
    context: {
      version: 1 as const,
      kind: 'matrix_corpus' as const,
      runtimeAudience: 'hetzner-prod' as const,
      leaseFence: '7',
      ingestReceiptId: 'receipt_1',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      turnIndex: 0,
      phase: 'start' as const,
      startNewSession: true,
      promptNormalizationVersion: 1 as const,
      promptDigest: 'e'.repeat(64),
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: {
        version: 1 as const,
        calls: [],
        forbiddenSelections: [],
        unexpectedKnownToolPolicy: 'behavioral_failure_no_execution' as const,
      },
      mockProfileDigest: 'f'.repeat(64),
      expectedToolSchedule: [],
      currentDateTime: timestamp,
      timeZone: 'Europe/Warsaw',
    },
  };
}

function outbox() {
  return {
    version: 1 as const,
    ingestOutboxId: 'outbox_1',
    ingestReceiptId: 'receipt_1',
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    payload: ingestPayload(),
    payloadDigest,
    status: 'claimed' as const,
    claim: {
      ownerDigest,
      purpose: 'publish' as const,
      claimedAt: timestamp,
      expiresAt: claimExpiresAt,
    },
    publisherReceiptDigest: null,
    publishedAt: null,
    terminalMarker: null,
    closedReason: null,
    acknowledgementReceipts: [],
    lastClaimRenewal: null,
    closedAt: null,
    createdAt: timestamp,
  };
}

function publishedOutbox() {
  const publishedAt = '2026-07-20T10:00:01.000Z';
  const publisherReceiptDigest = 'e'.repeat(64);
  return {
    ...outbox(),
    status: 'published' as const,
    claim: {
      ownerDigest,
      purpose: 'terminal_marker_recovery' as const,
      claimedAt: timestamp,
      expiresAt: claimExpiresAt,
    },
    publisherReceiptDigest,
    publishedAt,
    acknowledgementReceipts: [
      {
        version: 1 as const,
        ownerDigest,
        claimPurpose: 'publish' as const,
        expectedClaimExpiresAt: claimExpiresAt,
        outcome: {
          kind: 'publication_acknowledged' as const,
          publisherReceiptDigest,
          publishedAt,
        },
        acknowledgedAt: publishedAt,
        drained: false,
      },
    ],
  };
}

function authority(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    payloadDigest,
    expectedClaimExpiresAt: claimExpiresAt,
    ingestOutboxId: 'outbox_1',
    ...overrides,
  };
}

function envelope(attestation = 'e30.e30.AA') {
  return {
    version: 1 as const,
    kind: 'matrix_corpus_ingest' as const,
    ingestReceiptId: 'receipt_1',
    leaseFence: '7',
    payloadDigest,
    attestation,
  };
}

function terminalLease() {
  return {
    ...lease(),
    phase: 'abandon_pending' as const,
    terminalControlOutboxIds: ['terminal_1'],
  };
}

function terminalOutbox() {
  return {
    version: 1 as const,
    terminalControlId: 'terminal_1',
    eventId: 'terminal_1',
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    kind: 'abandoned' as const,
    payload: {
      version: 1 as const,
      eventId: 'terminal_1',
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      createdAt: timestamp,
      kind: 'abandoned' as const,
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    },
    payloadDigest,
    status: 'claimed' as const,
    claim: {
      ownerDigest,
      purpose: 'publish' as const,
      claimedAt: timestamp,
      expiresAt: claimExpiresAt,
    },
    acknowledgedAt: null,
    closedReason: null,
    lastClaimRenewal: null,
    closedAt: null,
    createdAt: timestamp,
  };
}

function terminalAuthority(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    payloadDigest,
    expectedClaimExpiresAt: claimExpiresAt,
    terminalControlId: 'terminal_1',
    eventId: 'terminal_1',
    ...overrides,
  };
}

function terminalEnvelope(attestation = 'e30.e30.AA') {
  return {
    version: 1 as const,
    kind: 'matrix_corpus_terminal_control' as const,
    eventId: 'terminal_1',
    leaseFence: '7',
    payloadDigest,
    attestation,
  };
}

function fixture() {
  const fakeFirestore = createFakeFirestore();
  fakeFirestore.clear();
  const firestore = fakeFirestore as unknown as Firestore;
  const current = lease();
  fakeFirestore.seedCollection(
    MATRIX_CORPUS_RUN_LEASES_COLLECTION,
    [{ id: leaseSlotDigest, data: current }]
  );
  fakeFirestore.seedCollection(
    `${MATRIX_CORPUS_RUN_LEASES_COLLECTION}/${leaseSlotDigest}/runs`,
    [{ id: runFenceDigest, data: { ...current, leaseSlotDigest } }]
  );
  fakeFirestore.seedCollection(
    MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION,
    [{ id: 'outbox_1', data: outbox() }]
  );
  return {
    firestore,
    repo: new FirestoreMatrixCorpusSignedEnvelopeStore({ firestore }),
  };
}

async function persistLeasePair(
  firestore: Firestore,
  current: Readonly<Record<string, unknown>>
) {
  await firestore
    .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
    .doc(leaseSlotDigest)
    .set(current);
  await firestore
    .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
    .doc(leaseSlotDigest)
    .collection('runs')
    .doc(runFenceDigest)
    .set({ ...current, leaseSlotDigest });
}

function ingestClaimCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  const { expectedClaimExpiresAt: _expectedClaimExpiresAt, ...claimAuthority } = authority();
  return {
    ...claimAuthority,
    purpose: 'publish' as const,
    now: timestamp,
    claimExpiresAt,
    ...overrides,
  };
}

function ingestRenewCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: '2026-07-20T10:00:30.000Z',
    ingestOutboxId: 'outbox_1',
    payloadDigest,
    purpose: 'publish' as const,
    expectedClaimExpiresAt: claimExpiresAt,
    newClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    ...overrides,
  };
}

function ingestAcknowledgementCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: '2026-07-20T10:00:30.000Z',
    ingestOutboxId: 'outbox_1',
    ingestReceiptId: 'receipt_1',
    payloadDigest,
    claimPurpose: 'publish' as const,
    expectedClaimExpiresAt: claimExpiresAt,
    outcome: {
      kind: 'publication_acknowledged' as const,
      publisherReceiptDigest: '1'.repeat(64),
      publishedAt: '2026-07-20T10:00:30.000Z',
    },
    ...overrides,
  };
}

function terminalClaimCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  const { expectedClaimExpiresAt: _expectedClaimExpiresAt, ...claimAuthority } =
    terminalAuthority();
  return { ...claimAuthority, now: timestamp, claimExpiresAt, ...overrides };
}

function terminalRenewCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: '2026-07-20T10:00:30.000Z',
    terminalControlId: 'terminal_1',
    eventId: 'terminal_1',
    payloadDigest,
    expectedClaimExpiresAt: claimExpiresAt,
    newClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    ...overrides,
  };
}

function terminalAcknowledgementCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  const acknowledgedAt = '2026-07-20T10:00:30.000Z';
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: acknowledgedAt,
    requestTerminalControlId: 'terminal_1',
    requestEventId: 'terminal_1',
    requestPayloadDigest: payloadDigest,
    expectedClaimExpiresAt: claimExpiresAt,
    authoritativeWinner: {
      kind: 'abandoned' as const,
      eventId: 'terminal_1',
      payloadDigest,
      outcome: 'stopped_not_evaluated' as const,
      acknowledgedAt,
    },
    ...overrides,
  };
}

function releaseTerminalClaimCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: '2026-07-20T10:00:06.000Z',
    terminalControlId: 'terminal_release',
    eventId: 'terminal_release',
    payloadDigest: 'd'.repeat(64),
    claimExpiresAt: '2026-07-20T10:01:06.000Z',
    ...overrides,
  };
}

function releaseTerminalRenewCommand(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: '2026-07-20T10:00:30.000Z',
    terminalControlId: 'terminal_release',
    eventId: 'terminal_release',
    payloadDigest: 'd'.repeat(64),
    expectedClaimExpiresAt: '2026-07-20T10:01:06.000Z',
    newClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    ...overrides,
  };
}

function releaseTerminalAcknowledgementCommand(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const acknowledgedAt = '2026-07-20T10:00:30.000Z';
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    ownerDigest,
    now: acknowledgedAt,
    requestTerminalControlId: 'terminal_release',
    requestEventId: 'terminal_release',
    requestPayloadDigest: 'd'.repeat(64),
    expectedClaimExpiresAt: '2026-07-20T10:01:06.000Z',
    authoritativeWinner: {
      kind: 'release' as const,
      eventId: 'terminal_release',
      payloadDigest: 'd'.repeat(64),
      outcome: 'completed_passed' as const,
      acknowledgedAt,
    },
    ...overrides,
  };
}

describe('FirestoreMatrixCorpusRecoveryScanner', () => {
  it('returns bounded pending and expired-claim outbox authority without trusting document ids', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const pending = {
      ...outbox(),
      status: 'pending' as const,
      claim: null,
    };
    const corrupt = { ...pending, ingestOutboxId: 'different_id' };
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: pending.ingestOutboxId, data: pending },
      { id: 'corrupt_id', data: corrupt },
    ]);
    fakeFirestore.seedCollection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION, [
      { id: 'terminal_1', data: terminalOutbox() },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    const candidates = await scanner.listOutboxCandidates({
      now: '2026-07-20T10:02:00.000Z',
      limit: 32,
      ownerDigest,
    });

    expect(candidates.ingest).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'private_user_fixture',
        leaseFence: '7',
        leaseSlotDigest,
        runFenceDigest,
        ownerDigest,
        ingestOutboxId: 'outbox_1',
        payloadDigest,
        purpose: 'publish',
      },
    ]);
    expect(candidates.terminal).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: 'run_1',
        userId: 'private_user_fixture',
        leaseFence: '7',
        leaseSlotDigest,
        runFenceDigest,
        ownerDigest,
        terminalControlId: 'terminal_1',
        eventId: 'terminal_1',
        payloadDigest,
      },
    ]);
  });

  it('does not return a still-live claim and never exceeds the closed batch limit', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: 'outbox_1', data: outbox() },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    await expect(
      scanner.listOutboxCandidates({
        now: '2026-07-20T10:00:30.000Z',
        limit: 32,
        ownerDigest,
      })
    ).resolves.toEqual({ ingest: [], terminal: [] });
  });

  it('returns a published ingest outbox for exact terminal-marker recovery', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const publishedAt = '2026-07-20T10:00:01.000Z';
    const publisherReceiptDigest = 'e'.repeat(64);
    const published = {
      ...outbox(),
      status: 'published' as const,
      claim: {
        ownerDigest,
        purpose: 'terminal_marker_recovery' as const,
        claimedAt: timestamp,
        expiresAt: claimExpiresAt,
      },
      publisherReceiptDigest,
      publishedAt,
      acknowledgementReceipts: [
        {
          version: 1 as const,
          ownerDigest,
          claimPurpose: 'publish' as const,
          expectedClaimExpiresAt: claimExpiresAt,
          outcome: {
            kind: 'publication_acknowledged' as const,
            publisherReceiptDigest,
            publishedAt,
          },
          acknowledgedAt: publishedAt,
          drained: false,
        },
      ],
    };
    const terminalMarker = {
      kind: 'completed' as const,
      digest: 'f'.repeat(64),
      recordedAt: '2026-07-20T10:00:30.000Z',
    };
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: published.ingestOutboxId, data: published },
      {
        id: 'published_wrong_claim',
        data: {
          ...published,
          ingestOutboxId: 'published_wrong_claim',
          claim: { ...published.claim, purpose: 'publish' as const },
        },
      },
      {
        id: 'published_with_terminal_marker',
        data: {
          ...published,
          ingestOutboxId: 'published_with_terminal_marker',
          terminalMarker,
          acknowledgementReceipts: [
            ...published.acknowledgementReceipts,
            {
              version: 1 as const,
              ownerDigest,
              claimPurpose: 'terminal_marker_recovery' as const,
              expectedClaimExpiresAt: claimExpiresAt,
              outcome: {
                kind: 'terminal_marker_acknowledged' as const,
                publisherReceiptDigest,
                publishedAt,
                terminalMarker,
                replyOrDeliveryWorkInFlight: 0 as const,
              },
              acknowledgedAt: terminalMarker.recordedAt,
              drained: true,
            },
          ],
        },
      },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    await expect(
      scanner.listOutboxCandidates({
        now: '2026-07-20T10:00:30.000Z',
        limit: 32,
        ownerDigest,
      })
    ).resolves.toEqual({
      ingest: [
        {
          runtimeAudience: 'hetzner-prod',
          runId: 'run_1',
          userId: 'private_user_fixture',
          leaseFence: '7',
          leaseSlotDigest,
          runFenceDigest,
          ownerDigest,
          ingestOutboxId: 'outbox_1',
          payloadDigest,
          purpose: 'terminal_marker_recovery',
          claimExpiresAt,
          publisherReceiptDigest,
          publishedAt,
        },
      ],
      terminal: [],
    });
  });

  it('fairly includes an expired claim even while pending ingest fills its budget', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const pending = (ingestOutboxId: string) => ({
      ...outbox(),
      ingestOutboxId,
      status: 'pending' as const,
      claim: null,
    });
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: 'pending_1', data: pending('pending_1') },
      { id: 'pending_2', data: pending('pending_2') },
      { id: 'expired_1', data: { ...outbox(), ingestOutboxId: 'expired_1' } },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    const candidates = await scanner.listOutboxCandidates({
      now: '2026-07-20T10:02:00.000Z',
      limit: 4,
      ownerDigest,
    });

    expect(candidates.ingest.map(({ ingestOutboxId }) => ingestOutboxId)).toEqual([
      'pending_1',
      'expired_1',
      'pending_2',
    ]);
  });

  it('returns only expired nonterminal exact leases for transactional abandonment', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    fakeFirestore.seedCollection(MATRIX_CORPUS_RUN_LEASES_COLLECTION, [
      { id: leaseSlotDigest, data: lease() },
      {
        id: 'f'.repeat(64),
        data: { ...lease(), runId: 'terminal_run', phase: 'released', expiresAt: timestamp },
      },
      {
        id: 'e'.repeat(64),
        data: { ...lease(), runId: 'future_run', expiresAt: '2026-07-20T10:10:00.000Z' },
      },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    await expect(
      scanner.listExpiredLeaseCandidates({ now: '2026-07-20T10:06:00.000Z', limit: 32 })
    ).resolves.toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        observedRunId: 'run_1',
        observedUserId: 'private_user_fixture',
        observedLeaseFence: '7',
      },
    ]);
  });

  it('rejects every invalid scan bound and owner before querying Firestore', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    await expect(
      scanner.listOutboxCandidates({ now: timestamp, limit: 1, ownerDigest: 'invalid' })
    ).rejects.toThrow('Matrix corpus recovery owner digest is invalid');
    for (const input of [
      { now: 'invalid', limit: 1 },
      { now: timestamp, limit: 1.5 },
      { now: timestamp, limit: 0 },
      { now: timestamp, limit: 33 },
    ]) {
      await expect(scanner.listExpiredLeaseCandidates(input)).rejects.toThrow(
        'Matrix corpus recovery scan input is invalid'
      );
    }
    await expect(
      scanner.listOutboxCandidates({ now: timestamp, limit: 1, ownerDigest })
    ).resolves.toEqual({ ingest: [], terminal: [] });
  });

  it('skips corrupt, mismatched, and digest-failing expired lease documents', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    fakeFirestore.seedCollection(MATRIX_CORPUS_RUN_LEASES_COLLECTION, [
      { id: 'corrupt', data: { phase: 'active', expiresAt: timestamp } },
      { id: 'f'.repeat(64), data: lease() },
      { id: leaseSlotDigest, data: { ...lease(), runFenceDigest: 'f'.repeat(64) } },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    await expect(
      scanner.listExpiredLeaseCandidates({ now: '2026-07-20T10:06:00.000Z', limit: 32 })
    ).resolves.toEqual([]);

    const throwing = new FirestoreMatrixCorpusRecoveryScanner({
      firestore: fakeFirestore as unknown as Firestore,
      digests: { digest: () => { throw new Error('digest unavailable'); } },
    });
    await expect(
      throwing.listExpiredLeaseCandidates({ now: '2026-07-20T10:06:00.000Z', limit: 32 })
    ).resolves.toEqual([]);
  });

  it('skips corrupt outboxes and records whose derived authority is invalid or throws', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const pending = { ...outbox(), status: 'pending' as const, claim: null };
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: 'corrupt_ingest', data: { status: 'pending', createdAt: timestamp } },
      { id: pending.ingestOutboxId, data: pending },
    ]);
    fakeFirestore.seedCollection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION, [
      { id: 'corrupt_terminal', data: { status: 'pending', createdAt: timestamp } },
      {
        id: 'terminal_1',
        data: { ...terminalOutbox(), status: 'pending' as const, claim: null },
      },
    ]);
    for (const digests of [
      { digest: () => 'invalid' },
      { digest: () => { throw new Error('digest unavailable'); } },
    ]) {
      const scanner = new FirestoreMatrixCorpusRecoveryScanner({
        firestore: fakeFirestore as unknown as Firestore,
        digests,
      });
      await expect(
        scanner.listOutboxCandidates({ now: timestamp, limit: 4, ownerDigest })
      ).resolves.toEqual({ ingest: [], terminal: [] });
    }
  });

  it('does not reuse an expired terminal-marker recovery claim', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const publishedAt = '2026-07-20T10:00:01.000Z';
    const publisherReceiptDigest = 'e'.repeat(64);
    const published = {
      ...outbox(),
      status: 'published' as const,
      claim: {
        ownerDigest,
        purpose: 'terminal_marker_recovery' as const,
        claimedAt: timestamp,
        expiresAt: claimExpiresAt,
      },
      publisherReceiptDigest,
      publishedAt,
      acknowledgementReceipts: [
        {
          version: 1 as const,
          ownerDigest,
          claimPurpose: 'publish' as const,
          expectedClaimExpiresAt: claimExpiresAt,
          outcome: {
            kind: 'publication_acknowledged' as const,
            publisherReceiptDigest,
            publishedAt,
          },
          acknowledgedAt: publishedAt,
          drained: false,
        },
      ],
    };
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      { id: published.ingestOutboxId, data: published },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    const candidates = await scanner.listOutboxCandidates({
      now: '2026-07-20T10:02:00.000Z',
      limit: 32,
      ownerDigest,
    });

    expect(candidates.ingest).toEqual([
      expect.not.objectContaining({ claimExpiresAt: expect.anything() }),
    ]);
  });

  it('stops parsing interleaved ingest candidates at the caller limit', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    fakeFirestore.seedCollection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION, [
      {
        id: 'pending_limited',
        data: {
          ...outbox(),
          ingestOutboxId: 'pending_limited',
          status: 'pending' as const,
          claim: null,
        },
      },
      {
        id: 'claimed_limited',
        data: { ...outbox(), ingestOutboxId: 'claimed_limited' },
      },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    const candidates = await scanner.listOutboxCandidates({
      now: '2026-07-20T10:02:00.000Z',
      limit: 1,
      ownerDigest,
    });

    expect(candidates.ingest).toHaveLength(1);
  });

  it('stops parsing terminal candidates at the caller limit', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    fakeFirestore.seedCollection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION, [
      {
        id: 'terminal_limited_1',
        data: {
          ...terminalOutbox(),
          terminalControlId: 'terminal_limited_1',
          eventId: 'terminal_limited_1',
          payload: {
            ...terminalOutbox().payload,
            eventId: 'terminal_limited_1',
          },
          status: 'pending' as const,
          claim: null,
        },
      },
      {
        id: 'terminal_limited_2',
        data: {
          ...terminalOutbox(),
          terminalControlId: 'terminal_limited_2',
          eventId: 'terminal_limited_2',
          payload: {
            ...terminalOutbox().payload,
            eventId: 'terminal_limited_2',
          },
        },
      },
    ]);
    const scanner = recoveryScanner(fakeFirestore as unknown as Firestore);

    const candidates = await scanner.listOutboxCandidates({
      now: '2026-07-20T10:02:00.000Z',
      limit: 1,
      ownerDigest,
    });

    expect(candidates.terminal).toHaveLength(1);
  });
});

function recoveryScanner(firestore: Firestore): FirestoreMatrixCorpusRecoveryScanner {
  return new FirestoreMatrixCorpusRecoveryScanner({
    firestore,
    digests: {
      digest(domain) {
        if (domain === 'imc-lease-slot-v1') return leaseSlotDigest;
        if (domain === 'imc-run-fence-v1') return runFenceDigest;
        throw new Error('Unexpected digest domain in recovery scanner test');
      },
    },
  });
}

function terminalFixture() {
  const fakeFirestore = createFakeFirestore();
  fakeFirestore.clear();
  const firestore = fakeFirestore as unknown as Firestore;
  const current = terminalLease();
  fakeFirestore.seedCollection(MATRIX_CORPUS_RUN_LEASES_COLLECTION, [
    { id: leaseSlotDigest, data: current },
  ]);
  fakeFirestore.seedCollection(
    `${MATRIX_CORPUS_RUN_LEASES_COLLECTION}/${leaseSlotDigest}/runs`,
    [{ id: runFenceDigest, data: { ...current, leaseSlotDigest } }]
  );
  fakeFirestore.seedCollection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION, [
    { id: 'terminal_1', data: terminalOutbox() },
  ]);
  return {
    firestore,
    repo: new FirestoreMatrixCorpusSignedEnvelopeStore({ firestore }),
  };
}

function issueConsumeFixture() {
  const fakeFirestore = createFakeFirestore();
  fakeFirestore.clear();
  const firestore = fakeFirestore as unknown as Firestore;
  const current = {
    ...lease(),
    nonterminalIngestOutboxIds: [],
    ingestOutboxIds: [],
    drain: {
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      drained: false,
    },
  };
  fakeFirestore.seedCollection(MATRIX_CORPUS_RUN_LEASES_COLLECTION, [
    { id: leaseSlotDigest, data: current },
  ]);
  fakeFirestore.seedCollection(
    `${MATRIX_CORPUS_RUN_LEASES_COLLECTION}/${leaseSlotDigest}/runs`,
    [{ id: runFenceDigest, data: { ...current, leaseSlotDigest } }]
  );
  return { firestore, repository: lifecycleRepository(firestore) };
}

function capability() {
  const context = ingestPayload().context;
  return {
    version: 1 as const,
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    leaseFence: '7',
    userId: 'private_user_fixture',
    scenarioId: context.scenarioId,
    scenarioNumber: context.scenarioNumber,
    scenarioLabel: context.scenarioLabel,
    matrixRoomBindingDigest: '7'.repeat(64),
    whatsappAccountBindingDigest: '8'.repeat(64),
    whatsappSenderBindingDigest: '9'.repeat(64),
    matrixIdempotencyKeyDigest: '0'.repeat(64),
    promptNormalizationVersion: context.promptNormalizationVersion,
    promptDigest: context.promptDigest,
    phase: context.phase,
    turnIndex: context.turnIndex,
    expectedSessionId: context.expectedSessionId,
    pendingConfirmationId: context.pendingConfirmationId,
    expectedDecision: context.expectedDecision,
    mockProfile: context.mockProfile,
    mockProfileDigest: context.mockProfileDigest,
    expectedToolSchedule: context.expectedToolSchedule,
    currentDateTime: context.currentDateTime,
    timeZone: context.timeZone,
    capabilityDigest: '1'.repeat(64),
    issueRequestDigest: '2'.repeat(64),
    issuedAt: '2026-07-20T10:00:02.000Z',
    expiresAt: '2026-07-20T10:01:02.000Z',
    consumedAt: null,
    consumedTransportMessageIdDigest: null,
    ingestOutboxId: null,
    revokedAt: null,
  };
}

function issueCommand() {
  return {
    now: '2026-07-20T10:00:02.000Z',
    leaseSlotDigest,
    runFenceDigest,
    capability: capability(),
  };
}

function matrixSendProofCommand() {
  const issued = capability();
  return {
    now: '2026-07-20T10:00:02.500Z',
    leaseSlotDigest,
    runFenceDigest,
    capabilityDigest: issued.capabilityDigest,
    matrixIdempotencyKeyDigest: issued.matrixIdempotencyKeyDigest,
    matrixEventIdDigest: '4'.repeat(64),
    matrixRoomBindingDigest: issued.matrixRoomBindingDigest,
    messageTextDigest: '5'.repeat(64),
    promptDigest: issued.promptDigest,
    runtimeAudience: issued.runtimeAudience,
    runId: issued.runId,
    userId: issued.userId,
    leaseFence: issued.leaseFence,
    scenarioId: issued.scenarioId,
    scenarioNumber: issued.scenarioNumber,
    phase: issued.phase,
    turnIndex: issued.turnIndex,
  };
}

function consumeCommand(): ConsumeCapabilityAndEnqueueIngestCommand {
  const issued = capability();
  const payload = ingestPayload();
  const transportMessageIdDigest = '3'.repeat(64);
  const ingestReceiptId = 'receipt_2';
  const ingestOutboxId = 'outbox_2';
  return {
    now: '2026-07-20T10:00:03.000Z',
    leaseSlotDigest,
    runFenceDigest,
    capabilityDigest: issued.capabilityDigest,
    transportMessageIdDigest,
    ingestReceiptId,
    ingestOutboxId,
    facts: {
      version: 1 as const,
      ingressRequest: {
        version: 1 as const,
        capabilityDigest: issued.capabilityDigest,
        transportMessageIdDigest,
        userId: 'private_user_fixture',
        matrixRoomBindingDigest: '7'.repeat(64),
        whatsappAccountBindingDigest: '8'.repeat(64),
        whatsappSenderBindingDigest: '9'.repeat(64),
        parsedIngress: {
          version: 1 as const,
          phase: 'start' as const,
          scenarioNumber: 1,
          scenarioTotal: 20,
          turnIndex: null,
          turnTotal: null,
          startNewSession: true,
        },
        promptDigest: issued.promptDigest,
        expectedSessionId: null,
        pendingConfirmationId: null,
        expectedDecision: null,
        ordinaryMessageId: payload.ordinaryIngest.messageId,
        ordinaryTimestamp: payload.ordinaryIngest.timestamp,
        ingestReceiptId,
        payloadDigest,
        ingestOutboxId,
      },
      ingressRequestDigest: '4'.repeat(64),
      payload: {
        ...payload,
        context: { ...payload.context, ingestReceiptId },
      },
    },
    payloadDigest,
    ingressRequestDigest: '4'.repeat(64),
  };
}

function consumeCommandWithIds(
  transportDigestCharacter: string,
  ingestReceiptId: string,
  ingestOutboxId: string,
  ingressDigestCharacter: string
): ConsumeCapabilityAndEnqueueIngestCommand {
  const command = consumeCommand();
  const transportMessageIdDigest = transportDigestCharacter.repeat(64);
  const ingressRequestDigest = ingressDigestCharacter.repeat(64);
  command.transportMessageIdDigest = transportMessageIdDigest;
  command.ingestReceiptId = ingestReceiptId;
  command.ingestOutboxId = ingestOutboxId;
  command.ingressRequestDigest = ingressRequestDigest;
  command.facts.ingressRequestDigest = ingressRequestDigest;
  command.facts.ingressRequest.transportMessageIdDigest = transportMessageIdDigest;
  command.facts.ingressRequest.ingestReceiptId = ingestReceiptId;
  command.facts.ingressRequest.ingestOutboxId = ingestOutboxId;
  command.facts.payload.context.ingestReceiptId = ingestReceiptId;
  return command;
}

async function readCurrentLease(firestore: Firestore): Promise<Record<string, unknown>> {
  const snapshot = await firestore
    .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
    .doc(leaseSlotDigest)
    .get();
  return snapshot.data() as Record<string, unknown>;
}

function quiesceLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: '5'.repeat(64),
    canonicalRequestDigest: '6'.repeat(64),
    now: '2026-07-20T10:00:04.000Z',
  };
}

function releaseLifecycleCommand() {
  const tombstoneDigest = 'a'.repeat(64);
  const terminalCandidateDigest = 'b'.repeat(64);
  const artifactStageDigest = 'c'.repeat(64);
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: '7'.repeat(64),
    canonicalRequestDigest: '8'.repeat(64),
    now: '2026-07-20T10:00:05.000Z',
    controlStatus: {
      kind: 'status' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      lifecycle: 'finalizing' as const,
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
      contextFinalizationTombstoneDigest: tombstoneDigest,
      terminalCandidateDigest,
      artifactStageDigest,
    },
    terminalControlId: 'terminal_release',
    terminalControl: {
      version: 1 as const,
      kind: 'release' as const,
      eventId: 'terminal_release',
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      createdAt: '2026-07-20T10:00:05.000Z',
      tombstoneDigest,
      terminalCandidateDigest,
      artifactStageDigest,
    },
    terminalPayloadDigest: 'd'.repeat(64),
  };
}

function transportStatusLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    now: '2026-07-20T10:00:03.000Z',
  };
}

async function cleanupFixture(renewReceiptCount = 1, includeSecondTarget = false) {
  const fakeFirestore = createFakeFirestore();
  fakeFirestore.clear();
  const firestore = fakeFirestore as unknown as Firestore;
  const terminalControlId = 'terminal_cleanup';
  const renewReceiptIds = [
    'a'.repeat(64),
    ...Array.from({ length: Math.max(0, renewReceiptCount - 1) }, (_, index) =>
      (index + 1).toString(16).padStart(64, '0')
    ),
  ];
  const target = {
    ...lease(),
    phase: 'abandoned' as const,
    abandonedAt: timestamp,
    renewReceiptIds,
    nonterminalIngestOutboxIds: [],
    ingestOutboxIds: [],
    terminalControlOutboxIds: [terminalControlId],
    drain: {
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      drained: false,
    },
    terminalWinner: {
      kind: 'abandoned' as const,
      eventId: terminalControlId,
      payloadDigest,
      outcome: 'stopped_not_evaluated' as const,
      acknowledgedAt: timestamp,
    },
  };
  const targetTerminal = {
    ...terminalOutbox(),
    terminalControlId,
    eventId: terminalControlId,
    payload: {
      ...terminalOutbox().payload,
      eventId: terminalControlId,
    },
    status: 'published' as const,
    acknowledgedAt: timestamp,
  };
  const secondRunFenceDigest = '2'.repeat(64);
  const secondTerminalControlId = 'terminal_cleanup_2';
  const secondTarget = {
    ...target,
    runId: 'run_2',
    runFenceDigest: secondRunFenceDigest,
    leaseFence: '6',
    fenceEpoch: '6',
    operationReceipts: {
      ...target.operationReceipts,
      acquire: {
        ...target.operationReceipts.acquire,
        replayProjection: {
          ...target.operationReceipts.acquire.replayProjection,
          runId: 'run_2',
          leaseFence: '6',
        },
      },
      activate: {
        ...target.operationReceipts.activate,
        replayProjection: {
          ...target.operationReceipts.activate.replayProjection,
          runId: 'run_2',
          leaseFence: '6',
        },
      },
    },
    renewReceiptIds: [],
    terminalControlOutboxIds: [secondTerminalControlId],
    terminalWinner: {
      ...target.terminalWinner,
      eventId: secondTerminalControlId,
    },
  };
  const secondTargetTerminal = {
    ...targetTerminal,
    terminalControlId: secondTerminalControlId,
    eventId: secondTerminalControlId,
    runId: 'run_2',
    leaseFence: '6',
    payload: {
      ...targetTerminal.payload,
      eventId: secondTerminalControlId,
      runId: 'run_2',
      leaseFence: '6',
    },
  };
  fakeFirestore.seedCollection(MATRIX_CORPUS_RUN_LEASES_COLLECTION, [
    { id: leaseSlotDigest, data: target },
  ]);
  fakeFirestore.seedCollection(
    `${MATRIX_CORPUS_RUN_LEASES_COLLECTION}/${leaseSlotDigest}/runs`,
    [
      { id: runFenceDigest, data: { ...target, leaseSlotDigest } },
      ...(includeSecondTarget
        ? [{ id: secondRunFenceDigest, data: { ...secondTarget, leaseSlotDigest } }]
        : []),
    ]
  );
  fakeFirestore.seedCollection(
    `${MATRIX_CORPUS_RUN_LEASES_COLLECTION}/${leaseSlotDigest}/runs/${runFenceDigest}/renew_receipts`,
    renewReceiptIds.map((renewReceiptId) => ({
        id: renewReceiptId,
        data: {
          version: 1,
          idempotencyKeyDigest: renewReceiptId,
          runId: 'run_1',
          userId: 'private_user_fixture',
          leaseFence: '7',
          canonicalRequestDigest: 'b'.repeat(64),
          replayProjection: {
            operation: 'renew',
            result: 'renewed',
            runId: 'run_1',
            leaseFence: '7',
            phase: 'active',
            renewedAt: timestamp,
            expiresAt: '2026-07-20T10:05:00.000Z',
          },
          resultDigest: 'e'.repeat(64),
          recordedAt: timestamp,
        },
      }))
  );
  fakeFirestore.seedCollection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION, [
    { id: terminalControlId, data: targetTerminal },
    ...(includeSecondTarget
      ? [{ id: secondTerminalControlId, data: secondTargetTerminal }]
      : []),
  ]);
  const repository = lifecycleRepository(firestore);
  const currentRunFenceDigest = 'c'.repeat(64);
  await repository.acquireProvisioningLease({
    ...acquireLifecycleCommand(),
    runId: 'run_current',
    runFenceDigest: currentRunFenceDigest,
    idempotencyKeyDigest: 'd'.repeat(64),
    canonicalRequestDigest: 'e'.repeat(64),
    now: '2026-07-20T10:06:00.000Z',
    expiresAt: '2026-07-20T10:11:00.000Z',
  });
  return {
    firestore,
    repository,
    currentRunFenceDigest,
    terminalControlId,
    secondRunFenceDigest,
    secondTerminalControlId,
  };
}

async function fullCleanupFixture() {
  const fixture = issueConsumeFixture();
  await fixture.repository.issueCapability(issueCommand());
  await fixture.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
  await fixture.repository.abandonExpiredRun(abandonLifecycleCommand());
  const delivery = new FirestoreMatrixCorpusDeliveryRepository({ firestore: fixture.firestore });
  const claimExpiresAt = '2026-07-20T10:06:00.000Z';
  await delivery.claimPendingTerminalControlOutbox(
    terminalClaimCommand({
      now: '2026-07-20T10:05:01.000Z',
      claimExpiresAt,
      terminalControlId: 'terminal_abandoned',
      eventId: 'terminal_abandoned',
      payloadDigest: '7'.repeat(64),
    })
  );
  const acknowledgedAt = '2026-07-20T10:05:30.000Z';
  await delivery.acknowledgeTerminalControl(
    terminalAcknowledgementCommand({
      now: acknowledgedAt,
      requestTerminalControlId: 'terminal_abandoned',
      requestEventId: 'terminal_abandoned',
      requestPayloadDigest: '7'.repeat(64),
      expectedClaimExpiresAt: claimExpiresAt,
      authoritativeWinner: {
        kind: 'abandoned',
        eventId: 'terminal_abandoned',
        payloadDigest: '7'.repeat(64),
        outcome: 'stopped_not_evaluated',
        acknowledgedAt,
      },
    })
  );
  const currentRunFenceDigest = 'c'.repeat(64);
  await fixture.repository.acquireProvisioningLease({
    ...acquireLifecycleCommand(),
    runId: 'run_current',
    runFenceDigest: currentRunFenceDigest,
    idempotencyKeyDigest: 'd'.repeat(64),
    canonicalRequestDigest: 'e'.repeat(64),
    now: '2026-07-20T10:06:00.000Z',
    expiresAt: '2026-07-20T10:11:00.000Z',
  });
  return { ...fixture, currentRunFenceDigest };
}

function cleanupCommand(currentRunFenceDigest: string) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    currentRunId: 'run_current',
    userId: 'private_user_fixture',
    currentLeaseFence: '8',
    leaseSlotDigest,
    currentRunFenceDigest,
    targetRunId: 'run_1',
    targetLeaseFence: '7',
    targetRunFenceDigest: runFenceDigest,
    expectedRevision: 0,
    idempotencyKeyDigest: 'f'.repeat(64),
    canonicalRequestDigest: '0'.repeat(64),
    now: '2026-07-20T10:06:01.000Z',
  };
}

function abandonLifecycleCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    observedRunId: 'run_1',
    observedUserId: 'private_user_fixture',
    observedLeaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    now: '2026-07-20T10:05:00.000Z',
    terminalControlId: 'terminal_abandoned',
    terminalControl: {
      version: 1 as const,
      kind: 'abandoned' as const,
      eventId: 'terminal_abandoned',
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      createdAt: '2026-07-20T10:05:00.000Z',
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    },
    terminalPayloadDigest: '7'.repeat(64),
  };
}

function displacedActivateCommand(idempotencyKeyDigest = '4'.repeat(64)) {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest,
    canonicalRequestDigest: '5'.repeat(64),
    now: '2026-07-20T10:00:01.000Z',
    controlStatus: {
      kind: 'status' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      lifecycle: 'running' as const,
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
      contextFinalizationTombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    },
  };
}

function displacedRenewCommand() {
  return {
    runtimeAudience: 'hetzner-prod' as const,
    runId: 'run_1',
    userId: 'private_user_fixture',
    leaseFence: '7',
    leaseSlotDigest,
    runFenceDigest,
    idempotencyKeyDigest: 'a'.repeat(64),
    canonicalRequestDigest: 'b'.repeat(64),
    now: timestamp,
    expiresAt: '2026-07-20T10:05:00.000Z',
  };
}

describe('FirestoreMatrixCorpusRepository lifecycle', () => {
  it('rejects every malformed lifecycle command before Firestore access', async () => {
    const repository = lifecycleRepository(createFakeFirestore() as unknown as Firestore);
    const operations = [
      () => repository.acquireProvisioningLease({} as never),
      () => repository.activateRun({} as never),
      () => repository.renewLease({} as never),
      () => repository.issueCapability({} as never),
      () => repository.recordMatrixSendProof({} as never),
      () => repository.consumeCapabilityAndEnqueueIngest({} as never),
      () => repository.quiesceRun({} as never),
      () => repository.releaseRun({} as never),
      () => repository.abandonExpiredRun({} as never),
      () => repository.getTransportStatus({} as never),
      () => repository.cleanupExactRun({} as never),
      () => repository.claimPendingIngestOutbox({} as never),
      () => repository.renewIngestOutboxClaim({} as never),
      () => repository.acknowledgeIngestOutbox({} as never),
      () => repository.claimPendingTerminalControlOutbox({} as never),
      () => repository.renewTerminalControlOutboxClaim({} as never),
      () => repository.acknowledgeTerminalControl({} as never),
    ];

    for (const operation of operations)
      await expect(operation()).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
  });

  it('contains every lifecycle transaction failure as a repository result', async () => {
    const firestore = {
      runTransaction: async () => {
        throw new Error('transaction unavailable');
      },
    } as unknown as Firestore;
    const repository = lifecycleRepository(firestore);
    const operations = [
      () => repository.acquireProvisioningLease(acquireLifecycleCommand()),
      () => repository.activateRun(activateLifecycleCommand()),
      () => repository.renewLease(renewLifecycleCommand()),
      () => repository.issueCapability(issueCommand()),
      () => repository.recordMatrixSendProof(matrixSendProofCommand()),
      () => repository.consumeCapabilityAndEnqueueIngest(consumeCommand()),
      () => repository.quiesceRun(quiesceLifecycleCommand()),
      () => repository.releaseRun(releaseLifecycleCommand()),
      () => repository.abandonExpiredRun(abandonLifecycleCommand()),
      () => repository.getTransportStatus(transportStatusLifecycleCommand()),
      () => repository.cleanupExactRun(cleanupCommand('c'.repeat(64))),
    ];

    for (const operation of operations)
      await expect(operation()).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'repository_result',
      });
  });

  it('fails acquisition closed for readiness, replay, digest, slot, and history corruption', async () => {
    const blockedFirestore = createFakeFirestore() as unknown as Firestore;
    await expect(
      lifecycleRepository(blockedFirestore).acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        acquisitionReadiness: { kind: 'not_ready' },
      })
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'admission' });

    for (const digestResult of [
      () => 'invalid',
      () => {
        throw new Error('digest unavailable');
      },
    ]) {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repository = new FirestoreMatrixCorpusRepository({
        firestore,
        replayProjectionDigest: { digest: digestResult },
      });
      await expect(repository.acquireProvisioningLease(acquireLifecycleCommand())).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'dependency_result',
      });
    }

    const replayFirestore = createFakeFirestore() as unknown as Firestore;
    const replayRepository = lifecycleRepository(replayFirestore);
    await replayRepository.acquireProvisioningLease(acquireLifecycleCommand());
    await expect(
      replayRepository.acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        idempotencyKeyDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await replayFirestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ corrupt: true });
    await expect(
      replayRepository.acquireProvisioningLease(acquireLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const corruptSlotFirestore = createFakeFirestore() as unknown as Firestore;
    await corruptSlotFirestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set({ corrupt: true });
    await expect(
      lifecycleRepository(corruptSlotFirestore).acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        runId: 'run_other',
        runFenceDigest: 'c'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const missingHistoryFirestore = createFakeFirestore() as unknown as Firestore;
    const missingHistoryRepository = lifecycleRepository(missingHistoryFirestore);
    await missingHistoryRepository.acquireProvisioningLease(acquireLifecycleCommand());
    await missingHistoryFirestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .delete();
    await expect(
      missingHistoryRepository.acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        runId: 'run_other',
        runFenceDigest: 'c'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const corruptPairFirestore = createFakeFirestore() as unknown as Firestore;
    const corruptPairRepository = lifecycleRepository(corruptPairFirestore);
    await corruptPairRepository.acquireProvisioningLease(acquireLifecycleCommand());
    const historySnapshot = await corruptPairFirestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .get();
    await corruptPairFirestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ ...historySnapshot.data(), leaseSlotDigest: 'f'.repeat(64) });
    await expect(
      corruptPairRepository.acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        runId: 'run_other',
        runFenceDigest: 'c'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });
  });

  it('fails activation closed for replay conflict, stale or expired lease, readiness, and dependency errors', async () => {
    const createAcquired = async () => {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repository = lifecycleRepository(firestore);
      await repository.acquireProvisioningLease(acquireLifecycleCommand());
      return { firestore, repository };
    };

    const replay = await createAcquired();
    await replay.repository.activateRun(activateLifecycleCommand());
    await expect(
      replay.repository.activateRun({
        ...activateLifecycleCommand(),
        canonicalRequestDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      replay.repository.activateRun({
        ...activateLifecycleCommand(),
        idempotencyKeyDigest: 'e'.repeat(64),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const stale = await createAcquired();
    await expect(
      stale.repository.activateRun({
        ...activateLifecycleCommand(),
        leaseFence: '2',
        controlStatus: { ...activateLifecycleCommand().controlStatus, leaseFence: '2' },
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const expired = await createAcquired();
    await expect(
      expired.repository.activateRun({
        ...activateLifecycleCommand(),
        now: '2026-07-20T10:05:00.001Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const notReady = await createAcquired();
    await expect(
      notReady.repository.activateRun({
        ...activateLifecycleCommand(),
        controlStatus: { kind: 'not_ready' },
      })
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'activation' });

    const corruptHistory = await createAcquired();
    await corruptHistory.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ corrupt: true });
    await expect(
      corruptHistory.repository.activateRun(activateLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const digestFirestore = createFakeFirestore() as unknown as Firestore;
    const digestRepository = new FirestoreMatrixCorpusRepository({
      firestore: digestFirestore,
      replayProjectionDigest: { digest: () => 'invalid' },
    });
    await lifecycleRepository(digestFirestore).acquireProvisioningLease(acquireLifecycleCommand());
    await expect(digestRepository.activateRun(activateLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });

    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).activateRun(
        activateLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
  });

  it('atomically acquires, activates, renews, and replays every operation', async () => {
    const firestore = createFakeFirestore();
    const repository = lifecycleRepository(firestore as unknown as Firestore);

    await expect(repository.acquireProvisioningLease(acquireLifecycleCommand())).resolves.toMatchObject({
      code: 'ACQUIRED',
      runId: 'run_lifecycle',
      leaseFence: '1',
    });
    await expect(repository.acquireProvisioningLease(acquireLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'acquire',
    });
    await expect(repository.activateRun(activateLifecycleCommand())).resolves.toMatchObject({
      code: 'ACTIVATED',
      phase: 'active',
    });
    await expect(repository.activateRun(activateLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'activate',
    });
    await expect(repository.renewLease(renewLifecycleCommand())).resolves.toMatchObject({
      code: 'LEASE_RENEWED',
      expiresAt: '2026-07-20T10:05:02.000Z',
    });
    await expect(repository.renewLease(renewLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew',
    });

    const slot = firestore.collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION).doc(leaseSlotDigest);
    const current = await slot.get();
    const history = await slot.collection('runs').doc(runFenceDigest).get();
    expect(current.data()).toEqual({
      ...history.data(),
      leaseSlotDigest: undefined,
    });
    expect(current.data()).toMatchObject({
      phase: 'active',
      renewedAt: '2026-07-20T10:00:02.000Z',
      renewReceiptIds: ['5'.repeat(64)],
    });
  });

  it('fails lease renewal closed for receipt drift, authority, expiry, phase, limits, and digest errors', async () => {
    const createActive = async () => {
      const firestore = createFakeFirestore() as unknown as Firestore;
      const repository = lifecycleRepository(firestore);
      await repository.acquireProvisioningLease(acquireLifecycleCommand());
      await repository.activateRun(activateLifecycleCommand());
      return { firestore, repository };
    };

    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).renewLease(
        renewLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const stale = await createActive();
    await expect(
      stale.repository.renewLease({ ...renewLifecycleCommand(), leaseFence: '2' })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const expired = await createActive();
    await expect(
      expired.repository.renewLease({
        ...renewLifecycleCommand(),
        now: '2026-07-20T10:05:00.001Z',
        expiresAt: '2026-07-20T10:10:00.001Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const provisioningFirestore = createFakeFirestore() as unknown as Firestore;
    const provisioningRepository = lifecycleRepository(provisioningFirestore);
    await provisioningRepository.acquireProvisioningLease(acquireLifecycleCommand());
    await expect(provisioningRepository.renewLease(renewLifecycleCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'provisioning',
    });

    const nonExtending = await createActive();
    await expect(
      nonExtending.repository.renewLease({
        ...renewLifecycleCommand(),
        now: timestamp,
        expiresAt: '2026-07-20T10:05:00.000Z',
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const replay = await createActive();
    await replay.repository.renewLease(renewLifecycleCommand());
    await expect(
      replay.repository.renewLease({
        ...renewLifecycleCommand(),
        canonicalRequestDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    const receiptRef = replay.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('renew_receipts')
      .doc(renewLifecycleCommand().idempotencyKeyDigest);
    await receiptRef.set({ corrupt: true });
    await expect(replay.repository.renewLease(renewLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'renew_receipt',
    });

    const missingReceipt = await createActive();
    const currentSnapshot = await missingReceipt.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .get();
    await persistLeasePair(missingReceipt.firestore, {
      ...currentSnapshot.data(),
      renewReceiptIds: [renewLifecycleCommand().idempotencyKeyDigest],
    } as ReturnType<typeof lease>);
    await expect(missingReceipt.repository.renewLease(renewLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'renew_receipt',
    });

    const limited = await createActive();
    const limitedSnapshot = await limited.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .get();
    const renewReceiptIds = Array.from({ length: 400 }, (_, index) =>
      index.toString(16).padStart(64, '0')
    );
    await persistLeasePair(limited.firestore, {
      ...limitedSnapshot.data(),
      renewReceiptIds,
    } as ReturnType<typeof lease>);
    await expect(limited.repository.renewLease(renewLifecycleCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });

    const digest = await createActive();
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: digest.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).renewLease(renewLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('rejects a concurrent second run while the current lease is nonterminal', async () => {
    const firestore = createFakeFirestore();
    const repository = lifecycleRepository(firestore as unknown as Firestore);
    await repository.acquireProvisioningLease(acquireLifecycleCommand());

    await expect(
      repository.acquireProvisioningLease({
        ...acquireLifecycleCommand(),
        runId: 'run_other',
        runFenceDigest: 'c'.repeat(64),
        idempotencyKeyDigest: 'd'.repeat(64),
        canonicalRequestDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'RUN_ALREADY_ACTIVE' });
  });

  it('issues one capability and atomically consumes it into one durable ingest intent', async () => {
    const { firestore, repository } = issueConsumeFixture();

    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({
      code: 'CAPABILITY_ISSUED',
      scenarioId: 'scenario_1',
    });
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'issue',
    });
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
      ingestReceiptId: 'receipt_2',
      ingestOutboxId: 'outbox_2',
    });
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
    });

    const replay = consumeCommand();
    replay.transportMessageIdDigest = '5'.repeat(64);
    replay.ingestReceiptId = 'receipt_3';
    replay.ingestOutboxId = 'outbox_3';
    replay.ingressRequestDigest = '6'.repeat(64);
    replay.facts.ingressRequestDigest = '6'.repeat(64);
    replay.facts.ingressRequest.transportMessageIdDigest = '5'.repeat(64);
    replay.facts.ingressRequest.ingestReceiptId = 'receipt_3';
    replay.facts.ingressRequest.ingestOutboxId = 'outbox_3';
    replay.facts.payload.context.ingestReceiptId = 'receipt_3';
    await expect(repository.consumeCapabilityAndEnqueueIngest(replay)).resolves.toEqual({
      code: 'CAPABILITY_REPLAY',
    });

    await expect(
      firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc('1'.repeat(64))
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({
      consumedTransportMessageIdDigest: '3'.repeat(64),
      ingestOutboxId: 'outbox_2',
    });
    await expect(
      firestore
        .collection(MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION)
        .doc('3'.repeat(64))
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ ingestOutboxId: 'outbox_2', terminalFailureCode: null });
    await expect(
      firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_2')
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'closed', closedReason: 'capability_replay' });
  });

  it('fails capability consumption closed for missing, corrupt, stale, expired, and wrong-phase state', async () => {
    await expect(
      lifecycleRepository(
        createFakeFirestore() as unknown as Firestore
      ).consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const missingCapability = issueConsumeFixture();
    await missingCapability.repository.issueCapability(issueCommand());
    await missingCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(
      missingCapability.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });

    const corruptCapability = issueConsumeFixture();
    await corruptCapability.repository.issueCapability(issueCommand());
    await corruptCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ corrupt: true });
    await expect(
      corruptCapability.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });

    const stale = issueConsumeFixture();
    await stale.repository.issueCapability(issueCommand());
    const staleCommand = consumeCommand();
    staleCommand.facts.payload.context.leaseFence = '8';
    await expect(stale.repository.consumeCapabilityAndEnqueueIngest(staleCommand)).resolves.toEqual({
      code: 'STALE_FENCE',
    });

    const expired = issueConsumeFixture();
    await expired.repository.issueCapability(issueCommand());
    await expect(
      expired.repository.consumeCapabilityAndEnqueueIngest({
        ...consumeCommand(),
        now: '2026-07-20T10:05:00.001Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const quiesced = issueConsumeFixture();
    await quiesced.repository.issueCapability(issueCommand());
    await quiesced.repository.quiesceRun(quiesceLifecycleCommand());
    await expect(
      quiesced.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
  });

  it('rejects contradictory transport replays, dangling references, and ingest outbox collisions', async () => {
    const transportReplay = issueConsumeFixture();
    await transportReplay.repository.issueCapability(issueCommand());
    await transportReplay.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const changedIngress = consumeCommand();
    changedIngress.ingressRequestDigest = 'f'.repeat(64);
    changedIngress.facts.ingressRequestDigest = 'f'.repeat(64);
    await expect(
      transportReplay.repository.consumeCapabilityAndEnqueueIngest(changedIngress)
    ).resolves.toEqual({ code: 'TRANSPORT_REPLAY' });

    const missingReplayOutbox = issueConsumeFixture();
    await missingReplayOutbox.repository.issueCapability(issueCommand());
    await missingReplayOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await missingReplayOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId)
      .delete();
    await expect(
      missingReplayOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'transport_receipt' });

    const corruptReplayOutbox = issueConsumeFixture();
    await corruptReplayOutbox.repository.issueCapability(issueCommand());
    await corruptReplayOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await corruptReplayOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId)
      .set({ corrupt: true });
    await expect(
      corruptReplayOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'transport_receipt' });

    const danglingTransport = issueConsumeFixture();
    await danglingTransport.repository.issueCapability(issueCommand());
    const danglingLease = await readCurrentLease(danglingTransport.firestore);
    await persistLeasePair(danglingTransport.firestore, {
      ...danglingLease,
      transportReceiptIds: [consumeCommand().transportMessageIdDigest],
    });
    await expect(
      danglingTransport.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'transport_receipt' });

    const wrongUnconsumedCapability = issueConsumeFixture();
    await wrongUnconsumedCapability.repository.issueCapability(issueCommand());
    const wrongUnconsumedLease = await readCurrentLease(wrongUnconsumedCapability.firestore);
    const otherCapabilityDigest = 'f'.repeat(64);
    await persistLeasePair(wrongUnconsumedCapability.firestore, {
      ...wrongUnconsumedLease,
      capabilityDigests: [capability().capabilityDigest, otherCapabilityDigest],
      unconsumedCapability: { digest: otherCapabilityDigest, phase: 'start' },
    });
    await expect(
      wrongUnconsumedCapability.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const outstandingOutbox = issueConsumeFixture();
    await outstandingOutbox.repository.issueCapability(issueCommand());
    const outstandingLease = await readCurrentLease(outstandingOutbox.firestore);
    await persistLeasePair(outstandingOutbox.firestore, {
      ...outstandingLease,
      nonterminalIngestOutboxIds: ['outbox_existing'],
      ingestOutboxIds: ['outbox_existing'],
    });
    await expect(
      outstandingOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const outboxCollision = issueConsumeFixture();
    await outboxCollision.repository.issueCapability(issueCommand());
    await outboxCollision.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId)
      .set(outbox());
    await expect(
      outboxCollision.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
  });

  it('persists bounded terminal capability failures and replays their exact receipt', async () => {
    const revoked = issueConsumeFixture();
    await revoked.repository.issueCapability(issueCommand());
    await revoked.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ ...capability(), revokedAt: '2026-07-20T10:00:02.500Z' });
    await expect(
      revoked.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CAPABILITY_REVOKED' });
    await expect(
      revoked.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CAPABILITY_REVOKED' });

    const expired = issueConsumeFixture();
    await expired.repository.issueCapability(issueCommand());
    await expect(
      expired.repository.consumeCapabilityAndEnqueueIngest({
        ...consumeCommand(),
        now: '2026-07-20T10:01:32.001Z',
      })
    ).resolves.toEqual({ code: 'CAPABILITY_EXPIRED' });

    const mismatch = issueConsumeFixture();
    await mismatch.repository.issueCapability(issueCommand());
    const mismatchCommand = consumeCommand();
    mismatchCommand.facts.payload.context.scenarioId = 'scenario_changed';
    await expect(
      mismatch.repository.consumeCapabilityAndEnqueueIngest(mismatchCommand)
    ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });

    const missingTerminalReference = issueConsumeFixture();
    await missingTerminalReference.repository.issueCapability(issueCommand());
    await missingTerminalReference.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ ...capability(), revokedAt: '2026-07-20T10:00:02.500Z' });
    await missingTerminalReference.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const terminalLease = await readCurrentLease(missingTerminalReference.firestore);
    await persistLeasePair(missingTerminalReference.firestore, {
      ...terminalLease,
      terminalFailureReceiptRefs: [],
    });
    await expect(
      missingTerminalReference.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'transport_receipt' });

    const limited = issueConsumeFixture();
    await limited.repository.issueCapability(issueCommand());
    for (const [index, command] of [
      consumeCommandWithIds('4', 'receipt_4', 'outbox_4', 'a'),
      consumeCommandWithIds('5', 'receipt_5', 'outbox_5', 'b'),
    ].entries()) {
      command.facts.payload.context.scenarioId = `scenario_mismatch_${String(index)}`;
      await expect(limited.repository.consumeCapabilityAndEnqueueIngest(command)).resolves.toEqual({
        code: 'CAPABILITY_MISMATCH',
      });
    }
    const overLimit = consumeCommandWithIds('6', 'receipt_6', 'outbox_6', 'c');
    overLimit.facts.payload.context.scenarioId = 'scenario_mismatch_limit';
    await expect(limited.repository.consumeCapabilityAndEnqueueIngest(overLimit)).resolves.toEqual({
      code: 'TERMINAL_RECEIPT_LIMIT',
    });
  });

  it('quiesces capability replay while revoking a different pointed capability safely', async () => {
    const pointed = issueConsumeFixture();
    await pointed.repository.issueCapability(issueCommand());
    await pointed.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const pointedCapability = {
      ...capability(),
      capabilityDigest: 'f'.repeat(64),
      matrixIdempotencyKeyDigest: 'a'.repeat(64),
      issueRequestDigest: 'b'.repeat(64),
    };
    await pointed.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(pointedCapability.capabilityDigest)
      .set(pointedCapability);
    const pointedLease = await readCurrentLease(pointed.firestore);
    await persistLeasePair(pointed.firestore, {
      ...pointedLease,
      capabilityDigests: [capability().capabilityDigest, pointedCapability.capabilityDigest],
      unconsumedCapability: { digest: pointedCapability.capabilityDigest, phase: 'start' },
    });
    await expect(
      pointed.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandWithIds('5', 'receipt_3', 'outbox_3', '6')
      )
    ).resolves.toEqual({ code: 'CAPABILITY_REPLAY' });
    await expect(
      pointed.firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc(pointedCapability.capabilityDigest)
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ revokedAt: '2026-07-20T10:00:03.000Z' });

    const selfPointed = issueConsumeFixture();
    await selfPointed.repository.issueCapability(issueCommand());
    await selfPointed.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const selfPointedLease = await readCurrentLease(selfPointed.firestore);
    await persistLeasePair(selfPointed.firestore, {
      ...selfPointedLease,
      unconsumedCapability: { digest: capability().capabilityDigest, phase: 'start' },
    });
    await expect(
      selfPointed.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandWithIds('5', 'receipt_3', 'outbox_3', '6')
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const alreadyClosed = issueConsumeFixture();
    await alreadyClosed.repository.issueCapability(issueCommand());
    await alreadyClosed.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const outboxRef = alreadyClosed.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId);
    const retainedOutbox = (await outboxRef.get()).data() as Record<string, unknown>;
    await outboxRef.set({
      ...retainedOutbox,
      status: 'closed',
      claim: null,
      publisherReceiptDigest: null,
      publishedAt: null,
      terminalMarker: null,
      closedReason: 'capability_replay',
      acknowledgementReceipts: [],
      lastClaimRenewal: null,
      closedAt: '2026-07-20T10:00:03.500Z',
    });
    await expect(
      alreadyClosed.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandWithIds('5', 'receipt_3', 'outbox_3', '6')
      )
    ).resolves.toEqual({ code: 'CAPABILITY_REPLAY' });
  });

  it('fails capability issuance closed for replay drift, stale state, retained capability, and digest errors', async () => {
    const stale = issueConsumeFixture();
    await expect(
      stale.repository.issueCapability({
        ...issueCommand(),
        capability: { ...capability(), leaseFence: '8' },
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const expired = issueConsumeFixture();
    await expect(
      expired.repository.issueCapability({
        now: '2026-07-20T10:05:00.000Z',
        leaseSlotDigest,
        runFenceDigest,
        capability: {
          ...capability(),
          issuedAt: '2026-07-20T10:05:00.000Z',
          expiresAt: '2026-07-20T10:06:00.000Z',
        },
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const replay = issueConsumeFixture();
    await replay.repository.issueCapability(issueCommand());
    await expect(
      replay.repository.issueCapability({
        ...issueCommand(),
        capability: {
          ...capability(),
          issueRequestDigest: 'f'.repeat(64),
          capabilityDigest: 'e'.repeat(64),
        },
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    const issuanceReceiptRef = replay.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('capability_issuance_receipts')
      .doc(capability().matrixIdempotencyKeyDigest);
    await issuanceReceiptRef.set({ corrupt: true });
    await expect(replay.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'issuance_receipt',
    });

    const missingCapability = issueConsumeFixture();
    await missingCapability.repository.issueCapability(issueCommand());
    await missingCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(missingCapability.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'issuance_receipt',
    });

    const digestDrift = issueConsumeFixture();
    await digestDrift.repository.issueCapability(issueCommand());
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: digestDrift.firestore,
        replayProjectionDigest: { digest: () => 'f'.repeat(64) },
      }).issueCapability(issueCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' });

    const occupied = issueConsumeFixture();
    await occupied.repository.issueCapability(issueCommand());
    await expect(
      occupied.repository.issueCapability({
        now: '2026-07-20T10:00:03.000Z',
        leaseSlotDigest,
        runFenceDigest,
        capability: {
          ...capability(),
          matrixIdempotencyKeyDigest: 'a'.repeat(64),
          capabilityDigest: 'b'.repeat(64),
          issueRequestDigest: 'c'.repeat(64),
          issuedAt: '2026-07-20T10:00:03.000Z',
          expiresAt: '2026-07-20T10:01:03.000Z',
        },
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const retainedLive = issueConsumeFixture();
    await retainedLive.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set(capability());
    await expect(retainedLive.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });

    const retainedExpired = issueConsumeFixture();
    await retainedExpired.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set(capability());
    await expect(
      retainedExpired.repository.issueCapability({
        now: capability().expiresAt,
        leaseSlotDigest,
        runFenceDigest,
        capability: {
          ...capability(),
          issuedAt: capability().expiresAt,
          expiresAt: '2026-07-20T10:02:02.000Z',
        },
      })
    ).resolves.toEqual({ code: 'CAPABILITY_EXPIRED' });

    const digestFailure = issueConsumeFixture();
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: digestFailure.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).issueCapability(issueCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('rejects dangling issuance receipts and every retained capability terminal state', async () => {
    const danglingReceipt = issueConsumeFixture();
    const danglingLease = await readCurrentLease(danglingReceipt.firestore);
    await persistLeasePair(danglingReceipt.firestore, {
      ...danglingLease,
      capabilityIssuanceReceiptIds: [capability().matrixIdempotencyKeyDigest],
    });
    await expect(danglingReceipt.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'issuance_receipt',
    });

    const terminalCommand = issueConsumeFixture();
    await expect(
      terminalCommand.repository.issueCapability({
        ...issueCommand(),
        capability: { ...capability(), revokedAt: capability().issuedAt },
      })
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });

    const corrupt = issueConsumeFixture();
    await corrupt.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ corrupt: true });
    await expect(corrupt.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'capability',
    });

    const consumed = issueConsumeFixture();
    await consumed.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({
        ...capability(),
        consumedAt: capability().issuedAt,
        consumedTransportMessageIdDigest: consumeCommand().transportMessageIdDigest,
        ingestOutboxId: consumeCommand().ingestOutboxId,
      });
    await expect(consumed.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CAPABILITY_REPLAY',
    });

    const revoked = issueConsumeFixture();
    await revoked.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ ...capability(), revokedAt: capability().issuedAt });
    await expect(revoked.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CAPABILITY_REVOKED',
    });
  });

  it('binds one exact Matrix event proof to the issuance receipt and rejects contradictions', async () => {
    const { firestore, repository } = issueConsumeFixture();
    await repository.issueCapability(issueCommand());

    await expect(
      repository.recordMatrixSendProof({
        ...matrixSendProofCommand(),
        promptDigest: '6'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });

    await expect(repository.recordMatrixSendProof(matrixSendProofCommand())).resolves.toMatchObject({
      code: 'MATRIX_SEND_PROOF_RECORDED',
      scenarioId: 'scenario_1',
      turnIndex: 0,
    });
    await expect(repository.recordMatrixSendProof(matrixSendProofCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'record_matrix_send_proof',
    });
    await expect(
      repository.recordMatrixSendProof({
        ...matrixSendProofCommand(),
        matrixEventIdDigest: '6'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });

    const proof = await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('capability_issuance_receipts')
      .doc('0'.repeat(64))
      .get();
    expect(proof.data()).toMatchObject({
      matrixSendProof: {
        matrixEventIdDigest: '4'.repeat(64),
        matrixRoomBindingDigest: '7'.repeat(64),
        messageTextDigest: '5'.repeat(64),
      },
    });
  });

  it('fails Matrix send proof closed for missing, corrupt, stale, expired, and wrong-phase authority', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).recordMatrixSendProof(
        matrixSendProofCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const missingCapability = issueConsumeFixture();
    await missingCapability.repository.issueCapability(issueCommand());
    await missingCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(
      missingCapability.repository.recordMatrixSendProof(matrixSendProofCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const corruptCapability = issueConsumeFixture();
    await corruptCapability.repository.issueCapability(issueCommand());
    await corruptCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .set({ corrupt: true });
    await expect(
      corruptCapability.repository.recordMatrixSendProof(matrixSendProofCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });

    const corruptReceipt = issueConsumeFixture();
    await corruptReceipt.repository.issueCapability(issueCommand());
    await corruptReceipt.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('capability_issuance_receipts')
      .doc(capability().matrixIdempotencyKeyDigest)
      .set({ corrupt: true });
    await expect(
      corruptReceipt.repository.recordMatrixSendProof(matrixSendProofCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' });

    const issued = issueConsumeFixture();
    await issued.repository.issueCapability(issueCommand());
    await expect(
      issued.repository.recordMatrixSendProof({
        ...matrixSendProofCommand(),
        leaseFence: '8',
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      issued.repository.recordMatrixSendProof({
        ...matrixSendProofCommand(),
        matrixIdempotencyKeyDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    for (const mismatch of [
      { matrixRoomBindingDigest: 'f'.repeat(64) },
      { scenarioId: 'scenario_changed' },
      { scenarioNumber: 2 },
      { phase: 'turn' as const, turnIndex: 1 },
    ])
      await expect(
        issued.repository.recordMatrixSendProof({ ...matrixSendProofCommand(), ...mismatch })
      ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });

    await expect(
      issued.repository.recordMatrixSendProof({
        ...matrixSendProofCommand(),
        now: '2026-07-20T10:05:00.001Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const quiesced = issueConsumeFixture();
    await quiesced.repository.issueCapability(issueCommand());
    await quiesced.repository.quiesceRun(quiesceLifecycleCommand());
    await expect(
      quiesced.repository.recordMatrixSendProof(matrixSendProofCommand())
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
  });

  it('rejects transport replay when the retained receipt no longer matches its lease', async () => {
    const { firestore, repository } = issueConsumeFixture();
    await repository.issueCapability(issueCommand());
    await repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const receiptRef = firestore
      .collection(MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION)
      .doc('3'.repeat(64));
    const stored = (await receiptRef.get()).data() as Record<string, unknown>;
    await receiptRef.set({ ...stored, userId: 'other_user' });

    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'transport_receipt',
    });
  });

  it('fails quiesce closed for replay drift, lease drift, and corrupt retained work', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).quiesceRun(
        quiesceLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const stale = issueConsumeFixture();
    await expect(
      stale.repository.quiesceRun({ ...quiesceLifecycleCommand(), runId: 'run_other' })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const replay = issueConsumeFixture();
    await replay.repository.quiesceRun(quiesceLifecycleCommand());
    await expect(
      replay.repository.quiesceRun({
        ...quiesceLifecycleCommand(),
        canonicalRequestDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      replay.repository.quiesceRun({
        ...quiesceLifecycleCommand(),
        idempotencyKeyDigest: 'e'.repeat(64),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });

    const expired = issueConsumeFixture();
    await expect(
      expired.repository.quiesceRun({
        ...quiesceLifecycleCommand(),
        now: '2026-07-20T10:05:00.000Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const missingCapability = issueConsumeFixture();
    await missingCapability.repository.issueCapability(issueCommand());
    await missingCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(missingCapability.repository.quiesceRun(quiesceLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'capability',
    });

    const missingOutbox = fixture();
    await missingOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .delete();
    await expect(
      lifecycleRepository(missingOutbox.firestore).quiesceRun(quiesceLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });

    const claimedOutbox = fixture();
    await expect(
      lifecycleRepository(claimedOutbox.firestore).quiesceRun(quiesceLifecycleCommand())
    ).resolves.toMatchObject({ code: 'QUIESCED', drained: false });

    const dependencyFailure = issueConsumeFixture();
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: dependencyFailure.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).quiesceRun(quiesceLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('quiesces by revoking the unconsumed capability and closing a pending ingest outbox', async () => {
    const pending = issueConsumeFixture();
    await pending.repository.issueCapability(issueCommand());
    await pending.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());

    await expect(pending.repository.quiesceRun(quiesceLifecycleCommand())).resolves.toMatchObject({
      code: 'QUIESCED',
      phase: 'quiescing',
      drained: false,
    });
    await expect(
      pending.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(consumeCommand().ingestOutboxId)
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'closed', closedReason: 'quiesced' });

    const unconsumed = issueConsumeFixture();
    await unconsumed.repository.issueCapability(issueCommand());
    await expect(unconsumed.repository.quiesceRun(quiesceLifecycleCommand())).resolves.toMatchObject({
      code: 'QUIESCED',
      drained: true,
    });
    await expect(
      unconsumed.firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc(capability().capabilityDigest)
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ revokedAt: quiesceLifecycleCommand().now });
  });

  it('fails release closed until an exact drained and status-proven quiesced run exists', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).releaseRun(
        releaseLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const active = issueConsumeFixture();
    await expect(active.repository.releaseRun(releaseLifecycleCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });

    const stale = issueConsumeFixture();
    await stale.repository.quiesceRun(quiesceLifecycleCommand());
    const staleRelease = releaseLifecycleCommand();
    staleRelease.runId = 'run_other';
    staleRelease.controlStatus.runId = 'run_other';
    staleRelease.terminalControl.runId = 'run_other';
    await expect(
      stale.repository.releaseRun(staleRelease)
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const notDrained = fixture();
    const notDrainedRepository = lifecycleRepository(notDrained.firestore);
    await notDrainedRepository.quiesceRun(quiesceLifecycleCommand());
    await expect(notDrainedRepository.releaseRun(releaseLifecycleCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'quiescing',
    });

    const notReady = issueConsumeFixture();
    await notReady.repository.quiesceRun(quiesceLifecycleCommand());
    await expect(
      notReady.repository.releaseRun({
        ...releaseLifecycleCommand(),
        controlStatus: { kind: 'not_ready' },
      })
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'release' });

    const expired = issueConsumeFixture();
    await expired.repository.quiesceRun(quiesceLifecycleCommand());
    const expiredRelease = releaseLifecycleCommand();
    expiredRelease.now = '2026-07-20T10:05:00.000Z';
    expiredRelease.terminalControl.createdAt = '2026-07-20T10:05:00.000Z';
    await expect(expired.repository.releaseRun(expiredRelease)).resolves.toEqual({
      code: 'LEASE_EXPIRED',
      expiresAt: '2026-07-20T10:05:00.000Z',
    });

    const collision = issueConsumeFixture();
    await collision.repository.quiesceRun(quiesceLifecycleCommand());
    await collision.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc(releaseLifecycleCommand().terminalControlId)
      .set({ occupied: true });
    await expect(collision.repository.releaseRun(releaseLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'terminal_outbox',
    });

    const replay = issueConsumeFixture();
    await replay.repository.quiesceRun(quiesceLifecycleCommand());
    await replay.repository.releaseRun(releaseLifecycleCommand());
    await expect(
      replay.repository.releaseRun({
        ...releaseLifecycleCommand(),
        canonicalRequestDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });

    const dependencyFailure = issueConsumeFixture();
    await dependencyFailure.repository.quiesceRun(quiesceLifecycleCommand());
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: dependencyFailure.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).releaseRun(releaseLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('fails abandonment closed for premature, stale, corrupt, and conflicting retained work', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).abandonExpiredRun(
        abandonLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const premature = issueConsumeFixture();
    await expect(
      premature.repository.abandonExpiredRun({
        ...abandonLifecycleCommand(),
        now: '2026-07-20T10:04:59.999Z',
        terminalControl: {
          ...abandonLifecycleCommand().terminalControl,
          createdAt: '2026-07-20T10:04:59.999Z',
        },
      })
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'abandon' });

    const stale = issueConsumeFixture();
    await expect(
      stale.repository.abandonExpiredRun({
        ...abandonLifecycleCommand(),
        observedUserId: 'other_user',
        terminalControl: {
          ...abandonLifecycleCommand().terminalControl,
          userId: 'other_user',
        },
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const terminalCollision = issueConsumeFixture();
    await terminalCollision.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc(abandonLifecycleCommand().terminalControlId)
      .set({ occupied: true });
    await expect(
      terminalCollision.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });

    const missingCapability = issueConsumeFixture();
    await missingCapability.repository.issueCapability(issueCommand());
    await missingCapability.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(
      missingCapability.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });

    const corruptOutbox = issueConsumeFixture();
    await corruptOutbox.repository.issueCapability(issueCommand());
    await corruptOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await corruptOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId)
      .set({ corrupt: true });
    await expect(corruptOutbox.repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'ingest_outbox',
    });

    const releasePending = issueConsumeFixture();
    await releasePending.repository.quiesceRun(quiesceLifecycleCommand());
    await releasePending.repository.releaseRun(releaseLifecycleCommand());
    await expect(
      releasePending.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toMatchObject({ code: 'ABANDON_PENDING', phase: 'abandon_pending' });
    await expect(
      releasePending.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc(releaseLifecycleCommand().terminalControlId)
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'closed', closedReason: 'expired_unclaimed_release' });
  });

  it('retains claimed work during abandonment and rejects an already-published release record', async () => {
    const claimedIngest = fixture();
    await expect(
      lifecycleRepository(claimedIngest.firestore).abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toMatchObject({ code: 'ABANDON_PENDING', phase: 'abandon_pending' });
    await expect(
      claimedIngest.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'claimed', closedReason: null });

    const claimedRelease = issueConsumeFixture();
    await claimedRelease.repository.quiesceRun(quiesceLifecycleCommand());
    await claimedRelease.repository.releaseRun(releaseLifecycleCommand());
    const delivery = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: claimedRelease.firestore,
    });
    await delivery.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand());
    await expect(
      claimedRelease.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toMatchObject({ code: 'ABANDON_PENDING', phase: 'abandon_pending' });
    await expect(
      claimedRelease.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_release')
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'claimed', closedReason: null });

    const publishedRelease = issueConsumeFixture();
    await publishedRelease.repository.quiesceRun(quiesceLifecycleCommand());
    await publishedRelease.repository.releaseRun(releaseLifecycleCommand());
    const publishedDelivery = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: publishedRelease.firestore,
    });
    await publishedDelivery.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand());
    await publishedDelivery.acknowledgeTerminalControl(releaseTerminalAcknowledgementCommand());
    const publishedLease = await readCurrentLease(publishedRelease.firestore);
    await persistLeasePair(publishedRelease.firestore, {
      ...publishedLease,
      phase: 'release_pending',
      terminalWinner: null,
      releasedAt: null,
    });
    await expect(
      publishedRelease.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });

    const nonReleaseCandidate = issueConsumeFixture();
    await nonReleaseCandidate.repository.quiesceRun(quiesceLifecycleCommand());
    await nonReleaseCandidate.repository.releaseRun(releaseLifecycleCommand());
    await nonReleaseCandidate.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_release')
      .set({
        ...terminalOutbox(),
        terminalControlId: 'terminal_release',
        eventId: 'terminal_release',
        payload: {
          ...terminalOutbox().payload,
          eventId: 'terminal_release',
        },
      });
    await expect(
      nonReleaseCandidate.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
  });

  it('reports only exact current and nonexpired transport status', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).getTransportStatus(
        transportStatusLifecycleCommand()
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const stale = issueConsumeFixture();
    await expect(
      stale.repository.getTransportStatus({
        ...transportStatusLifecycleCommand(),
        userId: 'other_user',
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      stale.repository.getTransportStatus({
        ...transportStatusLifecycleCommand(),
        now: '2026-07-20T10:05:00.000Z',
      })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const corruptSlot = issueConsumeFixture();
    await corruptSlot.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set({ corrupt: true });
    await expect(
      corruptSlot.repository.getTransportStatus(transportStatusLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const missingHistory = issueConsumeFixture();
    await missingHistory.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .delete();
    await expect(
      missingHistory.repository.getTransportStatus(transportStatusLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });
  });

  it('quiesces a drained run, exposes safe status, and enqueues release once', async () => {
    const { firestore, repository } = issueConsumeFixture();

    await expect(repository.getTransportStatus(transportStatusLifecycleCommand())).resolves.toMatchObject({
      code: 'TRANSPORT_STATUS',
      phase: 'active',
      drained: false,
    });
    await expect(repository.quiesceRun(quiesceLifecycleCommand())).resolves.toMatchObject({
      code: 'QUIESCED',
      phase: 'quiescing',
      drained: true,
    });
    await expect(repository.quiesceRun(quiesceLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'quiesce',
    });
    await expect(repository.releaseRun(releaseLifecycleCommand())).resolves.toMatchObject({
      code: 'RELEASE_PENDING',
      terminalControlId: 'terminal_release',
    });
    await expect(repository.releaseRun(releaseLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'release',
    });
    const terminalRef = firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_release');
    const stored = (await terminalRef.get()).data() as Record<string, unknown>;
    await terminalRef.set({
      ...stored,
      userId: 'other_user',
      payload: { ...(stored['payload'] as Record<string, unknown>), userId: 'other_user' },
    });
    await expect(repository.releaseRun(releaseLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'terminal_outbox',
    });
  });

  it('deletes only the exact terminal predecessor and retains a replay receipt', async () => {
    const { firestore, repository, currentRunFenceDigest, terminalControlId } =
      await cleanupFixture();
    const command = cleanupCommand(currentRunFenceDigest);

    await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      targetRunId: 'run_1',
      finalRevision: 1,
    });
    await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
    });
    await expect(
      firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(leaseSlotDigest)
        .collection('runs')
        .doc(runFenceDigest)
        .get()
        .then((snapshot) => snapshot.exists)
    ).resolves.toBe(false);
    await expect(
      firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc(terminalControlId)
        .get()
        .then((snapshot) => snapshot.exists)
    ).resolves.toBe(false);
  });

  it('cleans two exact predecessors under one provisioning lease and replays both receipts', async () => {
    const { firestore, repository, currentRunFenceDigest, secondRunFenceDigest } = await cleanupFixture(
      1,
      true
    );
    const first = cleanupCommand(currentRunFenceDigest);
    const second = {
      ...first,
      targetRunId: 'run_2',
      targetLeaseFence: '6',
      targetRunFenceDigest: secondRunFenceDigest,
      idempotencyKeyDigest: '1'.repeat(64),
      canonicalRequestDigest: '2'.repeat(64),
      now: '2026-07-20T10:06:02.000Z',
    };

    await expect(repository.cleanupExactRun(first)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      targetRunId: 'run_1',
      finalRevision: 1,
    });
    await expect(
      repository.cleanupExactRun({
        ...second,
        idempotencyKeyDigest: first.idempotencyKeyDigest,
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(repository.cleanupExactRun(second)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      targetRunId: 'run_2',
      finalRevision: 1,
    });
    await expect(repository.cleanupExactRun(first)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      targetRunId: 'run_1',
    });
    await expect(repository.cleanupExactRun(second)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      targetRunId: 'run_2',
    });

    const current = (await readCurrentLease(firestore)) as MatrixCorpusLeaseV1;
    const secondReceipt = current.finalCleanupReceipt;
    if (
      secondReceipt === null ||
      secondReceipt.replayProjection.operation !== 'cleanup' ||
      secondReceipt.replayProjection.result !== 'cleaned'
    )
      throw new Error('second cleanup must retain a final receipt');
    const saturated = {
      ...current,
      priorFinalCleanupReceipts: [
        ...(current.priorFinalCleanupReceipts ?? []),
        secondReceipt,
      ],
      finalCleanupReceipt: {
        ...secondReceipt,
        idempotencyKeyDigest: '3'.repeat(64),
        canonicalRequestDigest: '4'.repeat(64),
        replayProjection: {
          ...secondReceipt.replayProjection,
          targetRunId: 'run_3',
          targetLeaseFence: '5',
          targetRunFenceDigest: '3'.repeat(64),
          cleanedAt: '2026-07-20T10:06:03.000Z',
        },
        recordedAt: '2026-07-20T10:06:03.000Z',
      },
    } satisfies MatrixCorpusLeaseV1;
    const slotRef = firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest);
    await slotRef.set(saturated);
    await slotRef
      .collection('runs')
      .doc(currentRunFenceDigest)
      .set({ ...saturated, leaseSlotDigest });
    await expect(
      repository.cleanupExactRun({
        ...first,
        targetRunId: 'run_4',
        targetLeaseFence: '4',
        targetRunFenceDigest: '4'.repeat(64),
        idempotencyKeyDigest: '5'.repeat(64),
        canonicalRequestDigest: '6'.repeat(64),
        now: '2026-07-20T10:06:04.000Z',
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });
  });

  it('cleans a predecessor from a legacy provisioning lease without receipt history', async () => {
    const { firestore, repository, currentRunFenceDigest } = await cleanupFixture();
    const current = (await readCurrentLease(firestore)) as MatrixCorpusLeaseV1;
    const { priorFinalCleanupReceipts: _omitted, ...legacyCurrent } = current;
    const slotRef = firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest);
    await slotRef.set(legacyCurrent);
    await slotRef
      .collection('runs')
      .doc(currentRunFenceDigest)
      .set({ ...legacyCurrent, leaseSlotDigest });

    await expect(
      repository.cleanupExactRun(cleanupCommand(currentRunFenceDigest))
    ).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      targetRunId: 'run_1',
    });
    await expect(readCurrentLease(firestore)).resolves.toMatchObject({
      priorFinalCleanupReceipts: [],
      finalCleanupReceipt: {
        replayProjection: {
          operation: 'cleanup',
          result: 'cleaned',
          targetRunId: 'run_1',
        },
      },
    });
  });

  it('cleans every exact child kind produced by a complete strict-mock run', async () => {
    const { firestore, repository, currentRunFenceDigest } = await fullCleanupFixture();

    await expect(repository.cleanupExactRun(cleanupCommand(currentRunFenceDigest))).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      targetRunId: 'run_1',
    });
    await expect(
      firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc(capability().capabilityDigest)
        .get()
        .then((snapshot) => snapshot.exists)
    ).resolves.toBe(false);
    await expect(
      firestore
        .collection(MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION)
        .doc(consumeCommand().transportMessageIdDigest)
        .get()
        .then((snapshot) => snapshot.exists)
    ).resolves.toBe(false);
    await expect(
      firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(consumeCommand().ingestOutboxId)
        .get()
        .then((snapshot) => snapshot.exists)
    ).resolves.toBe(false);
  });

  it('replays durable old-run receipts after takeover but rejects a new stale mutation', async () => {
    const { repository } = await cleanupFixture();

    await expect(repository.activateRun(displacedActivateCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'activate',
    });
    await expect(repository.renewLease(displacedRenewCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew',
    });
    await expect(
      repository.activateRun(displacedActivateCommand('c'.repeat(64)))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
  });

  it('commits cleanup in bounded 96-child chunks and replays each committed revision', async () => {
    const { repository, currentRunFenceDigest } = await cleanupFixture(97);
    const first = cleanupCommand(currentRunFenceDigest);

    await expect(repository.cleanupExactRun(first)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
      remainingChildCount: 2,
    });
    await expect(repository.cleanupExactRun(first)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'progress',
      committedRevision: 1,
    });
    await expect(
      repository.cleanupExactRun({
        ...first,
        expectedRevision: 1,
        idempotencyKeyDigest: '9'.repeat(64),
        canonicalRequestDigest: '8'.repeat(64),
        now: '2026-07-20T10:06:02.000Z',
      })
    ).resolves.toMatchObject({ code: 'RUN_CLEANED', finalRevision: 2 });
  });

  it('fails exact cleanup closed for stale identity, invalid phase, and missing target history', async () => {
    await expect(
      lifecycleRepository(createFakeFirestore() as unknown as Firestore).cleanupExactRun(
        cleanupCommand('c'.repeat(64))
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const staleCurrent = await cleanupFixture();
    await expect(
      staleCurrent.repository.cleanupExactRun({
        ...cleanupCommand(staleCurrent.currentRunFenceDigest),
        currentRunId: 'run_other',
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const active = issueConsumeFixture();
    await expect(
      active.repository.cleanupExactRun({
        ...cleanupCommand(runFenceDigest),
        currentRunId: 'run_1',
        currentLeaseFence: '7',
        currentRunFenceDigest: runFenceDigest,
        targetRunId: 'run_target',
        targetLeaseFence: '6',
        targetRunFenceDigest: 'c'.repeat(64),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const missingTarget = await cleanupFixture();
    await missingTarget.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .delete();
    await expect(
      missingTarget.repository.cleanupExactRun(cleanupCommand(missingTarget.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const corruptTarget = await cleanupFixture();
    await corruptTarget.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ corrupt: true });
    await expect(
      corruptTarget.repository.cleanupExactRun(cleanupCommand(corruptTarget.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const staleTarget = await cleanupFixture();
    const targetRef = staleTarget.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest);
    const target = (await targetRef.get()).data() as Record<string, unknown>;
    await targetRef.set({ ...target, userId: 'other_user' });
    await expect(
      staleTarget.repository.cleanupExactRun(cleanupCommand(staleTarget.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    const activeTarget = await cleanupFixture();
    await activeTarget.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ ...lease(), leaseSlotDigest });
    await expect(
      activeTarget.repository.cleanupExactRun(cleanupCommand(activeTarget.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
  });

  it('fails cleanup closed for revision drift, missing children, replay conflict, and digest failure', async () => {
    const revision = await cleanupFixture();
    await expect(
      revision.repository.cleanupExactRun({
        ...cleanupCommand(revision.currentRunFenceDigest),
        expectedRevision: 1,
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });

    const missingChild = await cleanupFixture();
    await missingChild.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('renew_receipts')
      .doc('a'.repeat(64))
      .delete();
    await expect(
      missingChild.repository.cleanupExactRun(cleanupCommand(missingChild.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'renew_receipt' });

    const corruptChild = await cleanupFixture();
    await corruptChild.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .collection('renew_receipts')
      .doc('a'.repeat(64))
      .set({ corrupt: true });
    await expect(
      corruptChild.repository.cleanupExactRun(cleanupCommand(corruptChild.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'renew_receipt' });

    const progressReplay = await cleanupFixture(97);
    const progressCommand = cleanupCommand(progressReplay.currentRunFenceDigest);
    await progressReplay.repository.cleanupExactRun(progressCommand);
    await expect(
      progressReplay.repository.cleanupExactRun({
        ...progressCommand,
        canonicalRequestDigest: '1'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });

    const finalReplay = await cleanupFixture();
    const finalCommand = cleanupCommand(finalReplay.currentRunFenceDigest);
    await finalReplay.repository.cleanupExactRun(finalCommand);
    await expect(
      finalReplay.repository.cleanupExactRun({
        ...finalCommand,
        idempotencyKeyDigest: '1'.repeat(64),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });
    await expect(
      finalReplay.repository.cleanupExactRun({
        ...finalCommand,
        canonicalRequestDigest: '1'.repeat(64),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: finalReplay.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).cleanupExactRun(finalCommand)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });

    const dependencyFailure = await cleanupFixture();
    await expect(
      new FirestoreMatrixCorpusRepository({
        firestore: dependencyFailure.firestore,
        replayProjectionDigest: { digest: () => 'invalid' },
      }).cleanupExactRun(cleanupCommand(dependencyFailure.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('abandons an expired run while atomically closing its pending ingest intent', async () => {
    const { firestore, repository } = issueConsumeFixture();
    await repository.issueCapability(issueCommand());
    await repository.consumeCapabilityAndEnqueueIngest(consumeCommand());

    await expect(repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toMatchObject({
      code: 'ABANDON_PENDING',
      phase: 'abandon_pending',
      terminalControlId: 'terminal_abandoned',
    });
    await expect(repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
    });
    await expect(
      firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_2')
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ status: 'closed', closedReason: 'abandoned' });
    const terminalRef = firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_abandoned');
    const stored = (await terminalRef.get()).data() as Record<string, unknown>;
    await terminalRef.set({
      ...stored,
      leaseFence: '8',
      payload: { ...(stored['payload'] as Record<string, unknown>), leaseFence: '8' },
    });
    await expect(repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'terminal_outbox',
    });
  });

  it('aborts an exact provisioning lease before expiry but rejects that trigger after activation', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const repository = lifecycleRepository(fakeFirestore as unknown as Firestore);
    await expect(repository.acquireProvisioningLease(acquireLifecycleCommand())).resolves.toMatchObject({
      code: 'ACQUIRED',
      phase: 'provisioning',
      leaseFence: '1',
    });
    const abort = {
      runtimeAudience: 'hetzner-prod' as const,
      observedRunId: 'run_lifecycle',
      observedUserId: 'private_user_fixture',
      observedLeaseFence: '1',
      leaseSlotDigest,
      runFenceDigest,
      now: '2026-07-20T10:00:01.000Z',
      terminalControlId: 'terminal_early_abort',
      terminalControl: {
        version: 1 as const,
        kind: 'abandoned' as const,
        eventId: 'terminal_early_abort',
        runId: 'run_lifecycle',
        userId: 'private_user_fixture',
        leaseFence: '1',
        createdAt: '2026-07-20T10:00:01.000Z',
        tombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      },
      terminalPayloadDigest: '7'.repeat(64),
      trigger: 'evaluator_abort' as const,
    };

    await expect(repository.abandonExpiredRun(abort)).resolves.toMatchObject({
      code: 'ABANDON_PENDING',
      phase: 'abandon_pending',
    });

    const activeFake = createFakeFirestore();
    activeFake.clear();
    const activeRepository = lifecycleRepository(activeFake as unknown as Firestore);
    await activeRepository.acquireProvisioningLease(acquireLifecycleCommand());
    await activeRepository.activateRun(activateLifecycleCommand());
    await expect(activeRepository.abandonExpiredRun(abort)).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
  });
});

describe('FirestoreMatrixCorpusSignedEnvelopeStore', () => {
  it('persists one first-wins signing window and one exact envelope', async () => {
    const { firestore, repo } = fixture();
    const prepared = await Promise.all([
      repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      }),
      repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      }),
    ]);
    expect(prepared).toEqual([
      { kind: 'reserved', generation: 1, issuedAt: timestamp, expiresAt: firstJwsExpiresAt },
      { kind: 'reserved', generation: 1, issuedAt: timestamp, expiresAt: firstJwsExpiresAt },
    ]);

    await expect(
      repo.completeIngest({
        ...authority(),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope(),
      })
    ).resolves.toEqual({
      kind: 'ready',
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: envelope(),
    });

    const stored = await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .get();
    expect(stored.data()).toMatchObject({
      deliveryAttestation: {
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope(),
      },
    });
  });

  it('rejects malformed base authority and invalid ingest signing windows before mutation', async () => {
    const { repo } = fixture();
    const invalidInputs = [
      { ...authority(), runtimeAudience: 'production' },
      { ...authority(), runId: '' },
      { ...authority(), userId: '' },
      { ...authority(), leaseFence: 'not-a-fence' },
      { ...authority(), leaseSlotDigest: 'invalid' },
      { ...authority(), runFenceDigest: 'invalid' },
      { ...authority(), ownerDigest: 'invalid' },
      { ...authority(), payloadDigest: 'invalid' },
      { ...authority(), ingestOutboxId: '' },
      { ...authority(), proposedIssuedAt: 'invalid' },
    ];

    for (const invalid of invalidInputs)
      await expect(
        repo.prepareIngest({
          ...invalid,
          proposedIssuedAt:
            'proposedIssuedAt' in invalid ? invalid.proposedIssuedAt : timestamp,
          proposedExpiresAt: firstJwsExpiresAt,
        } as never)
      ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('rejects missing, corrupt, or foreign ingest authority and completion without a reservation', async () => {
    const empty = new FirestoreMatrixCorpusSignedEnvelopeStore({
      firestore: createFakeFirestore() as unknown as Firestore,
    });
    await expect(
      empty.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const missingHistory = fixture();
    await missingHistory.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .delete();
    await expect(
      missingHistory.repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const corruptOutbox = fixture();
    await corruptOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({ corrupt: true });
    await expect(
      corruptOutbox.repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const foreignClaim = fixture();
    await expect(
      foreignClaim.repo.prepareIngest({
        ...authority({ ownerDigest: 'f'.repeat(64) }),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const noReservation = fixture();
    await expect(
      noReservation.repo.completeIngest({
        ...authority(),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');

    const invalidCompletion = fixture();
    await expect(
      invalidCompletion.repo.completeIngest({
        ...authority({ ingestOutboxId: '' }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const foreignCompletion = fixture();
    await expect(
      foreignCompletion.repo.completeIngest({
        ...authority({ ownerDigest: 'f'.repeat(64) }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('replays the exact completed ingest envelope and rejects a contradictory envelope', async () => {
    const { repo } = fixture();
    await repo.prepareIngest({
      ...authority(),
      proposedIssuedAt: timestamp,
      proposedExpiresAt: firstJwsExpiresAt,
    });
    const completion = {
      ...authority(),
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: envelope(),
    };
    await repo.completeIngest(completion);
    await expect(repo.completeIngest(completion)).resolves.toMatchObject({
      kind: 'ready',
      generation: 1,
      envelope: envelope(),
    });
    await expect(
      repo.completeIngest({ ...completion, envelope: envelope('e30.e30.BB') })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');
    await expect(
      repo.completeIngest({ ...completion, generation: 0 })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('rotates only with a renewed current lease and live reclaim then rejects stale completion', async () => {
    const expired = fixture();
    await expired.repo.prepareIngest({
      ...authority(),
      proposedIssuedAt: timestamp,
      proposedExpiresAt: firstJwsExpiresAt,
    });
    await expired.repo.completeIngest({
      ...authority(),
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: envelope(),
    });

    await expect(
      expired.repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: '2026-07-20T10:05:30.000Z',
        proposedExpiresAt: '2026-07-20T10:10:30.000Z',
      })
    ).resolves.toEqual({
      kind: 'ready',
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: envelope(),
    });
    await expect(
      expired.repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: '2026-07-20T10:05:30.001Z',
        proposedExpiresAt: '2026-07-20T10:10:30.001Z',
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const { firestore, repo } = fixture();
    await repo.prepareIngest({
      ...authority(),
      proposedIssuedAt: timestamp,
      proposedExpiresAt: firstJwsExpiresAt,
    });
    await repo.completeIngest({
      ...authority(),
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: envelope(),
    });

    const renewedLease = {
      ...lease(),
      renewedAt: '2026-07-20T10:05:30.001Z',
      expiresAt: '2026-07-20T10:10:30.001Z',
    };
    await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set(renewedLease);
    await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ ...renewedLease, leaseSlotDigest });
    const storedOutbox = await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .get();
    const reattestedClaimExpiry = '2026-07-20T10:06:30.001Z';
    await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({
        ...storedOutbox.data(),
        claim: {
          ownerDigest,
          purpose: 'publish',
          claimedAt: '2026-07-20T10:05:30.001Z',
          expiresAt: reattestedClaimExpiry,
        },
      });

    await expect(
      repo.prepareIngest({
        ...authority({ expectedClaimExpiresAt: reattestedClaimExpiry }),
        proposedIssuedAt: '2026-07-20T10:05:30.001Z',
        proposedExpiresAt: '2026-07-20T10:10:30.001Z',
      })
    ).resolves.toEqual({
      kind: 'reserved',
      generation: 2,
      issuedAt: '2026-07-20T10:05:30.001Z',
      expiresAt: '2026-07-20T10:10:30.001Z',
    });
    await expect(
      repo.completeIngest({
        ...authority({ expectedClaimExpiresAt: reattestedClaimExpiry }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: envelope('e30.e30.BB'),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');
  });

  it('rejects a stale current slot before creating signing authority', async () => {
    const { firestore, repo } = fixture();
    await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set({ ...lease(), runId: 'run_new', runFenceDigest: '0'.repeat(64) });

    await expect(
      repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
    const stored = await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .get();
    expect(stored.data()).not.toHaveProperty('deliveryAttestation');

    const validForeignPair = fixture();
    await persistLeasePair(validForeignPair.firestore, { ...lease(), userId: 'other_user' });
    await expect(
      validForeignPair.repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('rejects a new signing reservation exactly at claim expiry', async () => {
    const { repo } = fixture();

    await expect(
      repo.prepareIngest({
        ...authority(),
        proposedIssuedAt: claimExpiresAt,
        proposedExpiresAt: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('persists and rotates a terminal signing generation under renewed authority', async () => {
    const { firestore, repo } = terminalFixture();
    await expect(
      repo.prepareTerminal({
        ...terminalAuthority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).resolves.toEqual({
      kind: 'reserved',
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
    });
    await expect(
      repo.completeTerminal({
        ...terminalAuthority(),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: terminalEnvelope(),
      })
    ).resolves.toEqual({
      kind: 'ready',
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: terminalEnvelope(),
    });

    const renewedAt = '2026-07-20T10:05:30.001Z';
    const renewedLease = {
      ...terminalLease(),
      renewedAt,
      expiresAt: '2026-07-20T10:10:30.001Z',
    };
    await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set(renewedLease);
    await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ ...renewedLease, leaseSlotDigest });
    const reattestedClaimExpiry = '2026-07-20T10:06:30.001Z';
    const storedOutbox = await firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .get();
    await firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({
        ...storedOutbox.data(),
        claim: {
          ownerDigest,
          purpose: 'publish',
          claimedAt: renewedAt,
          expiresAt: reattestedClaimExpiry,
        },
      });

    await expect(
      repo.prepareTerminal({
        ...terminalAuthority({ expectedClaimExpiresAt: reattestedClaimExpiry }),
        proposedIssuedAt: renewedAt,
        proposedExpiresAt: '2026-07-20T10:10:30.001Z',
      })
    ).resolves.toEqual({
      kind: 'reserved',
      generation: 2,
      issuedAt: renewedAt,
      expiresAt: '2026-07-20T10:10:30.001Z',
    });
    await expect(
      repo.completeTerminal({
        ...terminalAuthority({ expectedClaimExpiresAt: reattestedClaimExpiry }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: terminalEnvelope('e30.e30.BB'),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');
  });

  it('reserves expired-lease signing only for a claimed abandoned terminal control', async () => {
    const issuedAfterLeaseExpiry = '2026-07-20T10:05:30.001Z';
    const liveClaimExpiresAt = '2026-07-20T10:06:30.001Z';
    const proposedExpiresAt = '2026-07-20T10:10:30.001Z';
    const abandoned = terminalFixture();
    await abandoned.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({
        ...terminalOutbox(),
        claim: {
          ownerDigest,
          purpose: 'publish',
          claimedAt: issuedAfterLeaseExpiry,
          expiresAt: liveClaimExpiresAt,
        },
      });

    await expect(
      abandoned.repo.prepareTerminal({
        ...terminalAuthority({ expectedClaimExpiresAt: liveClaimExpiresAt }),
        proposedIssuedAt: issuedAfterLeaseExpiry,
        proposedExpiresAt,
      })
    ).resolves.toEqual({
      kind: 'reserved',
      generation: 1,
      issuedAt: issuedAfterLeaseExpiry,
      expiresAt: proposedExpiresAt,
    });

    const release = terminalFixture();
    await persistLeasePair(release.firestore, {
      ...terminalLease(),
      phase: 'release_pending',
    });
    await release.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({
        ...terminalOutbox(),
        kind: 'release',
        payload: { ...terminalOutbox().payload, kind: 'release' },
        claim: {
          ownerDigest,
          purpose: 'publish',
          claimedAt: issuedAfterLeaseExpiry,
          expiresAt: liveClaimExpiresAt,
        },
      });

    await expect(
      release.repo.prepareTerminal({
        ...terminalAuthority({ expectedClaimExpiresAt: liveClaimExpiresAt }),
        proposedIssuedAt: issuedAfterLeaseExpiry,
        proposedExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });

  it('rejects foreign terminal authority and replays only the exact completed terminal envelope', async () => {
    const mismatchedId = terminalFixture();
    await expect(
      mismatchedId.repo.prepareTerminal({
        ...terminalAuthority({ terminalControlId: 'terminal_other' }),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    await expect(
      mismatchedId.repo.completeTerminal({
        ...terminalAuthority({ terminalControlId: 'terminal_other' }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: terminalEnvelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    await expect(
      terminalFixture().repo.prepareTerminal({
        ...terminalAuthority(),
        proposedIssuedAt: 'invalid',
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const corruptOutbox = terminalFixture();
    await corruptOutbox.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({ corrupt: true });
    await expect(
      corruptOutbox.repo.prepareTerminal({
        ...terminalAuthority(),
        proposedIssuedAt: timestamp,
        proposedExpiresAt: firstJwsExpiresAt,
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const noReservation = terminalFixture();
    await expect(
      noReservation.repo.completeTerminal({
        ...terminalAuthority(),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: terminalEnvelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');

    const exact = terminalFixture();
    const preparation = {
      ...terminalAuthority(),
      proposedIssuedAt: timestamp,
      proposedExpiresAt: firstJwsExpiresAt,
    };
    await exact.repo.prepareTerminal(preparation);
    await expect(exact.repo.prepareTerminal(preparation)).resolves.toMatchObject({
      kind: 'reserved',
      generation: 1,
    });
    const completion = {
      ...terminalAuthority(),
      generation: 1,
      issuedAt: timestamp,
      expiresAt: firstJwsExpiresAt,
      envelope: terminalEnvelope(),
    };
    await exact.repo.completeTerminal(completion);
    await expect(exact.repo.completeTerminal(completion)).resolves.toMatchObject({
      kind: 'ready',
      generation: 1,
      envelope: terminalEnvelope(),
    });
    await expect(
      exact.repo.completeTerminal({ ...completion, envelope: terminalEnvelope('e30.e30.BB') })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT');
    await expect(
      exact.repo.completeTerminal({ ...completion, generation: 0 })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const expiredAuthority = terminalFixture();
    await expect(
      expiredAuthority.repo.prepareTerminal({
        ...terminalAuthority(),
        proposedIssuedAt: claimExpiresAt,
        proposedExpiresAt: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');

    const foreignCompletion = terminalFixture();
    await expect(
      foreignCompletion.repo.completeTerminal({
        ...terminalAuthority({ ownerDigest: 'f'.repeat(64) }),
        generation: 1,
        issuedAt: timestamp,
        expiresAt: firstJwsExpiresAt,
        envelope: terminalEnvelope(),
      })
    ).rejects.toThrow('MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED');
  });
});

describe('FirestoreMatrixCorpusDeliveryRepository', () => {
  it('rejects every malformed delivery command before Firestore access', async () => {
    const repository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: createFakeFirestore() as unknown as Firestore,
    });
    const operations = [
      () => repository.claimPendingIngestOutbox({} as never),
      () => repository.renewIngestOutboxClaim({} as never),
      () => repository.acknowledgeIngestOutbox({} as never),
      () => repository.claimPendingTerminalControlOutbox({} as never),
      () => repository.renewTerminalControlOutboxClaim({} as never),
      () => repository.acknowledgeTerminalControl({} as never),
    ];

    for (const operation of operations)
      await expect(operation()).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
  });

  it('rejects a stale lease identity consistently across every delivery mutation', async () => {
    const ingest = fixture();
    const ingestRepository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: ingest.firestore,
    });
    for (const operation of [
      () => ingestRepository.claimPendingIngestOutbox(ingestClaimCommand({ userId: 'other_user' })),
      () => ingestRepository.renewIngestOutboxClaim(ingestRenewCommand({ userId: 'other_user' })),
      () =>
        ingestRepository.acknowledgeIngestOutbox(
          ingestAcknowledgementCommand({ userId: 'other_user' })
        ),
    ])
      await expect(operation()).resolves.toEqual({ code: 'STALE_FENCE' });

    const terminal = terminalFixture();
    const terminalRepository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: terminal.firestore,
    });
    for (const operation of [
      () =>
        terminalRepository.claimPendingTerminalControlOutbox(
          terminalClaimCommand({ userId: 'other_user' })
        ),
      () =>
        terminalRepository.renewTerminalControlOutboxClaim(
          terminalRenewCommand({ userId: 'other_user' })
        ),
      () =>
        terminalRepository.acknowledgeTerminalControl(
          terminalAcknowledgementCommand({ userId: 'other_user' })
        ),
    ])
      await expect(operation()).resolves.toEqual({ code: 'STALE_FENCE' });
  });

  it('claims, renews, and acknowledges a release terminal winner exactly once', async () => {
    const lifecycle = issueConsumeFixture();
    await lifecycle.repository.quiesceRun(quiesceLifecycleCommand());
    await lifecycle.repository.releaseRun(releaseLifecycleCommand());
    const repository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: lifecycle.firestore,
    });

    await expect(
      repository.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand())
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      terminalControlId: 'terminal_release',
    });
    await expect(
      repository.renewTerminalControlOutboxClaim(releaseTerminalRenewCommand())
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIM_RENEWED', outboxKind: 'terminal' });
    const acknowledgement = releaseTerminalAcknowledgementCommand({
      expectedClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    });
    await expect(repository.acknowledgeTerminalControl(acknowledgement)).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      leasePhase: 'released',
      authoritativeWinner: { kind: 'release', eventId: 'terminal_release' },
    });
    await expect(repository.acknowledgeTerminalControl(acknowledgement)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'acknowledge_terminal',
      leasePhase: 'released',
    });
  });

  it('expires an unclaimed release terminal and prevents its claim renewal at lease expiry', async () => {
    const unclaimed = issueConsumeFixture();
    await unclaimed.repository.quiesceRun(quiesceLifecycleCommand());
    await unclaimed.repository.releaseRun(releaseLifecycleCommand());
    const unclaimedRepository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: unclaimed.firestore,
    });
    await expect(
      unclaimedRepository.claimPendingTerminalControlOutbox(
        releaseTerminalClaimCommand({
          now: '2026-07-20T10:05:00.000Z',
          claimExpiresAt: '2026-07-20T10:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const claimed = issueConsumeFixture();
    await claimed.repository.quiesceRun(quiesceLifecycleCommand());
    await claimed.repository.releaseRun(releaseLifecycleCommand());
    const claimedRepository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: claimed.firestore,
    });
    await claimedRepository.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand());
    await expect(
      claimedRepository.renewTerminalControlOutboxClaim(
        releaseTerminalRenewCommand({
          now: '2026-07-20T10:05:00.000Z',
          newClaimExpiresAt: '2026-07-20T10:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });
  });

  it('promotes an abandoned terminal winner and supersedes its expired release predecessor', async () => {
    const lifecycle = issueConsumeFixture();
    await lifecycle.repository.quiesceRun(quiesceLifecycleCommand());
    await lifecycle.repository.releaseRun(releaseLifecycleCommand());
    await lifecycle.repository.abandonExpiredRun(abandonLifecycleCommand());
    const repository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: lifecycle.firestore,
    });
    const claimExpiresAt = '2026-07-20T10:06:00.000Z';
    await expect(
      repository.claimPendingTerminalControlOutbox(
        terminalClaimCommand({
          now: '2026-07-20T10:05:01.000Z',
          claimExpiresAt,
          terminalControlId: 'terminal_abandoned',
          eventId: 'terminal_abandoned',
          payloadDigest: '7'.repeat(64),
        })
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIMED', terminalControlId: 'terminal_abandoned' });
    const acknowledgedAt = '2026-07-20T10:05:30.000Z';
    await expect(
      repository.acknowledgeTerminalControl(
        terminalAcknowledgementCommand({
          now: acknowledgedAt,
          requestTerminalControlId: 'terminal_abandoned',
          requestEventId: 'terminal_abandoned',
          requestPayloadDigest: '7'.repeat(64),
          expectedClaimExpiresAt: claimExpiresAt,
          authoritativeWinner: {
            kind: 'abandoned',
            eventId: 'terminal_abandoned',
            payloadDigest: '7'.repeat(64),
            outcome: 'stopped_not_evaluated',
            acknowledgedAt,
          },
        })
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', leasePhase: 'abandoned' });
    await expect(
      lifecycle.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_release')
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({
      status: 'closed',
      closedReason: 'superseded_by_authoritative_winner',
      closedAt: acknowledgedAt,
    });
  });

  it('authorizes only the exact current run, fence, evaluator, and transport binding', async () => {
    const { firestore } = fixture();
    const repository = new FirestoreMatrixCorpusLeaseBindingAuthorization({
      firestore,
      digests: {
        digest(domain) {
          return domain === 'imc-lease-slot-v1' ? leaseSlotDigest : runFenceDigest;
        },
      },
    });
    const exact = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      matrixRoomBindingDigest: '7'.repeat(64),
      whatsappAccountBindingDigest: '8'.repeat(64),
      whatsappSenderBindingDigest: '9'.repeat(64),
    };

    await expect(repository.authorizeCurrentLeaseBinding(exact)).resolves.toEqual({
      code: 'AUTHORIZED',
    });
    await expect(
      repository.authorizeCurrentLeaseBinding({
        ...exact,
        matrixRoomBindingDigest: '6'.repeat(64),
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.authorizeCurrentLeaseBinding({
        ...exact,
        whatsappAccountBindingDigest: '6'.repeat(64),
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.authorizeCurrentLeaseBinding({
        ...exact,
        whatsappSenderBindingDigest: '6'.repeat(64),
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.authorizeCurrentLeaseBinding({ ...exact, runId: 'run_unknown' })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.authorizeCurrentLeaseBinding({ ...exact, userId: 'user_unknown' })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.authorizeCurrentLeaseBinding({ ...exact, leaseFence: '8' })
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      Reflect.apply(repository.authorizeCurrentLeaseBinding, repository, [
        { ...exact, userId: undefined },
      ])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });
  });

  it('fails lease authorization closed for digest and persisted-pair corruption', async () => {
    const exact = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      matrixRoomBindingDigest: '7'.repeat(64),
      whatsappAccountBindingDigest: '8'.repeat(64),
      whatsappSenderBindingDigest: '9'.repeat(64),
    };
    const repositoryWith = (
      firestore: Firestore,
      digestFn: (domain: string) => string = (domain) =>
        domain === 'imc-lease-slot-v1' ? leaseSlotDigest : runFenceDigest
    ) =>
      new FirestoreMatrixCorpusLeaseBindingAuthorization({
        firestore,
        digests: { digest: (domain) => digestFn(domain) },
      });

    const empty = createFakeFirestore() as unknown as Firestore;
    await expect(repositoryWith(empty).authorizeCurrentLeaseBinding(exact)).resolves.toEqual({
      code: 'NOT_FOUND',
    });
    await expect(
      repositoryWith(empty, () => {
        throw new Error('digest unavailable');
      }).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });
    await expect(
      repositoryWith(empty, (domain) =>
        domain === 'imc-lease-slot-v1' ? 'invalid' : runFenceDigest
      ).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });
    await expect(
      repositoryWith(empty, (domain) =>
        domain === 'imc-lease-slot-v1' ? leaseSlotDigest : 'invalid'
      ).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const corruptSlotFixture = fixture();
    await corruptSlotFixture.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .set({ corrupt: true });
    await expect(
      repositoryWith(corruptSlotFixture.firestore).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const wrongFenceFixture = fixture();
    await expect(
      repositoryWith(
        wrongFenceFixture.firestore,
        (domain) => (domain === 'imc-lease-slot-v1' ? leaseSlotDigest : 'f'.repeat(64))
      ).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });

    const missingHistoryFixture = fixture();
    await missingHistoryFixture.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .delete();
    await expect(
      repositoryWith(missingHistoryFixture.firestore).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const corruptHistoryFixture = fixture();
    await corruptHistoryFixture.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest)
      .set({ corrupt: true });
    await expect(
      repositoryWith(corruptHistoryFixture.firestore).authorizeCurrentLeaseBinding(exact)
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });
  });

  it('claims one pending ingest record once and fences a competing owner', async () => {
    const { firestore } = fixture();
    await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({ ...outbox(), status: 'pending', claim: null });
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const { expectedClaimExpiresAt: _expectedClaimExpiresAt, ...claimAuthority } = authority();
    const command = {
      ...claimAuthority,
      purpose: 'publish' as const,
      now: timestamp,
      claimExpiresAt,
    };

    const results = await Promise.all([
      repository.claimPendingIngestOutbox(command),
      repository.claimPendingIngestOutbox(command),
    ]);
    expect(results.map((result) => result.code).sort()).toEqual([
      'ALREADY_APPLIED',
      'OUTBOX_CLAIMED',
    ]);
    await expect(
      repository.claimPendingIngestOutbox({ ...command, ownerDigest: 'e'.repeat(64) })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('fails ingest claiming closed for missing, corrupt, foreign, closed, and stale authority', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = ingestClaimCommand()
    ) => {
      const { firestore } = fixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({ firestore }).claimPendingIngestOutbox(
        command as ReturnType<typeof ingestClaimCommand>
      );
    };

    await expect(run(async (firestore) => {
      await firestore.collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION).doc('outbox_1').delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestClaimCommand({ ingestOutboxId: 'outbox_unknown' }))
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), ingestOutboxId: 'outbox_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestClaimCommand({ payloadDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({
          ...outbox(),
          status: 'closed',
          claim: null,
          closedReason: 'quiesced',
          closedAt: timestamp,
        });
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    await expect(
      run(async () => {}, ingestClaimCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
  });

  it('handles expiry, takeover, recovery, and ineligible ingest claims deterministically', async () => {
    const expiredFixture = fixture();
    await expiredFixture.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({ ...outbox(), status: 'pending', claim: null });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: expiredFixture.firestore,
      }).claimPendingIngestOutbox(
        ingestClaimCommand({
          now: '2026-07-20T10:05:00.000Z',
          claimExpiresAt: '2026-07-20T10:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T10:05:00.000Z' });

    const takeoverFixture = fixture();
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: takeoverFixture.firestore,
      }).claimPendingIngestOutbox(
        ingestClaimCommand({
          ownerDigest: 'e'.repeat(64),
          now: '2026-07-20T10:01:00.000Z',
          claimExpiresAt: '2026-07-20T10:02:00.000Z',
        })
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIMED', ownerDigest: 'e'.repeat(64) });

    const recoveryFixture = fixture();
    const publishedAt = '2026-07-20T10:00:01.000Z';
    await recoveryFixture.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({
        ...outbox(),
        status: 'published',
        claim: {
          ownerDigest,
          purpose: 'terminal_marker_recovery',
          claimedAt: timestamp,
          expiresAt: claimExpiresAt,
        },
        publisherReceiptDigest: 'e'.repeat(64),
        publishedAt,
        acknowledgementReceipts: [
          {
            version: 1,
            ownerDigest,
            claimPurpose: 'publish',
            expectedClaimExpiresAt: claimExpiresAt,
            outcome: {
              kind: 'publication_acknowledged',
              publisherReceiptDigest: 'e'.repeat(64),
              publishedAt,
            },
            acknowledgedAt: publishedAt,
            drained: false,
          },
        ],
      });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: recoveryFixture.firestore,
      }).claimPendingIngestOutbox(
        ingestClaimCommand({
          purpose: 'terminal_marker_recovery',
          now: '2026-07-20T10:01:00.000Z',
          claimExpiresAt: '2026-07-20T10:02:00.000Z',
        })
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      purpose: 'terminal_marker_recovery',
    });

    const ineligibleFixture = fixture();
    const quiescing = {
      ...lease(),
      phase: 'quiescing' as const,
      quiescedAt: timestamp,
    };
    await persistLeasePair(ineligibleFixture.firestore, quiescing);
    await ineligibleFixture.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set({ ...outbox(), status: 'pending', claim: null });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: ineligibleFixture.firestore,
      }).claimPendingIngestOutbox(ingestClaimCommand())
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
  });

  it('renews one live ingest claim idempotently and rejects a stale owner', async () => {
    const { firestore } = fixture();
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      leaseSlotDigest,
      runFenceDigest,
      ownerDigest,
      now: '2026-07-20T10:00:30.000Z',
      ingestOutboxId: 'outbox_1',
      payloadDigest,
      purpose: 'publish' as const,
      expectedClaimExpiresAt: claimExpiresAt,
      newClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    };

    await expect(repository.renewIngestOutboxClaim(command)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      claimExpiresAt: command.newClaimExpiresAt,
    });
    await expect(repository.renewIngestOutboxClaim(command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      claimExpiresAt: command.newClaimExpiresAt,
    });
    await expect(
      repository.renewIngestOutboxClaim({ ...command, ownerDigest: 'e'.repeat(64) })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('fails ingest renewal closed for missing, corrupt, foreign, inactive, and stale claims', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = ingestRenewCommand()
    ) => {
      const { firestore } = fixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({ firestore }).renewIngestOutboxClaim(
        command as ReturnType<typeof ingestRenewCommand>
      );
    };

    await expect(run(async (firestore) => {
      await firestore.collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION).doc('outbox_1').delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestRenewCommand({ ingestOutboxId: 'outbox_unknown' }))
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), ingestOutboxId: 'outbox_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestRenewCommand({ payloadDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({
          ...outbox(),
          status: 'closed',
          claim: null,
          closedReason: 'quiesced',
          closedAt: timestamp,
        });
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), status: 'pending', claim: null });
    })).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, ingestRenewCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      run(async () => {}, ingestRenewCommand({ expectedClaimExpiresAt: '2026-07-20T10:01:01.000Z' }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    await expect(run(async (firestore) => {
      const provisioning = {
        ...lease(),
        phase: 'provisioning' as const,
        activatedAt: null,
        operationReceipts: {
          ...lease().operationReceipts,
          activate: null,
        },
      };
      await persistLeasePair(firestore, provisioning);
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });
  });

  it('acknowledges one ingest publication first-wins without changing its identity', async () => {
    const { firestore } = fixture();
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      leaseSlotDigest,
      runFenceDigest,
      ownerDigest,
      now: '2026-07-20T10:00:30.000Z',
      ingestOutboxId: 'outbox_1',
      ingestReceiptId: 'receipt_1',
      payloadDigest,
      claimPurpose: 'publish' as const,
      expectedClaimExpiresAt: claimExpiresAt,
      outcome: {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest: '1'.repeat(64),
        publishedAt: '2026-07-20T10:00:30.000Z',
      },
    };

    await expect(repository.acknowledgeIngestOutbox(command)).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      ingestOutboxId: 'outbox_1',
      payloadDigest,
    });
    await expect(repository.acknowledgeIngestOutbox(command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      ingestOutboxId: 'outbox_1',
      payloadDigest,
    });
    await expect(
      repository.acknowledgeIngestOutbox({
        ...command,
        outcome: { ...command.outcome, publisherReceiptDigest: '2'.repeat(64) },
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    const stored = await firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .get();
    expect(stored.data()).toMatchObject({
      ingestReceiptId: 'receipt_1',
      payloadDigest,
      status: 'published',
      publisherReceiptDigest: '1'.repeat(64),
      publishedAt: command.outcome.publishedAt,
      claim: { purpose: 'terminal_marker_recovery' },
    });
  });

  it('fails ingest acknowledgement closed for missing, corrupt, foreign, stale, and contradictory state', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = ingestAcknowledgementCommand()
    ) => {
      const { firestore } = fixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({ firestore }).acknowledgeIngestOutbox(
        command as ReturnType<typeof ingestAcknowledgementCommand>
      );
    };

    await expect(run(async (firestore) => {
      await firestore.collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION).doc('outbox_1').delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestAcknowledgementCommand({ ingestOutboxId: 'outbox_unknown' }))
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), ingestOutboxId: 'outbox_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    await expect(
      run(async () => {}, ingestAcknowledgementCommand({ ingestReceiptId: 'receipt_changed' }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, ingestAcknowledgementCommand({ payloadDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, ingestAcknowledgementCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc('outbox_1')
        .set({ ...outbox(), status: 'pending', claim: null });
    })).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, ingestAcknowledgementCommand({ expectedClaimExpiresAt: '2026-07-20T10:01:01.000Z' }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    await expect(run(async (firestore) => {
      const provisioning = {
        ...lease(),
        phase: 'provisioning' as const,
        activatedAt: null,
        operationReceipts: { ...lease().operationReceipts, activate: null },
      };
      await persistLeasePair(firestore, provisioning);
    })).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'provisioning',
    });
  });

  it('acknowledges terminal-marker recovery and deterministic pre-publication closure', async () => {
    const markerFixture = fixture();
    await markerFixture.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set(publishedOutbox());
    const markerCommand = ingestAcknowledgementCommand({
      claimPurpose: 'terminal_marker_recovery',
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: 'e'.repeat(64),
        publishedAt: '2026-07-20T10:00:01.000Z',
        terminalMarker: {
          kind: 'completed',
          digest: 'f'.repeat(64),
          recordedAt: '2026-07-20T10:00:30.000Z',
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: markerFixture.firestore,
      }).acknowledgeIngestOutbox(markerCommand as ReturnType<typeof ingestAcknowledgementCommand>)
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      outcome: { kind: 'terminal_marker_acknowledged' },
    });

    const closureFixture = fixture();
    const quiescing = {
      ...lease(),
      phase: 'quiescing' as const,
      quiescedAt: timestamp,
    };
    await persistLeasePair(closureFixture.firestore, quiescing);
    const closureCommand = ingestAcknowledgementCommand({
      outcome: {
        kind: 'claimed_not_published_closed',
        reason: 'quiesced',
        closedAt: '2026-07-20T10:00:30.000Z',
      },
    });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: closureFixture.firestore,
      }).acknowledgeIngestOutbox(closureCommand as ReturnType<typeof ingestAcknowledgementCommand>)
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      outcome: { kind: 'claimed_not_published_closed', reason: 'quiesced' },
    });

    const wrongMarkerFacts = fixture();
    await wrongMarkerFacts.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set(publishedOutbox());
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: wrongMarkerFacts.firestore,
      }).acknowledgeIngestOutbox({
        ...markerCommand,
        outcome: { ...markerCommand.outcome, publisherReceiptDigest: '1'.repeat(64) },
      } as ReturnType<typeof ingestAcknowledgementCommand>)
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    const wrongMarkerPhase = fixture();
    await wrongMarkerPhase.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set(publishedOutbox());
    await persistLeasePair(wrongMarkerPhase.firestore, {
      ...lease(),
      phase: 'provisioning',
      activatedAt: null,
      operationReceipts: { ...lease().operationReceipts, activate: null },
    });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: wrongMarkerPhase.firestore,
      }).acknowledgeIngestOutbox(markerCommand as ReturnType<typeof ingestAcknowledgementCommand>)
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });

    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: fixture().firestore,
      }).acknowledgeIngestOutbox(
        ingestAcknowledgementCommand({
          outcome: {
            kind: 'claimed_not_published_closed',
            reason: 'quiesced',
            closedAt: '2026-07-20T10:00:30.000Z',
          },
        }) as ReturnType<typeof ingestAcknowledgementCommand>
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
  });

  it('claims one pending terminal record once and fences a competing owner', async () => {
    const { firestore } = terminalFixture();
    await firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({ ...terminalOutbox(), status: 'pending', claim: null });
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const { expectedClaimExpiresAt: _expectedClaimExpiresAt, ...claimAuthority } =
      terminalAuthority();
    const command = {
      ...claimAuthority,
      now: timestamp,
      claimExpiresAt,
    };

    const results = await Promise.all([
      repository.claimPendingTerminalControlOutbox(command),
      repository.claimPendingTerminalControlOutbox(command),
    ]);
    expect(results.map((result) => result.code).sort()).toEqual([
      'ALREADY_APPLIED',
      'OUTBOX_CLAIMED',
    ]);
    await expect(
      repository.claimPendingTerminalControlOutbox({
        ...command,
        ownerDigest: 'e'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('fails terminal claiming closed for missing, corrupt, foreign, closed, and stale authority', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = terminalClaimCommand()
    ) => {
      const { firestore } = terminalFixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({
        firestore,
      }).claimPendingTerminalControlOutbox(command as ReturnType<typeof terminalClaimCommand>);
    };

    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(
        async () => {},
        terminalClaimCommand({ terminalControlId: 'terminal_unknown', eventId: 'terminal_unknown' })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), terminalControlId: 'terminal_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(async () => {}, terminalClaimCommand({ payloadDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, terminalClaimCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({
          ...terminalOutbox(),
          status: 'closed',
          claim: null,
          closedReason: 'superseded_by_authoritative_winner',
          closedAt: timestamp,
        });
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });

    await expect(
      run(
        async () => {},
        terminalClaimCommand({
          ownerDigest: 'e'.repeat(64),
          now: '2026-07-20T10:01:00.000Z',
          claimExpiresAt: '2026-07-20T10:02:00.000Z',
        })
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIMED', ownerDigest: 'e'.repeat(64) });
  });

  it('renews one terminal claim idempotently and rejects a stale owner', async () => {
    const { firestore } = terminalFixture();
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      leaseSlotDigest,
      runFenceDigest,
      ownerDigest,
      now: '2026-07-20T10:00:30.000Z',
      terminalControlId: 'terminal_1',
      eventId: 'terminal_1',
      payloadDigest,
      expectedClaimExpiresAt: claimExpiresAt,
      newClaimExpiresAt: '2026-07-20T10:01:30.000Z',
    };

    await expect(repository.renewTerminalControlOutboxClaim(command)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      claimExpiresAt: command.newClaimExpiresAt,
    });
    await expect(repository.renewTerminalControlOutboxClaim(command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      claimExpiresAt: command.newClaimExpiresAt,
    });
    await expect(
      repository.renewTerminalControlOutboxClaim({ ...command, ownerDigest: 'e'.repeat(64) })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('fails terminal renewal closed for missing, corrupt, foreign, closed, and stale claims', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = terminalRenewCommand()
    ) => {
      const { firestore } = terminalFixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({
        firestore,
      }).renewTerminalControlOutboxClaim(command as ReturnType<typeof terminalRenewCommand>);
    };

    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(
        async () => {},
        terminalRenewCommand({ terminalControlId: 'terminal_unknown', eventId: 'terminal_unknown' })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), terminalControlId: 'terminal_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(async () => {}, terminalRenewCommand({ payloadDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(async () => {}, terminalRenewCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({
          ...terminalOutbox(),
          status: 'closed',
          claim: null,
          closedReason: 'superseded_by_authoritative_winner',
          closedAt: timestamp,
        });
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), status: 'pending', claim: null });
    })).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(
        async () => {},
        terminalRenewCommand({ expectedClaimExpiresAt: '2026-07-20T10:01:01.000Z' })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('acknowledges the first terminal winner and retains it on replay', async () => {
    const { firestore } = terminalFixture();
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });
    const acknowledgedAt = '2026-07-20T10:00:30.000Z';
    const command = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'private_user_fixture',
      leaseFence: '7',
      leaseSlotDigest,
      runFenceDigest,
      ownerDigest,
      now: acknowledgedAt,
      requestTerminalControlId: 'terminal_1',
      requestEventId: 'terminal_1',
      requestPayloadDigest: payloadDigest,
      expectedClaimExpiresAt: claimExpiresAt,
      authoritativeWinner: {
        kind: 'abandoned' as const,
        eventId: 'terminal_1',
        payloadDigest,
        outcome: 'stopped_not_evaluated' as const,
        acknowledgedAt,
      },
    };

    await expect(repository.acknowledgeTerminalControl(command)).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      leasePhase: 'abandoned',
      authoritativeWinner: command.authoritativeWinner,
    });
    const replay = await repository.acknowledgeTerminalControl(command);
    expect(replay).toMatchObject({
      code: 'ALREADY_APPLIED',
      leasePhase: 'abandoned',
      authoritativeWinner: command.authoritativeWinner,
    });
    await expect(
      repository.acknowledgeTerminalControl({
        ...command,
        authoritativeWinner: {
          ...command.authoritativeWinner,
          outcome: 'provisioning_noop' as const,
        },
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    const current = await firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .get();
    expect(current.data()).toMatchObject({
      phase: 'abandoned',
      terminalWinner: command.authoritativeWinner,
      abandonedAt: acknowledgedAt,
    });
  });

  it('fails terminal acknowledgement closed for missing, corrupt, stale, and contradictory winners', async () => {
    const run = async (
      prepare: (firestore: Firestore) => Promise<void>,
      command = terminalAcknowledgementCommand()
    ) => {
      const { firestore } = terminalFixture();
      await prepare(firestore);
      return await new FirestoreMatrixCorpusDeliveryRepository({
        firestore,
      }).acknowledgeTerminalControl(command as ReturnType<typeof terminalAcknowledgementCommand>);
    };

    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .delete();
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ corrupt: true });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), userId: 'user_changed' });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(
        async () => {},
        terminalAcknowledgementCommand({
          requestTerminalControlId: 'terminal_unknown',
          requestEventId: 'terminal_unknown',
        })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      run(
        async () => {},
        terminalAcknowledgementCommand({ requestEventId: 'terminal_changed' })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      run(
        async () => {},
        terminalAcknowledgementCommand({ requestPayloadDigest: 'e'.repeat(64) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({ ...terminalOutbox(), status: 'pending', claim: null });
    })).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });
    await expect(
      run(async () => {}, terminalAcknowledgementCommand({ ownerDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(
        async () => {},
        terminalAcknowledgementCommand({ expectedClaimExpiresAt: '2026-07-20T10:01:01.000Z' })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      run(
        async () => {},
        terminalAcknowledgementCommand({
          authoritativeWinner: {
            ...terminalAcknowledgementCommand().authoritativeWinner,
            kind: 'release',
          },
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });

    await expect(run(async (firestore) => {
      await firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .set({
          ...terminalOutbox(),
          status: 'published',
          acknowledgedAt: '2026-07-20T10:00:30.000Z',
        });
    })).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    await expect(
      run(async () => {}, terminalAcknowledgementCommand({ leaseFence: '8' }))
    ).resolves.toEqual({ code: 'STALE_FENCE' });
  });

  it('rejects terminal acknowledgement in an active or contradictory final lease phase', async () => {
    const active = terminalFixture();
    await persistLeasePair(active.firestore, { ...terminalLease(), phase: 'active' });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: active.firestore,
      }).acknowledgeTerminalControl(terminalAcknowledgementCommand())
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });

    const final = terminalFixture();
    const retainedAcknowledgedAt = '2026-07-20T10:00:29.000Z';
    await persistLeasePair(final.firestore, {
      ...terminalLease(),
      phase: 'abandoned',
      abandonedAt: retainedAcknowledgedAt,
      terminalWinner: {
        kind: 'abandoned',
        eventId: 'terminal_1',
        payloadDigest,
        outcome: 'stopped_not_evaluated',
        acknowledgedAt: retainedAcknowledgedAt,
      },
    });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: final.firestore,
      }).acknowledgeTerminalControl(terminalAcknowledgementCommand())
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
  });

  it('closes a pending losing terminal and rejects contradictory retained closure state', async () => {
    const setup = async () => {
      const lifecycle = issueConsumeFixture();
      await lifecycle.repository.quiesceRun(quiesceLifecycleCommand());
      await lifecycle.repository.releaseRun(releaseLifecycleCommand());
      await lifecycle.repository.abandonExpiredRun(abandonLifecycleCommand());
      const releaseRef = lifecycle.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_release');
      const release = (await releaseRef.get()).data() as Record<string, unknown>;
      const repository = new FirestoreMatrixCorpusDeliveryRepository({
        firestore: lifecycle.firestore,
      });
      const claimExpiresAt = '2026-07-20T10:06:00.000Z';
      await repository.claimPendingTerminalControlOutbox(
        terminalClaimCommand({
          now: '2026-07-20T10:05:01.000Z',
          claimExpiresAt,
          terminalControlId: 'terminal_abandoned',
          eventId: 'terminal_abandoned',
          payloadDigest: '7'.repeat(64),
        })
      );
      const acknowledgedAt = '2026-07-20T10:05:30.000Z';
      const acknowledgement = terminalAcknowledgementCommand({
        now: acknowledgedAt,
        requestTerminalControlId: 'terminal_abandoned',
        requestEventId: 'terminal_abandoned',
        requestPayloadDigest: '7'.repeat(64),
        expectedClaimExpiresAt: claimExpiresAt,
        authoritativeWinner: {
          kind: 'abandoned',
          eventId: 'terminal_abandoned',
          payloadDigest: '7'.repeat(64),
          outcome: 'stopped_not_evaluated',
          acknowledgedAt,
        },
      });
      return { lifecycle, repository, releaseRef, release, acknowledgement, acknowledgedAt };
    };

    const pending = await setup();
    await pending.releaseRef.set({
      ...pending.release,
      status: 'pending',
      claim: null,
      acknowledgedAt: null,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
    });
    await expect(
      pending.repository.acknowledgeTerminalControl(
        pending.acknowledgement as ReturnType<typeof terminalAcknowledgementCommand>
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', leasePhase: 'abandoned' });
    await expect(pending.releaseRef.get().then((snapshot) => snapshot.data())).resolves.toMatchObject({
      status: 'closed',
      closedReason: 'superseded_by_authoritative_winner',
      closedAt: pending.acknowledgedAt,
    });

    const contradictory = await setup();
    await contradictory.releaseRef.set({
      ...contradictory.release,
      status: 'closed',
      claim: null,
      acknowledgedAt: null,
      closedReason: 'superseded_by_authoritative_winner',
      lastClaimRenewal: null,
      closedAt: '2026-07-20T10:05:10.000Z',
    });
    await expect(
      contradictory.repository.acknowledgeTerminalControl(
        contradictory.acknowledgement as ReturnType<typeof terminalAcknowledgementCommand>
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
  });

  it('returns NOT_FOUND consistently when every delivery mutation lacks its lease pair', async () => {
    const fakeFirestore = createFakeFirestore();
    fakeFirestore.clear();
    const firestore = fakeFirestore as unknown as Firestore;
    const repository = new FirestoreMatrixCorpusDeliveryRepository({ firestore });

    await expect(repository.claimPendingIngestOutbox(ingestClaimCommand())).resolves.toEqual({
      code: 'NOT_FOUND',
    });
    await expect(repository.renewIngestOutboxClaim(ingestRenewCommand())).resolves.toEqual({
      code: 'NOT_FOUND',
    });
    await expect(
      repository.acknowledgeIngestOutbox(ingestAcknowledgementCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.claimPendingTerminalControlOutbox(terminalClaimCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.renewTerminalControlOutboxClaim(terminalRenewCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      repository.acknowledgeTerminalControl(terminalAcknowledgementCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(lifecycleRepository(firestore).issueCapability(issueCommand())).resolves.toEqual({
      code: 'NOT_FOUND',
    });
  });

  it('fails lease renewal closed when a receipt survives without its parent history', async () => {
    const fixture = issueConsumeFixture();
    const historyRef = fixture.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest);
    await historyRef.delete();
    await historyRef
      .collection('renew_receipts')
      .doc(displacedRenewCommand().idempotencyKeyDigest)
      .set({
        version: 1,
        idempotencyKeyDigest: displacedRenewCommand().idempotencyKeyDigest,
        runId: 'run_1',
        userId: 'private_user_fixture',
        leaseFence: '7',
        canonicalRequestDigest: displacedRenewCommand().canonicalRequestDigest,
        replayProjection: {
          operation: 'renew',
          result: 'renewed',
          runId: 'run_1',
          leaseFence: '7',
          phase: 'active',
          renewedAt: timestamp,
          expiresAt: '2026-07-20T10:05:00.000Z',
        },
        resultDigest: 'e'.repeat(64),
        recordedAt: timestamp,
      });

    await expect(fixture.repository.renewLease(displacedRenewCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'renew_receipt',
    });
  });

  it('fences issuance phase and receipt limits and distinguishes an unreferenced capability', async () => {
    const provisioningFirestore = createFakeFirestore() as unknown as Firestore;
    const provisioningRepository = lifecycleRepository(provisioningFirestore);
    await provisioningRepository.acquireProvisioningLease({
      ...acquireLifecycleCommand(),
      runId: 'run_1',
      userId: 'private_user_fixture',
      matrixRoomBindingDigest: '7'.repeat(64),
      whatsappAccountBindingDigest: '8'.repeat(64),
      whatsappSenderBindingDigest: '9'.repeat(64),
    });
    await expect(
      provisioningRepository.issueCapability({
        ...issueCommand(),
        capability: { ...capability(), leaseFence: '1' },
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });

    const limited = issueConsumeFixture();
    const current = await readCurrentLease(limited.firestore);
    await persistLeasePair(limited.firestore, {
      ...current,
      capabilityIssuanceReceiptIds: Array.from({ length: 800 }, (_, index) =>
        (index + 1).toString(16).padStart(64, '0')
      ),
    });
    await expect(limited.repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });

    const missing = issueConsumeFixture();
    await expect(
      missing.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    const replay = issueConsumeFixture();
    await replay.repository.issueCapability(issueCommand());
    await replay.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await replay.firestore
      .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
      .doc(capability().capabilityDigest)
      .delete();
    await expect(
      replay.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });
  });

  it('fails capability replay closed for missing pointed capability and retained ingest intent', async () => {
    const pointed = issueConsumeFixture();
    await pointed.repository.issueCapability(issueCommand());
    await pointed.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const pointedDigest = 'f'.repeat(64);
    const pointedLease = await readCurrentLease(pointed.firestore);
    await persistLeasePair(pointed.firestore, {
      ...pointedLease,
      capabilityDigests: [capability().capabilityDigest, pointedDigest],
      unconsumedCapability: { digest: pointedDigest, phase: 'start' },
    });
    await expect(
      pointed.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandWithIds('5', 'receipt_3', 'outbox_3', '6')
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'capability' });

    const missingOutbox = issueConsumeFixture();
    await missingOutbox.repository.issueCapability(issueCommand());
    await missingOutbox.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await missingOutbox.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc(consumeCommand().ingestOutboxId)
      .delete();
    await expect(
      missingOutbox.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandWithIds('5', 'receipt_3', 'outbox_3', '6')
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
  });

  it('revokes exact abandonment capability and rejects every corrupt pointed variant', async () => {
    const createIssued = async () => {
      const fixture = issueConsumeFixture();
      await fixture.repository.issueCapability(issueCommand());
      return fixture;
    };

    const valid = await createIssued();
    await expect(valid.repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toMatchObject({
      code: 'ABANDON_PENDING',
    });
    await expect(
      valid.firestore
        .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
        .doc(capability().capabilityDigest)
        .get()
        .then((snapshot) => snapshot.data())
    ).resolves.toMatchObject({ revokedAt: abandonLifecycleCommand().now });

    const delivery = new FirestoreMatrixCorpusDeliveryRepository({ firestore: valid.firestore });
    const terminalClaimExpiresAt = '2026-07-20T10:06:00.000Z';
    await delivery.claimPendingTerminalControlOutbox(
      terminalClaimCommand({
        now: '2026-07-20T10:05:01.000Z',
        claimExpiresAt: terminalClaimExpiresAt,
        terminalControlId: 'terminal_abandoned',
        eventId: 'terminal_abandoned',
        payloadDigest: '7'.repeat(64),
      })
    );
    const acknowledgedAt = '2026-07-20T10:05:30.000Z';
    await delivery.acknowledgeTerminalControl(
      terminalAcknowledgementCommand({
        now: acknowledgedAt,
        requestTerminalControlId: 'terminal_abandoned',
        requestEventId: 'terminal_abandoned',
        requestPayloadDigest: '7'.repeat(64),
        expectedClaimExpiresAt: terminalClaimExpiresAt,
        authoritativeWinner: {
          kind: 'abandoned',
          eventId: 'terminal_abandoned',
          payloadDigest: '7'.repeat(64),
          outcome: 'stopped_not_evaluated',
          acknowledgedAt,
        },
      })
    );
    await expect(valid.repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'abandoned',
    });

    const variants: readonly Readonly<{
      mutate: (firestore: Firestore) => Promise<void>;
    }>[] = [
      {
        mutate: async (firestore) => {
          await firestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(capability().capabilityDigest)
            .delete();
        },
      },
      {
        mutate: async (firestore) => {
          await firestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(capability().capabilityDigest)
            .set({ corrupt: true });
        },
      },
      {
        mutate: async (firestore) => {
          await firestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(capability().capabilityDigest)
            .set({
              ...capability(),
              consumedAt: capability().issuedAt,
              consumedTransportMessageIdDigest: consumeCommand().transportMessageIdDigest,
              ingestOutboxId: consumeCommand().ingestOutboxId,
            });
        },
      },
      {
        mutate: async (firestore) => {
          await firestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(capability().capabilityDigest)
            .set({ ...capability(), revokedAt: capability().issuedAt });
        },
      },
      {
        mutate: async (firestore) => {
          await firestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(capability().capabilityDigest)
            .set({ ...capability(), userId: 'foreign_user' });
        },
      },
    ];
    for (const variant of variants) {
      const fixture = await createIssued();
      await variant.mutate(fixture.firestore);
      await expect(fixture.repository.abandonExpiredRun(abandonLifecycleCommand())).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'capability',
      });
    }

    const missingRelease = issueConsumeFixture();
    await missingRelease.repository.quiesceRun(quiesceLifecycleCommand());
    await missingRelease.repository.releaseRun(releaseLifecycleCommand());
    await missingRelease.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_release')
      .delete();
    await expect(
      missingRelease.repository.abandonExpiredRun(abandonLifecycleCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
  });

  it('fails cleanup replay and chunk creation closed for every digest inconsistency', async () => {
    const finalReplay = await cleanupFixture();
    const finalCommand = cleanupCommand(finalReplay.currentRunFenceDigest);
    await expect(finalReplay.repository.cleanupExactRun(finalCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
    });
    const slotRef = finalReplay.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest);
    const current = (await slotRef.get()).data() as MatrixCorpusLeaseV1;
    const finalCleanupReceipt = current.finalCleanupReceipt;
    expect(finalCleanupReceipt).not.toBeNull();
    if (finalCleanupReceipt === null) throw new Error('missing final cleanup receipt');
    const driftedCurrent = {
      ...current,
      finalCleanupReceipt: {
        ...finalCleanupReceipt,
        resultDigest: 'f'.repeat(64),
      },
    };
    await slotRef.set(driftedCurrent);
    await slotRef
      .collection('runs')
      .doc(finalReplay.currentRunFenceDigest)
      .set({ ...driftedCurrent, leaseSlotDigest });
    await expect(finalReplay.repository.cleanupExactRun(finalCommand)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'cleanup_progress',
    });

    const progressReplay = await cleanupFixture(97);
    const progressCommand = cleanupCommand(progressReplay.currentRunFenceDigest);
    await expect(progressReplay.repository.cleanupExactRun(progressCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
    });
    const targetRef = progressReplay.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest);
    const target = (await targetRef.get()).data() as MatrixCorpusLeaseV1;
    if (target.cleanupProgress === null) throw new Error('missing cleanup progress');
    const [retainedReceipt, ...remainingReceipts] = target.cleanupProgress.chunkReceipts;
    expect(retainedReceipt).toBeDefined();
    await targetRef.set({
      ...target,
      cleanupProgress: {
        ...target.cleanupProgress,
        chunkReceipts: [
          { ...retainedReceipt, resultDigest: 'f'.repeat(64) },
          ...remainingReceipts,
        ],
      },
    });
    await expect(progressReplay.repository.cleanupExactRun(progressCommand)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'cleanup_progress',
    });

    const dependency = await cleanupFixture(97);
    const dependencyRepository = new FirestoreMatrixCorpusRepository({
      firestore: dependency.firestore,
      replayProjectionDigest: { digest: () => 'invalid' },
    });
    await expect(
      dependencyRepository.cleanupExactRun(cleanupCommand(dependency.currentRunFenceDigest))
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'dependency_result' });
  });

  it('covers exact delivery phase edges without weakening lease authority', async () => {
    const abandonedLease = {
      ...terminalLease(),
      phase: 'abandoned' as const,
      abandonedAt: timestamp,
      terminalWinner: {
        kind: 'abandoned' as const,
        eventId: 'terminal_1',
        payloadDigest,
        outcome: 'stopped_not_evaluated' as const,
        acknowledgedAt: timestamp,
      },
    };
    const releaseRecord = (status: 'pending' | 'claimed') => ({
      ...terminalOutbox(),
      terminalControlId: 'terminal_release',
      eventId: 'terminal_release',
      kind: 'release' as const,
      payload: releaseLifecycleCommand().terminalControl,
      payloadDigest: 'd'.repeat(64),
      createdAt: releaseLifecycleCommand().terminalControl.createdAt,
      status,
      claim:
        status === 'claimed'
          ? {
              ownerDigest,
              purpose: 'publish' as const,
              claimedAt: '2026-07-20T10:00:06.000Z',
              expiresAt: '2026-07-20T10:01:06.000Z',
            }
          : null,
    });

    const takeover = fixture();
    await persistLeasePair(takeover.firestore, terminalLease());
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: takeover.firestore,
      }).claimPendingIngestOutbox(
        ingestClaimCommand({
          now: '2026-07-20T10:02:00.000Z',
          claimExpiresAt: '2026-07-20T10:03:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });

    const recoveryRenewal = fixture();
    await persistLeasePair(recoveryRenewal.firestore, terminalLease());
    await recoveryRenewal.firestore
      .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
      .doc('outbox_1')
      .set(publishedOutbox());
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: recoveryRenewal.firestore,
      }).renewIngestOutboxClaim(
        ingestRenewCommand({ purpose: 'terminal_marker_recovery' })
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      purpose: 'terminal_marker_recovery',
    });

    const abandonedClosure = fixture();
    await persistLeasePair(abandonedClosure.firestore, abandonedLease);
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: abandonedClosure.firestore,
      }).acknowledgeIngestOutbox(
        ingestAcknowledgementCommand({
          outcome: {
            kind: 'claimed_not_published_closed',
            reason: 'abandoned',
            closedAt: '2026-07-20T10:00:30.000Z',
          },
        }) as ReturnType<typeof ingestAcknowledgementCommand>
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      outcome: { kind: 'claimed_not_published_closed', reason: 'abandoned' },
    });

    for (const operation of ['claim', 'renew'] as const) {
      const final = terminalFixture();
      await persistLeasePair(final.firestore, abandonedLease);
      const repository = new FirestoreMatrixCorpusDeliveryRepository({
        firestore: final.firestore,
      });
      const result =
        operation === 'claim'
          ? await repository.claimPendingTerminalControlOutbox(terminalClaimCommand())
          : await repository.renewTerminalControlOutboxClaim(terminalRenewCommand());
      expect(result).toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });
    }

    const releasePending = terminalFixture();
    const abandonPendingWithRelease = {
      ...terminalLease(),
      terminalControlOutboxIds: ['terminal_release'],
    };
    await persistLeasePair(releasePending.firestore, abandonPendingWithRelease);
    const releaseRef = releasePending.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_release');
    await releasePending.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .delete();
    await releaseRef.set(releaseRecord('pending'));
    const releaseRepository = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: releasePending.firestore,
    });
    await expect(
      releaseRepository.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand())
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIMED' });
    await expect(
      releaseRepository.renewTerminalControlOutboxClaim(releaseTerminalRenewCommand())
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIM_RENEWED' });

    for (const operation of ['claim', 'renew'] as const) {
      const active = terminalFixture();
      await persistLeasePair(active.firestore, {
        ...lease(),
        terminalControlOutboxIds: ['terminal_release'],
      });
      await active.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_1')
        .delete();
      await active.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc('terminal_release')
        .set(releaseRecord(operation === 'claim' ? 'pending' : 'claimed'));
      const repository = new FirestoreMatrixCorpusDeliveryRepository({
        firestore: active.firestore,
      });
      const result =
        operation === 'claim'
          ? await repository.claimPendingTerminalControlOutbox(releaseTerminalClaimCommand())
          : await repository.renewTerminalControlOutboxClaim(releaseTerminalRenewCommand());
      expect(result).toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    }

    const mismatchedPair = fixture();
    const historyRef = mismatchedPair.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(leaseSlotDigest)
      .collection('runs')
      .doc(runFenceDigest);
    await historyRef.set({
      ...lease(),
      leaseSlotDigest,
      matrixRoomBindingDigest: 'e'.repeat(64),
    });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: mismatchedPair.firestore,
      }).claimPendingIngestOutbox(ingestClaimCommand())
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease_history' });

    const retainedClosure = issueConsumeFixture();
    await retainedClosure.repository.quiesceRun(quiesceLifecycleCommand());
    await retainedClosure.repository.releaseRun(releaseLifecycleCommand());
    await retainedClosure.repository.abandonExpiredRun(abandonLifecycleCommand());
    const retainedReleaseRef = retainedClosure.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_release');
    const retainedRelease = (await retainedReleaseRef.get()).data() as Record<string, unknown>;
    const retainedDelivery = new FirestoreMatrixCorpusDeliveryRepository({
      firestore: retainedClosure.firestore,
    });
    const retainedClaimExpiresAt = '2026-07-20T10:06:00.000Z';
    await retainedDelivery.claimPendingTerminalControlOutbox(
      terminalClaimCommand({
        now: '2026-07-20T10:05:01.000Z',
        claimExpiresAt: retainedClaimExpiresAt,
        terminalControlId: 'terminal_abandoned',
        eventId: 'terminal_abandoned',
        payloadDigest: '7'.repeat(64),
      })
    );
    const retainedAcknowledgedAt = '2026-07-20T10:05:30.000Z';
    await retainedReleaseRef.set({
      ...retainedRelease,
      status: 'closed',
      claim: null,
      acknowledgedAt: null,
      closedReason: 'superseded_by_authoritative_winner',
      lastClaimRenewal: null,
      closedAt: retainedAcknowledgedAt,
    });
    await expect(
      retainedDelivery.acknowledgeTerminalControl(
        terminalAcknowledgementCommand({
          now: retainedAcknowledgedAt,
          requestTerminalControlId: 'terminal_abandoned',
          requestEventId: 'terminal_abandoned',
          requestPayloadDigest: '7'.repeat(64),
          expectedClaimExpiresAt: retainedClaimExpiresAt,
          authoritativeWinner: {
            kind: 'abandoned',
            eventId: 'terminal_abandoned',
            payloadDigest: '7'.repeat(64),
            outcome: 'stopped_not_evaluated',
            acknowledgedAt: retainedAcknowledgedAt,
          },
        })
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', leasePhase: 'abandoned' });

    const replayDrift = terminalFixture();
    const driftedWinner = {
      kind: 'abandoned' as const,
      eventId: 'terminal_1',
      payloadDigest: 'e'.repeat(64),
      outcome: 'stopped_not_evaluated' as const,
      acknowledgedAt: '2026-07-20T10:00:30.000Z',
    };
    await persistLeasePair(replayDrift.firestore, {
      ...terminalLease(),
      phase: 'abandoned',
      abandonedAt: driftedWinner.acknowledgedAt,
      terminalWinner: driftedWinner,
    });
    await replayDrift.firestore
      .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
      .doc('terminal_1')
      .set({
        ...terminalOutbox(),
        status: 'published',
        acknowledgedAt: driftedWinner.acknowledgedAt,
      });
    await expect(
      new FirestoreMatrixCorpusDeliveryRepository({
        firestore: replayDrift.firestore,
      }).acknowledgeTerminalControl(
        terminalAcknowledgementCommand({ authoritativeWinner: driftedWinner })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
  });
});
