import type {
  AbandonExpiredRunCommand,
  AbandonPendingResult,
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
  MatrixSendProofResult,
  LeaseRenewResult,
  MatrixCorpusPersistedReplayProjectionV1,
  ProvisioningLeaseResult,
  QuiesceResult,
  QuiesceRunCommand,
  ReleaseResult,
  ReleaseRunCommand,
  RecordMatrixSendProofCommand,
  RenewIngestOutboxClaimInput,
  RenewLeaseCommand,
  RenewTerminalControlOutboxClaimInput,
  TerminalClaimResult,
  TerminalControlAcknowledgementResult,
  TransportStatusResult,
  AcquireProvisioningLeaseCommand,
} from '../types.js';

export interface MatrixCorpusReplayProjectionDigestPort {
  digest(projection: MatrixCorpusPersistedReplayProjectionV1): string;
}

export interface MatrixCorpusRepositoryDependencies {
  readonly replayProjectionDigest: MatrixCorpusReplayProjectionDigestPort;
}

export interface MatrixCorpusRepository {
  acquireProvisioningLease(
    input: AcquireProvisioningLeaseCommand
  ): Promise<ProvisioningLeaseResult>;
  activateRun(input: ActivateRunCommand): Promise<ActivationResult>;
  renewLease(input: RenewLeaseCommand): Promise<LeaseRenewResult>;
  issueCapability(input: IssueCapabilityCommand): Promise<CapabilityIssueResult>;
  recordMatrixSendProof(input: RecordMatrixSendProofCommand): Promise<MatrixSendProofResult>;
  consumeCapabilityAndEnqueueIngest(
    input: ConsumeCapabilityAndEnqueueIngestCommand
  ): Promise<CapabilityConsumeResult>;
  quiesceRun(input: QuiesceRunCommand): Promise<QuiesceResult>;
  releaseRun(input: ReleaseRunCommand): Promise<ReleaseResult>;
  abandonExpiredRun(input: AbandonExpiredRunCommand): Promise<AbandonPendingResult>;
  getTransportStatus(input: GetTransportStatusCommand): Promise<TransportStatusResult>;
  cleanupExactRun(input: CleanupExactRunCommand): Promise<CleanupResult>;

  claimPendingIngestOutbox(input: ClaimPendingIngestOutboxInput): Promise<IngestClaimResult>;
  renewIngestOutboxClaim(input: RenewIngestOutboxClaimInput): Promise<ClaimRenewResult>;
  acknowledgeIngestOutbox(input: AcknowledgeIngestOutboxInput): Promise<AcknowledgeResult>;
  claimPendingTerminalControlOutbox(
    input: ClaimPendingTerminalControlOutboxInput
  ): Promise<TerminalClaimResult>;
  renewTerminalControlOutboxClaim(
    input: RenewTerminalControlOutboxClaimInput
  ): Promise<ClaimRenewResult>;
  acknowledgeTerminalControl(
    input: AcknowledgeTerminalControlInput
  ): Promise<TerminalControlAcknowledgementResult>;
}
