/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Firestore data is untrusted at runtime even after schema narrowing. */
import type { Firestore } from '@intexuraos/infra-firestore';
import { z } from 'zod';

import type {
  MatrixCorpusSignedEnvelopeStore,
  SignedEnvelopeAuthority,
  SignedIngestEnvelopeStoreInput,
  SignedTerminalEnvelopeStoreInput,
} from '../../domain/matrixCorpus/ports/signedEnvelopeStore.js';
import type {
  MatrixCorpusLeaseBindingAuthorizationPort,
  MatrixCorpusLeaseBindingAuthorizationResult,
} from '../../domain/matrixCorpus/ports/matrixCorpusRouteControlPlane.js';
import type {
  MatrixCorpusRepository,
  MatrixCorpusRepositoryDependencies,
} from '../../domain/matrixCorpus/ports/matrixCorpusRepository.js';
import {
  acquireProvisioningLeaseCommandSchema,
  abandonExpiredRunCommandSchema,
  abandonPendingResultSchema,
  activateRunCommandSchema,
  activationResultSchema,
  capabilityConsumeResultSchema,
  capabilityIssueResultSchema,
  acknowledgeIngestOutboxInputSchema,
  acknowledgeResultSchema,
  acknowledgeTerminalControlInputSchema,
  claimPendingIngestOutboxInputSchema,
  claimPendingTerminalControlOutboxInputSchema,
  claimRenewResultSchema,
  cleanupExactRunCommandSchema,
  cleanupResultSchema,
  consumeCapabilityAndEnqueueIngestCommandSchema,
  ingestClaimResultSchema,
  issueCapabilityCommandSchema,
  matrixSendProofResultSchema,
  matrixCorpusCapabilityIssuanceReceiptV1Schema,
  matrixCorpusCleanupChunkReceiptV1Schema,
  matrixCorpusCleanupLeaseSetV1Schema,
  matrixCorpusCleanupProgressV1Schema,
  matrixCorpusCurrentLeaseHistoryPairV1Schema,
  matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema,
  matrixCorpusLeaseHistoryRenewReceiptPairV1Schema,
  matrixCorpusLeaseHistoryV1Schema,
  matrixCorpusLeaseV1Schema,
  matrixCorpusOperationReceiptV1Schema,
  matrixCorpusPersistedReplayProjectionV1Schema,
  matrixCorpusRenewReceiptV1Schema,
  matrixCorpusIngestDeliveryAttestationV1Schema,
  matrixCorpusIngestAcknowledgementReceiptV1Schema,
  matrixCorpusIngestOutboxRecordV1Schema,
  matrixCorpusTerminalControlOutboxRecordV1Schema,
  matrixCorpusTerminalDeliveryAttestationV1Schema,
  matrixCorpusTransportReceiptV1Schema,
  MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN,
  MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY,
  MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN,
  renewIngestOutboxClaimInputSchema,
  renewLeaseCommandSchema,
  renewTerminalControlOutboxClaimInputSchema,
  leaseRenewResultSchema,
  provisioningLeaseResultSchema,
  recordMatrixSendProofCommandSchema,
  quiesceResultSchema,
  quiesceRunCommandSchema,
  releaseResultSchema,
  releaseRunCommandSchema,
  terminalClaimResultSchema,
  terminalControlAcknowledgementResultSchema,
  transportStatusResultSchema,
  getTransportStatusCommandSchema,
  type AbandonExpiredRunCommand,
  type AbandonPendingResult,
  type AcknowledgeTerminalControlInput,
  type AcquireProvisioningLeaseCommand,
  type AcknowledgeIngestOutboxInput,
  type AcknowledgeResult,
  type ActivateRunCommand,
  type ActivationResult,
  type CapabilityConsumeResult,
  type CapabilityIssueResult,
  type ClaimRenewResult,
  type ClaimPendingIngestOutboxInput,
  type ClaimPendingTerminalControlOutboxInput,
  type CleanupExactRunCommand,
  type CleanupResult,
  type ConsumeCapabilityAndEnqueueIngestCommand,
  type IngestClaimResult,
  type IssueCapabilityCommand,
  type MatrixSendProofResult,
  type RecordMatrixSendProofCommand,
  type RenewIngestOutboxClaimInput,
  type RenewTerminalControlOutboxClaimInput,
  type TerminalClaimResult,
  type TerminalControlAcknowledgementResult,
  type MatrixCorpusKeyedDigestPort,
  type MatrixCorpusPersistedReplayProjectionV1,
  type LeaseRenewResult,
  type ProvisioningLeaseResult,
  type QuiesceResult,
  type QuiesceRunCommand,
  type ReleaseResult,
  type ReleaseRunCommand,
  type RenewLeaseCommand,
  type GetTransportStatusCommand,
  type TransportStatusResult,
} from '../../domain/matrixCorpus/types.js';
import {
  matrixCorpusCapabilityV1Schema,
  matrixCorpusDecimalFenceSchema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusSafeIdSchema,
  matrixCorpusSha256DigestSchema,
} from '@intexuraos/http-contracts';

export const MATRIX_CORPUS_RUN_LEASES_COLLECTION = 'matrix_corpus_run_leases';
export const MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION = 'matrix_corpus_ingest_outbox';
export const MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION =
  'matrix_corpus_terminal_control_outbox';
export const MATRIX_CORPUS_CAPABILITIES_COLLECTION = 'matrix_corpus_capabilities';
export const MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION = 'matrix_corpus_transport_receipts';

const MATRIX_CORPUS_RENEW_RECEIPTS_SUBCOLLECTION = 'renew_receipts';
const MATRIX_CORPUS_ISSUANCE_RECEIPTS_SUBCOLLECTION = 'capability_issuance_receipts';

const AUTHORITY_REJECTED = 'MATRIX_CORPUS_SIGNED_ENVELOPE_AUTHORITY_REJECTED';
const CONFLICT = 'MATRIX_CORPUS_SIGNED_ENVELOPE_CONFLICT';
const ACCEPTED_CLOCK_SKEW_MILLISECONDS = 30_000;

type FirestoreTransaction = Parameters<Parameters<Firestore['runTransaction']>[0]>[0];
type FirestoreDocumentReference = ReturnType<ReturnType<Firestore['collection']>['doc']>;

interface LifecyclePairReferences {
  readonly slot: FirestoreDocumentReference;
  readonly history: FirestoreDocumentReference;
}

interface IngestEnvelopeReferences extends LifecyclePairReferences {
  readonly outbox: FirestoreDocumentReference;
}

type TerminalEnvelopeReferences = IngestEnvelopeReferences;

export interface FirestoreMatrixCorpusSignedEnvelopeStoreDeps {
  firestore: Firestore;
}

export interface FirestoreMatrixCorpusDeliveryRepositoryDeps {
  firestore: Firestore;
}

export interface FirestoreMatrixCorpusRepositoryDeps
  extends FirestoreMatrixCorpusDeliveryRepositoryDeps,
    MatrixCorpusRepositoryDependencies {}

export interface FirestoreMatrixCorpusLeaseBindingAuthorizationDeps {
  firestore: Firestore;
  digests: MatrixCorpusKeyedDigestPort;
}

const boundLeaseAuthoritySchema = z
  .object({
    runtimeAudience: z.literal('home-dev'),
    runId: matrixCorpusSafeIdSchema,
    userId: matrixCorpusSafeIdSchema,
    leaseFence: matrixCorpusDecimalFenceSchema,
    matrixRoomBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappAccountBindingDigest: matrixCorpusKeyedDigestSchema,
    whatsappSenderBindingDigest: matrixCorpusKeyedDigestSchema,
  })
  .strict();

export class FirestoreMatrixCorpusLeaseBindingAuthorization
  implements MatrixCorpusLeaseBindingAuthorizationPort
{
  public constructor(
    private readonly deps: FirestoreMatrixCorpusLeaseBindingAuthorizationDeps
  ) {}

  public async authorizeCurrentLeaseBinding(
    input: unknown
  ): Promise<MatrixCorpusLeaseBindingAuthorizationResult> {
    const parsedInput = boundLeaseAuthoritySchema.safeParse(input);
    if (!parsedInput.success) return { code: 'CORRUPT_STATE', recordKind: 'lease' };

    let leaseSlotDigest: string;
    let runFenceDigest: string;
    try {
      leaseSlotDigest = this.deps.digests.digest('imc-lease-slot-v1', [
        parsedInput.data.runtimeAudience,
        parsedInput.data.userId,
      ]);
      runFenceDigest = this.deps.digests.digest('imc-run-fence-v1', [
        parsedInput.data.runtimeAudience,
        parsedInput.data.userId,
        parsedInput.data.runId,
      ]);
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'lease' };
    }
    if (
      !matrixCorpusKeyedDigestSchema.safeParse(leaseSlotDigest).success ||
      !matrixCorpusKeyedDigestSchema.safeParse(runFenceDigest).success
    )
      return { code: 'CORRUPT_STATE', recordKind: 'lease' };

    return await this.deps.firestore.runTransaction(async (transaction) => {
      const slot = this.deps.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(leaseSlotDigest);
      const slotSnapshot = await transaction.get(slot);
      if (!slotSnapshot.exists) return { code: 'NOT_FOUND' as const };
      const current = matrixCorpusLeaseV1Schema.safeParse(slotSnapshot.data());
      if (!current.success) return { code: 'CORRUPT_STATE' as const, recordKind: 'lease' as const };
      if (
        current.data.runtimeAudience !== parsedInput.data.runtimeAudience ||
        current.data.runId !== parsedInput.data.runId ||
        current.data.userId !== parsedInput.data.userId
      )
        return { code: 'NOT_FOUND' as const };
      if (
        current.data.matrixRoomBindingDigest !== parsedInput.data.matrixRoomBindingDigest ||
        current.data.whatsappAccountBindingDigest !==
          parsedInput.data.whatsappAccountBindingDigest ||
        current.data.whatsappSenderBindingDigest !== parsedInput.data.whatsappSenderBindingDigest
      )
        return { code: 'NOT_FOUND' as const };
      if (current.data.leaseFence !== parsedInput.data.leaseFence)
        return { code: 'STALE_FENCE' as const };
      if (current.data.runFenceDigest !== runFenceDigest)
        return { code: 'CORRUPT_STATE' as const, recordKind: 'lease' as const };

      const history = slot.collection('runs').doc(runFenceDigest);
      const historySnapshot = await transaction.get(history);
      if (!historySnapshot.exists)
        return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
      const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
        leaseSlotDigest,
        current: current.data,
        history: historySnapshot.data(),
      });
      return pair.success
        ? { code: 'AUTHORIZED' as const }
        : { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
    });
  }
}

/**
 * Authoritative Firestore implementation of the Matrix-corpus lifecycle repository.
 *
 * Lifecycle mutations always update the current slot and immutable run-history mirror
 * in the same transaction. Child receipts use run-scoped subcollections so retries can
 * be replayed without placing unbounded receipt bodies in the lease document.
 */
