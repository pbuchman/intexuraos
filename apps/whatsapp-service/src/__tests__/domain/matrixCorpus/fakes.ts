/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fakes preserve inferred literal result types. */
import {
  matrixCorpusAttestedIngestPayloadV1Schema,
  matrixCorpusCapabilityV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSha256DigestSchema,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusCapabilityConsumeFactsV1,
  type MatrixCorpusCapabilityV1,
} from '@intexuraos/http-contracts';
import type {
  AbandonExpiredRunCommand,
  AbandonPendingResult,
  AcquireProvisioningLeaseCommand,
  AcknowledgeIngestOutboxInput,
  AcknowledgeResult,
  AcknowledgeTerminalControlInput,
  ActivateRunCommand,
  ActivationResult,
  CapabilityConsumeResult,
  CapabilityIssueResult,
  ClaimPendingIngestOutboxInput,
  ClaimPendingTerminalControlOutboxInput,
  ClaimRenewResult,
  CleanupExactRunCommand,
  CleanupResult,
  ConsumeCapabilityAndEnqueueIngestCommand,
  GetTransportStatusCommand,
  IngestClaimResult,
  IssueCapabilityCommand,
  LeaseRenewResult,
  MatrixCorpusCapabilityIssuanceReceiptV1,
  MatrixCorpusCapabilityPhase,
  MatrixCorpusCleanupChunkReceiptV1,
  MatrixCorpusCleanupProgressV1,
  MatrixCorpusCurrentLeaseHistoryPairV1,
  MatrixCorpusIngestAcknowledgementReceiptV1,
  MatrixCorpusIngestClaimRenewalV1,
  MatrixCorpusIngestOutboxRecordV1,
  MatrixCorpusLeaseHistoryV1,
  MatrixCorpusLeasePhase,
  MatrixCorpusLeaseV1,
  MatrixCorpusOutboxStatus,
  MatrixCorpusRenewReceiptV1,
  MatrixCorpusTerminalControlOutboxRecordV1,
  MatrixCorpusTerminalAuthoritativeWinnerV1,
  MatrixCorpusTerminalClaimRenewalV1,
  MatrixCorpusTerminalKind,
  MatrixCorpusTransportReceiptV1,
  ProvisioningLeaseResult,
  RecordMatrixSendProofCommand,
  MatrixSendProofResult,
  QuiesceResult,
  QuiesceRunCommand,
  ReleaseResult,
  ReleaseRunCommand,
  RenewIngestOutboxClaimInput,
  RenewLeaseCommand,
  RenewTerminalControlOutboxClaimInput,
  TerminalClaimResult,
  TerminalControlAcknowledgementResult,
  TransportStatusResult,
} from '../../../domain/matrixCorpus/types.js';
import {
  acquireProvisioningLeaseCommandSchema,
  activateRunCommandSchema,
  activationResultSchema,
  abandonPendingResultSchema,
  acknowledgeResultSchema,
  capabilityConsumeResultSchema,
  capabilityIssueResultSchema,
  claimRenewResultSchema,
  cleanupResultSchema,
  consumeCapabilityAndEnqueueIngestCommandSchema,
  ingestClaimResultSchema,
  issueCapabilityCommandSchema,
  matrixCorpusCapabilityIssuanceReceiptV1Schema,
  MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY,
  MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN,
  MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN,
  matrixCorpusCurrentLeaseHistoryPairV1Schema,
  matrixCorpusIngestOutboxRecordV1Schema,
  matrixCorpusLeaseHistoryV1Schema,
  matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema,
  matrixCorpusRenewReceiptV1Schema,
  matrixCorpusLeaseHistoryRenewReceiptPairV1Schema,
  matrixCorpusOperationReceiptV1Schema,
  matrixCorpusPersistedReplayProjectionV1Schema,
  matrixCorpusTerminalControlOutboxRecordV1Schema,
  matrixCorpusTransportReceiptV1Schema,
  provisioningLeaseResultSchema,
  quiesceRunCommandSchema,
  quiesceResultSchema,
  releaseRunCommandSchema,
  releaseResultSchema,
  renewLeaseCommandSchema,
  leaseRenewResultSchema,
  terminalClaimResultSchema,
  terminalControlAcknowledgementResultSchema,
  abandonExpiredRunCommandSchema,
  acknowledgeIngestOutboxInputSchema,
  acknowledgeTerminalControlInputSchema,
  claimPendingIngestOutboxInputSchema,
  claimPendingTerminalControlOutboxInputSchema,
  cleanupExactRunCommandSchema,
  getTransportStatusCommandSchema,
  matrixCorpusCleanupChunkReceiptV1Schema,
  matrixCorpusCleanupLeaseSetV1Schema,
  matrixCorpusCleanupProgressV1Schema,
  matrixCorpusIngestAcknowledgementReceiptV1Schema,
  renewIngestOutboxClaimInputSchema,
  renewTerminalControlOutboxClaimInputSchema,
  transportStatusResultSchema,
} from '../../../domain/matrixCorpus/types.js';
import type { ZodType } from 'zod';
import type {
  MatrixCorpusRepository,
  MatrixCorpusRepositoryDependencies,
} from '../../../domain/matrixCorpus/ports/matrixCorpusRepository.js';

type FakeMatrixCorpusCoreOperation =
  | 'acquire'
  | 'activate'
  | 'renew'
  | 'issue'
  | 'consume'
  | 'quiesce'
  | 'release'
  | 'abandon'
  | 'cleanup'
  | 'claim_ingest'
  | 'renew_ingest_claim'
  | 'acknowledge_ingest'
  | 'claim_terminal'
  | 'renew_terminal_claim'
  | 'acknowledge_terminal'
  | 'status';

type FakeMatrixCorpusMutationOperation = Exclude<FakeMatrixCorpusCoreOperation, 'status'>;

type FakePersistedCapabilityTerminalFailure =
  | 'CAPABILITY_REPLAY'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'CAPABILITY_MISMATCH';

type FakeMatrixCorpusCoreFaultStage =
  | 'acquire_after_current_draft'
  | 'acquire_after_history_draft'
  | 'activate_after_current_draft'
  | 'activate_after_history_draft'
  | 'renew_after_receipt_draft'
  | 'renew_after_current_draft'
  | 'renew_after_history_draft'
  | 'issue_after_capability_draft'
  | 'issue_after_issuance_receipt_draft'
  | 'issue_after_lease_pair_draft'
  | 'consume_after_capability_draft'
  | 'consume_after_transport_receipt_draft'
  | 'consume_after_outbox_draft'
  | 'consume_after_lease_pair_draft'
  | 'quiesce_after_capability_draft'
  | 'quiesce_after_ingest_outboxes_draft'
  | 'quiesce_after_lease_pair_draft'
  | 'release_after_terminal_outbox_draft'
  | 'release_after_lease_pair_draft'
  | 'abandon_after_capability_draft'
  | 'abandon_after_ingest_outboxes_draft'
  | 'abandon_after_release_outbox_draft'
  | 'abandon_after_terminal_outbox_draft'
  | 'abandon_after_lease_pair_draft'
  | 'cleanup_after_child_deletes_draft'
  | 'cleanup_after_progress_draft'
  | 'cleanup_after_final_receipt_pair_draft'
  | 'cleanup_after_target_history_delete_draft'
  | 'claim_ingest_after_outbox_draft'
  | 'renew_ingest_claim_after_outbox_draft'
  | 'acknowledge_ingest_after_outbox_draft'
  | 'acknowledge_ingest_after_lease_pair_draft'
  | 'claim_terminal_after_outbox_draft'
  | 'renew_terminal_claim_after_outbox_draft'
  | 'acknowledge_terminal_after_request_outbox_draft'
  | 'acknowledge_terminal_after_losing_outbox_draft'
  | 'acknowledge_terminal_after_lease_pair_draft';

export type FakeMatrixCorpusIssueConsumeInvariantForTest =
  | 'candidate_capability_intrinsic_digest_map_key'
  | 'candidate_capability_history_membership'
  | 'history_transport_reference_missing_receipt'
  | 'replay_safety_pointed_capability_intrinsic_digest_map_key'
  | 'replay_safety_pointed_capability_phase'
  | 'pending_outbox_nonterminal_membership'
  | 'terminal_failure_reference_missing_receipt'
  | 'terminal_failure_reference_capability_mismatch';

export type FakeMatrixCorpusIngestClaimInvariantForTest =
  | 'referenced_ingest_outbox_missing_record'
  | 'present_ingest_outbox_missing_history_reference';

export type FakeMatrixCorpusTerminalClaimInvariantForTest =
  | 'referenced_terminal_outbox_missing_record'
  | 'present_terminal_outbox_missing_history_reference';

export type FakeMatrixCorpusTerminalAcknowledgementInvariantForTest =
  | 'referenced_release_winner_missing_record'
  | 'release_winner_payload_digest_mismatch'
  | 'release_winner_superseded_closed';

type FakeTransactionDecision<T> =
  | { readonly kind: 'read_only'; readonly result: T }
  | { readonly kind: 'commit'; readonly result: T };

type FakeCurrentPairRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt'; readonly recordKind: 'lease' | 'lease_history' }
  | { readonly kind: 'found'; readonly pair: MatrixCorpusCurrentLeaseHistoryPairV1 };

interface FakeMatrixCorpusCoreState {
  readonly version: number;
  readonly leaseSlots: Map<string, MatrixCorpusLeaseV1>;
  readonly leaseHistories: Map<string, MatrixCorpusLeaseHistoryV1>;
  readonly renewReceiptsByRun: Map<string, Map<string, MatrixCorpusRenewReceiptV1>>;
  readonly capabilityIssuanceReceiptsByRun: Map<
    string,
    Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>
  >;
  readonly capabilities: Map<string, MatrixCorpusCapabilityV1>;
  readonly transportReceipts: Map<string, MatrixCorpusTransportReceiptV1>;
  readonly ingestOutboxes: Map<string, MatrixCorpusIngestOutboxRecordV1>;
  readonly terminalControlOutboxes: Map<string, MatrixCorpusTerminalControlOutboxRecordV1>;
}

interface FakeMatrixCorpusDeferredGate {
  readonly entered: Promise<void>;
  readonly awaitRelease: Promise<void>;
  enter(): void;
  release(): void;
}

export interface FakeMatrixCorpusDeferredGateControl {
  readonly entered: Promise<void>;
  release(): void;
}

export interface FakeMatrixCorpusCoreLeaseSummary {
  readonly runId: string;
  readonly userId: string;
  readonly runFenceDigest: string;
  readonly phase: MatrixCorpusLeasePhase;
  readonly leaseFence: string;
  readonly fenceEpoch: string;
  readonly acquiredAt: string;
  readonly activatedAt: string | null;
  readonly renewedAt: string;
  readonly expiresAt: string;
  readonly acquireReceiptKeyDigest: string;
  readonly activateReceiptKeyDigest: string | null;
  readonly renewReceiptIds: readonly string[];
  readonly quiescedAt: string | null;
  readonly releasedAt: string | null;
  readonly abandonedAt: string | null;
  readonly capabilityIssuanceReceiptIds: readonly string[];
  readonly unconsumedCapability: Readonly<{
    digest: string;
    phase: MatrixCorpusCapabilityPhase;
  }> | null;
  readonly capabilityDigests: readonly string[];
  readonly terminalFailureReceiptRefs: readonly Readonly<{
    transportReceiptId: string;
    capabilityDigest: string;
  }>[];
  readonly nonterminalIngestOutboxIds: readonly string[];
  readonly ingestOutboxIds: readonly string[];
  readonly transportReceiptIds: readonly string[];
  readonly terminalControlOutboxIds: readonly string[];
  readonly terminalWinner: MatrixCorpusTerminalAuthoritativeWinnerV1 | null;
  readonly cleanupProgress: MatrixCorpusCleanupProgressV1 | null;
  readonly priorFinalCleanupReceipts: readonly MatrixCorpusCleanupChunkReceiptV1[];
  readonly finalCleanupReceipt: MatrixCorpusCleanupChunkReceiptV1 | null;
  readonly drain: Readonly<{
    consumedCapabilityCount: number;
    terminalIntexMarkerCount: number;
    terminalOutboxCount: number;
    replyOrDeliveryWorkInFlight: number;
    drained: boolean;
  }>;
}

export interface FakeMatrixCorpusCoreStateSummary {
  readonly version: number;
  readonly current: readonly Readonly<{
    leaseSlotDigest: string;
    lease: FakeMatrixCorpusCoreLeaseSummary;
  }>[];
  readonly histories: readonly FakeMatrixCorpusCoreLeaseSummary[];
  readonly renewReceipts: readonly Readonly<{
    runFenceDigest: string;
    idempotencyKeyDigest: string;
    canonicalRequestDigest: string;
    replayExpiresAt: string;
  }>[];
  readonly issuanceReceipts: readonly Readonly<{
    runFenceDigest: string;
    matrixIdempotencyKeyDigest: string;
    issueRequestDigest: string;
    capabilityDigest: string;
    resultDigest: string;
    replayIssuedAt: string;
    replayExpiresAt: string;
  }>[];
  readonly capabilities: readonly Readonly<{
    capabilityDigest: string;
    runId: string;
    userId: string;
    leaseFence: string;
    scenarioId: string;
    phase: MatrixCorpusCapabilityPhase;
    turnIndex: number;
    issuedAt: string;
    expiresAt: string;
    consumedAt: string | null;
    consumedTransportMessageIdDigest: string | null;
    ingestOutboxId: string | null;
    revokedAt: string | null;
  }>[];
  readonly transportReceipts: readonly Readonly<{
    transportMessageIdDigest: string;
    capabilityDigest: string;
    runId: string;
    userId: string;
    leaseFence: string;
    promptDigest: string;
    ingressRequestDigest: string;
    ingestReceiptId: string | null;
    ingestOutboxId: string | null;
    acceptedAt: string | null;
    recordedAt: string;
    terminalFailureCode: MatrixCorpusTransportReceiptV1['terminalFailureCode'];
  }>[];
  readonly ingestOutboxes: readonly Readonly<{
    ingestOutboxId: string;
    ingestReceiptId: string;
    runId: string;
    userId: string;
    leaseFence: string;
    payloadDigest: string;
    status: MatrixCorpusOutboxStatus;
    claimOwnerDigest: string | null;
    claimPurpose: 'publish' | 'terminal_marker_recovery' | null;
    claimClaimedAt: string | null;
    claimExpiresAt: string | null;
    publisherReceiptDigest: string | null;
    publishedAt: string | null;
    terminalMarkerKind: 'completed' | 'failed' | null;
    terminalMarker: Readonly<{ kind: 'completed' | 'failed'; digest: string; recordedAt: string }> | null;
    closedReason: 'quiesced' | 'abandoned' | 'capability_replay' | null;
    acknowledgementReceipts: readonly MatrixCorpusIngestAcknowledgementReceiptV1[];
    lastClaimRenewal: MatrixCorpusIngestClaimRenewalV1 | null;
    closedAt: string | null;
    createdAt: string;
  }>[];
  readonly terminalControlOutboxes: readonly Readonly<{
    terminalControlId: string;
    eventId: string;
    runId: string;
    userId: string;
    leaseFence: string;
    kind: MatrixCorpusTerminalKind;
    payloadDigest: string;
    status: MatrixCorpusOutboxStatus;
    claim: Readonly<{
      ownerDigest: string;
      purpose: 'publish';
      claimedAt: string;
      expiresAt: string;
    }> | null;
    acknowledgedAt: string | null;
    closedReason: 'expired_unclaimed_release' | 'superseded_by_authoritative_winner' | null;
    lastClaimRenewal: MatrixCorpusTerminalClaimRenewalV1 | null;
    closedAt: string | null;
    createdAt: string;
  }>[];
}

export interface FakeMatrixCorpusIssueConsumeSeed {
  readonly pair: MatrixCorpusCurrentLeaseHistoryPairV1;
  readonly renewReceipts: readonly MatrixCorpusRenewReceiptV1[];
  readonly issuanceReceipts: readonly MatrixCorpusCapabilityIssuanceReceiptV1[];
  readonly capabilities: readonly MatrixCorpusCapabilityV1[];
  readonly transportReceipts: readonly MatrixCorpusTransportReceiptV1[];
  readonly ingestOutboxes: readonly MatrixCorpusIngestOutboxRecordV1[];
}

export interface FakeMatrixCorpusLifecycleSeed extends FakeMatrixCorpusIssueConsumeSeed {
  readonly terminalControlOutboxes: readonly MatrixCorpusTerminalControlOutboxRecordV1[];
}

export interface FakeMatrixCorpusAddressedRenewReceiptSeed {
  readonly runFenceDigest: string;
  readonly receipt: MatrixCorpusRenewReceiptV1;
}

export interface FakeMatrixCorpusAddressedIssuanceReceiptSeed {
  readonly runFenceDigest: string;
  readonly receipt: MatrixCorpusCapabilityIssuanceReceiptV1;
}

export interface FakeMatrixCorpusCleanupOutboxSeed {
  readonly currentPair: MatrixCorpusCurrentLeaseHistoryPairV1;
  readonly retainedHistories: readonly MatrixCorpusLeaseHistoryV1[];
  readonly renewReceipts: readonly FakeMatrixCorpusAddressedRenewReceiptSeed[];
  readonly issuanceReceipts: readonly FakeMatrixCorpusAddressedIssuanceReceiptSeed[];
  readonly capabilities: readonly MatrixCorpusCapabilityV1[];
  readonly transportReceipts: readonly MatrixCorpusTransportReceiptV1[];
  readonly ingestOutboxes: readonly MatrixCorpusIngestOutboxRecordV1[];
  readonly terminalControlOutboxes: readonly MatrixCorpusTerminalControlOutboxRecordV1[];
}

export class FakeMatrixCorpusRepositoryFault extends Error {
  public constructor() {
    super('FAKE_MATRIX_CORPUS_REPOSITORY_FAULT');
    this.name = 'FakeMatrixCorpusRepositoryFault';
  }
}

function newState(): FakeMatrixCorpusCoreState {
  return {
    version: 0,
    leaseSlots: new Map<string, MatrixCorpusLeaseV1>(),
    leaseHistories: new Map<string, MatrixCorpusLeaseHistoryV1>(),
    renewReceiptsByRun: new Map<string, Map<string, MatrixCorpusRenewReceiptV1>>(),
    capabilityIssuanceReceiptsByRun: new Map<
      string,
      Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>
    >(),
    capabilities: new Map<string, MatrixCorpusCapabilityV1>(),
    transportReceipts: new Map<string, MatrixCorpusTransportReceiptV1>(),
    ingestOutboxes: new Map<string, MatrixCorpusIngestOutboxRecordV1>(),
    terminalControlOutboxes: new Map<string, MatrixCorpusTerminalControlOutboxRecordV1>(),
  };
}

function newGate(): FakeMatrixCorpusDeferredGate {
  let enter = (): void => undefined;
  let release = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const awaitRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { entered, awaitRelease, enter, release };
}

function operationCounts(): Map<FakeMatrixCorpusCoreOperation, { invocations: number; commits: number }> {
  return new Map<FakeMatrixCorpusCoreOperation, { invocations: number; commits: number }>([
    ['acquire', { invocations: 0, commits: 0 }],
    ['activate', { invocations: 0, commits: 0 }],
    ['renew', { invocations: 0, commits: 0 }],
    ['issue', { invocations: 0, commits: 0 }],
    ['consume', { invocations: 0, commits: 0 }],
    ['quiesce', { invocations: 0, commits: 0 }],
    ['release', { invocations: 0, commits: 0 }],
    ['abandon', { invocations: 0, commits: 0 }],
    ['cleanup', { invocations: 0, commits: 0 }],
    ['claim_ingest', { invocations: 0, commits: 0 }],
    ['renew_ingest_claim', { invocations: 0, commits: 0 }],
    ['acknowledge_ingest', { invocations: 0, commits: 0 }],
    ['claim_terminal', { invocations: 0, commits: 0 }],
    ['renew_terminal_claim', { invocations: 0, commits: 0 }],
    ['acknowledge_terminal', { invocations: 0, commits: 0 }],
    ['status', { invocations: 0, commits: 0 }],
  ]);
}

