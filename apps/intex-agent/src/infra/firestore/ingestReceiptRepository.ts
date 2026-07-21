import type { Firestore } from '@intexuraos/infra-firestore';

import {
  acceptReplyPublication,
  beginTurnCompletion,
  closeTurnCompleted,
  closeTurnFailed,
  createOpenTurnPublication,
  isValidTurnPublication,
  recoverInterruptedTurn,
  reserveReplyPublication,
} from '../../domain/matrixCorpus/correlation.js';
import type {
  IngestReceiptRepository,
  MatrixCorpusIngestFailureCode,
  MatrixCorpusIngestReceipt,
  MatrixCorpusIngestReceiptIdentity,
  MatrixCorpusReceiptFailure,
  MatrixCorpusReceiptMutationResult,
  MatrixCorpusReceiptRecoveryResult,
} from '../../domain/matrixCorpus/ports/ingestReceiptRepository.js';
import { MATRIX_CORPUS_IN_FLIGHT_RECOVERY_DEADLINE_MS } from '../../domain/matrixCorpus/ports/ingestReceiptRepository.js';

export const INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION =
  'intex_agent_matrix_corpus_ingest_receipts';

const receiptKeys = [
  'createdAt',
  'eventId',
  'failureCode',
  'ingestReceiptId',
  'leaseFence',
  'payloadDigest',
  'publication',
  'replyId',
  'runId',
  'scenarioId',
  'sessionId',
  'state',
  'toolCallId',
  'turnIndex',
  'updatedAt',
  'version',
] as const;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/;
const digestPattern = /^[0-9a-f]{64}$/;
type FirestoreDocumentReference = ReturnType<ReturnType<Firestore['collection']>['doc']>;
const fencePattern = /^[1-9][0-9]{0,19}$/;
const states = new Set(['reserved', 'processing', 'llm_in_flight', 'completed', 'failed']);
const failureCodes = new Set([
  'MATRIX_CORPUS_NOT_READY',
  'MATRIX_CORPUS_PREPARATION_REJECTED',
  'MATRIX_CORPUS_EXECUTION_REJECTED',
  'AMBIGUOUS_EXTERNAL_EFFECT',
]);

export interface FirestoreIngestReceiptRepositoryDeps {
  firestore: Firestore;
}

export class FirestoreIngestReceiptRepository implements IngestReceiptRepository {
  private readonly firestore: Firestore;

  constructor(deps: FirestoreIngestReceiptRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async reserveAndStartProcessing(
    input: Parameters<IngestReceiptRepository['reserveAndStartProcessing']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    const ref = this.receiptRef(input.identity.ingestReceiptId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = toReceipt(snapshot.data());
        if (existing === undefined) return corruptReceipt();
        if (!sameIdentity(existing, input.identity)) return correlatedReplayConflict();
        return success('already_applied', existing);
      }

      const receipt: MatrixCorpusIngestReceipt = {
        version: 1,
        ...input.identity,
        ...input.stableKeys,
        state: 'processing',
        failureCode: null,
        publication: createOpenTurnPublication(),
        createdAt: input.now,
        updatedAt: input.now,
      };
      transaction.set(ref, receipt);
      return success('applied', receipt);
    });
  }

  async markLlmInFlight(
    input: Parameters<IngestReceiptRepository['markLlmInFlight']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutateExisting<MatrixCorpusReceiptMutationResult>(input.identity, (receipt) => {
      if (receipt.state === 'llm_in_flight') return success('already_applied', receipt);
      if (receipt.state !== 'processing') return invalidState();
      return {
        result: success('applied', { ...receipt, state: 'llm_in_flight', updatedAt: input.now }),
        write: { ...receipt, state: 'llm_in_flight', updatedAt: input.now },
      };
    });
  }

  async recoverAfterInterruption(
    input: Parameters<IngestReceiptRepository['recoverAfterInterruption']>[0]
  ): Promise<MatrixCorpusReceiptRecoveryResult> {
    return await this.mutateExisting<MatrixCorpusReceiptRecoveryResult>(input.identity, (receipt) => {
      if (receipt.state === 'processing' || receipt.state === 'reserved')
        return { ok: true, disposition: 'resume_processing', receipt: cloneReceipt(receipt) };
      if (receipt.state === 'completed' || receipt.state === 'failed')
        return { ok: true, disposition: 'terminal', receipt: cloneReceipt(receipt) };

      const recovered = recoverInterruptedTurn(receipt.publication, { now: input.now });
      if (!recovered.ok) return invalidState();
      const completed = recovered.publication.terminal?.kind === 'completed';
      if (
        !completed &&
        input.reason === 'redelivery' &&
        !isPastInFlightRecoveryDeadline(receipt.updatedAt, input.now)
      )
        return invalidState();
      const next: MatrixCorpusIngestReceipt = {
        ...receipt,
        state: completed ? 'completed' : 'failed',
        failureCode: completed ? null : 'AMBIGUOUS_EXTERNAL_EFFECT',
        publication: recovered.publication,
        updatedAt: input.now,
      };
      return {
        result: {
          ok: true,
          disposition: completed ? 'completed_recovered' : 'failed_ambiguous',
          receipt: cloneReceipt(next),
        },
        write: next,
      };
    });
  }

  async beginReplyCompletion(
    input: Parameters<IngestReceiptRepository['beginReplyCompletion']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutatePublication(input.identity, input.now, (receipt) =>
      beginTurnCompletion(receipt.publication, {
        expectedReplyDigests: input.expectedReplyDigests,
        now: input.now,
      })
    );
  }

  async reserveReplyPublication(
    input: Parameters<IngestReceiptRepository['reserveReplyPublication']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutatePublication(input.identity, input.now, (receipt) =>
      reserveReplyPublication(receipt.publication, input)
    );
  }

  async acceptReplyPublication(
    input: Parameters<IngestReceiptRepository['acceptReplyPublication']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutatePublication(input.identity, input.now, (receipt) =>
      acceptReplyPublication(receipt.publication, input)
    );
  }

  async fail(
    input: Parameters<IngestReceiptRepository['fail']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutateExisting<MatrixCorpusReceiptMutationResult>(input.identity, (receipt) => {
      if (receipt.state === 'completed') return terminalConflict();
      if (receipt.state === 'failed')
        return receipt.failureCode === input.failureCode
          ? success('already_applied', receipt)
          : terminalConflict();

      const failed: MatrixCorpusIngestReceipt = {
        ...receipt,
        state: 'failed',
        failureCode: input.failureCode,
        publication: failedPublication(receipt, input.failureCode, input.now),
        updatedAt: input.now,
      };
      return { result: success('applied', failed), write: failed };
    });
  }

  async complete(
    input: Parameters<IngestReceiptRepository['complete']>[0]
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutateExisting<MatrixCorpusReceiptMutationResult>(input.identity, (receipt) => {
      if (receipt.state === 'completed') return success('already_applied', receipt);
      if (receipt.state === 'failed') return terminalConflict();
      if (receipt.state !== 'llm_in_flight') return invalidState();
      const publication = closeTurnCompleted(receipt.publication, { now: input.now });
      if (!publication.ok) return invalidState();

      const completed: MatrixCorpusIngestReceipt = {
        ...receipt,
        state: 'completed',
        failureCode: null,
        publication: publication.publication,
        updatedAt: input.now,
      };
      return { result: success('applied', completed), write: completed };
    });
  }

  private async mutateExisting<Result extends MatrixCorpusReceiptMutationResult | MatrixCorpusReceiptRecoveryResult>(
    identity: MatrixCorpusIngestReceiptIdentity,
    decide: (
      receipt: MatrixCorpusIngestReceipt
    ) => Result | Readonly<{ result: Result; write: MatrixCorpusIngestReceipt }>
  ): Promise<Result> {
    const ref = this.receiptRef(identity.ingestReceiptId);
    return await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return notFound() as Result;
      const existing = toReceipt(snapshot.data());
      if (existing === undefined) return corruptReceipt() as Result;
      if (!sameIdentity(existing, identity)) return correlatedReplayConflict() as Result;

      const decision = decide(existing);
      if (isWriteDecision(decision)) {
        transaction.set(ref, decision.write);
        return cloneResult(decision.result);
      }
      return cloneResult(decision);
    });
  }

  private async mutatePublication(
    identity: MatrixCorpusIngestReceiptIdentity,
    now: string,
    decide: (
      receipt: MatrixCorpusIngestReceipt
    ) => ReturnType<typeof beginTurnCompletion>
  ): Promise<MatrixCorpusReceiptMutationResult> {
    return await this.mutateExisting<MatrixCorpusReceiptMutationResult>(identity, (receipt) => {
      if (receipt.state !== 'llm_in_flight') return invalidState();
      const transitioned = decide(receipt);
      if (!transitioned.ok) return invalidState();
      const updated: MatrixCorpusIngestReceipt = {
        ...receipt,
        publication: transitioned.publication,
        updatedAt: transitioned.disposition === 'applied' ? now : receipt.updatedAt,
      };
      return transitioned.disposition === 'already_applied'
        ? success('already_applied', receipt)
        : { result: success('applied', updated), write: updated };
    });
  }

  private receiptRef(ingestReceiptId: string): FirestoreDocumentReference {
    return this.firestore
      .collection(INTEX_AGENT_MATRIX_CORPUS_INGEST_RECEIPTS_COLLECTION)
      .doc(ingestReceiptId);
  }
}

function isPastInFlightRecoveryDeadline(updatedAt: string, now: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  const nowMs = Date.parse(now);
  return (
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - updatedAtMs >= MATRIX_CORPUS_IN_FLIGHT_RECOVERY_DEADLINE_MS
  );
}