export class FirestoreMatrixCorpusRepository
  implements MatrixCorpusRepository
{
  private readonly lifecycleFirestore: Firestore;
  private readonly replayProjectionDigest: MatrixCorpusRepositoryDependencies['replayProjectionDigest'];
  private readonly deliveryRepository: FirestoreMatrixCorpusDeliveryRepository;

  public constructor(deps: FirestoreMatrixCorpusRepositoryDeps) {
    this.lifecycleFirestore = deps.firestore;
    this.replayProjectionDigest = deps.replayProjectionDigest;
    this.deliveryRepository = new FirestoreMatrixCorpusDeliveryRepository(deps);
  }

  public async acquireProvisioningLease(
    input: AcquireProvisioningLeaseCommand
  ): Promise<ProvisioningLeaseResult> {
    const command = acquireProvisioningLeaseCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const slotRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
          .doc(command.data.leaseSlotDigest);
        const requestedHistoryRef = slotRef.collection('runs').doc(command.data.runFenceDigest);
        const [slotSnapshot, requestedHistorySnapshot] = await Promise.all([
          transaction.get(slotRef),
          transaction.get(requestedHistoryRef),
        ]);

        if (requestedHistorySnapshot.exists) {
          const history = matrixCorpusLeaseHistoryV1Schema.safeParse(requestedHistorySnapshot.data());
          if (!history.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
          const receipt = matrixCorpusOperationReceiptV1Schema.parse(
            history.data.operationReceipts.acquire
          );
          if (
            receipt.idempotencyKeyDigest !== command.data.idempotencyKeyDigest ||
            receipt.canonicalRequestDigest !== command.data.canonicalRequestDigest
          )
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          const projection = receipt.replayProjection;
          return parseLifecycleResult(provisioningLeaseResultSchema, {
            code: 'ALREADY_APPLIED',
            ...projection,
          });
        }

        let currentLease: ReturnType<typeof matrixCorpusLeaseV1Schema.parse> | null = null;
        if (slotSnapshot.exists) {
          const parsedCurrent = matrixCorpusLeaseV1Schema.safeParse(slotSnapshot.data());
          if (!parsedCurrent.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease' as const };
          const currentHistorySnapshot = await transaction.get(
            slotRef.collection('runs').doc(parsedCurrent.data.runFenceDigest)
          );
          if (!currentHistorySnapshot.exists)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
          const pair = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
            leaseSlotDigest: command.data.leaseSlotDigest,
            current: parsedCurrent.data,
            history: currentHistorySnapshot.data(),
          });
          if (!pair.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
          currentLease = pair.data.current;
          if (currentLease.phase !== 'released' && currentLease.phase !== 'abandoned')
            return { code: 'RUN_ALREADY_ACTIVE' as const };
        }
        if (command.data.acquisitionReadiness.kind !== 'admission_ready')
          return { code: 'NOT_READY' as const, gate: 'admission' as const };

        const nextFence =
          currentLease === null ? '1' : (BigInt(currentLease.fenceEpoch) + 1n).toString();
        const parsedFence = matrixCorpusDecimalFenceSchema.parse(nextFence);
        const projection = parseReplayProjection({
          operation: 'acquire',
          result: 'acquired',
          runId: command.data.runId,
          leaseFence: parsedFence,
          phase: 'provisioning',
          acquiredAt: command.data.now,
          expiresAt: command.data.expiresAt,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusOperationReceiptV1Schema.parse({
          version: 1,
          operation: 'acquire',
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          resultCode: 'ACQUIRED',
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const lease = matrixCorpusLeaseV1Schema.parse({
          version: 1,
          runtimeAudience: command.data.runtimeAudience,
          runId: command.data.runId,
          userId: command.data.userId,
          matrixRoomBindingDigest: command.data.matrixRoomBindingDigest,
          whatsappAccountBindingDigest: command.data.whatsappAccountBindingDigest,
          whatsappSenderBindingDigest: command.data.whatsappSenderBindingDigest,
          runFenceDigest: command.data.runFenceDigest,
          phase: 'provisioning',
          leaseFence: parsedFence,
          fenceEpoch: parsedFence,
          acquiredAt: command.data.now,
          activatedAt: null,
          renewedAt: command.data.now,
          expiresAt: command.data.expiresAt,
          quiescedAt: null,
          releasedAt: null,
          abandonedAt: null,
          operationReceipts: { acquire: receipt, activate: null, quiesce: null, release: null },
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
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...lease,
        });
        const result = parseLifecycleResult(provisioningLeaseResultSchema, {
          code: 'ACQUIRED',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          phase: projection.phase,
          acquiredAt: projection.acquiredAt,
          expiresAt: projection.expiresAt,
        });
        transaction.set(slotRef, lease);
        transaction.set(requestedHistoryRef, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async activateRun(input: ActivateRunCommand): Promise<ActivationResult> {
    const command = activateRunCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const requestedHistorySnapshot = await transaction.get(refs.history);
        if (requestedHistorySnapshot.exists) {
          const requestedHistory = matrixCorpusLeaseHistoryV1Schema.safeParse(
            requestedHistorySnapshot.data()
          );
          if (!requestedHistory.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
          const existing = requestedHistory.data.operationReceipts.activate;
          if (
            existing !== null &&
            existing.idempotencyKeyDigest === command.data.idempotencyKeyDigest
          ) {
            if (existing.canonicalRequestDigest !== command.data.canonicalRequestDigest)
              return { code: 'IDEMPOTENCY_CONFLICT' as const };
            const projection = existing.replayProjection;
            return parseLifecycleResult(activationResultSchema, {
              code: 'ALREADY_APPLIED',
              ...projection,
            });
          }
        }
        const pair = await readDeliveryPair(
          transaction,
          refs.slot,
          refs.history,
          command.data.leaseSlotDigest
        );
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'provisioning')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (command.data.controlStatus.kind !== 'status')
          return { code: 'NOT_READY' as const, gate: 'activation' as const };
        const projection = parseReplayProjection({
          operation: 'activate',
          result: 'activated',
          runId: command.data.runId,
          leaseFence: command.data.leaseFence,
          phase: 'active',
          activatedAt: command.data.now,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusOperationReceiptV1Schema.parse({
          version: 1,
          operation: 'activate',
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          resultCode: 'ACTIVATED',
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          phase: 'active',
          activatedAt: command.data.now,
          operationReceipts: { ...lease.operationReceipts, activate: receipt },
          finalCleanupReceipt: null,
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(activationResultSchema, {
          code: 'ACTIVATED',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          phase: projection.phase,
          activatedAt: projection.activatedAt,
        });
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async renewLease(input: RenewLeaseCommand): Promise<LeaseRenewResult> {
    const command = renewLeaseCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const receiptRef = refs.history
          .collection(MATRIX_CORPUS_RENEW_RECEIPTS_SUBCOLLECTION)
          .doc(command.data.idempotencyKeyDigest);
        const [pair, requestedHistorySnapshot, receiptSnapshot] = await Promise.all([
          readDeliveryPair(transaction, refs.slot, refs.history, command.data.leaseSlotDigest),
          transaction.get(refs.history),
          transaction.get(receiptRef),
        ]);
        if (receiptSnapshot.exists) {
          if (!requestedHistorySnapshot.exists)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'renew_receipt' as const };
          const receiptPair = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({
            history: requestedHistorySnapshot.data(),
            receipt: receiptSnapshot.data(),
          });
          if (!receiptPair.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'renew_receipt' as const };
          const receipt = receiptPair.data.receipt;
          if (receipt.canonicalRequestDigest !== command.data.canonicalRequestDigest)
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          const projection = receipt.replayProjection;
          return parseLifecycleResult(leaseRenewResultSchema, {
            code: 'ALREADY_APPLIED',
            ...projection,
          });
        }
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (pair.data.history.renewReceiptIds.includes(command.data.idempotencyKeyDigest))
          return { code: 'CORRUPT_STATE' as const, recordKind: 'renew_receipt' as const };
        if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'active')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (Date.parse(command.data.expiresAt) <= Date.parse(lease.expiresAt))
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        if (lease.renewReceiptIds.length >= 400)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        const projection = parseReplayProjection({
          operation: 'renew',
          result: 'renewed',
          runId: command.data.runId,
          leaseFence: command.data.leaseFence,
          phase: 'active',
          renewedAt: command.data.now,
          expiresAt: command.data.expiresAt,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusRenewReceiptV1Schema.parse({
          version: 1,
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          runId: command.data.runId,
          userId: command.data.userId,
          leaseFence: command.data.leaseFence,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          renewedAt: command.data.now,
          expiresAt: command.data.expiresAt,
          renewReceiptIds: [...lease.renewReceiptIds, receipt.idempotencyKeyDigest],
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(leaseRenewResultSchema, {
          code: 'LEASE_RENEWED',
          runId: projection.runId,
          leaseFence: projection.leaseFence,
          phase: projection.phase,
          renewedAt: projection.renewedAt,
          expiresAt: projection.expiresAt,
        });
        transaction.set(receiptRef, receipt);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  private digestReplayProjection(
    projection: Parameters<MatrixCorpusRepositoryDependencies['replayProjectionDigest']['digest']>[0]
  ): string | null {
    try {
      const digest = this.replayProjectionDigest.digest(projection);
      return matrixCorpusSha256DigestSchema.safeParse(digest).success ? digest : null;
    } catch {
      return null;
    }
  }

  public async issueCapability(input: IssueCapabilityCommand): Promise<CapabilityIssueResult> {
    const command = issueCapabilityCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const capability = command.data.capability;
        const capabilityRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
          .doc(capability.capabilityDigest);
        const receiptRef = refs.history
          .collection(MATRIX_CORPUS_ISSUANCE_RECEIPTS_SUBCOLLECTION)
          .doc(capability.matrixIdempotencyKeyDigest);
        const [pair, capabilitySnapshot, receiptSnapshot] = await Promise.all([
          readDeliveryPair(transaction, refs.slot, refs.history, command.data.leaseSlotDigest),
          transaction.get(capabilityRef),
          transaction.get(receiptRef),
        ]);
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (
          lease.runFenceDigest !== command.data.runFenceDigest ||
          !hasCapabilityAuthority(lease, capability)
        )
          return { code: 'STALE_FENCE' as const };

        if (receiptSnapshot.exists) {
          const receiptPair = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({
            history: pair.data.history,
            receipt: receiptSnapshot.data(),
          });
          if (!receiptPair.success)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'issuance_receipt' as const };
          const receipt = receiptPair.data.receipt;
          if (
            capability.issueRequestDigest !== receipt.issueRequestDigest ||
            capability.capabilityDigest !== receipt.capabilityDigest
          )
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          const storedCapability = matrixCorpusCapabilityV1Schema.safeParse(capabilitySnapshot.data());
          if (
            !storedCapability.success ||
            !capabilitySnapshot.exists ||
            storedCapability.data.capabilityDigest !== receipt.capabilityDigest ||
            !hasCapabilityAuthority(lease, storedCapability.data) ||
            !pair.data.history.capabilityDigests.includes(storedCapability.data.capabilityDigest)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'issuance_receipt' as const };
          const projection = receipt.replayProjection;
          const projectionDigest = this.digestReplayProjection(projection);
          if (
            projection.operation !== 'issue' ||
            projection.result !== 'issued' ||
            projectionDigest === null ||
            projectionDigest !== receipt.resultDigest
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'issuance_receipt' as const };
          return parseLifecycleResult(capabilityIssueResultSchema, {
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
        }
        if (pair.data.history.capabilityIssuanceReceiptIds.includes(capability.matrixIdempotencyKeyDigest))
          return { code: 'CORRUPT_STATE' as const, recordKind: 'issuance_receipt' as const };
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'active')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (
          capability.issuedAt !== command.data.now ||
          capability.consumedAt !== null ||
          capability.consumedTransportMessageIdDigest !== null ||
          capability.ingestOutboxId !== null ||
          capability.revokedAt !== null
        )
          return { code: 'CORRUPT_STATE' as const, recordKind: 'command' as const };
        if (lease.unconsumedCapability !== null || lease.nonterminalIngestOutboxIds.length !== 0)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        if (lease.capabilityIssuanceReceiptIds.length >= MATRIX_CORPUS_MAX_ISSUANCE_RECEIPTS_PER_RUN)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        if (capabilitySnapshot.exists) {
          const existing = matrixCorpusCapabilityV1Schema.safeParse(capabilitySnapshot.data());
          if (!existing.success || !hasCapabilityAuthority(lease, existing.data))
            return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
          if (existing.data.consumedAt !== null) return { code: 'CAPABILITY_REPLAY' as const };
          if (existing.data.revokedAt !== null) return { code: 'CAPABILITY_REVOKED' as const };
          if (Date.parse(command.data.now) >= Date.parse(existing.data.expiresAt))
            return { code: 'CAPABILITY_EXPIRED' as const };
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        }

        const projection = parseReplayProjection({
          operation: 'issue',
          result: 'issued',
          runId: capability.runId,
          scenarioId: capability.scenarioId,
          phase: capability.phase,
          turnIndex: capability.turnIndex,
          issuedAt: capability.issuedAt,
          expiresAt: capability.expiresAt,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusCapabilityIssuanceReceiptV1Schema.parse({
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
          replayProjection: projection,
          resultDigest,
          recordedAt: capability.issuedAt,
        });
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          capabilityIssuanceReceiptIds: [
            ...lease.capabilityIssuanceReceiptIds,
            receipt.matrixIdempotencyKeyDigest,
          ],
          capabilityDigests: [...lease.capabilityDigests, capability.capabilityDigest],
          unconsumedCapability: { digest: capability.capabilityDigest, phase: capability.phase },
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(capabilityIssueResultSchema, {
          code: 'CAPABILITY_ISSUED',
          runId: projection.runId,
          scenarioId: projection.scenarioId,
          phase: projection.phase,
          turnIndex: projection.turnIndex,
          issuedAt: projection.issuedAt,
          expiresAt: projection.expiresAt,
        });
        transaction.set(capabilityRef, capability);
        transaction.set(receiptRef, receipt);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async recordMatrixSendProof(
    input: RecordMatrixSendProofCommand
  ): Promise<MatrixSendProofResult> {
    const command = recordMatrixSendProofCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const capabilityRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
          .doc(command.data.capabilityDigest);
        const receiptRef = refs.history
          .collection(MATRIX_CORPUS_ISSUANCE_RECEIPTS_SUBCOLLECTION)
          .doc(command.data.matrixIdempotencyKeyDigest);
        const [pair, capabilitySnapshot, receiptSnapshot] = await Promise.all([
          readDeliveryPair(transaction, refs.slot, refs.history, command.data.leaseSlotDigest),
          transaction.get(capabilityRef),
          transaction.get(receiptRef),
        ]);
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        const capability = matrixCorpusCapabilityV1Schema.safeParse(capabilitySnapshot.data());
        const receiptPair = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({
          history: pair.data.history,
          receipt: receiptSnapshot.data(),
        });
        if (!capabilitySnapshot.exists || !receiptSnapshot.exists)
          return { code: 'NOT_FOUND' as const };
        if (!capability.success)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
        if (!receiptPair.success)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'issuance_receipt' as const };

        const receipt = receiptPair.data.receipt;
        if (
          lease.runFenceDigest !== command.data.runFenceDigest ||
          !hasCapabilityAuthority(lease, capability.data) ||
          capability.data.runtimeAudience !== command.data.runtimeAudience ||
          capability.data.runId !== command.data.runId ||
          capability.data.userId !== command.data.userId ||
          capability.data.leaseFence !== command.data.leaseFence
        )
          return { code: 'STALE_FENCE' as const };
        if (
          capability.data.capabilityDigest !== command.data.capabilityDigest ||
          capability.data.matrixIdempotencyKeyDigest !==
            command.data.matrixIdempotencyKeyDigest ||
          receipt.capabilityDigest !== command.data.capabilityDigest ||
          receipt.matrixIdempotencyKeyDigest !== command.data.matrixIdempotencyKeyDigest ||
          capability.data.matrixRoomBindingDigest !== command.data.matrixRoomBindingDigest ||
          capability.data.scenarioId !== command.data.scenarioId ||
          capability.data.scenarioNumber !== command.data.scenarioNumber ||
          capability.data.promptDigest !== command.data.promptDigest ||
          capability.data.phase !== command.data.phase ||
          capability.data.turnIndex !== command.data.turnIndex
        )
          return { code: 'CAPABILITY_MISMATCH' as const };

        const existing = receipt.matrixSendProof;
        if (existing !== undefined) {
          const exact =
            existing.matrixEventIdDigest === command.data.matrixEventIdDigest &&
            existing.matrixRoomBindingDigest === command.data.matrixRoomBindingDigest &&
            existing.messageTextDigest === command.data.messageTextDigest;
          if (!exact) return { code: 'IDEMPOTENCY_CONFLICT' as const };
          return matrixSendProofResultSchema.parse({
            code: 'ALREADY_APPLIED',
            operation: 'record_matrix_send_proof',
            runId: command.data.runId,
            leaseFence: command.data.leaseFence,
            scenarioId: command.data.scenarioId,
            phase: command.data.phase,
            turnIndex: command.data.turnIndex,
            recordedAt: existing.recordedAt,
          });
        }

        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'active')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        const updatedReceipt = matrixCorpusCapabilityIssuanceReceiptV1Schema.parse({
          ...receipt,
          matrixSendProof: {
            version: 1,
            matrixEventIdDigest: command.data.matrixEventIdDigest,
            matrixRoomBindingDigest: command.data.matrixRoomBindingDigest,
            messageTextDigest: command.data.messageTextDigest,
            recordedAt: command.data.now,
          },
        });
        transaction.set(receiptRef, updatedReceipt);
        return matrixSendProofResultSchema.parse({
          code: 'MATRIX_SEND_PROOF_RECORDED',
          runId: command.data.runId,
          leaseFence: command.data.leaseFence,
          scenarioId: command.data.scenarioId,
          phase: command.data.phase,
          turnIndex: command.data.turnIndex,
          recordedAt: command.data.now,
        });
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async consumeCapabilityAndEnqueueIngest(
    input: ConsumeCapabilityAndEnqueueIngestCommand
  ): Promise<CapabilityConsumeResult> {
    const command = consumeCapabilityAndEnqueueIngestCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const capabilityRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
          .doc(command.data.capabilityDigest);
        const transportReceiptRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION)
          .doc(command.data.transportMessageIdDigest);
        const outboxRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
          .doc(command.data.ingestOutboxId);
        const [pair, capabilitySnapshot, transportReceiptSnapshot, outboxSnapshot] =
          await Promise.all([
            readDeliveryPair(transaction, refs.slot, refs.history, command.data.leaseSlotDigest),
            transaction.get(capabilityRef),
            transaction.get(transportReceiptRef),
            transaction.get(outboxRef),
          ]);
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (!hasConsumeAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };

        if (transportReceiptSnapshot.exists) {
          const receipt = matrixCorpusTransportReceiptV1Schema.safeParse(transportReceiptSnapshot.data());
          if (
            !receipt.success ||
            receipt.data.transportMessageIdDigest !== command.data.transportMessageIdDigest ||
            receipt.data.runId !== lease.runId ||
            receipt.data.userId !== lease.userId ||
            receipt.data.leaseFence !== lease.leaseFence ||
            !pair.data.history.transportReceiptIds.includes(command.data.transportMessageIdDigest)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'transport_receipt' as const };
          if (
            receipt.data.capabilityDigest !== command.data.capabilityDigest ||
            receipt.data.ingressRequestDigest !== command.data.ingressRequestDigest
          )
            return { code: 'TRANSPORT_REPLAY' as const };
          const storedCapability = matrixCorpusCapabilityV1Schema.safeParse(capabilitySnapshot.data());
          if (
            !capabilitySnapshot.exists ||
            !storedCapability.success ||
            storedCapability.data.capabilityDigest !== receipt.data.capabilityDigest ||
            !hasCapabilityAuthority(lease, storedCapability.data) ||
            !pair.data.history.capabilityDigests.includes(receipt.data.capabilityDigest) ||
            (receipt.data.acceptedAt !== null &&
              receipt.data.promptDigest !== storedCapability.data.promptDigest)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
          if (receipt.data.ingestOutboxId === null) {
            const terminalReferenceCount = pair.data.history.terminalFailureReceiptRefs.filter(
              (reference) =>
                reference.transportReceiptId === receipt.data.transportMessageIdDigest &&
                reference.capabilityDigest === receipt.data.capabilityDigest
            ).length;
            return receipt.data.terminalFailureCode === null || terminalReferenceCount !== 1
              ? { code: 'CORRUPT_STATE' as const, recordKind: 'transport_receipt' as const }
              : { code: receipt.data.terminalFailureCode };
          }
          const storedOutbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(outboxSnapshot.data());
          if (
            !outboxSnapshot.exists ||
            !storedOutbox.success ||
            receipt.data.ingestOutboxId !== storedOutbox.data.ingestOutboxId ||
            receipt.data.ingestReceiptId !== storedOutbox.data.ingestReceiptId ||
            storedOutbox.data.runId !== lease.runId ||
            storedOutbox.data.userId !== lease.userId ||
            storedOutbox.data.leaseFence !== lease.leaseFence ||
            !pair.data.history.ingestOutboxIds.includes(storedOutbox.data.ingestOutboxId) ||
            storedCapability.data.ingestOutboxId !== storedOutbox.data.ingestOutboxId ||
            storedCapability.data.consumedTransportMessageIdDigest !==
              receipt.data.transportMessageIdDigest ||
            storedCapability.data.consumedAt !== receipt.data.acceptedAt ||
            receipt.data.acceptedAt !== receipt.data.recordedAt ||
            storedOutbox.data.createdAt !== receipt.data.acceptedAt
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'transport_receipt' as const };
          return parseLifecycleResult(capabilityConsumeResultSchema, {
            code: 'ALREADY_APPLIED',
            operation: 'consume',
            result: 'enqueued',
            runId: storedCapability.data.runId,
            scenarioId: storedCapability.data.scenarioId,
            phase: storedCapability.data.phase,
            turnIndex: storedCapability.data.turnIndex,
            ingestReceiptId: receipt.data.ingestReceiptId,
            ingestOutboxId: receipt.data.ingestOutboxId,
            acceptedAt: receipt.data.acceptedAt,
          });
        }
        if (pair.data.history.transportReceiptIds.includes(command.data.transportMessageIdDigest))
          return { code: 'CORRUPT_STATE' as const, recordKind: 'transport_receipt' as const };
        if (!capabilitySnapshot.exists)
          return pair.data.history.capabilityDigests.includes(command.data.capabilityDigest)
            ? { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const }
            : { code: 'NOT_FOUND' as const };
        const capability = matrixCorpusCapabilityV1Schema.safeParse(capabilitySnapshot.data());
        if (
          !capability.success ||
          !pair.data.history.capabilityDigests.includes(command.data.capabilityDigest) ||
          !hasCapabilityAuthority(lease, capability.data)
        )
          return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'active')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };

        const now = Date.parse(command.data.now);
        const issuedAt = Date.parse(capability.data.issuedAt);
        const expiresAt = Date.parse(capability.data.expiresAt);
        const terminalFailure =
          capability.data.consumedAt !== null
            ? ('CAPABILITY_REPLAY' as const)
            : capability.data.revokedAt !== null
              ? ('CAPABILITY_REVOKED' as const)
              : now > expiresAt + ACCEPTED_CLOCK_SKEW_MILLISECONDS
                ? ('CAPABILITY_EXPIRED' as const)
                : now < issuedAt - ACCEPTED_CLOCK_SKEW_MILLISECONDS ||
                    !matchesCapabilityFacts(capability.data, command.data.facts)
                  ? ('CAPABILITY_MISMATCH' as const)
                  : null;
        if (terminalFailure !== null) {
          const perCapability = pair.data.history.terminalFailureReceiptRefs.filter(
            (reference) => reference.capabilityDigest === capability.data.capabilityDigest
          ).length;
          if (
            perCapability >= MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_CAPABILITY ||
            pair.data.history.terminalFailureReceiptRefs.length >=
              MATRIX_CORPUS_MAX_TERMINAL_FAILURE_RECEIPTS_PER_RUN
          )
            return { code: 'TERMINAL_RECEIPT_LIMIT' as const };
          const receipt = matrixCorpusTransportReceiptV1Schema.parse({
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
            terminalFailureCode: terminalFailure,
          });
          const replayQuiesce = terminalFailure === 'CAPABILITY_REPLAY';
          let pointedCapability:
            | Readonly<{
                ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
                data: ReturnType<typeof matrixCorpusCapabilityV1Schema.parse>;
              }>
            | null = null;
          if (
            replayQuiesce &&
            lease.unconsumedCapability !== null &&
            lease.unconsumedCapability.digest !== capability.data.capabilityDigest
          ) {
            const ref = this.lifecycleFirestore
              .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
              .doc(lease.unconsumedCapability.digest);
            const snapshot = await transaction.get(ref);
            const pointed = matrixCorpusCapabilityV1Schema.safeParse(snapshot.data());
            if (
              !snapshot.exists ||
              !pointed.success ||
              pointed.data.phase !== lease.unconsumedCapability.phase ||
              pointed.data.consumedAt !== null ||
              pointed.data.revokedAt !== null ||
              !hasCapabilityAuthority(lease, pointed.data)
            )
              return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
            const revoked = matrixCorpusCapabilityV1Schema.parse({
              ...pointed.data,
              revokedAt: command.data.now,
            });
            pointedCapability = { ref, data: revoked };
          } else if (
            replayQuiesce &&
            lease.unconsumedCapability?.digest === capability.data.capabilityDigest
          ) {
            return { code: 'CORRUPT_STATE' as const, recordKind: 'lease' as const };
          }

          const closedReplayOutboxes: {
            ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
            data: ReturnType<typeof matrixCorpusIngestOutboxRecordV1Schema.parse>;
          }[] = [];
          if (replayQuiesce) {
            for (const ingestOutboxId of lease.ingestOutboxIds) {
              const ref = this.lifecycleFirestore
                .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
                .doc(ingestOutboxId);
              const snapshot = await transaction.get(ref);
              const replayOutbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
              if (
                !snapshot.exists ||
                !replayOutbox.success ||
                !hasLeaseIdentity(pair.data.history, replayOutbox.data)
              )
                return { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const };
              if (replayOutbox.data.status !== 'pending') continue;
              const closed = matrixCorpusIngestOutboxRecordV1Schema.parse({
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
              closedReplayOutboxes.push({ ref, data: closed });
            }
          }
          const closedReplayIds = new Set(
            closedReplayOutboxes.map((entry) => entry.data.ingestOutboxId)
          );
          const provisional = {
            ...lease,
            phase: replayQuiesce ? ('quiescing' as const) : lease.phase,
            quiescedAt: replayQuiesce ? command.data.now : lease.quiescedAt,
            unconsumedCapability: replayQuiesce ? null : lease.unconsumedCapability,
            terminalFailureReceiptRefs: [
              ...lease.terminalFailureReceiptRefs,
              {
                transportReceiptId: receipt.transportMessageIdDigest,
                capabilityDigest: capability.data.capabilityDigest,
              },
            ],
            nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
              (id) => !closedReplayIds.has(id)
            ),
            transportReceiptIds: [...lease.transportReceiptIds, receipt.transportMessageIdDigest],
            drain: { ...lease.drain, drained: false },
          };
          const updated = matrixCorpusLeaseV1Schema.parse({
            ...provisional,
            drain: { ...provisional.drain, drained: hasDrainedLeaseState(provisional) },
          });
          const history = matrixCorpusLeaseHistoryV1Schema.parse({
            leaseSlotDigest: command.data.leaseSlotDigest,
            ...updated,
          });
          if (pointedCapability !== null)
            transaction.set(pointedCapability.ref, pointedCapability.data);
          for (const closed of closedReplayOutboxes) transaction.set(closed.ref, closed.data);
          transaction.set(transportReceiptRef, receipt);
          transaction.set(refs.slot, updated);
          transaction.set(refs.history, history);
          return { code: terminalFailure };
        }

        if (
          lease.unconsumedCapability?.digest !== capability.data.capabilityDigest ||
          lease.unconsumedCapability.phase !== capability.data.phase
        )
          return { code: 'CORRUPT_STATE' as const, recordKind: 'lease' as const };
        if (lease.nonterminalIngestOutboxIds.length !== 0)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: 'active' as const };
        if (outboxSnapshot.exists)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const };

        const consumedCapability = matrixCorpusCapabilityV1Schema.parse({
          ...capability.data,
          consumedAt: command.data.now,
          consumedTransportMessageIdDigest: command.data.transportMessageIdDigest,
          ingestOutboxId: command.data.ingestOutboxId,
        });
        const receipt = matrixCorpusTransportReceiptV1Schema.parse({
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
        const outbox = matrixCorpusIngestOutboxRecordV1Schema.parse({
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
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          unconsumedCapability: null,
          nonterminalIngestOutboxIds: [outbox.ingestOutboxId],
          ingestOutboxIds: [...lease.ingestOutboxIds, outbox.ingestOutboxId],
          transportReceiptIds: [...lease.transportReceiptIds, receipt.transportMessageIdDigest],
          drain: {
            ...lease.drain,
            consumedCapabilityCount: lease.drain.consumedCapabilityCount + 1,
            drained: false,
          },
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(capabilityConsumeResultSchema, {
          code: 'INGEST_ENQUEUED',
          runId: consumedCapability.runId,
          scenarioId: consumedCapability.scenarioId,
          phase: consumedCapability.phase,
          turnIndex: consumedCapability.turnIndex,
          ingestReceiptId: receipt.ingestReceiptId,
          ingestOutboxId: receipt.ingestOutboxId,
          acceptedAt: receipt.acceptedAt,
        });
        transaction.set(capabilityRef, consumedCapability);
        transaction.set(transportReceiptRef, receipt);
        transaction.set(outboxRef, outbox);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async quiesceRun(input: QuiesceRunCommand): Promise<QuiesceResult> {
    const command = quiesceRunCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const pair = await readDeliveryPair(
          transaction,
          refs.slot,
          refs.history,
          command.data.leaseSlotDigest
        );
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };
        const replay = lease.operationReceipts.quiesce;
        if (replay !== null && replay.idempotencyKeyDigest === command.data.idempotencyKeyDigest) {
          if (replay.canonicalRequestDigest !== command.data.canonicalRequestDigest)
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          const projection = replay.replayProjection;
          return parseLifecycleResult(quiesceResultSchema, {
            code: 'ALREADY_APPLIED',
            ...projection,
          });
        }
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'active')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };

        let revokedCapability: ReturnType<typeof matrixCorpusCapabilityV1Schema.parse> | null = null;
        let capabilityRef:
          | ReturnType<ReturnType<Firestore['collection']>['doc']>
          | null = null;
        if (lease.unconsumedCapability !== null) {
          capabilityRef = this.lifecycleFirestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(lease.unconsumedCapability.digest);
          const snapshot = await transaction.get(capabilityRef);
          const capability = matrixCorpusCapabilityV1Schema.safeParse(snapshot.data());
          if (
            !snapshot.exists ||
            !capability.success ||
            capability.data.capabilityDigest !== lease.unconsumedCapability.digest ||
            capability.data.phase !== lease.unconsumedCapability.phase ||
            capability.data.consumedAt !== null ||
            capability.data.revokedAt !== null ||
            !hasCapabilityAuthority(lease, capability.data)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
          const revoked = matrixCorpusCapabilityV1Schema.parse({
            ...capability.data,
            revokedAt: command.data.now,
          });
          revokedCapability = revoked;
        }

        const closedOutboxes: {
          ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
          data: ReturnType<typeof matrixCorpusIngestOutboxRecordV1Schema.parse>;
        }[] = [];
        for (const ingestOutboxId of lease.nonterminalIngestOutboxIds) {
          const ref = this.lifecycleFirestore
            .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
            .doc(ingestOutboxId);
          const snapshot = await transaction.get(ref);
          const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
          if (
            !snapshot.exists ||
            !outbox.success ||
            !hasLeaseIdentity(pair.data.history, outbox.data) ||
            !pair.data.history.ingestOutboxIds.includes(ingestOutboxId)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const };
          if (outbox.data.status !== 'pending') continue;
          const closed = matrixCorpusIngestOutboxRecordV1Schema.parse({
            ...outbox.data,
            status: 'closed',
            claim: null,
            closedReason: 'quiesced',
            closedAt: command.data.now,
          });
          closedOutboxes.push({ ref, data: closed });
        }
        const closedIds = new Set(closedOutboxes.map((entry) => entry.data.ingestOutboxId));
        const provisional = {
          ...lease,
          phase: 'quiescing' as const,
          quiescedAt: command.data.now,
          unconsumedCapability: null,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => !closedIds.has(id)
          ),
          terminalWinner: null,
          drain: { ...lease.drain, drained: false },
        };
        const drained = hasDrainedLeaseState(provisional);
        const projection = parseReplayProjection({
          operation: 'quiesce',
          result: 'quiesced',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          phase: 'quiescing',
          quiescedAt: command.data.now,
          drained,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusOperationReceiptV1Schema.parse({
          version: 1,
          operation: 'quiesce',
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          resultCode: 'QUIESCED',
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...provisional,
          operationReceipts: { ...lease.operationReceipts, quiesce: receipt },
          drain: { ...provisional.drain, drained },
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(quiesceResultSchema, {
          code: 'QUIESCED',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          phase: 'quiescing',
          quiescedAt: command.data.now,
          drained,
        });
        if (capabilityRef !== null && revokedCapability !== null)
          transaction.set(capabilityRef, revokedCapability);
        for (const closed of closedOutboxes) transaction.set(closed.ref, closed.data);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async releaseRun(input: ReleaseRunCommand): Promise<ReleaseResult> {
    const command = releaseRunCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const pair = await readDeliveryPair(
          transaction,
          refs.slot,
          refs.history,
          command.data.leaseSlotDigest
        );
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };
        const terminalRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
          .doc(command.data.terminalControlId);
        const terminalSnapshot = await transaction.get(terminalRef);
        const replay = lease.operationReceipts.release;
        if (replay !== null && replay.idempotencyKeyDigest === command.data.idempotencyKeyDigest) {
          if (replay.canonicalRequestDigest !== command.data.canonicalRequestDigest)
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          const projection = replay.replayProjection;
          const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
            terminalSnapshot.data()
          );
          if (
            !terminalSnapshot.exists ||
            !terminal.success ||
            projection.operation !== 'release' ||
            projection.result !== 'release_pending' ||
            replay.operation !== 'release' ||
            replay.resultCode !== 'RELEASE_PENDING' ||
            terminal.data.terminalControlId !== projection.terminalControlId ||
            terminal.data.eventId !== projection.eventId ||
            terminal.data.runId !== lease.runId ||
            terminal.data.userId !== lease.userId ||
            terminal.data.leaseFence !== lease.leaseFence ||
            terminal.data.kind !== 'release' ||
            terminal.data.createdAt !== projection.createdAt ||
            !lease.terminalControlOutboxIds.includes(projection.terminalControlId)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
          return parseLifecycleResult(releaseResultSchema, {
            code: 'ALREADY_APPLIED',
            operation: 'release',
            result: 'release_pending',
            runId: projection.runId,
            leaseFence: projection.leaseFence,
            terminalControlId: projection.terminalControlId,
            eventId: projection.eventId,
            createdAt: projection.createdAt,
          });
        }
        const expired = leaseExpiryFailure(command.data.now, lease.expiresAt);
        if (expired !== null) return expired;
        if (lease.phase !== 'quiescing' || !hasDrainedLeaseState(lease))
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (command.data.controlStatus.kind !== 'status')
          return { code: 'NOT_READY' as const, gate: 'release' as const };
        if (terminalSnapshot.exists)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
        const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
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
        const projection = parseReplayProjection({
          operation: 'release',
          result: 'release_pending',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          terminalControlId: terminal.terminalControlId,
          eventId: terminal.eventId,
          createdAt: terminal.createdAt,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusOperationReceiptV1Schema.parse({
          version: 1,
          operation: 'release',
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          resultCode: 'RELEASE_PENDING',
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          phase: 'release_pending',
          operationReceipts: { ...lease.operationReceipts, release: receipt },
          terminalControlOutboxIds: [...lease.terminalControlOutboxIds, terminal.terminalControlId],
          terminalWinner: null,
          releasedAt: null,
          abandonedAt: null,
          drain: { ...lease.drain, drained: false },
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(releaseResultSchema, {
          code: 'RELEASE_PENDING',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          terminalControlId: terminal.terminalControlId,
          eventId: terminal.eventId,
          createdAt: terminal.createdAt,
        });
        transaction.set(terminalRef, terminal);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async abandonExpiredRun(
    input: AbandonExpiredRunCommand
  ): Promise<AbandonPendingResult> {
    const command = abandonExpiredRunCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const pair = await readDeliveryPair(
          transaction,
          refs.slot,
          refs.history,
          command.data.leaseSlotDigest
        );
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (
          lease.runtimeAudience !== command.data.runtimeAudience ||
          lease.runId !== command.data.observedRunId ||
          lease.userId !== command.data.observedUserId ||
          lease.leaseFence !== command.data.observedLeaseFence ||
          lease.runFenceDigest !== command.data.runFenceDigest
        )
          return { code: 'STALE_FENCE' as const };
        const terminalRef = this.lifecycleFirestore
          .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
          .doc(command.data.terminalControlId);
        const terminalSnapshot = await transaction.get(terminalRef);
        if (lease.phase === 'abandon_pending') {
          const terminal = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
            terminalSnapshot.data()
          );
          if (
            !terminalSnapshot.exists ||
            !terminal.success ||
            terminal.data.terminalControlId !== command.data.terminalControlId ||
            terminal.data.eventId !== command.data.terminalControlId ||
            terminal.data.kind !== 'abandoned' ||
            terminal.data.runId !== lease.runId ||
            terminal.data.userId !== lease.userId ||
            terminal.data.leaseFence !== lease.leaseFence ||
            !lease.terminalControlOutboxIds.includes(command.data.terminalControlId)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
          return parseLifecycleResult(abandonPendingResultSchema, {
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
        }
        const evaluatorProvisioningAbort =
          command.data.trigger === 'evaluator_abort' && lease.phase === 'provisioning';
        if (command.data.trigger === 'evaluator_abort' && !evaluatorProvisioningAbort)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (!evaluatorProvisioningAbort && Date.parse(command.data.now) < Date.parse(lease.expiresAt))
          return { code: 'NOT_READY' as const, gate: 'abandon' as const };
        if (!['provisioning', 'active', 'quiescing', 'release_pending'].includes(lease.phase))
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
        if (terminalSnapshot.exists)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };

        let revokedCapability:
          | Readonly<{
              ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
              data: ReturnType<typeof matrixCorpusCapabilityV1Schema.parse>;
            }>
          | null = null;
        if (lease.unconsumedCapability !== null) {
          const capabilityRef = this.lifecycleFirestore
            .collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION)
            .doc(lease.unconsumedCapability.digest);
          const snapshot = await transaction.get(capabilityRef);
          const capability = matrixCorpusCapabilityV1Schema.safeParse(snapshot.data());
          if (
            !snapshot.exists ||
            !capability.success ||
            capability.data.consumedAt !== null ||
            capability.data.revokedAt !== null ||
            !hasCapabilityAuthority(lease, capability.data)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'capability' as const };
          const revoked = matrixCorpusCapabilityV1Schema.parse({
            ...capability.data,
            revokedAt: command.data.now,
          });
          revokedCapability = { ref: capabilityRef, data: revoked };
        }

        const closedOutboxes: {
          ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
          data: ReturnType<typeof matrixCorpusIngestOutboxRecordV1Schema.parse>;
        }[] = [];
        for (const ingestOutboxId of lease.nonterminalIngestOutboxIds) {
          const ref = this.lifecycleFirestore
            .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
            .doc(ingestOutboxId);
          const snapshot = await transaction.get(ref);
          const outbox = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
          if (
            !snapshot.exists ||
            !outbox.success ||
            !hasLeaseIdentity(pair.data.history, outbox.data) ||
            !pair.data.history.ingestOutboxIds.includes(ingestOutboxId)
          )
            return { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const };
          if (outbox.data.status !== 'pending') continue;
          const closed = matrixCorpusIngestOutboxRecordV1Schema.parse({
            ...outbox.data,
            status: 'closed',
            claim: null,
            closedReason: 'abandoned',
            closedAt: command.data.now,
          });
          closedOutboxes.push({ ref, data: closed });
        }
        const closedOutboxIds = new Set(
          closedOutboxes.map((entry) => entry.data.ingestOutboxId)
        );

        let closedRelease:
          | Readonly<{
              ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
              data: ReturnType<typeof matrixCorpusTerminalControlOutboxRecordV1Schema.parse>;
          }>
          | null = null;
        let retainedClaimedRelease = false;
        if (lease.phase === 'release_pending') {
          for (const terminalControlId of lease.terminalControlOutboxIds) {
            const ref = this.lifecycleFirestore
              .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
              .doc(terminalControlId);
            const snapshot = await transaction.get(ref);
            const candidate = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(
              snapshot.data()
            );
            if (
              !snapshot.exists ||
              !candidate.success ||
              !hasLeaseIdentity(pair.data.history, candidate.data)
            )
              return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
            if (candidate.data.kind !== 'release') continue;
            if (candidate.data.status === 'published')
              return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
            if (candidate.data.status === 'claimed') retainedClaimedRelease = true;
            if (candidate.data.status === 'pending') {
              const closed = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
                ...candidate.data,
                status: 'closed',
                claim: null,
                acknowledgedAt: null,
                closedReason: 'expired_unclaimed_release',
                lastClaimRenewal: null,
                closedAt: command.data.now,
              });
              closedRelease = { ref, data: closed };
            }
          }
          if (closedRelease === null && !retainedClaimedRelease)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const };
        }
        const abandoned = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
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
        const updated = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          phase: 'abandon_pending',
          unconsumedCapability: null,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => !closedOutboxIds.has(id)
          ),
          terminalControlOutboxIds: [
            ...lease.terminalControlOutboxIds,
            abandoned.terminalControlId,
          ],
          terminalWinner: null,
          releasedAt: null,
          abandonedAt: null,
          finalCleanupReceipt: lease.phase === 'provisioning' ? null : lease.finalCleanupReceipt,
          drain: { ...lease.drain, drained: false },
        });
        const history = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updated,
        });
        const result = parseLifecycleResult(abandonPendingResultSchema, {
          code: 'ABANDON_PENDING',
          runId: lease.runId,
          leaseFence: lease.leaseFence,
          phase: 'abandon_pending',
          terminalControlId: abandoned.terminalControlId,
          eventId: abandoned.eventId,
          reconciledAt: abandoned.createdAt,
        });
        if (revokedCapability !== null)
          transaction.set(revokedCapability.ref, revokedCapability.data);
        for (const closed of closedOutboxes) transaction.set(closed.ref, closed.data);
        if (closedRelease !== null) transaction.set(closedRelease.ref, closedRelease.data);
        transaction.set(terminalRef, abandoned);
        transaction.set(refs.slot, updated);
        transaction.set(refs.history, history);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async getTransportStatus(
    input: GetTransportStatusCommand
  ): Promise<TransportStatusResult> {
    const command = getTransportStatusCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const refs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.runFenceDigest
        );
        const pair = await readDeliveryPair(
          transaction,
          refs.slot,
          refs.history,
          command.data.leaseSlotDigest
        );
        if (pair.kind !== 'found') return pair.result;
        const lease = pair.data.current;
        if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' as const };
        if (
          ['provisioning', 'active', 'quiescing', 'release_pending'].includes(lease.phase) &&
          Date.parse(command.data.now) >= Date.parse(lease.expiresAt)
        )
          return { code: 'LEASE_EXPIRED' as const, expiresAt: lease.expiresAt };
        return parseLifecycleResult(transportStatusResultSchema, {
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
        });
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public async cleanupExactRun(input: CleanupExactRunCommand): Promise<CleanupResult> {
    const command = cleanupExactRunCommandSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };
    try {
      return await this.lifecycleFirestore.runTransaction(async (transaction) => {
        const currentRefs = lifecyclePairRefs(
          this.lifecycleFirestore,
          command.data.leaseSlotDigest,
          command.data.currentRunFenceDigest
        );
        const current = await readDeliveryPair(
          transaction,
          currentRefs.slot,
          currentRefs.history,
          command.data.leaseSlotDigest
        );
        if (current.kind !== 'found') return current.result;
        const lease = current.data.current;
        if (
          lease.runtimeAudience !== command.data.runtimeAudience ||
          lease.runId !== command.data.currentRunId ||
          lease.userId !== command.data.userId ||
          lease.leaseFence !== command.data.currentLeaseFence ||
          lease.runFenceDigest !== command.data.currentRunFenceDigest
        )
          return { code: 'STALE_FENCE' as const };

        if (lease.finalCleanupReceipt !== null) {
          const receipt = lease.finalCleanupReceipt;
          const projection = receipt.replayProjection;
          const digest = this.digestReplayProjection(projection);
          if (digest === null || digest !== receipt.resultDigest)
            return {
              code: 'CORRUPT_STATE' as const,
              recordKind: digest === null ? ('dependency_result' as const) : ('cleanup_progress' as const),
            };
          if (receipt.idempotencyKeyDigest !== command.data.idempotencyKeyDigest)
            return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };
          if (
            receipt.canonicalRequestDigest !== command.data.canonicalRequestDigest ||
            receipt.expectedRevision !== command.data.expectedRevision ||
            projection.operation !== 'cleanup' ||
            projection.result !== 'cleaned' ||
            projection.targetRunFenceDigest !== command.data.targetRunFenceDigest
          )
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          return parseLifecycleResult(cleanupResultSchema, {
            code: 'ALREADY_APPLIED',
            operation: 'cleanup',
            result: 'cleaned',
            targetRunId: projection.targetRunId,
            targetLeaseFence: projection.targetLeaseFence,
            targetRunFenceDigest: projection.targetRunFenceDigest,
            finalRevision: projection.finalRevision,
            cleanedAt: projection.cleanedAt,
          });
        }
        if (lease.phase !== 'provisioning')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: lease.phase };

        const targetRef = currentRefs.slot
          .collection('runs')
          .doc(command.data.targetRunFenceDigest);
        const targetSnapshot = await transaction.get(targetRef);
        if (!targetSnapshot.exists) return { code: 'NOT_FOUND' as const };
        const target = matrixCorpusLeaseHistoryV1Schema.safeParse(targetSnapshot.data());
        if (!target.success)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'lease_history' as const };
        if (
          target.data.leaseSlotDigest !== command.data.leaseSlotDigest ||
          target.data.runId !== command.data.targetRunId ||
          target.data.userId !== command.data.userId ||
          target.data.leaseFence !== command.data.targetLeaseFence ||
          target.data.runFenceDigest !== command.data.targetRunFenceDigest
        )
          return { code: 'STALE_FENCE' as const };
        if (target.data.phase !== 'released' && target.data.phase !== 'abandoned')
          return { code: 'PHASE_CONFLICT' as const, actualPhase: target.data.phase };

        const progress = target.data.cleanupProgress;
        const priorReceipts = progress?.chunkReceipts ?? [];
        const priorRevision = progress?.revision ?? 0;
        const remaining = progress?.remaining ?? {
          renewReceiptIds: [...target.data.renewReceiptIds].sort(),
          capabilityIssuanceReceiptIds: [...target.data.capabilityIssuanceReceiptIds].sort(),
          capabilityDigests: [...target.data.capabilityDigests].sort(),
          transportReceiptIds: [...target.data.transportReceiptIds].sort(),
          ingestOutboxIds: [...target.data.ingestOutboxIds].sort(),
          terminalControlOutboxIds: [...target.data.terminalControlOutboxIds].sort(),
        };
        const replayReceipt = priorReceipts.find(
          (candidate) => candidate.idempotencyKeyDigest === command.data.idempotencyKeyDigest
        );
        if (replayReceipt !== undefined) {
          const digest = this.digestReplayProjection(replayReceipt.replayProjection);
          const projection = replayReceipt.replayProjection;
          if (digest === null || digest !== replayReceipt.resultDigest)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'cleanup_progress' as const };
          if (
            replayReceipt.canonicalRequestDigest !== command.data.canonicalRequestDigest ||
            replayReceipt.expectedRevision !== command.data.expectedRevision ||
            projection.operation !== 'cleanup' ||
            projection.result !== 'progress' ||
            projection.targetRunFenceDigest !== command.data.targetRunFenceDigest
          )
            return { code: 'IDEMPOTENCY_CONFLICT' as const };
          return parseLifecycleResult(cleanupResultSchema, {
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
        }
        if (command.data.expectedRevision !== priorRevision)
          return { code: 'PHASE_CONFLICT' as const, actualPhase: target.data.phase };

        type CleanupField = keyof typeof remaining;
        type CleanupKind =
          | 'renew_receipt'
          | 'issuance_receipt'
          | 'capability'
          | 'transport_receipt'
          | 'ingest_outbox'
          | 'terminal_outbox';
        const order: readonly (readonly [CleanupField, CleanupKind])[] = [
          ['renewReceiptIds', 'renew_receipt'],
          ['capabilityIssuanceReceiptIds', 'issuance_receipt'],
          ['capabilityDigests', 'capability'],
          ['transportReceiptIds', 'transport_receipt'],
          ['ingestOutboxIds', 'ingest_outbox'],
          ['terminalControlOutboxIds', 'terminal_outbox'],
        ];
        const nextRemaining = structuredClone(remaining);
        const planned: {
          field: CleanupField;
          kind: CleanupKind;
          key: string;
          ref: ReturnType<ReturnType<Firestore['collection']>['doc']>;
        }[] = [];
        let allowance = 96;
        for (const [field, kind] of order) {
          while (allowance > 0 && nextRemaining[field].length > 0) {
            const key = nextRemaining[field].shift() as string;
            const ref = cleanupChildRef(
              this.lifecycleFirestore,
              targetRef,
              kind,
              key
            );
            const snapshot = await transaction.get(ref);
            if (!snapshot.exists || !isExactCleanupChild(kind, key, target.data, snapshot.data()))
              return { code: 'CORRUPT_STATE' as const, recordKind: cleanupRecordKind(kind) };
            planned.push({ field, kind, key, ref });
            allowance -= 1;
          }
        }
        const remainingChildCount = Object.values(nextRemaining).reduce(
          (total, values) => total + values.length,
          0
        );
        const committedRevision = priorRevision + 1;
        if (remainingChildCount > 0) {
          const first = order.find(([field]) => nextRemaining[field].length > 0) as readonly [
            CleanupField,
            CleanupKind,
          ];
          const projection = parseReplayProjection({
            operation: 'cleanup',
            result: 'progress',
            targetRunId: target.data.runId,
            targetLeaseFence: target.data.leaseFence,
            targetRunFenceDigest: target.data.runFenceDigest,
            committedRevision,
            remainingChildCount,
            chunkCommittedAt: command.data.now,
          });
          const resultDigest = this.digestReplayProjection(projection);
          if (resultDigest === null)
            return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
          const receipt = matrixCorpusCleanupChunkReceiptV1Schema.parse({
            version: 1,
            idempotencyKeyDigest: command.data.idempotencyKeyDigest,
            canonicalRequestDigest: command.data.canonicalRequestDigest,
            expectedRevision: command.data.expectedRevision,
            committedRevision,
            replayProjection: projection,
            resultDigest,
            recordedAt: command.data.now,
          });
          const updatedProgress = matrixCorpusCleanupProgressV1Schema.parse({
            version: 1,
            targetRunId: target.data.runId,
            targetLeaseFence: target.data.leaseFence,
            targetRunFenceDigest: target.data.runFenceDigest,
            revision: committedRevision,
            cursor: { kind: first[1], nextIndex: 0 },
            remaining: nextRemaining,
            chunkReceipts: [...priorReceipts, receipt],
          });
          const updatedTarget = matrixCorpusLeaseHistoryV1Schema.parse({
            ...target.data,
            cleanupProgress: updatedProgress,
          });
          matrixCorpusCleanupLeaseSetV1Schema.parse({
            currentPair: current.data,
            targetHistory: updatedTarget,
          });
          for (const child of planned) transaction.delete(child.ref);
          transaction.set(targetRef, updatedTarget);
          return parseLifecycleResult(cleanupResultSchema, {
            code: 'RUN_CLEANUP_PROGRESS',
            targetRunId: target.data.runId,
            targetLeaseFence: target.data.leaseFence,
            targetRunFenceDigest: target.data.runFenceDigest,
            committedRevision,
            remainingChildCount,
            chunkCommittedAt: command.data.now,
          });
        }

        const projection = parseReplayProjection({
          operation: 'cleanup',
          result: 'cleaned',
          targetRunId: target.data.runId,
          targetLeaseFence: target.data.leaseFence,
          targetRunFenceDigest: target.data.runFenceDigest,
          finalRevision: committedRevision,
          cleanedAt: command.data.now,
        });
        const resultDigest = this.digestReplayProjection(projection);
        if (resultDigest === null)
          return { code: 'CORRUPT_STATE' as const, recordKind: 'dependency_result' as const };
        const receipt = matrixCorpusCleanupChunkReceiptV1Schema.parse({
          version: 1,
          idempotencyKeyDigest: command.data.idempotencyKeyDigest,
          canonicalRequestDigest: command.data.canonicalRequestDigest,
          expectedRevision: command.data.expectedRevision,
          committedRevision,
          replayProjection: projection,
          resultDigest,
          recordedAt: command.data.now,
        });
        const updatedCurrent = matrixCorpusLeaseV1Schema.parse({
          ...lease,
          finalCleanupReceipt: receipt,
        });
        const updatedCurrentHistory = matrixCorpusLeaseHistoryV1Schema.parse({
          leaseSlotDigest: command.data.leaseSlotDigest,
          ...updatedCurrent,
        });
        const result = parseLifecycleResult(cleanupResultSchema, {
          code: 'RUN_CLEANED',
          targetRunId: target.data.runId,
          targetLeaseFence: target.data.leaseFence,
          targetRunFenceDigest: target.data.runFenceDigest,
          finalRevision: committedRevision,
          cleanedAt: command.data.now,
        });
        for (const child of planned) transaction.delete(child.ref);
        transaction.set(currentRefs.slot, updatedCurrent);
        transaction.set(currentRefs.history, updatedCurrentHistory);
        transaction.delete(targetRef);
        return result;
      });
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'repository_result' };
    }
  }

  public claimPendingIngestOutbox(input: ClaimPendingIngestOutboxInput): Promise<IngestClaimResult> {
    return this.deliveryRepository.claimPendingIngestOutbox(input);
  }

  public renewIngestOutboxClaim(input: RenewIngestOutboxClaimInput): Promise<ClaimRenewResult> {
    return this.deliveryRepository.renewIngestOutboxClaim(input);
  }

  public acknowledgeIngestOutbox(input: AcknowledgeIngestOutboxInput): Promise<AcknowledgeResult> {
    return this.deliveryRepository.acknowledgeIngestOutbox(input);
  }

  public claimPendingTerminalControlOutbox(
    input: ClaimPendingTerminalControlOutboxInput
  ): Promise<TerminalClaimResult> {
    return this.deliveryRepository.claimPendingTerminalControlOutbox(input);
  }

  public renewTerminalControlOutboxClaim(
    input: RenewTerminalControlOutboxClaimInput
  ): Promise<ClaimRenewResult> {
    return this.deliveryRepository.renewTerminalControlOutboxClaim(input);
  }

  public acknowledgeTerminalControl(
    input: AcknowledgeTerminalControlInput
  ): Promise<TerminalControlAcknowledgementResult> {
    return this.deliveryRepository.acknowledgeTerminalControl(input);
  }
}

export class FirestoreMatrixCorpusDeliveryRepository {
  private readonly firestore: Firestore;

  constructor(deps: FirestoreMatrixCorpusDeliveryRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async claimPendingIngestOutbox(
    input: ClaimPendingIngestOutboxInput
  ): Promise<IngestClaimResult> {
    const command = claimPendingIngestOutboxInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const outboxRef = this.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(command.data.ingestOutboxId);
      const snapshot = await transaction.get(outboxRef);
      const referenced = pair.data.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (!snapshot.exists)
        return referenced
          ? { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const }
          : { code: 'NOT_FOUND' as const };
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        !referenced ||
        parsed.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(pair.data.history, parsed.data)
      )
        return { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' };
      const outbox = parsed.data;
      if (outbox.payloadDigest !== command.data.payloadDigest) return { code: 'CLAIM_CONFLICT' };
      if (outbox.status === 'closed' || outbox.terminalMarker !== null)
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const now = Date.parse(command.data.now);
      const leaseExpiresAt = Date.parse(lease.expiresAt);
      const existingExpiresAt =
        outbox.claim === null ? null : Date.parse(outbox.claim.expiresAt);

      const existing = outbox.claim;
      if (existing !== null && existingExpiresAt !== null && existingExpiresAt > now) {
        if (
          existing.ownerDigest !== command.data.ownerDigest ||
          existing.purpose !== command.data.purpose ||
          existing.expiresAt !== command.data.claimExpiresAt
        )
          return { code: 'CLAIM_CONFLICT' };
        return parseIngestClaimResult({
          code: 'ALREADY_APPLIED',
          operation: 'claim_ingest',
          outboxKind: 'ingest',
          ingestOutboxId: outbox.ingestOutboxId,
          runId: outbox.runId,
          leaseFence: outbox.leaseFence,
          ownerDigest: existing.ownerDigest,
          purpose: existing.purpose,
          claimExpiresAt: existing.expiresAt,
          payload: outbox.payload,
          payloadDigest: outbox.payloadDigest,
        });
      }
      if (
        existing === null &&
        outbox.status === 'pending' &&
        command.data.purpose === 'publish' &&
        lease.phase === 'active' &&
        now >= leaseExpiresAt
      )
        return { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt };

      const freshPublishEligible =
        outbox.status === 'pending' &&
        existing === null &&
        lease.phase === 'active' &&
        now < leaseExpiresAt;
      const publishTakeoverEligible =
        outbox.status === 'claimed' &&
        existing !== null &&
        existingExpiresAt !== null &&
        now >= existingExpiresAt &&
        (lease.phase === 'active' || lease.phase === 'quiescing');
      const publishEligible =
        command.data.purpose === 'publish' &&
        (freshPublishEligible || publishTakeoverEligible);
      const recoveryEligible =
        command.data.purpose === 'terminal_marker_recovery' &&
        outbox.status === 'published' &&
        outbox.terminalMarker === null &&
        ['active', 'quiescing', 'abandon_pending', 'abandoned'].includes(lease.phase);
      if (!publishEligible && !recoveryEligible)
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const updated = matrixCorpusIngestOutboxRecordV1Schema.parse({
        ...outbox,
        status: command.data.purpose === 'publish' ? 'claimed' : 'published',
        claim: {
          ownerDigest: command.data.ownerDigest,
          purpose: command.data.purpose,
          claimedAt: command.data.now,
          expiresAt: command.data.claimExpiresAt,
        },
        lastClaimRenewal: null,
      });
      const result = parseIngestClaimResult({
        code: 'OUTBOX_CLAIMED',
        outboxKind: 'ingest',
        ingestOutboxId: updated.ingestOutboxId,
        runId: updated.runId,
        leaseFence: updated.leaseFence,
        ownerDigest: command.data.ownerDigest,
        purpose: command.data.purpose,
        claimExpiresAt: command.data.claimExpiresAt,
        payload: updated.payload,
        payloadDigest: updated.payloadDigest,
      });
      transaction.set(outboxRef, updated);
      return result;
    });
  }

  async renewIngestOutboxClaim(
    input: RenewIngestOutboxClaimInput
  ): Promise<ClaimRenewResult> {
    const command = renewIngestOutboxClaimInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const outboxRef = this.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(command.data.ingestOutboxId);
      const snapshot = await transaction.get(outboxRef);
      const referenced = pair.data.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (!snapshot.exists)
        return referenced
          ? { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const }
          : { code: 'NOT_FOUND' as const };
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        !referenced ||
        parsed.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(pair.data.history, parsed.data)
      )
        return { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' };
      const outbox = parsed.data;
      if (outbox.payloadDigest !== command.data.payloadDigest) return { code: 'CLAIM_CONFLICT' };
      if (outbox.status === 'closed' || outbox.terminalMarker !== null)
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const renewal = outbox.lastClaimRenewal;
      if (
        renewal !== null &&
        renewal.ownerDigest === command.data.ownerDigest &&
        renewal.purpose === command.data.purpose &&
        renewal.previousClaimExpiresAt === command.data.expectedClaimExpiresAt &&
        renewal.claimExpiresAt === command.data.newClaimExpiresAt
      )
        return parseClaimRenewResult({
          code: 'ALREADY_APPLIED',
          operation: 'renew_claim',
          outboxKind: 'ingest',
          ingestOutboxId: outbox.ingestOutboxId,
          runId: outbox.runId,
          leaseFence: outbox.leaseFence,
          ownerDigest: command.data.ownerDigest,
          purpose: command.data.purpose,
          previousClaimExpiresAt: renewal.previousClaimExpiresAt,
          claimExpiresAt: renewal.claimExpiresAt,
        });

      const claim = outbox.claim;
      const now = Date.parse(command.data.now);
      const previous = Date.parse(command.data.expectedClaimExpiresAt);
      const next = Date.parse(command.data.newClaimExpiresAt);
      const claimedAt = claim === null ? 0 : Date.parse(claim.claimedAt);
      if (
        claim?.ownerDigest !== command.data.ownerDigest ||
        claim.purpose !== command.data.purpose ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= previous ||
        next <= now ||
        next - now > 300_000
      )
        return { code: 'CLAIM_CONFLICT' };

      const phaseAllowsLiveRenewal = ['active', 'quiescing', 'abandon_pending', 'abandoned'].includes(
        lease.phase
      );
      const validPhase =
        phaseAllowsLiveRenewal &&
        ((command.data.purpose === 'publish' && outbox.status === 'claimed') ||
          (command.data.purpose === 'terminal_marker_recovery' &&
            outbox.status === 'published' &&
            outbox.terminalMarker === null));
      if (!validPhase) return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const updated = matrixCorpusIngestOutboxRecordV1Schema.parse({
        ...outbox,
        claim: { ...claim, claimedAt: command.data.now, expiresAt: command.data.newClaimExpiresAt },
        lastClaimRenewal: {
          ownerDigest: command.data.ownerDigest,
          purpose: command.data.purpose,
          previousClaimExpiresAt: command.data.expectedClaimExpiresAt,
          claimExpiresAt: command.data.newClaimExpiresAt,
        },
      });
      const result = parseClaimRenewResult({
        code: 'OUTBOX_CLAIM_RENEWED',
        outboxKind: 'ingest',
        ingestOutboxId: updated.ingestOutboxId,
        runId: updated.runId,
        leaseFence: updated.leaseFence,
        ownerDigest: command.data.ownerDigest,
        purpose: command.data.purpose,
        previousClaimExpiresAt: command.data.expectedClaimExpiresAt,
        claimExpiresAt: command.data.newClaimExpiresAt,
      });
      transaction.set(outboxRef, updated);
      return result;
    });
  }

  async acknowledgeIngestOutbox(
    input: AcknowledgeIngestOutboxInput
  ): Promise<AcknowledgeResult> {
    const command = acknowledgeIngestOutboxInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const outboxRef = this.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(command.data.ingestOutboxId);
      const snapshot = await transaction.get(outboxRef);
      const referenced = pair.data.history.ingestOutboxIds.includes(command.data.ingestOutboxId);
      if (!snapshot.exists)
        return referenced
          ? { code: 'CORRUPT_STATE' as const, recordKind: 'ingest_outbox' as const }
          : { code: 'NOT_FOUND' as const };
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        !referenced ||
        parsed.data.ingestOutboxId !== command.data.ingestOutboxId ||
        !hasLeaseIdentity(pair.data.history, parsed.data)
      )
        return { code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' };
      const outbox = parsed.data;
      if (
        outbox.ingestReceiptId !== command.data.ingestReceiptId ||
        outbox.payloadDigest !== command.data.payloadDigest
      )
        return { code: 'CLAIM_CONFLICT' };

      const retained = outbox.acknowledgementReceipts.find(
        (receipt) => receipt.outcome.kind === command.data.outcome.kind
      );
      if (retained !== undefined) {
        if (
          retained.ownerDigest !== command.data.ownerDigest ||
          retained.claimPurpose !== command.data.claimPurpose ||
          retained.expectedClaimExpiresAt !== command.data.expectedClaimExpiresAt ||
          !deeplyEqual(retained.outcome, command.data.outcome)
        )
          return { code: 'CLAIM_CONFLICT' };
        return parseAcknowledgeResult({
          code: 'ALREADY_APPLIED',
          operation: 'acknowledge_ingest',
          outboxKind: 'ingest',
          ingestOutboxId: outbox.ingestOutboxId,
          runId: outbox.runId,
          leaseFence: outbox.leaseFence,
          payloadDigest: outbox.payloadDigest,
          outcome: retained.outcome,
          acknowledgedAt: retained.acknowledgedAt,
          drained: retained.drained,
        });
      }

      const claim = outbox.claim;
      const now = Date.parse(command.data.now);
      const expiry = Date.parse(command.data.expectedClaimExpiresAt);
      const claimedAt = claim === null ? 0 : Date.parse(claim.claimedAt);
      if (
        claim?.ownerDigest !== command.data.ownerDigest ||
        claim.purpose !== command.data.claimPurpose ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= expiry
      )
        return { code: 'CLAIM_CONFLICT' };

      const acknowledgedAt =
        command.data.outcome.kind === 'publication_acknowledged'
          ? command.data.outcome.publishedAt
          : command.data.outcome.kind === 'terminal_marker_acknowledged'
            ? command.data.outcome.terminalMarker.recordedAt
            : command.data.outcome.closedAt;
      const liveCompletionPhase = ['active', 'quiescing', 'abandon_pending', 'abandoned'].includes(
        lease.phase
      );
      if (command.data.outcome.kind === 'publication_acknowledged') {
        if (
          outbox.status !== 'claimed' ||
          command.data.claimPurpose !== 'publish' ||
          !liveCompletionPhase
        )
          return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
        const receipt = matrixCorpusIngestAcknowledgementReceiptV1Schema.parse({
          version: 1,
          ownerDigest: command.data.ownerDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: command.data.expectedClaimExpiresAt,
          outcome: command.data.outcome,
          acknowledgedAt,
          drained: false,
        });
        const updated = matrixCorpusIngestOutboxRecordV1Schema.parse({
          ...outbox,
          status: 'published',
          claim: { ...claim, purpose: 'terminal_marker_recovery' },
          publisherReceiptDigest: command.data.outcome.publisherReceiptDigest,
          publishedAt: command.data.outcome.publishedAt,
          acknowledgementReceipts: [receipt],
        });
        const result = parseAcknowledgeResult({
          code: 'OUTBOX_ACKNOWLEDGED',
          outboxKind: 'ingest',
          ingestOutboxId: updated.ingestOutboxId,
          runId: updated.runId,
          leaseFence: updated.leaseFence,
          payloadDigest: updated.payloadDigest,
          outcome: command.data.outcome,
          acknowledgedAt,
          drained: false,
        });
        transaction.set(outboxRef, updated);
        return result;
      }

      let provisionalLease = lease;
      if (command.data.outcome.kind === 'terminal_marker_acknowledged') {
        const publicationReceipt = outbox.acknowledgementReceipts[0];
        if (
          outbox.status !== 'published' ||
          outbox.terminalMarker !== null ||
          command.data.claimPurpose !== 'terminal_marker_recovery' ||
          !liveCompletionPhase
        )
          return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
        if (
          outbox.publisherReceiptDigest !== command.data.outcome.publisherReceiptDigest ||
          outbox.publishedAt !== command.data.outcome.publishedAt ||
          publicationReceipt?.outcome.kind !== 'publication_acknowledged' ||
          publicationReceipt.outcome.publisherReceiptDigest !==
            command.data.outcome.publisherReceiptDigest ||
          publicationReceipt.outcome.publishedAt !== command.data.outcome.publishedAt
        )
          return { code: 'CLAIM_CONFLICT' };
        provisionalLease = {
          ...lease,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => id !== outbox.ingestOutboxId
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
            ['quiesced', 'capability_replay'].includes(command.data.outcome.reason)) ||
          (['abandon_pending', 'abandoned'].includes(lease.phase) &&
            command.data.outcome.reason === 'abandoned');
        if (
          outbox.status !== 'claimed' ||
          outbox.publisherReceiptDigest !== null ||
          outbox.terminalMarker !== null ||
          command.data.claimPurpose !== 'publish' ||
          command.data.outcome.closedAt !== command.data.now ||
          !validReason
        )
          return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
        provisionalLease = {
          ...lease,
          nonterminalIngestOutboxIds: lease.nonterminalIngestOutboxIds.filter(
            (id) => id !== outbox.ingestOutboxId
          ),
          drain: { ...lease.drain, drained: false },
        };
      }

      const drained = hasDrainedLeaseState(provisionalLease);
      const updatedLease = { ...provisionalLease, drain: { ...provisionalLease.drain, drained } };
      const receipt = matrixCorpusIngestAcknowledgementReceiptV1Schema.parse({
        version: 1,
        ownerDigest: command.data.ownerDigest,
        claimPurpose: command.data.claimPurpose,
        expectedClaimExpiresAt: command.data.expectedClaimExpiresAt,
        outcome: command.data.outcome,
        acknowledgedAt,
        drained,
      });
      const updatedOutbox = matrixCorpusIngestOutboxRecordV1Schema.parse(
        command.data.outcome.kind === 'terminal_marker_acknowledged'
          ? {
              ...outbox,
              terminalMarker: command.data.outcome.terminalMarker,
              acknowledgementReceipts: [...outbox.acknowledgementReceipts, receipt],
            }
          : {
              ...outbox,
              status: 'closed',
              closedReason: command.data.outcome.reason,
              closedAt: command.data.outcome.closedAt,
              acknowledgementReceipts: [receipt],
            }
      );
      const updatedPair = matrixCorpusCurrentLeaseHistoryPairV1Schema.parse({
        leaseSlotDigest: command.data.leaseSlotDigest,
        current: updatedLease,
        history: { ...updatedLease, leaseSlotDigest: command.data.leaseSlotDigest },
      });
      const result = parseAcknowledgeResult({
        code: 'OUTBOX_ACKNOWLEDGED',
        outboxKind: 'ingest',
        ingestOutboxId: updatedOutbox.ingestOutboxId,
        runId: updatedOutbox.runId,
        leaseFence: updatedOutbox.leaseFence,
        payloadDigest: updatedOutbox.payloadDigest,
        outcome: command.data.outcome,
        acknowledgedAt,
        drained,
      });
      transaction.set(outboxRef, updatedOutbox);
      transaction.set(slot, updatedPair.current);
      transaction.set(history, updatedPair.history);
      return result;
    });
  }

  async claimPendingTerminalControlOutbox(
    input: ClaimPendingTerminalControlOutboxInput
  ): Promise<TerminalClaimResult> {
    const command = claimPendingTerminalControlOutboxInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const outboxRef = this.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc(command.data.terminalControlId);
      const snapshot = await transaction.get(outboxRef);
      const referenced = pair.data.history.terminalControlOutboxIds.includes(
        command.data.terminalControlId
      );
      if (!snapshot.exists)
        return referenced
          ? { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const }
          : { code: 'NOT_FOUND' as const };
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        !referenced ||
        parsed.data.terminalControlId !== command.data.terminalControlId ||
        parsed.data.eventId !== command.data.eventId ||
        !hasLeaseIdentity(pair.data.history, parsed.data)
      )
        return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
      const outbox = parsed.data;
      if (outbox.payloadDigest !== command.data.payloadDigest) return { code: 'CLAIM_CONFLICT' };
      if (lease.phase === 'released' || lease.phase === 'abandoned')
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
      if (outbox.status === 'published' || outbox.status === 'closed')
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const validPhase =
        (outbox.kind === 'release' &&
          (lease.phase === 'release_pending' || lease.phase === 'abandon_pending')) ||
        (outbox.kind === 'abandoned' && lease.phase === 'abandon_pending');
      if (!validPhase) return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const now = Date.parse(command.data.now);
      const leaseExpiresAt = Date.parse(lease.expiresAt);
      const existingExpiresAt =
        outbox.claim === null ? null : Date.parse(outbox.claim.expiresAt);
      const existing = outbox.claim;
      if (existing !== null && existingExpiresAt !== null && existingExpiresAt > now) {
        if (
          existing.ownerDigest !== command.data.ownerDigest ||
          existing.expiresAt !== command.data.claimExpiresAt
        )
          return { code: 'CLAIM_CONFLICT' };
        return parseTerminalClaimResult({
          code: 'ALREADY_APPLIED',
          operation: 'claim_terminal',
          outboxKind: 'terminal',
          terminalControlId: outbox.terminalControlId,
          eventId: outbox.eventId,
          runId: outbox.runId,
          leaseFence: outbox.leaseFence,
          ownerDigest: existing.ownerDigest,
          claimExpiresAt: existing.expiresAt,
          payload: outbox.payload,
          payloadDigest: outbox.payloadDigest,
        });
      }
      if (outbox.kind === 'release' && lease.phase === 'release_pending' && now >= leaseExpiresAt)
        return { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt };

      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
        ...outbox,
        status: 'claimed',
        claim: {
          ownerDigest: command.data.ownerDigest,
          purpose: 'publish',
          claimedAt: command.data.now,
          expiresAt: command.data.claimExpiresAt,
        },
        lastClaimRenewal: null,
      });
      const result = parseTerminalClaimResult({
        code: 'OUTBOX_CLAIMED',
        outboxKind: 'terminal',
        terminalControlId: updated.terminalControlId,
        eventId: updated.eventId,
        runId: updated.runId,
        leaseFence: updated.leaseFence,
        ownerDigest: command.data.ownerDigest,
        claimExpiresAt: command.data.claimExpiresAt,
        payload: updated.payload,
        payloadDigest: updated.payloadDigest,
      });
      transaction.set(outboxRef, updated);
      return result;
    });
  }

  async renewTerminalControlOutboxClaim(
    input: RenewTerminalControlOutboxClaimInput
  ): Promise<ClaimRenewResult> {
    const command = renewTerminalControlOutboxClaimInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const outboxRef = this.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc(command.data.terminalControlId);
      const snapshot = await transaction.get(outboxRef);
      const referenced = pair.data.history.terminalControlOutboxIds.includes(
        command.data.terminalControlId
      );
      if (!snapshot.exists)
        return referenced
          ? { code: 'CORRUPT_STATE' as const, recordKind: 'terminal_outbox' as const }
          : { code: 'NOT_FOUND' as const };
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(snapshot.data());
      if (
        !parsed.success ||
        !referenced ||
        parsed.data.terminalControlId !== command.data.terminalControlId ||
        parsed.data.eventId !== command.data.eventId ||
        !hasLeaseIdentity(pair.data.history, parsed.data)
      )
        return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
      const outbox = parsed.data;
      if (outbox.payloadDigest !== command.data.payloadDigest) return { code: 'CLAIM_CONFLICT' };
      if (lease.phase === 'released' || lease.phase === 'abandoned')
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
      if (outbox.status === 'published' || outbox.status === 'closed')
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
      const validPhase =
        (outbox.kind === 'release' &&
          (lease.phase === 'release_pending' || lease.phase === 'abandon_pending')) ||
        (outbox.kind === 'abandoned' && lease.phase === 'abandon_pending');
      if (!validPhase) return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };

      const renewal = outbox.lastClaimRenewal;
      if (
        renewal !== null &&
        renewal.ownerDigest === command.data.ownerDigest &&
        renewal.previousClaimExpiresAt === command.data.expectedClaimExpiresAt &&
        renewal.claimExpiresAt === command.data.newClaimExpiresAt
      )
        return parseClaimRenewResult({
          code: 'ALREADY_APPLIED',
          operation: 'renew_claim',
          outboxKind: 'terminal',
          terminalControlId: outbox.terminalControlId,
          eventId: outbox.eventId,
          runId: outbox.runId,
          leaseFence: outbox.leaseFence,
          ownerDigest: command.data.ownerDigest,
          previousClaimExpiresAt: renewal.previousClaimExpiresAt,
          claimExpiresAt: renewal.claimExpiresAt,
        });

      const claim = outbox.claim;
      const now = Date.parse(command.data.now);
      const previous = Date.parse(command.data.expectedClaimExpiresAt);
      const next = Date.parse(command.data.newClaimExpiresAt);
      const leaseExpiry = Date.parse(lease.expiresAt);
      const claimedAt = claim === null ? 0 : Date.parse(claim.claimedAt);
      if (outbox.kind === 'release' && lease.phase === 'release_pending' && now >= leaseExpiry)
        return { code: 'LEASE_EXPIRED', expiresAt: lease.expiresAt };
      if (
        claim?.ownerDigest !== command.data.ownerDigest ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= previous ||
        next <= now ||
        next - now > 300_000
      )
        return { code: 'CLAIM_CONFLICT' };

      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
        ...outbox,
        claim: { ...claim, claimedAt: command.data.now, expiresAt: command.data.newClaimExpiresAt },
        lastClaimRenewal: {
          ownerDigest: command.data.ownerDigest,
          previousClaimExpiresAt: command.data.expectedClaimExpiresAt,
          claimExpiresAt: command.data.newClaimExpiresAt,
        },
      });
      const result = parseClaimRenewResult({
        code: 'OUTBOX_CLAIM_RENEWED',
        outboxKind: 'terminal',
        terminalControlId: updated.terminalControlId,
        eventId: updated.eventId,
        runId: updated.runId,
        leaseFence: updated.leaseFence,
        ownerDigest: command.data.ownerDigest,
        previousClaimExpiresAt: command.data.expectedClaimExpiresAt,
        claimExpiresAt: command.data.newClaimExpiresAt,
      });
      transaction.set(outboxRef, updated);
      return result;
    });
  }

  async acknowledgeTerminalControl(
    input: AcknowledgeTerminalControlInput
  ): Promise<TerminalControlAcknowledgementResult> {
    const command = acknowledgeTerminalControlInputSchema.safeParse(input);
    if (!command.success) return { code: 'CORRUPT_STATE', recordKind: 'command' };

    return await this.firestore.runTransaction(async (transaction) => {
      const slot = this.firestore
        .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
        .doc(command.data.leaseSlotDigest);
      const history = slot.collection('runs').doc(command.data.runFenceDigest);
      const pair = await readDeliveryPair(transaction, slot, history, command.data.leaseSlotDigest);
      if (pair.kind !== 'found') return pair.result;
      const lease = pair.data.current;
      if (!hasExactLeaseAuthority(lease, command.data)) return { code: 'STALE_FENCE' };

      const records = new Map<
        string,
        ReturnType<typeof matrixCorpusTerminalControlOutboxRecordV1Schema.parse>
      >();
      const refs = new Map<
        string,
        ReturnType<ReturnType<Firestore['collection']>['doc']>
      >();
      for (const terminalControlId of lease.terminalControlOutboxIds) {
        const ref = this.firestore
          .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
          .doc(terminalControlId);
        const snapshot = await transaction.get(ref);
        const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(snapshot.data());
        if (
          !snapshot.exists ||
          !parsed.success ||
          parsed.data.terminalControlId !== terminalControlId ||
          !hasLeaseIdentity(pair.data.history, parsed.data)
        )
          return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
        records.set(terminalControlId, parsed.data);
        refs.set(terminalControlId, ref);
      }

      const request = records.get(command.data.requestTerminalControlId);
      if (request === undefined) return { code: 'NOT_FOUND' };
      if (
        request.eventId !== command.data.requestEventId ||
        request.payloadDigest !== command.data.requestPayloadDigest
      )
        return { code: 'CLAIM_CONFLICT' };

      if (request.status === 'published') {
        const retainedWinner = lease.terminalWinner;
        if (
          retainedWinner === null ||
          request.claim === null ||
          request.acknowledgedAt !== retainedWinner.acknowledgedAt
        )
          return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
        if (
          request.claim.ownerDigest !== command.data.ownerDigest ||
          request.claim.expiresAt !== command.data.expectedClaimExpiresAt ||
          !deeplyEqual(retainedWinner, command.data.authoritativeWinner)
        )
          return { code: 'CLAIM_CONFLICT' };
        const winner = records.get(retainedWinner.eventId) as ReturnType<
          typeof matrixCorpusTerminalControlOutboxRecordV1Schema.parse
        >;
        if (
          winner.kind !== retainedWinner.kind ||
          winner.payloadDigest !== retainedWinner.payloadDigest ||
          winner.status === 'closed'
        )
          return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
        return parseTerminalAcknowledgementResult({
          code: 'ALREADY_APPLIED',
          operation: 'acknowledge_terminal',
          outboxKind: 'terminal',
          requestTerminalControlId: request.terminalControlId,
          requestEventId: request.eventId,
          runId: request.runId,
          leaseFence: request.leaseFence,
          requestPayloadDigest: request.payloadDigest,
          authoritativeWinner: retainedWinner,
          leasePhase: retainedWinner.kind === 'release' ? 'released' : 'abandoned',
        });
      }

      if (request.status !== 'claimed')
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
      const claim = request.claim as Exclude<typeof request.claim, null>;
      const now = Date.parse(command.data.now);
      const claimedAt = Date.parse(claim.claimedAt);
      const claimExpiresAt = Date.parse(command.data.expectedClaimExpiresAt);
      if (
        claim.ownerDigest !== command.data.ownerDigest ||
        claim.expiresAt !== command.data.expectedClaimExpiresAt ||
        now < claimedAt ||
        now >= claimExpiresAt
      )
        return { code: 'CLAIM_CONFLICT' };

      const pendingPhase = lease.phase === 'release_pending' || lease.phase === 'abandon_pending';
      const finalPhase = lease.phase === 'released' || lease.phase === 'abandoned';
      if (!pendingPhase && !finalPhase)
        return { code: 'PHASE_CONFLICT', actualPhase: lease.phase };
      if (
        lease.terminalWinner !== null &&
        !deeplyEqual(lease.terminalWinner, command.data.authoritativeWinner)
      )
        return { code: 'CLAIM_CONFLICT' };

      const winner = command.data.authoritativeWinner;
      const winnerRecord = records.get(winner.eventId);
      if (
        winnerRecord?.kind !== winner.kind ||
        winnerRecord.payloadDigest !== winner.payloadDigest ||
        winnerRecord.status === 'closed'
      )
        return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };

      const publishedRequest = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
        ...request,
        status: 'published',
        acknowledgedAt: winner.acknowledgedAt,
      });
      const updates = new Map<string, typeof publishedRequest>([
        [publishedRequest.terminalControlId, publishedRequest],
      ]);
      for (const [terminalControlId, terminal] of records) {
        if (terminalControlId === winner.eventId) continue;
        if (terminal.status === 'pending') {
          const closed = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
            ...terminal,
            status: 'closed',
            closedReason: 'superseded_by_authoritative_winner',
            closedAt: winner.acknowledgedAt,
          });
          updates.set(terminalControlId, closed);
        } else if (
          terminal.status === 'closed' &&
          terminal.closedReason === 'expired_unclaimed_release'
        ) {
          const superseded = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
            ...terminal,
            closedReason: 'superseded_by_authoritative_winner',
            closedAt: winner.acknowledgedAt,
          });
          updates.set(terminalControlId, superseded);
        } else if (
          terminal.status === 'closed' &&
          (terminal.closedReason !== 'superseded_by_authoritative_winner' ||
            terminal.closedAt !== winner.acknowledgedAt)
        )
          return { code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' };
      }

      const finalPhaseValue = winner.kind === 'release' ? ('released' as const) : ('abandoned' as const);
      const updatedLease = {
        ...lease,
        phase: finalPhaseValue,
        terminalWinner: winner,
        releasedAt: winner.kind === 'release' ? winner.acknowledgedAt : null,
        abandonedAt: winner.kind === 'abandoned' ? winner.acknowledgedAt : null,
        drain: { ...lease.drain, drained: false },
      };
      const updatedPair = matrixCorpusCurrentLeaseHistoryPairV1Schema.parse({
        leaseSlotDigest: command.data.leaseSlotDigest,
        current: updatedLease,
        history: { ...updatedLease, leaseSlotDigest: command.data.leaseSlotDigest },
      });
      const result = parseTerminalAcknowledgementResult({
        code: 'OUTBOX_ACKNOWLEDGED',
        outboxKind: 'terminal',
        requestTerminalControlId: publishedRequest.terminalControlId,
        requestEventId: publishedRequest.eventId,
        runId: publishedRequest.runId,
        leaseFence: publishedRequest.leaseFence,
        requestPayloadDigest: publishedRequest.payloadDigest,
        authoritativeWinner: winner,
        leasePhase: finalPhaseValue,
      });
      for (const [terminalControlId, update] of updates) {
        const ref = refs.get(terminalControlId) as ReturnType<
          ReturnType<Firestore['collection']>['doc']
        >;
        transaction.set(ref, update);
      }
      transaction.set(slot, updatedPair.current);
      transaction.set(history, updatedPair.history);
      return result;
    });
  }
}

