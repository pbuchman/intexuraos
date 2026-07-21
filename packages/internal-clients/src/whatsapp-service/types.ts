import type { Result } from '@intexuraos/common-core';
import type {
  MatrixCorpusExpectedToolScheduleV1,
  MatrixCorpusSignedControlMutationV1,
  StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';

export interface WhatsAppServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type PrivateMatrixDeliveryStatus =
  | { status: 'ready'; deliverable: true }
  | { status: 'setup_required'; deliverable: false; reason: string }
  | { status: 'error'; deliverable: false; message: string };

export interface SendPrivateOutboundMatrixMessageRequest {
  userId: string;
  text: string;
  startNewSession?: boolean;
  idempotencyKey?: string;
}

export type SendPrivateOutboundMatrixMessageResult =
  | { status: 'sent'; matrixEventId: string }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export interface WhatsAppServiceClient {
  getMatrixCorpusReadiness(): Promise<
    MatrixCorpusClientResult<{
      readonly status: 'ready';
    }>
  >;
  getPrivateMatrixDeliveryStatus(userId: string): Promise<Result<PrivateMatrixDeliveryStatus>>;

  sendPrivateOutboundMatrixMessage(
    request: SendPrivateOutboundMatrixMessageRequest
  ): Promise<Result<SendPrivateOutboundMatrixMessageResult>>;

  provisionMatrixCorpusRun(
    input: MatrixCorpusProvisionInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusProvisionResult>>;
  activateMatrixCorpusRun(
    input: MatrixCorpusLeaseOperationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusActivateResult>>;
  renewMatrixCorpusLease(
    input: MatrixCorpusLeaseOperationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusRenewResult>>;
  issueMatrixCorpusCapability(
    input: MatrixCorpusCapabilityInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusCapabilityResult>>;
  recordMatrixCorpusSendProof(
    input: MatrixCorpusSendProofInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusSendProofResult>>;
  authorizeMatrixCorpusControl(
    input: MatrixCorpusControlAuthorizationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusControlAuthorizationResult>>;
  getMatrixCorpusTransportStatus(
    input: MatrixCorpusTransportStatusInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusTransportStatusResult>>;
  quiesceMatrixCorpusRun(
    input: MatrixCorpusLeaseOperationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusQuiesceResult>>;
  releaseMatrixCorpusRun(
    input: MatrixCorpusLeaseOperationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusReleaseResult>>;
  abortProvisioningMatrixCorpusRun(
    input: MatrixCorpusLeaseOperationInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusAbortResult>>;
  cleanupMatrixCorpusRun(
    input: MatrixCorpusCleanupInput
  ): Promise<MatrixCorpusClientResult<MatrixCorpusCleanupResult>>;
}

export type MatrixCorpusClientFailureCode =
  | 'invalid_request'
  | 'timeout'
  | 'unavailable'
  | 'rejected'
  | 'invalid_response';

export type MatrixCorpusClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: MatrixCorpusClientFailureCode;
        readonly httpStatus?: number;
      };
    };

export interface MatrixCorpusProvisionInput {
  readonly runId: string;
  readonly idempotencyKey: string;
}

export interface MatrixCorpusLeaseOperationInput extends MatrixCorpusProvisionInput {
  readonly leaseFence: string;
}

export interface MatrixCorpusCapabilityInput extends MatrixCorpusLeaseOperationInput {
  readonly capability: string;
  readonly scenarioId: string;
  readonly scenarioNumber: number;
  readonly scenarioLabel: string;
  readonly promptNormalizationVersion: 1;
  readonly promptDigest: string;
  readonly phase: 'start' | 'turn' | 'confirmation';
  readonly turnIndex: number;
  readonly expectedSessionId: string | null;
  readonly pendingConfirmationId: string | null;
  readonly expectedDecision: 'confirm' | 'reject' | null;
  readonly mockProfile: StrictToolMockProfileV1;
  readonly mockProfileDigest: string;
  readonly expectedToolSchedule: MatrixCorpusExpectedToolScheduleV1;
  readonly currentDateTime: string;
  readonly timeZone: string;
}

export interface MatrixCorpusControlAuthorizationInput {
  readonly runId: string;
  readonly leaseFence: string;
  readonly operation:
    | 'register_context'
    | 'finalize_run'
    | 'create_projection'
    | 'advance_projection';
  readonly request: Readonly<Record<string, unknown>>;
}

export interface MatrixCorpusSendProofInput extends MatrixCorpusLeaseOperationInput {
  readonly capability: string;
  readonly scenarioId: string;
  readonly scenarioNumber: number;
  readonly phase: 'start' | 'turn' | 'confirmation';
  readonly turnIndex: number;
  readonly matrixEventId: string;
  readonly matrixRoomId: string;
  readonly messageText: string;
}

export interface MatrixCorpusTransportStatusInput {
  readonly runId: string;
  readonly leaseFence: string;
  readonly scenarioId?: string;
  readonly turnIndex?: number;
}

export interface MatrixCorpusCleanupInput extends MatrixCorpusLeaseOperationInput {
  readonly targetRunId: string;
  readonly targetLeaseFence: string;
  readonly targetRunFenceDigest: string;
  readonly expectedRevision: number;
}

export interface MatrixCorpusProvisionResult {
  readonly code: 'ACQUIRED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly phase: 'provisioning';
  readonly leaseFence: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface MatrixCorpusActivateResult {
  readonly code: 'ACTIVATED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase: 'active';
  readonly activatedAt: string;
}

export interface MatrixCorpusRenewResult {
  readonly code: 'LEASE_RENEWED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase: 'active';
  readonly renewedAt: string;
  readonly expiresAt: string;
}

export interface MatrixCorpusCapabilityResult {
  readonly code: 'CAPABILITY_ISSUED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly scenarioId: string;
  readonly phase: 'start' | 'turn' | 'confirmation';
  readonly turnIndex: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface MatrixCorpusSendProofResult {
  readonly code: 'MATRIX_SEND_PROOF_RECORDED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly scenarioId: string;
  readonly phase: 'start' | 'turn' | 'confirmation';
  readonly turnIndex: number;
  readonly recordedAt: string;
}

export interface MatrixCorpusControlAuthorizationResult {
  readonly code: 'AUTHORIZED';
  readonly authorization: MatrixCorpusSignedControlMutationV1;
}

export interface MatrixCorpusTransportStatusResult {
  readonly code: 'TRANSPORT_STATUS';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase:
    | 'provisioning'
    | 'active'
    | 'quiescing'
    | 'release_pending'
    | 'abandon_pending'
    | 'released'
    | 'abandoned';
  readonly consumedCapabilityCount: number;
  readonly terminalIntexMarkerCount: number;
  readonly terminalOutboxCount: number;
  readonly replyOrDeliveryWorkInFlight: number;
  readonly nonterminalIngestOutboxCount: number;
  readonly drained: boolean;
}

export interface MatrixCorpusQuiesceResult {
  readonly code: 'QUIESCED' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase: 'quiescing';
  readonly quiescedAt: string;
  readonly drained: boolean;
}

export interface MatrixCorpusReleaseResult {
  readonly code: 'RELEASE_PENDING' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase: 'release_pending';
  readonly createdAt: string;
}

export interface MatrixCorpusAbortResult {
  readonly code: 'ABANDON_PENDING' | 'ALREADY_APPLIED';
  readonly runId: string;
  readonly leaseFence: string;
  readonly phase: 'abandon_pending';
  readonly reconciledAt: string;
}

export type MatrixCorpusCleanupResult =
  | {
      readonly code: 'RUN_CLEANUP_PROGRESS' | 'ALREADY_APPLIED';
      readonly targetRunId: string;
      readonly targetLeaseFence: string;
      readonly targetRunFenceDigest: string;
      readonly state: 'progress';
      readonly committedRevision: number;
      readonly remainingChildCount: number;
      readonly chunkCommittedAt: string;
    }
  | {
      readonly code: 'RUN_CLEANED' | 'ALREADY_APPLIED';
      readonly targetRunId: string;
      readonly targetLeaseFence: string;
      readonly targetRunFenceDigest: string;
      readonly state: 'cleaned';
      readonly finalRevision: number;
      readonly cleanedAt: string;
    };
