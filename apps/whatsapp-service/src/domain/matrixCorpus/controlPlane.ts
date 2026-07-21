/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime correlation checks defend parsed repository boundaries. */
import {
  canonicalMatrixCorpusCapabilityIssueDigestInputV1,
  canonicalMatrixCorpusIngressRequestV1,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusTerminalControlV1,
  matrixCorpusCapabilityIssueRequestV1Schema,
  matrixCorpusKeyedDigestSchema,
  matrixCorpusRfc3339TimestampSchema,
  matrixCorpusSha256DigestSchema,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusCanonicalIngressDigestInputV1,
  type MatrixCorpusCapabilityConsumeFactsV1,
  type MatrixCorpusCapabilityIssueDigestInputV1,
  type MatrixCorpusCapabilityV1,
  type MatrixCorpusTerminalControlV1,
} from '@intexuraos/http-contracts';

import {
  activateRunInputSchema,
  abandonExpiredRunInputSchema,
  abandonPendingResultSchema,
  activationResultSchema,
  acquireProvisioningLeaseInputSchema,
  capabilityIssueResultSchema,
  capabilityConsumeResultSchema,
  consumeCapabilityAndEnqueueIngestInputSchema,
  getTransportStatusCommandSchema,
  getTransportStatusInputSchema,
  matrixSendProofResultSchema,
  matrixCorpusCapabilityTtlMsSchema,
  matrixCorpusLeaseTtlMsSchema,
  provisioningLeaseResultSchema,
  releaseResultSchema,
  releaseRunInputSchema,
  recordMatrixSendProofInputSchema,
  renewLeaseInputSchema,
  leaseRenewResultSchema,
  type AcquireProvisioningLeaseCommand,
  type AcquireProvisioningLeaseInput,
  type AbandonExpiredRunCommand,
  type AbandonExpiredRunInput,
  type AbandonPendingResult,
  type ActivateRunCommand,
  type ActivateRunInput,
  type ActivationResult,
  type CapabilityIssueResult,
  type CapabilityConsumeResult,
  type ConsumeCapabilityAndEnqueueIngestCommand,
  type ConsumeCapabilityAndEnqueueIngestInput,
  type GetTransportStatusCommand,
  type GetTransportStatusInput,
  type IssueCapabilityCommand,
  type MatrixSendProofResult,
  type MatrixCorpusCapabilityIssueRequestV1,
  type MatrixCorpusControlDependencies,
  type MatrixCorpusControlStatusResult,
  type MatrixCorpusCurrentAcceptanceResult,
  type MatrixCorpusDigestDomain,
  type LeaseRenewResult,
  type ProvisioningLeaseResult,
  type ReleaseResult,
  type ReleaseRunCommand,
  type ReleaseRunInput,
  type RecordMatrixSendProofInput,
  type RecordMatrixSendProofCommand,
  quiesceResultSchema,
  quiesceRunCommandSchema,
  quiesceRunInputSchema,
  type RenewLeaseCommand,
  type RenewLeaseInput,
  type QuiesceResult,
  type QuiesceRunCommand,
  type QuiesceRunInput,
  transportStatusResultSchema,
  type TransportStatusResult,
} from './types.js';
import {
  matrixCorpusControlStatusResultSchema,
  matrixCorpusCurrentAcceptanceResultSchema,
} from './ports/intexAgentMatrixCorpusClient.js';
import {
  digestMatrixCorpusPromptV1,
  parseMatrixCorpusVisibleMessage,
} from './visibleHeader.js';

const notReadyAcceptance = { kind: 'not_ready' } as const;
const notReadyControlStatus = { kind: 'not_ready' } as const;