export class FirestoreMatrixCorpusSignedEnvelopeStore
  implements MatrixCorpusSignedEnvelopeStore
{
  private readonly firestore: Firestore;

  constructor(deps: FirestoreMatrixCorpusSignedEnvelopeStoreDeps) {
    this.firestore = deps.firestore;
  }

  async prepareIngest(
    input: SignedIngestEnvelopeStoreInput &
      Readonly<{ proposedIssuedAt: string; proposedExpiresAt: string }>
  ): Promise<unknown> {
    assertBaseAuthority(input);
    if (!matrixCorpusSafeIdSchema.safeParse(input.ingestOutboxId).success)
      throw authorityRejected();
    const proposedWindow = matrixCorpusIngestDeliveryAttestationV1Schema.safeParse({
      generation: 1,
      issuedAt: input.proposedIssuedAt,
      expiresAt: input.proposedExpiresAt,
      envelope: null,
    });
    if (!proposedWindow.success) throw authorityRejected();

    return await this.firestore.runTransaction(async (transaction) => {
      const refs = this.ingestRefs(input);
      const pair = await readCurrentPair(transaction, refs.slot, refs.history, input);
      const snapshot = await transaction.get(refs.outbox);
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success || !hasIngestAuthority(pair.current, parsed.data, input))
        throw authorityRejected();

      const existing = parsed.data.deliveryAttestation;
      if (
        existing !== undefined &&
        Date.parse(input.proposedIssuedAt) <=
          Date.parse(existing.expiresAt) + ACCEPTED_CLOCK_SKEW_MILLISECONDS
      )
        return ingestPreparation(existing);
      const claimExpiresAt = parsed.data.claim?.expiresAt;
      if (
        claimExpiresAt === undefined ||
        !hasLiveSigningAuthority(pair.current.expiresAt, claimExpiresAt, input.proposedIssuedAt)
      )
        throw authorityRejected();

      const next = {
        generation: existing === undefined ? 1 : existing.generation + 1,
        issuedAt: input.proposedIssuedAt,
        expiresAt: input.proposedExpiresAt,
        envelope: null,
      };
      const updated = matrixCorpusIngestOutboxRecordV1Schema.parse({
        ...parsed.data,
        deliveryAttestation: next,
      });
      transaction.set(refs.outbox, updated);
      return ingestPreparation(next);
    });
  }

  async completeIngest(
    input: SignedIngestEnvelopeStoreInput &
      Readonly<{
        generation: number;
        issuedAt: string;
        expiresAt: string;
        envelope: Parameters<MatrixCorpusSignedEnvelopeStore['completeIngest']>[0]['envelope'];
      }>
  ): Promise<unknown> {
    assertBaseAuthority(input);
    if (!matrixCorpusSafeIdSchema.safeParse(input.ingestOutboxId).success)
      throw authorityRejected();
    const completedWindow = matrixCorpusIngestDeliveryAttestationV1Schema.safeParse({
      generation: input.generation,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      envelope: input.envelope,
    });
    if (!completedWindow.success) throw authorityRejected();

    return await this.firestore.runTransaction(async (transaction) => {
      const refs = this.ingestRefs(input);
      const pair = await readCurrentPair(transaction, refs.slot, refs.history, input);
      const snapshot = await transaction.get(refs.outbox);
      const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success || !hasIngestAuthority(pair.current, parsed.data, input))
        throw authorityRejected();
      const existing = parsed.data.deliveryAttestation;
      if (
        existing?.generation !== input.generation ||
        existing.issuedAt !== input.issuedAt ||
        existing.expiresAt !== input.expiresAt
      )
        throw conflict();
      if (existing.envelope !== null) {
        if (JSON.stringify(existing.envelope) !== JSON.stringify(completedWindow.data.envelope))
          throw conflict();
        return ingestPreparation(existing);
      }

      const updated = matrixCorpusIngestOutboxRecordV1Schema.parse({
        ...parsed.data,
        deliveryAttestation: completedWindow.data,
      });
      transaction.set(refs.outbox, updated);
      return ingestPreparation(completedWindow.data);
    });
  }

  async prepareTerminal(
    input: SignedTerminalEnvelopeStoreInput &
      Readonly<{ proposedIssuedAt: string; proposedExpiresAt: string }>
  ): Promise<unknown> {
    assertBaseAuthority(input);
    if (
      !matrixCorpusSafeIdSchema.safeParse(input.terminalControlId).success ||
      input.terminalControlId !== input.eventId
    )
      throw authorityRejected();
    const proposedWindow = matrixCorpusTerminalDeliveryAttestationV1Schema.safeParse({
      generation: 1,
      issuedAt: input.proposedIssuedAt,
      expiresAt: input.proposedExpiresAt,
      envelope: null,
    });
    if (!proposedWindow.success) throw authorityRejected();

    return await this.firestore.runTransaction(async (transaction) => {
      const refs = this.terminalRefs(input);
      const pair = await readCurrentPair(transaction, refs.slot, refs.history, input);
      const snapshot = await transaction.get(refs.outbox);
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success || !hasTerminalAuthority(pair.current, parsed.data, input))
        throw authorityRejected();

      const existing = parsed.data.deliveryAttestation;
      if (
        existing !== undefined &&
        Date.parse(input.proposedIssuedAt) <=
          Date.parse(existing.expiresAt) + ACCEPTED_CLOCK_SKEW_MILLISECONDS
      )
        return terminalPreparation(existing);
      const claimExpiresAt = parsed.data.claim?.expiresAt;
      if (
        claimExpiresAt === undefined ||
        !hasLiveSigningAuthority(pair.current.expiresAt, claimExpiresAt, input.proposedIssuedAt)
      )
        throw authorityRejected();

      const next = {
        generation: existing === undefined ? 1 : existing.generation + 1,
        issuedAt: input.proposedIssuedAt,
        expiresAt: input.proposedExpiresAt,
        envelope: null,
      };
      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
        ...parsed.data,
        deliveryAttestation: next,
      });
      transaction.set(refs.outbox, updated);
      return terminalPreparation(next);
    });
  }

  async completeTerminal(
    input: SignedTerminalEnvelopeStoreInput &
      Readonly<{
        generation: number;
        issuedAt: string;
        expiresAt: string;
        envelope: Parameters<MatrixCorpusSignedEnvelopeStore['completeTerminal']>[0]['envelope'];
      }>
  ): Promise<unknown> {
    assertBaseAuthority(input);
    if (
      !matrixCorpusSafeIdSchema.safeParse(input.terminalControlId).success ||
      input.terminalControlId !== input.eventId
    )
      throw authorityRejected();
    const completedWindow = matrixCorpusTerminalDeliveryAttestationV1Schema.safeParse({
      generation: input.generation,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      envelope: input.envelope,
    });
    if (!completedWindow.success) throw authorityRejected();

    return await this.firestore.runTransaction(async (transaction) => {
      const refs = this.terminalRefs(input);
      const pair = await readCurrentPair(transaction, refs.slot, refs.history, input);
      const snapshot = await transaction.get(refs.outbox);
      const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(snapshot.data());
      if (!snapshot.exists || !parsed.success || !hasTerminalAuthority(pair.current, parsed.data, input))
        throw authorityRejected();
      const existing = parsed.data.deliveryAttestation;
      if (
        existing?.generation !== input.generation ||
        existing.issuedAt !== input.issuedAt ||
        existing.expiresAt !== input.expiresAt
      )
        throw conflict();
      if (existing.envelope !== null) {
        if (JSON.stringify(existing.envelope) !== JSON.stringify(completedWindow.data.envelope))
          throw conflict();
        return terminalPreparation(existing);
      }

      const updated = matrixCorpusTerminalControlOutboxRecordV1Schema.parse({
        ...parsed.data,
        deliveryAttestation: completedWindow.data,
      });
      transaction.set(refs.outbox, updated);
      return terminalPreparation(completedWindow.data);
    });
  }

  private ingestRefs(input: SignedIngestEnvelopeStoreInput): IngestEnvelopeReferences {
    const slot = this.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(input.leaseSlotDigest);
    return {
      slot,
      history: slot.collection('runs').doc(input.runFenceDigest),
      outbox: this.firestore
        .collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION)
        .doc(input.ingestOutboxId),
    };
  }

  private terminalRefs(input: SignedTerminalEnvelopeStoreInput): TerminalEnvelopeReferences {
    const slot = this.firestore
      .collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION)
      .doc(input.leaseSlotDigest);
    return {
      slot,
      history: slot.collection('runs').doc(input.runFenceDigest),
      outbox: this.firestore
        .collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION)
        .doc(input.terminalControlId),
    };
  }
}

