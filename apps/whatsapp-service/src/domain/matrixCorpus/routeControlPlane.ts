import {
  matrixCorpusControlStatusResultSchema,
  type IntexAgentMatrixCorpusClient,
} from './ports/intexAgentMatrixCorpusClient.js';
import type {
  MatrixCorpusBoundCleanupPort,
  MatrixCorpusBoundLeaseAuthority,
  MatrixCorpusBoundOperationInput,
  MatrixCorpusBoundSendProofInput,
  MatrixCorpusLeaseBindingAuthorizationPort,
  MatrixCorpusLeaseBindingAuthorizationResult,
  MatrixCorpusRouteControlPlane,
} from './ports/matrixCorpusRouteControlPlane.js';
import type { MatrixCorpusControlPlane } from './controlPlane.js';
import type {
  ActivationResult,
  CleanupResult,
  LeaseRenewResult,
  QuiesceResult,
  ReleaseResult,
  TransportStatusResult,
} from './types.js';

type StrippedBindings<T extends MatrixCorpusBoundLeaseAuthority> = Omit<
  T,
  | 'matrixRoomBindingDigest'
  | 'whatsappAccountBindingDigest'
  | 'whatsappSenderBindingDigest'
>;

export interface MatrixCorpusRouteControlPlaneAdapterDependencies {
  readonly controlPlane: MatrixCorpusControlPlane;
  readonly leaseBindingAuthorization: MatrixCorpusLeaseBindingAuthorizationPort;
  readonly cleanup: MatrixCorpusBoundCleanupPort;
  readonly intexAgent: IntexAgentMatrixCorpusClient;
}

export class MatrixCorpusRouteControlPlaneAdapter implements MatrixCorpusRouteControlPlane {
  public constructor(
    private readonly dependencies: MatrixCorpusRouteControlPlaneAdapterDependencies
  ) {}

  public async acquireProvisioningLease(
    input: Parameters<MatrixCorpusControlPlane['acquireProvisioningLease']>[0]
  ): ReturnType<MatrixCorpusControlPlane['acquireProvisioningLease']> {
    return await this.dependencies.controlPlane.acquireProvisioningLease(input);
  }

  public async activateRun(input: MatrixCorpusBoundOperationInput): Promise<ActivationResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.activateRun(stripBindings(input));
  }

  public async renewLease(input: MatrixCorpusBoundOperationInput): Promise<LeaseRenewResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.renewLease(stripBindings(input));
  }

  public async issueCapability(
    input: Parameters<MatrixCorpusControlPlane['issueCapability']>[0]
  ): ReturnType<MatrixCorpusControlPlane['issueCapability']> {
    return await this.dependencies.controlPlane.issueCapability(input);
  }

  public async recordMatrixSendProof(
    input: MatrixCorpusBoundSendProofInput
  ): ReturnType<MatrixCorpusControlPlane['recordMatrixSendProof']> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.recordMatrixSendProof(input);
  }

  public async getTransportStatus(
    input: MatrixCorpusBoundLeaseAuthority
  ): Promise<TransportStatusResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.getTransportStatus(stripBindings(input));
  }

  public async quiesceRun(input: MatrixCorpusBoundOperationInput): Promise<QuiesceResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.quiesceRun(stripBindings(input));
  }

  public async releaseRun(input: MatrixCorpusBoundOperationInput): Promise<ReleaseResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;

    let status: unknown;
    try {
      status = await this.dependencies.intexAgent.getControlStatus({
        runtimeAudience: input.runtimeAudience,
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
      });
    } catch {
      return { code: 'NOT_READY', gate: 'release' };
    }
    const parsed = matrixCorpusControlStatusResultSchema.safeParse(status);
    if (
      !parsed.success ||
      parsed.data.kind !== 'status' ||
      parsed.data.runId !== input.runId ||
      parsed.data.userId !== input.userId ||
      parsed.data.leaseFence !== input.leaseFence ||
      parsed.data.lifecycle !== 'finalizing' ||
      parsed.data.contextFinalizationTombstoneDigest === null ||
      parsed.data.terminalCandidateDigest === null ||
      parsed.data.artifactStageDigest === null
    )
      return { code: 'NOT_READY', gate: 'release' };

    return await this.dependencies.controlPlane.releaseRun({
      ...stripBindings(input),
      contextFinalizationTombstoneDigest:
        parsed.data.contextFinalizationTombstoneDigest,
      terminalCandidateDigest: parsed.data.terminalCandidateDigest,
      artifactStageDigest: parsed.data.artifactStageDigest,
    });
  }

  public async abortProvisioningRun(
    input: MatrixCorpusBoundOperationInput
  ): Promise<import('./types.js').AbandonPendingResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.controlPlane.abortProvisioningRun({
      runtimeAudience: input.runtimeAudience,
      observedRunId: input.runId,
      observedUserId: input.userId,
      observedLeaseFence: input.leaseFence,
    });
  }

  public async cleanupExactRun(
    input: Parameters<MatrixCorpusBoundCleanupPort['cleanupExactRun']>[0]
  ): Promise<CleanupResult> {
    const failure = await this.authorize(input);
    if (failure !== null) return failure;
    return await this.dependencies.cleanup.cleanupExactRun(input);
  }

  private async authorize(
    input: MatrixCorpusBoundLeaseAuthority
  ): Promise<Exclude<MatrixCorpusLeaseBindingAuthorizationResult, { code: 'AUTHORIZED' }> | null> {
    let result: MatrixCorpusLeaseBindingAuthorizationResult;
    try {
      result =
        await this.dependencies.leaseBindingAuthorization.authorizeCurrentLeaseBinding(
          bindingAuthority(input)
        );
    } catch {
      return { code: 'CORRUPT_STATE', recordKind: 'lease' };
    }
    return result.code === 'AUTHORIZED' ? null : result;
  }
}

function bindingAuthority(input: MatrixCorpusBoundLeaseAuthority): MatrixCorpusBoundLeaseAuthority {
  return {
    runtimeAudience: input.runtimeAudience,
    runId: input.runId,
    userId: input.userId,
    leaseFence: input.leaseFence,
    matrixRoomBindingDigest: input.matrixRoomBindingDigest,
    whatsappAccountBindingDigest: input.whatsappAccountBindingDigest,
    whatsappSenderBindingDigest: input.whatsappSenderBindingDigest,
  };
}

function stripBindings<T extends MatrixCorpusBoundLeaseAuthority>(input: T): StrippedBindings<T> {
  const {
    matrixRoomBindingDigest: _matrixRoomBindingDigest,
    whatsappAccountBindingDigest: _whatsappAccountBindingDigest,
    whatsappSenderBindingDigest: _whatsappSenderBindingDigest,
    ...operation
  } = input;
  return operation;
}