function corruptState(recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'): ProvisioningLeaseResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptActivationState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): ActivationResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptRenewState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): LeaseRenewResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptIssueState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): CapabilityIssueResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptMatrixSendProofState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): MatrixSendProofResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptConsumeState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): CapabilityConsumeResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptQuiesceState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): QuiesceResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

type ReleaseFacadeResult =
  | ReleaseResult
  | Readonly<{
      code: 'CORRUPT_STATE';
      recordKind: 'input_contract' | 'command' | 'repository_result';
    }>;

function corruptReleaseState(
  recordKind: 'input_contract' | 'command' | 'repository_result'
): ReleaseFacadeResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptAbandonState(
  recordKind: 'input_contract' | 'command' | 'repository_result'
): AbandonPendingResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function corruptTransportStatusState(
  recordKind: 'input_contract' | 'command' | 'dependency_result' | 'repository_result'
): TransportStatusResult {
  return { code: 'CORRUPT_STATE', recordKind };
}

function staticLog(
  dependencies: MatrixCorpusControlDependencies,
  operation:
    | 'acquire'
    | 'activate'
    | 'renew'
    | 'issue'
    | 'record_matrix_send_proof'
    | 'consume'
    | 'quiesce'
    | 'release'
    | 'abandon'
    | 'status',
  code: 'CORRUPT_STATE' | 'NOT_READY'
): void {
  try {
    dependencies.logger.error({ operation, code });
  } catch {
    // Logging is best-effort and must never change a closed control-plane result.
  }
}

function deriveDigest(
  dependencies: MatrixCorpusControlDependencies,
  domain: MatrixCorpusDigestDomain,
  parts: readonly string[]
): string | null {
  try {
    const parsed = matrixCorpusKeyedDigestSchema.safeParse(dependencies.digests.digest(domain, parts));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function visibleTurnMatchesProof(
  visible: Extract<
    ReturnType<typeof parseMatrixCorpusVisibleMessage>,
    Readonly<{ kind: 'matrix_corpus' }>
  >,
  turnIndex: number
): boolean {
  if (visible.phase === 'start') return turnIndex === 0;
  if (visible.phase === 'turn') return visible.turnIndex === turnIndex + 1;
  return visible.turnIndex === null;
}

function deriveStableIngestIds(
  transportMessageIdDigest: string
): Readonly<{ ingestReceiptId: string; ingestOutboxId: string }> {
  return {
    ingestReceiptId: `imc_ingest_receipt_v1_${transportMessageIdDigest}`,
    ingestOutboxId: `imc_ingest_outbox_v1_${transportMessageIdDigest}`,
  };
}

function addMilliseconds(now: string, ttlMs: number): string | null {
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
  const parsed = matrixCorpusRfc3339TimestampSchema.safeParse(expiresAt);
  return parsed.success ? parsed.data : null;
}

function isProvisioningLeaseProjectionCorrelated(
  result: ProvisioningLeaseResult,
  command: AcquireProvisioningLeaseCommand
): boolean {
  if (result.code === 'ACQUIRED')
    return (
      result.runId === command.runId &&
      result.acquiredAt === command.now &&
      result.expiresAt === command.expiresAt
    );
  if (result.code === 'ALREADY_APPLIED') return result.runId === command.runId;
  return true;
}

function isActivationProjectionCorrelated(
  result: ActivationResult,
  command: ActivateRunCommand
): boolean {
  if (result.code === 'ACTIVATED')
    return (
      result.runId === command.runId &&
      result.leaseFence === command.leaseFence &&
      result.activatedAt === command.now
    );
  if (result.code === 'ALREADY_APPLIED')
    return result.runId === command.runId && result.leaseFence === command.leaseFence;
  return true;
}

function isLeaseRenewProjectionCorrelated(
  result: LeaseRenewResult,
  command: RenewLeaseCommand
): boolean {
  if (result.code === 'LEASE_RENEWED')
    return (
      result.runId === command.runId &&
      result.leaseFence === command.leaseFence &&
      result.renewedAt === command.now &&
      result.expiresAt === command.expiresAt
    );
  if (result.code === 'ALREADY_APPLIED')
    return result.runId === command.runId && result.leaseFence === command.leaseFence;
  return true;
}

function isCapabilityIssueProjectionCorrelated(
  result: CapabilityIssueResult,
  command: IssueCapabilityCommand
): boolean {
  if (result.code !== 'CAPABILITY_ISSUED' && result.code !== 'ALREADY_APPLIED') return true;
  const identityCorrelated =
    result.runId === command.capability.runId &&
    result.scenarioId === command.capability.scenarioId &&
    result.phase === command.capability.phase &&
    result.turnIndex === command.capability.turnIndex;
  if (result.code === 'ALREADY_APPLIED') return identityCorrelated;
  return (
    identityCorrelated &&
    result.issuedAt === command.capability.issuedAt &&
    result.expiresAt === command.capability.expiresAt
  );
}

function isCapabilityConsumeProjectionCorrelated(
  result: CapabilityConsumeResult,
  command: ConsumeCapabilityAndEnqueueIngestCommand
): boolean {
  if (result.code !== 'INGEST_ENQUEUED' && result.code !== 'ALREADY_APPLIED') return true;
  const context = command.facts.payload.context;
  const identityCorrelated =
    result.runId === context.runId &&
    result.scenarioId === context.scenarioId &&
    result.phase === context.phase &&
    result.turnIndex === context.turnIndex;
  if (result.code === 'ALREADY_APPLIED') return identityCorrelated;
  return (
    identityCorrelated &&
    result.ingestReceiptId === command.ingestReceiptId &&
    result.ingestOutboxId === command.ingestOutboxId &&
    result.acceptedAt === command.now
  );
}

function isQuiesceProjectionCorrelated(result: QuiesceResult, command: QuiesceRunCommand): boolean {
  if (result.code === 'QUIESCED')
    return (
      result.runId === command.runId &&
      result.leaseFence === command.leaseFence &&
      result.phase === 'quiescing' &&
      result.quiescedAt === command.now
    );
  if (result.code === 'ALREADY_APPLIED')
    return result.runId === command.runId && result.leaseFence === command.leaseFence;
  return true;
}

function isReleaseProjectionCorrelated(result: ReleaseResult, command: ReleaseRunCommand): boolean {
  if (result.code === 'RELEASE_PENDING')
    return (
      result.runId === command.runId &&
      result.leaseFence === command.leaseFence &&
      result.terminalControlId === command.terminalControlId &&
      result.eventId === command.terminalControlId &&
      result.createdAt === command.now
    );
  if (result.code === 'ALREADY_APPLIED')
    return (
      result.runId === command.runId &&
      result.leaseFence === command.leaseFence &&
      result.terminalControlId === command.terminalControlId &&
      result.eventId === command.terminalControlId
    );
  return true;
}

function isAbandonProjectionCorrelated(
  result: AbandonPendingResult,
  command: AbandonExpiredRunCommand
): boolean {
  if (result.code === 'ABANDON_PENDING')
    return (
      result.runId === command.observedRunId &&
      result.leaseFence === command.observedLeaseFence &&
      result.phase === 'abandon_pending' &&
      result.terminalControlId === command.terminalControlId &&
      result.eventId === command.terminalControlId &&
      result.reconciledAt === command.now
    );
  if (result.code === 'ALREADY_APPLIED')
    return (
      result.runId === command.observedRunId &&
      result.leaseFence === command.observedLeaseFence &&
      result.phase === 'abandon_pending' &&
      result.terminalControlId === command.terminalControlId &&
      result.eventId === command.terminalControlId
    );
  return true;
}

function isTransportStatusProjectionCorrelated(
  result: TransportStatusResult,
  command: GetTransportStatusCommand
): boolean {
  return (
    result.code !== 'TRANSPORT_STATUS' ||
    (result.runId === command.runId && result.leaseFence === command.leaseFence)
  );
}

function canonicalAcquireOperationRequest(input: AcquireProvisioningLeaseInput): string {
  return JSON.stringify({
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    matrixRoomBindingDigest: input.matrixRoomBindingDigest,
    whatsappAccountBindingDigest: input.whatsappAccountBindingDigest,
    whatsappSenderBindingDigest: input.whatsappSenderBindingDigest,
  });
}

function canonicalActivateOperationRequest(input: ActivateRunInput): string {
  return JSON.stringify({
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  });
}

function canonicalRenewOperationRequest(input: RenewLeaseInput): string {
  return JSON.stringify({
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  });
}

function canonicalQuiesceOperationRequest(input: QuiesceRunInput): string {
  return JSON.stringify({
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
  });
}

function canonicalReleaseOperationRequest(input: ReleaseRunInput): string {
  return JSON.stringify({
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
    contextFinalizationTombstoneDigest: input.contextFinalizationTombstoneDigest,
    terminalCandidateDigest: input.terminalCandidateDigest,
    artifactStageDigest: input.artifactStageDigest,
  });
}

function isActivationReady(
  status: MatrixCorpusControlStatusResult,
  input: ActivateRunInput
): status is Exclude<MatrixCorpusControlStatusResult, { readonly kind: 'not_ready' }> {
  return (
    status.kind === 'status' &&
    status.runId === input.runId &&
    status.userId === input.userId &&
    status.leaseFence === input.leaseFence &&
    status.contextReady &&
    status.manifestReady &&
    status.preflightProjectionReady &&
    status.retentionReconciled
  );
}

function isReleaseReady(
  status: MatrixCorpusControlStatusResult,
  input: ReleaseRunInput
): status is Exclude<MatrixCorpusControlStatusResult, { readonly kind: 'not_ready' }> {
  return (
    status.kind === 'status' &&
    status.runId === input.runId &&
    status.userId === input.userId &&
    status.leaseFence === input.leaseFence &&
    status.lifecycle === 'finalizing' &&
    status.contextFinalizationTombstoneDigest === input.contextFinalizationTombstoneDigest &&
    status.terminalCandidateDigest === input.terminalCandidateDigest &&
    status.artifactStageDigest === input.artifactStageDigest
  );
}

export class MatrixCorpusControlPlane {
  public constructor(private readonly dependencies: MatrixCorpusControlDependencies) {}

  public async acquireProvisioningLease(
    input: AcquireProvisioningLeaseInput
  ): Promise<ProvisioningLeaseResult> {
    const parsedInput = acquireProvisioningLeaseInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('input_contract');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    const idempotencyKeyDigest = deriveDigest(this.dependencies, 'imc-operation-idempotency-v1', [
      'acquire',
      parsedInput.data.idempotencyKey,
    ]);
    const canonicalRequestDigest = deriveDigest(this.dependencies, 'imc-operation-request-v1', [
      'acquire',
      canonicalAcquireOperationRequest(parsedInput.data),
    ]);
    if (
      leaseSlotDigest === null ||
      runFenceDigest === null ||
      idempotencyKeyDigest === null ||
      canonicalRequestDigest === null
    ) {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('command');
    }

    let acquisitionReadiness: MatrixCorpusCurrentAcceptanceResult = notReadyAcceptance;
    try {
      const parsedReadiness = matrixCorpusCurrentAcceptanceResultSchema.safeParse(
        await this.dependencies.intexAgent.getCurrentAcceptance({
          runtimeAudience: parsedInput.data.runtimeAudience,
          userId: parsedInput.data.userId,
        })
      );
      if (parsedReadiness.success && parsedReadiness.data.kind === 'admission_ready')
        acquisitionReadiness = parsedReadiness.data;
      else staticLog(this.dependencies, 'acquire', 'NOT_READY');
    } catch {
      staticLog(this.dependencies, 'acquire', 'NOT_READY');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    const parsedLeaseTtlMs = matrixCorpusLeaseTtlMsSchema.safeParse(this.dependencies.leaseTtlMs);
    if (!parsedNow.success || !parsedLeaseTtlMs.success) {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('command');
    }
    const expiresAt = addMilliseconds(parsedNow.data, parsedLeaseTtlMs.data);
    if (expiresAt === null) {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('command');
    }

    const { idempotencyKey: _idempotencyKey, ...commandInput } = parsedInput.data;
    const command: AcquireProvisioningLeaseCommand = {
      ...commandInput,
      leaseSlotDigest,
      runFenceDigest,
      idempotencyKeyDigest,
      canonicalRequestDigest,
      now: parsedNow.data,
      expiresAt,
      acquisitionReadiness,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.acquireProvisioningLease(command);
    } catch {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('repository_result');
    }
    const parsedResult = provisioningLeaseResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isProvisioningLeaseProjectionCorrelated(parsedResult.data, command)
    ) {
      staticLog(this.dependencies, 'acquire', 'CORRUPT_STATE');
      return corruptState('repository_result');
    }
    return parsedResult.data;
  }

  public async activateRun(input: ActivateRunInput): Promise<ActivationResult> {
    const parsedInput = activateRunInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('input_contract');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    const idempotencyKeyDigest = deriveDigest(this.dependencies, 'imc-operation-idempotency-v1', [
      'activate',
      parsedInput.data.idempotencyKey,
    ]);
    const canonicalRequestDigest = deriveDigest(this.dependencies, 'imc-operation-request-v1', [
      'activate',
      canonicalActivateOperationRequest(parsedInput.data),
    ]);
    if (
      leaseSlotDigest === null ||
      runFenceDigest === null ||
      idempotencyKeyDigest === null ||
      canonicalRequestDigest === null
    ) {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('command');
    }

    let controlStatus: MatrixCorpusControlStatusResult = notReadyAcceptance;
    try {
      const parsedStatus = matrixCorpusControlStatusResultSchema.safeParse(
        await this.dependencies.intexAgent.getControlStatus({
          runtimeAudience: parsedInput.data.runtimeAudience,
          runId: parsedInput.data.runId,
          userId: parsedInput.data.userId,
          leaseFence: parsedInput.data.leaseFence,
        })
      );
      if (parsedStatus.success && isActivationReady(parsedStatus.data, parsedInput.data))
        controlStatus = parsedStatus.data;
      else staticLog(this.dependencies, 'activate', 'NOT_READY');
    } catch {
      staticLog(this.dependencies, 'activate', 'NOT_READY');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('command');
    }

    const { idempotencyKey: _idempotencyKey, ...commandInput } = parsedInput.data;
    const command: ActivateRunCommand = {
      ...commandInput,
      leaseSlotDigest,
      runFenceDigest,
      idempotencyKeyDigest,
      canonicalRequestDigest,
      now: parsedNow.data,
      controlStatus,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.activateRun(command);
    } catch {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('repository_result');
    }
    const parsedResult = activationResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isActivationProjectionCorrelated(parsedResult.data, command)
    ) {
      staticLog(this.dependencies, 'activate', 'CORRUPT_STATE');
      return corruptActivationState('repository_result');
    }
    return parsedResult.data;
  }

  public async renewLease(input: RenewLeaseInput): Promise<LeaseRenewResult> {
    const parsedInput = renewLeaseInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    const parsedLeaseTtlMs = matrixCorpusLeaseTtlMsSchema.safeParse(this.dependencies.leaseTtlMs);
    if (!parsedNow.success || !parsedLeaseTtlMs.success) {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('command');
    }
    const expiresAt = addMilliseconds(parsedNow.data, parsedLeaseTtlMs.data);
    if (expiresAt === null) {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    const idempotencyKeyDigest = deriveDigest(this.dependencies, 'imc-operation-idempotency-v1', [
      'renew',
      parsedInput.data.idempotencyKey,
    ]);
    const canonicalRequestDigest = deriveDigest(this.dependencies, 'imc-operation-request-v1', [
      'renew',
      canonicalRenewOperationRequest(parsedInput.data),
    ]);
    if (
      leaseSlotDigest === null ||
      runFenceDigest === null ||
      idempotencyKeyDigest === null ||
      canonicalRequestDigest === null
    ) {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('command');
    }

    const { idempotencyKey: _idempotencyKey, ...commandInput } = parsedInput.data;
    const command: RenewLeaseCommand = {
      ...commandInput,
      leaseSlotDigest,
      runFenceDigest,
      idempotencyKeyDigest,
      canonicalRequestDigest,
      now: parsedNow.data,
      expiresAt,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.renewLease(command);
    } catch {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('repository_result');
    }
    const parsedResult = leaseRenewResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isLeaseRenewProjectionCorrelated(parsedResult.data, command)
    ) {
      staticLog(this.dependencies, 'renew', 'CORRUPT_STATE');
      return corruptRenewState('repository_result');
    }
    return parsedResult.data;
  }

  public async issueCapability(
    input: MatrixCorpusCapabilityIssueRequestV1
  ): Promise<CapabilityIssueResult> {
    const parsedInput = matrixCorpusCapabilityIssueRequestV1Schema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    const parsedCapabilityTtlMs = matrixCorpusCapabilityTtlMsSchema.safeParse(
      this.dependencies.capabilityTtlMs
    );
    if (!parsedNow.success || !parsedCapabilityTtlMs.success) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }
    const expiresAt = addMilliseconds(parsedNow.data, parsedCapabilityTtlMs.data);
    if (expiresAt === null) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    const capabilityDigest = deriveDigest(this.dependencies, 'imc-capability-v1', [
      parsedInput.data.rawCapability,
    ]);
    if (leaseSlotDigest === null || runFenceDigest === null || capabilityDigest === null) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }

    const { rawCapability: _rawCapability, ...semanticInput } = parsedInput.data;
    const issueDigestInput: MatrixCorpusCapabilityIssueDigestInputV1 = {
      ...semanticInput,
      capabilityDigest,
    };

    let issueRequestDigest: string;
    try {
      issueRequestDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusCapabilityIssueDigestInputV1(issueDigestInput)
      );
    } catch {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }
    const parsedIssueRequestDigest = matrixCorpusSha256DigestSchema.safeParse(issueRequestDigest);
    if (!parsedIssueRequestDigest.success) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('command');
    }

    const capability: MatrixCorpusCapabilityV1 = {
      ...issueDigestInput,
      issueRequestDigest: parsedIssueRequestDigest.data,
      issuedAt: parsedNow.data,
      expiresAt,
      consumedAt: null,
      consumedTransportMessageIdDigest: null,
      ingestOutboxId: null,
      revokedAt: null,
    };

    const command: IssueCapabilityCommand = {
      now: parsedNow.data,
      leaseSlotDigest,
      runFenceDigest,
      capability,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.issueCapability(command);
    } catch {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('repository_result');
    }
    const parsedResult = capabilityIssueResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isCapabilityIssueProjectionCorrelated(parsedResult.data, command)
    ) {
      staticLog(this.dependencies, 'issue', 'CORRUPT_STATE');
      return corruptIssueState('repository_result');
    }
    return parsedResult.data;
  }

  public async recordMatrixSendProof(
    input: RecordMatrixSendProofInput
  ): Promise<MatrixSendProofResult> {
    const parsedInput = recordMatrixSendProofInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('input_contract');
    }
    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('command');
    }
    if (!matrixCorpusRfc3339TimestampSchema.safeParse(now).success) {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('command');
    }

    const visible = parseMatrixCorpusVisibleMessage(parsedInput.data.messageText);
    if (
      visible.kind !== 'matrix_corpus' ||
      visible.capability !== parsedInput.data.rawCapability ||
      visible.scenarioNumber !== parsedInput.data.scenarioNumber ||
      visible.phase !== parsedInput.data.phase ||
      !visibleTurnMatchesProof(visible, parsedInput.data.turnIndex)
    )
      return { code: 'CAPABILITY_MISMATCH' };

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    const capabilityDigest = deriveDigest(this.dependencies, 'imc-capability-v1', [
      parsedInput.data.rawCapability,
    ]);
    const matrixIdempotencyKeyDigest = deriveDigest(
      this.dependencies,
      'imc-matrix-idempotency-v1',
      [parsedInput.data.idempotencyKey]
    );
    const matrixEventIdDigest = deriveDigest(this.dependencies, 'imc-matrix-event-v1', [
      parsedInput.data.matrixEventId,
    ]);
    const observedRoomBindingDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      'matrix-room-binding',
      parsedInput.data.matrixRoomId,
    ]);
    if (
      leaseSlotDigest === null ||
      runFenceDigest === null ||
      capabilityDigest === null ||
      matrixIdempotencyKeyDigest === null ||
      matrixEventIdDigest === null ||
      observedRoomBindingDigest === null
    ) {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('command');
    }
    if (observedRoomBindingDigest !== parsedInput.data.matrixRoomBindingDigest)
      return { code: 'CAPABILITY_MISMATCH' };

    let messageTextDigest: string;
    let promptDigest: string;
    try {
      messageTextDigest = this.dependencies.sha256.digestCanonical(
        JSON.stringify({ version: 1, text: parsedInput.data.messageText })
      );
      promptDigest = digestMatrixCorpusPromptV1({
        body: visible.naturalBody,
        startNewSession: visible.startNewSession,
      });
    } catch {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('command');
    }
    if (
      !matrixCorpusSha256DigestSchema.safeParse(messageTextDigest).success ||
      !matrixCorpusSha256DigestSchema.safeParse(promptDigest).success
    ) {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('command');
    }

    const command: RecordMatrixSendProofCommand = {
      now,
      leaseSlotDigest,
      runFenceDigest,
      capabilityDigest,
      matrixIdempotencyKeyDigest,
      matrixEventIdDigest,
      matrixRoomBindingDigest: observedRoomBindingDigest,
      messageTextDigest,
      promptDigest,
      runtimeAudience: parsedInput.data.runtimeAudience,
      runId: parsedInput.data.runId,
      userId: parsedInput.data.userId,
      leaseFence: parsedInput.data.leaseFence,
      scenarioId: parsedInput.data.scenarioId,
      scenarioNumber: parsedInput.data.scenarioNumber,
      phase: parsedInput.data.phase,
      turnIndex: parsedInput.data.turnIndex,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.recordMatrixSendProof(command);
    } catch {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('repository_result');
    }
    const parsedResult = matrixSendProofResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      ((parsedResult.data.code === 'MATRIX_SEND_PROOF_RECORDED' ||
        parsedResult.data.code === 'ALREADY_APPLIED') &&
        (parsedResult.data.runId !== parsedInput.data.runId ||
          parsedResult.data.leaseFence !== parsedInput.data.leaseFence ||
          parsedResult.data.scenarioId !== parsedInput.data.scenarioId ||
          parsedResult.data.phase !== parsedInput.data.phase ||
          parsedResult.data.turnIndex !== parsedInput.data.turnIndex))
    ) {
      staticLog(this.dependencies, 'record_matrix_send_proof', 'CORRUPT_STATE');
      return corruptMatrixSendProofState('repository_result');
    }
    return parsedResult.data;
  }

  public async consumeCapabilityAndEnqueueIngest(
    input: ConsumeCapabilityAndEnqueueIngestInput
  ): Promise<CapabilityConsumeResult> {
    const parsedInput = consumeCapabilityAndEnqueueIngestInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }

    const payloadContext = parsedInput.data.facts.payload.context;
    const ordinaryIngest = parsedInput.data.facts.payload.ordinaryIngest;
    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      payloadContext.runtimeAudience,
      ordinaryIngest.userId,
    ]);
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      payloadContext.runtimeAudience,
      ordinaryIngest.userId,
      payloadContext.runId,
    ]);
    const capabilityDigest = deriveDigest(this.dependencies, 'imc-capability-v1', [
      parsedInput.data.rawCapability,
    ]);
    const transportMessageIdDigest = deriveDigest(this.dependencies, 'imc-transport-v1', [
      parsedInput.data.transportMessageId,
    ]);
    if (
      leaseSlotDigest === null ||
      runFenceDigest === null ||
      capabilityDigest === null ||
      transportMessageIdDigest === null
    ) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }

    const derivedIngestIds = deriveStableIngestIds(transportMessageIdDigest);

    const callerIngressRequest = parsedInput.data.facts.ingressRequest;
    if (
      callerIngressRequest.capabilityDigest !== capabilityDigest ||
      callerIngressRequest.transportMessageIdDigest !== transportMessageIdDigest ||
      parsedInput.data.facts.payload.context.ingestReceiptId !== derivedIngestIds.ingestReceiptId ||
      callerIngressRequest.ingestReceiptId !== derivedIngestIds.ingestReceiptId ||
      callerIngressRequest.ingestOutboxId !== derivedIngestIds.ingestOutboxId
    ) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }

    const payload: MatrixCorpusAttestedIngestPayloadV1 = {
      ...parsedInput.data.facts.payload,
      context: {
        ...parsedInput.data.facts.payload.context,
        ingestReceiptId: derivedIngestIds.ingestReceiptId,
      },
    };

    let payloadDigest: string;
    try {
      payloadDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusIngestPayloadV1(payload)
      );
    } catch {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }
    const parsedPayloadDigest = matrixCorpusSha256DigestSchema.safeParse(payloadDigest);
    if (
      !parsedPayloadDigest.success ||
      callerIngressRequest.payloadDigest !== parsedPayloadDigest.data
    ) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }

    const ingressRequest: MatrixCorpusCanonicalIngressDigestInputV1 = {
      ...callerIngressRequest,
      capabilityDigest,
      transportMessageIdDigest,
      ingestReceiptId: derivedIngestIds.ingestReceiptId,
      payloadDigest: parsedPayloadDigest.data,
      ingestOutboxId: derivedIngestIds.ingestOutboxId,
    };

    let ingressRequestDigest: string;
    try {
      ingressRequestDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusIngressRequestV1(ingressRequest)
      );
    } catch {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }
    const parsedIngressRequestDigest = matrixCorpusSha256DigestSchema.safeParse(ingressRequestDigest);
    if (
      !parsedIngressRequestDigest.success ||
      parsedInput.data.facts.ingressRequestDigest !== parsedIngressRequestDigest.data
    ) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('command');
    }

    const facts: MatrixCorpusCapabilityConsumeFactsV1 = {
      version: parsedInput.data.facts.version,
      ingressRequest,
      ingressRequestDigest: parsedIngressRequestDigest.data,
      payload,
    };

    const command: ConsumeCapabilityAndEnqueueIngestCommand = {
      now: parsedNow.data,
      leaseSlotDigest,
      runFenceDigest,
      capabilityDigest,
      transportMessageIdDigest,
      ingestReceiptId: derivedIngestIds.ingestReceiptId,
      ingestOutboxId: derivedIngestIds.ingestOutboxId,
      facts,
      payloadDigest: parsedPayloadDigest.data,
      ingressRequestDigest: parsedIngressRequestDigest.data,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.consumeCapabilityAndEnqueueIngest(command);
    } catch {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('repository_result');
    }
    const parsedResult = capabilityConsumeResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isCapabilityConsumeProjectionCorrelated(parsedResult.data, command)
    ) {
      staticLog(this.dependencies, 'consume', 'CORRUPT_STATE');
      return corruptConsumeState('repository_result');
    }
    return parsedResult.data;
  }

  public async quiesceRun(input: QuiesceRunInput): Promise<QuiesceResult> {
    const parsedInput = quiesceRunInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    if (leaseSlotDigest === null) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    if (runFenceDigest === null) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }
    const idempotencyKeyDigest = deriveDigest(this.dependencies, 'imc-operation-idempotency-v1', [
      'quiesce',
      parsedInput.data.idempotencyKey,
    ]);
    if (idempotencyKeyDigest === null) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }
    const canonicalRequestDigest = deriveDigest(this.dependencies, 'imc-operation-request-v1', [
      'quiesce',
      canonicalQuiesceOperationRequest(parsedInput.data),
    ]);
    if (canonicalRequestDigest === null) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }

    const { idempotencyKey: _idempotencyKey, ...commandInput } = parsedInput.data;
    const parsedCommand = quiesceRunCommandSchema.safeParse({
      ...commandInput,
      leaseSlotDigest,
      runFenceDigest,
      idempotencyKeyDigest,
      canonicalRequestDigest,
      now: parsedNow.data,
    });
    if (!parsedCommand.success) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('command');
    }

    let result: unknown;
    try {
      result = await this.dependencies.repository.quiesceRun(parsedCommand.data);
    } catch {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('repository_result');
    }
    const parsedResult = quiesceResultSchema.safeParse(result);
    if (!parsedResult.success || !isQuiesceProjectionCorrelated(parsedResult.data, parsedCommand.data)) {
      staticLog(this.dependencies, 'quiesce', 'CORRUPT_STATE');
      return corruptQuiesceState('repository_result');
    }
    return parsedResult.data;
  }

  public async releaseRun(input: ReleaseRunInput): Promise<ReleaseFacadeResult> {
    const parsedInput = releaseRunInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    if (leaseSlotDigest === null) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    if (runFenceDigest === null) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }
    const idempotencyKeyDigest = deriveDigest(this.dependencies, 'imc-operation-idempotency-v1', [
      'release',
      parsedInput.data.idempotencyKey,
    ]);
    if (idempotencyKeyDigest === null) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }
    const canonicalRequestDigest = deriveDigest(this.dependencies, 'imc-operation-request-v1', [
      'release',
      canonicalReleaseOperationRequest(parsedInput.data),
    ]);
    if (canonicalRequestDigest === null) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }

    let controlStatus: MatrixCorpusControlStatusResult = notReadyControlStatus;
    let releaseReady = false;
    try {
      const parsedStatus = matrixCorpusControlStatusResultSchema.safeParse(
        await this.dependencies.intexAgent.getControlStatus({
          runtimeAudience: parsedInput.data.runtimeAudience,
          runId: parsedInput.data.runId,
          userId: parsedInput.data.userId,
          leaseFence: parsedInput.data.leaseFence,
        })
      );
      if (parsedStatus.success && isReleaseReady(parsedStatus.data, parsedInput.data)) {
        controlStatus = parsedStatus.data;
        releaseReady = true;
      }
    } catch {
      // Readiness is advisory: receipt-first repository replay remains authoritative.
    }
    if (!releaseReady) staticLog(this.dependencies, 'release', 'NOT_READY');

    const terminalControlId = deriveDigest(this.dependencies, 'imc-terminal-v1', [
      parsedInput.data.runId,
      parsedInput.data.leaseFence,
      'release',
    ]);
    if (terminalControlId === null) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }

    const terminalControl: MatrixCorpusTerminalControlV1 = {
      version: 1,
      eventId: terminalControlId,
      runId: parsedInput.data.runId,
      userId: parsedInput.data.userId,
      leaseFence: parsedInput.data.leaseFence,
      createdAt: parsedNow.data,
      kind: 'release',
      tombstoneDigest: parsedInput.data.contextFinalizationTombstoneDigest,
      terminalCandidateDigest: parsedInput.data.terminalCandidateDigest,
      artifactStageDigest: parsedInput.data.artifactStageDigest,
    };

    let terminalPayloadDigest: string;
    try {
      terminalPayloadDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusTerminalControlV1(terminalControl)
      );
    } catch {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }
    const parsedTerminalPayloadDigest = matrixCorpusSha256DigestSchema.safeParse(terminalPayloadDigest);
    if (!parsedTerminalPayloadDigest.success) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('command');
    }

    const {
      idempotencyKey: _idempotencyKey,
      contextFinalizationTombstoneDigest: _contextFinalizationTombstoneDigest,
      terminalCandidateDigest: _terminalCandidateDigest,
      artifactStageDigest: _artifactStageDigest,
      ...commandInput
    } = parsedInput.data;
    const command: ReleaseRunCommand = {
      ...commandInput,
      leaseSlotDigest,
      runFenceDigest,
      idempotencyKeyDigest,
      canonicalRequestDigest,
      now: parsedNow.data,
      controlStatus,
      terminalControlId,
      terminalControl,
      terminalPayloadDigest: parsedTerminalPayloadDigest.data,
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.releaseRun(command);
    } catch {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('repository_result');
    }
    const parsedResult = releaseResultSchema.safeParse(result);
    if (!parsedResult.success || !isReleaseProjectionCorrelated(parsedResult.data, command)) {
      staticLog(this.dependencies, 'release', 'CORRUPT_STATE');
      return corruptReleaseState('repository_result');
    }
    return parsedResult.data;
  }

  public async abandonExpiredRun(input: AbandonExpiredRunInput): Promise<AbandonPendingResult> {
    return await this.abandonRun(input, 'lease_expired');
  }

  public async abortProvisioningRun(input: AbandonExpiredRunInput): Promise<AbandonPendingResult> {
    return await this.abandonRun(input, 'evaluator_abort');
  }

  private async abandonRun(
    input: AbandonExpiredRunInput,
    trigger: 'lease_expired' | 'evaluator_abort'
  ): Promise<AbandonPendingResult> {
    const parsedInput = abandonExpiredRunInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.observedUserId,
    ]);
    if (leaseSlotDigest === null) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.observedUserId,
      parsedInput.data.observedRunId,
    ]);
    if (runFenceDigest === null) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }
    const terminalControlId = deriveDigest(this.dependencies, 'imc-terminal-v1', [
      parsedInput.data.observedRunId,
      parsedInput.data.observedLeaseFence,
      'abandoned',
    ]);
    if (terminalControlId === null) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }

    const terminalControl: MatrixCorpusTerminalControlV1 = {
      version: 1,
      eventId: terminalControlId,
      runId: parsedInput.data.observedRunId,
      userId: parsedInput.data.observedUserId,
      leaseFence: parsedInput.data.observedLeaseFence,
      createdAt: parsedNow.data,
      kind: 'abandoned',
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    };

    let terminalPayloadDigest: string;
    try {
      terminalPayloadDigest = this.dependencies.sha256.digestCanonical(
        canonicalMatrixCorpusTerminalControlV1(terminalControl)
      );
    } catch {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }
    const parsedTerminalPayloadDigest = matrixCorpusSha256DigestSchema.safeParse(terminalPayloadDigest);
    if (!parsedTerminalPayloadDigest.success) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('command');
    }

    const command: AbandonExpiredRunCommand = {
      ...parsedInput.data,
      leaseSlotDigest,
      runFenceDigest,
      now: parsedNow.data,
      terminalControlId,
      terminalControl,
      terminalPayloadDigest: parsedTerminalPayloadDigest.data,
      ...(trigger === 'evaluator_abort' ? { trigger } : {}),
    };

    let result: unknown;
    try {
      result = await this.dependencies.repository.abandonExpiredRun(command);
    } catch {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('repository_result');
    }
    const parsedResult = abandonPendingResultSchema.safeParse(result);
    if (!parsedResult.success || !isAbandonProjectionCorrelated(parsedResult.data, command)) {
      staticLog(this.dependencies, 'abandon', 'CORRUPT_STATE');
      return corruptAbandonState('repository_result');
    }
    return parsedResult.data;
  }

  public async getTransportStatus(input: GetTransportStatusInput): Promise<TransportStatusResult> {
    const parsedInput = getTransportStatusInputSchema.safeParse(input);
    if (!parsedInput.success) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('input_contract');
    }

    let now: string;
    try {
      now = this.dependencies.clock.now();
    } catch {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('command');
    }
    const parsedNow = matrixCorpusRfc3339TimestampSchema.safeParse(now);
    if (!parsedNow.success) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('command');
    }

    const leaseSlotDigest = deriveDigest(this.dependencies, 'imc-lease-slot-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
    ]);
    if (leaseSlotDigest === null) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('command');
    }
    const runFenceDigest = deriveDigest(this.dependencies, 'imc-run-fence-v1', [
      parsedInput.data.runtimeAudience,
      parsedInput.data.userId,
      parsedInput.data.runId,
    ]);
    if (runFenceDigest === null) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('command');
    }

    const parsedCommand = getTransportStatusCommandSchema.safeParse({
      ...parsedInput.data,
      leaseSlotDigest,
      runFenceDigest,
      now: parsedNow.data,
    });
    if (!parsedCommand.success) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('command');
    }

    let result: unknown;
    try {
      result = await this.dependencies.repository.getTransportStatus(parsedCommand.data);
    } catch {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('repository_result');
    }
    const parsedResult = transportStatusResultSchema.safeParse(result);
    if (
      !parsedResult.success ||
      !isTransportStatusProjectionCorrelated(parsedResult.data, parsedCommand.data)
    ) {
      staticLog(this.dependencies, 'status', 'CORRUPT_STATE');
      return corruptTransportStatusState('repository_result');
    }
    return parsedResult.data;
  }
}