async function readCurrentPair(
  transaction: FirestoreTransaction,
  slotRef: ReturnType<Firestore['collection']> extends infer _Collection
    ? ReturnType<ReturnType<Firestore['collection']>['doc']>
    : never,
  historyRef: ReturnType<ReturnType<Firestore['collection']>['doc']>,
  input: SignedEnvelopeAuthority
): Promise<ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>> {
  const slot = await transaction.get(slotRef);
  const history = await transaction.get(historyRef);
  const parsed = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
    leaseSlotDigest: input.leaseSlotDigest,
    current: slot.data(),
    history: history.data(),
  });
  if (!slot.exists || !history.exists || !parsed.success) throw authorityRejected();
  const current = parsed.data.current;
  if (
    current.runtimeAudience !== input.runtimeAudience ||
    current.runId !== input.runId ||
    current.userId !== input.userId ||
    current.leaseFence !== input.leaseFence ||
    current.runFenceDigest !== input.runFenceDigest
  )
    throw authorityRejected();
  return parsed.data;
}

function hasIngestAuthority(
  lease: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>['current'],
  outbox: ReturnType<typeof matrixCorpusIngestOutboxRecordV1Schema.parse>,
  input: SignedIngestEnvelopeStoreInput
): boolean {
  return (
    ['active', 'quiescing', 'abandon_pending', 'abandoned'].includes(lease.phase) &&
    lease.ingestOutboxIds.includes(input.ingestOutboxId) &&
    lease.nonterminalIngestOutboxIds.includes(input.ingestOutboxId) &&
    outbox.status === 'claimed' &&
    outbox.ingestOutboxId === input.ingestOutboxId &&
    outbox.runId === input.runId &&
    outbox.userId === input.userId &&
    outbox.leaseFence === input.leaseFence &&
    outbox.payloadDigest === input.payloadDigest &&
    outbox.claim?.ownerDigest === input.ownerDigest &&
    outbox.claim.purpose === 'publish' &&
    outbox.claim.expiresAt === input.expectedClaimExpiresAt
  );
}