function isWriteDecision<Result>(
  value: Result | Readonly<{ result: Result; write: MatrixCorpusIngestReceipt }>
): value is Readonly<{ result: Result; write: MatrixCorpusIngestReceipt }> {
  return typeof value === 'object' && value !== null && 'result' in value && 'write' in value;
}

function sameIdentity(
  receipt: MatrixCorpusIngestReceipt,
  identity: MatrixCorpusIngestReceiptIdentity
): boolean {
  return (
    receipt.ingestReceiptId === identity.ingestReceiptId &&
    receipt.runId === identity.runId &&
    receipt.scenarioId === identity.scenarioId &&
    receipt.turnIndex === identity.turnIndex &&
    receipt.leaseFence === identity.leaseFence &&
    receipt.payloadDigest === identity.payloadDigest
  );
}

function success(
  disposition: 'applied' | 'already_applied',
  receipt: MatrixCorpusIngestReceipt
): MatrixCorpusReceiptMutationResult {
  return { ok: true, disposition, receipt: cloneReceipt(receipt) };
}

function notFound(): MatrixCorpusReceiptFailure {
  return { ok: false, code: 'NOT_FOUND' };
}

function correlatedReplayConflict(): MatrixCorpusReceiptFailure {
  return { ok: false, code: 'CORRELATED_REPLAY_CONFLICT' };
}

function invalidState(): MatrixCorpusReceiptFailure {
  return { ok: false, code: 'INVALID_STATE' };
}

function terminalConflict(): MatrixCorpusReceiptFailure {
  return { ok: false, code: 'TERMINAL_CONFLICT' };
}

function corruptReceipt(): MatrixCorpusReceiptFailure {
  return { ok: false, code: 'CORRUPT_RECEIPT' };
}

function cloneReceipt(receipt: MatrixCorpusIngestReceipt): MatrixCorpusIngestReceipt {
  return { ...receipt, publication: structuredClone(receipt.publication) };
}

function cloneResult<Result extends MatrixCorpusReceiptMutationResult | MatrixCorpusReceiptRecoveryResult>(
  result: Result
): Result {
  if (!result.ok) return { ...result };
  return { ...result, receipt: cloneReceipt(result.receipt) };
}

function toReceipt(data: unknown): MatrixCorpusIngestReceipt | undefined {
  /* v8 ignore start -- upstream: Firestore DocumentSnapshot.data cannot return null, an array, or a primitive for an existing document @preserve */
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  /* v8 ignore stop @preserve */
  const keys = Object.keys(data).sort();
  if (keys.length !== receiptKeys.length || receiptKeys.some((key, index) => key !== keys[index]))
    return undefined;
  const record = data as Record<string, unknown>;
  if (
    record['version'] !== 1 ||
    !isSafeId(record['ingestReceiptId']) ||
    !isSafeId(record['runId']) ||
    !isSafeId(record['scenarioId']) ||
    typeof record['turnIndex'] !== 'number' ||
    !Number.isInteger(record['turnIndex']) ||
    record['turnIndex'] < 0 ||
    record['turnIndex'] > 19 ||
    typeof record['leaseFence'] !== 'string' ||
    !fencePattern.test(record['leaseFence']) ||
    typeof record['payloadDigest'] !== 'string' ||
    !digestPattern.test(record['payloadDigest']) ||
    !isSafeId(record['sessionId']) ||
    !isSafeId(record['eventId']) ||
    !isSafeId(record['toolCallId']) ||
    !isSafeId(record['replyId']) ||
    !isValidTurnPublication(record['publication']) ||
    typeof record['state'] !== 'string' ||
    !states.has(record['state']) ||
    !hasValidStateFailurePair(record['state'], record['failureCode']) ||
    typeof record['createdAt'] !== 'string' ||
    typeof record['updatedAt'] !== 'string'
  )
    return undefined;

  return record as unknown as MatrixCorpusIngestReceipt;
}

function failedPublication(
  receipt: MatrixCorpusIngestReceipt,
  failureCode: MatrixCorpusIngestFailureCode,
  now: string
): MatrixCorpusIngestReceipt['publication'] {
  const code =
    failureCode === 'AMBIGUOUS_EXTERNAL_EFFECT'
      ? 'AMBIGUOUS_EXTERNAL_EFFECT'
      : failureCode === 'MATRIX_CORPUS_EXECUTION_REJECTED'
        ? 'EXECUTION_REJECTED'
        : 'REPLY_PUBLICATION_REJECTED';
  const failed = closeTurnFailed(receipt.publication, { code, now });
  return failed.ok ? failed.publication : receipt.publication;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && safeIdPattern.test(value);
}

function hasValidStateFailurePair(state: unknown, failureCode: unknown): boolean {
  if (state === 'failed')
    return typeof failureCode === 'string' && failureCodes.has(failureCode);
  return failureCode === null;
}
