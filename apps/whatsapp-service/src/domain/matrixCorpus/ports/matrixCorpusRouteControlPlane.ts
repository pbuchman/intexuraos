import type { MatrixCorpusCapabilityIssueRequestV1 } from '@intexuraos/http-contracts';

import type {
  AbandonPendingResult,
  AcquireProvisioningLeaseInput,
  ActivationResult,
  CapabilityIssueResult,
  CleanupResult,
  LeaseRenewResult,
  ProvisioningLeaseResult,
  QuiesceResult,
  ReleaseResult,
  TransportStatusResult,
  MatrixSendProofResult,
} from '../types.js';

export interface MatrixCorpusBoundLeaseAuthority {
  readonly runtimeAudience: 'home-dev';
  readonly runId: string;
  readonly userId: string;
  readonly leaseFence: string;
  readonly matrixRoomBindingDigest: string;
  readonly whatsappAccountBindingDigest: string;
  readonly whatsappSenderBindingDigest: string;
}

export interface MatrixCorpusBoundOperationInput extends MatrixCorpusBoundLeaseAuthority {
  readonly idempotencyKey: string;
}

export interface MatrixCorpusBoundCleanupInput extends MatrixCorpusBoundLeaseAuthority {
  readonly targetRunId: string;
  readonly targetLeaseFence: string;
  readonly targetRunFenceDigest: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

export interface MatrixCorpusBoundSendProofInput extends MatrixCorpusBoundLeaseAuthority {
  readonly idempotencyKey: string;
  readonly rawCapability: string;
  readonly scenarioId: string;
  readonly scenarioNumber: number;
  readonly phase: 'start' | 'turn' | 'confirmation';
  readonly turnIndex: number;
  readonly matrixEventId: string;
  readonly matrixRoomId: string;
  readonly messageText: string;
}

export type MatrixCorpusLeaseBindingAuthorizationResult =
  | Readonly<{ code: 'AUTHORIZED' }>
  | Readonly<{ code: 'NOT_FOUND' }>
  | Readonly<{ code: 'STALE_FENCE' }>
  | Readonly<{ code: 'CORRUPT_STATE'; recordKind: 'lease' | 'lease_history' }>;

export interface MatrixCorpusLeaseBindingAuthorizationPort {
  authorizeCurrentLeaseBinding(
    input: MatrixCorpusBoundLeaseAuthority
  ): Promise<MatrixCorpusLeaseBindingAuthorizationResult>;
}

export interface MatrixCorpusBoundCleanupPort {
  cleanupExactRun(input: MatrixCorpusBoundCleanupInput): Promise<CleanupResult>;
}

export interface MatrixCorpusRouteControlPlane {
  acquireProvisioningLease(
    input: AcquireProvisioningLeaseInput
  ): Promise<ProvisioningLeaseResult>;
  activateRun(input: MatrixCorpusBoundOperationInput): Promise<ActivationResult>;
  renewLease(input: MatrixCorpusBoundOperationInput): Promise<LeaseRenewResult>;
  issueCapability(
    input: MatrixCorpusCapabilityIssueRequestV1
  ): Promise<CapabilityIssueResult>;
  recordMatrixSendProof(input: MatrixCorpusBoundSendProofInput): Promise<MatrixSendProofResult>;
  getTransportStatus(
    input: MatrixCorpusBoundLeaseAuthority
  ): Promise<TransportStatusResult>;
  quiesceRun(input: MatrixCorpusBoundOperationInput): Promise<QuiesceResult>;
  releaseRun(input: MatrixCorpusBoundOperationInput): Promise<ReleaseResult>;
  abortProvisioningRun(input: MatrixCorpusBoundOperationInput): Promise<AbandonPendingResult>;
  cleanupExactRun(input: MatrixCorpusBoundCleanupInput): Promise<CleanupResult>;
}