function hasTerminalAuthority(
  lease: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>['current'],
  outbox: ReturnType<typeof matrixCorpusTerminalControlOutboxRecordV1Schema.parse>,
  input: SignedTerminalEnvelopeStoreInput
): boolean {
  return (
    ['release_pending', 'abandon_pending', 'abandoned'].includes(lease.phase) &&
    lease.terminalControlOutboxIds.includes(input.terminalControlId) &&
    outbox.status === 'claimed' &&
    outbox.terminalControlId === input.terminalControlId &&
    outbox.eventId === input.eventId &&
    outbox.runId === input.runId &&
    outbox.userId === input.userId &&
    outbox.leaseFence === input.leaseFence &&
    outbox.payloadDigest === input.payloadDigest &&
    outbox.claim?.ownerDigest === input.ownerDigest &&
    outbox.claim.purpose === 'publish' &&
    outbox.claim.expiresAt === input.expectedClaimExpiresAt
  );
}

function assertBaseAuthority(input: SignedEnvelopeAuthority): void {
  if (
    input.runtimeAudience !== 'home-dev' ||
    !matrixCorpusSafeIdSchema.safeParse(input.runId).success ||
    !matrixCorpusSafeIdSchema.safeParse(input.userId).success ||
    !matrixCorpusDecimalFenceSchema.safeParse(input.leaseFence).success ||
    !matrixCorpusKeyedDigestSchema.safeParse(input.leaseSlotDigest).success ||
    !matrixCorpusKeyedDigestSchema.safeParse(input.runFenceDigest).success ||
    !matrixCorpusKeyedDigestSchema.safeParse(input.ownerDigest).success ||
    !matrixCorpusSha256DigestSchema.safeParse(input.payloadDigest).success
  )
    throw authorityRejected();
}