function compareBytewise(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function firstSortedMapEntry<T>(entries: ReadonlyMap<string, T>): readonly [string, T] | null {
  const first = [...entries.entries()].sort(([left], [right]) => compareBytewise(left, right))[0];
  return first === undefined ? null : first;
}

function parseEpochMilliseconds(timestamp: string): number | null {
  const parsed = matrixCorpusRfc3339TimestampSchema.safeParse(timestamp);
  if (!parsed.success) return null;
  const milliseconds = Date.parse(parsed.data);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function gateQueues(): Map<FakeMatrixCorpusCoreOperation, FakeMatrixCorpusDeferredGate[]> {
  return new Map<FakeMatrixCorpusCoreOperation, FakeMatrixCorpusDeferredGate[]>([
    ['acquire', []],
    ['activate', []],
    ['renew', []],
    ['issue', []],
    ['consume', []],
    ['quiesce', []],
    ['release', []],
    ['abandon', []],
    ['cleanup', []],
    ['claim_ingest', []],
    ['renew_ingest_claim', []],
    ['acknowledge_ingest', []],
    ['claim_terminal', []],
    ['renew_terminal_claim', []],
    ['acknowledge_terminal', []],
    ['status', []],
  ]);
}

function mutationGateQueues(): Map<FakeMatrixCorpusMutationOperation, FakeMatrixCorpusDeferredGate[]> {
  return new Map<FakeMatrixCorpusMutationOperation, FakeMatrixCorpusDeferredGate[]>([
    ['acquire', []],
    ['activate', []],
    ['renew', []],
    ['issue', []],
    ['consume', []],
    ['quiesce', []],
    ['release', []],
    ['abandon', []],
    ['cleanup', []],
    ['claim_ingest', []],
    ['renew_ingest_claim', []],
    ['acknowledge_ingest', []],
    ['claim_terminal', []],
    ['renew_terminal_claim', []],
    ['acknowledge_terminal', []],
  ]);
}

function leaseSummary(lease: MatrixCorpusLeaseV1): FakeMatrixCorpusCoreLeaseSummary {
  const acquire = lease.operationReceipts.acquire;
  if (acquire === null) throw new FakeMatrixCorpusRepositoryFault();
  return {
    runId: lease.runId,
    userId: lease.userId,
    runFenceDigest: lease.runFenceDigest,
    phase: lease.phase,
    leaseFence: lease.leaseFence,
    fenceEpoch: lease.fenceEpoch,
    acquiredAt: lease.acquiredAt,
    activatedAt: lease.activatedAt,
    renewedAt: lease.renewedAt,
    expiresAt: lease.expiresAt,
    releasedAt: lease.releasedAt,
    abandonedAt: lease.abandonedAt,
    acquireReceiptKeyDigest: acquire.idempotencyKeyDigest,
    activateReceiptKeyDigest: lease.operationReceipts.activate?.idempotencyKeyDigest ?? null,
    renewReceiptIds: [...lease.renewReceiptIds],
    quiescedAt: lease.quiescedAt,
    capabilityIssuanceReceiptIds: [...lease.capabilityIssuanceReceiptIds],
    unconsumedCapability: lease.unconsumedCapability,
    capabilityDigests: [...lease.capabilityDigests],
    terminalFailureReceiptRefs: [...lease.terminalFailureReceiptRefs],
    nonterminalIngestOutboxIds: [...lease.nonterminalIngestOutboxIds],
    ingestOutboxIds: [...lease.ingestOutboxIds],
    transportReceiptIds: [...lease.transportReceiptIds],
    terminalControlOutboxIds: [...lease.terminalControlOutboxIds],
    terminalWinner: structuredClone(lease.terminalWinner),
    cleanupProgress: structuredClone(lease.cleanupProgress),
    priorFinalCleanupReceipts: structuredClone(lease.priorFinalCleanupReceipts ?? []),
    finalCleanupReceipt: structuredClone(lease.finalCleanupReceipt),
    drain: lease.drain,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deeplyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => deeplyEqual(value, right[index]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareBytewise);
  const rightKeys = Object.keys(right).sort(compareBytewise);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deeplyEqual(left[key], right[key]))
  );
}

function hasExactMapKeys<T>(expected: readonly string[], values: ReadonlyMap<string, T>): boolean {
  return expected.length === values.size && expected.every((key) => values.has(key));
}

function hasExactItems(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length && expected.every((value) => actual.includes(value));
}

function hasLeaseIdentity(
  history: MatrixCorpusLeaseHistoryV1,
  child: Readonly<{ runId: string; userId: string; leaseFence: string }>
): boolean {
  return (
    child.runId === history.runId && child.userId === history.userId && child.leaseFence === history.leaseFence
  );
}

function isIssueConsumeSeedCorrelated(
  history: MatrixCorpusLeaseHistoryV1,
  issuanceReceipts: ReadonlyMap<string, MatrixCorpusCapabilityIssuanceReceiptV1>,
  capabilities: ReadonlyMap<string, MatrixCorpusCapabilityV1>,
  transportReceipts: ReadonlyMap<string, MatrixCorpusTransportReceiptV1>,
  ingestOutboxes: ReadonlyMap<string, MatrixCorpusIngestOutboxRecordV1>
): boolean {
  for (const receipt of issuanceReceipts.values()) {
    const capability = capabilities.get(receipt.capabilityDigest);
    if (
      capability === undefined ||
      capability.matrixIdempotencyKeyDigest !== receipt.matrixIdempotencyKeyDigest ||
      capability.issueRequestDigest !== receipt.issueRequestDigest ||
      capability.runId !== receipt.runId ||
      capability.userId !== receipt.userId ||
      capability.leaseFence !== receipt.leaseFence ||
      capability.scenarioId !== receipt.scenarioId ||
      capability.phase !== receipt.phase ||
      capability.turnIndex !== receipt.turnIndex ||
      capability.issuedAt !== receipt.recordedAt ||
      receipt.replayProjection.operation !== 'issue' ||
      capability.expiresAt !== receipt.replayProjection.expiresAt
    )
      return false;
  }
  if ([...capabilities.keys()].some((capabilityDigest) => ![...issuanceReceipts.values()].some((receipt) => receipt.capabilityDigest === capabilityDigest)))
    return false;
  const outstandingCapabilities = [...capabilities.values()].filter(
    (capability) => capability.consumedAt === null && capability.revokedAt === null
  );
  if (
    outstandingCapabilities.length > 1 ||
    (outstandingCapabilities.length === 0 && history.unconsumedCapability !== null)
  )
    return false;
  const outstandingCapability = outstandingCapabilities[0];
  if (
    outstandingCapability !== undefined &&
    (history.unconsumedCapability?.digest !== outstandingCapability.capabilityDigest ||
      history.unconsumedCapability.phase !== outstandingCapability.phase)
  )
    return false;
  const terminalReferences = new Map<string, number>();
  for (const receipt of transportReceipts.values()) {
    const capability = capabilities.get(receipt.capabilityDigest);
    if (
      capability === undefined ||
      (receipt.acceptedAt !== null && receipt.promptDigest !== capability.promptDigest)
    )
      return false;
    if (receipt.acceptedAt !== null) {
      const outbox = receipt.ingestOutboxId === null ? undefined : ingestOutboxes.get(receipt.ingestOutboxId);
      if (
        outbox === undefined ||
        receipt.ingestReceiptId === null ||
        capability.consumedAt !== receipt.acceptedAt ||
        capability.consumedTransportMessageIdDigest !== receipt.transportMessageIdDigest ||
        capability.ingestOutboxId !== receipt.ingestOutboxId ||
        receipt.recordedAt !== receipt.acceptedAt ||
        outbox.ingestReceiptId !== receipt.ingestReceiptId ||
        outbox.createdAt !== receipt.acceptedAt
      )
        return false;
      continue;
    }
    if (receipt.terminalFailureCode === null) return false;
    const references = history.terminalFailureReceiptRefs.filter(
      (reference) =>
        reference.transportReceiptId === receipt.transportMessageIdDigest &&
        reference.capabilityDigest === receipt.capabilityDigest
    );
    if (references.length !== 1) return false;
    terminalReferences.set(receipt.capabilityDigest, (terminalReferences.get(receipt.capabilityDigest) ?? 0) + 1);
  }
  for (const capability of capabilities.values()) {
    if (capability.consumedAt === null) continue;
    const acceptedReceipts = [...transportReceipts.values()].filter(
      (receipt) =>
        receipt.acceptedAt !== null &&
        receipt.capabilityDigest === capability.capabilityDigest &&
        receipt.transportMessageIdDigest === capability.consumedTransportMessageIdDigest &&
        receipt.ingestOutboxId === capability.ingestOutboxId
    );
    if (acceptedReceipts.length !== 1) return false;
  }
  for (const outbox of ingestOutboxes.values()) {
    const acceptedReceipts = [...transportReceipts.values()].filter(
      (receipt) =>
        receipt.acceptedAt !== null &&
        receipt.ingestOutboxId === outbox.ingestOutboxId &&
        receipt.ingestReceiptId === outbox.ingestReceiptId
    );
    if (acceptedReceipts.length !== 1) return false;
  }
  if (
    history.terminalFailureReceiptRefs.some(
      (reference) => {
        const receipt = transportReceipts.get(reference.transportReceiptId);
        return (
          receipt === undefined ||
          receipt.terminalFailureCode === null ||
          receipt.capabilityDigest !== reference.capabilityDigest ||
          !capabilities.has(reference.capabilityDigest)
        );
      }
    ) ||
    [...terminalReferences.values()].some((count) => count > 2) ||
    history.terminalFailureReceiptRefs.length > 64
  )
    return false;
  const nonterminal = [...ingestOutboxes.values()]
    .filter((outbox) => outbox.status !== 'closed')
    .map((outbox) => outbox.ingestOutboxId);
  return hasExactItems(history.nonterminalIngestOutboxIds, nonterminal);
}

function hasCapabilityAuthority(lease: MatrixCorpusLeaseV1, capability: MatrixCorpusCapabilityV1): boolean {
  return (
    capability.runtimeAudience === lease.runtimeAudience &&
    capability.runId === lease.runId &&
    capability.userId === lease.userId &&
    capability.leaseFence === lease.leaseFence &&
    capability.matrixRoomBindingDigest === lease.matrixRoomBindingDigest &&
    capability.whatsappAccountBindingDigest === lease.whatsappAccountBindingDigest &&
    capability.whatsappSenderBindingDigest === lease.whatsappSenderBindingDigest
  );
}

function hasConsumeAuthority(
  lease: MatrixCorpusLeaseV1,
  command: ConsumeCapabilityAndEnqueueIngestCommand
): boolean {
  const context = command.facts.payload.context;
  const ingress = command.facts.ingressRequest;
  return (
    lease.runFenceDigest === command.runFenceDigest &&
    context.runtimeAudience === lease.runtimeAudience &&
    context.runId === lease.runId &&
    command.facts.payload.ordinaryIngest.userId === lease.userId &&
    context.leaseFence === lease.leaseFence &&
    ingress.userId === lease.userId &&
    ingress.matrixRoomBindingDigest === lease.matrixRoomBindingDigest &&
    ingress.whatsappAccountBindingDigest === lease.whatsappAccountBindingDigest &&
    ingress.whatsappSenderBindingDigest === lease.whatsappSenderBindingDigest
  );
}

function matchesCapabilityFacts(
  capability: MatrixCorpusCapabilityV1,
  facts: MatrixCorpusCapabilityConsumeFactsV1
): boolean {
  const context = facts.payload.context;
  const ingress = facts.ingressRequest;
  return (
    capability.runtimeAudience === context.runtimeAudience &&
    capability.runId === context.runId &&
    capability.userId === facts.payload.ordinaryIngest.userId &&
    capability.leaseFence === context.leaseFence &&
    capability.matrixRoomBindingDigest === ingress.matrixRoomBindingDigest &&
    capability.whatsappAccountBindingDigest === ingress.whatsappAccountBindingDigest &&
    capability.whatsappSenderBindingDigest === ingress.whatsappSenderBindingDigest &&
    capability.scenarioId === context.scenarioId &&
    capability.scenarioNumber === context.scenarioNumber &&
    capability.scenarioLabel === context.scenarioLabel &&
    capability.promptNormalizationVersion === context.promptNormalizationVersion &&
    capability.promptDigest === context.promptDigest &&
    capability.phase === context.phase &&
    capability.turnIndex === context.turnIndex &&
    capability.expectedSessionId === context.expectedSessionId &&
    capability.pendingConfirmationId === context.pendingConfirmationId &&
    capability.expectedDecision === context.expectedDecision &&
    deeplyEqual(capability.mockProfile, context.mockProfile) &&
    capability.mockProfileDigest === context.mockProfileDigest &&
    capability.currentDateTime === context.currentDateTime &&
    capability.timeZone === context.timeZone &&
    ingress.promptDigest === capability.promptDigest &&
    ingress.expectedSessionId === capability.expectedSessionId &&
    ingress.pendingConfirmationId === capability.pendingConfirmationId &&
    ingress.expectedDecision === capability.expectedDecision
  );
}

function hasDrainedLeaseState(lease: MatrixCorpusLeaseV1): boolean {
  return (
    lease.phase === 'quiescing' &&
    lease.unconsumedCapability === null &&
    lease.nonterminalIngestOutboxIds.length === 0 &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalIntexMarkerCount &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalOutboxCount &&
    lease.drain.replyOrDeliveryWorkInFlight === 0
  );
}

function isLifecycleTerminalStateCorrelated(
  history: MatrixCorpusLeaseHistoryV1,
  terminalControlOutboxes: ReadonlyMap<string, MatrixCorpusTerminalControlOutboxRecordV1>
): boolean {
  if (history.terminalWinner !== null || history.releasedAt !== null || history.abandonedAt !== null)
    return false;
  if (!hasExactMapKeys(history.terminalControlOutboxIds, terminalControlOutboxes)) return false;
  const records = [...terminalControlOutboxes.entries()].map(([terminalControlId, stored]) => {
    const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(stored);
    if (
      !parsed.success ||
      terminalControlId !== parsed.data.terminalControlId ||
      !hasLeaseIdentity(history, parsed.data) ||
      parsed.data.status === 'published' ||
      !history.terminalControlOutboxIds.includes(terminalControlId)
    )
      return null;
    return parsed.data;
  });
  if (records.some((record) => record === null)) return false;
  const correlated = records.filter(
    (record): record is MatrixCorpusTerminalControlOutboxRecordV1 => record !== null
  );
  const nonclosed = correlated.filter((record) => record.status === 'pending' || record.status === 'claimed');
  const releases = correlated.filter((record) => record.kind === 'release');
  const abandoned = correlated.filter((record) => record.kind === 'abandoned');
  if (history.phase === 'provisioning' || history.phase === 'active' || history.phase === 'quiescing')
    return correlated.length === 0;
  if (history.phase === 'release_pending') {
    const receipt = history.operationReceipts.release;
    return (
      correlated.length === 1 &&
      releases.length === 1 &&
      abandoned.length === 0 &&
      nonclosed.length === 1 &&
      receipt !== null &&
      receipt.replayProjection.operation === 'release' &&
      receipt.replayProjection.result === 'release_pending' &&
      releases[0]?.terminalControlId === receipt.replayProjection.terminalControlId &&
      releases[0]?.eventId === receipt.replayProjection.eventId &&
      releases[0]?.createdAt === receipt.replayProjection.createdAt
    );
  }
  if (history.phase === 'abandon_pending') {
    const abandonedRecord = abandoned[0];
    const release = releases[0];
    const validRelease =
      release === undefined ||
      (release.status === 'pending' ||
        release.status === 'claimed' ||
        (release.status === 'closed' &&
          release.claim === null &&
          release.acknowledgedAt === null &&
          release.lastClaimRenewal === null &&
          release.closedReason === 'expired_unclaimed_release'));
    return (
      abandoned.length === 1 &&
      abandonedRecord !== undefined &&
      (abandonedRecord.status === 'pending' || abandonedRecord.status === 'claimed') &&
      releases.length <= 1 &&
      validRelease &&
      nonclosed.includes(abandonedRecord)
    );
  }
  return false;
}

export class FakeMatrixCorpusRepository implements MatrixCorpusRepository {
  private state = newState();
  private mutexTail: Promise<void> = Promise.resolve();
  private readonly beforeAdmissionGates = gateQueues();
  private readonly afterCommitGates = mutationGateQueues();
  private readonly faultStages = new Set<FakeMatrixCorpusCoreFaultStage>();
  private readonly responseLossOperations = new Set<FakeMatrixCorpusCoreOperation>();
  private readonly counts = operationCounts();

  public constructor(private readonly dependencies: MatrixCorpusRepositoryDependencies) {}

  public deferNextBeforeAdmission(
    operation: FakeMatrixCorpusCoreOperation
  ): FakeMatrixCorpusDeferredGateControl {
    const gate = newGate();
    const queue = this.beforeAdmissionGates.get(operation);
    if (queue === undefined) throw new FakeMatrixCorpusRepositoryFault();
    queue.push(gate);
    return { entered: gate.entered, release: () => gate.release() };
  }

  public deferNextAfterCommit(operation: FakeMatrixCorpusMutationOperation): FakeMatrixCorpusDeferredGateControl {
    const gate = newGate();
    const queue = this.afterCommitGates.get(operation);
    if (queue === undefined) throw new FakeMatrixCorpusRepositoryFault();
    queue.push(gate);
    return { entered: gate.entered, release: () => gate.release() };
  }

  public failNextAt(stage: FakeMatrixCorpusCoreFaultStage): void {
    this.faultStages.add(stage);
  }

  public loseNextResponseAfterCommit(operation: FakeMatrixCorpusCoreOperation): void {
    this.responseLossOperations.add(operation);
  }

  public operationCounts(
    operation: FakeMatrixCorpusCoreOperation
  ): Readonly<{ invocations: number; commits: number }> {
    const counts = this.counts.get(operation);
    if (counts === undefined) throw new FakeMatrixCorpusRepositoryFault();
    return structuredClone(counts);
  }

  public safeStateSummary(): FakeMatrixCorpusCoreStateSummary {
    const current = [...this.state.leaseSlots.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([leaseSlotDigest, lease]) => ({ leaseSlotDigest, lease: leaseSummary(lease) }));
    const histories = [...this.state.leaseHistories.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([, history]) => leaseSummary(history));
    const renewReceipts = [...this.state.renewReceiptsByRun.entries()]
      .flatMap(([runFenceDigest, receipts]) =>
        [...receipts.entries()].map(([idempotencyKeyDigest, receipt]) => {
          const projection = receipt.replayProjection;
          if (projection.operation !== 'renew' || projection.result !== 'renewed')
            throw new FakeMatrixCorpusRepositoryFault();
          return {
            runFenceDigest,
            idempotencyKeyDigest,
            canonicalRequestDigest: receipt.canonicalRequestDigest,
            replayExpiresAt: projection.expiresAt,
          };
        })
      )
      .sort((left, right) => {
        const byRun = compareBytewise(left.runFenceDigest, right.runFenceDigest);
        return byRun === 0 ? compareBytewise(left.idempotencyKeyDigest, right.idempotencyKeyDigest) : byRun;
      });
    const issuanceReceipts = [...this.state.capabilityIssuanceReceiptsByRun.entries()]
      .flatMap(([runFenceDigest, receipts]) =>
        [...receipts.entries()].map(([matrixIdempotencyKeyDigest, receipt]) => {
          const projection = receipt.replayProjection;
          if (projection.operation !== 'issue' || projection.result !== 'issued')
            throw new FakeMatrixCorpusRepositoryFault();
          return {
            runFenceDigest,
            matrixIdempotencyKeyDigest,
            issueRequestDigest: receipt.issueRequestDigest,
            capabilityDigest: receipt.capabilityDigest,
            resultDigest: receipt.resultDigest,
            replayIssuedAt: projection.issuedAt,
            replayExpiresAt: projection.expiresAt,
          };
        })
      )
      .sort((left, right) => {
        const byRun = compareBytewise(left.runFenceDigest, right.runFenceDigest);
        return byRun === 0
          ? compareBytewise(left.matrixIdempotencyKeyDigest, right.matrixIdempotencyKeyDigest)
          : byRun;
      });
    const capabilities = [...this.state.capabilities.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([capabilityDigest, capability]) => ({
        capabilityDigest,
        runId: capability.runId,
        userId: capability.userId,
        leaseFence: capability.leaseFence,
        scenarioId: capability.scenarioId,
        phase: capability.phase,
        turnIndex: capability.turnIndex,
        issuedAt: capability.issuedAt,
        expiresAt: capability.expiresAt,
        consumedAt: capability.consumedAt,
        consumedTransportMessageIdDigest: capability.consumedTransportMessageIdDigest,
        ingestOutboxId: capability.ingestOutboxId,
        revokedAt: capability.revokedAt,
      }));
    const transportReceipts = [...this.state.transportReceipts.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([transportMessageIdDigest, receipt]) => ({
        transportMessageIdDigest,
        capabilityDigest: receipt.capabilityDigest,
        runId: receipt.runId,
        userId: receipt.userId,
        leaseFence: receipt.leaseFence,
        promptDigest: receipt.promptDigest,
        ingressRequestDigest: receipt.ingressRequestDigest,
        ingestReceiptId: receipt.ingestReceiptId,
        ingestOutboxId: receipt.ingestOutboxId,
        acceptedAt: receipt.acceptedAt,
        recordedAt: receipt.recordedAt,
        terminalFailureCode: receipt.terminalFailureCode,
      }));
    const ingestOutboxes = [...this.state.ingestOutboxes.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([ingestOutboxId, outbox]) => ({
        ingestOutboxId,
        ingestReceiptId: outbox.ingestReceiptId,
        runId: outbox.runId,
        userId: outbox.userId,
        leaseFence: outbox.leaseFence,
        payloadDigest: outbox.payloadDigest,
        status: outbox.status,
        claimOwnerDigest: outbox.claim?.ownerDigest ?? null,
        claimPurpose: outbox.claim?.purpose ?? null,
        claimClaimedAt: outbox.claim?.claimedAt ?? null,
        claimExpiresAt: outbox.claim?.expiresAt ?? null,
        publisherReceiptDigest: outbox.publisherReceiptDigest,
        publishedAt: outbox.publishedAt,
        terminalMarkerKind: outbox.terminalMarker?.kind ?? null,
        terminalMarker: structuredClone(outbox.terminalMarker),
        closedReason: outbox.closedReason,
        acknowledgementReceipts: structuredClone(outbox.acknowledgementReceipts),
        lastClaimRenewal: structuredClone(outbox.lastClaimRenewal),
        closedAt: outbox.closedAt,
        createdAt: outbox.createdAt,
      }));
    const terminalControlOutboxes = [...this.state.terminalControlOutboxes.entries()]
      .sort(([left], [right]) => compareBytewise(left, right))
      .map(([terminalControlId, outbox]) => ({
        terminalControlId,
        eventId: outbox.eventId,
        runId: outbox.runId,
        userId: outbox.userId,
        leaseFence: outbox.leaseFence,
        kind: outbox.kind,
        payloadDigest: outbox.payloadDigest,
        status: outbox.status,
        claim:
          outbox.claim === null
            ? null
            : {
                ownerDigest: outbox.claim.ownerDigest,
                purpose: 'publish' as const,
                claimedAt: outbox.claim.claimedAt,
                expiresAt: outbox.claim.expiresAt,
              },
        acknowledgedAt: outbox.acknowledgedAt,
        closedReason: outbox.closedReason,
        lastClaimRenewal: structuredClone(outbox.lastClaimRenewal),
        closedAt: outbox.closedAt,
        createdAt: outbox.createdAt,
      }));
    return structuredClone({
      version: this.state.version,
      current,
      histories,
      renewReceipts,
      issuanceReceipts,
      capabilities,
      transportReceipts,
      ingestOutboxes,
      terminalControlOutboxes,
    });
  }

  public hasExactPrivateIngestPayload(
    ingestOutboxId: string,
    expectedPayload: MatrixCorpusAttestedIngestPayloadV1
  ): boolean {
    const payload = matrixCorpusAttestedIngestPayloadV1Schema.safeParse(expectedPayload);
    if (!payload.success) return false;
    const outbox = this.state.ingestOutboxes.get(ingestOutboxId);
    return outbox !== undefined && deeplyEqual(outbox.payload, payload.data);
  }

  public corruptIssueConsumeInvariantForTest(invariant: FakeMatrixCorpusIssueConsumeInvariantForTest): void {
    const draft = structuredClone(this.state);
    const slot = firstSortedMapEntry(draft.leaseSlots);
    if (slot === null) throw new FakeMatrixCorpusRepositoryFault();
    const [leaseSlotDigest] = slot;
    const current = this.readCurrentPair(draft, leaseSlotDigest);
    if (current.kind !== 'found') throw new FakeMatrixCorpusRepositoryFault();
    const syntheticDigest = 'f'.repeat(64);
    const writeLeaseMirrors = (lease: MatrixCorpusLeaseV1): void => {
      draft.leaseSlots.set(leaseSlotDigest, lease);
      draft.leaseHistories.set(lease.runFenceDigest, { leaseSlotDigest, ...lease });
    };

    if (invariant === 'candidate_capability_intrinsic_digest_map_key') {
      const entry = firstSortedMapEntry(draft.capabilities);
      if (entry === null || draft.capabilities.has(syntheticDigest)) throw new FakeMatrixCorpusRepositoryFault();
      const [capabilityDigest, capability] = entry;
      if (capabilityDigest === syntheticDigest) throw new FakeMatrixCorpusRepositoryFault();
      draft.capabilities.delete(capabilityDigest);
      draft.capabilities.set(syntheticDigest, capability);
    } else if (invariant === 'candidate_capability_history_membership') {
      const entry = firstSortedMapEntry(draft.capabilities);
      if (entry === null || !current.pair.current.capabilityDigests.includes(entry[0]))
        throw new FakeMatrixCorpusRepositoryFault();
      writeLeaseMirrors({
        ...current.pair.current,
        capabilityDigests: current.pair.current.capabilityDigests.filter((digest) => digest !== entry[0]),
      });
    } else if (invariant === 'history_transport_reference_missing_receipt') {
      const entry = firstSortedMapEntry(draft.transportReceipts);
      if (entry === null || !current.pair.current.transportReceiptIds.includes(entry[0]))
        throw new FakeMatrixCorpusRepositoryFault();
      draft.transportReceipts.delete(entry[0]);
    } else if (invariant === 'replay_safety_pointed_capability_intrinsic_digest_map_key') {
      const pointer = current.pair.current.unconsumedCapability;
      if (pointer === null || draft.capabilities.has(syntheticDigest)) throw new FakeMatrixCorpusRepositoryFault();
      const pointedCapability = draft.capabilities.get(pointer.digest);
      if (pointedCapability === undefined || pointedCapability.capabilityDigest !== pointer.digest)
        throw new FakeMatrixCorpusRepositoryFault();
      draft.capabilities.delete(pointer.digest);
      draft.capabilities.set(syntheticDigest, pointedCapability);
      writeLeaseMirrors({
        ...current.pair.current,
        unconsumedCapability: { ...pointer, digest: syntheticDigest },
        capabilityDigests: current.pair.current.capabilityDigests.map((capabilityDigest) =>
          capabilityDigest === pointer.digest ? syntheticDigest : capabilityDigest
        ),
      });
    } else if (invariant === 'replay_safety_pointed_capability_phase') {
      const pointer = current.pair.current.unconsumedCapability;
      const pointedCapability = pointer === null ? undefined : draft.capabilities.get(pointer.digest);
      if (pointer === null || pointedCapability === undefined) throw new FakeMatrixCorpusRepositoryFault();
      const mismatchedPhase: MatrixCorpusCapabilityPhase = pointedCapability.phase === 'start' ? 'turn' : 'start';
      writeLeaseMirrors({
        ...current.pair.current,
        unconsumedCapability: { ...pointer, phase: mismatchedPhase },
      });
    } else if (invariant === 'pending_outbox_nonterminal_membership') {
      const pendingOutboxId = current.pair.current.ingestOutboxIds.find((ingestOutboxId) => {
        const outbox = draft.ingestOutboxes.get(ingestOutboxId);
        return outbox?.status === 'pending';
      });
      if (
        pendingOutboxId === undefined ||
        !current.pair.current.nonterminalIngestOutboxIds.includes(pendingOutboxId)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      writeLeaseMirrors({
        ...current.pair.current,
        nonterminalIngestOutboxIds: current.pair.current.nonterminalIngestOutboxIds.filter(
          (ingestOutboxId) => ingestOutboxId !== pendingOutboxId
        ),
      });
    } else {
      const reference = current.pair.current.terminalFailureReceiptRefs[0];
      if (reference === undefined) throw new FakeMatrixCorpusRepositoryFault();
      const receipt = draft.transportReceipts.get(reference.transportReceiptId);
      if (receipt === undefined || receipt.terminalFailureCode === null) throw new FakeMatrixCorpusRepositoryFault();
      if (invariant === 'terminal_failure_reference_missing_receipt') {
        if (draft.transportReceipts.has(syntheticDigest)) throw new FakeMatrixCorpusRepositoryFault();
        writeLeaseMirrors({
          ...current.pair.current,
          transportReceiptIds: current.pair.current.transportReceiptIds.map((transportReceiptId) =>
            transportReceiptId === reference.transportReceiptId ? syntheticDigest : transportReceiptId
          ),
          terminalFailureReceiptRefs: current.pair.current.terminalFailureReceiptRefs.map((candidate) =>
            candidate.transportReceiptId === reference.transportReceiptId
              ? { ...candidate, transportReceiptId: syntheticDigest }
              : candidate
          ),
        });
      } else {
        const mismatchedCapability = [...draft.capabilities.entries()]
          .sort(([left], [right]) => compareBytewise(left, right))
          .find(([, candidate]) => candidate.capabilityDigest !== receipt.capabilityDigest)?.[1];
        if (mismatchedCapability === undefined) throw new FakeMatrixCorpusRepositoryFault();
        writeLeaseMirrors({
          ...current.pair.current,
          terminalFailureReceiptRefs: current.pair.current.terminalFailureReceiptRefs.map((candidate) =>
            candidate.transportReceiptId === reference.transportReceiptId
              ? { ...candidate, capabilityDigest: mismatchedCapability.capabilityDigest }
              : candidate
          ),
        });
      }
    }
    this.state = draft;
  }

  public corruptLifecycleInvariantForTest(invariant: 'pointed_capability_consumed'): void {
    if (invariant !== 'pointed_capability_consumed') throw new FakeMatrixCorpusRepositoryFault();
    const draft = structuredClone(this.state);
    const slot = firstSortedMapEntry(draft.leaseSlots);
    if (slot === null) throw new FakeMatrixCorpusRepositoryFault();
    const current = this.readCurrentPair(draft, slot[0]);
    if (current.kind !== 'found') throw new FakeMatrixCorpusRepositoryFault();
    const pointer = current.pair.current.unconsumedCapability;
    if (pointer === null) throw new FakeMatrixCorpusRepositoryFault();
    const pointed = draft.capabilities.get(pointer.digest);
    if (
      pointed === undefined ||
      pointed.capabilityDigest !== pointer.digest ||
      pointed.phase !== pointer.phase ||
      pointed.consumedAt !== null ||
      pointed.revokedAt !== null
    )
      throw new FakeMatrixCorpusRepositoryFault();
    const consumed = matrixCorpusCapabilityV1Schema.safeParse({
      ...pointed,
      consumedAt: '2026-07-20T00:00:03.000Z',
      consumedTransportMessageIdDigest: 'f'.repeat(64),
      ingestOutboxId: 'outbox_consumed',
    });
    if (!consumed.success) throw new FakeMatrixCorpusRepositoryFault();
    draft.capabilities.set(consumed.data.capabilityDigest, consumed.data);
    this.state = draft;
  }

  public corruptIngestClaimInvariantForTest(
    invariant: FakeMatrixCorpusIngestClaimInvariantForTest
  ): void {
    const draft = structuredClone(this.state);
    const slot = firstSortedMapEntry(draft.leaseSlots);
    if (slot === null) throw new FakeMatrixCorpusRepositoryFault();
    const [leaseSlotDigest] = slot;
    const current = this.readCurrentPair(draft, leaseSlotDigest);
    if (current.kind !== 'found') throw new FakeMatrixCorpusRepositoryFault();
    const ingestOutboxId = current.pair.current.ingestOutboxIds.find((candidate) =>
      draft.ingestOutboxes.has(candidate)
    );
    if (ingestOutboxId === undefined) throw new FakeMatrixCorpusRepositoryFault();

    if (invariant === 'referenced_ingest_outbox_missing_record') {
      draft.ingestOutboxes.delete(ingestOutboxId);
    } else {
      const lease = {
        ...current.pair.current,
        ingestOutboxIds: current.pair.current.ingestOutboxIds.filter(
          (candidate) => candidate !== ingestOutboxId
        ),
        nonterminalIngestOutboxIds: current.pair.current.nonterminalIngestOutboxIds.filter(
          (candidate) => candidate !== ingestOutboxId
        ),
      } satisfies MatrixCorpusLeaseV1;
      draft.leaseSlots.set(leaseSlotDigest, lease);
      draft.leaseHistories.set(lease.runFenceDigest, { leaseSlotDigest, ...lease });
    }
    this.state = draft;
  }

  public corruptTerminalClaimInvariantForTest(
    invariant: FakeMatrixCorpusTerminalClaimInvariantForTest
  ): void {
    const draft = structuredClone(this.state);
    const slot = firstSortedMapEntry(draft.leaseSlots);
    if (slot === null) throw new FakeMatrixCorpusRepositoryFault();
    const [leaseSlotDigest] = slot;
    const current = this.readCurrentPair(draft, leaseSlotDigest);
    if (current.kind !== 'found') throw new FakeMatrixCorpusRepositoryFault();
    const terminalControlId = current.pair.current.terminalControlOutboxIds.find((candidate) =>
      draft.terminalControlOutboxes.has(candidate)
    );
    if (terminalControlId === undefined) throw new FakeMatrixCorpusRepositoryFault();

    if (invariant === 'referenced_terminal_outbox_missing_record') {
      draft.terminalControlOutboxes.delete(terminalControlId);
    } else {
      const lease = {
        ...current.pair.current,
        terminalControlOutboxIds: current.pair.current.terminalControlOutboxIds.filter(
          (candidate) => candidate !== terminalControlId
        ),
      } satisfies MatrixCorpusLeaseV1;
      draft.leaseSlots.set(leaseSlotDigest, lease);
      draft.leaseHistories.set(lease.runFenceDigest, { leaseSlotDigest, ...lease });
    }
    this.state = draft;
  }

  public corruptTerminalAcknowledgementInvariantForTest(
    invariant: FakeMatrixCorpusTerminalAcknowledgementInvariantForTest
  ): void {
    const draft = structuredClone(this.state);
    const releaseEntry = [...draft.terminalControlOutboxes.entries()].find(
      ([, outbox]) => outbox.kind === 'release'
    );
    if (releaseEntry === undefined) throw new FakeMatrixCorpusRepositoryFault();
    const [terminalControlId, release] = releaseEntry;
    if (invariant === 'referenced_release_winner_missing_record') {
      draft.terminalControlOutboxes.delete(terminalControlId);
    } else if (invariant === 'release_winner_payload_digest_mismatch') {
      const mismatched = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...release,
        payloadDigest: 'f'.repeat(64),
      });
      if (!mismatched.success) throw new FakeMatrixCorpusRepositoryFault();
      draft.terminalControlOutboxes.set(terminalControlId, mismatched.data);
    } else {
      const superseded = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        ...release,
        status: 'closed',
        claim: null,
        acknowledgedAt: null,
        closedReason: 'superseded_by_authoritative_winner',
        lastClaimRenewal: null,
        closedAt: '2026-07-20T00:01:00.000Z',
      });
      if (!superseded.success) throw new FakeMatrixCorpusRepositoryFault();
      draft.terminalControlOutboxes.set(terminalControlId, superseded.data);
    }
    this.state = draft;
  }

  public seedValidLeaseState(input: Readonly<{
    pair: MatrixCorpusCurrentLeaseHistoryPairV1;
    renewReceipts: readonly MatrixCorpusRenewReceiptV1[];
  }>): void {
    if (
      this.state.version !== 0 ||
      this.faultStages.size !== 0 ||
      this.responseLossOperations.size !== 0 ||
      [...this.beforeAdmissionGates.values()].some((queue) => queue.length !== 0) ||
      [...this.afterCommitGates.values()].some((queue) => queue.length !== 0) ||
      [...this.counts.values()].some((counts) => counts.invocations !== 0 || counts.commits !== 0)
    )
      throw new FakeMatrixCorpusRepositoryFault();
    const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse(input.pair);
    if (!pair.success) throw new FakeMatrixCorpusRepositoryFault();
    const receipts = new Map<string, MatrixCorpusRenewReceiptV1>();
    for (const receipt of input.renewReceipts) {
      const parsed = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({
        history: pair.data.history,
        receipt,
      });
      if (!parsed.success || receipts.has(receipt.idempotencyKeyDigest))
        throw new FakeMatrixCorpusRepositoryFault();
      receipts.set(receipt.idempotencyKeyDigest, parsed.data.receipt);
    }
    const expectedKeys = pair.data.history.renewReceiptIds;
    if (
      expectedKeys.length !== receipts.size ||
      expectedKeys.some((idempotencyKeyDigest) => !receipts.has(idempotencyKeyDigest))
    )
      throw new FakeMatrixCorpusRepositoryFault();
    this.state = structuredClone({
      version: 1,
      leaseSlots: new Map([[pair.data.leaseSlotDigest, pair.data.current]]),
      leaseHistories: new Map([[pair.data.history.runFenceDigest, pair.data.history]]),
      renewReceiptsByRun:
        receipts.size === 0 ? new Map() : new Map([[pair.data.history.runFenceDigest, receipts]]),
      capabilityIssuanceReceiptsByRun: new Map(),
      capabilities: new Map(),
      transportReceipts: new Map(),
      ingestOutboxes: new Map(),
      terminalControlOutboxes: new Map(),
    });
  }

  public seedValidLifecycleState(input: FakeMatrixCorpusLifecycleSeed): void {
    if (!this.isPristine()) throw new FakeMatrixCorpusRepositoryFault();
    const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse(input.pair);
    if (!pair.success) throw new FakeMatrixCorpusRepositoryFault();
    const history = pair.data.history;
    const renewReceipts = new Map<string, MatrixCorpusRenewReceiptV1>();
    for (const receipt of input.renewReceipts) {
      const parsed = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({ history, receipt });
      if (!parsed.success || renewReceipts.has(receipt.idempotencyKeyDigest))
        throw new FakeMatrixCorpusRepositoryFault();
      renewReceipts.set(parsed.data.receipt.idempotencyKeyDigest, parsed.data.receipt);
    }
    if (!hasExactMapKeys(history.renewReceiptIds, renewReceipts)) throw new FakeMatrixCorpusRepositoryFault();

    const issuanceReceipts = new Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>();
    for (const receipt of input.issuanceReceipts) {
      const parsed = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({ history, receipt });
      if (!parsed.success || issuanceReceipts.has(receipt.matrixIdempotencyKeyDigest))
        throw new FakeMatrixCorpusRepositoryFault();
      issuanceReceipts.set(parsed.data.receipt.matrixIdempotencyKeyDigest, parsed.data.receipt);
    }
    if (!hasExactMapKeys(history.capabilityIssuanceReceiptIds, issuanceReceipts))
      throw new FakeMatrixCorpusRepositoryFault();

    const capabilities = new Map<string, MatrixCorpusCapabilityV1>();
    for (const capability of input.capabilities) {
      const parsed = matrixCorpusCapabilityV1Schema.safeParse(capability);
      if (
        !parsed.success ||
        capabilities.has(capability.capabilityDigest) ||
        !hasLeaseIdentity(history, parsed.data)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      capabilities.set(parsed.data.capabilityDigest, parsed.data);
    }
    if (!hasExactMapKeys(history.capabilityDigests, capabilities)) throw new FakeMatrixCorpusRepositoryFault();

    const transportReceipts = new Map<string, MatrixCorpusTransportReceiptV1>();
    for (const receipt of input.transportReceipts) {
      const parsed = matrixCorpusTransportReceiptV1Schema.safeParse(receipt);
      if (
        !parsed.success ||
        transportReceipts.has(receipt.transportMessageIdDigest) ||
        !hasLeaseIdentity(history, parsed.data)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      transportReceipts.set(parsed.data.transportMessageIdDigest, parsed.data);
    }
    if (!hasExactMapKeys(history.transportReceiptIds, transportReceipts))
      throw new FakeMatrixCorpusRepositoryFault();

    const ingestOutboxes = new Map<string, MatrixCorpusIngestOutboxRecordV1>();
    for (const outbox of input.ingestOutboxes) {
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(outbox);
      if (
        !parsed.success ||
        ingestOutboxes.has(outbox.ingestOutboxId) ||
        !hasLeaseIdentity(history, parsed.data)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      ingestOutboxes.set(parsed.data.ingestOutboxId, parsed.data);
    }
    if (!hasExactMapKeys(history.ingestOutboxIds, ingestOutboxes)) throw new FakeMatrixCorpusRepositoryFault();
    if (!isIssueConsumeSeedCorrelated(history, issuanceReceipts, capabilities, transportReceipts, ingestOutboxes))
      throw new FakeMatrixCorpusRepositoryFault();

    const terminalControlOutboxes = new Map<string, MatrixCorpusTerminalControlOutboxRecordV1>();
    for (const outbox of input.terminalControlOutboxes) {
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(outbox);
      if (
        !parsed.success ||
        terminalControlOutboxes.has(outbox.terminalControlId) ||
        !hasLeaseIdentity(history, parsed.data)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      terminalControlOutboxes.set(parsed.data.terminalControlId, parsed.data);
    }
    if (!isLifecycleTerminalStateCorrelated(history, terminalControlOutboxes))
      throw new FakeMatrixCorpusRepositoryFault();

    this.state = structuredClone({
      version: 1,
      leaseSlots: new Map([[pair.data.leaseSlotDigest, pair.data.current]]),
      leaseHistories: new Map([[history.runFenceDigest, history]]),
      renewReceiptsByRun: renewReceipts.size === 0 ? new Map() : new Map([[history.runFenceDigest, renewReceipts]]),
      capabilityIssuanceReceiptsByRun:
        issuanceReceipts.size === 0 ? new Map() : new Map([[history.runFenceDigest, issuanceReceipts]]),
      capabilities,
      transportReceipts,
      ingestOutboxes,
      terminalControlOutboxes,
    });
  }

  public seedValidCleanupOutboxState(input: FakeMatrixCorpusCleanupOutboxSeed): void {
    if (!this.isPristine()) throw new FakeMatrixCorpusRepositoryFault();
    const currentPair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse(input.currentPair);
    if (!currentPair.success) throw new FakeMatrixCorpusRepositoryFault();

    const histories = new Map<string, MatrixCorpusLeaseHistoryV1>([
      [currentPair.data.history.runFenceDigest, currentPair.data.history],
    ]);
    for (const retained of input.retainedHistories) {
      const parsed = matrixCorpusLeaseHistoryV1Schema.safeParse(retained);
      if (
        !parsed.success ||
        histories.has(parsed.data.runFenceDigest) ||
        parsed.data.userId !== currentPair.data.current.userId ||
        parsed.data.leaseSlotDigest !== currentPair.data.leaseSlotDigest
      )
        throw new FakeMatrixCorpusRepositoryFault();
      histories.set(parsed.data.runFenceDigest, parsed.data);
    }

    const historyFor = (
      child: Readonly<{ runId: string; userId: string; leaseFence: string }>
    ): MatrixCorpusLeaseHistoryV1 | null => {
      const matches = [...histories.values()].filter((history) => hasLeaseIdentity(history, child));
      return matches.length === 1 ? (matches[0] ?? null) : null;
    };
    const remainingFor = (history: MatrixCorpusLeaseHistoryV1) =>
      history.cleanupProgress === null ? history : history.cleanupProgress.remaining;
    const hasExpected = (
      history: MatrixCorpusLeaseHistoryV1,
      field: keyof MatrixCorpusCleanupProgressV1['remaining'],
      key: string
    ) => remainingFor(history)[field].includes(key);

    const renewReceiptsByRun = new Map<string, Map<string, MatrixCorpusRenewReceiptV1>>();
    for (const addressed of input.renewReceipts) {
      const history = histories.get(addressed.runFenceDigest);
      const parsed =
        history === undefined
          ? { success: false as const }
          : matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({ history, receipt: addressed.receipt });
      if (
        !parsed.success ||
        !hasExpected(parsed.data.history, 'renewReceiptIds', parsed.data.receipt.idempotencyKeyDigest)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      const perRun = renewReceiptsByRun.get(addressed.runFenceDigest) ?? new Map<string, MatrixCorpusRenewReceiptV1>();
      if (perRun.has(parsed.data.receipt.idempotencyKeyDigest)) throw new FakeMatrixCorpusRepositoryFault();
      perRun.set(parsed.data.receipt.idempotencyKeyDigest, parsed.data.receipt);
      renewReceiptsByRun.set(addressed.runFenceDigest, perRun);
    }

    const issuanceReceiptsByRun = new Map<string, Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>>();
    for (const addressed of input.issuanceReceipts) {
      const history = histories.get(addressed.runFenceDigest);
      const parsed =
        history === undefined
          ? { success: false as const }
          : matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({ history, receipt: addressed.receipt });
      if (
        !parsed.success ||
        !hasExpected(
          parsed.data.history,
          'capabilityIssuanceReceiptIds',
          parsed.data.receipt.matrixIdempotencyKeyDigest
        )
      )
        throw new FakeMatrixCorpusRepositoryFault();
      const perRun =
        issuanceReceiptsByRun.get(addressed.runFenceDigest) ??
        new Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>();
      if (perRun.has(parsed.data.receipt.matrixIdempotencyKeyDigest)) throw new FakeMatrixCorpusRepositoryFault();
      perRun.set(parsed.data.receipt.matrixIdempotencyKeyDigest, parsed.data.receipt);
      issuanceReceiptsByRun.set(addressed.runFenceDigest, perRun);
    }

    const capabilities = new Map<string, MatrixCorpusCapabilityV1>();
    for (const value of input.capabilities) {
      const parsed = matrixCorpusCapabilityV1Schema.safeParse(value);
      const history = parsed.success ? historyFor(parsed.data) : null;
      if (
        !parsed.success ||
        history === null ||
        !hasExpected(history, 'capabilityDigests', parsed.data.capabilityDigest) ||
        capabilities.has(parsed.data.capabilityDigest)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      capabilities.set(parsed.data.capabilityDigest, parsed.data);
    }

    const transportReceipts = new Map<string, MatrixCorpusTransportReceiptV1>();
    for (const value of input.transportReceipts) {
      const parsed = matrixCorpusTransportReceiptV1Schema.safeParse(value);
      const history = parsed.success ? historyFor(parsed.data) : null;
      if (
        !parsed.success ||
        history === null ||
        !hasExpected(history, 'transportReceiptIds', parsed.data.transportMessageIdDigest) ||
        transportReceipts.has(parsed.data.transportMessageIdDigest)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      transportReceipts.set(parsed.data.transportMessageIdDigest, parsed.data);
    }

    const ingestOutboxes = new Map<string, MatrixCorpusIngestOutboxRecordV1>();
    for (const value of input.ingestOutboxes) {
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(value);
      const history = parsed.success ? historyFor(parsed.data) : null;
      if (
        !parsed.success ||
        history === null ||
        !hasExpected(history, 'ingestOutboxIds', parsed.data.ingestOutboxId) ||
        ingestOutboxes.has(parsed.data.ingestOutboxId)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      ingestOutboxes.set(parsed.data.ingestOutboxId, parsed.data);
    }

    const terminalControlOutboxes = new Map<string, MatrixCorpusTerminalControlOutboxRecordV1>();
    for (const value of input.terminalControlOutboxes) {
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(value);
      const history = parsed.success ? historyFor(parsed.data) : null;
      if (
        !parsed.success ||
        history === null ||
        !hasExpected(history, 'terminalControlOutboxIds', parsed.data.terminalControlId) ||
        terminalControlOutboxes.has(parsed.data.terminalControlId)
      )
        throw new FakeMatrixCorpusRepositoryFault();
      terminalControlOutboxes.set(parsed.data.terminalControlId, parsed.data);
    }

    for (const history of histories.values()) {
      const remaining = remainingFor(history);
      const renew = renewReceiptsByRun.get(history.runFenceDigest) ?? new Map<string, MatrixCorpusRenewReceiptV1>();
      const issuance =
        issuanceReceiptsByRun.get(history.runFenceDigest) ?? new Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>();
      const ownedCapabilities = new Map(
        [...capabilities].filter(([, capability]) => hasLeaseIdentity(history, capability))
      );
      const ownedTransportReceipts = new Map(
        [...transportReceipts].filter(([, receipt]) => hasLeaseIdentity(history, receipt))
      );
      const ownedIngestOutboxes = new Map(
        [...ingestOutboxes].filter(([, outbox]) => hasLeaseIdentity(history, outbox))
      );
      const ownedTerminalOutboxes = new Map(
        [...terminalControlOutboxes].filter(([, outbox]) => hasLeaseIdentity(history, outbox))
      );
      if (
        !hasExactMapKeys(remaining.renewReceiptIds, renew) ||
        !hasExactMapKeys(remaining.capabilityIssuanceReceiptIds, issuance) ||
        !hasExactMapKeys(remaining.capabilityDigests, ownedCapabilities) ||
        !hasExactMapKeys(remaining.transportReceiptIds, ownedTransportReceipts) ||
        !hasExactMapKeys(remaining.ingestOutboxIds, ownedIngestOutboxes) ||
        !hasExactMapKeys(remaining.terminalControlOutboxIds, ownedTerminalOutboxes)
      )
        throw new FakeMatrixCorpusRepositoryFault();

      if (history.phase === 'released' || history.phase === 'abandoned') {
        const winner = history.terminalWinner;
        if (
          winner === null ||
          ownedTerminalOutboxes.get(winner.eventId)?.status !== 'published' ||
          ownedTerminalOutboxes.get(winner.eventId)?.kind !== winner.kind ||
          ownedTerminalOutboxes.get(winner.eventId)?.payloadDigest !== winner.payloadDigest ||
          ownedTerminalOutboxes.get(winner.eventId)?.acknowledgedAt !== winner.acknowledgedAt
        )
          throw new FakeMatrixCorpusRepositoryFault();
      }
      if (history.cleanupProgress !== null) {
        const set = matrixCorpusCleanupLeaseSetV1Schema.safeParse({
          currentPair: currentPair.data,
          targetHistory: history,
        });
        if (!set.success) throw new FakeMatrixCorpusRepositoryFault();
      } else if (history.phase !== 'released' && history.phase !== 'abandoned') {
        if (
          !isIssueConsumeSeedCorrelated(
            history,
            issuance,
            ownedCapabilities,
            ownedTransportReceipts,
            ownedIngestOutboxes
          ) ||
          !isLifecycleTerminalStateCorrelated(history, ownedTerminalOutboxes)
        )
          throw new FakeMatrixCorpusRepositoryFault();
      }
    }

    const finalReceipts = [
      ...(currentPair.data.current.priorFinalCleanupReceipts ?? []),
      ...(currentPair.data.current.finalCleanupReceipt === null
        ? []
        : [currentPair.data.current.finalCleanupReceipt]),
    ];
    for (const finalReceipt of finalReceipts) {
      const projection = finalReceipt.replayProjection;
      if (
        projection.operation !== 'cleanup' ||
        projection.result !== 'cleaned' ||
        histories.has(projection.targetRunFenceDigest)
      )
        throw new FakeMatrixCorpusRepositoryFault();
    }

    this.state = structuredClone({
      version: 1,
      leaseSlots: new Map([[currentPair.data.leaseSlotDigest, currentPair.data.current]]),
      leaseHistories: histories,
      renewReceiptsByRun,
      capabilityIssuanceReceiptsByRun: issuanceReceiptsByRun,
      capabilities,
      transportReceipts,
      ingestOutboxes,
      terminalControlOutboxes,
    });
  }

  public seedValidIssueConsumeState(input: FakeMatrixCorpusIssueConsumeSeed): void {
    this.seedValidLifecycleState({ ...input, terminalControlOutboxes: [] });
  }

  public async acquireProvisioningLease(input: AcquireProvisioningLeaseCommand): Promise<ProvisioningLeaseResult> {
    return this.run('acquire', provisioningLeaseResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = acquireProvisioningLeaseCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const existingHistory = draft.leaseHistories.get(command.data.runFenceDigest);
      if (existingHistory !== undefined) {
        const candidateHistory = matrixCorpusLeaseHistoryV1Schema.safeParse(existingHistory);
        if (!candidateHistory.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
        const receipt = candidateHistory.data.operationReceipts.acquire;
        if (receipt === null) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
        if (
          receipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest &&
          receipt.canonicalRequestDigest === command.data.canonicalRequestDigest &&
          receipt.replayProjection.operation === 'acquire' &&
          receipt.replayProjection.result === 'acquired'
        ) {
          const result = provisioningLeaseResultSchema.safeParse({
            code: 'ALREADY_APPLIED',
            operation: 'acquire',
            result: 'acquired',
            runId: receipt.replayProjection.runId,
            leaseFence: receipt.replayProjection.leaseFence,
            phase: receipt.replayProjection.phase,
            acquiredAt: receipt.replayProjection.acquiredAt,
            expiresAt: receipt.replayProjection.expiresAt,
          });
          return result.success
            ? { kind: 'read_only', result: result.data }
            : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        }
        return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
      }
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      if (current.kind === 'found' && current.pair.current.phase !== 'released' && current.pair.current.phase !== 'abandoned')
        return { kind: 'read_only', result: { code: 'RUN_ALREADY_ACTIVE' } };
      if (command.data.acquisitionReadiness.kind !== 'admission_ready')
        return { kind: 'read_only', result: { code: 'NOT_READY', gate: 'admission' } };
      const nextFence =
        current.kind === 'missing' ? '1' : (BigInt(current.pair.current.fenceEpoch) + 1n).toString();
      const parsedFence = matrixCorpusDecimalFenceSchema.safeParse(nextFence);
      if (!parsedFence.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease' } };
      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'acquire',
        result: 'acquired',
        runId: command.data.runId,
        leaseFence: parsedFence.data,
        phase: 'provisioning',
        acquiredAt: command.data.now,
        expiresAt: command.data.expiresAt,
      });
      if (!projection.success || projection.data.operation !== 'acquire')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusOperationReceiptV1Schema.safeParse({
        version: 1,
        operation: 'acquire',
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        resultCode: 'ACQUIRED',
        replayProjection: projection.data,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const lease = {
        version: 1,
        runtimeAudience: command.data.runtimeAudience,
        runId: command.data.runId,
        userId: command.data.userId,
        matrixRoomBindingDigest: command.data.matrixRoomBindingDigest,
        whatsappAccountBindingDigest: command.data.whatsappAccountBindingDigest,
        whatsappSenderBindingDigest: command.data.whatsappSenderBindingDigest,
        runFenceDigest: command.data.runFenceDigest,
        phase: 'provisioning' as const,
        leaseFence: parsedFence.data,
        fenceEpoch: parsedFence.data,
        acquiredAt: command.data.now,
        activatedAt: null,
        renewedAt: command.data.now,
        expiresAt: command.data.expiresAt,
        quiescedAt: null,
        releasedAt: null,
        abandonedAt: null,
        operationReceipts: { acquire: receipt.data, activate: null, quiesce: null, release: null },
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
        priorFinalCleanupReceipts: [],
        finalCleanupReceipt: null,
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, lease);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.throwAt('acquire_after_current_draft');
      this.writeHistoryPair(draft, pair);
      this.throwAt('acquire_after_history_draft');
      const result = provisioningLeaseResultSchema.safeParse({
        code: 'ACQUIRED',
        runId: projection.data.runId,
        leaseFence: projection.data.leaseFence,
        phase: projection.data.phase,
        acquiredAt: projection.data.acquiredAt,
        expiresAt: projection.data.expiresAt,
      });
      if (!result.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      return { kind: 'commit', result: result.data };
    });
  }

  public async activateRun(input: ActivateRunCommand): Promise<ActivationResult> {
    return this.run('activate', activationResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = activateRunCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const candidateHistory = draft.leaseHistories.get(command.data.runFenceDigest);
      if (candidateHistory !== undefined) {
        const history = matrixCorpusLeaseHistoryV1Schema.safeParse(candidateHistory);
        if (!history.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
        const receipt = history.data.operationReceipts.activate;
        if (receipt !== null && receipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest) {
          if (receipt.canonicalRequestDigest !== command.data.canonicalRequestDigest)
            return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
          const projection = receipt.replayProjection;
          if (projection.operation !== 'activate' || projection.result !== 'activated')
            return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
          const result = activationResultSchema.safeParse({
            code: 'ALREADY_APPLIED',
            operation: 'activate',
            result: 'activated',
            runId: projection.runId,
            leaseFence: projection.leaseFence,
            phase: projection.phase,
            activatedAt: projection.activatedAt,
          });
          return result.success
            ? { kind: 'read_only', result: result.data }
            : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        }
      }
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runId !== command.data.runId ||
        lease.userId !== command.data.userId ||
        lease.leaseFence !== command.data.leaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const now = parseEpochMilliseconds(command.data.now);
      const leaseExpiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || leaseExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= leaseExpiresAt)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'provisioning')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (command.data.controlStatus.kind !== 'status')
        return { kind: 'read_only', result: { code: 'NOT_READY', gate: 'activation' } };
      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'activate',
        result: 'activated',
        runId: command.data.runId,
        leaseFence: command.data.leaseFence,
        phase: 'active',
        activatedAt: command.data.now,
      });
      if (!projection.success || projection.data.operation !== 'activate')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusOperationReceiptV1Schema.safeParse({
        version: 1,
        operation: 'activate',
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        resultCode: 'ACTIVATED',
        replayProjection: projection.data,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const updated = {
        ...lease,
        phase: 'active' as const,
        activatedAt: command.data.now,
        operationReceipts: { ...lease.operationReceipts, activate: receipt.data },
        priorFinalCleanupReceipts: [],
        finalCleanupReceipt: null,
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.throwAt('activate_after_current_draft');
      this.writeHistoryPair(draft, pair);
      this.throwAt('activate_after_history_draft');
      const result = activationResultSchema.safeParse({
        code: 'ACTIVATED',
        runId: projection.data.runId,
        leaseFence: projection.data.leaseFence,
        phase: projection.data.phase,
        activatedAt: projection.data.activatedAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async renewLease(input: RenewLeaseCommand): Promise<LeaseRenewResult> {
    return this.run('renew', leaseRenewResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = renewLeaseCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const storedReceipt = draft.renewReceiptsByRun
        .get(command.data.runFenceDigest)
        ?.get(command.data.idempotencyKeyDigest);
      if (storedReceipt !== undefined) {
        const history = draft.leaseHistories.get(command.data.runFenceDigest);
        const receiptPair = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({ history, receipt: storedReceipt });
        if (!receiptPair.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'renew_receipt' } };
        if (storedReceipt.canonicalRequestDigest !== command.data.canonicalRequestDigest)
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const projection = storedReceipt.replayProjection;
        if (projection.operation !== 'renew' || projection.result !== 'renewed')
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'renew_receipt' } };
        const result = leaseRenewResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'renew',
          result: 'renewed',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          phase: projection.phase,
          renewedAt: projection.renewedAt,
          expiresAt: projection.expiresAt,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runId !== command.data.runId ||
        lease.userId !== command.data.userId ||
        lease.leaseFence !== command.data.leaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const now = parseEpochMilliseconds(command.data.now);
      const requestedExpiresAt = parseEpochMilliseconds(command.data.expiresAt);
      const leaseExpiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || requestedExpiresAt === null || leaseExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= leaseExpiresAt)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'active')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (requestedExpiresAt <= now || requestedExpiresAt <= leaseExpiresAt)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };
      if (lease.renewReceiptIds.length >= 400)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };
      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'renew',
        result: 'renewed',
        runId: command.data.runId,
        leaseFence: command.data.leaseFence,
        phase: 'active',
        renewedAt: command.data.now,
        expiresAt: command.data.expiresAt,
      });
      if (!projection.success || projection.data.operation !== 'renew')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusRenewReceiptV1Schema.safeParse({
        version: 1,
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        runId: command.data.runId,
        userId: command.data.userId,
        leaseFence: command.data.leaseFence,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        replayProjection: projection.data,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      let receipts = draft.renewReceiptsByRun.get(command.data.runFenceDigest);
      if (receipts === undefined) {
        receipts = new Map<string, MatrixCorpusRenewReceiptV1>();
        draft.renewReceiptsByRun.set(command.data.runFenceDigest, receipts);
      }
      receipts.set(receipt.data.idempotencyKeyDigest, receipt.data);
      this.throwAt('renew_after_receipt_draft');
      const updated = {
        ...lease,
        renewedAt: command.data.now,
        expiresAt: command.data.expiresAt,
        renewReceiptIds: [...lease.renewReceiptIds, receipt.data.idempotencyKeyDigest],
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.throwAt('renew_after_current_draft');
      this.writeHistoryPair(draft, pair);
      this.throwAt('renew_after_history_draft');
      const renewReceiptPair = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({
        history: pair.history,
        receipt: receipt.data,
      });
      if (!renewReceiptPair.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'renew_receipt' } };
      const result = leaseRenewResultSchema.safeParse({
        code: 'LEASE_RENEWED',
        runId: projection.data.runId,
        leaseFence: projection.data.leaseFence,
        phase: projection.data.phase,
        renewedAt: projection.data.renewedAt,
        expiresAt: projection.data.expiresAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async issueCapability(input: IssueCapabilityCommand): Promise<CapabilityIssueResult> {
    return this.run('issue', capabilityIssueResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = issueCapabilityCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      const capability = command.data.capability;
      if (lease.runFenceDigest !== command.data.runFenceDigest || !hasCapabilityAuthority(lease, capability))
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };

      const storedReceipt = draft.capabilityIssuanceReceiptsByRun
        .get(lease.runFenceDigest)
        ?.get(capability.matrixIdempotencyKeyDigest);
      if (
        storedReceipt === undefined &&
        current.pair.history.capabilityIssuanceReceiptIds.includes(capability.matrixIdempotencyKeyDigest)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
      if (storedReceipt !== undefined) {
        const receiptPair = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({
          history: current.pair.history,
          receipt: storedReceipt,
        });
        if (!receiptPair.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
        const storedCapability = draft.capabilities.get(storedReceipt.capabilityDigest);
        const parsedCapability = matrixCorpusCapabilityV1Schema.safeParse(storedCapability);
        if (
          !parsedCapability.success ||
          storedCapability?.capabilityDigest !== storedReceipt.capabilityDigest ||
          !hasCapabilityAuthority(lease, parsedCapability.data) ||
          !current.pair.history.capabilityDigests.includes(storedReceipt.capabilityDigest) ||
          storedReceipt.matrixIdempotencyKeyDigest !== capability.matrixIdempotencyKeyDigest ||
          parsedCapability.data.matrixIdempotencyKeyDigest !== storedReceipt.matrixIdempotencyKeyDigest ||
          parsedCapability.data.issueRequestDigest !== storedReceipt.issueRequestDigest ||
          parsedCapability.data.scenarioId !== storedReceipt.scenarioId ||
          parsedCapability.data.phase !== storedReceipt.phase ||
          parsedCapability.data.turnIndex !== storedReceipt.turnIndex ||
          parsedCapability.data.issuedAt !== storedReceipt.recordedAt
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
        const projection = storedReceipt.replayProjection;
        if (
          projection.operation !== 'issue' ||
          projection.result !== 'issued' ||
          parsedCapability.data.expiresAt !== projection.expiresAt
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
        const resultDigest = this.digestProjection(projection);
        if (resultDigest === null)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
        if (resultDigest !== storedReceipt.resultDigest)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
        if (
          capability.issueRequestDigest !== storedReceipt.issueRequestDigest ||
          capability.capabilityDigest !== storedReceipt.capabilityDigest
        )
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const result = capabilityIssueResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'issue',
          result: 'issued',
          runId: projection.runId,
          scenarioId: projection.scenarioId,
          phase: projection.phase,
          turnIndex: projection.turnIndex,
          issuedAt: projection.issuedAt,
          expiresAt: projection.expiresAt,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }

      const now = parseEpochMilliseconds(command.data.now);
      const leaseExpiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || leaseExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= leaseExpiresAt)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'active')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (
        capability.issuedAt !== command.data.now ||
        capability.consumedAt !== null ||
        capability.consumedTransportMessageIdDigest !== null ||
        capability.ingestOutboxId !== null ||
        capability.revokedAt !== null
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      if (lease.unconsumedCapability !== null || lease.nonterminalIngestOutboxIds.length !== 0)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };
      if (lease.capabilityIssuanceReceiptIds.length >= MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };

      const existingCapability = draft.capabilities.get(capability.capabilityDigest);
      if (existingCapability !== undefined) {
        const parsedExisting = matrixCorpusCapabilityV1Schema.safeParse(existingCapability);
        if (
          !parsedExisting.success ||
          parsedExisting.data.capabilityDigest !== capability.capabilityDigest ||
          !current.pair.history.capabilityDigests.includes(parsedExisting.data.capabilityDigest) ||
          !hasCapabilityAuthority(lease, parsedExisting.data)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
        const existingExpiresAt = parseEpochMilliseconds(parsedExisting.data.expiresAt);
        if (existingExpiresAt === null)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
        if (parsedExisting.data.consumedAt !== null)
          return { kind: 'read_only', result: { code: 'CAPABILITY_REPLAY' } };
        if (parsedExisting.data.revokedAt !== null)
          return { kind: 'read_only', result: { code: 'CAPABILITY_REVOKED' } };
        if (now >= existingExpiresAt) return { kind: 'read_only', result: { code: 'CAPABILITY_EXPIRED' } };
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };
      }

      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'issue',
        result: 'issued',
        runId: capability.runId,
        scenarioId: capability.scenarioId,
        phase: capability.phase,
        turnIndex: capability.turnIndex,
        issuedAt: capability.issuedAt,
        expiresAt: capability.expiresAt,
      });
      if (!projection.success || projection.data.operation !== 'issue')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusCapabilityIssuanceReceiptV1Schema.safeParse({
        version: 1,
        matrixIdempotencyKeyDigest: capability.matrixIdempotencyKeyDigest,
        runId: capability.runId,
        userId: capability.userId,
        leaseFence: capability.leaseFence,
        scenarioId: capability.scenarioId,
        phase: capability.phase,
        turnIndex: capability.turnIndex,
        issueRequestDigest: capability.issueRequestDigest,
        capabilityDigest: capability.capabilityDigest,
        replayProjection: projection.data,
        resultDigest,
        recordedAt: capability.issuedAt,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.capabilities.set(capability.capabilityDigest, capability);
      this.throwAt('issue_after_capability_draft');
      let receipts = draft.capabilityIssuanceReceiptsByRun.get(lease.runFenceDigest);
      if (receipts === undefined) {
        receipts = new Map<string, MatrixCorpusCapabilityIssuanceReceiptV1>();
        draft.capabilityIssuanceReceiptsByRun.set(lease.runFenceDigest, receipts);
      }
      receipts.set(receipt.data.matrixIdempotencyKeyDigest, receipt.data);
      this.throwAt('issue_after_issuance_receipt_draft');
      const updated = {
        ...lease,
        capabilityIssuanceReceiptIds: [...lease.capabilityIssuanceReceiptIds, receipt.data.matrixIdempotencyKeyDigest],
        capabilityDigests: [...lease.capabilityDigests, capability.capabilityDigest],
        unconsumedCapability: { digest: capability.capabilityDigest, phase: capability.phase },
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('issue_after_lease_pair_draft');
      const receiptPair = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({
        history: pair.history,
        receipt: receipt.data,
      });
      if (!receiptPair.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
      const result = capabilityIssueResultSchema.safeParse({
        code: 'CAPABILITY_ISSUED',
        runId: projection.data.runId,
        scenarioId: projection.data.scenarioId,
        phase: projection.data.phase,
        turnIndex: projection.data.turnIndex,
        issuedAt: projection.data.issuedAt,
        expiresAt: projection.data.expiresAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async recordMatrixSendProof(
    _input: RecordMatrixSendProofCommand
  ): Promise<MatrixSendProofResult> {
    return { code: 'NOT_FOUND' };
  }

  public async consumeCapabilityAndEnqueueIngest(
    input: ConsumeCapabilityAndEnqueueIngestCommand
  ): Promise<CapabilityConsumeResult> {
    return this.run('consume', capabilityConsumeResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = consumeCapabilityAndEnqueueIngestCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (!hasConsumeAuthority(lease, command.data)) return { kind: 'read_only', result: { code: 'STALE_FENCE' } };

      const storedReceipt = draft.transportReceipts.get(command.data.transportMessageIdDigest);
      if (
        storedReceipt === undefined &&
        current.pair.history.transportReceiptIds.includes(command.data.transportMessageIdDigest)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
      if (!this.hasResolvedTerminalFailureReferences(current.pair.history, draft))
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
      if (storedReceipt !== undefined) {
        const receipt = matrixCorpusTransportReceiptV1Schema.safeParse(storedReceipt);
        if (
          !receipt.success ||
          receipt.data.transportMessageIdDigest !== command.data.transportMessageIdDigest ||
          receipt.data.runId !== lease.runId ||
          receipt.data.userId !== lease.userId ||
          receipt.data.leaseFence !== lease.leaseFence ||
          !current.pair.history.transportReceiptIds.includes(receipt.data.transportMessageIdDigest)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
        const storedCapability = draft.capabilities.get(receipt.data.capabilityDigest);
        const capability = matrixCorpusCapabilityV1Schema.safeParse(storedCapability);
        if (
          !capability.success ||
          capability.data.capabilityDigest !== receipt.data.capabilityDigest ||
          !hasCapabilityAuthority(lease, capability.data) ||
          !current.pair.history.capabilityDigests.includes(receipt.data.capabilityDigest) ||
          (receipt.data.acceptedAt !== null && receipt.data.promptDigest !== capability.data.promptDigest)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
        if (receipt.data.ingestOutboxId !== null) {
          const storedOutbox = draft.ingestOutboxes.get(receipt.data.ingestOutboxId);
          const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(storedOutbox);
          if (
            !outbox.success ||
            outbox.data.ingestOutboxId !== receipt.data.ingestOutboxId ||
            outbox.data.ingestReceiptId !== receipt.data.ingestReceiptId ||
            outbox.data.runId !== lease.runId ||
            outbox.data.userId !== lease.userId ||
            outbox.data.leaseFence !== lease.leaseFence ||
            !current.pair.history.ingestOutboxIds.includes(outbox.data.ingestOutboxId) ||
            capability.data.consumedTransportMessageIdDigest !== receipt.data.transportMessageIdDigest ||
            capability.data.ingestOutboxId !== receipt.data.ingestOutboxId ||
            capability.data.consumedAt !== receipt.data.acceptedAt ||
            receipt.data.acceptedAt !== receipt.data.recordedAt ||
            outbox.data.createdAt !== receipt.data.acceptedAt
          )
            return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
        } else if (
          receipt.data.terminalFailureCode === null ||
          current.pair.history.terminalFailureReceiptRefs.filter(
            (reference) =>
              reference.transportReceiptId === receipt.data.transportMessageIdDigest &&
              reference.capabilityDigest === receipt.data.capabilityDigest
          ).length !== 1
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
        if (
          receipt.data.capabilityDigest !== command.data.capabilityDigest ||
          receipt.data.ingressRequestDigest !== command.data.ingressRequestDigest
        )
          return { kind: 'read_only', result: { code: 'TRANSPORT_REPLAY' } };
        if (receipt.data.ingestOutboxId === null) {
          const terminalFailureCode = receipt.data.terminalFailureCode;
          if (terminalFailureCode === null)
            return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
          return { kind: 'read_only', result: { code: terminalFailureCode } };
        }
        const result = capabilityConsumeResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'consume',
          result: 'enqueued',
          runId: capability.data.runId,
          scenarioId: capability.data.scenarioId,
          phase: capability.data.phase,
          turnIndex: capability.data.turnIndex,
          ingestReceiptId: receipt.data.ingestReceiptId,
          ingestOutboxId: receipt.data.ingestOutboxId,
          acceptedAt: receipt.data.acceptedAt,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }

      const storedCapability = draft.capabilities.get(command.data.capabilityDigest);
      if (storedCapability === undefined)
        return current.pair.history.capabilityDigests.includes(command.data.capabilityDigest)
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const capability = matrixCorpusCapabilityV1Schema.safeParse(storedCapability);
      if (
        !capability.success ||
        capability.data.capabilityDigest !== command.data.capabilityDigest ||
        !hasCapabilityAuthority(lease, capability.data) ||
        !current.pair.history.capabilityDigests.includes(capability.data.capabilityDigest)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
      const persistTerminalFailure = (code: FakePersistedCapabilityTerminalFailure): FakeTransactionDecision<CapabilityConsumeResult> => {
        const terminalFailuresForCapability = current.pair.history.terminalFailureReceiptRefs.filter(
          (reference) => reference.capabilityDigest === capability.data.capabilityDigest
        ).length;
        if (
          terminalFailuresForCapability >= MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY ||
          current.pair.history.terminalFailureReceiptRefs.length >= MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN
        )
          return { kind: 'read_only', result: { code: 'TERMINAL_RECEIPT_LIMIT' } };
        const receipt = matrixCorpusTransportReceiptV1Schema.safeParse({
          version: 1,
          transportMessageIdDigest: command.data.transportMessageIdDigest,
          capabilityDigest: capability.data.capabilityDigest,
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          userId: lease.userId,
          promptDigest: command.data.facts.ingressRequest.promptDigest,
          ingressRequestDigest: command.data.ingressRequestDigest,
          ingestReceiptId: null,
          ingestOutboxId: null,
          acceptedAt: null,
          recordedAt: command.data.now,
          terminalFailureCode: code,
        });
        if (!receipt.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.transportReceipts.set(receipt.data.transportMessageIdDigest, receipt.data);
        this.throwAt('consume_after_transport_receipt_draft');

        let unconsumedCapability = lease.unconsumedCapability;
        const closedOutboxIds = new Set<string>();
        if (code === 'CAPABILITY_REPLAY') {
          if (unconsumedCapability !== null) {
            if (unconsumedCapability.digest !== capability.data.capabilityDigest) {
              const pointedCapability = draft.capabilities.get(unconsumedCapability.digest);
              const parsedPointedCapability = matrixCorpusCapabilityV1Schema.safeParse(pointedCapability);
              if (
                !parsedPointedCapability.success ||
                parsedPointedCapability.data.capabilityDigest !== unconsumedCapability.digest ||
                parsedPointedCapability.data.phase !== unconsumedCapability.phase ||
                !hasCapabilityAuthority(lease, parsedPointedCapability.data) ||
                !current.pair.history.capabilityDigests.includes(unconsumedCapability.digest) ||
                parsedPointedCapability.data.consumedAt !== null ||
                parsedPointedCapability.data.revokedAt !== null
              )
                return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
              const revokedCapability = matrixCorpusCapabilityV1Schema.safeParse({
                ...parsedPointedCapability.data,
                revokedAt: command.data.now,
              });
              if (!revokedCapability.success)
                return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
              draft.capabilities.set(revokedCapability.data.capabilityDigest, revokedCapability.data);
              this.throwAt('consume_after_capability_draft');
            }
            unconsumedCapability = null;
          }
          for (const ingestOutboxId of lease.ingestOutboxIds) {
            const storedReplayOutbox = draft.ingestOutboxes.get(ingestOutboxId);
            const replayOutbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(storedReplayOutbox);
            if (
              !replayOutbox.success ||
              replayOutbox.data.ingestOutboxId !== ingestOutboxId ||
              !current.pair.history.ingestOutboxIds.includes(ingestOutboxId) ||
              replayOutbox.data.runId !== lease.runId ||
              replayOutbox.data.userId !== lease.userId ||
              replayOutbox.data.leaseFence !== lease.leaseFence
            )
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
            if (
              replayOutbox.data.status === 'pending' &&
              !lease.nonterminalIngestOutboxIds.includes(ingestOutboxId)
            )
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
            if (replayOutbox.data.status !== 'pending') continue;
            const closedOutbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
              ...replayOutbox.data,
              status: 'closed',
              claim: null,
              publisherReceiptDigest: null,
              publishedAt: null,
              terminalMarker: null,
              closedReason: 'capability_replay',
              acknowledgementReceipts: [],
              lastClaimRenewal: null,
              closedAt: command.data.now,
            });
            if (!closedOutbox.success)
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
            draft.ingestOutboxes.set(closedOutbox.data.ingestOutboxId, closedOutbox.data);
            closedOutboxIds.add(closedOutbox.data.ingestOutboxId);
          }
          if (closedOutboxIds.size > 0) this.throwAt('consume_after_outbox_draft');
        }
        const provisional = {
          ...lease,
          phase: code === 'CAPABILITY_REPLAY' ? 'quiescing' : lease.phase,
          quiescedAt: code === 'CAPABILITY_REPLAY' ? command.data.now : lease.quiescedAt,
          unconsumedCapability,
          terminalFailureReceiptRefs: [
            ...lease.terminalFailureReceiptRefs,
            { transportReceiptId: receipt.data.transportMessageIdDigest, capabilityDigest: capability.data.capabilityDigest },
          ],
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter((id) => !closedOutboxIds.has(id)),
          transportReceiptIds: [...lease.transportReceiptIds, receipt.data.transportMessageIdDigest],
          drain: { ...lease.drain, drained: false },
        } satisfies MatrixCorpusLeaseV1;
        const updated = {
          ...provisional,
          drain: { ...provisional.drain, drained: hasDrainedLeaseState(provisional) },
        } satisfies MatrixCorpusLeaseV1;
        const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
        if (pair === null)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        this.writeCurrentPair(draft, pair);
        this.writeHistoryPair(draft, pair);
        this.throwAt('consume_after_lease_pair_draft');
        return { kind: 'commit', result: { code } };
      };
      const now = parseEpochMilliseconds(command.data.now);
      const leaseExpiresAt = parseEpochMilliseconds(lease.expiresAt);
      const capabilityIssuedAt = parseEpochMilliseconds(capability.data.issuedAt);
      const capabilityExpiresAt = parseEpochMilliseconds(capability.data.expiresAt);
      if (now === null || leaseExpiresAt === null || capabilityIssuedAt === null || capabilityExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= leaseExpiresAt)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'active')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (capability.data.consumedAt !== null) return persistTerminalFailure('CAPABILITY_REPLAY');
      if (capability.data.revokedAt !== null) return persistTerminalFailure('CAPABILITY_REVOKED');
      if (now > capabilityExpiresAt + 30_000)
        return persistTerminalFailure('CAPABILITY_EXPIRED');
      if (now < capabilityIssuedAt - 30_000 || !matchesCapabilityFacts(capability.data, command.data.facts))
        return persistTerminalFailure('CAPABILITY_MISMATCH');
      if (
        lease.unconsumedCapability?.digest !== capability.data.capabilityDigest ||
        lease.unconsumedCapability.phase !== capability.data.phase
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease' } };
      if (lease.nonterminalIngestOutboxIds.length !== 0)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: 'active' } };
      const existingOutbox = draft.ingestOutboxes.get(command.data.ingestOutboxId);
      if (existingOutbox !== undefined)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };

      const consumedCapability = matrixCorpusCapabilityV1Schema.safeParse({
        ...capability.data,
        consumedAt: command.data.now,
        consumedTransportMessageIdDigest: command.data.transportMessageIdDigest,
        ingestOutboxId: command.data.ingestOutboxId,
      });
      const receipt = matrixCorpusTransportReceiptV1Schema.safeParse({
        version: 1,
        transportMessageIdDigest: command.data.transportMessageIdDigest,
        capabilityDigest: capability.data.capabilityDigest,
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        userId: lease.userId,
        promptDigest: command.data.facts.ingressRequest.promptDigest,
        ingressRequestDigest: command.data.ingressRequestDigest,
        ingestReceiptId: command.data.ingestReceiptId,
        ingestOutboxId: command.data.ingestOutboxId,
        acceptedAt: command.data.now,
        recordedAt: command.data.now,
        terminalFailureCode: null,
      });
      const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        version: 1,
        ingestOutboxId: command.data.ingestOutboxId,
        ingestReceiptId: command.data.ingestReceiptId,
        runId: lease.runId,
        userId: lease.userId,
        leaseFence: lease.leaseFence,
        payload: command.data.facts.payload,
        payloadDigest: command.data.payloadDigest,
        status: 'pending',
        claim: null,
        publisherReceiptDigest: null,
        publishedAt: null,
        terminalMarker: null,
        closedReason: null,
        acknowledgementReceipts: [],
        lastClaimRenewal: null,
        closedAt: null,
        createdAt: command.data.now,
      });
      if (!consumedCapability.success || !receipt.success || !outbox.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.capabilities.set(consumedCapability.data.capabilityDigest, consumedCapability.data);
      this.throwAt('consume_after_capability_draft');
      draft.transportReceipts.set(receipt.data.transportMessageIdDigest, receipt.data);
      this.throwAt('consume_after_transport_receipt_draft');
      draft.ingestOutboxes.set(outbox.data.ingestOutboxId, outbox.data);
      this.throwAt('consume_after_outbox_draft');
      const updated = {
        ...lease,
        unconsumedCapability: null,
        nonterminalIngestOutboxIds: [outbox.data.ingestOutboxId],
        ingestOutboxIds: [...lease.ingestOutboxIds, outbox.data.ingestOutboxId],
        transportReceiptIds: [...lease.transportReceiptIds, receipt.data.transportMessageIdDigest],
        drain: {
          ...lease.drain,
          consumedCapabilityCount: lease.drain.consumedCapabilityCount + 1,
          drained: false,
        },
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('consume_after_lease_pair_draft');
      const result = capabilityConsumeResultSchema.safeParse({
        code: 'INGEST_ENQUEUED',
        runId: consumedCapability.data.runId,
        scenarioId: consumedCapability.data.scenarioId,
        phase: consumedCapability.data.phase,
        turnIndex: consumedCapability.data.turnIndex,
        ingestReceiptId: receipt.data.ingestReceiptId,
        ingestOutboxId: receipt.data.ingestOutboxId,
        acceptedAt: receipt.data.acceptedAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async quiesceRun(input: QuiesceRunCommand): Promise<QuiesceResult> {
    return this.run('quiesce', quiesceResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = quiesceRunCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runtimeAudience !== command.data.runtimeAudience ||
        lease.runId !== command.data.runId ||
        lease.userId !== command.data.userId ||
        lease.leaseFence !== command.data.leaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const replayReceipt = lease.operationReceipts.quiesce;
      if (replayReceipt !== null && replayReceipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest) {
        if (replayReceipt.canonicalRequestDigest !== command.data.canonicalRequestDigest)
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const projection = replayReceipt.replayProjection;
        if (
          replayReceipt.operation !== 'quiesce' ||
          replayReceipt.resultCode !== 'QUIESCED' ||
          projection.operation !== 'quiesce' ||
          projection.result !== 'quiesced' ||
          projection.runId !== lease.runId ||
          projection.leaseFence !== lease.leaseFence ||
          projection.phase !== 'quiescing' ||
          projection.quiescedAt !== lease.quiescedAt
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
        const result = quiesceResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'quiesce',
          result: 'quiesced',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          phase: projection.phase,
          quiescedAt: projection.quiescedAt,
          drained: projection.drained,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const now = parseEpochMilliseconds(command.data.now);
      const expiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || expiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= expiresAt) return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'active')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };

      if (lease.unconsumedCapability !== null) {
        const storedCapability = draft.capabilities.get(lease.unconsumedCapability.digest);
        const capability = matrixCorpusCapabilityV1Schema.safeParse(storedCapability);
        if (
          !capability.success ||
          capability.data.capabilityDigest !== lease.unconsumedCapability.digest ||
          capability.data.phase !== lease.unconsumedCapability.phase ||
          !hasCapabilityAuthority(lease, capability.data) ||
          !current.pair.history.capabilityDigests.includes(capability.data.capabilityDigest) ||
          capability.data.consumedAt !== null ||
          capability.data.revokedAt !== null
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
        const revoked = matrixCorpusCapabilityV1Schema.safeParse({ ...capability.data, revokedAt: command.data.now });
        if (!revoked.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.capabilities.set(revoked.data.capabilityDigest, revoked.data);
      }
      this.throwAt('quiesce_after_capability_draft');

      const closedOutboxIds = new Set<string>();
      for (const ingestOutboxId of lease.nonterminalIngestOutboxIds) {
        const storedOutbox = draft.ingestOutboxes.get(ingestOutboxId);
        const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(storedOutbox);
        if (
          !outbox.success ||
          outbox.data.ingestOutboxId !== ingestOutboxId ||
          !hasLeaseIdentity(current.pair.history, outbox.data) ||
          !current.pair.history.ingestOutboxIds.includes(ingestOutboxId)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
        const shouldBeReferenced = outbox.data.status !== 'closed';
        if (lease.nonterminalIngestOutboxIds.includes(ingestOutboxId) !== shouldBeReferenced)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
        if (outbox.data.status !== 'pending') continue;
        const closed = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
          ...outbox.data,
          status: 'closed',
          claim: null,
          closedReason: 'quiesced',
          closedAt: command.data.now,
        });
        if (!closed.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.ingestOutboxes.set(closed.data.ingestOutboxId, closed.data);
        closedOutboxIds.add(closed.data.ingestOutboxId);
      }
      this.throwAt('quiesce_after_ingest_outboxes_draft');

      const provisional = {
        ...lease,
        phase: 'quiescing' as const,
        quiescedAt: command.data.now,
        unconsumedCapability: null,
        nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter((id) => !closedOutboxIds.has(id)),
        terminalWinner: null,
        drain: { ...lease.drain, drained: false },
      } satisfies MatrixCorpusLeaseV1;
      const updatedDrain = hasDrainedLeaseState(provisional);
      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'quiesce',
        result: 'quiesced',
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        phase: 'quiescing',
        quiescedAt: command.data.now,
        drained: updatedDrain,
      });
      if (!projection.success || projection.data.operation !== 'quiesce')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusOperationReceiptV1Schema.safeParse({
        version: 1,
        operation: 'quiesce',
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        resultCode: 'QUIESCED',
        replayProjection: projection.data,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const updated = {
        ...provisional,
        operationReceipts: { ...lease.operationReceipts, quiesce: receipt.data },
        drain: { ...provisional.drain, drained: updatedDrain },
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('quiesce_after_lease_pair_draft');
      const result = quiesceResultSchema.safeParse({
        code: 'QUIESCED',
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        phase: 'quiescing',
        quiescedAt: command.data.now,
        drained: updatedDrain,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async releaseRun(input: ReleaseRunCommand): Promise<ReleaseResult> {
    return this.run('release', releaseResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = releaseRunCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runtimeAudience !== command.data.runtimeAudience ||
        lease.runId !== command.data.runId ||
        lease.userId !== command.data.userId ||
        lease.leaseFence !== command.data.leaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const replayReceipt = lease.operationReceipts.release;
      if (replayReceipt !== null && replayReceipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest) {
        if (replayReceipt.canonicalRequestDigest !== command.data.canonicalRequestDigest)
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const projection = replayReceipt.replayProjection;
        const retained =
          projection.operation === 'release' && projection.result === 'release_pending'
            ? draft.terminalControlOutboxes.get(projection.terminalControlId)
            : undefined;
        const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(retained);
        if (
          projection.operation !== 'release' ||
          projection.result !== 'release_pending' ||
          replayReceipt.operation !== 'release' ||
          replayReceipt.resultCode !== 'RELEASE_PENDING' ||
          !terminal.success ||
          terminal.data.terminalControlId !== projection.terminalControlId ||
          terminal.data.eventId !== projection.eventId ||
          terminal.data.runId !== lease.runId ||
          terminal.data.userId !== lease.userId ||
          terminal.data.leaseFence !== lease.leaseFence ||
          terminal.data.kind !== 'release' ||
          terminal.data.createdAt !== projection.createdAt ||
          !lease.terminalControlOutboxIds.includes(projection.terminalControlId)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        const result = releaseResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'release',
          result: 'release_pending',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          terminalControlId: projection.terminalControlId,
          eventId: projection.eventId,
          createdAt: projection.createdAt,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const now = parseEpochMilliseconds(command.data.now);
      const expiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || expiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now >= expiresAt) return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      if (lease.phase !== 'quiescing' || !hasDrainedLeaseState(lease))
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (command.data.controlStatus.kind !== 'status')
        return { kind: 'read_only', result: { code: 'NOT_READY', gate: 'release' } };
      if (
        command.data.terminalControl.createdAt !== command.data.now ||
        command.data.terminalControl.kind !== 'release' ||
        command.data.terminalControlId !== command.data.terminalControl.eventId ||
        command.data.terminalControl.tombstoneDigest !== command.data.controlStatus.contextFinalizationTombstoneDigest ||
        command.data.terminalControl.terminalCandidateDigest !== command.data.controlStatus.terminalCandidateDigest ||
        command.data.terminalControl.artifactStageDigest !== command.data.controlStatus.artifactStageDigest
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      if (draft.terminalControlOutboxes.has(command.data.terminalControlId))
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
      const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        version: 1,
        terminalControlId: command.data.terminalControlId,
        eventId: command.data.terminalControl.eventId,
        runId: lease.runId,
        userId: lease.userId,
        leaseFence: lease.leaseFence,
        kind: 'release',
        payload: command.data.terminalControl,
        payloadDigest: command.data.terminalPayloadDigest,
        status: 'pending',
        claim: null,
        acknowledgedAt: null,
        closedReason: null,
        lastClaimRenewal: null,
        closedAt: null,
        createdAt: command.data.now,
      });
      if (!terminal.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.terminalControlOutboxes.set(terminal.data.terminalControlId, terminal.data);
      this.throwAt('release_after_terminal_outbox_draft');
      const projection = matrixCorpusPersistedReplayProjectionV1Schema.safeParse({
        operation: 'release',
        result: 'release_pending',
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        terminalControlId: terminal.data.terminalControlId,
        eventId: terminal.data.eventId,
        createdAt: terminal.data.createdAt,
      });
      if (!projection.success || projection.data.operation !== 'release')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const resultDigest = this.digestProjection(projection.data);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusOperationReceiptV1Schema.safeParse({
        version: 1,
        operation: 'release',
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        resultCode: 'RELEASE_PENDING',
        replayProjection: projection.data,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const updated = {
        ...lease,
        phase: 'release_pending' as const,
        operationReceipts: { ...lease.operationReceipts, release: receipt.data },
        terminalControlOutboxIds: [...lease.terminalControlOutboxIds, terminal.data.terminalControlId],
        terminalWinner: null,
        releasedAt: null,
        abandonedAt: null,
        drain: { ...lease.drain, drained: false },
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('release_after_lease_pair_draft');
      const result = releaseResultSchema.safeParse({
        code: 'RELEASE_PENDING',
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        terminalControlId: terminal.data.terminalControlId,
        eventId: terminal.data.eventId,
        createdAt: terminal.data.createdAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async abandonExpiredRun(input: AbandonExpiredRunCommand): Promise<AbandonPendingResult> {
    return this.run('abandon', abandonPendingResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = abandonExpiredRunCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runtimeAudience !== command.data.runtimeAudience ||
        lease.runId !== command.data.observedRunId ||
        lease.userId !== command.data.observedUserId ||
        lease.leaseFence !== command.data.observedLeaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      if (lease.phase === 'abandon_pending') {
        const retained = draft.terminalControlOutboxes.get(command.data.terminalControlId);
        const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(retained);
        if (
          !terminal.success ||
          terminal.data.terminalControlId !== command.data.terminalControlId ||
          terminal.data.eventId !== command.data.terminalControlId ||
          terminal.data.kind !== 'abandoned' ||
          terminal.data.runId !== lease.runId ||
          terminal.data.userId !== lease.userId ||
          terminal.data.leaseFence !== lease.leaseFence ||
          !lease.terminalControlOutboxIds.includes(command.data.terminalControlId)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        const result = abandonPendingResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'abandon',
          result: 'abandon_pending',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          phase: 'abandon_pending',
          terminalControlId: terminal.data.terminalControlId,
          eventId: terminal.data.eventId,
          reconciledAt: terminal.data.createdAt,
        });
        return result.success
          ? { kind: 'read_only', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const now = parseEpochMilliseconds(command.data.now);
      const expiresAt = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || expiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (now < expiresAt) return { kind: 'read_only', result: { code: 'NOT_READY', gate: 'abandon' } };
      if (
        lease.phase !== 'provisioning' &&
        lease.phase !== 'active' &&
        lease.phase !== 'quiescing' &&
        lease.phase !== 'release_pending'
      )
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (
        command.data.terminalControl.createdAt !== command.data.now ||
        command.data.terminalControl.kind !== 'abandoned' ||
        command.data.terminalControlId !== command.data.terminalControl.eventId ||
        command.data.terminalControl.tombstoneDigest !== null ||
        command.data.terminalControl.terminalCandidateDigest !== null ||
        command.data.terminalControl.artifactStageDigest !== null
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      if (draft.terminalControlOutboxes.has(command.data.terminalControlId))
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };

      if (lease.unconsumedCapability !== null) {
        const storedCapability = draft.capabilities.get(lease.unconsumedCapability.digest);
        const capability = matrixCorpusCapabilityV1Schema.safeParse(storedCapability);
        if (
          !capability.success ||
          capability.data.capabilityDigest !== lease.unconsumedCapability.digest ||
          capability.data.phase !== lease.unconsumedCapability.phase ||
          !hasCapabilityAuthority(lease, capability.data) ||
          !current.pair.history.capabilityDigests.includes(capability.data.capabilityDigest) ||
          capability.data.consumedAt !== null ||
          capability.data.revokedAt !== null
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
        const revoked = matrixCorpusCapabilityV1Schema.safeParse({ ...capability.data, revokedAt: command.data.now });
        if (!revoked.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.capabilities.set(revoked.data.capabilityDigest, revoked.data);
      }
      this.throwAt('abandon_after_capability_draft');

      const closedOutboxIds = new Set<string>();
      for (const ingestOutboxId of lease.nonterminalIngestOutboxIds) {
        const storedOutbox = draft.ingestOutboxes.get(ingestOutboxId);
        const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(storedOutbox);
        if (
          !outbox.success ||
          outbox.data.ingestOutboxId !== ingestOutboxId ||
          !hasLeaseIdentity(current.pair.history, outbox.data) ||
          !current.pair.history.ingestOutboxIds.includes(ingestOutboxId)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
        const shouldBeReferenced = outbox.data.status !== 'closed';
        if (lease.nonterminalIngestOutboxIds.includes(ingestOutboxId) !== shouldBeReferenced)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
        if (outbox.data.status !== 'pending') continue;
        const closed = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
          ...outbox.data,
          status: 'closed',
          claim: null,
          closedReason: 'abandoned',
          closedAt: command.data.now,
        });
        if (!closed.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.ingestOutboxes.set(closed.data.ingestOutboxId, closed.data);
        closedOutboxIds.add(closed.data.ingestOutboxId);
      }
      this.throwAt('abandon_after_ingest_outboxes_draft');

      if (lease.phase === 'release_pending') {
        const releaseId = lease.terminalControlOutboxIds.find((terminalControlId) => {
          const terminal = draft.terminalControlOutboxes.get(terminalControlId);
          return terminal?.kind === 'release';
        });
        if (releaseId === undefined) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        const storedRelease = draft.terminalControlOutboxes.get(releaseId);
        const release = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(storedRelease);
        if (
          !release.success ||
          release.data.terminalControlId !== releaseId ||
          release.data.kind !== 'release' ||
          !hasLeaseIdentity(current.pair.history, release.data)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        if (release.data.status === 'published')
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        if (release.data.status === 'pending') {
          const closedRelease = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
            ...release.data,
            status: 'closed',
            claim: null,
            acknowledgedAt: null,
            closedReason: 'expired_unclaimed_release',
            lastClaimRenewal: null,
            closedAt: command.data.now,
          });
          if (!closedRelease.success)
            return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
          draft.terminalControlOutboxes.set(releaseId, closedRelease.data);
        }
        this.throwAt('abandon_after_release_outbox_draft');
      }

      const abandoned = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
        version: 1,
        terminalControlId: command.data.terminalControlId,
        eventId: command.data.terminalControl.eventId,
        runId: lease.runId,
        userId: lease.userId,
        leaseFence: lease.leaseFence,
        kind: 'abandoned',
        payload: command.data.terminalControl,
        payloadDigest: command.data.terminalPayloadDigest,
        status: 'pending',
        claim: null,
        acknowledgedAt: null,
        closedReason: null,
        lastClaimRenewal: null,
        closedAt: null,
        createdAt: command.data.now,
      });
      if (!abandoned.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.terminalControlOutboxes.set(abandoned.data.terminalControlId, abandoned.data);
      this.throwAt('abandon_after_terminal_outbox_draft');
      const updated = {
        ...lease,
        phase: 'abandon_pending' as const,
        unconsumedCapability: null,
        nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter((id) => !closedOutboxIds.has(id)),
        terminalControlOutboxIds: [...lease.terminalControlOutboxIds, abandoned.data.terminalControlId],
        terminalWinner: null,
        releasedAt: null,
        abandonedAt: null,
        priorFinalCleanupReceipts: [],
        finalCleanupReceipt: lease.phase === 'provisioning' ? null : lease.finalCleanupReceipt,
        drain: { ...lease.drain, drained: false },
      } satisfies MatrixCorpusLeaseV1;
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updated);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('abandon_after_lease_pair_draft');
      const result = abandonPendingResultSchema.safeParse({
        code: 'ABANDON_PENDING',
        runId: lease.runId,
        leaseFence: lease.leaseFence,
        phase: 'abandon_pending',
        terminalControlId: abandoned.data.terminalControlId,
        eventId: abandoned.data.eventId,
        reconciledAt: abandoned.data.createdAt,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async getTransportStatus(input: GetTransportStatusCommand): Promise<TransportStatusResult> {
    return this.runStatus(
      transportStatusResultSchema,
      { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
      () => {
        const command = getTransportStatusCommandSchema.safeParse(input);
        if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
        const current = this.readCurrentPair(this.state, command.data.leaseSlotDigest);
        if (current.kind === 'missing') return { code: 'NOT_FOUND' };
        if (current.kind === 'corrupt') return { code: 'CORRUPT_STATE', recordKind: current.recordKind };
        const lease = current.pair.current;
        if (
          lease.runtimeAudience !== command.data.runtimeAudience ||
          lease.runId !== command.data.runId ||
          lease.userId !== command.data.userId ||
          lease.leaseFence !== command.data.leaseFence ||
          lease.runFenceDigest !== command.data.runFenceDigest
        )
          return { code: 'STALE_FENCE' };
        const now = parseEpochMilliseconds(command.data.now);
        const expiresAt = parseEpochMilliseconds(lease.expiresAt);
        if (now === null || expiresAt === null) return { code: 'CORRUPT_STATE', recordKind: 'lease' };
        if (
          (lease.phase === 'provisioning' ||
            lease.phase === 'active' ||
            lease.phase === 'quiescing' ||
            lease.phase === 'release_pending') &&
          now >= expiresAt
        )
          return { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt };
        if (lease.drain.drained !== hasDrainedLeaseState(lease))
          return { code: 'CORRUPT_STATE', recordKind: 'lease' };
        return {
          code: 'TRANSPORT_STATUS',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          phase: lease.phase,
          consumedCapabilityCount: lease.drain.consumedCapabilityCount,
          terminalIntexMarkerCount: lease.drain.terminalIntexMarkerCount,
          terminalOutboxCount: lease.drain.terminalOutboxCount,
          replyOrDeliveryWorkInFlight: lease.drain.replyOrDeliveryWorkInFlight,
          nonterminalIngestOutboxCount: lease.nonterminalIngestOutboxIds.length,
          drained: lease.drain.drained,
        };
      }
    );
  }

  public async cleanupExactRun(input: CleanupExactRunCommand): Promise<CleanupResult> {
    return this.run('cleanup', cleanupResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = cleanupExactRunCommandSchema.safeParse(input);
      if (!command.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt')
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runtimeAudience !== command.data.runtimeAudience ||
        lease.runId !== command.data.currentRunId ||
        lease.userId !== command.data.userId ||
        lease.leaseFence !== command.data.currentLeaseFence ||
        lease.runFenceDigest !== command.data.currentRunFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };

      const finalReceipts = [
        ...(lease.priorFinalCleanupReceipts ?? []),
        ...(lease.finalCleanupReceipt === null ? [] : [lease.finalCleanupReceipt]),
      ];
      const finalReplayReceipt = finalReceipts.find((receipt) => {
        const projection = receipt.replayProjection;
        return (
          projection.operation === 'cleanup' &&
          projection.result === 'cleaned' &&
          projection.targetRunFenceDigest === command.data.targetRunFenceDigest
        );
      });
      if (
        finalReplayReceipt !== undefined &&
        finalReplayReceipt.idempotencyKeyDigest !== command.data.idempotencyKeyDigest
      )
        return {
          kind: 'read_only',
          result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase },
        };
      for (const finalReceipt of finalReceipts) {
        const parsed = matrixCorpusCleanupChunkReceiptV1Schema.safeParse(finalReceipt);
        if (
          !parsed.success ||
          parsed.data.replayProjection.operation !== 'cleanup' ||
          parsed.data.replayProjection.result !== 'cleaned'
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'cleanup_progress' } };
        const storedDigest = this.digestProjection(parsed.data.replayProjection);
        if (storedDigest === null || storedDigest !== parsed.data.resultDigest)
          return {
            kind: 'read_only',
            result: {
              code: 'CORRUPT_STATE',
              recordKind: storedDigest === null ? 'dependency_result' : 'cleanup_progress',
            },
          };
      }
      if (finalReplayReceipt !== undefined) {
        const parsed = matrixCorpusCleanupChunkReceiptV1Schema.safeParse(finalReplayReceipt);
        if (
          !parsed.success ||
          parsed.data.replayProjection.operation !== 'cleanup' ||
          parsed.data.replayProjection.result !== 'cleaned'
        )
          return {
            kind: 'read_only',
            result: { code: 'CORRUPT_STATE', recordKind: 'cleanup_progress' },
          };
        const projection = parsed.data.replayProjection;
        if (
          parsed.data.canonicalRequestDigest !== command.data.canonicalRequestDigest ||
          parsed.data.expectedRevision !== command.data.expectedRevision ||
          projection.targetRunId !== command.data.targetRunId ||
          projection.targetLeaseFence !== command.data.targetLeaseFence ||
          projection.targetRunFenceDigest !== command.data.targetRunFenceDigest
        )
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const replay = cleanupResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'cleanup',
          result: 'cleaned',
          targetRunId: projection.targetRunId,
          targetLeaseFence: projection.targetLeaseFence,
          targetRunFenceDigest: projection.targetRunFenceDigest,
          finalRevision: projection.finalRevision,
          cleanedAt: projection.cleanedAt,
        });
        return replay.success
          ? { kind: 'read_only', result: replay.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      if (
        finalReceipts.some(
          (receipt) => receipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest
        )
      )
        return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
      if (finalReceipts.length >= 3)
        return {
          kind: 'read_only',
          result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase },
        };
      if (lease.phase !== 'provisioning')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };

      const storedTarget = draft.leaseHistories.get(command.data.targetRunFenceDigest);
      if (storedTarget === undefined) return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const target = matrixCorpusLeaseHistoryV1Schema.safeParse(storedTarget);
      if (!target.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
      if (target.data.leaseSlotDigest !== command.data.leaseSlotDigest)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
      if (
        target.data.runId !== command.data.targetRunId ||
        target.data.userId !== command.data.userId ||
        target.data.leaseFence !== command.data.targetLeaseFence ||
        target.data.runFenceDigest !== command.data.targetRunFenceDigest
      )
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      if (target.data.phase !== 'released' && target.data.phase !== 'abandoned')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: target.data.phase } };

      const progress = target.data.cleanupProgress;
      const priorReceipts = progress?.chunkReceipts ?? [];
      const priorRevision = progress?.revision ?? 0;
      const remaining = progress?.remaining ?? {
        renewReceiptIds: [...target.data.renewReceiptIds].sort(compareBytewise),
        capabilityIssuanceReceiptIds: [...target.data.capabilityIssuanceReceiptIds].sort(compareBytewise),
        capabilityDigests: [...target.data.capabilityDigests].sort(compareBytewise),
        transportReceiptIds: [...target.data.transportReceiptIds].sort(compareBytewise),
        ingestOutboxIds: [...target.data.ingestOutboxIds].sort(compareBytewise),
        terminalControlOutboxIds: [...target.data.terminalControlOutboxIds].sort(compareBytewise),
      };
      const replayReceipt = priorReceipts.find(
        (receipt) => receipt.idempotencyKeyDigest === command.data.idempotencyKeyDigest
      );
      if (replayReceipt !== undefined) {
        const parsed = matrixCorpusCleanupChunkReceiptV1Schema.safeParse(replayReceipt);
        if (!parsed.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'cleanup_progress' } };
        const storedDigest = this.digestProjection(parsed.data.replayProjection);
        if (storedDigest === null || storedDigest !== parsed.data.resultDigest)
          return {
            kind: 'read_only',
            result: {
              code: 'CORRUPT_STATE',
              recordKind: storedDigest === null ? 'dependency_result' : 'cleanup_progress',
            },
          };
        const projection = parsed.data.replayProjection;
        if (
          parsed.data.canonicalRequestDigest !== command.data.canonicalRequestDigest ||
          parsed.data.expectedRevision !== command.data.expectedRevision ||
          projection.operation !== 'cleanup' ||
          projection.result !== 'progress' ||
          projection.targetRunId !== command.data.targetRunId ||
          projection.targetLeaseFence !== command.data.targetLeaseFence ||
          projection.targetRunFenceDigest !== command.data.targetRunFenceDigest
        )
          return { kind: 'read_only', result: { code: 'IDEMPOTENCY_CONFLICT' } };
        const replay = cleanupResultSchema.safeParse({
          code: 'ALREADY_APPLIED',
          operation: 'cleanup',
          result: 'progress',
          targetRunId: projection.targetRunId,
          targetLeaseFence: projection.targetLeaseFence,
          targetRunFenceDigest: projection.targetRunFenceDigest,
          committedRevision: projection.committedRevision,
          remainingChildCount: projection.remainingChildCount,
          chunkCommittedAt: projection.chunkCommittedAt,
        });
        return replay.success
          ? { kind: 'read_only', result: replay.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      if (command.data.expectedRevision !== priorRevision)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: target.data.phase } };

      const deletes: readonly [keyof typeof remaining, 'renew_receipt' | 'issuance_receipt' | 'capability' | 'transport_receipt' | 'ingest_outbox' | 'terminal_outbox'][] = [
        ['renewReceiptIds', 'renew_receipt'],
        ['capabilityIssuanceReceiptIds', 'issuance_receipt'],
        ['capabilityDigests', 'capability'],
        ['transportReceiptIds', 'transport_receipt'],
        ['ingestOutboxIds', 'ingest_outbox'],
        ['terminalControlOutboxIds', 'terminal_outbox'],
      ];
      let allowance = 96;
      const nextRemaining = structuredClone(remaining);
      const plannedDeletes: [keyof typeof remaining, string][] = [];
      for (const [field] of deletes) {
        while (allowance > 0 && nextRemaining[field].length > 0) {
          const key = nextRemaining[field][0];
          if (key === undefined) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'cleanup_progress' } };
          if (field === 'renewReceiptIds') {
            const perRun = draft.renewReceiptsByRun.get(target.data.runFenceDigest);
            const parsed = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({ history: target.data, receipt: perRun?.get(key) });
            if (!parsed.success || parsed.data.receipt.idempotencyKeyDigest !== key || !remaining.renewReceiptIds.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'renew_receipt' } };
          } else if (field === 'capabilityIssuanceReceiptIds') {
            const perRun = draft.capabilityIssuanceReceiptsByRun.get(target.data.runFenceDigest);
            const parsed = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({ history: target.data, receipt: perRun?.get(key) });
            if (!parsed.success || parsed.data.receipt.matrixIdempotencyKeyDigest !== key || !remaining.capabilityIssuanceReceiptIds.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'issuance_receipt' } };
          } else if (field === 'capabilityDigests') {
            const parsed = matrixCorpusCapabilityV1Schema.safeParse(draft.capabilities.get(key));
            if (!parsed.success || parsed.data.capabilityDigest !== key || !hasLeaseIdentity(target.data, parsed.data) || !target.data.capabilityDigests.includes(key) || !remaining.capabilityDigests.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'capability' } };
          } else if (field === 'transportReceiptIds') {
            const parsed = matrixCorpusTransportReceiptV1Schema.safeParse(draft.transportReceipts.get(key));
            if (!parsed.success || parsed.data.transportMessageIdDigest !== key || !hasLeaseIdentity(target.data, parsed.data) || !target.data.transportReceiptIds.includes(key) || !remaining.transportReceiptIds.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' } };
          } else if (field === 'ingestOutboxIds') {
            const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(draft.ingestOutboxes.get(key));
            if (!parsed.success || parsed.data.ingestOutboxId !== key || !hasLeaseIdentity(target.data, parsed.data) || !target.data.ingestOutboxIds.includes(key) || !remaining.ingestOutboxIds.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
          } else {
            const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(draft.terminalControlOutboxes.get(key));
            if (!parsed.success || parsed.data.terminalControlId !== key || !hasLeaseIdentity(target.data, parsed.data) || !target.data.terminalControlOutboxIds.includes(key) || !remaining.terminalControlOutboxIds.includes(key))
              return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
          }
          plannedDeletes.push([field, key]);
          nextRemaining[field].shift();
          allowance -= 1;
        }
      }
      const applyPlannedDeletes = (): void => {
        for (const [field, key] of plannedDeletes) {
          if (field === 'renewReceiptIds') {
            const perRun = draft.renewReceiptsByRun.get(target.data.runFenceDigest);
            if (perRun?.delete(key) !== true) throw new FakeMatrixCorpusRepositoryFault();
            if (perRun.size === 0) draft.renewReceiptsByRun.delete(target.data.runFenceDigest);
          } else if (field === 'capabilityIssuanceReceiptIds') {
            const perRun = draft.capabilityIssuanceReceiptsByRun.get(target.data.runFenceDigest);
            if (perRun?.delete(key) !== true) throw new FakeMatrixCorpusRepositoryFault();
            if (perRun.size === 0) draft.capabilityIssuanceReceiptsByRun.delete(target.data.runFenceDigest);
          } else if (field === 'capabilityDigests') draft.capabilities.delete(key);
          else if (field === 'transportReceiptIds') draft.transportReceipts.delete(key);
          else if (field === 'ingestOutboxIds') draft.ingestOutboxes.delete(key);
          else draft.terminalControlOutboxes.delete(key);
        }
      };
      const remainingChildCount =
        nextRemaining.renewReceiptIds.length +
        nextRemaining.capabilityIssuanceReceiptIds.length +
        nextRemaining.capabilityDigests.length +
        nextRemaining.transportReceiptIds.length +
        nextRemaining.ingestOutboxIds.length +
        nextRemaining.terminalControlOutboxIds.length;
      const committedRevision = priorRevision + 1;
      if (remainingChildCount > 0) {
        const first = deletes.find(([field]) => nextRemaining[field].length > 0);
        if (first === undefined)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'cleanup_progress' } };
        const projection = {
          operation: 'cleanup' as const,
          result: 'progress' as const,
          targetRunId: target.data.runId,
          targetLeaseFence: target.data.leaseFence,
          targetRunFenceDigest: target.data.runFenceDigest,
          committedRevision,
          remainingChildCount,
          chunkCommittedAt: command.data.now,
        };
        const resultDigest = this.digestProjection(projection);
        if (resultDigest === null)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
        const receipt = matrixCorpusCleanupChunkReceiptV1Schema.safeParse({
          version: 1,
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          expectedRevision: command.data.expectedRevision,
          committedRevision,
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        if (!receipt.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        const updatedProgress = matrixCorpusCleanupProgressV1Schema.safeParse({
          version: 1,
          targetRunId: target.data.runId,
          targetLeaseFence: target.data.leaseFence,
          targetRunFenceDigest: target.data.runFenceDigest,
          revision: committedRevision,
          cursor: { kind: first[1], nextIndex: 0 },
          remaining: nextRemaining,
          chunkReceipts: [...priorReceipts, receipt.data],
        });
        const updatedTarget =
          updatedProgress.success === true
            ? matrixCorpusLeaseHistoryV1Schema.safeParse({ ...target.data, cleanupProgress: updatedProgress.data })
            : { success: false as const };
        const updatedSet =
          updatedTarget.success === true
            ? matrixCorpusCleanupLeaseSetV1Schema.safeParse({ currentPair: current.pair, targetHistory: updatedTarget.data })
            : { success: false as const };
        if (!updatedTarget.success || !updatedSet.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        applyPlannedDeletes();
        this.throwAt('cleanup_after_child_deletes_draft');
        draft.leaseHistories.set(updatedTarget.data.runFenceDigest, updatedTarget.data);
        this.throwAt('cleanup_after_progress_draft');
        const result = cleanupResultSchema.safeParse({
          code: 'RUN_CLEANUP_PROGRESS',
          targetRunId: target.data.runId,
          targetLeaseFence: target.data.leaseFence,
          targetRunFenceDigest: target.data.runFenceDigest,
          committedRevision,
          remainingChildCount,
          chunkCommittedAt: command.data.now,
        });
        return result.success
          ? { kind: 'commit', result: result.data }
          : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }

      const projection = {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId: target.data.runId,
        targetLeaseFence: target.data.leaseFence,
        targetRunFenceDigest: target.data.runFenceDigest,
        finalRevision: committedRevision,
        cleanedAt: command.data.now,
      };
      const resultDigest = this.digestProjection(projection);
      if (resultDigest === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'dependency_result' } };
      const receipt = matrixCorpusCleanupChunkReceiptV1Schema.safeParse({
        version: 1,
        idempotencyKeyDigest: command.data.idempotencyKeyDigest,
        canonicalRequestDigest: command.data.canonicalRequestDigest,
        expectedRevision: command.data.expectedRevision,
        committedRevision,
        replayProjection: projection,
        resultDigest,
        recordedAt: command.data.now,
      });
      if (!receipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      applyPlannedDeletes();
      this.throwAt('cleanup_after_child_deletes_draft');
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, {
        ...lease,
        priorFinalCleanupReceipts: [
          ...(lease.priorFinalCleanupReceipts ?? []),
          ...(lease.finalCleanupReceipt === null ? [] : [lease.finalCleanupReceipt]),
        ],
        finalCleanupReceipt: receipt.data,
      });
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('cleanup_after_final_receipt_pair_draft');
      if (draft.leaseHistories.delete(target.data.runFenceDigest) !== true)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
      this.throwAt('cleanup_after_target_history_delete_draft');
      const result = cleanupResultSchema.safeParse({
        code: 'RUN_CLEANED',
        targetRunId: target.data.runId,
        targetLeaseFence: target.data.leaseFence,
        targetRunFenceDigest: target.data.runFenceDigest,
        finalRevision: committedRevision,
        cleanedAt: command.data.now,
      });
      return result.success
        ? { kind: 'commit', result: result.data }
        : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async claimPendingIngestOutbox(input: ClaimPendingIngestOutboxInput): Promise<IngestClaimResult> {
    return this.run('claim_ingest', ingestClaimResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = claimPendingIngestOutboxInputSchema.safeParse(input);
      if (!command.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt') return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (
        lease.runtimeAudience !== command.data.runtimeAudience || lease.runId !== command.data.runId ||
        lease.userId !== command.data.userId || lease.leaseFence !== command.data.leaseFence ||
        lease.runFenceDigest !== command.data.runFenceDigest
      ) return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const stored = draft.ingestOutboxes.get(command.data.ingestOutboxId);
      const referenced = current.pair.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (stored === undefined)
        return referenced
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(stored);
      if (
        !outbox.success ||
        !referenced ||
        outbox.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(current.pair.history, outbox.data)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
      if (outbox.data.payloadDigest !== command.data.payloadDigest) return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      const now = parseEpochMilliseconds(command.data.now);
      const expiresAt = parseEpochMilliseconds(lease.expiresAt);
      const claimExpiresAt = parseEpochMilliseconds(command.data.claimExpiresAt);
      if (now === null || expiresAt === null || claimExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      if (outbox.data.status === 'closed' || outbox.data.terminalMarker !== null)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const existing = outbox.data.claim;
      const existingExpiresAt = existing === null ? null : parseEpochMilliseconds(existing.expiresAt);
      if (existing !== null && existingExpiresAt === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
      if (existing !== null && existingExpiresAt !== null && existingExpiresAt > now) {
        if (
          existing.ownerDigest !== command.data.ownerDigest ||
          existing.purpose !== command.data.purpose ||
          existing.expiresAt !== command.data.claimExpiresAt
        )
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
        const replay = ingestClaimResultSchema.safeParse({
          code: 'ALREADY_APPLIED', operation: 'claim_ingest', outboxKind: 'ingest', ingestOutboxId: outbox.data.ingestOutboxId,
          runId: outbox.data.runId, leaseFence: outbox.data.leaseFence, ownerDigest: existing.ownerDigest,
          purpose: existing.purpose, claimExpiresAt: existing.expiresAt, payload: outbox.data.payload, payloadDigest: outbox.data.payloadDigest,
        });
        return replay.success ? { kind: 'read_only', result: replay.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      if (
        existing === null &&
        outbox.data.status === 'pending' &&
        command.data.purpose === 'publish' &&
        lease.phase === 'active' &&
        now >= expiresAt
      )
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      const freshPublishEligible =
        outbox.data.status === 'pending' &&
        existing === null &&
        lease.phase === 'active' &&
        now < expiresAt;
      const publishTakeoverEligible =
        outbox.data.status === 'claimed' &&
        existing !== null &&
        existingExpiresAt !== null &&
        now >= existingExpiresAt &&
        (lease.phase === 'active' || lease.phase === 'quiescing');
      const publishEligible =
        command.data.purpose === 'publish' && (freshPublishEligible || publishTakeoverEligible);
      const recoveryEligible =
        command.data.purpose === 'terminal_marker_recovery' && outbox.data.status === 'published' &&
        outbox.data.terminalMarker === null &&
        (lease.phase === 'active' || lease.phase === 'quiescing' || lease.phase === 'abandon_pending' || lease.phase === 'abandoned');
      if (!publishEligible && !recoveryEligible)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const updated = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...outbox.data,
        status: command.data.purpose === 'publish' ? 'claimed' : 'published',
        claim: { ownerDigest: command.data.ownerDigest, purpose: command.data.purpose, claimedAt: command.data.now, expiresAt: command.data.claimExpiresAt },
        lastClaimRenewal: null,
      });
      if (!updated.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.ingestOutboxes.set(updated.data.ingestOutboxId, updated.data);
      this.throwAt('claim_ingest_after_outbox_draft');
      const result = ingestClaimResultSchema.safeParse({
        code: 'OUTBOX_CLAIMED', outboxKind: 'ingest', ingestOutboxId: updated.data.ingestOutboxId,
        runId: updated.data.runId, leaseFence: updated.data.leaseFence, ownerDigest: command.data.ownerDigest,
        purpose: command.data.purpose, claimExpiresAt: command.data.claimExpiresAt, payload: updated.data.payload,
        payloadDigest: updated.data.payloadDigest,
      });
      return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async renewIngestOutboxClaim(input: RenewIngestOutboxClaimInput): Promise<ClaimRenewResult> {
    return this.run('renew_ingest_claim', claimRenewResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = renewIngestOutboxClaimInputSchema.safeParse(input);
      if (!command.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt') return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (lease.runtimeAudience !== command.data.runtimeAudience || lease.runId !== command.data.runId || lease.userId !== command.data.userId || lease.leaseFence !== command.data.leaseFence || lease.runFenceDigest !== command.data.runFenceDigest)
        return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const stored = draft.ingestOutboxes.get(command.data.ingestOutboxId);
      const referenced = current.pair.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (stored === undefined)
        return referenced
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(stored);
      if (
        !outbox.success ||
        !referenced ||
        outbox.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(current.pair.history, outbox.data)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
      if (outbox.data.payloadDigest !== command.data.payloadDigest)
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      if (outbox.data.status === 'closed' || outbox.data.terminalMarker !== null)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const claim = outbox.data.claim;
      const now = parseEpochMilliseconds(command.data.now);
      const previous = parseEpochMilliseconds(command.data.expectedClaimExpiresAt);
      const next = parseEpochMilliseconds(command.data.newClaimExpiresAt);
      if (now === null || previous === null || next === null) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const renewal = outbox.data.lastClaimRenewal;
      if (renewal !== null && renewal.ownerDigest === command.data.ownerDigest && renewal.purpose === command.data.purpose && renewal.previousClaimExpiresAt === command.data.expectedClaimExpiresAt && renewal.claimExpiresAt === command.data.newClaimExpiresAt) {
        const replay = claimRenewResultSchema.safeParse({ code: 'ALREADY_APPLIED', operation: 'renew_claim', outboxKind: 'ingest', ingestOutboxId: outbox.data.ingestOutboxId, runId: outbox.data.runId, leaseFence: outbox.data.leaseFence, ownerDigest: command.data.ownerDigest, purpose: command.data.purpose, previousClaimExpiresAt: renewal.previousClaimExpiresAt, claimExpiresAt: renewal.claimExpiresAt });
        return replay.success ? { kind: 'read_only', result: replay.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const claimedAt = claim === null ? null : parseEpochMilliseconds(claim.claimedAt);
      if (
        claim === null ||
        claimedAt === null ||
        claim.ownerDigest !== command.data.ownerDigest ||
        claim.purpose !== command.data.purpose ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= previous ||
        next <= now ||
        next - now > 300_000
      )
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      const phaseAllowsLiveRenewal =
        lease.phase === 'active' ||
        lease.phase === 'quiescing' ||
        lease.phase === 'abandon_pending' ||
        lease.phase === 'abandoned';
      const validPhase =
        phaseAllowsLiveRenewal &&
        ((command.data.purpose === 'publish' && outbox.data.status === 'claimed') ||
          (command.data.purpose === 'terminal_marker_recovery' &&
            outbox.data.status === 'published' &&
            outbox.data.terminalMarker === null));
      if (!validPhase) return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const updated = matrixCorpusIngestOutboxRecordV1Schema.safeParse({ ...outbox.data, claim: { ...claim, claimedAt: command.data.now, expiresAt: command.data.newClaimExpiresAt }, lastClaimRenewal: { ownerDigest: command.data.ownerDigest, purpose: command.data.purpose, previousClaimExpiresAt: command.data.expectedClaimExpiresAt, claimExpiresAt: command.data.newClaimExpiresAt } });
      if (!updated.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.ingestOutboxes.set(updated.data.ingestOutboxId, updated.data);
      this.throwAt('renew_ingest_claim_after_outbox_draft');
      const result = claimRenewResultSchema.safeParse({ code: 'OUTBOX_CLAIM_RENEWED', outboxKind: 'ingest', ingestOutboxId: updated.data.ingestOutboxId, runId: updated.data.runId, leaseFence: updated.data.leaseFence, ownerDigest: command.data.ownerDigest, purpose: command.data.purpose, previousClaimExpiresAt: command.data.expectedClaimExpiresAt, claimExpiresAt: command.data.newClaimExpiresAt });
      return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async acknowledgeIngestOutbox(input: AcknowledgeIngestOutboxInput): Promise<AcknowledgeResult> {
    return this.run('acknowledge_ingest', acknowledgeResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = acknowledgeIngestOutboxInputSchema.safeParse(input);
      if (!command.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt') return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (lease.runtimeAudience !== command.data.runtimeAudience || lease.runId !== command.data.runId || lease.userId !== command.data.userId || lease.leaseFence !== command.data.leaseFence || lease.runFenceDigest !== command.data.runFenceDigest) return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const stored = draft.ingestOutboxes.get(command.data.ingestOutboxId);
      const referenced = current.pair.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (stored === undefined)
        return referenced
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(stored);
      if (
        !outbox.success ||
        !referenced ||
        outbox.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(current.pair.history, outbox.data)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' } };
      if (
        outbox.data.ingestReceiptId !== command.data.ingestReceiptId ||
        outbox.data.payloadDigest !== command.data.payloadDigest
      )
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      const receipt = outbox.data.acknowledgementReceipts.find((value) => value.outcome.kind === command.data.outcome.kind);
      if (receipt !== undefined) {
        if (receipt.ownerDigest !== command.data.ownerDigest || receipt.claimPurpose !== command.data.claimPurpose || receipt.expectedClaimExpiresAt !== command.data.expectedClaimExpiresAt || !deeplyEqual(receipt.outcome, command.data.outcome)) return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
        const replay = acknowledgeResultSchema.safeParse({ code: 'ALREADY_APPLIED', operation: 'acknowledge_ingest', outboxKind: 'ingest', ingestOutboxId: outbox.data.ingestOutboxId, runId: outbox.data.runId, leaseFence: outbox.data.leaseFence, payloadDigest: outbox.data.payloadDigest, outcome: receipt.outcome, acknowledgedAt: receipt.acknowledgedAt, drained: receipt.drained });
        return replay.success ? { kind: 'read_only', result: replay.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      const claim = outbox.data.claim;
      const now = parseEpochMilliseconds(command.data.now);
      const expiry = parseEpochMilliseconds(command.data.expectedClaimExpiresAt);
      const claimedAt = claim === null ? null : parseEpochMilliseconds(claim.claimedAt);
      if (claim === null || claim.ownerDigest !== command.data.ownerDigest || claim.purpose !== command.data.claimPurpose || claim.expiresAt !== command.data.expectedClaimExpiresAt || now === null || expiry === null || claimedAt === null || now < claimedAt || now >= expiry) return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      const acknowledgedAt = command.data.outcome.kind === 'publication_acknowledged' ? command.data.outcome.publishedAt : command.data.outcome.kind === 'terminal_marker_acknowledged' ? command.data.outcome.terminalMarker.recordedAt : command.data.outcome.closedAt;
      const liveCompletionPhase = lease.phase === 'active' || lease.phase === 'quiescing' || lease.phase === 'abandon_pending' || lease.phase === 'abandoned';
      if (command.data.outcome.kind === 'publication_acknowledged') {
        if (outbox.data.status !== 'claimed' || command.data.claimPurpose !== 'publish' || !liveCompletionPhase)
          return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
        const publicationReceipt = matrixCorpusIngestAcknowledgementReceiptV1Schema.safeParse({
          version: 1,
          ownerDigest: command.data.ownerDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: command.data.expectedClaimExpiresAt,
          outcome: command.data.outcome,
          acknowledgedAt,
          drained: false,
        });
        if (!publicationReceipt.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        const updated = matrixCorpusIngestOutboxRecordV1Schema.safeParse({
          ...outbox.data,
          status: 'published',
          claim: { ...claim, purpose: 'terminal_marker_recovery' },
          publisherReceiptDigest: command.data.outcome.publisherReceiptDigest,
          publishedAt: command.data.outcome.publishedAt,
          acknowledgementReceipts: [publicationReceipt.data],
        });
        if (!updated.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
        draft.ingestOutboxes.set(updated.data.ingestOutboxId, updated.data);
        this.throwAt('acknowledge_ingest_after_outbox_draft');
        const result = acknowledgeResultSchema.safeParse({ code: 'OUTBOX_ACKNOWLEDGED', outboxKind: 'ingest', ingestOutboxId: updated.data.ingestOutboxId, runId: updated.data.runId, leaseFence: updated.data.leaseFence, payloadDigest: updated.data.payloadDigest, outcome: command.data.outcome, acknowledgedAt, drained: false });
        return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }

      let provisionalLease: MatrixCorpusLeaseV1;
      if (command.data.outcome.kind === 'terminal_marker_acknowledged') {
        const publicationReceipt = outbox.data.acknowledgementReceipts[0];
        if (
          outbox.data.status !== 'published' ||
          outbox.data.terminalMarker !== null ||
          command.data.claimPurpose !== 'terminal_marker_recovery' ||
          !liveCompletionPhase
        )
          return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
        if (
          outbox.data.publisherReceiptDigest !== command.data.outcome.publisherReceiptDigest ||
          outbox.data.publishedAt !== command.data.outcome.publishedAt ||
          publicationReceipt?.outcome.kind !== 'publication_acknowledged' ||
          publicationReceipt.outcome.publisherReceiptDigest !== command.data.outcome.publisherReceiptDigest ||
          publicationReceipt.outcome.publishedAt !== command.data.outcome.publishedAt
        )
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
        provisionalLease = {
          ...lease,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => id !== outbox.data.ingestOutboxId
          ),
          drain: {
            ...lease.drain,
            terminalIntexMarkerCount: lease.drain.terminalIntexMarkerCount + 1,
            terminalOutboxCount: lease.drain.terminalOutboxCount + 1,
            replyOrDeliveryWorkInFlight: command.data.outcome.replyOrDeliveryWorkInFlight,
            drained: false,
          },
        };
      } else {
        const validReason =
          (lease.phase === 'quiescing' &&
            (command.data.outcome.reason === 'quiesced' || command.data.outcome.reason === 'capability_replay')) ||
          ((lease.phase === 'abandon_pending' || lease.phase === 'abandoned') &&
            command.data.outcome.reason === 'abandoned');
        if (
          outbox.data.status !== 'claimed' ||
          outbox.data.publisherReceiptDigest !== null ||
          outbox.data.terminalMarker !== null ||
          command.data.claimPurpose !== 'publish' ||
          command.data.outcome.closedAt !== command.data.now ||
          !validReason
        )
          return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
        provisionalLease = {
          ...lease,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => id !== outbox.data.ingestOutboxId
          ),
          drain: { ...lease.drain, drained: false },
        };
      }
      const drained = hasDrainedLeaseState(provisionalLease);
      const updatedLease = {
        ...provisionalLease,
        drain: { ...provisionalLease.drain, drained },
      } satisfies MatrixCorpusLeaseV1;
      const outcomeReceipt = matrixCorpusIngestAcknowledgementReceiptV1Schema.safeParse({
        version: 1,
        ownerDigest: command.data.ownerDigest,
        claimPurpose: command.data.claimPurpose,
        expectedClaimExpiresAt: command.data.expectedClaimExpiresAt,
        outcome: command.data.outcome,
        acknowledgedAt,
        drained,
      });
      if (!outcomeReceipt.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const updated = matrixCorpusIngestOutboxRecordV1Schema.safeParse(
        command.data.outcome.kind === 'terminal_marker_acknowledged'
          ? {
              ...outbox.data,
              terminalMarker: command.data.outcome.terminalMarker,
              acknowledgementReceipts: [...outbox.data.acknowledgementReceipts, outcomeReceipt.data],
            }
          : {
              ...outbox.data,
              status: 'closed',
              closedReason: command.data.outcome.reason,
              closedAt: command.data.outcome.closedAt,
              acknowledgementReceipts: [outcomeReceipt.data],
            }
      );
      if (!updated.success)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.ingestOutboxes.set(updated.data.ingestOutboxId, updated.data);
      this.throwAt('acknowledge_ingest_after_outbox_draft');
      const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updatedLease);
      if (pair === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      this.writeCurrentPair(draft, pair);
      this.writeHistoryPair(draft, pair);
      this.throwAt('acknowledge_ingest_after_lease_pair_draft');
      const result = acknowledgeResultSchema.safeParse({ code: 'OUTBOX_ACKNOWLEDGED', outboxKind: 'ingest', ingestOutboxId: updated.data.ingestOutboxId, runId: updated.data.runId, leaseFence: updated.data.leaseFence, payloadDigest: updated.data.payloadDigest, outcome: command.data.outcome, acknowledgedAt, drained });
      return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async claimPendingTerminalControlOutbox(
    input: ClaimPendingTerminalControlOutboxInput
  ): Promise<TerminalClaimResult> {
    return this.run('claim_terminal', terminalClaimResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = claimPendingTerminalControlOutboxInputSchema.safeParse(input);
      if (!command.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt') return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (lease.runtimeAudience !== command.data.runtimeAudience || lease.runId !== command.data.runId || lease.userId !== command.data.userId || lease.leaseFence !== command.data.leaseFence || lease.runFenceDigest !== command.data.runFenceDigest) return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const stored = draft.terminalControlOutboxes.get(command.data.terminalControlId);
      const referenced = current.pair.history.terminalControlOutboxIds.includes(command.data.terminalControlId);
      if (stored === undefined)
        return referenced
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const outbox = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(stored);
      if (
        !outbox.success ||
        !referenced ||
        outbox.data.terminalControlId !== command.data.terminalControlId ||
        outbox.data.eventId !== command.data.eventId ||
        !hasLeaseIdentity(current.pair.history, outbox.data)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
      if (outbox.data.payloadDigest !== command.data.payloadDigest)
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      if (lease.phase === 'released' || lease.phase === 'abandoned')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (outbox.data.status === 'published' || outbox.data.status === 'closed')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const now = parseEpochMilliseconds(command.data.now);
      const expiry = parseEpochMilliseconds(command.data.claimExpiresAt);
      const leaseExpiry = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || expiry === null || leaseExpiry === null) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const validPhase =
        (outbox.data.kind === 'release' &&
          (lease.phase === 'release_pending' || lease.phase === 'abandon_pending')) ||
        (outbox.data.kind === 'abandoned' && lease.phase === 'abandon_pending');
      if (!validPhase)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const existing = outbox.data.claim;
      const existingExpiry = existing === null ? null : parseEpochMilliseconds(existing.expiresAt);
      if (existing !== null && existingExpiry === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
      if (existing !== null && existingExpiry !== null && existingExpiry > now) {
        if (
          existing.ownerDigest !== command.data.ownerDigest ||
          existing.expiresAt !== command.data.claimExpiresAt
        )
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
        const replay = terminalClaimResultSchema.safeParse({ code: 'ALREADY_APPLIED', operation: 'claim_terminal', outboxKind: 'terminal', terminalControlId: outbox.data.terminalControlId, eventId: outbox.data.eventId, runId: outbox.data.runId, leaseFence: outbox.data.leaseFence, ownerDigest: existing.ownerDigest, claimExpiresAt: existing.expiresAt, payload: outbox.data.payload, payloadDigest: outbox.data.payloadDigest });
        return replay.success ? { kind: 'read_only', result: replay.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      if (outbox.data.kind === 'release' && lease.phase === 'release_pending' && now >= leaseExpiry)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({ ...outbox.data, status: 'claimed', claim: { ownerDigest: command.data.ownerDigest, purpose: 'publish', claimedAt: command.data.now, expiresAt: command.data.claimExpiresAt }, lastClaimRenewal: null });
      if (!updated.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.terminalControlOutboxes.set(updated.data.terminalControlId, updated.data);
      this.throwAt('claim_terminal_after_outbox_draft');
      const result = terminalClaimResultSchema.safeParse({ code: 'OUTBOX_CLAIMED', outboxKind: 'terminal', terminalControlId: updated.data.terminalControlId, eventId: updated.data.eventId, runId: updated.data.runId, leaseFence: updated.data.leaseFence, ownerDigest: command.data.ownerDigest, claimExpiresAt: command.data.claimExpiresAt, payload: updated.data.payload, payloadDigest: updated.data.payloadDigest });
      return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async renewTerminalControlOutboxClaim(
    input: RenewTerminalControlOutboxClaimInput
  ): Promise<ClaimRenewResult> {
    return this.run('renew_terminal_claim', claimRenewResultSchema, { code: 'CORRUPT_STATE', recordKind: 'repository_result' }, (draft) => {
      const command = renewTerminalControlOutboxClaimInputSchema.safeParse(input);
      if (!command.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
      const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
      if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      if (current.kind === 'corrupt') return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
      const lease = current.pair.current;
      if (lease.runtimeAudience !== command.data.runtimeAudience || lease.runId !== command.data.runId || lease.userId !== command.data.userId || lease.leaseFence !== command.data.leaseFence || lease.runFenceDigest !== command.data.runFenceDigest) return { kind: 'read_only', result: { code: 'STALE_FENCE' } };
      const stored = draft.terminalControlOutboxes.get(command.data.terminalControlId);
      const referenced = current.pair.history.terminalControlOutboxIds.includes(command.data.terminalControlId);
      if (stored === undefined)
        return referenced
          ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } }
          : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
      const outbox = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(stored);
      if (
        !outbox.success ||
        !referenced ||
        outbox.data.terminalControlId !== command.data.terminalControlId ||
        outbox.data.eventId !== command.data.eventId ||
        !hasLeaseIdentity(current.pair.history, outbox.data)
      )
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
      if (outbox.data.payloadDigest !== command.data.payloadDigest)
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      if (lease.phase === 'released' || lease.phase === 'abandoned')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      if (outbox.data.status === 'published' || outbox.data.status === 'closed')
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const validPhase =
        (outbox.data.kind === 'release' &&
          (lease.phase === 'release_pending' || lease.phase === 'abandon_pending')) ||
        (outbox.data.kind === 'abandoned' && lease.phase === 'abandon_pending');
      if (!validPhase)
        return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
      const claim = outbox.data.claim;
      const now = parseEpochMilliseconds(command.data.now);
      const previous = parseEpochMilliseconds(command.data.expectedClaimExpiresAt);
      const next = parseEpochMilliseconds(command.data.newClaimExpiresAt);
      const leaseExpiry = parseEpochMilliseconds(lease.expiresAt);
      if (now === null || previous === null || next === null || leaseExpiry === null)
        return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      const renewal = outbox.data.lastClaimRenewal;
      if (renewal !== null && renewal.ownerDigest === command.data.ownerDigest && renewal.previousClaimExpiresAt === command.data.expectedClaimExpiresAt && renewal.claimExpiresAt === command.data.newClaimExpiresAt) {
        const replay = claimRenewResultSchema.safeParse({ code: 'ALREADY_APPLIED', operation: 'renew_claim', outboxKind: 'terminal', terminalControlId: outbox.data.terminalControlId, eventId: outbox.data.eventId, runId: outbox.data.runId, leaseFence: outbox.data.leaseFence, ownerDigest: command.data.ownerDigest, previousClaimExpiresAt: renewal.previousClaimExpiresAt, claimExpiresAt: renewal.claimExpiresAt });
        return replay.success ? { kind: 'read_only', result: replay.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      }
      if (outbox.data.kind === 'release' && lease.phase === 'release_pending' && now >= leaseExpiry)
        return { kind: 'read_only', result: { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt } };
      const claimedAt = claim === null ? null : parseEpochMilliseconds(claim.claimedAt);
      if (
        claim === null ||
        claimedAt === null ||
        claim.ownerDigest !== command.data.ownerDigest ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= previous ||
        next <= now ||
        next - now > 300_000
      )
        return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({ ...outbox.data, claim: { ...claim, claimedAt: command.data.now, expiresAt: command.data.newClaimExpiresAt }, lastClaimRenewal: { ownerDigest: command.data.ownerDigest, previousClaimExpiresAt: command.data.expectedClaimExpiresAt, claimExpiresAt: command.data.newClaimExpiresAt } });
      if (!updated.success) return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
      draft.terminalControlOutboxes.set(updated.data.terminalControlId, updated.data);
      this.throwAt('renew_terminal_claim_after_outbox_draft');
      const result = claimRenewResultSchema.safeParse({ code: 'OUTBOX_CLAIM_RENEWED', outboxKind: 'terminal', terminalControlId: updated.data.terminalControlId, eventId: updated.data.eventId, runId: updated.data.runId, leaseFence: updated.data.leaseFence, ownerDigest: command.data.ownerDigest, previousClaimExpiresAt: command.data.expectedClaimExpiresAt, claimExpiresAt: command.data.newClaimExpiresAt });
      return result.success ? { kind: 'commit', result: result.data } : { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' } };
    });
  }

  public async acknowledgeTerminalControl(
    input: AcknowledgeTerminalControlInput
  ): Promise<TerminalControlAcknowledgementResult> {
    return this.run(
      'acknowledge_terminal',
      terminalControlAcknowledgementResultSchema,
      { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
      (draft) => {
        const command = acknowledgeTerminalControlInputSchema.safeParse(input);
        if (!command.success)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'command' } };
        const current = this.readCurrentPair(draft, command.data.leaseSlotDigest);
        if (current.kind === 'missing') return { kind: 'read_only', result: { code: 'NOT_FOUND' } };
        if (current.kind === 'corrupt')
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: current.recordKind } };
        const lease = current.pair.current;
        if (
          lease.runtimeAudience !== command.data.runtimeAudience ||
          lease.runId !== command.data.runId ||
          lease.userId !== command.data.userId ||
          lease.leaseFence !== command.data.leaseFence ||
          lease.runFenceDigest !== command.data.runFenceDigest
        )
          return { kind: 'read_only', result: { code: 'STALE_FENCE' } };

        const storedRequest = draft.terminalControlOutboxes.get(command.data.requestTerminalControlId);
        const requestReferenced = current.pair.history.terminalControlOutboxIds.includes(
          command.data.requestTerminalControlId
        );
        if (storedRequest === undefined)
          return requestReferenced
            ? { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } }
            : { kind: 'read_only', result: { code: 'NOT_FOUND' } };
        const request = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(storedRequest);
        if (
          !request.success ||
          !requestReferenced ||
          request.data.terminalControlId !== command.data.requestTerminalControlId ||
          request.data.eventId !== command.data.requestEventId ||
          !hasLeaseIdentity(current.pair.history, request.data)
        )
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' } };
        if (request.data.payloadDigest !== command.data.requestPayloadDigest)
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };

        if (request.data.status === 'published') {
          const retainedWinner = lease.terminalWinner;
          if (
            retainedWinner === null ||
            request.data.claim === null ||
            request.data.acknowledgedAt !== retainedWinner.acknowledgedAt
          )
            return {
              kind: 'read_only',
              result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' },
            };
          if (
            request.data.claim.ownerDigest !== command.data.ownerDigest ||
            request.data.claim.expiresAt !== command.data.expectedClaimExpiresAt ||
            !deeplyEqual(retainedWinner, command.data.authoritativeWinner)
          )
            return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };
          const storedWinner = draft.terminalControlOutboxes.get(retainedWinner.eventId);
          const winnerReferenced = current.pair.history.terminalControlOutboxIds.includes(
            retainedWinner.eventId
          );
          const winner = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(storedWinner);
          if (
            !winner.success ||
            !winnerReferenced ||
            winner.data.terminalControlId !== retainedWinner.eventId ||
            winner.data.eventId !== retainedWinner.eventId ||
            winner.data.kind !== retainedWinner.kind ||
            winner.data.payloadDigest !== retainedWinner.payloadDigest ||
            !hasLeaseIdentity(current.pair.history, winner.data) ||
            winner.data.status === 'closed'
          )
            return {
              kind: 'read_only',
              result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' },
            };
          const replay = terminalControlAcknowledgementResultSchema.safeParse({
            code: 'ALREADY_APPLIED',
            operation: 'acknowledge_terminal',
            outboxKind: 'terminal',
            requestTerminalControlId: request.data.terminalControlId,
            requestEventId: request.data.eventId,
            runId: request.data.runId,
            leaseFence: request.data.leaseFence,
            requestPayloadDigest: request.data.payloadDigest,
            authoritativeWinner: retainedWinner,
            leasePhase: retainedWinner.kind === 'release' ? 'released' : 'abandoned',
          });
          return replay.success
            ? { kind: 'read_only', result: replay.data }
            : {
                kind: 'read_only',
                result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
              };
        }

        if (request.data.status !== 'claimed')
          return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
        const claim = request.data.claim;
        const now = parseEpochMilliseconds(command.data.now);
        const claimedAt = claim === null ? null : parseEpochMilliseconds(claim.claimedAt);
        const claimExpiresAt = parseEpochMilliseconds(command.data.expectedClaimExpiresAt);
        if (
          claim === null ||
          now === null ||
          claimedAt === null ||
          claimExpiresAt === null ||
          claim.ownerDigest !== command.data.ownerDigest ||
          claim.expiresAt !== command.data.expectedClaimExpiresAt ||
          now < claimedAt ||
          now >= claimExpiresAt
        )
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };

        const retainedWinner = lease.terminalWinner;
        const pendingPhase = lease.phase === 'release_pending' || lease.phase === 'abandon_pending';
        const finalPhase = lease.phase === 'released' || lease.phase === 'abandoned';
        if (!pendingPhase && !finalPhase)
          return { kind: 'read_only', result: { code: 'PHASE_CONFLICT', actualPhase: lease.phase } };
        if (finalPhase && retainedWinner === null)
          return { kind: 'read_only', result: { code: 'CORRUPT_STATE', recordKind: 'lease' } };
        if (retainedWinner !== null && !deeplyEqual(retainedWinner, command.data.authoritativeWinner))
          return { kind: 'read_only', result: { code: 'CLAIM_CONFLICT' } };

        const authoritativeWinner = retainedWinner ?? command.data.authoritativeWinner;
        const storedWinner = draft.terminalControlOutboxes.get(authoritativeWinner.eventId);
        const winnerReferenced = current.pair.history.terminalControlOutboxIds.includes(
          authoritativeWinner.eventId
        );
        const winner = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(storedWinner);
        if (
          !winner.success ||
          !winnerReferenced ||
          winner.data.terminalControlId !== authoritativeWinner.eventId ||
          winner.data.eventId !== authoritativeWinner.eventId ||
          winner.data.kind !== authoritativeWinner.kind ||
          winner.data.payloadDigest !== authoritativeWinner.payloadDigest ||
          !hasLeaseIdentity(current.pair.history, winner.data) ||
          winner.data.status === 'closed'
        )
          return {
            kind: 'read_only',
            result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' },
          };

        const publishedRequest = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
          ...request.data,
          status: 'published',
          acknowledgedAt: authoritativeWinner.acknowledgedAt,
        });
        if (!publishedRequest.success)
          return {
            kind: 'read_only',
            result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
          };
        draft.terminalControlOutboxes.set(
          publishedRequest.data.terminalControlId,
          publishedRequest.data
        );
        this.throwAt('acknowledge_terminal_after_request_outbox_draft');

        for (const terminalControlId of lease.terminalControlOutboxIds) {
          const stored = draft.terminalControlOutboxes.get(terminalControlId);
          const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(stored);
          if (
            !terminal.success ||
            terminal.data.terminalControlId !== terminalControlId ||
            !hasLeaseIdentity(current.pair.history, terminal.data)
          )
            return {
              kind: 'read_only',
              result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' },
            };
          if (terminalControlId === authoritativeWinner.eventId) continue;
          if (terminal.data.status === 'pending') {
            const closed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
              ...terminal.data,
              status: 'closed',
              closedReason: 'superseded_by_authoritative_winner',
              closedAt: authoritativeWinner.acknowledgedAt,
            });
            if (!closed.success)
              return {
                kind: 'read_only',
                result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
              };
            draft.terminalControlOutboxes.set(closed.data.terminalControlId, closed.data);
          } else if (
            terminal.data.status === 'closed' &&
            terminal.data.closedReason === 'expired_unclaimed_release'
          ) {
            const superseded = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse({
              ...terminal.data,
              closedReason: 'superseded_by_authoritative_winner',
              closedAt: authoritativeWinner.acknowledgedAt,
            });
            if (!superseded.success)
              return {
                kind: 'read_only',
                result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
              };
            draft.terminalControlOutboxes.set(
              superseded.data.terminalControlId,
              superseded.data
            );
          } else if (
            terminal.data.status === 'closed' &&
            (terminal.data.closedReason !== 'superseded_by_authoritative_winner' ||
              terminal.data.closedAt !== authoritativeWinner.acknowledgedAt)
          )
            return {
              kind: 'read_only',
              result: { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' },
            };
        }
        this.throwAt('acknowledge_terminal_after_losing_outbox_draft');

        const updatedLease = {
          ...lease,
          phase: authoritativeWinner.kind === 'release' ? ('released' as const) : ('abandoned' as const),
          terminalWinner: authoritativeWinner,
          releasedAt:
            authoritativeWinner.kind === 'release' ? authoritativeWinner.acknowledgedAt : null,
          abandonedAt:
            authoritativeWinner.kind === 'abandoned' ? authoritativeWinner.acknowledgedAt : null,
          drain: { ...lease.drain, drained: false },
        } satisfies MatrixCorpusLeaseV1;
        const pair = this.buildCurrentPair(command.data.leaseSlotDigest, updatedLease);
        if (pair === null)
          return {
            kind: 'read_only',
            result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
          };
        this.writeCurrentPair(draft, pair);
        this.writeHistoryPair(draft, pair);
        this.throwAt('acknowledge_terminal_after_lease_pair_draft');
        const result = terminalControlAcknowledgementResultSchema.safeParse({
          code: 'OUTBOX_ACKNOWLEDGED',
          outboxKind: 'terminal',
          requestTerminalControlId: publishedRequest.data.terminalControlId,
          requestEventId: publishedRequest.data.eventId,
          runId: publishedRequest.data.runId,
          leaseFence: publishedRequest.data.leaseFence,
          requestPayloadDigest: publishedRequest.data.payloadDigest,
          authoritativeWinner,
          leasePhase: authoritativeWinner.kind === 'release' ? 'released' : 'abandoned',
        });
        return result.success
          ? { kind: 'commit', result: result.data }
          : {
              kind: 'read_only',
              result: { code: 'CORRUPT_STATE', recordKind: 'repository_result' },
            };
      }
    );
  }

  private async run<T>(
    operation: FakeMatrixCorpusMutationOperation,
    resultSchema: ZodType<T>,
    invalidResult: T,
    decide: (draft: FakeMatrixCorpusCoreState) => FakeTransactionDecision<T>
  ): Promise<T> {
    const counts = this.counts.get(operation);
    if (counts === undefined) throw new FakeMatrixCorpusRepositoryFault();
    counts.invocations += 1;
    await this.waitForGate(this.beforeAdmissionGates, operation);
    const releaseMutex = await this.acquireMutex();
    let decision: FakeTransactionDecision<T> | null = null;
    let committed = false;
    try {
      const draft = structuredClone(this.state);
      decision = decide(draft);
      const parsedResult = resultSchema.safeParse(decision.result);
      if (!parsedResult.success) decision = { kind: 'read_only', result: invalidResult };
      else decision = { ...decision, result: parsedResult.data };
      if (decision.kind === 'commit') {
        this.state = { ...draft, version: this.state.version + 1 };
        counts.commits += 1;
        committed = true;
      }
    } finally {
      releaseMutex();
    }
    if (decision === null) throw new FakeMatrixCorpusRepositoryFault();
    if (!committed) return structuredClone(decision.result);
    await this.waitForGate(this.afterCommitGates, operation);
    if (this.responseLossOperations.delete(operation)) throw new FakeMatrixCorpusRepositoryFault();
    return structuredClone(decision.result);
  }

  private async runStatus<T>(resultSchema: ZodType<T>, invalidResult: T, decide: () => T): Promise<T> {
    const counts = this.counts.get('status');
    if (counts === undefined) throw new FakeMatrixCorpusRepositoryFault();
    counts.invocations += 1;
    await this.waitForGate(this.beforeAdmissionGates, 'status');
    const releaseMutex = await this.acquireMutex();
    let result: T;
    try {
      const parsed = resultSchema.safeParse(decide());
      result = parsed.success ? parsed.data : invalidResult;
    } finally {
      releaseMutex();
    }
    return structuredClone(result);
  }

  private isPristine(): boolean {
    return (
      this.state.version === 0 &&
      this.faultStages.size === 0 &&
      this.responseLossOperations.size === 0 &&
      [...this.beforeAdmissionGates.values()].every((queue) => queue.length === 0) &&
      [...this.afterCommitGates.values()].every((queue) => queue.length === 0) &&
      [...this.counts.values()].every((counts) => counts.invocations === 0 && counts.commits === 0)
    );
  }

  private async acquireMutex(): Promise<() => void> {
    let release = (): void => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.mutexTail;
    this.mutexTail = previous.then(() => next);
    await previous;
    return release;
  }

  private async waitForGate<T extends string>(
    gates: Map<T, FakeMatrixCorpusDeferredGate[]>,
    operation: T
  ): Promise<void> {
    const queue = gates.get(operation);
    if (queue === undefined) throw new FakeMatrixCorpusRepositoryFault();
    const gate = queue.shift();
    if (gate === undefined) return;
    gate.enter();
    await gate.awaitRelease;
  }

  private readCurrentPair(state: FakeMatrixCorpusCoreState, leaseSlotDigest: string): FakeCurrentPairRead {
    const current = state.leaseSlots.get(leaseSlotDigest);
    if (current === undefined) return { kind: 'missing' };
    const history = state.leaseHistories.get(current.runFenceDigest);
    if (history === undefined || history.runFenceDigest !== current.runFenceDigest)
      return { kind: 'corrupt', recordKind: 'lease_history' };
    const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
      leaseSlotDigest,
      current,
      history,
    });
    if (!pair.success) return { kind: 'corrupt', recordKind: 'lease_history' };
    return { kind: 'found', pair: pair.data };
  }

  private hasResolvedTerminalFailureReferences(
    history: MatrixCorpusLeaseHistoryV1,
    state: FakeMatrixCorpusCoreState
  ): boolean {
    return history.terminalFailureReceiptRefs.every((reference) => {
      const receipt = state.transportReceipts.get(reference.transportReceiptId);
      return (
        receipt !== undefined &&
        receipt.transportMessageIdDigest === reference.transportReceiptId &&
        receipt.terminalFailureCode !== null &&
        receipt.capabilityDigest === reference.capabilityDigest &&
        state.capabilities.has(reference.capabilityDigest)
      );
    });
  }

  private buildCurrentPair(
    leaseSlotDigest: string,
    current: MatrixCorpusLeaseV1
  ): MatrixCorpusCurrentLeaseHistoryPairV1 | null {
    const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
      leaseSlotDigest,
      current,
      history: { leaseSlotDigest, ...current },
    });
    if (!pair.success) return null;
    return pair.data;
  }

  private writeCurrentPair(state: FakeMatrixCorpusCoreState, pair: MatrixCorpusCurrentLeaseHistoryPairV1): void {
    state.leaseSlots.set(pair.leaseSlotDigest, pair.current);
  }

  private writeHistoryPair(state: FakeMatrixCorpusCoreState, pair: MatrixCorpusCurrentLeaseHistoryPairV1): void {
    state.leaseHistories.set(pair.history.runFenceDigest, pair.history);
  }

  private digestProjection(
    projection: Parameters<MatrixCorpusRepositoryDependencies['replayProjectionDigest']['digest']>[0]
  ): string | null {
    try {
      const digest = matrixCorpusSha256DigestSchema.safeParse(
        this.dependencies.replayProjectionDigest.digest(structuredClone(projection))
      );
      return digest.success ? digest.data : null;
    } catch {
      return null;
    }
  }

  private throwAt(stage: FakeMatrixCorpusCoreFaultStage): void {
    if (this.faultStages.delete(stage)) throw new FakeMatrixCorpusRepositoryFault();
  }
}
