export type MatrixCorpusIngestReceiptState =
  | 'reserved'
  | 'processing'
  | 'llm_in_flight'
  | 'completed'
  | 'failed';

export const MATRIX_CORPUS_IN_FLIGHT_RECOVERY_DEADLINE_MS = 15 * 60 * 1000;

export type MatrixCorpusIngestFailureCode =
  | 'MATRIX_CORPUS_NOT_READY'
  | 'MATRIX_CORPUS_PREPARATION_REJECTED'
  | 'MATRIX_CORPUS_EXECUTION_REJECTED'
  | 'AMBIGUOUS_EXTERNAL_EFFECT';

export interface MatrixCorpusIngestReceiptIdentity {
  ingestReceiptId: string;
  runId: string;
  scenarioId: string;
  turnIndex: number;
  leaseFence: string;
  payloadDigest: string;
}

export interface MatrixCorpusIngestStableKeys {
  sessionId: string;
  eventId: string;
  toolCallId: string;
  replyId: string;
}

export interface MatrixCorpusIngestReceipt
  extends MatrixCorpusIngestReceiptIdentity,
    MatrixCorpusIngestStableKeys {
  version: 1;
  state: MatrixCorpusIngestReceiptState;
  failureCode: MatrixCorpusIngestFailureCode | null;
  publication: MatrixCorpusTurnPublicationV1;
  createdAt: string;
  updatedAt: string;
}

export type MatrixCorpusReceiptFailure = Readonly<{
  ok: false;
  code:
    | 'NOT_FOUND'
    | 'CORRELATED_REPLAY_CONFLICT'
    | 'INVALID_STATE'
    | 'TERMINAL_CONFLICT'
    | 'CORRUPT_RECEIPT';
}>;

export type MatrixCorpusReceiptMutationResult =
  | Readonly<{
      ok: true;
      disposition: 'applied' | 'already_applied';
      receipt: MatrixCorpusIngestReceipt;
    }>
  | MatrixCorpusReceiptFailure;

export type MatrixCorpusReceiptRecoveryResult =
  | Readonly<{
      ok: true;
      disposition:
        | 'resume_processing'
        | 'completed_recovered'
        | 'failed_ambiguous'
        | 'terminal';
      receipt: MatrixCorpusIngestReceipt;
    }>
  | MatrixCorpusReceiptFailure;

export interface IngestReceiptRepository {
  reserveAndStartProcessing(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    stableKeys: MatrixCorpusIngestStableKeys;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  markLlmInFlight(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  beginReplyCompletion(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    expectedReplyDigests: readonly string[];
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  reserveReplyPublication(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    replyIndex: number;
    replyDigest: string;
    idempotencyKeyDigest: string;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  acceptReplyPublication(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    replyIndex: number;
    replyDigest: string;
    idempotencyKeyDigest: string;
    publicationReceiptDigest: string;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  recoverAfterInterruption(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    now: string;
    reason: 'execution_failed' | 'redelivery';
  }>): Promise<MatrixCorpusReceiptRecoveryResult>;

  fail(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    failureCode: MatrixCorpusIngestFailureCode;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;

  complete(input: Readonly<{
    identity: MatrixCorpusIngestReceiptIdentity;
    now: string;
  }>): Promise<MatrixCorpusReceiptMutationResult>;
}
import type { MatrixCorpusTurnPublicationV1 } from '../correlation.js';