function hasLiveSigningAuthority(
  leaseExpiresAt: string,
  claimExpiresAt: string,
  proposedIssuedAt: string
): boolean {
  const issuedAt = Date.parse(proposedIssuedAt);
  return issuedAt < Date.parse(leaseExpiresAt) && issuedAt < Date.parse(claimExpiresAt);
}

function ingestPreparation(
  state: ReturnType<typeof matrixCorpusIngestDeliveryAttestationV1Schema.parse>
): unknown {
  return state.envelope === null
    ? {
        kind: 'reserved' as const,
        generation: state.generation,
        issuedAt: state.issuedAt,
        expiresAt: state.expiresAt,
      }
    : { kind: 'ready' as const, ...structuredClone(state), envelope: structuredClone(state.envelope) };
}

function terminalPreparation(
  state: ReturnType<typeof matrixCorpusTerminalDeliveryAttestationV1Schema.parse>
): unknown {
  return state.envelope === null
    ? {
        kind: 'reserved' as const,
        generation: state.generation,
        issuedAt: state.issuedAt,
        expiresAt: state.expiresAt,
      }
    : { kind: 'ready' as const, ...structuredClone(state), envelope: structuredClone(state.envelope) };
}

function lifecyclePairRefs(
  firestore: Firestore,
  leaseSlotDigest: string,
  runFenceDigest: string
): LifecyclePairReferences {
  const slot = firestore.collection(MATRIX_CORPUS_RUN_LEASES_COLLECTION).doc(leaseSlotDigest);
  return { slot, history: slot.collection('runs').doc(runFenceDigest) };
}

function leaseExpiryFailure(
  now: string,
  expiresAt: string
):
  | Readonly<{ code: 'LEASE_EXPIRED'; expiresAt: string }>
  | null {
  const parsedNow = Date.parse(now);
  const parsedExpiry = Date.parse(expiresAt);
  return parsedNow >= parsedExpiry ? { code: 'LEASE_EXPIRED', expiresAt } : null;
}

type CleanupChildKind =
  | 'renew_receipt'
  | 'issuance_receipt'
  | 'capability'
  | 'transport_receipt'
  | 'ingest_outbox'
  | 'terminal_outbox';

function cleanupChildRef(
  firestore: Firestore,
  targetHistoryRef: ReturnType<ReturnType<Firestore['collection']>['doc']>,
  kind: CleanupChildKind,
  key: string
): ReturnType<ReturnType<Firestore['collection']>['doc']> {
  if (kind === 'renew_receipt')
    return targetHistoryRef.collection(MATRIX_CORPUS_RENEW_RECEIPTS_SUBCOLLECTION).doc(key);
  if (kind === 'issuance_receipt')
    return targetHistoryRef.collection(MATRIX_CORPUS_ISSUANCE_RECEIPTS_SUBCOLLECTION).doc(key);
  if (kind === 'capability')
    return firestore.collection(MATRIX_CORPUS_CAPABILITIES_COLLECTION).doc(key);
  if (kind === 'transport_receipt')
    return firestore.collection(MATRIX_CORPUS_TRANSPORT_RECEIPTS_COLLECTION).doc(key);
  if (kind === 'ingest_outbox')
    return firestore.collection(MATRIX_CORPUS_INGEST_OUTBOX_COLLECTION).doc(key);
  return firestore.collection(MATRIX_CORPUS_TERMINAL_CONTROL_OUTBOX_COLLECTION).doc(key);
}

function cleanupRecordKind(
  kind: CleanupChildKind
):
  | 'renew_receipt'
  | 'issuance_receipt'
  | 'capability'
  | 'transport_receipt'
  | 'ingest_outbox'
  | 'terminal_outbox' {
  return kind;
}

function isExactCleanupChild(
  kind: CleanupChildKind,
  key: string,
  history: ReturnType<typeof matrixCorpusLeaseHistoryV1Schema.parse>,
  value: unknown
): boolean {
  if (kind === 'renew_receipt') {
    const pair = matrixCorpusLeaseHistoryRenewReceiptPairV1Schema.safeParse({
      history,
      receipt: value,
    });
    return pair.success && pair.data.receipt.idempotencyKeyDigest === key;
  }
  if (kind === 'issuance_receipt') {
    const pair = matrixCorpusLeaseHistoryIssuanceReceiptPairV1Schema.safeParse({
      history,
      receipt: value,
    });
    return pair.success && pair.data.receipt.matrixIdempotencyKeyDigest === key;
  }
  if (kind === 'capability') {
    const parsed = matrixCorpusCapabilityV1Schema.safeParse(value);
    return (
      parsed.success &&
      parsed.data.capabilityDigest === key &&
      hasLeaseIdentity(history, parsed.data)
    );
  }
  if (kind === 'transport_receipt') {
    const parsed = matrixCorpusTransportReceiptV1Schema.safeParse(value);
    return (
      parsed.success &&
      parsed.data.transportMessageIdDigest === key &&
      hasLeaseIdentity(history, parsed.data)
    );
  }
  if (kind === 'ingest_outbox') {
    const parsed = matrixCorpusIngestOutboxRecordV1Schema.safeParse(value);
    return (
      parsed.success && parsed.data.ingestOutboxId === key && hasLeaseIdentity(history, parsed.data)
    );
  }
  const parsed = matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(value);
  return (
    parsed.success && parsed.data.terminalControlId === key && hasLeaseIdentity(history, parsed.data)
  );
}

function parseLifecycleResult<T>(schema: z.ZodType<T>, candidate: unknown): T {
  return schema.parse(candidate);
}

function parseReplayProjection<const T extends MatrixCorpusPersistedReplayProjectionV1>(
  candidate: T
): T {
  return matrixCorpusPersistedReplayProjectionV1Schema.parse(candidate) as T;
}

async function readDeliveryPair(
  transaction: FirestoreTransaction,
  slotRef: ReturnType<ReturnType<Firestore['collection']>['doc']>,
  _requestedHistoryRef: ReturnType<ReturnType<Firestore['collection']>['doc']>,
  leaseSlotDigest: string
): Promise<
  | Readonly<{
      kind: 'found';
      data: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>;
    }>
  | Readonly<{
      kind: 'missing';
      result:
        | Readonly<{ code: 'NOT_FOUND' }>
        | Readonly<{ code: 'CORRUPT_STATE'; recordKind: 'lease' | 'lease_history' }>;
    }>
> {
  const slot = await transaction.get(slotRef);
  if (!slot.exists) return { kind: 'missing', result: { code: 'NOT_FOUND' } };
  const current = matrixCorpusLeaseV1Schema.safeParse(slot.data());
  if (!current.success)
    return { kind: 'missing', result: { code: 'CORRUPT_STATE', recordKind: 'lease' } };
  const history = await transaction.get(
    slotRef.collection('runs').doc(current.data.runFenceDigest)
  );
  if (!history.exists)
    return { kind: 'missing', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
  const parsed = matrixCorpusCurrentLeaseHistoryPairV1Schema.safeParse({
    leaseSlotDigest,
    current: current.data,
    history: history.data(),
  });
  return parsed.success
    ? { kind: 'found', data: parsed.data }
    : { kind: 'missing', result: { code: 'CORRUPT_STATE', recordKind: 'lease_history' } };
}

function hasExactLeaseAuthority(
  lease: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>['current'],
  input: Readonly<{
    runtimeAudience: string;
    runId: string;
    userId: string;
    leaseFence: string;
    runFenceDigest: string;
  }>
): boolean {
  return (
    lease.runtimeAudience === input.runtimeAudience &&
    lease.runId === input.runId &&
    lease.userId === input.userId &&
    lease.leaseFence === input.leaseFence &&
    lease.runFenceDigest === input.runFenceDigest
  );
}

function hasCapabilityAuthority(
  lease: ReturnType<typeof matrixCorpusLeaseV1Schema.parse>,
  capability: ReturnType<typeof matrixCorpusCapabilityV1Schema.parse>
): boolean {
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
  lease: ReturnType<typeof matrixCorpusLeaseV1Schema.parse>,
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
  capability: ReturnType<typeof matrixCorpusCapabilityV1Schema.parse>,
  facts: ConsumeCapabilityAndEnqueueIngestCommand['facts']
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
    JSON.stringify(capability.mockProfile) === JSON.stringify(context.mockProfile) &&
    capability.mockProfileDigest === context.mockProfileDigest &&
    JSON.stringify(capability.expectedToolSchedule) ===
      JSON.stringify(context.expectedToolSchedule) &&
    capability.currentDateTime === context.currentDateTime &&
    capability.timeZone === context.timeZone &&
    ingress.promptDigest === capability.promptDigest &&
    ingress.expectedSessionId === capability.expectedSessionId &&
    ingress.pendingConfirmationId === capability.pendingConfirmationId &&
    ingress.expectedDecision === capability.expectedDecision
  );
}

function hasLeaseIdentity(
  lease: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>['history'],
  record: Readonly<{ runId: string; userId: string; leaseFence: string }>
): boolean {
  return (
    record.runId === lease.runId &&
    record.userId === lease.userId &&
    record.leaseFence === lease.leaseFence
  );
}

function parseIngestClaimResult(candidate: unknown): IngestClaimResult {
  return ingestClaimResultSchema.parse(candidate);
}

function parseClaimRenewResult(candidate: unknown): ClaimRenewResult {
  return claimRenewResultSchema.parse(candidate);
}

function parseAcknowledgeResult(candidate: unknown): AcknowledgeResult {
  return acknowledgeResultSchema.parse(candidate);
}

function parseTerminalClaimResult(candidate: unknown): TerminalClaimResult {
  return terminalClaimResultSchema.parse(candidate);
}

function parseTerminalAcknowledgementResult(
  candidate: unknown
): TerminalControlAcknowledgementResult {
  return terminalControlAcknowledgementResultSchema.parse(candidate);
}

function deeplyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasDrainedLeaseState(
  lease: ReturnType<typeof matrixCorpusCurrentLeaseHistoryPairV1Schema.parse>['current']
): boolean {
  return (
    lease.phase === 'quiescing' &&
    lease.unconsumedCapability === null &&
    lease.nonterminalIngestOutboxIds.length === 0 &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalIntexMarkerCount &&
    lease.drain.consumedCapabilityCount === lease.drain.terminalOutboxCount &&
    lease.drain.replyOrDeliveryWorkInFlight === 0
  );
}

function authorityRejected(): Error {
  return new Error(AUTHORITY_REJECTED);
}

function conflict(): Error {
  return new Error(CONFLICT);
}
