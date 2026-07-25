/* eslint-disable @typescript-eslint/explicit-function-return-type -- Test fixtures preserve inferred literal result types. */
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Logger } from '@intexuraos/common-core';
import * as matrixCorpusContracts from '@intexuraos/http-contracts';
import {
  canonicalMatrixCorpusCapabilityIssueDigestInputV1,
  canonicalMatrixCorpusIngressRequestV1,
  canonicalMatrixCorpusIngestPayloadV1,
  canonicalMatrixCorpusTerminalControlV1,
  type MatrixCorpusAttestedIngestPayloadV1,
  type MatrixCorpusCapabilityV1,
  type StrictToolMockProfileV1,
} from '@intexuraos/http-contracts';

import { MatrixCorpusControlPlane } from '../../../domain/matrixCorpus/controlPlane.js';
import type { MatrixCorpusRepository } from '../../../domain/matrixCorpus/ports/matrixCorpusRepository.js';
import {
  FakeMatrixCorpusRepository,
  FakeMatrixCorpusRepositoryFault,
  type FakeMatrixCorpusCoreStateSummary,
  type FakeMatrixCorpusCleanupOutboxSeed,
  type FakeMatrixCorpusIssueConsumeInvariantForTest,
  type FakeMatrixCorpusIssueConsumeSeed,
  type FakeMatrixCorpusLifecycleSeed,
} from './fakes.js';

import {
  abandonExpiredRunCommandSchema,
  acquireProvisioningLeaseCommandSchema,
  acquireProvisioningLeaseInputSchema,
  acknowledgeIngestOutboxInputSchema,
  acknowledgeTerminalControlInputSchema,
  activateRunCommandSchema,
  activateRunInputSchema,
  claimPendingIngestOutboxInputSchema,
  claimPendingTerminalControlOutboxInputSchema,
  cleanupExactRunCommandSchema,
  consumeCapabilityAndEnqueueIngestCommandSchema,
  consumeCapabilityAndEnqueueIngestInputSchema,
  getTransportStatusCommandSchema,
  getTransportStatusInputSchema,
  issueCapabilityCommandSchema,
  capabilityConsumeResultSchema,
  capabilityIssueResultSchema,
  claimRenewResultSchema,
  cleanupResultSchema,
  ingestClaimResultSchema,
  matrixCorpusCapabilityIssuanceReceiptV1Schema,
  matrixCorpusCleanupChunkReceiptV1Schema,
  matrixCorpusCleanupProgressV1Schema,
  matrixCorpusIngestAcknowledgementOutcomeSchema,
  matrixCorpusIngestOutboxRecordV1Schema,
  matrixCorpusLeaseHistoryV1Schema,
  matrixCorpusLeaseV1Schema,
  matrixCorpusOperationReceiptV1Schema,
  matrixCorpusPersistedReplayProjectionV1Schema,
  matrixCorpusRenewReceiptV1Schema,
  matrixCorpusTerminalControlOutboxRecordV1Schema,
  matrixCorpusTerminalFailureReceiptRefV1Schema,
  matrixCorpusTransportReceiptV1Schema,
  acknowledgeResultSchema,
  activationResultSchema,
  abandonPendingResultSchema,
  leaseRenewResultSchema,
  provisioningLeaseResultSchema,
  quiesceResultSchema,
  releaseResultSchema,
  terminalClaimResultSchema,
  terminalControlAcknowledgementResultSchema,
  transportStatusResultSchema,
  matrixCorpusCapabilityTtlMsSchema,
  matrixCorpusLeaseTtlMsSchema,
  matrixCorpusRawIdempotencyKeySchema,
  matrixCorpusRawTransportMessageIdSchema,
  quiesceRunCommandSchema,
  quiesceRunInputSchema,
  releaseRunCommandSchema,
  releaseRunInputSchema,
  renewIngestOutboxClaimInputSchema,
  renewLeaseCommandSchema,
  renewLeaseInputSchema,
  renewTerminalControlOutboxClaimInputSchema,
} from '../../../domain/matrixCorpus/types.js';
import type {
  AcquireProvisioningLeaseCommand,
  AcknowledgeIngestOutboxInput,
  AcknowledgeTerminalControlInput,
  AbandonExpiredRunCommand,
  AbandonPendingResult,
  ActivationResult,
  CapabilityConsumeResult,
  CapabilityIssueResult,
  ClaimPendingIngestOutboxInput,
  ClaimPendingTerminalControlOutboxInput,
  ClaimRenewResult,
  CleanupExactRunCommand,
  CleanupResult,
  ConsumeCapabilityAndEnqueueIngestCommand,
  ConsumeCapabilityAndEnqueueIngestInput,
  GetTransportStatusCommand,
  IngestClaimResult,
  LeaseRenewResult,
  MatrixCorpusControlDependencies,
  MatrixCorpusCapabilityIssuanceReceiptV1,
  MatrixCorpusCurrentLeaseHistoryPairV1,
  MatrixCorpusDigestDomain,
  MatrixCorpusIngestOutboxRecordV1,
  MatrixCorpusLeaseHistoryV1,
  MatrixCorpusLeaseV1,
  MatrixSendProofResult,
  MatrixCorpusPersistedReplayProjectionV1,
  MatrixCorpusTerminalControlOutboxRecordV1,
  MatrixCorpusTransportReceiptV1,
  ProvisioningLeaseResult,
  QuiesceRunCommand,
  QuiesceResult,
  ReleaseResult,
  ReleaseRunCommand,
  RenewIngestOutboxClaimInput,
  RenewTerminalControlOutboxClaimInput,
  TerminalClaimResult,
  TerminalControlAcknowledgementResult,
  TransportStatusResult,
} from '../../../domain/matrixCorpus/types.js';
import {
  type IntexAgentMatrixCorpusClient,
  type MatrixCorpusTerminalAuthoritativeWinnerV1,
  matrixCorpusControlStatusResultSchema,
  matrixCorpusCurrentAcceptanceResultSchema,
  matrixCorpusPostTerminalControlResultSchema,
  matrixCorpusTerminalAuthoritativeWinnerV1Schema,
} from '../../../domain/matrixCorpus/ports/intexAgentMatrixCorpusClient.js';

const digest = 'a'.repeat(64);
const defaultIngestReceiptId = `imc_ingest_receipt_v1_${digest}`;
const defaultIngestOutboxId = `imc_ingest_outbox_v1_${digest}`;
const safeId = 'run_1';
const timestamp = '2026-07-20T00:00:00.000Z';
const profile: StrictToolMockProfileV1 = {
  version: 1,
  calls: [],
  forbiddenSelections: [],
  unexpectedKnownToolPolicy: 'behavioral_failure_no_execution',
};
const validAcquireInput = {
  runtimeAudience: 'hetzner-prod' as const,
  runId: safeId,
  userId: 'user_1',
  matrixRoomBindingDigest: digest,
  whatsappAccountBindingDigest: digest,
  whatsappSenderBindingDigest: digest,
  idempotencyKey: 'idempotency-key-0001',
};
const validControlInput = {
  runtimeAudience: 'hetzner-prod' as const,
  runId: safeId,
  userId: 'user_1',
  leaseFence: '1',
  idempotencyKey: 'idempotency-key-0001',
};
const validIssueInput = {
  version: 1 as const,
  runtimeAudience: 'hetzner-prod' as const,
  runId: safeId,
  leaseFence: '1',
  userId: 'user_1',
  scenarioId: 'scenario_1',
  scenarioNumber: 1,
  scenarioLabel: 'Scenario one',
  matrixRoomBindingDigest: digest,
  whatsappAccountBindingDigest: digest,
  whatsappSenderBindingDigest: digest,
  matrixIdempotencyKeyDigest: digest,
  promptNormalizationVersion: 1 as const,
  promptDigest: digest,
  phase: 'start' as const,
  turnIndex: 0,
  expectedSessionId: null,
  pendingConfirmationId: null,
  expectedDecision: null,
  mockProfile: profile,
  mockProfileDigest: digest,
  expectedToolSchedule: [],
  currentDateTime: timestamp,
  timeZone: 'Europe/Warsaw',
  rawCapability: 'imc1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
};
const acquiredProjection = {
  code: 'ACQUIRED',
  runId: safeId,
  leaseFence: '1',
  phase: 'provisioning',
  acquiredAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies ProvisioningLeaseResult;
const alreadyAcquiredProjection = {
  code: 'ALREADY_APPLIED',
  operation: 'acquire',
  result: 'acquired',
  runId: safeId,
  leaseFence: '1',
  phase: 'provisioning',
  acquiredAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies ProvisioningLeaseResult;
const activatedProjection = {
  code: 'ACTIVATED',
  runId: safeId,
  leaseFence: '1',
  phase: 'active',
  activatedAt: timestamp,
} as const satisfies ActivationResult;
const alreadyActivatedProjection = {
  code: 'ALREADY_APPLIED',
  operation: 'activate',
  result: 'activated',
  runId: safeId,
  leaseFence: '1',
  phase: 'active',
  activatedAt: timestamp,
} as const satisfies ActivationResult;
const renewedProjection = {
  code: 'LEASE_RENEWED',
  runId: safeId,
  leaseFence: '1',
  phase: 'active',
  renewedAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies LeaseRenewResult;
const alreadyRenewedProjection = {
  code: 'ALREADY_APPLIED',
  operation: 'renew',
  result: 'renewed',
  runId: safeId,
  leaseFence: '1',
  phase: 'active',
  renewedAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies LeaseRenewResult;
const issuedProjection = {
  code: 'CAPABILITY_ISSUED',
  runId: safeId,
  scenarioId: 'scenario_1',
  phase: 'start',
  turnIndex: 0,
  issuedAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies CapabilityIssueResult;
const alreadyIssuedProjection = {
  code: 'ALREADY_APPLIED',
  operation: 'issue',
  result: 'issued',
  runId: safeId,
  scenarioId: 'scenario_1',
  phase: 'start',
  turnIndex: 0,
  issuedAt: timestamp,
  expiresAt: '2026-07-20T00:01:00.000Z',
} as const satisfies CapabilityIssueResult;
const attestedPayload: MatrixCorpusAttestedIngestPayloadV1 = {
  version: 1,
  kind: 'matrix_corpus_ingest_payload',
  ordinaryIngest: {
    type: 'intex.message.ingest',
    userId: 'user_1',
    messageId: 'message_1',
    text: 'private natural text',
    sourceType: 'whatsapp_text',
    timestamp,
  },
  context: {
    version: 1,
    kind: 'matrix_corpus',
    runtimeAudience: 'hetzner-prod',
    leaseFence: '1',
    ingestReceiptId: 'receipt_1',
    runId: safeId,
    scenarioId: 'scenario_1',
    scenarioNumber: 1,
    scenarioLabel: 'Scenario one',
    turnIndex: 0,
    phase: 'start',
    startNewSession: true,
    promptNormalizationVersion: 1,
    promptDigest: digest,
    expectedSessionId: null,
    pendingConfirmationId: null,
    expectedDecision: null,
    mockProfile: profile,
    mockProfileDigest: digest,
    expectedToolSchedule: [],
    currentDateTime: timestamp,
    timeZone: 'Europe/Warsaw',
  },
};
const validConsumeInput: ConsumeCapabilityAndEnqueueIngestInput = {
  rawCapability: validIssueInput.rawCapability,
  transportMessageId: 'transport:1',
  facts: {
    version: 1,
    ingressRequest: {
      version: 1,
      capabilityDigest: digest,
      transportMessageIdDigest: digest,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      parsedIngress: {
        version: 1,
        phase: 'start',
        scenarioNumber: 1,
        scenarioTotal: 20,
        turnIndex: null,
        turnTotal: null,
        startNewSession: true,
      },
      promptDigest: digest,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      ordinaryMessageId: 'message_1',
      ordinaryTimestamp: timestamp,
      ingestReceiptId: defaultIngestReceiptId,
      payloadDigest: digest,
      ingestOutboxId: defaultIngestOutboxId,
    },
    ingressRequestDigest: digest,
    payload: {
      ...attestedPayload,
      context: { ...attestedPayload.context, ingestReceiptId: defaultIngestReceiptId },
    },
  },
};
const abandonedTerminalControl = {
  version: 1,
  kind: 'abandoned',
  eventId: 'event_1',
  runId: safeId,
  userId: 'user_1',
  leaseFence: '1',
  createdAt: timestamp,
  tombstoneDigest: null,
  terminalCandidateDigest: null,
  artifactStageDigest: null,
} as const;

type MatrixCorpusReplayProjectionEvidence<
  Projection extends MatrixCorpusPersistedReplayProjectionV1 = MatrixCorpusPersistedReplayProjectionV1,
> = Projection extends MatrixCorpusPersistedReplayProjectionV1
  ? Readonly<Pick<Projection, 'operation' | 'result'>>
  : never;

function safeReplayProjectionEvidence(
  projection: MatrixCorpusPersistedReplayProjectionV1
): MatrixCorpusReplayProjectionEvidence {
  if (projection.operation === 'acquire') return { operation: 'acquire', result: 'acquired' };
  if (projection.operation === 'activate') return { operation: 'activate', result: 'activated' };
  if (projection.operation === 'renew') return { operation: 'renew', result: 'renewed' };
  if (projection.operation === 'issue') return { operation: 'issue', result: 'issued' };
  if (projection.operation === 'quiesce') return { operation: 'quiesce', result: 'quiesced' };
  if (projection.operation === 'release') return { operation: 'release', result: 'release_pending' };
  return { operation: 'abandon', result: 'abandon_pending' };
}

type RepositoryBehavior = 'valid' | 'throw' | 'malformed';
type RepositorySpyOptions = Readonly<{
  acquire?: RepositoryBehavior;
  activate?: RepositoryBehavior;
  renew?: RepositoryBehavior;
  issue?: RepositoryBehavior;
  consume?: RepositoryBehavior;
  acquireResult?: ProvisioningLeaseResult;
  activateResult?: ActivationResult;
  renewResult?: LeaseRenewResult;
  issueResult?: CapabilityIssueResult;
  consumeResult?: CapabilityConsumeResult;
}>;

function repositoryResult<T>(behavior: RepositoryBehavior | undefined, validResult: T): T {
  if (behavior === 'throw') throw new Error('Repository unavailable');
  if (behavior === 'malformed') return JSON.parse('{"unsafe":true}');
  return validResult;
}

async function getTurnTerminalNotReady(): Promise<{ readonly kind: 'not_ready' }> {
  return { kind: 'not_ready' };
}

function createRepositorySpy(options: RepositorySpyOptions = {}): Readonly<{
  repository: MatrixCorpusRepository;
  acquireCommands: AcquireProvisioningLeaseCommand[];
  activateCommands: import('../../../domain/matrixCorpus/types.js').ActivateRunCommand[];
  renewCommands: import('../../../domain/matrixCorpus/types.js').RenewLeaseCommand[];
  issueCommands: import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand[];
  consumeCommands: ConsumeCapabilityAndEnqueueIngestCommand[];
}> {
  const acquireCommands: AcquireProvisioningLeaseCommand[] = [];
  const activateCommands: import('../../../domain/matrixCorpus/types.js').ActivateRunCommand[] = [];
  const renewCommands: import('../../../domain/matrixCorpus/types.js').RenewLeaseCommand[] = [];
  const issueCommands: import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand[] = [];
  const consumeCommands: ConsumeCapabilityAndEnqueueIngestCommand[] = [];
  const acquireResult: ProvisioningLeaseResult = {
    code: 'ACQUIRED',
    runId: safeId,
    leaseFence: '1',
    phase: 'provisioning',
    acquiredAt: timestamp,
    expiresAt: '2026-07-20T00:01:00.000Z',
  };
  const repository: MatrixCorpusRepository = {
    async acquireProvisioningLease(input): Promise<ProvisioningLeaseResult> {
      acquireCommands.push(input);
      return repositoryResult(options.acquire, options.acquireResult ?? acquireResult);
    },
    async activateRun(input): Promise<ActivationResult> {
      activateCommands.push(input);
      return repositoryResult(options.activate, options.activateResult ?? { code: 'NOT_FOUND' });
    },
    async renewLease(input): Promise<LeaseRenewResult> {
      renewCommands.push(input);
      return repositoryResult(options.renew, options.renewResult ?? { code: 'NOT_FOUND' });
    },
    async issueCapability(input): Promise<CapabilityIssueResult> {
      issueCommands.push(input);
      return repositoryResult(options.issue, options.issueResult ?? { code: 'NOT_FOUND' });
    },
    async recordMatrixSendProof(): Promise<MatrixSendProofResult> {
      return { code: 'NOT_FOUND' };
    },
    async consumeCapabilityAndEnqueueIngest(input): Promise<CapabilityConsumeResult> {
      consumeCommands.push(input);
      return repositoryResult(options.consume, options.consumeResult ?? { code: 'NOT_FOUND' });
    },
    async quiesceRun(): Promise<QuiesceResult> {
      return { code: 'NOT_FOUND' };
    },
    async releaseRun(): Promise<ReleaseResult> {
      return { code: 'NOT_FOUND' };
    },
    async abandonExpiredRun(): Promise<import('../../../domain/matrixCorpus/types.js').AbandonPendingResult> {
      return { code: 'NOT_FOUND' };
    },
    async getTransportStatus(): Promise<TransportStatusResult> {
      return { code: 'NOT_FOUND' };
    },
    async cleanupExactRun(): Promise<CleanupResult> {
      return { code: 'NOT_FOUND' };
    },
    async claimPendingIngestOutbox(): Promise<IngestClaimResult> {
      return { code: 'NOT_FOUND' };
    },
    async renewIngestOutboxClaim(): Promise<ClaimRenewResult> {
      return { code: 'NOT_FOUND' };
    },
    async acknowledgeIngestOutbox(): Promise<import('../../../domain/matrixCorpus/types.js').AcknowledgeResult> {
      return { code: 'NOT_FOUND' };
    },
    async claimPendingTerminalControlOutbox(): Promise<TerminalClaimResult> {
      return { code: 'NOT_FOUND' };
    },
    async renewTerminalControlOutboxClaim(): Promise<ClaimRenewResult> {
      return { code: 'NOT_FOUND' };
    },
    async acknowledgeTerminalControl(): Promise<TerminalControlAcknowledgementResult> {
      return { code: 'NOT_FOUND' };
    },
  };
  return { repository, acquireCommands, activateCommands, renewCommands, issueCommands, consumeCommands };
}

function createIntexAgentSpy(): Readonly<{
  client: IntexAgentMatrixCorpusClient;
  acceptanceInputs: Readonly<{ runtimeAudience: 'hetzner-prod'; userId: string }>[];
  controlStatusInputs: Readonly<{ runtimeAudience: 'hetzner-prod'; runId: string; userId: string; leaseFence: string }>[];
  postTerminalControlCalls(): number;
}> {
  const acceptanceInputs: Readonly<{ runtimeAudience: 'hetzner-prod'; userId: string }>[] = [];
  const controlStatusInputs: Readonly<{ runtimeAudience: 'hetzner-prod'; runId: string; userId: string; leaseFence: string }>[] = [];
  let postTerminalControlCalls = 0;
  const client: IntexAgentMatrixCorpusClient = {
    async getCurrentAcceptance(input) {
      acceptanceInputs.push(input);
      return { kind: 'admission_ready', current: 'absent' };
    },
    async getControlStatus(input) {
      controlStatusInputs.push(input);
      return {
        kind: 'status',
        runId: input.runId,
        userId: input.userId,
        leaseFence: input.leaseFence,
        lifecycle: 'preflight',
        contextReady: true,
        manifestReady: true,
        preflightProjectionReady: true,
        retentionReconciled: true,
        contextFinalizationTombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      };
    },
    async postTerminalControl() {
      postTerminalControlCalls += 1;
      return { kind: 'not_ready' };
    },
    getTurnTerminal: getTurnTerminalNotReady,
  };
  return {
    client,
    acceptanceInputs,
    controlStatusInputs,
    postTerminalControlCalls: () => postTerminalControlCalls,
  };
}

function createStaticLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
}

type CapturedLoggerRecord = Parameters<Logger['error']>[0];

function createCapturingLogger(): Readonly<{ logger: Logger; records: CapturedLoggerRecord[] }> {
  const records: CapturedLoggerRecord[] = [];
  return {
    records,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: (record) => {
        records.push(record);
      },
      debug: () => undefined,
    },
  };
}

type ExpectedDigestCall = Readonly<{
  domain: MatrixCorpusDigestDomain;
  parts: readonly string[];
  output: string;
}>;

function createExpectedDigestQueue(expectedCalls: readonly ExpectedDigestCall[]): Readonly<{
  digest: MatrixCorpusControlDependencies['digests'];
  remaining(): number;
}> {
  const queue = [...expectedCalls];
  return {
    digest: {
      digest(domain, parts) {
        const expectedCall = queue.shift();
        const matches =
          expectedCall !== undefined &&
          expectedCall.domain === domain &&
          expectedCall.parts.length === parts.length &&
          expectedCall.parts.every((part, index) => part === parts[index]);
        if (!matches || expectedCall === undefined) throw new Error('Unexpected keyed digest call');
        return expectedCall.output;
      },
    },
    remaining: () => queue.length,
  };
}

type ExpectedShaCall = Readonly<{ canonicalJson: string; output: string }>;

function createExpectedShaQueue(expectedCalls: readonly ExpectedShaCall[]): Readonly<{
  sha256: MatrixCorpusControlDependencies['sha256'];
  remaining(): number;
}> {
  const queue = [...expectedCalls];
  return {
    sha256: {
      digestCanonical(canonicalJson) {
        const expectedCall = queue.shift();
        if (expectedCall === undefined || expectedCall.canonicalJson !== canonicalJson)
          throw new Error('Unexpected SHA digest call');
        return expectedCall.output;
      },
    },
    remaining: () => queue.length,
  };
}

function createControlDependencies(input: Readonly<{
  repository: MatrixCorpusRepository;
  intexAgent: IntexAgentMatrixCorpusClient;
  digests?: MatrixCorpusControlDependencies['digests'];
  sha256?: MatrixCorpusControlDependencies['sha256'];
  ids?: MatrixCorpusControlDependencies['ids'];
  clockNow?: () => string;
  logger?: Logger;
  leaseTtlMs?: number;
  capabilityTtlMs?: number;
}>): MatrixCorpusControlDependencies {
  return {
    repository: input.repository,
    clock: { now: input.clockNow ?? (() => timestamp) },
    digests: input.digests ?? { digest: () => digest },
    sha256: input.sha256 ?? { digestCanonical: () => digest },
    ids: input.ids ?? {
      ingestReceiptId: () => 'receipt_1',
      ingestOutboxId: () => 'outbox_1',
    },
    intexAgent: input.intexAgent,
    logger: input.logger ?? createStaticLogger(),
    leaseTtlMs: input.leaseTtlMs ?? 60_000,
    capabilityTtlMs: input.capabilityTtlMs ?? 60_000,
  };
}

type FacadeOperation = 'acquire' | 'activate' | 'renew' | 'issue';

function repositoryBehaviorFor(
  operation: FacadeOperation,
  behavior: RepositoryBehavior
): RepositorySpyOptions {
  if (operation === 'acquire') return { acquire: behavior };
  if (operation === 'activate') return { activate: behavior };
  if (operation === 'renew') return { renew: behavior };
  return { issue: behavior };
}

function repositoryInvocationCount(
  repositorySpy: ReturnType<typeof createRepositorySpy>,
  operation: FacadeOperation
): number {
  if (operation === 'acquire') return repositorySpy.acquireCommands.length;
  if (operation === 'activate') return repositorySpy.activateCommands.length;
  if (operation === 'renew') return repositorySpy.renewCommands.length;
  return repositorySpy.issueCommands.length;
}

async function invokeValidFacade(
  controlPlane: MatrixCorpusControlPlane,
  operation: FacadeOperation
): Promise<ProvisioningLeaseResult | ActivationResult | LeaseRenewResult | CapabilityIssueResult> {
  if (operation === 'acquire') return await controlPlane.acquireProvisioningLease(validAcquireInput);
  if (operation === 'activate') return await controlPlane.activateRun(validControlInput);
  if (operation === 'renew') return await controlPlane.renewLease(validControlInput);
  return await controlPlane.issueCapability(validIssueInput);
}

function createDeferred<T>(): Readonly<{ promise: Promise<T>; resolve(value: T): void }> {
  let resolver: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolver === undefined) throw new Error('Deferred resolver unavailable');
      resolver(value);
    },
  };
}

describe('Matrix corpus A2 frozen contracts', () => {
  it('accepts only bounded ephemeral input values', () => {
    expect(matrixCorpusRawIdempotencyKeySchema.safeParse('idempotency-key-0001').success).toBe(true);
    expect(matrixCorpusRawIdempotencyKeySchema.safeParse('too short').success).toBe(false);
    expect(matrixCorpusRawTransportMessageIdSchema.safeParse('transport:1').success).toBe(true);
    expect(matrixCorpusRawTransportMessageIdSchema.safeParse('line\nbreak').success).toBe(false);
    expect(matrixCorpusLeaseTtlMsSchema.safeParse(300_000).success).toBe(true);
    expect(matrixCorpusLeaseTtlMsSchema.safeParse(0).success).toBe(false);
    expect(matrixCorpusCapabilityTtlMsSchema.safeParse(300_001).success).toBe(false);
  });

  it('keeps public control inputs strict and free of derived authority', () => {
    const acquire = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      idempotencyKey: 'idempotency-key-0001',
    };
    expect(acquireProvisioningLeaseInputSchema.safeParse(acquire).success).toBe(true);
    expect(acquireProvisioningLeaseInputSchema.safeParse({ ...acquire, leaseFence: '1' }).success).toBe(
      false
    );
    expect(
      activateRunInputSchema.safeParse({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        idempotencyKey: 'idempotency-key-0001',
      }).success
    ).toBe(true);
    expect(
      renewLeaseInputSchema.safeParse({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        idempotencyKey: 'idempotency-key-0001',
      }).success
    ).toBe(true);
    expect(
      quiesceRunInputSchema.safeParse({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        idempotencyKey: 'idempotency-key-0001',
      }).success
    ).toBe(true);
    expect(
      releaseRunInputSchema.safeParse({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        idempotencyKey: 'idempotency-key-0001',
        contextFinalizationTombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      }).success
    ).toBe(true);
    expect(
      getTransportStatusInputSchema.safeParse({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
      }).success
    ).toBe(true);
    expect(
      consumeCapabilityAndEnqueueIngestInputSchema.safeParse({
        rawCapability: 'imc1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
        transportMessageId: 'transport:1',
        facts: {},
      }).success
    ).toBe(false);
  });

  it('exposes every strict repository command boundary', () => {
    const schemas = [
      acquireProvisioningLeaseCommandSchema,
      activateRunCommandSchema,
      renewLeaseCommandSchema,
      issueCapabilityCommandSchema,
      consumeCapabilityAndEnqueueIngestCommandSchema,
      quiesceRunCommandSchema,
      releaseRunCommandSchema,
      abandonExpiredRunCommandSchema,
      getTransportStatusCommandSchema,
      cleanupExactRunCommandSchema,
      claimPendingIngestOutboxInputSchema,
      renewIngestOutboxClaimInputSchema,
      acknowledgeIngestOutboxInputSchema,
      claimPendingTerminalControlOutboxInputSchema,
      renewTerminalControlOutboxClaimInputSchema,
      acknowledgeTerminalControlInputSchema,
    ];

    for (const schema of schemas) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it('rejects command and result records with cross-correlated immutable identities', () => {
    const consumeCommand = {
      now: timestamp,
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      capabilityDigest: digest,
      transportMessageIdDigest: digest,
      ingestReceiptId: defaultIngestReceiptId,
      ingestOutboxId: defaultIngestOutboxId,
      facts: validConsumeInput.facts,
      payloadDigest: digest,
      ingressRequestDigest: digest,
    };
    expect(consumeCapabilityAndEnqueueIngestCommandSchema.safeParse(consumeCommand).success).toBe(
      true
    );
    expect(
      consumeCapabilityAndEnqueueIngestCommandSchema.safeParse({
        ...consumeCommand,
        capabilityDigest: 'b'.repeat(64),
      }).success
    ).toBe(false);

    const commonClaim = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      ownerDigest: digest,
      now: timestamp,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      payloadDigest: digest,
    };
    expect(
      claimPendingTerminalControlOutboxInputSchema.safeParse({
        ...commonClaim,
        eventId: 'event_2',
        claimExpiresAt: '2026-07-20T00:05:00.000Z',
      }).success
    ).toBe(false);
    expect(
      renewTerminalControlOutboxClaimInputSchema.safeParse({
        ...commonClaim,
        eventId: 'event_2',
        expectedClaimExpiresAt: '2026-07-20T00:01:00.000Z',
        newClaimExpiresAt: '2026-07-20T00:05:00.000Z',
      }).success
    ).toBe(false);
    expect(
      acknowledgeTerminalControlInputSchema.safeParse({
        ...commonClaim,
        requestTerminalControlId: 'event_1',
        requestEventId: 'event_2',
        requestPayloadDigest: digest,
        expectedClaimExpiresAt: '2026-07-20T00:05:00.000Z',
        authoritativeWinner: {
          kind: 'abandoned',
          eventId: 'event_1',
          payloadDigest: digest,
          outcome: 'stopped_not_evaluated',
          acknowledgedAt: timestamp,
        },
      }).success
    ).toBe(false);

    const terminalClaim = {
      code: 'OUTBOX_CLAIMED' as const,
      outboxKind: 'terminal' as const,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: safeId,
      leaseFence: '1',
      ownerDigest: digest,
      claimExpiresAt: '2026-07-20T00:05:00.000Z',
      payload: abandonedTerminalControl,
      payloadDigest: digest,
    };
    expect(
      terminalClaimResultSchema.safeParse({ ...terminalClaim, terminalControlId: 'event_2' })
        .success
    ).toBe(false);
    expect(
      terminalClaimResultSchema.safeParse({
        ...terminalClaim,
        code: 'ALREADY_APPLIED',
        operation: 'claim_terminal',
        payload: { ...abandonedTerminalControl, runId: 'run_2' },
      }).success
    ).toBe(false);

    const cleanupProgressResult = {
      targetRunId: 'target_run_1',
      targetLeaseFence: '2',
      targetRunFenceDigest: digest,
      committedRevision: 63,
      remainingChildCount: 97,
      chunkCommittedAt: timestamp,
    };
    expect(
      cleanupResultSchema.safeParse({
        code: 'RUN_CLEANUP_PROGRESS',
        ...cleanupProgressResult,
      }).success
    ).toBe(false);
    expect(
      cleanupResultSchema.safeParse({
        code: 'ALREADY_APPLIED',
        operation: 'cleanup',
        result: 'progress',
        ...cleanupProgressResult,
      }).success
    ).toBe(false);
  });

  it('strictly correlates closed readiness and terminal winner outcomes', () => {
    expect(
      matrixCorpusCurrentAcceptanceResultSchema.safeParse({
        kind: 'admission_ready',
        current: 'absent',
      }).success
    ).toBe(true);
    expect(
      matrixCorpusCurrentAcceptanceResultSchema.safeParse({
        kind: 'admission_ready',
        current: 'absent',
        raw: 'forbidden',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusControlStatusResultSchema.safeParse({
        kind: 'status',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        lifecycle: 'finalizing',
        contextReady: true,
        manifestReady: true,
        preflightProjectionReady: true,
        retentionReconciled: true,
        contextFinalizationTombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      }).success
    ).toBe(true);
    const releaseWinner = {
      kind: 'release' as const,
      eventId: 'event_1',
      payloadDigest: digest,
      outcome: 'completed_passed' as const,
      acknowledgedAt: timestamp,
    };
    expect(matrixCorpusTerminalAuthoritativeWinnerV1Schema.safeParse(releaseWinner).success).toBe(true);
    expect(
      matrixCorpusTerminalAuthoritativeWinnerV1Schema.safeParse({
        ...releaseWinner,
        kind: 'abandoned',
      }).success
    ).toBe(false);
    expect(
      matrixCorpusPostTerminalControlResultSchema.safeParse({
        kind: 'acknowledged',
        runId: safeId,
        leaseFence: '1',
        requestEventId: 'event_1',
        requestPayloadDigest: digest,
        winner: releaseWinner,
      }).success
    ).toBe(true);
  });

  it('provides strict runtime schemas for every persisted and closed result group', () => {
    const persistedSchemas = [
      matrixCorpusOperationReceiptV1Schema,
      matrixCorpusRenewReceiptV1Schema,
      matrixCorpusCapabilityIssuanceReceiptV1Schema,
      matrixCorpusTerminalFailureReceiptRefV1Schema,
      matrixCorpusTransportReceiptV1Schema,
      matrixCorpusIngestOutboxRecordV1Schema,
      matrixCorpusTerminalControlOutboxRecordV1Schema,
      matrixCorpusCleanupChunkReceiptV1Schema,
      matrixCorpusCleanupProgressV1Schema,
      matrixCorpusLeaseV1Schema,
      matrixCorpusLeaseHistoryV1Schema,
    ];
    const resultSchemas = [
      provisioningLeaseResultSchema,
      activationResultSchema,
      leaseRenewResultSchema,
      capabilityIssueResultSchema,
      capabilityConsumeResultSchema,
      quiesceResultSchema,
      releaseResultSchema,
      abandonPendingResultSchema,
      transportStatusResultSchema,
      cleanupResultSchema,
      ingestClaimResultSchema,
      terminalClaimResultSchema,
      claimRenewResultSchema,
      acknowledgeResultSchema,
      terminalControlAcknowledgementResultSchema,
      matrixCorpusIngestAcknowledgementOutcomeSchema,
    ];

    for (const schema of [...persistedSchemas, ...resultSchemas]) {
      expect(schema.safeParse({}).success).toBe(false);
    }

    const projection = {
      operation: 'acquire' as const,
      result: 'acquired' as const,
      runId: safeId,
      leaseFence: '1',
      phase: 'provisioning' as const,
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:00:01.000Z',
    };
    expect(matrixCorpusPersistedReplayProjectionV1Schema.safeParse(projection).success).toBe(true);
    expect(
      matrixCorpusPersistedReplayProjectionV1Schema.safeParse({ ...projection, leaked: 'no' }).success
    ).toBe(false);
  });

  it('rejects an operation receipt whose code or projection belongs to another operation', () => {
    const projection = {
      operation: 'acquire' as const,
      result: 'acquired' as const,
      runId: safeId,
      leaseFence: '1',
      phase: 'provisioning' as const,
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:00:01.000Z',
    };
    const receipt = {
      version: 1 as const,
      operation: 'acquire' as const,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      resultCode: 'ACQUIRED' as const,
      replayProjection: projection,
      resultDigest: digest,
      recordedAt: timestamp,
    };
    expect(matrixCorpusOperationReceiptV1Schema.safeParse(receipt).success).toBe(true);
    expect(
      matrixCorpusOperationReceiptV1Schema.safeParse({
        ...receipt,
        resultCode: 'ACTIVATED',
      }).success
    ).toBe(false);
  });

  it('rejects unknown and cross-correlated command, record, and result fields', () => {
    const acquireCommand = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      now: timestamp,
      expiresAt: '2026-07-20T00:00:01.000Z',
      acquisitionReadiness: { kind: 'admission_ready' as const, current: 'absent' as const },
    };
    expect(acquireProvisioningLeaseCommandSchema.safeParse(acquireCommand).success).toBe(true);
    expect(
      acquireProvisioningLeaseCommandSchema.safeParse({ ...acquireCommand, ignored: true }).success
    ).toBe(false);

    const abandonCommand = {
      runtimeAudience: 'hetzner-prod' as const,
      observedRunId: safeId,
      observedUserId: 'user_1',
      observedLeaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      now: timestamp,
      terminalControlId: 'event_1',
      terminalControl: {
        version: 1 as const,
        kind: 'abandoned' as const,
        eventId: 'event_1',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        createdAt: timestamp,
        tombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      },
      terminalPayloadDigest: digest,
    };
    expect(abandonExpiredRunCommandSchema.safeParse(abandonCommand).success).toBe(true);
    expect(
      abandonExpiredRunCommandSchema.safeParse({ ...abandonCommand, terminalControlId: 'event_2' })
        .success
    ).toBe(false);

    const acquiredResult = {
      code: 'ACQUIRED' as const,
      runId: safeId,
      leaseFence: '1',
      phase: 'provisioning' as const,
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:00:01.000Z',
    };
    expect(provisioningLeaseResultSchema.safeParse(acquiredResult).success).toBe(true);
    expect(provisioningLeaseResultSchema.safeParse({ ...acquiredResult, unsafe: 'raw' }).success).toBe(
      false
    );
  });

  it('accepts strict terminal claim families and rejects unknown result fields', () => {
    const terminalClaim = {
      code: 'OUTBOX_CLAIMED' as const,
      outboxKind: 'terminal' as const,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: safeId,
      leaseFence: '1',
      ownerDigest: digest,
      claimExpiresAt: '2026-07-20T00:05:00.000Z',
      payload: abandonedTerminalControl,
      payloadDigest: digest,
    };
    expect(terminalClaimResultSchema.safeParse(terminalClaim).success).toBe(true);
    expect(terminalClaimResultSchema.safeParse({ ...terminalClaim, extra: true }).success).toBe(false);

    const terminalRenewal = {
      code: 'OUTBOX_CLAIM_RENEWED' as const,
      outboxKind: 'terminal' as const,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: safeId,
      leaseFence: '1',
      ownerDigest: digest,
      previousClaimExpiresAt: '2026-07-20T00:01:00.000Z',
      claimExpiresAt: '2026-07-20T00:05:00.000Z',
    };
    expect(claimRenewResultSchema.safeParse(terminalRenewal).success).toBe(true);
    expect(claimRenewResultSchema.safeParse({ ...terminalRenewal, extra: true }).success).toBe(false);

    const terminalAcknowledgement = {
      code: 'OUTBOX_ACKNOWLEDGED' as const,
      outboxKind: 'terminal' as const,
      requestTerminalControlId: 'event_1',
      requestEventId: 'event_1',
      runId: safeId,
      leaseFence: '1',
      requestPayloadDigest: digest,
      authoritativeWinner: {
        kind: 'release' as const,
        eventId: 'different_release_event',
        payloadDigest: digest,
        outcome: 'completed_passed' as const,
        acknowledgedAt: timestamp,
      },
      leasePhase: 'released' as const,
    };
    expect(terminalControlAcknowledgementResultSchema.safeParse(terminalAcknowledgement).success).toBe(
      true
    );
    expect(
      terminalControlAcknowledgementResultSchema.safeParse({ ...terminalAcknowledgement, extra: true })
        .success
    ).toBe(false);
    expect(
      terminalControlAcknowledgementResultSchema.safeParse({
        ...terminalAcknowledgement,
        leasePhase: 'abandoned' as const,
      }).success
    ).toBe(false);
  });

  it('correlates the immutable ingest outbox envelope with its payload', () => {
    const outbox = {
      version: 1 as const,
      ingestOutboxId: 'outbox_1',
      ingestReceiptId: 'receipt_1',
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      payload: attestedPayload,
      payloadDigest: digest,
      status: 'pending' as const,
      claim: null,
      publisherReceiptDigest: null,
      publishedAt: null,
      terminalMarker: null,
      closedReason: null,
      acknowledgementReceipts: [],
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: timestamp,
    };
    expect(matrixCorpusIngestOutboxRecordV1Schema.safeParse(outbox).success).toBe(true);
    expect(
      matrixCorpusIngestOutboxRecordV1Schema.safeParse({ ...outbox, ingestReceiptId: 'receipt_2' }).success
    ).toBe(false);
    expect(matrixCorpusIngestOutboxRecordV1Schema.safeParse({ ...outbox, runId: 'run_2' }).success).toBe(
      false
    );
    expect(matrixCorpusIngestOutboxRecordV1Schema.safeParse({ ...outbox, userId: 'user_2' }).success).toBe(
      false
    );
    expect(matrixCorpusIngestOutboxRecordV1Schema.safeParse({ ...outbox, leaseFence: '2' }).success).toBe(
      false
    );
    expect(
      matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...outbox,
        status: 'claimed' as const,
        claim: {
          ownerDigest: digest,
          purpose: 'publish' as const,
          claimedAt: timestamp,
          expiresAt: '2026-07-20T00:05:00.000Z',
        },
      }).success
    ).toBe(true);
    expect(
      matrixCorpusIngestOutboxRecordV1Schema.safeParse({
        ...outbox,
        status: 'claimed' as const,
        claim: {
          ownerDigest: digest,
          purpose: 'publish' as const,
          claimedAt: timestamp,
          expiresAt: '2026-07-20T00:05:00.001Z',
        },
      }).success
    ).toBe(false);
  });

  it('permits only closed cleanup replay receipts and a correlated fixed-kind cursor', () => {
    const cleanupProjection = {
      operation: 'cleanup' as const,
      result: 'progress' as const,
      targetRunId: 'old_run_1',
      targetLeaseFence: '2',
      targetRunFenceDigest: digest,
      committedRevision: 1,
      remainingChildCount: 1,
      chunkCommittedAt: timestamp,
    };
    const receipt = {
      version: 1 as const,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      expectedRevision: 0,
      committedRevision: 1,
      replayProjection: cleanupProjection,
      resultDigest: digest,
      recordedAt: timestamp,
    };
    expect(matrixCorpusCleanupChunkReceiptV1Schema.safeParse(receipt).success).toBe(true);
    const progress = {
      version: 1 as const,
      targetRunId: 'old_run_1',
      targetLeaseFence: '2',
      targetRunFenceDigest: digest,
      revision: 1,
      cursor: { kind: 'renew_receipt' as const, nextIndex: 0 },
      remaining: {
        renewReceiptIds: [digest],
        capabilityIssuanceReceiptIds: [],
        capabilityDigests: [],
        transportReceiptIds: [],
        ingestOutboxIds: [],
        terminalControlOutboxIds: [],
      },
      chunkReceipts: [receipt],
    };
    expect(matrixCorpusCleanupProgressV1Schema.safeParse(progress).success).toBe(true);
    expect(
      matrixCorpusCleanupProgressV1Schema.safeParse({
        ...progress,
        cursor: { kind: 'capability' as const, nextIndex: 0 },
      }).success
    ).toBe(false);
    expect(
      matrixCorpusCleanupProgressV1Schema.safeParse({
        ...progress,
        cursor: { kind: 'renew_receipt' as const, nextIndex: 1 },
      }).success
    ).toBe(false);
    const exactChildIds = Array.from(
      { length: 6_144 },
      (_, index) => index.toString(16).padStart(64, '0')
    );
    expect(
      matrixCorpusCleanupProgressV1Schema.safeParse({
        ...progress,
        cursor: { kind: 'capability' as const, nextIndex: 0 },
        remaining: {
          renewReceiptIds: [],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: exactChildIds,
          transportReceiptIds: [digest],
          ingestOutboxIds: [],
          terminalControlOutboxIds: [],
        },
        chunkReceipts: [],
      }).success
    ).toBe(false);
  });

  it('requires exact release readiness correlation while preserving not-ready replay proof', () => {
    const releaseCommand = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      now: timestamp,
      controlStatus: {
        kind: 'status' as const,
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        lifecycle: 'finalizing' as const,
        contextReady: true,
        manifestReady: true,
        preflightProjectionReady: true,
        retentionReconciled: true,
        contextFinalizationTombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      terminalControlId: 'event_1',
      terminalControl: {
        version: 1 as const,
        kind: 'release' as const,
        eventId: 'event_1',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        createdAt: timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      terminalPayloadDigest: digest,
    };
    expect(releaseRunCommandSchema.safeParse(releaseCommand).success).toBe(true);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        terminalControl: abandonedTerminalControl,
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, lifecycle: 'running' as const },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, runId: 'run_2' },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, userId: 'user_2' },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, leaseFence: '2' },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, contextFinalizationTombstoneDigest: null },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, terminalCandidateDigest: 'b'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { ...releaseCommand.controlStatus, artifactStageDigest: 'c'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        terminalControl: { ...releaseCommand.terminalControl, tombstoneDigest: 'b'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        terminalControl: { ...releaseCommand.terminalControl, terminalCandidateDigest: 'b'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        terminalControl: { ...releaseCommand.terminalControl, artifactStageDigest: 'b'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      releaseRunCommandSchema.safeParse({
        ...releaseCommand,
        controlStatus: { kind: 'not_ready' as const },
      }).success
    ).toBe(true);
  });

  it('requires exact activation status identity and every readiness proof without a release lifecycle rule', () => {
    const activationCommand = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      now: timestamp,
      controlStatus: {
        kind: 'status' as const,
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        lifecycle: 'preflight' as const,
        contextReady: true,
        manifestReady: true,
        preflightProjectionReady: true,
        retentionReconciled: true,
        contextFinalizationTombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      },
    };
    expect(activateRunCommandSchema.safeParse(activationCommand).success).toBe(true);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, runId: 'run_2' },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, userId: 'user_2' },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, leaseFence: '2' },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, contextReady: false },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, manifestReady: false },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, preflightProjectionReady: false },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, retentionReconciled: false },
      }).success
    ).toBe(false);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { ...activationCommand.controlStatus, lifecycle: 'running' as const },
      }).success
    ).toBe(true);
    expect(
      activateRunCommandSchema.safeParse({
        ...activationCommand,
        controlStatus: { kind: 'not_ready' as const },
      }).success
    ).toBe(true);
  });

  it('shares phase, drain, cleanup-bound, and claim-TTL invariants across lease records', () => {
    const lease = {
      version: 1 as const,
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      runFenceDigest: digest,
      phase: 'quiescing' as const,
      leaseFence: '1',
      fenceEpoch: '1',
      acquiredAt: timestamp,
      activatedAt: timestamp,
      renewedAt: timestamp,
      expiresAt: '2026-07-20T00:05:00.000Z',
      quiescedAt: timestamp,
      releasedAt: null,
      abandonedAt: null,
      operationReceipts: {
        acquire: {
          version: 1 as const,
          operation: 'acquire' as const,
          idempotencyKeyDigest: digest,
          canonicalRequestDigest: digest,
          resultCode: 'ACQUIRED' as const,
          replayProjection: {
            operation: 'acquire' as const,
            result: 'acquired' as const,
            runId: safeId,
            leaseFence: '1',
            phase: 'provisioning' as const,
            acquiredAt: timestamp,
            expiresAt: '2026-07-20T00:05:00.000Z',
          },
          resultDigest: digest,
          recordedAt: timestamp,
        },
        activate: {
          version: 1 as const,
          operation: 'activate' as const,
          idempotencyKeyDigest: digest,
          canonicalRequestDigest: digest,
          resultCode: 'ACTIVATED' as const,
          replayProjection: {
            operation: 'activate' as const,
            result: 'activated' as const,
            runId: safeId,
            leaseFence: '1',
            phase: 'active' as const,
            activatedAt: timestamp,
          },
          resultDigest: digest,
          recordedAt: timestamp,
        },
        quiesce: {
          version: 1 as const,
          operation: 'quiesce' as const,
          idempotencyKeyDigest: digest,
          canonicalRequestDigest: digest,
          resultCode: 'QUIESCED' as const,
          replayProjection: {
            operation: 'quiesce' as const,
            result: 'quiesced' as const,
            runId: safeId,
            leaseFence: '1',
            phase: 'quiescing' as const,
            quiescedAt: timestamp,
            drained: true,
          },
          resultDigest: digest,
          recordedAt: timestamp,
        },
        release: null,
      },
      renewReceiptIds: [],
      capabilityIssuanceReceiptIds: [],
      unconsumedCapability: null,
      capabilityDigests: [],
      terminalFailureReceiptRefs: [],
      nonterminalIngestOutboxIds: [],
      ingestOutboxIds: [],
      terminalControlOutboxIds: ['event_1'],
      transportReceiptIds: [],
      drain: {
        consumedCapabilityCount: 0,
        terminalIntexMarkerCount: 0,
        terminalOutboxCount: 0,
        replyOrDeliveryWorkInFlight: 0,
        drained: true,
      },
      terminalWinner: null,
      cleanupProgress: null,
      finalCleanupReceipt: null,
    };
    const history = { ...lease, leaseSlotDigest: digest };
    expect(matrixCorpusLeaseV1Schema.safeParse(lease).success).toBe(true);
    expect(matrixCorpusLeaseHistoryV1Schema.safeParse(history).success).toBe(true);
    const finalCleanupReceipt = {
      version: 1 as const,
      idempotencyKeyDigest: digest,
      canonicalRequestDigest: digest,
      expectedRevision: 0,
      committedRevision: 1,
      replayProjection: {
        operation: 'cleanup' as const,
        result: 'cleaned' as const,
        targetRunId: 'old_run_1',
        targetLeaseFence: '2',
        targetRunFenceDigest: 'b'.repeat(64),
        finalRevision: 1,
        cleanedAt: timestamp,
      },
      resultDigest: digest,
      recordedAt: timestamp,
    };
    const provisioningLease = {
      ...lease,
      phase: 'provisioning' as const,
      activatedAt: null,
      quiescedAt: null,
      operationReceipts: {
        acquire: lease.operationReceipts.acquire,
        activate: null,
        quiesce: null,
        release: null,
      },
      drain: { ...lease.drain, drained: false },
    };
    expect(matrixCorpusLeaseV1Schema.safeParse({ ...provisioningLease, finalCleanupReceipt }).success).toBe(true);
    const priorFinalCleanupReceipt = {
      ...finalCleanupReceipt,
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      replayProjection: {
        ...finalCleanupReceipt.replayProjection,
        targetRunId: 'old_run_2',
        targetLeaseFence: '3',
        targetRunFenceDigest: 'e'.repeat(64),
      },
    };
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...provisioningLease,
        priorFinalCleanupReceipts: [priorFinalCleanupReceipt],
        finalCleanupReceipt,
      }).success
    ).toBe(true);
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...provisioningLease,
        priorFinalCleanupReceipts: [finalCleanupReceipt],
        finalCleanupReceipt,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...provisioningLease,
        priorFinalCleanupReceipts: [priorFinalCleanupReceipt],
        finalCleanupReceipt: null,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...lease,
        priorFinalCleanupReceipts: [priorFinalCleanupReceipt],
        finalCleanupReceipt,
      }).success
    ).toBe(false);
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...provisioningLease,
        finalCleanupReceipt: {
          ...finalCleanupReceipt,
          replayProjection: {
            ...finalCleanupReceipt.replayProjection,
            result: 'progress' as const,
            committedRevision: 1,
            remainingChildCount: 0,
            chunkCommittedAt: timestamp,
          },
        },
      }).success
    ).toBe(false);
    expect(matrixCorpusLeaseV1Schema.safeParse({ ...lease, drain: { ...lease.drain, drained: false } }).success).toBe(
      false
    );
    expect(
      matrixCorpusLeaseHistoryV1Schema.safeParse({ ...history, phase: 'released' as const }).success
    ).toBe(false);
    const releasedLease = {
      ...lease,
      phase: 'released' as const,
      releasedAt: timestamp,
      drain: { ...lease.drain, drained: false },
      operationReceipts: {
        ...lease.operationReceipts,
        release: {
          version: 1 as const,
          operation: 'release' as const,
          idempotencyKeyDigest: digest,
          canonicalRequestDigest: digest,
          resultCode: 'RELEASE_PENDING' as const,
          replayProjection: {
            operation: 'release' as const,
            result: 'release_pending' as const,
            runId: safeId,
            leaseFence: '1',
            terminalControlId: 'event_1',
            eventId: 'event_1',
            createdAt: timestamp,
          },
          resultDigest: digest,
          recordedAt: timestamp,
        },
      },
      terminalWinner: {
        kind: 'release' as const,
        eventId: 'event_1',
        payloadDigest: digest,
        outcome: 'completed_passed' as const,
        acknowledgedAt: timestamp,
      },
    };
    expect(matrixCorpusLeaseV1Schema.safeParse(releasedLease).success).toBe(true);
    expect(
      matrixCorpusLeaseV1Schema.safeParse({
        ...releasedLease,
        terminalWinner: {
          kind: 'abandoned' as const,
          eventId: 'event_1',
          payloadDigest: digest,
          outcome: 'provisioning_noop' as const,
          acknowledgedAt: timestamp,
        },
      }).success
    ).toBe(false);

    const claimInput = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      ownerDigest: digest,
      now: timestamp,
      ingestOutboxId: 'outbox_1',
      payloadDigest: digest,
      purpose: 'publish' as const,
      claimExpiresAt: '2026-07-20T00:05:00.000Z',
    };
    expect(claimPendingIngestOutboxInputSchema.safeParse(claimInput).success).toBe(true);
    expect(
      claimPendingIngestOutboxInputSchema.safeParse({
        ...claimInput,
        claimExpiresAt: timestamp,
      }).success
    ).toBe(false);
    expect(
      claimPendingIngestOutboxInputSchema.safeParse({
        ...claimInput,
        claimExpiresAt: '2026-07-20T00:05:00.001Z',
      }).success
    ).toBe(false);
  });

  it('does not admit idempotency conflicts as capability-consume outcomes', () => {
    expect(capabilityIssueResultSchema.safeParse({ code: 'IDEMPOTENCY_CONFLICT' }).success).toBe(true);
    expect(capabilityConsumeResultSchema.safeParse({ code: 'IDEMPOTENCY_CONFLICT' }).success).toBe(
      false
    );
  });

  it('enforces zero, five-minute, and over-five-minute bounds on every claim family', () => {
    const common = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: digest,
      ownerDigest: digest,
      now: timestamp,
    };
    const fiveMinutes = '2026-07-20T00:05:00.000Z';
    const overFiveMinutes = '2026-07-20T00:05:00.001Z';
    const ingestClaim = {
      ...common,
      ingestOutboxId: 'outbox_1',
      payloadDigest: digest,
      purpose: 'publish' as const,
      claimExpiresAt: fiveMinutes,
    };
    expect(claimPendingIngestOutboxInputSchema.safeParse(ingestClaim).success).toBe(true);
    expect(
      claimPendingIngestOutboxInputSchema.safeParse({ ...ingestClaim, claimExpiresAt: timestamp }).success
    ).toBe(false);
    expect(
      claimPendingIngestOutboxInputSchema.safeParse({ ...ingestClaim, claimExpiresAt: overFiveMinutes })
        .success
    ).toBe(false);

    const ingestRenewal = {
      ...common,
      ingestOutboxId: 'outbox_1',
      payloadDigest: digest,
      purpose: 'publish' as const,
      expectedClaimExpiresAt: '2026-07-20T00:01:00.000Z',
      newClaimExpiresAt: fiveMinutes,
    };
    expect(renewIngestOutboxClaimInputSchema.safeParse(ingestRenewal).success).toBe(true);
    expect(
      renewIngestOutboxClaimInputSchema.safeParse({ ...ingestRenewal, expectedClaimExpiresAt: timestamp })
        .success
    ).toBe(true);
    expect(
      renewIngestOutboxClaimInputSchema.safeParse({ ...ingestRenewal, newClaimExpiresAt: overFiveMinutes })
        .success
    ).toBe(true);

    const ingestAcknowledgement = {
      ...common,
      ingestOutboxId: 'outbox_1',
      ingestReceiptId: 'receipt_1',
      payloadDigest: digest,
      claimPurpose: 'publish' as const,
      expectedClaimExpiresAt: fiveMinutes,
      outcome: {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest: digest,
        publishedAt: timestamp,
      },
    };
    expect(acknowledgeIngestOutboxInputSchema.safeParse(ingestAcknowledgement).success).toBe(true);
    expect(
      acknowledgeIngestOutboxInputSchema.safeParse({
        ...ingestAcknowledgement,
        expectedClaimExpiresAt: timestamp,
      }).success
    ).toBe(true);
    expect(
      acknowledgeIngestOutboxInputSchema.safeParse({
        ...ingestAcknowledgement,
        expectedClaimExpiresAt: overFiveMinutes,
      }).success
    ).toBe(true);

    const terminalClaim = {
      ...common,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      payloadDigest: digest,
      claimExpiresAt: fiveMinutes,
    };
    expect(claimPendingTerminalControlOutboxInputSchema.safeParse(terminalClaim).success).toBe(true);
    expect(
      claimPendingTerminalControlOutboxInputSchema.safeParse({ ...terminalClaim, claimExpiresAt: timestamp })
        .success
    ).toBe(false);
    expect(
      claimPendingTerminalControlOutboxInputSchema.safeParse({
        ...terminalClaim,
        claimExpiresAt: overFiveMinutes,
      }).success
    ).toBe(false);

    const terminalRenewal = {
      ...common,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      payloadDigest: digest,
      expectedClaimExpiresAt: '2026-07-20T00:01:00.000Z',
      newClaimExpiresAt: fiveMinutes,
    };
    expect(renewTerminalControlOutboxClaimInputSchema.safeParse(terminalRenewal).success).toBe(true);
    expect(
      renewTerminalControlOutboxClaimInputSchema.safeParse({
        ...terminalRenewal,
        expectedClaimExpiresAt: timestamp,
      }).success
    ).toBe(true);
    expect(
      renewTerminalControlOutboxClaimInputSchema.safeParse({
        ...terminalRenewal,
        newClaimExpiresAt: overFiveMinutes,
      }).success
    ).toBe(true);

    const terminalAcknowledgement = {
      ...common,
      requestTerminalControlId: 'event_1',
      requestEventId: 'event_1',
      requestPayloadDigest: digest,
      expectedClaimExpiresAt: fiveMinutes,
      authoritativeWinner: {
        kind: 'release' as const,
        eventId: 'different_release_event',
        payloadDigest: digest,
        outcome: 'completed_passed' as const,
        acknowledgedAt: timestamp,
      },
    };
    expect(acknowledgeTerminalControlInputSchema.safeParse(terminalAcknowledgement).success).toBe(true);
    expect(
      acknowledgeTerminalControlInputSchema.safeParse({
        ...terminalAcknowledgement,
        expectedClaimExpiresAt: timestamp,
      }).success
    ).toBe(true);
    expect(
      acknowledgeTerminalControlInputSchema.safeParse({
        ...terminalAcknowledgement,
        expectedClaimExpiresAt: overFiveMinutes,
      }).success
    ).toBe(true);
  });
});

describe('MatrixCorpusControlPlane facade', () => {
  it('ignores logger failures for invalid input and readiness or status outages', async () => {
    const repositorySpy = createRepositorySpy();
    let postTerminalControlCalls = 0;
    const intexAgent: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: getTurnTerminalNotReady,
      async getCurrentAcceptance() {
        throw new Error('readiness unavailable');
      },
      async getControlStatus() {
        throw new Error('status unavailable');
      },
      async postTerminalControl() {
        postTerminalControlCalls += 1;
        return { kind: 'not_ready' };
      },
    };
    const throwingLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger unavailable');
      },
      debug: () => undefined,
    };
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: { now: () => timestamp },
      digests: { digest: () => digest },
      sha256: { digestCanonical: () => digest },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent,
      logger: throwingLogger,
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const controlPlane = new MatrixCorpusControlPlane(dependencies);

    await expect(
      controlPlane.acquireProvisioningLease({
        runtimeAudience: 'hetzner-prod',
        runId: 'invalid id',
        userId: 'user_1',
        matrixRoomBindingDigest: digest,
        whatsappAccountBindingDigest: digest,
        whatsappSenderBindingDigest: digest,
        idempotencyKey: 'idempotency-key-0001',
      })
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
    await expect(
      controlPlane.acquireProvisioningLease({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        matrixRoomBindingDigest: digest,
        whatsappAccountBindingDigest: digest,
        whatsappSenderBindingDigest: digest,
        idempotencyKey: 'idempotency-key-0001',
      })
    ).resolves.toEqual(expect.objectContaining({ code: 'ACQUIRED' }));
    await expect(
      controlPlane.activateRun({
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        idempotencyKey: 'idempotency-key-0001',
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    expect(repositorySpy.acquireCommands).toHaveLength(1);
    expect(repositorySpy.activateCommands).toHaveLength(1);
    expect(repositorySpy.acquireCommands[0]?.acquisitionReadiness).toEqual({ kind: 'not_ready' });
    expect(repositorySpy.activateCommands[0]?.controlStatus).toEqual({ kind: 'not_ready' });
    expect(postTerminalControlCalls).toBe(0);
  });

  it('passes strict not-ready proofs to the repository for schema-invalid readiness and status', async () => {
    const repositorySpy = createRepositorySpy();
    const capturedLogger = createCapturingLogger();
    let postTerminalControlCalls = 0;
    const intexAgent: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: getTurnTerminalNotReady,
      async getCurrentAcceptance() {
        return JSON.parse('{"kind":"invalid","unsafe":"hidden"}');
      },
      async getControlStatus() {
        return JSON.parse('{"kind":"status","unsafe":"hidden"}');
      },
      async postTerminalControl() {
        postTerminalControlCalls += 1;
        return { kind: 'not_ready' };
      },
    };
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent,
        logger: capturedLogger.logger,
      })
    );

    await controlPlane.acquireProvisioningLease(validAcquireInput);
    await controlPlane.activateRun(validControlInput);

    expect(repositorySpy.acquireCommands).toHaveLength(1);
    expect(repositorySpy.acquireCommands[0]?.acquisitionReadiness).toEqual({ kind: 'not_ready' });
    expect(repositorySpy.activateCommands).toHaveLength(1);
    expect(repositorySpy.activateCommands[0]?.controlStatus).toEqual({ kind: 'not_ready' });
    expect(capturedLogger.records).toEqual([
      { operation: 'acquire', code: 'NOT_READY' },
      { operation: 'activate', code: 'NOT_READY' },
    ]);
    expect(JSON.stringify(capturedLogger.records)).not.toContain('hidden');
    expect(postTerminalControlCalls).toBe(0);
  });

  it.each(
    (['acquire', 'activate', 'renew', 'issue'] as const).flatMap((operation) =>
      (['throw', 'malformed'] as const).map((behavior) => ({ operation, behavior }))
    )
  )(
    'maps $operation repository $behavior to static repository corruption',
    async ({ operation, behavior }) => {
      const repositorySpy = createRepositorySpy(repositoryBehaviorFor(operation, behavior));
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await invokeValidFacade(controlPlane, operation);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(1);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      const serializedLogs = JSON.stringify(capturedLogger.records);
      expect(serializedLogs).not.toContain(validAcquireInput.idempotencyKey);
      expect(serializedLogs).not.toContain(validIssueInput.rawCapability);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    { projection: 'success', repositoryResult: { ...acquiredProjection, runId: 'run_other' } },
    {
      projection: 'already',
      repositoryResult: { ...alreadyAcquiredProjection, runId: 'run_other' },
    },
  ] as const)(
    'rejects schema-valid $projection acquire projection with a mismatched runId',
    async ({ repositoryResult }) => {
      expect(provisioningLeaseResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ acquireResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.acquireProvisioningLease(validAcquireInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.acquireCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([
        { operation: 'acquire', code: 'CORRUPT_STATE' },
      ]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    {
      projection: 'success',
      field: 'runId',
      repositoryResult: { ...activatedProjection, runId: 'run_other' },
    },
    {
      projection: 'success',
      field: 'leaseFence',
      repositoryResult: { ...activatedProjection, leaseFence: '2' },
    },
    {
      projection: 'already',
      field: 'runId',
      repositoryResult: { ...alreadyActivatedProjection, runId: 'run_other' },
    },
    {
      projection: 'already',
      field: 'leaseFence',
      repositoryResult: { ...alreadyActivatedProjection, leaseFence: '2' },
    },
  ] as const)(
    'rejects schema-valid $projection activate projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(activationResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ activateResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.activateRun(validControlInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.activateCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([
        { operation: 'activate', code: 'CORRUPT_STATE' },
      ]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    {
      projection: 'success',
      field: 'runId',
      repositoryResult: { ...renewedProjection, runId: 'run_other' },
    },
    {
      projection: 'success',
      field: 'leaseFence',
      repositoryResult: { ...renewedProjection, leaseFence: '2' },
    },
    {
      projection: 'already',
      field: 'runId',
      repositoryResult: { ...alreadyRenewedProjection, runId: 'run_other' },
    },
    {
      projection: 'already',
      field: 'leaseFence',
      repositoryResult: { ...alreadyRenewedProjection, leaseFence: '2' },
    },
  ] as const)(
    'rejects schema-valid $projection renew projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(leaseRenewResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ renewResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.renewLease(validControlInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.renewCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([{ operation: 'renew', code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    {
      projection: 'success',
      field: 'runId',
      repositoryResult: { ...issuedProjection, runId: 'run_other' },
    },
    {
      projection: 'success',
      field: 'scenarioId',
      repositoryResult: { ...issuedProjection, scenarioId: 'scenario_other' },
    },
    {
      projection: 'success',
      field: 'phase',
      repositoryResult: { ...issuedProjection, phase: 'turn' },
    },
    {
      projection: 'success',
      field: 'turnIndex',
      repositoryResult: { ...issuedProjection, turnIndex: 1 },
    },
    {
      projection: 'already',
      field: 'runId',
      repositoryResult: { ...alreadyIssuedProjection, runId: 'run_other' },
    },
    {
      projection: 'already',
      field: 'scenarioId',
      repositoryResult: { ...alreadyIssuedProjection, scenarioId: 'scenario_other' },
    },
    {
      projection: 'already',
      field: 'phase',
      repositoryResult: { ...alreadyIssuedProjection, phase: 'turn' },
    },
    {
      projection: 'already',
      field: 'turnIndex',
      repositoryResult: { ...alreadyIssuedProjection, turnIndex: 1 },
    },
  ] as const)(
    'rejects schema-valid $projection issue projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(capabilityIssueResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ issueResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.issueCapability(validIssueInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.issueCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([{ operation: 'issue', code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    {
      field: 'acquiredAt',
      repositoryResult: { ...acquiredProjection, acquiredAt: '2026-07-20T00:00:01.000Z' },
    },
    {
      field: 'expiresAt',
      repositoryResult: { ...acquiredProjection, expiresAt: '2026-07-20T00:02:00.000Z' },
    },
  ] as const)(
    'rejects schema-valid fresh acquire projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(provisioningLeaseResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ acquireResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.acquireProvisioningLease(validAcquireInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.acquireCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([
        { operation: 'acquire', code: 'CORRUPT_STATE' },
      ]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it('accepts an identity-correlated acquire replay with historical timestamps', async () => {
    const repositoryResult = {
      ...alreadyAcquiredProjection,
      acquiredAt: '2026-07-19T23:58:00.000Z',
      expiresAt: '2026-07-19T23:59:00.000Z',
    } as const;
    expect(provisioningLeaseResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createRepositorySpy({ acquireResult: repositoryResult });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    );

    const result = await controlPlane.acquireProvisioningLease(validAcquireInput);

    expect(result).toEqual(repositoryResult);
    expect(repositorySpy.acquireCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('passes through a static acquire failure after strict result parsing', async () => {
    const repositorySpy = createRepositorySpy({ acquireResult: { code: 'RUN_ALREADY_ACTIVE' } });
    const intexAgentSpy = createIntexAgentSpy();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
      })
    );

    await expect(controlPlane.acquireProvisioningLease(validAcquireInput)).resolves.toEqual({
      code: 'RUN_ALREADY_ACTIVE',
    });
    expect(repositorySpy.acquireCommands).toHaveLength(1);
  });

  it('marks an explicit provisioning abort in the repository command', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const abort = vi.spyOn(repositorySpy.repository, 'abandonExpiredRun');
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
      })
    );

    await expect(
      controlPlane.abortProvisioningRun({
        runtimeAudience: 'hetzner-prod',
        observedRunId: safeId,
        observedUserId: 'user_1',
        observedLeaseFence: '1',
      })
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'evaluator_abort' }));
  });

  it('rejects a schema-valid fresh activation projection with mismatched activatedAt', async () => {
    const repositoryResult = {
      ...activatedProjection,
      activatedAt: '2026-07-20T00:00:01.000Z',
    } as const;
    expect(activationResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createRepositorySpy({ activateResult: repositoryResult });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    );

    const result = await controlPlane.activateRun(validControlInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.activateCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([
      { operation: 'activate', code: 'CORRUPT_STATE' },
    ]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('accepts an identity-correlated activation replay with a historical timestamp', async () => {
    const repositoryResult = {
      ...alreadyActivatedProjection,
      activatedAt: '2026-07-19T23:58:00.000Z',
    } as const;
    expect(activationResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createRepositorySpy({ activateResult: repositoryResult });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    );

    const result = await controlPlane.activateRun(validControlInput);

    expect(result).toEqual(repositoryResult);
    expect(repositorySpy.activateCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    {
      field: 'renewedAt',
      repositoryResult: { ...renewedProjection, renewedAt: '2026-07-20T00:00:01.000Z' },
    },
    {
      field: 'expiresAt',
      repositoryResult: { ...renewedProjection, expiresAt: '2026-07-20T00:02:00.000Z' },
    },
  ] as const)(
    'rejects schema-valid fresh renewal projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(leaseRenewResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ renewResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.renewLease(validControlInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.renewCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([{ operation: 'renew', code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it('accepts an identity-correlated renewal replay with historical timestamps', async () => {
    const repositoryResult = {
      ...alreadyRenewedProjection,
      renewedAt: '2026-07-19T23:58:00.000Z',
      expiresAt: '2026-07-19T23:59:00.000Z',
    } as const;
    expect(leaseRenewResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createRepositorySpy({ renewResult: repositoryResult });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    );

    const result = await controlPlane.renewLease(validControlInput);

    expect(result).toEqual(repositoryResult);
    expect(repositorySpy.renewCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    {
      field: 'issuedAt',
      repositoryResult: { ...issuedProjection, issuedAt: '2026-07-20T00:00:01.000Z' },
    },
    {
      field: 'expiresAt',
      repositoryResult: { ...issuedProjection, expiresAt: '2026-07-20T00:02:00.000Z' },
    },
  ] as const)(
    'rejects schema-valid fresh capability projection with mismatched $field',
    async ({ repositoryResult }) => {
      expect(capabilityIssueResultSchema.safeParse(repositoryResult).success).toBe(true);
      const repositorySpy = createRepositorySpy({ issueResult: repositoryResult });
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      );

      const result = await controlPlane.issueCapability(validIssueInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
      expect(repositorySpy.issueCommands).toHaveLength(1);
      expect(capturedLogger.records).toEqual([{ operation: 'issue', code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it('accepts an identity-correlated capability replay with historical timestamps', async () => {
    const repositoryResult = {
      ...alreadyIssuedProjection,
      issuedAt: '2026-07-19T23:58:00.000Z',
      expiresAt: '2026-07-19T23:59:00.000Z',
    } as const;
    expect(capabilityIssueResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createRepositorySpy({ issueResult: repositoryResult });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    );

    const result = await controlPlane.issueCapability(validIssueInput);

    expect(result).toEqual(repositoryResult);
    expect(repositorySpy.issueCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it.each(['throw', 'invalid'] as const)(
    'maps issue $shaBehavior SHA output to command corruption without repository mutation',
    async (shaBehavior) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      let shaCalls = 0;
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          sha256: {
            digestCanonical: () => {
              shaCalls += 1;
              if (shaBehavior === 'throw') throw new Error('SHA unavailable');
              return 'invalid digest';
            },
          },
        })
      );

      const result = await controlPlane.issueCapability(validIssueInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(shaCalls).toBe(1);
      expect(repositorySpy.issueCommands).toHaveLength(0);
      expect(capturedLogger.records).toEqual([{ operation: 'issue', code: 'CORRUPT_STATE' }]);
      expect(JSON.stringify(capturedLogger.records)).not.toContain(validIssueInput.rawCapability);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    { operation: 'acquire' as const, leaseTtlMs: 0, capabilityTtlMs: 60_000 },
    { operation: 'renew' as const, leaseTtlMs: 300_001, capabilityTtlMs: 60_000 },
    { operation: 'issue' as const, leaseTtlMs: 60_000, capabilityTtlMs: 0 },
    { operation: 'issue' as const, leaseTtlMs: 60_000, capabilityTtlMs: 300_001 },
  ])(
    'rejects invalid service-owned TTL for $operation before repository mutation',
    async ({ operation, leaseTtlMs, capabilityTtlMs }) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          leaseTtlMs,
          capabilityTtlMs,
        })
      );

      const result = await invokeValidFacade(controlPlane, operation);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(0);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each(['acquire', 'renew', 'issue'] as const)(
    'maps $operation expiry beyond the RFC3339 year range to command corruption',
    async (operation) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          clockNow: () => '9999-12-31T23:59:59.999Z',
          leaseTtlMs: 60_000,
          capabilityTtlMs: 60_000,
        })
      );

      await expect(invokeValidFacade(controlPlane, operation)).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'command',
      });
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(0);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each(
    (['acquire', 'activate', 'renew', 'issue'] as const).flatMap((operation) =>
      (['throw', 'invalid'] as const).map((digestBehavior) => ({ operation, digestBehavior }))
    )
  )(
    'maps $operation $digestBehavior keyed digest output to command corruption',
    async ({ operation, digestBehavior }) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      let digestCalls = 0;
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          digests: {
            digest: () => {
              digestCalls += 1;
              if (digestBehavior === 'throw') throw new Error('Digest unavailable');
              return 'invalid digest';
            },
          },
        })
      );

      const result = await invokeValidFacade(controlPlane, operation);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(digestCalls).toBeGreaterThan(0);
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(0);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      const serializedLogs = JSON.stringify(capturedLogger.records);
      expect(serializedLogs).not.toContain(validAcquireInput.idempotencyKey);
      expect(serializedLogs).not.toContain(validIssueInput.rawCapability);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each(['acquire', 'activate', 'renew', 'issue'] as const)(
    'rejects invalid $operation input before clock, crypto, IDs, client, or repository',
    async (operation) => {
      const repositorySpy = createRepositorySpy();
      const capturedLogger = createCapturingLogger();
      const calls = { clock: 0, digest: 0, sha: 0, ids: 0, acceptance: 0, status: 0, terminal: 0 };
      const intexAgent: IntexAgentMatrixCorpusClient = {
        getTurnTerminal: getTurnTerminalNotReady,
        async getCurrentAcceptance() {
          calls.acceptance += 1;
          return { kind: 'admission_ready', current: 'absent' };
        },
        async getControlStatus(input) {
          calls.status += 1;
          return {
            kind: 'status',
            runId: input.runId,
            userId: input.userId,
            leaseFence: input.leaseFence,
            lifecycle: 'preflight',
            contextReady: true,
            manifestReady: true,
            preflightProjectionReady: true,
            retentionReconciled: true,
            contextFinalizationTombstoneDigest: null,
            terminalCandidateDigest: null,
            artifactStageDigest: null,
          };
        },
        async postTerminalControl() {
          calls.terminal += 1;
          return { kind: 'not_ready' };
        },
      };
      const controlPlane = new MatrixCorpusControlPlane({
        repository: repositorySpy.repository,
        clock: {
          now: () => {
            calls.clock += 1;
            return timestamp;
          },
        },
        digests: {
          digest: () => {
            calls.digest += 1;
            return digest;
          },
        },
        sha256: {
          digestCanonical: () => {
            calls.sha += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            calls.ids += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            calls.ids += 1;
            return 'outbox_1';
          },
        },
        intexAgent,
        logger: capturedLogger.logger,
        leaseTtlMs: 60_000,
        capabilityTtlMs: 60_000,
      });

      let result: unknown;
      if (operation === 'acquire')
        result = await controlPlane.acquireProvisioningLease({
          ...validAcquireInput,
          runId: 'invalid id',
        });
      else if (operation === 'activate')
        result = await controlPlane.activateRun({ ...validControlInput, runId: 'invalid id' });
      else if (operation === 'renew')
        result = await controlPlane.renewLease({ ...validControlInput, runId: 'invalid id' });
      else
        result = await controlPlane.issueCapability({
          ...validIssueInput,
          rawCapability: 'invalid',
        });

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
      expect(calls).toEqual({
        clock: 0,
        digest: 0,
        sha: 0,
        ids: 0,
        acceptance: 0,
        status: 0,
        terminal: 0,
      });
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(0);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    }
  );

  it.each(
    (['acquire', 'activate', 'renew', 'issue'] as const).flatMap((operation) =>
      (['throw', 'invalid'] as const).map((clockBehavior) => ({ operation, clockBehavior }))
    )
  )(
    'maps $operation $clockBehavior clock output to command corruption without repository mutation',
    async ({ operation, clockBehavior }) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      let clockCalls = 0;
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          clockNow: () => {
            clockCalls += 1;
            if (clockBehavior === 'throw') throw new Error('Clock unavailable');
            return 'invalid timestamp';
          },
        })
      );

      const result = await invokeValidFacade(controlPlane, operation);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(clockCalls).toBe(1);
      expect(repositoryInvocationCount(repositorySpy, operation)).toBe(0);
      expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it('samples acquire and activation time only after delayed readiness and status resolve', async () => {
    const repositorySpy = createRepositorySpy();
    const acceptance = { kind: 'admission_ready', current: 'absent' } as const;
    const status = {
      kind: 'status',
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      lifecycle: 'preflight',
      contextReady: true,
      manifestReady: true,
      preflightProjectionReady: true,
      retentionReconciled: true,
      contextFinalizationTombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    } as const;
    const acceptanceDeferred = createDeferred<typeof acceptance>();
    const statusDeferred = createDeferred<typeof status>();
    let currentTime = timestamp;
    let clockCalls = 0;
    let postTerminalControlCalls = 0;
    const intexAgent: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: getTurnTerminalNotReady,
      getCurrentAcceptance: () => acceptanceDeferred.promise,
      getControlStatus: () => statusDeferred.promise,
      async postTerminalControl() {
        postTerminalControlCalls += 1;
        return { kind: 'not_ready' };
      },
    };
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: {
        now: () => {
          clockCalls += 1;
          return currentTime;
        },
      },
      digests: { digest: () => digest },
      sha256: { digestCanonical: () => digest },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent,
      logger: createStaticLogger(),
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const controlPlane = new MatrixCorpusControlPlane(dependencies);

    const pendingAcquire = controlPlane.acquireProvisioningLease({
      runtimeAudience: 'hetzner-prod',
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      idempotencyKey: 'idempotency-key-0001',
    });
    expect(clockCalls).toBe(0);
    currentTime = '2026-07-20T00:02:00.000Z';
    acceptanceDeferred.resolve(acceptance);
    await pendingAcquire;

    expect(repositorySpy.acquireCommands[0]?.now).toBe('2026-07-20T00:02:00.000Z');
    expect(repositorySpy.acquireCommands[0]?.expiresAt).toBe('2026-07-20T00:03:00.000Z');

    const pendingActivation = controlPlane.activateRun({
      runtimeAudience: 'hetzner-prod',
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      idempotencyKey: 'idempotency-key-0001',
    });
    expect(clockCalls).toBe(1);
    currentTime = '2026-07-20T00:04:00.000Z';
    statusDeferred.resolve(status);
    await pendingActivation;

    expect(repositorySpy.activateCommands[0]?.now).toBe('2026-07-20T00:04:00.000Z');
    expect(clockCalls).toBe(2);
    expect(postTerminalControlCalls).toBe(0);
  });

  it('uses exact ordered digest parts and canonical JSON for all four facade methods', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const firstDigest = '1'.padStart(64, '0');
    const secondDigest = '2'.padStart(64, '0');
    const thirdDigest = '3'.padStart(64, '0');
    const fourthDigest = '4'.padStart(64, '0');
    let generatedIdCalls = 0;
    const ids: MatrixCorpusControlDependencies['ids'] = {
      ingestReceiptId: () => {
        generatedIdCalls += 1;
        return 'receipt_1';
      },
      ingestOutboxId: () => {
        generatedIdCalls += 1;
        return 'outbox_1';
      },
    };
    const acquireInput = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      idempotencyKey: 'idempotency-key-0001',
    };
    const acquireCanonicalJson = JSON.stringify({
      runtimeAudience: acquireInput.runtimeAudience,
      runId: acquireInput.runId,
      userId: acquireInput.userId,
      matrixRoomBindingDigest: acquireInput.matrixRoomBindingDigest,
      whatsappAccountBindingDigest: acquireInput.whatsappAccountBindingDigest,
      whatsappSenderBindingDigest: acquireInput.whatsappSenderBindingDigest,
    });
    const acquireDigests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: [acquireInput.runtimeAudience, acquireInput.userId],
        output: firstDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: [acquireInput.runtimeAudience, acquireInput.userId, acquireInput.runId],
        output: secondDigest,
      },
      {
        domain: 'imc-operation-idempotency-v1',
        parts: ['acquire', acquireInput.idempotencyKey],
        output: thirdDigest,
      },
      {
        domain: 'imc-operation-request-v1',
        parts: ['acquire', acquireCanonicalJson],
        output: fourthDigest,
      },
    ]);
    await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        digests: acquireDigests.digest,
        ids,
      })
    ).acquireProvisioningLease(acquireInput);
    expect(acquireDigests.remaining()).toBe(0);

    const controlInput = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      idempotencyKey: 'idempotency-key-0001',
    };
    const controlCanonicalJson = JSON.stringify({
      runtimeAudience: controlInput.runtimeAudience,
      runId: controlInput.runId,
      userId: controlInput.userId,
      leaseFence: controlInput.leaseFence,
    });
    for (const operation of ['activate', 'renew'] as const) {
      const operationDigests = createExpectedDigestQueue([
        {
          domain: 'imc-lease-slot-v1',
          parts: [controlInput.runtimeAudience, controlInput.userId],
          output: firstDigest,
        },
        {
          domain: 'imc-run-fence-v1',
          parts: [controlInput.runtimeAudience, controlInput.userId, controlInput.runId],
          output: secondDigest,
        },
        {
          domain: 'imc-operation-idempotency-v1',
          parts: [operation, controlInput.idempotencyKey],
          output: thirdDigest,
        },
        {
          domain: 'imc-operation-request-v1',
          parts: [operation, controlCanonicalJson],
          output: fourthDigest,
        },
      ]);
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          digests: operationDigests.digest,
          ids,
        })
      );
      if (operation === 'activate') await controlPlane.activateRun(controlInput);
      else await controlPlane.renewLease(controlInput);
      expect(operationDigests.remaining()).toBe(0);
    }

    const issueInput = {
      version: 1 as const,
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      leaseFence: '1',
      userId: 'user_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      matrixIdempotencyKeyDigest: digest,
      promptNormalizationVersion: 1 as const,
      promptDigest: digest,
      phase: 'start' as const,
      turnIndex: 0,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: profile,
      mockProfileDigest: digest,
      expectedToolSchedule: [],
      currentDateTime: timestamp,
      timeZone: 'Europe/Warsaw',
      rawCapability: 'imc1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
    };
    const issueDigests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: [issueInput.runtimeAudience, issueInput.userId],
        output: firstDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: [issueInput.runtimeAudience, issueInput.userId, issueInput.runId],
        output: secondDigest,
      },
      {
        domain: 'imc-capability-v1',
        parts: [issueInput.rawCapability],
        output: thirdDigest,
      },
    ]);
    const { rawCapability: _rawCapability, ...semanticIssueInput } = issueInput;
    const issueSha = createExpectedShaQueue([
      {
        canonicalJson: canonicalMatrixCorpusCapabilityIssueDigestInputV1({
          ...semanticIssueInput,
          capabilityDigest: thirdDigest,
        }),
        output: digest,
      },
    ]);
    await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        digests: issueDigests.digest,
        sha256: issueSha.sha256,
        ids,
      })
    ).issueCapability(issueInput);
    expect(issueDigests.remaining()).toBe(0);
    expect(issueSha.remaining()).toBe(0);
    expect(generatedIdCalls).toBe(0);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('builds a strict, ordered acquire command without passing raw idempotency material to the repository', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const digestDomains: MatrixCorpusDigestDomain[] = [];
    let clockCalls = 0;
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: {
        now: () => {
          clockCalls += 1;
          return timestamp;
        },
      },
      digests: {
        digest: (domain) => {
          digestDomains.push(domain);
          return digestDomains.length.toString(16).padStart(64, '0');
        },
      },
      sha256: {
        digestCanonical: () => digest,
      },
      ids: {
        ingestReceiptId: () => 'receipt_1',
        ingestOutboxId: () => 'outbox_1',
      },
      intexAgent: intexAgentSpy.client,
      logger: createStaticLogger(),
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const input = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      idempotencyKey: 'idempotency-key-0001',
    };

    const result = await new MatrixCorpusControlPlane(dependencies).acquireProvisioningLease(input);

    expect(result).toEqual({
      code: 'ACQUIRED',
      runId: safeId,
      leaseFence: '1',
      phase: 'provisioning',
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
    });
    expect(clockCalls).toBe(1);
    expect(intexAgentSpy.acceptanceInputs).toEqual([{ runtimeAudience: 'hetzner-prod', userId: 'user_1' }]);
    expect(digestDomains).toEqual([
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-operation-idempotency-v1',
      'imc-operation-request-v1',
    ]);
    expect(repositorySpy.acquireCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        matrixRoomBindingDigest: digest,
        whatsappAccountBindingDigest: digest,
        whatsappSenderBindingDigest: digest,
        leaseSlotDigest: '1'.padStart(64, '0'),
        runFenceDigest: '2'.padStart(64, '0'),
        idempotencyKeyDigest: '3'.padStart(64, '0'),
        canonicalRequestDigest: '4'.padStart(64, '0'),
        now: timestamp,
        expiresAt: '2026-07-20T00:01:00.000Z',
        acquisitionReadiness: { kind: 'admission_ready', current: 'absent' },
      },
    ]);
    expect(JSON.stringify(repositorySpy.acquireCommands)).not.toContain(input.idempotencyKey);
  });

  it('builds a strict activation command after receiving an exact control-status proof', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const digestDomains: MatrixCorpusDigestDomain[] = [];
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: { now: () => timestamp },
      digests: {
        digest: (domain) => {
          digestDomains.push(domain);
          return digestDomains.length.toString(16).padStart(64, '0');
        },
      },
      sha256: { digestCanonical: () => digest },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent: intexAgentSpy.client,
      logger: createStaticLogger(),
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const input = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      idempotencyKey: 'idempotency-key-0001',
    };

    const result = await new MatrixCorpusControlPlane(dependencies).activateRun(input);

    expect(result).toEqual({ code: 'NOT_FOUND' });
    expect(intexAgentSpy.controlStatusInputs).toEqual([
      { runtimeAudience: 'hetzner-prod', runId: safeId, userId: 'user_1', leaseFence: '1' },
    ]);
    expect(digestDomains).toEqual([
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-operation-idempotency-v1',
      'imc-operation-request-v1',
    ]);
    expect(repositorySpy.activateCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        leaseSlotDigest: '1'.padStart(64, '0'),
        runFenceDigest: '2'.padStart(64, '0'),
        idempotencyKeyDigest: '3'.padStart(64, '0'),
        canonicalRequestDigest: '4'.padStart(64, '0'),
        now: timestamp,
        controlStatus: {
          kind: 'status',
          runId: safeId,
          userId: 'user_1',
          leaseFence: '1',
          lifecycle: 'preflight',
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady: true,
          retentionReconciled: true,
          contextFinalizationTombstoneDigest: null,
          terminalCandidateDigest: null,
          artifactStageDigest: null,
        },
      },
    ]);
    expect(JSON.stringify(repositorySpy.activateCommands)).not.toContain(input.idempotencyKey);
  });

  it('builds a strict renewal command with a service-owned bounded lease expiry', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const digestDomains: MatrixCorpusDigestDomain[] = [];
    let clockCalls = 0;
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: {
        now: () => {
          clockCalls += 1;
          return timestamp;
        },
      },
      digests: {
        digest: (domain) => {
          digestDomains.push(domain);
          return digestDomains.length.toString(16).padStart(64, '0');
        },
      },
      sha256: { digestCanonical: () => digest },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent: intexAgentSpy.client,
      logger: createStaticLogger(),
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const input = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      idempotencyKey: 'idempotency-key-0001',
    };

    const result = await new MatrixCorpusControlPlane(dependencies).renewLease(input);

    expect(result).toEqual({ code: 'NOT_FOUND' });
    expect(clockCalls).toBe(1);
    expect(digestDomains).toEqual([
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-operation-idempotency-v1',
      'imc-operation-request-v1',
    ]);
    expect(repositorySpy.renewCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        leaseSlotDigest: '1'.padStart(64, '0'),
        runFenceDigest: '2'.padStart(64, '0'),
        idempotencyKeyDigest: '3'.padStart(64, '0'),
        canonicalRequestDigest: '4'.padStart(64, '0'),
        now: timestamp,
        expiresAt: '2026-07-20T00:01:00.000Z',
      },
    ]);
    expect(JSON.stringify(repositorySpy.renewCommands)).not.toContain(input.idempotencyKey);
  });

  it('builds a service-owned capability record without retaining the raw bearer in the repository command', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const digestDomains: MatrixCorpusDigestDomain[] = [];
    const canonicalInputs: string[] = [];
    let clockCalls = 0;
    const dependencies: MatrixCorpusControlDependencies = {
      repository: repositorySpy.repository,
      clock: {
        now: () => {
          clockCalls += 1;
          return timestamp;
        },
      },
      digests: {
        digest: (domain) => {
          digestDomains.push(domain);
          return digestDomains.length.toString(16).padStart(64, '0');
        },
      },
      sha256: {
        digestCanonical: (canonicalJson) => {
          canonicalInputs.push(canonicalJson);
          return digest;
        },
      },
      ids: { ingestReceiptId: () => 'receipt_1', ingestOutboxId: () => 'outbox_1' },
      intexAgent: intexAgentSpy.client,
      logger: createStaticLogger(),
      leaseTtlMs: 60_000,
      capabilityTtlMs: 60_000,
    };
    const input = {
      version: 1 as const,
      runtimeAudience: 'hetzner-prod' as const,
      runId: safeId,
      leaseFence: '1',
      userId: 'user_1',
      scenarioId: 'scenario_1',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario one',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      matrixIdempotencyKeyDigest: digest,
      promptNormalizationVersion: 1 as const,
      promptDigest: digest,
      phase: 'start' as const,
      turnIndex: 0,
      expectedSessionId: null,
      pendingConfirmationId: null,
      expectedDecision: null,
      mockProfile: profile,
      mockProfileDigest: digest,
      expectedToolSchedule: [],
      currentDateTime: timestamp,
      timeZone: 'Europe/Warsaw',
      rawCapability: 'imc1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
    };

    const result = await new MatrixCorpusControlPlane(dependencies).issueCapability(input);

    expect(result).toEqual({ code: 'NOT_FOUND' });
    expect(clockCalls).toBe(1);
    expect(digestDomains).toEqual(['imc-lease-slot-v1', 'imc-run-fence-v1', 'imc-capability-v1']);
    expect(canonicalInputs).toHaveLength(1);
    expect(canonicalInputs[0]).not.toContain(input.rawCapability);
    expect(repositorySpy.issueCommands).toEqual([
      {
        now: timestamp,
        leaseSlotDigest: '1'.padStart(64, '0'),
        runFenceDigest: '2'.padStart(64, '0'),
        capability: {
          version: 1,
          runtimeAudience: 'hetzner-prod',
          runId: safeId,
          leaseFence: '1',
          userId: 'user_1',
          scenarioId: 'scenario_1',
          scenarioNumber: 1,
          scenarioLabel: 'Scenario one',
          matrixRoomBindingDigest: digest,
          whatsappAccountBindingDigest: digest,
          whatsappSenderBindingDigest: digest,
          matrixIdempotencyKeyDigest: digest,
          promptNormalizationVersion: 1,
          promptDigest: digest,
          phase: 'start',
          turnIndex: 0,
          expectedSessionId: null,
          pendingConfirmationId: null,
          expectedDecision: null,
          mockProfile: profile,
          mockProfileDigest: digest,
          expectedToolSchedule: [],
          currentDateTime: timestamp,
          timeZone: 'Europe/Warsaw',
          capabilityDigest: '3'.padStart(64, '0'),
          issueRequestDigest: digest,
          issuedAt: timestamp,
          expiresAt: '2026-07-20T00:01:00.000Z',
          consumedAt: null,
          consumedTransportMessageIdDigest: null,
          ingestOutboxId: null,
          revokedAt: null,
        },
      },
    ]);
    expect(JSON.stringify(repositorySpy.issueCommands)).not.toContain(input.rawCapability);
  });

  it('consume retry ignores sequential ID source and replays its stored receipt', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const capabilityDigest = '3'.padStart(64, '0');
    const transportMessageIdDigest = '4'.padStart(64, '0');
    const payloadDigest = '5'.padStart(64, '0');
    const ingressRequestDigest = '6'.padStart(64, '0');
    const ingestReceiptId = `imc_ingest_receipt_v1_${transportMessageIdDigest}`;
    const ingestOutboxId = `imc_ingest_outbox_v1_${transportMessageIdDigest}`;
    const retryInput = {
      ...validConsumeInput,
      transportMessageId: 'transport:retry-1',
      facts: {
        ...validConsumeInput.facts,
        ingressRequest: {
          ...validConsumeInput.facts.ingressRequest,
          capabilityDigest,
          transportMessageIdDigest,
          ingestReceiptId,
          payloadDigest,
          ingestOutboxId,
        },
        ingressRequestDigest,
        payload: {
          ...validConsumeInput.facts.payload,
          context: { ...validConsumeInput.facts.payload.context, ingestReceiptId },
        },
      },
    };
    const rebuiltPayload = retryInput.facts.payload;
    const rebuiltIngressRequest = retryInput.facts.ingressRequest;
    const sha256 = createExpectedShaQueue([
      { canonicalJson: canonicalMatrixCorpusIngestPayloadV1(rebuiltPayload), output: payloadDigest },
      {
        canonicalJson: canonicalMatrixCorpusIngressRequestV1(rebuiltIngressRequest),
        output: ingressRequestDigest,
      },
      { canonicalJson: canonicalMatrixCorpusIngestPayloadV1(rebuiltPayload), output: payloadDigest },
      {
        canonicalJson: canonicalMatrixCorpusIngressRequestV1(rebuiltIngressRequest),
        output: ingressRequestDigest,
      },
    ]);
    const keyedDigestDomains: MatrixCorpusDigestDomain[] = [];
    const digests: MatrixCorpusControlDependencies['digests'] = {
      digest(domain) {
        keyedDigestDomains.push(domain);
        if (domain === 'imc-lease-slot-v1') return leaseSlotDigest;
        if (domain === 'imc-run-fence-v1') return runFenceDigest;
        if (domain === 'imc-capability-v1') return capabilityDigest;
        if (domain === 'imc-transport-v1') return transportMessageIdDigest;
        throw new Error('Unexpected digest domain');
      },
    };
    const idCalls: string[] = [];
    let clockCalls = 0;
    let repositoryCalls = 0;
    vi.spyOn(repositorySpy.repository, 'consumeCapabilityAndEnqueueIngest').mockImplementation(async (command) => {
      repositorySpy.consumeCommands.push(command);
      repositoryCalls += 1;
      if (repositoryCalls === 1)
        return {
          code: 'INGEST_ENQUEUED',
          runId: safeId,
          scenarioId: 'scenario_1',
          phase: 'start',
          turnIndex: 0,
          ingestReceiptId,
          ingestOutboxId,
          acceptedAt: timestamp,
        };
      return {
        code: 'ALREADY_APPLIED',
        operation: 'consume',
        result: 'enqueued',
        runId: safeId,
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        ingestReceiptId,
        ingestOutboxId,
        acceptedAt: '2026-07-19T23:58:00.000Z',
      };
    });
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          clockCalls += 1;
          return clockCalls === 1 ? timestamp : '2026-07-20T00:00:01.000Z';
        },
        digests,
        sha256: sha256.sha256,
        ids: {
          ingestReceiptId: () => {
            idCalls.push('receipt');
            return `receipt_random_${idCalls.length}`;
          },
          ingestOutboxId: () => {
            idCalls.push('outbox');
            return `outbox_random_${idCalls.length}`;
          },
        },
      })
    );

    const first = await controlPlane.consumeCapabilityAndEnqueueIngest(retryInput);
    const second = await controlPlane.consumeCapabilityAndEnqueueIngest(retryInput);

    expect(first).toEqual({
      code: 'INGEST_ENQUEUED',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId,
      ingestOutboxId,
      acceptedAt: timestamp,
    });
    expect(second).toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
      result: 'enqueued',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId,
      ingestOutboxId,
      acceptedAt: '2026-07-19T23:58:00.000Z',
    });
    expect(repositorySpy.consumeCommands).toHaveLength(2);
    expect(repositorySpy.consumeCommands.map((command) => command.ingestReceiptId)).toEqual([
      ingestReceiptId,
      ingestReceiptId,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.ingestOutboxId)).toEqual([
      ingestOutboxId,
      ingestOutboxId,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.payloadDigest)).toEqual([
      payloadDigest,
      payloadDigest,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.ingressRequestDigest)).toEqual([
      ingressRequestDigest,
      ingressRequestDigest,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.now)).toEqual([
      timestamp,
      '2026-07-20T00:00:01.000Z',
    ]);
    expect(keyedDigestDomains).toEqual([
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-capability-v1',
      'imc-transport-v1',
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-capability-v1',
      'imc-transport-v1',
    ]);
    expect(sha256.remaining()).toBe(0);
    expect(idCalls).toEqual([]);
    const safeSurfaces = JSON.stringify({
      commands: repositorySpy.consumeCommands,
      results: [first, second],
      logs: capturedLogger.records,
    });
    expect(safeSurfaces).not.toContain(retryInput.rawCapability);
    expect(safeSurfaces).not.toContain(retryInput.transportMessageId);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('consume changed semantic retry retains stable IDs and reaches transport replay', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const capabilityDigest = '3'.padStart(64, '0');
    const transportMessageIdDigest = '4'.padStart(64, '0');
    const firstPayloadDigest = '5'.padStart(64, '0');
    const firstIngressRequestDigest = '6'.padStart(64, '0');
    const changedPayloadDigest = '7'.padStart(64, '0');
    const changedIngressRequestDigest = '8'.padStart(64, '0');
    const ingestReceiptId = `imc_ingest_receipt_v1_${transportMessageIdDigest}`;
    const ingestOutboxId = `imc_ingest_outbox_v1_${transportMessageIdDigest}`;
    const firstInput = {
      ...validConsumeInput,
      transportMessageId: 'transport:changed-retry-1',
      facts: {
        ...validConsumeInput.facts,
        ingressRequest: {
          ...validConsumeInput.facts.ingressRequest,
          capabilityDigest,
          transportMessageIdDigest,
          ingestReceiptId,
          payloadDigest: firstPayloadDigest,
          ingestOutboxId,
        },
        ingressRequestDigest: firstIngressRequestDigest,
        payload: {
          ...validConsumeInput.facts.payload,
          context: { ...validConsumeInput.facts.payload.context, ingestReceiptId },
        },
      },
    };
    const changedInput = {
      ...firstInput,
      facts: {
        ...firstInput.facts,
        ingressRequest: {
          ...firstInput.facts.ingressRequest,
          payloadDigest: changedPayloadDigest,
        },
        ingressRequestDigest: changedIngressRequestDigest,
        payload: {
          ...firstInput.facts.payload,
          ordinaryIngest: {
            ...firstInput.facts.payload.ordinaryIngest,
            text: 'private semantic retry change',
          },
        },
      },
    };
    const sha256 = createExpectedShaQueue([
      {
        canonicalJson: canonicalMatrixCorpusIngestPayloadV1(firstInput.facts.payload),
        output: firstPayloadDigest,
      },
      {
        canonicalJson: canonicalMatrixCorpusIngressRequestV1(firstInput.facts.ingressRequest),
        output: firstIngressRequestDigest,
      },
      {
        canonicalJson: canonicalMatrixCorpusIngestPayloadV1(changedInput.facts.payload),
        output: changedPayloadDigest,
      },
      {
        canonicalJson: canonicalMatrixCorpusIngressRequestV1(changedInput.facts.ingressRequest),
        output: changedIngressRequestDigest,
      },
    ]);
    let repositoryCalls = 0;
    vi.spyOn(repositorySpy.repository, 'consumeCapabilityAndEnqueueIngest').mockImplementation(async (command) => {
      repositorySpy.consumeCommands.push(command);
      repositoryCalls += 1;
      if (repositoryCalls === 1)
        return {
          code: 'INGEST_ENQUEUED',
          runId: safeId,
          scenarioId: 'scenario_1',
          phase: 'start',
          turnIndex: 0,
          ingestReceiptId,
          ingestOutboxId,
          acceptedAt: timestamp,
        };
      return { code: 'TRANSPORT_REPLAY' };
    });
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        digests: {
          digest(domain) {
            if (domain === 'imc-lease-slot-v1') return leaseSlotDigest;
            if (domain === 'imc-run-fence-v1') return runFenceDigest;
            if (domain === 'imc-capability-v1') return capabilityDigest;
            if (domain === 'imc-transport-v1') return transportMessageIdDigest;
            throw new Error('Unexpected digest domain');
          },
        },
        sha256: sha256.sha256,
        ids: {
          ingestReceiptId: () => {
            throw new Error('Consume must not use the ID port');
          },
          ingestOutboxId: () => {
            throw new Error('Consume must not use the ID port');
          },
        },
      })
    );

    const first = await controlPlane.consumeCapabilityAndEnqueueIngest(firstInput);
    const changed = await controlPlane.consumeCapabilityAndEnqueueIngest(changedInput);

    expect(first.code).toBe('INGEST_ENQUEUED');
    expect(changed).toEqual({ code: 'TRANSPORT_REPLAY' });
    expect(repositorySpy.consumeCommands).toHaveLength(2);
    expect(repositorySpy.consumeCommands.map((command) => command.transportMessageIdDigest)).toEqual([
      transportMessageIdDigest,
      transportMessageIdDigest,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.ingestReceiptId)).toEqual([
      ingestReceiptId,
      ingestReceiptId,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.ingestOutboxId)).toEqual([
      ingestOutboxId,
      ingestOutboxId,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.payloadDigest)).toEqual([
      firstPayloadDigest,
      changedPayloadDigest,
    ]);
    expect(repositorySpy.consumeCommands.map((command) => command.ingressRequestDigest)).toEqual([
      firstIngressRequestDigest,
      changedIngressRequestDigest,
    ]);
    expect(sha256.remaining()).toBe(0);
    expect(intexAgentSpy.acceptanceInputs).toEqual([]);
    expect(intexAgentSpy.controlStatusInputs).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('consume rejects an arbitrary caller ID even with self-consistent hashes', async () => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const capabilityDigest = '3'.padStart(64, '0');
    const transportMessageIdDigest = '4'.padStart(64, '0');
    const arbitraryId = 'receipt_arbitrary_but_self_consistent';
    const ingestOutboxId = `imc_ingest_outbox_v1_${transportMessageIdDigest}`;
    const payloadDigest = '5'.padStart(64, '0');
    const ingressRequestDigest = '6'.padStart(64, '0');
    const input = {
      ...validConsumeInput,
      facts: {
        ...validConsumeInput.facts,
        ingressRequest: {
          ...validConsumeInput.facts.ingressRequest,
          capabilityDigest,
          transportMessageIdDigest,
          ingestReceiptId: arbitraryId,
          payloadDigest,
          ingestOutboxId,
        },
        ingressRequestDigest,
        payload: {
          ...validConsumeInput.facts.payload,
          context: { ...validConsumeInput.facts.payload.context, ingestReceiptId: arbitraryId },
        },
      },
    };
    let shaCalls = 0;
    let idCalls = 0;
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        digests: {
          digest(domain) {
            if (domain === 'imc-lease-slot-v1') return leaseSlotDigest;
            if (domain === 'imc-run-fence-v1') return runFenceDigest;
            if (domain === 'imc-capability-v1') return capabilityDigest;
            if (domain === 'imc-transport-v1') return transportMessageIdDigest;
            throw new Error('Unexpected digest domain');
          },
        },
        sha256: {
          digestCanonical(canonicalJson) {
            shaCalls += 1;
            if (canonicalJson === canonicalMatrixCorpusIngestPayloadV1(input.facts.payload)) return payloadDigest;
            if (canonicalJson === canonicalMatrixCorpusIngressRequestV1(input.facts.ingressRequest))
              return ingressRequestDigest;
            throw new Error('Unexpected SHA input');
          },
        },
        ids: {
          ingestReceiptId: () => {
            idCalls += 1;
            return arbitraryId;
          },
          ingestOutboxId: () => {
            idCalls += 1;
            return ingestOutboxId;
          },
        },
      })
    );

    const result = await controlPlane.consumeCapabilityAndEnqueueIngest(input);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(idCalls).toBe(0);
    expect(shaCalls).toBe(0);
    expect(repositorySpy.consumeCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation: 'consume', code: 'CORRUPT_STATE' }]);
    expect(JSON.stringify(capturedLogger.records)).not.toContain(arbitraryId);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it('consumes with an exact rebuilt command, canonical digest chain, and no raw bearer or client calls', async () => {
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    let clockCalls = 0;
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const capabilityDigest = '3'.padStart(64, '0');
    const transportMessageIdDigest = '4'.padStart(64, '0');
    const payloadDigest = '5'.padStart(64, '0');
    const ingressRequestDigest = '6'.padStart(64, '0');
    const ingestReceiptId = `imc_ingest_receipt_v1_${transportMessageIdDigest}`;
    const ingestOutboxId = `imc_ingest_outbox_v1_${transportMessageIdDigest}`;
    const repositorySpy = createRepositorySpy({
      consumeResult: {
        code: 'INGEST_ENQUEUED',
        runId: safeId,
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        ingestReceiptId,
        ingestOutboxId,
        acceptedAt: timestamp,
      },
    });
    const digests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: ['hetzner-prod', 'user_1'],
        output: leaseSlotDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: ['hetzner-prod', 'user_1', safeId],
        output: runFenceDigest,
      },
      {
        domain: 'imc-capability-v1',
        parts: [validConsumeInput.rawCapability],
        output: capabilityDigest,
      },
      {
        domain: 'imc-transport-v1',
        parts: [validConsumeInput.transportMessageId],
        output: transportMessageIdDigest,
      },
    ]);
    const rebuiltPayload = {
      ...validConsumeInput.facts.payload,
      context: { ...validConsumeInput.facts.payload.context, ingestReceiptId },
    };
    const rebuiltIngressRequest = {
      ...validConsumeInput.facts.ingressRequest,
      capabilityDigest,
      transportMessageIdDigest,
      ingestReceiptId,
      payloadDigest,
      ingestOutboxId,
    };
    const sha256 = createExpectedShaQueue([
      { canonicalJson: canonicalMatrixCorpusIngestPayloadV1(rebuiltPayload), output: payloadDigest },
      {
        canonicalJson: canonicalMatrixCorpusIngressRequestV1(rebuiltIngressRequest),
        output: ingressRequestDigest,
      },
    ]);
    let idCalls = 0;
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          clockCalls += 1;
          return timestamp;
        },
        digests: digests.digest,
        sha256: sha256.sha256,
        ids: {
          ingestReceiptId: () => {
            idCalls += 1;
            throw new Error('Consume must not use the ID port');
          },
          ingestOutboxId: () => {
            idCalls += 1;
            throw new Error('Consume must not use the ID port');
          },
        },
      })
    ).consumeCapabilityAndEnqueueIngest({
      ...validConsumeInput,
      facts: {
          ...validConsumeInput.facts,
          ingressRequest: {
            ...validConsumeInput.facts.ingressRequest,
            capabilityDigest,
            transportMessageIdDigest,
            ingestReceiptId,
            payloadDigest,
            ingestOutboxId,
          },
          ingressRequestDigest,
          payload: rebuiltPayload,
      },
    });

    expect(result).toEqual({
      code: 'INGEST_ENQUEUED',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId,
      ingestOutboxId,
      acceptedAt: timestamp,
    });
    expect(digests.remaining()).toBe(0);
    expect(sha256.remaining()).toBe(0);
    expect(clockCalls).toBe(1);
    expect(idCalls).toBe(0);
    expect(repositorySpy.consumeCommands).toEqual([
      {
        now: timestamp,
        leaseSlotDigest,
        runFenceDigest,
        capabilityDigest,
        transportMessageIdDigest,
        ingestReceiptId,
        ingestOutboxId,
        facts: {
          version: 1,
          ingressRequest: rebuiltIngressRequest,
          ingressRequestDigest,
          payload: rebuiltPayload,
        },
        payloadDigest,
        ingressRequestDigest,
      },
    ]);
    const serializedCommand = JSON.stringify(repositorySpy.consumeCommands);
    expect(serializedCommand).not.toContain(validConsumeInput.rawCapability);
    expect(serializedCommand).not.toContain(validConsumeInput.transportMessageId);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgentSpy.acceptanceInputs).toEqual([]);
    expect(intexAgentSpy.controlStatusInputs).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    {
      field: 'capability digest',
      input: {
        ...validConsumeInput,
        facts: {
          ...validConsumeInput.facts,
          ingressRequest: { ...validConsumeInput.facts.ingressRequest, capabilityDigest: 'b'.repeat(64) },
        },
      },
    },
    {
      field: 'transport digest',
      input: {
        ...validConsumeInput,
        facts: {
          ...validConsumeInput.facts,
          ingressRequest: {
            ...validConsumeInput.facts.ingressRequest,
            transportMessageIdDigest: 'b'.repeat(64),
          },
        },
      },
    },
    {
      field: 'receipt IDs',
      input: {
        ...validConsumeInput,
        facts: {
          ...validConsumeInput.facts,
          ingressRequest: { ...validConsumeInput.facts.ingressRequest, ingestReceiptId: 'receipt_2' },
          payload: {
            ...validConsumeInput.facts.payload,
            context: { ...validConsumeInput.facts.payload.context, ingestReceiptId: 'receipt_2' },
          },
        },
      },
    },
    {
      field: 'outbox ID',
      input: {
        ...validConsumeInput,
        facts: {
          ...validConsumeInput.facts,
          ingressRequest: { ...validConsumeInput.facts.ingressRequest, ingestOutboxId: 'outbox_2' },
        },
      },
    },
    {
      field: 'payload digest',
      input: {
        ...validConsumeInput,
        facts: {
          ...validConsumeInput.facts,
          ingressRequest: { ...validConsumeInput.facts.ingressRequest, payloadDigest: 'b'.repeat(64) },
        },
      },
    },
    {
      field: 'ingress request digest',
      input: { ...validConsumeInput, facts: { ...validConsumeInput.facts, ingressRequestDigest: 'b'.repeat(64) } },
    },
  ] as const)('rejects mismatched caller-carried $field before repository admission', async ({ input }) => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    ).consumeCapabilityAndEnqueueIngest(input);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(repositorySpy.consumeCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation: 'consume', code: 'CORRUPT_STATE' }]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    { dependency: 'clock', behavior: 'throw' },
    { dependency: 'clock', behavior: 'malformed' },
    { dependency: 'keyed digest 1', behavior: 'throw' },
    { dependency: 'keyed digest 1', behavior: 'malformed' },
    { dependency: 'keyed digest 2', behavior: 'throw' },
    { dependency: 'keyed digest 2', behavior: 'malformed' },
    { dependency: 'keyed digest 3', behavior: 'throw' },
    { dependency: 'keyed digest 3', behavior: 'malformed' },
    { dependency: 'keyed digest 4', behavior: 'throw' },
    { dependency: 'keyed digest 4', behavior: 'malformed' },
    { dependency: 'payload SHA', behavior: 'throw' },
    { dependency: 'payload SHA', behavior: 'malformed' },
    { dependency: 'ingress SHA', behavior: 'throw' },
    { dependency: 'ingress SHA', behavior: 'malformed' },
  ] as const)(
    'maps $dependency $behavior output to command corruption before repository admission',
    async ({ dependency, behavior }) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      let digestCalls = 0;
      let shaCalls = 0;
      const failingDigestCall = dependency.startsWith('keyed digest')
        ? Number(dependency.at(-1))
        : null;
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          clockNow: () => {
            if (dependency !== 'clock') return timestamp;
            if (behavior === 'throw') throw new Error('clock failure');
            return 'invalid timestamp';
          },
          digests: {
            digest: () => {
              digestCalls += 1;
              if (failingDigestCall === digestCalls) {
                if (behavior === 'throw') throw new Error('digest failure');
                return 'invalid digest';
              }
              return digest;
            },
          },
          ids: {
            ingestReceiptId: () => 'receipt_1',
            ingestOutboxId: () => 'outbox_1',
          },
          sha256: {
            digestCanonical: () => {
              shaCalls += 1;
              if (dependency === 'payload SHA' && shaCalls === 1) {
                if (behavior === 'throw') throw new Error('payload SHA failure');
                return 'invalid digest';
              }
              if (dependency === 'ingress SHA' && shaCalls === 2) {
                if (behavior === 'throw') throw new Error('ingress SHA failure');
                return 'invalid digest';
              }
              return digest;
            },
          },
        })
      );

      const result = await controlPlane.consumeCapabilityAndEnqueueIngest(validConsumeInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(repositorySpy.consumeCommands).toEqual([]);
      expect(capturedLogger.records).toEqual([{ operation: 'consume', code: 'CORRUPT_STATE' }]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each(['throwing', 'malformed', 'sequential'] as const)(
    'ignores a %s legacy ID dependency during consume admission',
    async (behavior) => {
      const repositorySpy = createRepositorySpy();
      const intexAgentSpy = createIntexAgentSpy();
      const capturedLogger = createCapturingLogger();
      let receiptCalls = 0;
      let outboxCalls = 0;
      const controlPlane = new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
          ids: {
            ingestReceiptId: () => {
              receiptCalls += 1;
              if (behavior === 'throwing') throw new Error('Legacy receipt ID dependency failed');
              if (behavior === 'malformed') return 'invalid id';
              return `receipt_random_${receiptCalls}`;
            },
            ingestOutboxId: () => {
              outboxCalls += 1;
              if (behavior === 'throwing') throw new Error('Legacy outbox ID dependency failed');
              if (behavior === 'malformed') return 'invalid id';
              return `outbox_random_${outboxCalls}`;
            },
          },
        })
      );

      const result = await controlPlane.consumeCapabilityAndEnqueueIngest(validConsumeInput);

      expect(result).toEqual({ code: 'NOT_FOUND' });
      expect(repositorySpy.consumeCommands).toHaveLength(1);
      expect(repositorySpy.consumeCommands[0]).toMatchObject({
        ingestReceiptId: defaultIngestReceiptId,
        ingestOutboxId: defaultIngestOutboxId,
      });
      expect(receiptCalls).toBe(0);
      expect(outboxCalls).toBe(0);
      expect(capturedLogger.records).toEqual([]);
      expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
    }
  );

  it.each([
    { canonicalizer: 'canonicalMatrixCorpusIngestPayloadV1' as const },
    { canonicalizer: 'canonicalMatrixCorpusIngressRequestV1' as const },
  ])('maps a thrown $canonicalizer rejection to command corruption', async ({ canonicalizer }) => {
    const repositorySpy = createRepositorySpy();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const spy = vi.spyOn(matrixCorpusContracts, canonicalizer).mockImplementation(() => {
      throw new Error('canonicalization failure');
    });

    try {
      const result = await new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: intexAgentSpy.client,
          logger: capturedLogger.logger,
        })
      ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(repositorySpy.consumeCommands).toEqual([]);
      expect(capturedLogger.records).toEqual([{ operation: 'consume', code: 'CORRUPT_STATE' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    { behavior: 'throw' as const },
    { behavior: 'malformed' as const },
    {
      behavior: 'mismatched fresh projection' as const,
      result: {
        code: 'INGEST_ENQUEUED' as const,
        runId: safeId,
        scenarioId: 'scenario_1',
        phase: 'start' as const,
        turnIndex: 0,
        ingestReceiptId: 'receipt_2',
        ingestOutboxId: 'outbox_1',
        acceptedAt: timestamp,
      },
    },
  ])('maps repository $behavior to repository-result corruption', async ({ behavior, result: repositoryResult }) => {
    const repositorySpy = createRepositorySpy({
      consume: behavior === 'mismatched fresh projection' ? 'valid' : behavior,
      ...(repositoryResult === undefined ? {} : { consumeResult: repositoryResult }),
    });
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
      })
    ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.consumeCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([{ operation: 'consume', code: 'CORRUPT_STATE' }]);
  });

  it.each([
    { field: 'runId', result: { runId: 'run_2' } },
    { field: 'scenarioId', result: { scenarioId: 'scenario_2' } },
    { field: 'phase', result: { phase: 'turn' as const } },
    { field: 'turnIndex', result: { turnIndex: 1 } },
    { field: 'ingestReceiptId', result: { ingestReceiptId: 'receipt_2' } },
    { field: 'ingestOutboxId', result: { ingestOutboxId: 'outbox_2' } },
    { field: 'acceptedAt', result: { acceptedAt: '2026-07-20T00:00:01.000Z' } },
  ] as const)('rejects a schema-valid fresh projection with mismatched $field', async ({ result: projection }) => {
    const repositorySpy = createRepositorySpy({
      consumeResult: {
        code: 'INGEST_ENQUEUED',
        runId: safeId,
        scenarioId: 'scenario_1',
        phase: 'start',
        turnIndex: 0,
        ingestReceiptId: 'receipt_1',
        ingestOutboxId: 'outbox_1',
        acceptedAt: timestamp,
        ...projection,
      },
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.consumeCommands).toHaveLength(1);
  });

  const consumeReplay = {
    code: 'ALREADY_APPLIED' as const,
    operation: 'consume' as const,
    result: 'enqueued' as const,
    runId: safeId,
    scenarioId: 'scenario_1',
    phase: 'start' as const,
    turnIndex: 0,
    ingestReceiptId: 'receipt_historical',
    ingestOutboxId: 'outbox_historical',
    acceptedAt: '2026-07-19T23:58:00.000Z',
  };

  it('accepts a semantically-correlated replay with historical receipt/outbox IDs and accepted time', async () => {
    const validRepositorySpy = createRepositorySpy({ consumeResult: consumeReplay });
    const validResult = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: validRepositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(validResult).toEqual(consumeReplay);
  });

  it.each([
    { field: 'runId', projection: { runId: 'run_2' } },
    { field: 'scenarioId', projection: { scenarioId: 'scenario_2' } },
    { field: 'phase', projection: { phase: 'turn' as const } },
    { field: 'turnIndex', projection: { turnIndex: 1 } },
  ] as const)(
    'rejects a replay with mismatched semantic $field while historical IDs and time remain valid',
    async ({ projection }) => {
    const mismatchedRepositorySpy = createRepositorySpy({
        consumeResult: { ...consumeReplay, ...projection },
    });
    const mismatchedResult = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: mismatchedRepositorySpy.repository,
        intexAgent: createIntexAgentSpy().client,
      })
    ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(mismatchedResult).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    }
  );

  it('passes through a strict static consume failure after result parsing', async () => {
    const repositorySpy = createRepositorySpy({ consumeResult: { code: 'TRANSPORT_REPLAY' } });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(result).toEqual({ code: 'TRANSPORT_REPLAY' });
    expect(repositorySpy.consumeCommands).toHaveLength(1);
  });

  it('rejects invalid public consume input before all dependencies and swallows logger failures', async () => {
    const repositorySpy = createRepositorySpy();
    const calls = { clock: 0, digest: 0, sha: 0, receipt: 0, outbox: 0, client: 0 };
    const throwingLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger failure');
      },
      debug: () => undefined,
    };
    const intexAgent: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: getTurnTerminalNotReady,
      async getCurrentAcceptance() {
        calls.client += 1;
        return { kind: 'admission_ready', current: 'absent' };
      },
      async getControlStatus() {
        calls.client += 1;
        return JSON.parse('{}');
      },
      async postTerminalControl() {
        calls.client += 1;
        return { kind: 'not_ready' };
      },
    };
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent,
        logger: throwingLogger,
        clockNow: () => {
          calls.clock += 1;
          return timestamp;
        },
        digests: {
          digest: () => {
            calls.digest += 1;
            return digest;
          },
        },
        sha256: {
          digestCanonical: () => {
            calls.sha += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            calls.receipt += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            calls.outbox += 1;
            return 'outbox_1';
          },
        },
      })
    ).consumeCapabilityAndEnqueueIngest({ ...validConsumeInput, rawCapability: 'invalid' });

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
    expect(calls).toEqual({ clock: 0, digest: 0, sha: 0, receipt: 0, outbox: 0, client: 0 });
    expect(repositorySpy.consumeCommands).toEqual([]);
  });
});

describe('MatrixCorpusControlPlane quiesce and transport-status facade slice', () => {
  const validQuiesceInput = validControlInput;
  const validTransportStatusInput = {
    runtimeAudience: 'hetzner-prod' as const,
    runId: safeId,
    userId: 'user_1',
    leaseFence: '1',
  };
  const quiescedProjection = {
    code: 'QUIESCED' as const,
    runId: safeId,
    leaseFence: '1',
    phase: 'quiescing' as const,
    quiescedAt: timestamp,
    drained: false,
  } satisfies QuiesceResult;
  const drainedTransportStatusProjection = {
    code: 'TRANSPORT_STATUS' as const,
    runId: safeId,
    leaseFence: '1',
    phase: 'quiescing' as const,
    consumedCapabilityCount: 1,
    terminalIntexMarkerCount: 1,
    terminalOutboxCount: 1,
    replyOrDeliveryWorkInFlight: 0,
    nonterminalIngestOutboxCount: 0,
    drained: true,
  } satisfies TransportStatusResult;

  type QuiesceStatusRepositoryOptions = Readonly<{
    quiesce?: RepositoryBehavior;
    status?: RepositoryBehavior;
    quiesceResult?: QuiesceResult;
    statusResult?: TransportStatusResult;
  }>;

  function createQuiesceStatusRepository(options: QuiesceStatusRepositoryOptions = {}): Readonly<{
    repository: MatrixCorpusRepository;
    quiesceCommands: QuiesceRunCommand[];
    statusCommands: GetTransportStatusCommand[];
    mutationCalls: string[];
  }> {
    const base = createRepositorySpy();
    const quiesceCommands: QuiesceRunCommand[] = [];
    const statusCommands: GetTransportStatusCommand[] = [];
    const mutationCalls: string[] = [];
    const unexpectedMutation = <Operation extends string>(operation: Operation) => async (): Promise<never> => {
      mutationCalls.push(operation);
      throw new Error(`Unexpected repository mutation: ${operation}`);
    };
    const repository: MatrixCorpusRepository = {
      ...base.repository,
      acquireProvisioningLease: unexpectedMutation(
        'acquireProvisioningLease'
      ) as MatrixCorpusRepository['acquireProvisioningLease'],
      activateRun: unexpectedMutation('activateRun') as MatrixCorpusRepository['activateRun'],
      renewLease: unexpectedMutation('renewLease') as MatrixCorpusRepository['renewLease'],
      issueCapability: unexpectedMutation('issueCapability') as MatrixCorpusRepository['issueCapability'],
      consumeCapabilityAndEnqueueIngest: unexpectedMutation(
        'consumeCapabilityAndEnqueueIngest'
      ) as MatrixCorpusRepository['consumeCapabilityAndEnqueueIngest'],
      async quiesceRun(input): Promise<QuiesceResult> {
        quiesceCommands.push(input);
        return repositoryResult(options.quiesce, options.quiesceResult ?? quiescedProjection);
      },
      releaseRun: unexpectedMutation('releaseRun') as MatrixCorpusRepository['releaseRun'],
      abandonExpiredRun: unexpectedMutation(
        'abandonExpiredRun'
      ) as MatrixCorpusRepository['abandonExpiredRun'],
      async getTransportStatus(input): Promise<TransportStatusResult> {
        statusCommands.push(input);
        return repositoryResult(
          options.status,
          options.statusResult ?? drainedTransportStatusProjection
        );
      },
      cleanupExactRun: unexpectedMutation('cleanupExactRun') as MatrixCorpusRepository['cleanupExactRun'],
      claimPendingIngestOutbox: unexpectedMutation(
        'claimPendingIngestOutbox'
      ) as MatrixCorpusRepository['claimPendingIngestOutbox'],
      renewIngestOutboxClaim: unexpectedMutation(
        'renewIngestOutboxClaim'
      ) as MatrixCorpusRepository['renewIngestOutboxClaim'],
      acknowledgeIngestOutbox: unexpectedMutation(
        'acknowledgeIngestOutbox'
      ) as MatrixCorpusRepository['acknowledgeIngestOutbox'],
      claimPendingTerminalControlOutbox: unexpectedMutation(
        'claimPendingTerminalControlOutbox'
      ) as MatrixCorpusRepository['claimPendingTerminalControlOutbox'],
      renewTerminalControlOutboxClaim: unexpectedMutation(
        'renewTerminalControlOutboxClaim'
      ) as MatrixCorpusRepository['renewTerminalControlOutboxClaim'],
      acknowledgeTerminalControl: unexpectedMutation(
        'acknowledgeTerminalControl'
      ) as MatrixCorpusRepository['acknowledgeTerminalControl'],
    };
    return { repository, quiesceCommands, statusCommands, mutationCalls };
  }

  function expectNoIntexAgentCalls(intexAgentSpy: ReturnType<typeof createIntexAgentSpy>): void {
    expect(intexAgentSpy.acceptanceInputs).toEqual([]);
    expect(intexAgentSpy.controlStatusInputs).toEqual([]);
    expect(intexAgentSpy.postTerminalControlCalls()).toBe(0);
  }

  it('quiesces with one clock capture, four ordered keyed digests, and a raw-free exact command', async () => {
    const repositorySpy = createQuiesceStatusRepository();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const idempotencyKeyDigest = '3'.padStart(64, '0');
    const canonicalRequestDigest = '4'.padStart(64, '0');
    const callOrder: string[] = [];
    const digests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: ['hetzner-prod', 'user_1'],
        output: leaseSlotDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: ['hetzner-prod', 'user_1', safeId],
        output: runFenceDigest,
      },
      {
        domain: 'imc-operation-idempotency-v1',
        parts: ['quiesce', validQuiesceInput.idempotencyKey],
        output: idempotencyKeyDigest,
      },
      {
        domain: 'imc-operation-request-v1',
        parts: [
          'quiesce',
          JSON.stringify({
            runtimeAudience: 'hetzner-prod',
            runId: safeId,
            userId: 'user_1',
            leaseFence: '1',
          }),
        ],
        output: canonicalRequestDigest,
      },
    ]);
    let clockCalls = 0;
    let shaCalls = 0;
    let idCalls = 0;
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          clockCalls += 1;
          callOrder.push('clock');
          return timestamp;
        },
        digests: {
          digest(domain, parts) {
            callOrder.push(domain);
            return digests.digest.digest(domain, parts);
          },
        },
        sha256: {
          digestCanonical: () => {
            shaCalls += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            idCalls += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            idCalls += 1;
            return 'outbox_1';
          },
        },
      })
    ).quiesceRun(validQuiesceInput);

    expect(result).toEqual(quiescedProjection);
    expect(clockCalls).toBe(1);
    expect(callOrder).toEqual([
      'clock',
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-operation-idempotency-v1',
      'imc-operation-request-v1',
    ]);
    expect(digests.remaining()).toBe(0);
    expect(shaCalls).toBe(0);
    expect(idCalls).toBe(0);
    expect(repositorySpy.quiesceCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        leaseSlotDigest,
        runFenceDigest,
        idempotencyKeyDigest,
        canonicalRequestDigest,
        now: timestamp,
      },
    ]);
    expect(repositorySpy.statusCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(JSON.stringify(repositorySpy.quiesceCommands)).not.toContain(validQuiesceInput.idempotencyKey);
    expect(capturedLogger.records).toEqual([]);
    expectNoIntexAgentCalls(intexAgentSpy);
  });

  it('gets transport status with one clock capture, ordered address digests, and no mutations', async () => {
    const repositorySpy = createQuiesceStatusRepository();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const leaseSlotDigest = '1'.padStart(64, '0');
    const runFenceDigest = '2'.padStart(64, '0');
    const callOrder: string[] = [];
    const digests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: ['hetzner-prod', 'user_1'],
        output: leaseSlotDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: ['hetzner-prod', 'user_1', safeId],
        output: runFenceDigest,
      },
    ]);
    let clockCalls = 0;
    let shaCalls = 0;
    let idCalls = 0;
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          clockCalls += 1;
          callOrder.push('clock');
          return timestamp;
        },
        digests: {
          digest(domain, parts) {
            callOrder.push(domain);
            return digests.digest.digest(domain, parts);
          },
        },
        sha256: {
          digestCanonical: () => {
            shaCalls += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            idCalls += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            idCalls += 1;
            return 'outbox_1';
          },
        },
      })
    ).getTransportStatus(validTransportStatusInput);

    expect(result).toEqual(drainedTransportStatusProjection);
    expect(clockCalls).toBe(1);
    expect(callOrder).toEqual(['clock', 'imc-lease-slot-v1', 'imc-run-fence-v1']);
    expect(digests.remaining()).toBe(0);
    expect(shaCalls).toBe(0);
    expect(idCalls).toBe(0);
    expect(repositorySpy.statusCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        leaseSlotDigest,
        runFenceDigest,
        now: timestamp,
      },
    ]);
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(capturedLogger.records).toEqual([]);
    expectNoIntexAgentCalls(intexAgentSpy);
  });

  it.each([
    { operation: 'quiesce' as const, input: { ...validQuiesceInput, runId: 'invalid id' } },
    { operation: 'status' as const, input: { ...validTransportStatusInput, runId: 'invalid id' } },
  ])('rejects invalid $operation input before every dependency and logs only static fields', async ({ operation, input }) => {
    const repositorySpy = createQuiesceStatusRepository();
    const intexAgentSpy = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const calls = { clock: 0, digest: 0, sha: 0, id: 0 };
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: intexAgentSpy.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          calls.clock += 1;
          return timestamp;
        },
        digests: {
          digest: () => {
            calls.digest += 1;
            return digest;
          },
        },
        sha256: {
          digestCanonical: () => {
            calls.sha += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            calls.id += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            calls.id += 1;
            return 'outbox_1';
          },
        },
      })
    );

    const result =
      operation === 'quiesce'
        ? await controlPlane.quiesceRun(input)
        : await controlPlane.getTransportStatus(input);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
    expect(calls).toEqual({ clock: 0, digest: 0, sha: 0, id: 0 });
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.statusCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expect(Object.keys(capturedLogger.records[0] ?? {}).sort()).toEqual(['code', 'operation']);
    expectNoIntexAgentCalls(intexAgentSpy);
  });

  it.each([
    { operation: 'quiesce' as const, behavior: 'throw' as const },
    { operation: 'quiesce' as const, behavior: 'malformed' as const },
    { operation: 'status' as const, behavior: 'throw' as const },
    { operation: 'status' as const, behavior: 'malformed' as const },
  ])('maps a $behavior clock for $operation to command corruption before repository admission', async ({
    operation,
    behavior,
  }) => {
    const repositorySpy = createQuiesceStatusRepository();
    const capturedLogger = createCapturingLogger();
    let digestCalls = 0;
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: createIntexAgentSpy().client,
        logger: capturedLogger.logger,
        clockNow: () => {
          if (behavior === 'throw') throw new Error('clock failure');
          return 'malformed timestamp';
        },
        digests: {
          digest: () => {
            digestCalls += 1;
            return digest;
          },
        },
      })
    );

    const result =
      operation === 'quiesce'
        ? await controlPlane.quiesceRun(validQuiesceInput)
        : await controlPlane.getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(digestCalls).toBe(0);
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.statusCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
  });

  it.each([
    { operation: 'quiesce' as const, digestNumber: 1, behavior: 'throw' as const },
    { operation: 'quiesce' as const, digestNumber: 1, behavior: 'malformed' as const },
    { operation: 'quiesce' as const, digestNumber: 2, behavior: 'throw' as const },
    { operation: 'quiesce' as const, digestNumber: 2, behavior: 'malformed' as const },
    { operation: 'quiesce' as const, digestNumber: 3, behavior: 'throw' as const },
    { operation: 'quiesce' as const, digestNumber: 3, behavior: 'malformed' as const },
    { operation: 'quiesce' as const, digestNumber: 4, behavior: 'throw' as const },
    { operation: 'quiesce' as const, digestNumber: 4, behavior: 'malformed' as const },
    { operation: 'status' as const, digestNumber: 1, behavior: 'throw' as const },
    { operation: 'status' as const, digestNumber: 1, behavior: 'malformed' as const },
    { operation: 'status' as const, digestNumber: 2, behavior: 'throw' as const },
    { operation: 'status' as const, digestNumber: 2, behavior: 'malformed' as const },
  ])('maps $operation keyed digest $digestNumber $behavior to command corruption', async ({
    operation,
    digestNumber,
    behavior,
  }) => {
    const repositorySpy = createQuiesceStatusRepository();
    const capturedLogger = createCapturingLogger();
    let digestCalls = 0;
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: createIntexAgentSpy().client,
        logger: capturedLogger.logger,
        digests: {
          digest: () => {
            digestCalls += 1;
            if (digestCalls === digestNumber) {
              if (behavior === 'throw') throw new Error('keyed digest failure');
              return 'malformed digest';
            }
            return digest;
          },
        },
      })
    );

    const result =
      operation === 'quiesce'
        ? await controlPlane.quiesceRun(validQuiesceInput)
        : await controlPlane.getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(digestCalls).toBe(digestNumber);
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.statusCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
  });

  it('maps a quiesce command-schema rejection to command corruption', async () => {
    const repositorySpy = createQuiesceStatusRepository();
    const capturedLogger = createCapturingLogger();
    const spy = vi.spyOn(quiesceRunCommandSchema, 'safeParse').mockReturnValue({ success: false } as never);
    try {
      const result = await new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: createIntexAgentSpy().client,
          logger: capturedLogger.logger,
        })
      ).quiesceRun(validQuiesceInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(repositorySpy.quiesceCommands).toEqual([]);
      expect(capturedLogger.records).toEqual([{ operation: 'quiesce', code: 'CORRUPT_STATE' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('maps a transport-status command-schema rejection to command corruption', async () => {
    const repositorySpy = createQuiesceStatusRepository();
    const capturedLogger = createCapturingLogger();
    const spy = vi
      .spyOn(getTransportStatusCommandSchema, 'safeParse')
      .mockReturnValue({ success: false } as never);
    try {
      const result = await new MatrixCorpusControlPlane(
        createControlDependencies({
          repository: repositorySpy.repository,
          intexAgent: createIntexAgentSpy().client,
          logger: capturedLogger.logger,
        })
      ).getTransportStatus(validTransportStatusInput);

      expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
      expect(repositorySpy.statusCommands).toEqual([]);
      expect(capturedLogger.records).toEqual([{ operation: 'status', code: 'CORRUPT_STATE' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    { operation: 'quiesce' as const, behavior: 'throw' as const },
    { operation: 'quiesce' as const, behavior: 'malformed' as const },
    { operation: 'status' as const, behavior: 'throw' as const },
    { operation: 'status' as const, behavior: 'malformed' as const },
  ])('maps $operation repository $behavior to repository-result corruption', async ({ operation, behavior }) => {
    const repositorySpy = createQuiesceStatusRepository(
      operation === 'quiesce' ? { quiesce: behavior } : { status: behavior }
    );
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: createIntexAgentSpy().client,
        logger: capturedLogger.logger,
      })
    );

    const result =
      operation === 'quiesce'
        ? await controlPlane.quiesceRun(validQuiesceInput)
        : await controlPlane.getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(operation === 'quiesce' ? repositorySpy.quiesceCommands : repositorySpy.statusCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
  });

  it.each([
    { field: 'run ID', projection: { runId: 'run_2' } },
    { field: 'fence', projection: { leaseFence: '2' } },
    { field: 'phase', projection: { phase: 'active' } },
    { field: 'time', projection: { quiescedAt: '2026-07-20T00:00:01.000Z' } },
  ] as const)('rejects a fresh quiesce projection with mismatched $field', async ({ projection }) => {
    const repositorySpy = createQuiesceStatusRepository({
      quiesceResult: { ...quiescedProjection, ...projection } as unknown as QuiesceResult,
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).quiesceRun(validQuiesceInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.quiesceCommands).toHaveLength(1);
  });

  const quiesceReplay = {
    code: 'ALREADY_APPLIED' as const,
    operation: 'quiesce' as const,
    result: 'quiesced' as const,
    runId: safeId,
    leaseFence: '1',
    phase: 'quiescing' as const,
    quiescedAt: '2026-07-19T23:58:00.000Z',
    drained: true,
  } satisfies QuiesceResult;

  it('accepts a correlated quiesce replay with historical time and drain projection', async () => {
    const repositorySpy = createQuiesceStatusRepository({ quiesceResult: quiesceReplay });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).quiesceRun(validQuiesceInput);

    expect(result).toEqual(quiesceReplay);
    expect(repositorySpy.quiesceCommands).toHaveLength(1);
  });

  it.each([
    { field: 'run ID', projection: { runId: 'run_2' } },
    { field: 'fence', projection: { leaseFence: '2' } },
  ] as const)('rejects a quiesce replay with mismatched $field', async ({ projection }) => {
    const repositorySpy = createQuiesceStatusRepository({
      quiesceResult: { ...quiesceReplay, ...projection },
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).quiesceRun(validQuiesceInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.quiesceCommands).toHaveLength(1);
  });

  it('passes through a static quiesce failure after strict result parsing', async () => {
    const repositorySpy = createQuiesceStatusRepository({ quiesceResult: { code: 'STALE_FENCE' } });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).quiesceRun(validQuiesceInput);

    expect(result).toEqual({ code: 'STALE_FENCE' });
    expect(repositorySpy.quiesceCommands).toHaveLength(1);
  });

  it.each([
    { field: 'run ID', projection: { runId: 'run_2' } },
    { field: 'fence', projection: { leaseFence: '2' } },
  ] as const)('rejects a transport-status projection with mismatched $field', async ({ projection }) => {
    const repositorySpy = createQuiesceStatusRepository({
      statusResult: { ...drainedTransportStatusProjection, ...projection },
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.statusCommands).toHaveLength(1);
  });

  it('rejects a schema-looking transport-status projection with a contradictory drain flag', async () => {
    const repositorySpy = createQuiesceStatusRepository({
      statusResult: { ...drainedTransportStatusProjection, drained: false },
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.statusCommands).toHaveLength(1);
  });

  it.each([
    drainedTransportStatusProjection,
    {
      code: 'TRANSPORT_STATUS' as const,
      runId: safeId,
      leaseFence: '1',
      phase: 'active' as const,
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      nonterminalIngestOutboxCount: 0,
      drained: false,
    } satisfies TransportStatusResult,
  ])('accepts an internally-derived $drained transport-status projection', async (projection) => {
    const repositorySpy = createQuiesceStatusRepository({ statusResult: projection });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).getTransportStatus(validTransportStatusInput);

    expect(result).toEqual(projection);
    expect(repositorySpy.statusCommands).toHaveLength(1);
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
  });

  it('passes through a static transport-status failure without invoking a mutation', async () => {
    const repositorySpy = createQuiesceStatusRepository({ statusResult: { code: 'STALE_FENCE' } });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createIntexAgentSpy().client })
    ).getTransportStatus(validTransportStatusInput);

    expect(result).toEqual({ code: 'STALE_FENCE' });
    expect(repositorySpy.statusCommands).toHaveLength(1);
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
  });

  it.each([
    { operation: 'quiesce' as const, input: { ...validQuiesceInput, runId: 'invalid id' } },
    { operation: 'status' as const, input: { ...validTransportStatusInput, runId: 'invalid id' } },
  ])('swallows a throwing logger without changing the $operation input-contract result', async ({ operation, input }) => {
    const repositorySpy = createQuiesceStatusRepository();
    const throwingLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger failure');
      },
      debug: () => undefined,
    };
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: createIntexAgentSpy().client,
        logger: throwingLogger,
      })
    );

    const result =
      operation === 'quiesce'
        ? await controlPlane.quiesceRun(input)
        : await controlPlane.getTransportStatus(input);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
    expect(repositorySpy.quiesceCommands).toEqual([]);
    expect(repositorySpy.statusCommands).toEqual([]);
  });
});

describe('MatrixCorpusControlPlane release and abandon facade slice', () => {
  const validReleaseInput = {
    runtimeAudience: 'hetzner-prod' as const,
    runId: safeId,
    userId: 'user_1',
    leaseFence: '1',
    idempotencyKey: 'idempotency-key-0001',
    contextFinalizationTombstoneDigest: digest,
    terminalCandidateDigest: digest,
    artifactStageDigest: digest,
  };
  const validAbandonInput = {
    runtimeAudience: 'hetzner-prod' as const,
    observedRunId: safeId,
    observedUserId: 'user_1',
    observedLeaseFence: '1',
  };
  const validReleaseStatus = {
    kind: 'status' as const,
    runId: safeId,
    userId: 'user_1',
    leaseFence: '1',
    lifecycle: 'finalizing' as const,
    contextReady: false,
    manifestReady: false,
    preflightProjectionReady: false,
    retentionReconciled: false,
    contextFinalizationTombstoneDigest: digest,
    terminalCandidateDigest: digest,
    artifactStageDigest: digest,
  };

  type TerminalRepositoryOptions = Readonly<{
    release?: RepositoryBehavior;
    abandon?: RepositoryBehavior;
    releaseResult?: ReleaseResult;
    abandonResult?: AbandonPendingResult;
  }>;

  function releasePending(
    overrides: Partial<Extract<ReleaseResult, { code: 'RELEASE_PENDING' }>> = {}
  ): Extract<ReleaseResult, { code: 'RELEASE_PENDING' }> {
    return {
      code: 'RELEASE_PENDING',
      runId: safeId,
      leaseFence: '1',
      terminalControlId: digest,
      eventId: digest,
      createdAt: timestamp,
      ...overrides,
    };
  }

  function releaseReplay(
    overrides: Partial<Extract<ReleaseResult, { code: 'ALREADY_APPLIED' }>> = {}
  ): Extract<ReleaseResult, { code: 'ALREADY_APPLIED' }> {
    return {
      code: 'ALREADY_APPLIED',
      operation: 'release',
      result: 'release_pending',
      runId: safeId,
      leaseFence: '1',
      terminalControlId: digest,
      eventId: digest,
      createdAt: '2026-07-19T23:58:00.000Z',
      ...overrides,
    };
  }

  function abandonPending(
    overrides: Partial<Extract<AbandonPendingResult, { code: 'ABANDON_PENDING' }>> = {}
  ): Extract<AbandonPendingResult, { code: 'ABANDON_PENDING' }> {
    return {
      code: 'ABANDON_PENDING',
      runId: safeId,
      leaseFence: '1',
      phase: 'abandon_pending',
      terminalControlId: digest,
      eventId: digest,
      reconciledAt: timestamp,
      ...overrides,
    };
  }

  function abandonReplay(
    overrides: Partial<Extract<AbandonPendingResult, { code: 'ALREADY_APPLIED' }>> = {}
  ): Extract<AbandonPendingResult, { code: 'ALREADY_APPLIED' }> {
    return {
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
      result: 'abandon_pending',
      runId: safeId,
      leaseFence: '1',
      phase: 'abandon_pending',
      terminalControlId: digest,
      eventId: digest,
      reconciledAt: '2026-07-19T23:58:00.000Z',
      ...overrides,
    };
  }

  function createTerminalRepository(options: TerminalRepositoryOptions = {}): Readonly<{
    repository: MatrixCorpusRepository;
    releaseCommands: ReleaseRunCommand[];
    abandonCommands: AbandonExpiredRunCommand[];
    mutationCalls: string[];
  }> {
    const base = createRepositorySpy();
    const releaseCommands: ReleaseRunCommand[] = [];
    const abandonCommands: AbandonExpiredRunCommand[] = [];
    const mutationCalls: string[] = [];
    const unexpectedMutation = <Operation extends string>(operation: Operation) => async (): Promise<never> => {
      mutationCalls.push(operation);
      throw new Error(`Unexpected repository mutation: ${operation}`);
    };
    const repository: MatrixCorpusRepository = {
      ...base.repository,
      acquireProvisioningLease: unexpectedMutation(
        'acquireProvisioningLease'
      ) as MatrixCorpusRepository['acquireProvisioningLease'],
      activateRun: unexpectedMutation('activateRun') as MatrixCorpusRepository['activateRun'],
      renewLease: unexpectedMutation('renewLease') as MatrixCorpusRepository['renewLease'],
      issueCapability: unexpectedMutation('issueCapability') as MatrixCorpusRepository['issueCapability'],
      consumeCapabilityAndEnqueueIngest: unexpectedMutation(
        'consumeCapabilityAndEnqueueIngest'
      ) as MatrixCorpusRepository['consumeCapabilityAndEnqueueIngest'],
      quiesceRun: unexpectedMutation('quiesceRun') as MatrixCorpusRepository['quiesceRun'],
      async releaseRun(input): Promise<ReleaseResult> {
        releaseCommands.push(input);
        return repositoryResult(options.release, options.releaseResult ?? releasePending());
      },
      async abandonExpiredRun(input): Promise<AbandonPendingResult> {
        abandonCommands.push(input);
        return repositoryResult(options.abandon, options.abandonResult ?? abandonPending());
      },
      getTransportStatus: unexpectedMutation(
        'getTransportStatus'
      ) as MatrixCorpusRepository['getTransportStatus'],
      cleanupExactRun: unexpectedMutation('cleanupExactRun') as MatrixCorpusRepository['cleanupExactRun'],
      claimPendingIngestOutbox: unexpectedMutation(
        'claimPendingIngestOutbox'
      ) as MatrixCorpusRepository['claimPendingIngestOutbox'],
      renewIngestOutboxClaim: unexpectedMutation(
        'renewIngestOutboxClaim'
      ) as MatrixCorpusRepository['renewIngestOutboxClaim'],
      acknowledgeIngestOutbox: unexpectedMutation(
        'acknowledgeIngestOutbox'
      ) as MatrixCorpusRepository['acknowledgeIngestOutbox'],
      claimPendingTerminalControlOutbox: unexpectedMutation(
        'claimPendingTerminalControlOutbox'
      ) as MatrixCorpusRepository['claimPendingTerminalControlOutbox'],
      renewTerminalControlOutboxClaim: unexpectedMutation(
        'renewTerminalControlOutboxClaim'
      ) as MatrixCorpusRepository['renewTerminalControlOutboxClaim'],
      acknowledgeTerminalControl: unexpectedMutation(
        'acknowledgeTerminalControl'
      ) as MatrixCorpusRepository['acknowledgeTerminalControl'],
    };
    return { repository, releaseCommands, abandonCommands, mutationCalls };
  }

  function createTerminalClient(input: Readonly<{
    status?: unknown;
    throwStatus?: boolean;
    onStatus?: () => void;
  }> = {}): Readonly<{
    client: IntexAgentMatrixCorpusClient;
    acceptanceCalls(): number;
    statusCalls(): number;
    postTerminalControlCalls(): number;
  }> {
    let acceptanceCalls = 0;
    let statusCalls = 0;
    let postTerminalControlCalls = 0;
    const client: IntexAgentMatrixCorpusClient = {
      getTurnTerminal: getTurnTerminalNotReady,
      async getCurrentAcceptance() {
        acceptanceCalls += 1;
        return { kind: 'admission_ready', current: 'absent' };
      },
      async getControlStatus() {
        statusCalls += 1;
        input.onStatus?.();
        if (input.throwStatus === true) throw new Error('status unavailable');
        return (input.status ?? validReleaseStatus) as never;
      },
      async postTerminalControl() {
        postTerminalControlCalls += 1;
        return { kind: 'not_ready' };
      },
    };
    return {
      client,
      acceptanceCalls: () => acceptanceCalls,
      statusCalls: () => statusCalls,
      postTerminalControlCalls: () => postTerminalControlCalls,
    };
  }

  function expectTerminalClientCalls(
    client: ReturnType<typeof createTerminalClient>,
    expectedStatusCalls: number
  ): void {
    expect(client.acceptanceCalls()).toBe(0);
    expect(client.statusCalls()).toBe(expectedStatusCalls);
    expect(client.postTerminalControlCalls()).toBe(0);
  }

  function createIngestIdPortSpy(): Readonly<{
    ids: MatrixCorpusControlDependencies['ids'];
    calls: Readonly<{ ingestReceiptId: number; ingestOutboxId: number }>;
  }> {
    const calls = { ingestReceiptId: 0, ingestOutboxId: 0 };
    return {
      calls,
      ids: {
        ingestReceiptId: () => {
          calls.ingestReceiptId += 1;
          return 'receipt_1';
        },
        ingestOutboxId: () => {
          calls.ingestOutboxId += 1;
          return 'outbox_1';
        },
      },
    };
  }

  function expectNoIngestIdPortCalls(spy: ReturnType<typeof createIngestIdPortSpy>): void {
    expect(spy.calls).toEqual({ ingestReceiptId: 0, ingestOutboxId: 0 });
  }

  it('releases with exact ordered authority, an exact terminal payload, and ignored readiness booleans', async () => {
    const callOrder: string[] = [];
    const leaseSlotDigest = '1'.repeat(64);
    const runFenceDigest = '2'.repeat(64);
    const idempotencyKeyDigest = '3'.repeat(64);
    const canonicalRequestDigest = '4'.repeat(64);
    const terminalControlId = '5'.repeat(64);
    const terminalPayloadDigest = '6'.repeat(64);
    const terminalControl = {
      version: 1,
      eventId: terminalControlId,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      createdAt: timestamp,
      kind: 'release' as const,
      tombstoneDigest: digest,
      terminalCandidateDigest: digest,
      artifactStageDigest: digest,
    };
    const keyedDigests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: ['hetzner-prod', 'user_1'],
        output: leaseSlotDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: ['hetzner-prod', 'user_1', safeId],
        output: runFenceDigest,
      },
      {
        domain: 'imc-operation-idempotency-v1',
        parts: ['release', validReleaseInput.idempotencyKey],
        output: idempotencyKeyDigest,
      },
      {
        domain: 'imc-operation-request-v1',
        parts: [
          'release',
          JSON.stringify({
            runtimeAudience: 'hetzner-prod',
            runId: safeId,
            userId: 'user_1',
            leaseFence: '1',
            contextFinalizationTombstoneDigest: digest,
            terminalCandidateDigest: digest,
            artifactStageDigest: digest,
          }),
        ],
        output: canonicalRequestDigest,
      },
      {
        domain: 'imc-terminal-v1',
        parts: [safeId, '1', 'release'],
        output: terminalControlId,
      },
    ]);
    const sha256 = createExpectedShaQueue([
      {
        canonicalJson: canonicalMatrixCorpusTerminalControlV1(terminalControl),
        output: terminalPayloadDigest,
      },
    ]);
    let clockCalls = 0;
    const client = createTerminalClient({ onStatus: () => callOrder.push('status') });
    const ingestIds = createIngestIdPortSpy();
    const repositorySpy = createTerminalRepository({
      releaseResult: releasePending({ terminalControlId, eventId: terminalControlId }),
    });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        ids: ingestIds.ids,
        clockNow: () => {
          clockCalls += 1;
          callOrder.push('clock');
          return timestamp;
        },
        digests: {
          digest(domain, parts) {
            callOrder.push(domain);
            return keyedDigests.digest.digest(domain, parts);
          },
        },
        sha256: {
          digestCanonical(canonicalJson) {
            callOrder.push('sha256');
            return sha256.sha256.digestCanonical(canonicalJson);
          },
        },
      })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual(releasePending({ terminalControlId, eventId: terminalControlId }));
    expect(clockCalls).toBe(1);
    expect(callOrder).toEqual([
      'clock',
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-operation-idempotency-v1',
      'imc-operation-request-v1',
      'status',
      'imc-terminal-v1',
      'sha256',
    ]);
    expect(keyedDigests.remaining()).toBe(0);
    expect(sha256.remaining()).toBe(0);
    expect(repositorySpy.releaseCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        runId: safeId,
        userId: 'user_1',
        leaseFence: '1',
        leaseSlotDigest,
        runFenceDigest,
        idempotencyKeyDigest,
        canonicalRequestDigest,
        now: timestamp,
        controlStatus: validReleaseStatus,
        terminalControlId,
        terminalControl,
        terminalPayloadDigest,
      },
    ]);
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(JSON.stringify(repositorySpy.releaseCommands)).not.toContain(validReleaseInput.idempotencyKey);
    expectNoIngestIdPortCalls(ingestIds);
    expectTerminalClientCalls(client, 1);
  });

  it('abandons with only deterministic null-digest intent and no Intex Agent call', async () => {
    const leaseSlotDigest = '7'.repeat(64);
    const runFenceDigest = '8'.repeat(64);
    const terminalControlId = '9'.repeat(64);
    const terminalPayloadDigest = 'b'.repeat(64);
    const terminalControl = {
      version: 1,
      eventId: terminalControlId,
      runId: safeId,
      userId: 'user_1',
      leaseFence: '1',
      createdAt: timestamp,
      kind: 'abandoned' as const,
      tombstoneDigest: null,
      terminalCandidateDigest: null,
      artifactStageDigest: null,
    };
    const keyedDigests = createExpectedDigestQueue([
      {
        domain: 'imc-lease-slot-v1',
        parts: ['hetzner-prod', 'user_1'],
        output: leaseSlotDigest,
      },
      {
        domain: 'imc-run-fence-v1',
        parts: ['hetzner-prod', 'user_1', safeId],
        output: runFenceDigest,
      },
      {
        domain: 'imc-terminal-v1',
        parts: [safeId, '1', 'abandoned'],
        output: terminalControlId,
      },
    ]);
    const sha256 = createExpectedShaQueue([
      {
        canonicalJson: canonicalMatrixCorpusTerminalControlV1(terminalControl),
        output: terminalPayloadDigest,
      },
    ]);
    const repositorySpy = createTerminalRepository({
      abandonResult: abandonPending({ terminalControlId, eventId: terminalControlId }),
    });
    const client = createTerminalClient();
    const ingestIds = createIngestIdPortSpy();
    const callOrder: string[] = [];
    let clockCalls = 0;
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        ids: ingestIds.ids,
        clockNow: () => {
          clockCalls += 1;
          callOrder.push('clock');
          return timestamp;
        },
        digests: {
          digest(domain, parts) {
            callOrder.push(domain);
            return keyedDigests.digest.digest(domain, parts);
          },
        },
        sha256: {
          digestCanonical(canonicalJson) {
            callOrder.push('sha256');
            return sha256.sha256.digestCanonical(canonicalJson);
          },
        },
      })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual(abandonPending({ terminalControlId, eventId: terminalControlId }));
    expect(clockCalls).toBe(1);
    expect(callOrder).toEqual([
      'clock',
      'imc-lease-slot-v1',
      'imc-run-fence-v1',
      'imc-terminal-v1',
      'sha256',
    ]);
    expect(keyedDigests.remaining()).toBe(0);
    expect(sha256.remaining()).toBe(0);
    expect(repositorySpy.abandonCommands).toEqual([
      {
        runtimeAudience: 'hetzner-prod',
        observedRunId: safeId,
        observedUserId: 'user_1',
        observedLeaseFence: '1',
        leaseSlotDigest,
        runFenceDigest,
        now: timestamp,
        terminalControlId,
        terminalControl,
        terminalPayloadDigest,
      },
    ]);
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expectNoIngestIdPortCalls(ingestIds);
    expectTerminalClientCalls(client, 0);
  });

  it.each([
    { operation: 'release' as const, input: { ...validReleaseInput, terminalControlId: digest } },
    { operation: 'abandon' as const, input: { ...validAbandonInput, terminalControlId: digest } },
  ])('rejects invalid $operation input before every dependency with only a static log', async ({ operation, input }) => {
    const repositorySpy = createTerminalRepository();
    const client = createTerminalClient();
    const capturedLogger = createCapturingLogger();
    const calls = { clock: 0, keyedDigest: 0, sha256: 0, ingestReceiptId: 0, ingestOutboxId: 0 };
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          calls.clock += 1;
          return timestamp;
        },
        digests: {
          digest: () => {
            calls.keyedDigest += 1;
            return digest;
          },
        },
        sha256: {
          digestCanonical: () => {
            calls.sha256 += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            calls.ingestReceiptId += 1;
            return 'receipt_1';
          },
          ingestOutboxId: () => {
            calls.ingestOutboxId += 1;
            return 'outbox_1';
          },
        },
      })
    );

    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(input as typeof validReleaseInput)
        : await controlPlane.abandonExpiredRun(input as typeof validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'input_contract' });
    expect(calls).toEqual({
      clock: 0,
      keyedDigest: 0,
      sha256: 0,
      ingestReceiptId: 0,
      ingestOutboxId: 0,
    });
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expect(Object.keys(capturedLogger.records[0] ?? {}).sort()).toEqual(['code', 'operation']);
    expectTerminalClientCalls(client, 0);
  });

  it.each([
    { operation: 'release' as const, behavior: 'throw' as const },
    { operation: 'release' as const, behavior: 'malformed' as const },
    { operation: 'abandon' as const, behavior: 'throw' as const },
    { operation: 'abandon' as const, behavior: 'malformed' as const },
  ])('maps a $behavior clock for $operation to command corruption', async ({ operation, behavior }) => {
    const repositorySpy = createTerminalRepository();
    const client = createTerminalClient();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          if (behavior === 'throw') throw new Error('clock unavailable');
          return 'invalid timestamp';
        },
      })
    );

    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(validReleaseInput)
        : await controlPlane.abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expectTerminalClientCalls(client, 0);
  });

  it.each([
    { operation: 'release' as const, call: 1, dependency: 'lease slot' },
    { operation: 'release' as const, call: 2, dependency: 'run fence' },
    { operation: 'release' as const, call: 3, dependency: 'idempotency key' },
    { operation: 'release' as const, call: 4, dependency: 'semantic request' },
    { operation: 'release' as const, call: 5, dependency: 'terminal ID' },
    { operation: 'abandon' as const, call: 1, dependency: 'lease slot' },
    { operation: 'abandon' as const, call: 2, dependency: 'run fence' },
    { operation: 'abandon' as const, call: 3, dependency: 'terminal ID' },
  ].flatMap(({ operation, call, dependency }) =>
    (['throw', 'malformed'] as const).map((behavior) => ({ operation, call, dependency, behavior }))
  ))('maps $operation $dependency keyed-digest $behavior to command corruption', async ({
    operation,
    call,
    behavior,
  }) => {
    const repositorySpy = createTerminalRepository();
    const client = createTerminalClient();
    const capturedLogger = createCapturingLogger();
    let calls = 0;
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
        digests: {
          digest: () => {
            calls += 1;
            if (calls !== call) return digest;
            if (behavior === 'throw') throw new Error('keyed digest unavailable');
            return 'invalid digest';
          },
        },
      })
    );

    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(validReleaseInput)
        : await controlPlane.abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(calls).toBe(call);
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expect(client.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    { operation: 'release' as const, behavior: 'throw' as const },
    { operation: 'release' as const, behavior: 'malformed' as const },
    { operation: 'abandon' as const, behavior: 'throw' as const },
    { operation: 'abandon' as const, behavior: 'malformed' as const },
  ])('maps a $behavior terminal SHA for $operation to command corruption', async ({ operation, behavior }) => {
    const repositorySpy = createTerminalRepository();
    const client = createTerminalClient();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
        sha256: {
          digestCanonical: () => {
            if (behavior === 'throw') throw new Error('SHA unavailable');
            return 'invalid digest';
          },
        },
      })
    );

    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(validReleaseInput)
        : await controlPlane.abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expect(client.postTerminalControlCalls()).toBe(0);
  });

  it.each(['release', 'abandon'] as const)(
    'maps a thrown terminal canonicalizer for %s to command corruption',
    async (operation) => {
      const repositorySpy = createTerminalRepository();
      const client = createTerminalClient();
      const capturedLogger = createCapturingLogger();
      const spy = vi.spyOn(matrixCorpusContracts, 'canonicalMatrixCorpusTerminalControlV1').mockImplementation(() => {
        throw new Error('canonicalization unavailable');
      });
      try {
        const controlPlane = new MatrixCorpusControlPlane(
          createControlDependencies({
            repository: repositorySpy.repository,
            intexAgent: client.client,
            logger: capturedLogger.logger,
          })
        );
        const result =
          operation === 'release'
            ? await controlPlane.releaseRun(validReleaseInput)
            : await controlPlane.abandonExpiredRun(validAbandonInput);

        expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
        expect(repositorySpy.releaseCommands).toEqual([]);
        expect(repositorySpy.abandonCommands).toEqual([]);
        expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
      } finally {
        spy.mockRestore();
      }
    }
  );

  it.each([
    { operation: 'release' as const, behavior: 'throw' as const },
    { operation: 'release' as const, behavior: 'malformed' as const },
    { operation: 'abandon' as const, behavior: 'throw' as const },
    { operation: 'abandon' as const, behavior: 'malformed' as const },
  ])('maps a $behavior $operation repository result to repository corruption', async ({
    operation,
    behavior,
  }) => {
    const repositorySpy = createTerminalRepository(
      operation === 'release' ? { release: behavior } : { abandon: behavior }
    );
    const client = createTerminalClient();
    const capturedLogger = createCapturingLogger();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
      })
    );

    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(validReleaseInput)
        : await controlPlane.abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(operation === 'release' ? repositorySpy.releaseCommands : repositorySpy.abandonCommands).toHaveLength(1);
    expect(capturedLogger.records).toEqual([{ operation, code: 'CORRUPT_STATE' }]);
    expect(client.postTerminalControlCalls()).toBe(0);
  });

  it.each([
    { label: 'throw', throwStatus: true },
    { label: 'malformed', status: { kind: 'status', unsafe: 'hidden' } },
    { label: 'not-ready', status: { kind: 'not_ready' } },
    { label: 'wrong run identity', status: { ...validReleaseStatus, runId: 'run_2' } },
    { label: 'wrong user identity', status: { ...validReleaseStatus, userId: 'user_2' } },
    { label: 'wrong fence identity', status: { ...validReleaseStatus, leaseFence: '2' } },
    { label: 'wrong lifecycle', status: { ...validReleaseStatus, lifecycle: 'running' } },
    {
      label: 'null tombstone digest',
      status: { ...validReleaseStatus, contextFinalizationTombstoneDigest: null },
    },
    { label: 'null candidate digest', status: { ...validReleaseStatus, terminalCandidateDigest: null } },
    { label: 'null artifact digest', status: { ...validReleaseStatus, artifactStageDigest: null } },
    {
      label: 'mismatched tombstone digest',
      status: { ...validReleaseStatus, contextFinalizationTombstoneDigest: 'b'.repeat(64) },
    },
    {
      label: 'mismatched candidate digest',
      status: { ...validReleaseStatus, terminalCandidateDigest: 'b'.repeat(64) },
    },
    {
      label: 'mismatched artifact digest',
      status: { ...validReleaseStatus, artifactStageDigest: 'b'.repeat(64) },
    },
  ])('passes strict not-ready proof to release repository for $label status', async ({ status, throwStatus }) => {
    const repositorySpy = createTerminalRepository({
      releaseResult: { code: 'NOT_READY', gate: 'release' },
    });
    const client = createTerminalClient({
      ...(status === undefined ? {} : { status }),
      ...(throwStatus === undefined ? {} : { throwStatus }),
    });
    const ingestIds = createIngestIdPortSpy();
    const capturedLogger = createCapturingLogger();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
        ids: ingestIds.ids,
      })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual({ code: 'NOT_READY', gate: 'release' });
    expect(repositorySpy.releaseCommands).toHaveLength(1);
    expect(repositorySpy.releaseCommands[0]?.controlStatus).toEqual({ kind: 'not_ready' });
    expect(repositorySpy.abandonCommands).toEqual([]);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expect(capturedLogger.records).toEqual([{ operation: 'release', code: 'NOT_READY' }]);
    expect(JSON.stringify(capturedLogger.records)).not.toContain('hidden');
    expectNoIngestIdPortCalls(ingestIds);
    expectTerminalClientCalls(client, 1);
  });

  it('accepts a correlated release replay with historical time during a status outage', async () => {
    const replay = releaseReplay();
    const repositorySpy = createTerminalRepository({ releaseResult: replay });
    const client = createTerminalClient({ throwStatus: true });
    const capturedLogger = createCapturingLogger();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: capturedLogger.logger,
      })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual(replay);
    expect(repositorySpy.releaseCommands).toHaveLength(1);
    expect(repositorySpy.releaseCommands[0]?.controlStatus).toEqual({ kind: 'not_ready' });
    expect(capturedLogger.records).toEqual([{ operation: 'release', code: 'NOT_READY' }]);
    expectTerminalClientCalls(client, 1);
  });

  it.each([
    { field: 'run ID', result: releasePending({ runId: 'run_2' }) },
    { field: 'fence', result: releasePending({ leaseFence: '2' }) },
    {
      field: 'terminal IDs',
      result: releasePending({ terminalControlId: 'terminal_2', eventId: 'terminal_2' }),
    },
    { field: 'created time', result: releasePending({ createdAt: '2026-07-20T00:00:01.000Z' }) },
  ])('rejects a fresh release result with mismatched $field', async ({ result: repositoryResult }) => {
    expect(releaseResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createTerminalRepository({ releaseResult: repositoryResult });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createTerminalClient().client })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.releaseCommands).toHaveLength(1);
  });

  it.each([
    { field: 'run ID', result: releaseReplay({ runId: 'run_2' }) },
    { field: 'fence', result: releaseReplay({ leaseFence: '2' }) },
    {
      field: 'terminal IDs',
      result: releaseReplay({ terminalControlId: 'terminal_2', eventId: 'terminal_2' }),
    },
  ])('rejects a release replay with mismatched $field while historical time remains valid', async ({
    result: repositoryResult,
  }) => {
    expect(releaseResultSchema.safeParse(repositoryResult).success).toBe(true);
    const repositorySpy = createTerminalRepository({ releaseResult: repositoryResult });
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: createTerminalClient().client })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.releaseCommands).toHaveLength(1);
  });

  it.each([
    { field: 'run ID', result: abandonPending({ runId: 'run_2' }) },
    { field: 'fence', result: abandonPending({ leaseFence: '2' }) },
    { field: 'phase', result: abandonPending({ phase: 'abandoned' as never }) },
    {
      field: 'terminal IDs',
      result: abandonPending({ terminalControlId: 'terminal_2', eventId: 'terminal_2' }),
    },
    { field: 'reconciliation time', result: abandonPending({ reconciledAt: '2026-07-20T00:00:01.000Z' }) },
  ])('rejects a fresh abandon result with mismatched $field', async ({ result: repositoryResult }) => {
    const repositorySpy = createTerminalRepository({ abandonResult: repositoryResult });
    const client = createTerminalClient();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: client.client })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.abandonCommands).toHaveLength(1);
    expectTerminalClientCalls(client, 0);
  });

  it('accepts a correlated abandon replay with historical reconciliation time', async () => {
    const replay = abandonReplay();
    const repositorySpy = createTerminalRepository({ abandonResult: replay });
    const client = createTerminalClient();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: client.client })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual(replay);
    expect(repositorySpy.abandonCommands).toHaveLength(1);
    expectTerminalClientCalls(client, 0);
  });

  it.each([
    { field: 'run ID', result: abandonReplay({ runId: 'run_2' }) },
    { field: 'fence', result: abandonReplay({ leaseFence: '2' }) },
    { field: 'phase', result: abandonReplay({ phase: 'abandoned' as never }) },
    {
      field: 'terminal IDs',
      result: abandonReplay({ terminalControlId: 'terminal_2', eventId: 'terminal_2' }),
    },
  ])('rejects an abandon replay with mismatched $field', async ({ result: repositoryResult }) => {
    const repositorySpy = createTerminalRepository({ abandonResult: repositoryResult });
    const client = createTerminalClient();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: client.client })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.abandonCommands).toHaveLength(1);
    expectTerminalClientCalls(client, 0);
  });

  it('accepts an exact abandon stale-fence result and passes it through without disclosure', async () => {
    expect(abandonPendingResultSchema.safeParse({ code: 'STALE_FENCE' }).success).toBe(true);
    expect(abandonPendingResultSchema.safeParse({ code: 'STALE_FENCE', actualPhase: 'active' }).success).toBe(false);

    const repositorySpy = createTerminalRepository({ abandonResult: { code: 'STALE_FENCE' } });
    const client = createTerminalClient();
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: client.client })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'STALE_FENCE' });
    expect(repositorySpy.abandonCommands).toHaveLength(1);
    expectTerminalClientCalls(client, 0);
  });

  it.each([
    { operation: 'release' as const, result: { code: 'STALE_FENCE' } as const },
    { operation: 'abandon' as const, result: { code: 'NOT_FOUND' } as const },
  ])('passes through static $operation repository results after strict parsing', async ({ operation, result: repositoryResult }) => {
    const repositorySpy = createTerminalRepository(
      operation === 'release' ? { releaseResult: repositoryResult } : { abandonResult: repositoryResult }
    );
    const client = createTerminalClient();
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({ repository: repositorySpy.repository, intexAgent: client.client })
    );
    const result =
      operation === 'release'
        ? await controlPlane.releaseRun(validReleaseInput)
        : await controlPlane.abandonExpiredRun(validAbandonInput);

    expect(result).toEqual(repositoryResult);
    expect(operation === 'release' ? repositorySpy.releaseCommands : repositorySpy.abandonCommands).toHaveLength(1);
    expect(client.postTerminalControlCalls()).toBe(0);
  });

  it('swallows a throwing logger while release status degradation still admits one replay call', async () => {
    const repositorySpy = createTerminalRepository({ releaseResult: releaseReplay() });
    const client = createTerminalClient({ throwStatus: true });
    const throwingLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger unavailable');
      },
      debug: () => undefined,
    };
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: throwingLogger,
      })
    ).releaseRun(validReleaseInput);

    expect(result).toEqual(releaseReplay());
    expect(repositorySpy.releaseCommands).toHaveLength(1);
    expectTerminalClientCalls(client, 1);
  });

  it('swallows a throwing logger without changing abandon repository corruption', async () => {
    const repositorySpy = createTerminalRepository({ abandon: 'malformed' });
    const client = createTerminalClient();
    const ingestIds = createIngestIdPortSpy();
    const throwingLogger: Logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => {
        throw new Error('logger unavailable');
      },
      debug: () => undefined,
    };
    const result = await new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: repositorySpy.repository,
        intexAgent: client.client,
        logger: throwingLogger,
        ids: ingestIds.ids,
      })
    ).abandonExpiredRun(validAbandonInput);

    expect(result).toEqual({ code: 'CORRUPT_STATE', recordKind: 'repository_result' });
    expect(repositorySpy.releaseCommands).toEqual([]);
    expect(repositorySpy.abandonCommands).toHaveLength(1);
    expect(repositorySpy.mutationCalls).toEqual([]);
    expectNoIngestIdPortCalls(ingestIds);
    expectTerminalClientCalls(client, 0);
  });
});

describe('FakeMatrixCorpusRepository A2 fake core', () => {
  function acquireCommand(overrides: Partial<AcquireProvisioningLeaseCommand> = {}): AcquireProvisioningLeaseCommand {
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      now: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
      acquisitionReadiness: { kind: 'admission_ready', current: 'absent' },
      ...overrides,
    };
  }

  function activateCommand(
    overrides: Partial<import('../../../domain/matrixCorpus/types.js').ActivateRunCommand> = {}
  ): import('../../../domain/matrixCorpus/types.js').ActivateRunCommand {
    return {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: 'e'.repeat(64),
      canonicalRequestDigest: 'f'.repeat(64),
      now: '2026-07-20T00:00:01.000Z',
      controlStatus: {
        kind: 'status' as const,
        runId: 'run_1',
        userId: 'user_1',
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
      ...overrides,
    } satisfies import('../../../domain/matrixCorpus/types.js').ActivateRunCommand;
  }

  function renewCommand(overrides: Partial<import('../../../domain/matrixCorpus/types.js').RenewLeaseCommand> = {}) {
    return {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: '0'.repeat(64),
      canonicalRequestDigest: 'a'.repeat(64),
      now: '2026-07-20T00:00:02.000Z',
      expiresAt: '2026-07-20T00:01:02.000Z',
      ...overrides,
    } satisfies import('../../../domain/matrixCorpus/types.js').RenewLeaseCommand;
  }

  function terminalSeedPair(fenceEpoch: string) {
    const runId = 'run_9';
    const acquiredAt = timestamp;
    const expiresAt = '2026-07-20T00:01:00.000Z';
    const acquire = {
      version: 1 as const,
      operation: 'acquire' as const,
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      resultCode: 'ACQUIRED' as const,
      replayProjection: {
        operation: 'acquire' as const,
        result: 'acquired' as const,
        runId,
        leaseFence: fenceEpoch,
        phase: 'provisioning' as const,
        acquiredAt,
        expiresAt,
      },
      resultDigest: digest,
      recordedAt: acquiredAt,
    };
    const activate = {
      version: 1 as const,
      operation: 'activate' as const,
      idempotencyKeyDigest: 'e'.repeat(64),
      canonicalRequestDigest: 'f'.repeat(64),
      resultCode: 'ACTIVATED' as const,
      replayProjection: {
        operation: 'activate' as const,
        result: 'activated' as const,
        runId,
        leaseFence: fenceEpoch,
        phase: 'active' as const,
        activatedAt: acquiredAt,
      },
      resultDigest: digest,
      recordedAt: acquiredAt,
    };
    const quiesce = {
      version: 1 as const,
      operation: 'quiesce' as const,
      idempotencyKeyDigest: '0'.repeat(64),
      canonicalRequestDigest: '1'.repeat(64),
      resultCode: 'QUIESCED' as const,
      replayProjection: {
        operation: 'quiesce' as const,
        result: 'quiesced' as const,
        runId,
        leaseFence: fenceEpoch,
        phase: 'quiescing' as const,
        quiescedAt: acquiredAt,
        drained: true,
      },
      resultDigest: digest,
      recordedAt: acquiredAt,
    };
    const release = {
      version: 1 as const,
      operation: 'release' as const,
      idempotencyKeyDigest: '2'.repeat(64),
      canonicalRequestDigest: '3'.repeat(64),
      resultCode: 'RELEASE_PENDING' as const,
      replayProjection: {
        operation: 'release' as const,
        result: 'release_pending' as const,
        runId,
        leaseFence: fenceEpoch,
        terminalControlId: 'event_1',
        eventId: 'event_1',
        createdAt: acquiredAt,
      },
      resultDigest: digest,
      recordedAt: acquiredAt,
    };
    const current = {
      version: 1 as const,
      runtimeAudience: 'hetzner-prod' as const,
      runId,
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      phase: 'released' as const,
      leaseFence: fenceEpoch,
      fenceEpoch,
      acquiredAt,
      activatedAt: acquiredAt,
      renewedAt: acquiredAt,
      expiresAt,
      quiescedAt: acquiredAt,
      releasedAt: acquiredAt,
      abandonedAt: null,
      operationReceipts: { acquire, activate, quiesce, release },
      renewReceiptIds: [],
      capabilityIssuanceReceiptIds: [],
      unconsumedCapability: null,
      capabilityDigests: [],
      terminalFailureReceiptRefs: [],
      nonterminalIngestOutboxIds: [],
      ingestOutboxIds: [],
      terminalControlOutboxIds: ['event_1'],
      transportReceiptIds: [],
      drain: {
        consumedCapabilityCount: 0,
        terminalIntexMarkerCount: 0,
        terminalOutboxCount: 0,
        replyOrDeliveryWorkInFlight: 0,
        drained: false,
      },
      terminalWinner: {
        kind: 'release' as const,
        eventId: 'event_1',
        payloadDigest: digest,
        outcome: 'completed_passed' as const,
        acknowledgedAt: acquiredAt,
      },
      cleanupProgress: null,
      finalCleanupReceipt: null,
    };
    return { pair: { leaseSlotDigest: digest, current, history: { ...current, leaseSlotDigest: digest } }, renewReceipts: [] };
  }

  async function activeRepository(acquireOverrides: Partial<AcquireProvisioningLeaseCommand> = {}) {
    let digestCalls = 0;
    const digestEvidence: MatrixCorpusReplayProjectionEvidence[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          digestCalls += 1;
          digestEvidence.push(safeReplayProjectionEvidence(projection));
          return digest;
        },
      },
    });
    await repository.acquireProvisioningLease(acquireCommand(acquireOverrides));
    await repository.activateRun(activateCommand());
    return { repository, digestCalls: () => digestCalls, digestEvidence: () => structuredClone(digestEvidence) };
  }

  function issueCommand(
    overrides: Partial<import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand> = {}
  ) {
    const { rawCapability: _rawCapability, ...capabilityFields } = validIssueInput;
    return {
      now: '2026-07-20T00:00:02.000Z',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      capability: {
        ...capabilityFields,
        capabilityDigest: '1'.repeat(64),
        issueRequestDigest: '2'.repeat(64),
        issuedAt: '2026-07-20T00:00:02.000Z',
        expiresAt: '2026-07-20T00:01:02.000Z',
        consumedAt: null,
        consumedTransportMessageIdDigest: null,
        ingestOutboxId: null,
        revokedAt: null,
      },
      ...overrides,
    } satisfies import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand;
  }

  function consumeCommand(
    overrides: Partial<ConsumeCapabilityAndEnqueueIngestCommand> = {}
  ): ConsumeCapabilityAndEnqueueIngestCommand {
    const issue = issueCommand();
    return {
      now: '2026-07-20T00:00:03.000Z',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      capabilityDigest: issue.capability.capabilityDigest,
      transportMessageIdDigest: '3'.repeat(64),
      ingestReceiptId: 'receipt_1',
      ingestOutboxId: 'outbox_1',
      facts: {
        ...validConsumeInput.facts,
        ingressRequest: {
          ...validConsumeInput.facts.ingressRequest,
          capabilityDigest: issue.capability.capabilityDigest,
          transportMessageIdDigest: '3'.repeat(64),
          ingestReceiptId: 'receipt_1',
          ingestOutboxId: 'outbox_1',
        },
        payload: {
          ...validConsumeInput.facts.payload,
          context: { ...validConsumeInput.facts.payload.context, ingestReceiptId: 'receipt_1' },
        },
      },
      payloadDigest: digest,
      ingressRequestDigest: digest,
      ...overrides,
    };
  }

  function quiesceCommand(overrides: Partial<QuiesceRunCommand> = {}): QuiesceRunCommand {
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: '7'.repeat(64),
      canonicalRequestDigest: '8'.repeat(64),
      now: '2026-07-20T00:00:04.000Z',
      ...overrides,
    };
  }

  function transportStatusCommand(
    overrides: Partial<GetTransportStatusCommand> = {}
  ): GetTransportStatusCommand {
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      now: '2026-07-20T00:01:00.000Z',
      ...overrides,
    };
  }

  function abandonedTerminalOutbox(
    terminalControlId = 'terminal_abandoned',
    createdAt = '2026-07-20T00:01:00.000Z'
  ): MatrixCorpusTerminalControlOutboxRecordV1 {
    return {
      version: 1,
      terminalControlId,
      eventId: terminalControlId,
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      kind: 'abandoned',
      payload: {
        version: 1,
        kind: 'abandoned',
        eventId: terminalControlId,
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '1',
        createdAt,
        tombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      },
      payloadDigest: digest,
      status: 'pending',
      claim: null,
      acknowledgedAt: null,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt,
    };
  }

  function releaseCommand(overrides: Partial<ReleaseRunCommand> = {}): ReleaseRunCommand {
    const terminalControlId = 'terminal_release';
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: 'a'.repeat(64),
      canonicalRequestDigest: 'c'.repeat(64),
      now: '2026-07-20T00:00:05.000Z',
      controlStatus: {
        kind: 'status',
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '1',
        lifecycle: 'finalizing',
        contextReady: true,
        manifestReady: true,
        preflightProjectionReady: true,
        retentionReconciled: true,
        contextFinalizationTombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      terminalControlId,
      terminalControl: {
        version: 1,
        kind: 'release',
        eventId: terminalControlId,
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '1',
        createdAt: '2026-07-20T00:00:05.000Z',
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      terminalPayloadDigest: digest,
      ...overrides,
    };
  }

  function abandonCommand(
    overrides: Partial<AbandonExpiredRunCommand> = {}
  ): AbandonExpiredRunCommand {
    const terminalControlId = 'terminal_abandoned';
    return {
      runtimeAudience: 'hetzner-prod',
      observedRunId: 'run_1',
      observedUserId: 'user_1',
      observedLeaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      now: '2026-07-20T00:01:00.000Z',
      terminalControlId,
      terminalControl: {
        version: 1,
        kind: 'abandoned',
        eventId: terminalControlId,
        runId: 'run_1',
        userId: 'user_1',
        leaseFence: '1',
        createdAt: '2026-07-20T00:01:00.000Z',
        tombstoneDigest: null,
        terminalCandidateDigest: null,
        artifactStageDigest: null,
      },
      terminalPayloadDigest: digest,
      ...overrides,
    };
  }

  function abandonPendingSeed(): FakeMatrixCorpusLifecycleSeed {
    const terminal = abandonedTerminalOutbox();
    const predecessor = issueConsumeSeed({
      issued: [],
      leaseOverrides: {
        phase: 'abandon_pending',
        terminalControlOutboxIds: [terminal.terminalControlId],
      },
    });
    return { ...predecessor, terminalControlOutboxes: [terminal] };
  }

  function quiescingSeed(): FakeMatrixCorpusLifecycleSeed {
    const releasePending = releasePendingSeed('pending');
    const current = {
      ...releasePending.pair.current,
      phase: 'quiescing' as const,
      terminalControlOutboxIds: [],
      operationReceipts: { ...releasePending.pair.current.operationReceipts, release: null },
      drain: {
        ...releasePending.pair.current.drain,
        drained: true,
      },
    } satisfies MatrixCorpusLeaseV1;
    return {
      ...releasePending,
      pair: {
        leaseSlotDigest: releasePending.pair.leaseSlotDigest,
        current,
        history: { ...current, leaseSlotDigest: releasePending.pair.leaseSlotDigest },
      },
      terminalControlOutboxes: [],
    };
  }

  function nonDrainedQuiescingSeed(
    input: Readonly<{
      issued?: readonly Readonly<{
        capability: MatrixCorpusCapabilityV1;
        receipt: MatrixCorpusCapabilityIssuanceReceiptV1;
      }>[];
      transportReceipts?: readonly MatrixCorpusTransportReceiptV1[];
      ingestOutboxes?: readonly MatrixCorpusIngestOutboxRecordV1[];
      unconsumedCapability?: MatrixCorpusLeaseV1['unconsumedCapability'];
      drain: MatrixCorpusLeaseV1['drain'];
    }>
  ): FakeMatrixCorpusLifecycleSeed {
    const predecessor = issueConsumeSeed({
      issued: input.issued ?? [],
      ...(input.transportReceipts === undefined
        ? {}
        : { transportReceipts: input.transportReceipts }),
      ...(input.ingestOutboxes === undefined ? {} : { ingestOutboxes: input.ingestOutboxes }),
      ...(input.unconsumedCapability === undefined
        ? {}
        : { unconsumedCapability: input.unconsumedCapability }),
    });
    const quiesceReceipt = quiescingSeed().pair.current.operationReceipts.quiesce;
    if (quiesceReceipt === null) throw new Error('quiescing seed requires a quiesce receipt');
    const current = {
      ...predecessor.pair.current,
      phase: 'quiescing' as const,
      quiescedAt: '2026-07-20T00:00:04.000Z',
      operationReceipts: { ...predecessor.pair.current.operationReceipts, quiesce: quiesceReceipt },
      drain: input.drain,
    } satisfies MatrixCorpusLeaseV1;
    return {
      ...predecessor,
      pair: {
        leaseSlotDigest: predecessor.pair.leaseSlotDigest,
        current,
        history: { ...current, leaseSlotDigest: predecessor.pair.leaseSlotDigest },
      },
      terminalControlOutboxes: [],
    };
  }

  function abandonWithExpiredReleaseSeed(): FakeMatrixCorpusLifecycleSeed {
    const releasePending = releasePendingSeed('pending');
    const release = releasePending.terminalControlOutboxes[0];
    if (release === undefined) throw new Error('release seed requires one terminal outbox');
    const closedRelease = {
      ...release,
      status: 'closed' as const,
      closedReason: 'expired_unclaimed_release' as const,
      closedAt: '2026-07-20T00:01:00.000Z',
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const abandoned = abandonedTerminalOutbox();
    const current = {
      ...releasePending.pair.current,
      phase: 'abandon_pending' as const,
      terminalControlOutboxIds: [closedRelease.terminalControlId, abandoned.terminalControlId],
      drain: { ...releasePending.pair.current.drain, drained: false },
    } satisfies MatrixCorpusLeaseV1;
    return {
      ...releasePending,
      pair: {
        leaseSlotDigest: releasePending.pair.leaseSlotDigest,
        current,
        history: { ...current, leaseSlotDigest: releasePending.pair.leaseSlotDigest },
      },
      terminalControlOutboxes: [abandoned, closedRelease],
    };
  }

  function releasePendingSeed(status: 'pending' | 'claimed'): FakeMatrixCorpusLifecycleSeed {
    const terminal = {
      ...releaseCommand().terminalControl,
      eventId: 'terminal_release',
    };
    const releaseOutbox = {
      version: 1,
      terminalControlId: 'terminal_release',
      eventId: 'terminal_release',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      kind: 'release',
      payload: terminal,
      payloadDigest: digest,
      status,
      claim:
        status === 'claimed'
          ? {
              ownerDigest: 'e'.repeat(64),
              purpose: 'publish',
              claimedAt: '2026-07-20T00:00:05.000Z',
              expiresAt: '2026-07-20T00:05:05.000Z',
            }
          : null,
      acknowledgedAt: null,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: '2026-07-20T00:00:05.000Z',
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const predecessor = issueConsumeSeed({ issued: [] });
    const quiesceReceipt = {
      version: 1,
      operation: 'quiesce',
      idempotencyKeyDigest: '7'.repeat(64),
      canonicalRequestDigest: '8'.repeat(64),
      resultCode: 'QUIESCED',
      replayProjection: {
        operation: 'quiesce',
        result: 'quiesced',
        runId: 'run_1',
        leaseFence: '1',
        phase: 'quiescing',
        quiescedAt: '2026-07-20T00:00:04.000Z',
        drained: true,
      },
      resultDigest: digest,
      recordedAt: '2026-07-20T00:00:04.000Z',
    } as const;
    const releaseReceipt = {
      version: 1,
      operation: 'release',
      idempotencyKeyDigest: 'a'.repeat(64),
      canonicalRequestDigest: 'c'.repeat(64),
      resultCode: 'RELEASE_PENDING',
      replayProjection: {
        operation: 'release',
        result: 'release_pending',
        runId: 'run_1',
        leaseFence: '1',
        terminalControlId: 'terminal_release',
        eventId: 'terminal_release',
        createdAt: '2026-07-20T00:00:05.000Z',
      },
      resultDigest: digest,
      recordedAt: '2026-07-20T00:00:05.000Z',
    } as const;
    const current = {
      ...predecessor.pair.current,
      phase: 'release_pending' as const,
      quiescedAt: '2026-07-20T00:00:04.000Z',
      operationReceipts: {
        ...predecessor.pair.current.operationReceipts,
        quiesce: quiesceReceipt,
        release: releaseReceipt,
      },
      terminalControlOutboxIds: ['terminal_release'],
      drain: {
        consumedCapabilityCount: 0,
        terminalIntexMarkerCount: 0,
        terminalOutboxCount: 0,
        replyOrDeliveryWorkInFlight: 0,
        drained: false,
      },
    } satisfies MatrixCorpusLeaseV1;
    return {
      ...predecessor,
      pair: {
        leaseSlotDigest: predecessor.pair.leaseSlotDigest,
        current,
        history: { ...current, leaseSlotDigest: predecessor.pair.leaseSlotDigest },
      },
      terminalControlOutboxes: [releaseOutbox],
    };
  }

  function provisioningCleanupSeed(): FakeMatrixCorpusLifecycleSeed {
    const predecessor = issueConsumeSeed({ issued: [] });
    const current = {
      ...predecessor.pair.current,
      phase: 'provisioning' as const,
      activatedAt: null,
      quiescedAt: null,
      operationReceipts: {
        ...predecessor.pair.current.operationReceipts,
        activate: null,
        quiesce: null,
        release: null,
      },
      finalCleanupReceipt: {
        version: 1,
        idempotencyKeyDigest: '7'.repeat(64),
        canonicalRequestDigest: '8'.repeat(64),
        expectedRevision: 0,
        committedRevision: 1,
        replayProjection: {
          operation: 'cleanup',
          result: 'cleaned',
          targetRunId: 'run_old',
          targetLeaseFence: '2',
          targetRunFenceDigest: '9'.repeat(64),
          finalRevision: 1,
          cleanedAt: '2026-07-20T00:00:00.000Z',
        },
        resultDigest: digest,
        recordedAt: '2026-07-20T00:00:00.000Z',
      },
    } satisfies MatrixCorpusLeaseV1;
    return {
      ...predecessor,
      pair: {
        leaseSlotDigest: predecessor.pair.leaseSlotDigest,
        current,
        history: { ...current, leaseSlotDigest: predecessor.pair.leaseSlotDigest },
      },
      terminalControlOutboxes: [],
    };
  }

  function consumeCommandForTransport(
    transportMessageIdDigest: string,
    ingestReceiptId: string,
    ingestOutboxId: string,
    ingressRequestDigest: string
  ): ConsumeCapabilityAndEnqueueIngestCommand {
    const base = consumeCommand();
    return {
      ...base,
      transportMessageIdDigest,
      ingestReceiptId,
      ingestOutboxId,
      ingressRequestDigest,
      facts: {
        ...base.facts,
        ingressRequestDigest,
        ingressRequest: {
          ...base.facts.ingressRequest,
          transportMessageIdDigest,
          ingestReceiptId,
          ingestOutboxId,
        },
        payload: {
          ...base.facts.payload,
          context: { ...base.facts.payload.context, ingestReceiptId },
        },
      },
    };
  }

  function consumeCommandForCapability(
    capability: MatrixCorpusCapabilityV1,
    transportMessageIdDigest: string,
    ingestReceiptId: string,
    ingestOutboxId: string,
    ingressRequestDigest: string
  ): ConsumeCapabilityAndEnqueueIngestCommand {
    const command = consumeCommandForTransport(
      transportMessageIdDigest,
      ingestReceiptId,
      ingestOutboxId,
      ingressRequestDigest
    );
    return {
      ...command,
      capabilityDigest: capability.capabilityDigest,
      facts: {
        ...command.facts,
        ingressRequest: {
          ...command.facts.ingressRequest,
          capabilityDigest: capability.capabilityDigest,
        },
      },
    };
  }

  function indexedDigest(index: number): string {
    return index.toString(16).padStart(64, '0');
  }

  function seededCapability(
    index: number,
    overrides: Partial<MatrixCorpusCapabilityV1> = {}
  ): Readonly<{
    capability: MatrixCorpusCapabilityV1;
    receipt: MatrixCorpusCapabilityIssuanceReceiptV1;
  }> {
    const capability = {
      ...issueCommand().capability,
      matrixIdempotencyKeyDigest: indexedDigest(1_000 + index),
      issueRequestDigest: indexedDigest(2_000 + index),
      capabilityDigest: indexedDigest(3_000 + index),
      ...overrides,
    } satisfies MatrixCorpusCapabilityV1;
    const receipt = {
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
      replayProjection: {
        operation: 'issue',
        result: 'issued',
        runId: capability.runId,
        scenarioId: capability.scenarioId,
        phase: capability.phase,
        turnIndex: capability.turnIndex,
        issuedAt: capability.issuedAt,
        expiresAt: capability.expiresAt,
      },
      resultDigest: digest,
      recordedAt: capability.issuedAt,
    } satisfies MatrixCorpusCapabilityIssuanceReceiptV1;
    return { capability, receipt };
  }

  function seededOutbox(
    index: number,
    status: 'pending' | 'claimed' | 'published' | 'closed' = 'pending'
  ): MatrixCorpusIngestOutboxRecordV1 {
    const ingestOutboxId = `outbox_${String(index)}`;
    const ingestReceiptId = `receipt_${String(index)}`;
    const payload = {
      ...attestedPayload,
      context: { ...attestedPayload.context, ingestReceiptId },
    };
    const base = {
      version: 1,
      ingestOutboxId,
      ingestReceiptId,
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      payload,
      payloadDigest: indexedDigest(4_000 + index),
      status: 'pending',
      claim: null,
      publisherReceiptDigest: null,
      publishedAt: null,
      terminalMarker: null,
      closedReason: null,
      acknowledgementReceipts: [],
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: '2026-07-20T00:00:03.000Z',
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    if (status === 'pending') return base;
    if (status === 'claimed') {
      return {
        ...base,
        status,
        claim: {
          ownerDigest: indexedDigest(4_500 + index),
          purpose: 'publish',
          claimedAt: '2026-07-20T00:00:04.000Z',
          expiresAt: '2026-07-20T00:05:04.000Z',
        },
      };
    }
    if (status === 'closed') {
      return {
        ...base,
        status,
        closedReason: 'quiesced',
        closedAt: '2026-07-20T00:00:04.000Z',
      };
    }
    const ownerDigest = indexedDigest(4_500 + index);
    const publisherReceiptDigest = indexedDigest(4_700 + index);
    const publishedAt = '2026-07-20T00:00:04.000Z';
    const publishClaimExpiresAt = '2026-07-20T00:05:04.000Z';
    return {
      ...base,
      status,
      claim: {
        ownerDigest,
        purpose: 'terminal_marker_recovery',
        claimedAt: '2026-07-20T00:05:04.000Z',
        expiresAt: '2026-07-20T00:10:04.000Z',
      },
      publisherReceiptDigest,
      publishedAt,
      acknowledgementReceipts: [
        {
          version: 1,
          ownerDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: publishClaimExpiresAt,
          outcome: { kind: 'publication_acknowledged', publisherReceiptDigest, publishedAt },
          acknowledgedAt: publishedAt,
          drained: false,
        },
      ],
    };
  }

  function acceptedTransportReceipt(
    capability: MatrixCorpusCapabilityV1,
    outbox: MatrixCorpusIngestOutboxRecordV1,
    transportMessageIdDigest: string
  ): MatrixCorpusTransportReceiptV1 {
    return {
      version: 1,
      transportMessageIdDigest,
      capabilityDigest: capability.capabilityDigest,
      runId: capability.runId,
      leaseFence: capability.leaseFence,
      userId: capability.userId,
      promptDigest: capability.promptDigest,
      ingressRequestDigest: indexedDigest(5_000),
      ingestReceiptId: outbox.ingestReceiptId,
      ingestOutboxId: outbox.ingestOutboxId,
      acceptedAt: outbox.createdAt,
      recordedAt: outbox.createdAt,
      terminalFailureCode: null,
    };
  }

  function terminalTransportReceipt(
    capability: MatrixCorpusCapabilityV1,
    index: number,
    terminalFailureCode: 'CAPABILITY_REPLAY' | 'CAPABILITY_EXPIRED' | 'CAPABILITY_REVOKED' | 'CAPABILITY_MISMATCH'
  ): MatrixCorpusTransportReceiptV1 {
    return {
      version: 1,
      transportMessageIdDigest: indexedDigest(6_000 + index),
      capabilityDigest: capability.capabilityDigest,
      runId: capability.runId,
      leaseFence: capability.leaseFence,
      userId: capability.userId,
      promptDigest: capability.promptDigest,
      ingressRequestDigest: indexedDigest(7_000 + index),
      ingestReceiptId: null,
      ingestOutboxId: null,
      acceptedAt: null,
      recordedAt: '2026-07-20T00:00:04.000Z',
      terminalFailureCode,
    };
  }

  function issueConsumeSeed(input: Readonly<{
    issued: readonly Readonly<{
      capability: MatrixCorpusCapabilityV1;
      receipt: MatrixCorpusCapabilityIssuanceReceiptV1;
    }>[];
    transportReceipts?: readonly MatrixCorpusTransportReceiptV1[];
    ingestOutboxes?: readonly MatrixCorpusIngestOutboxRecordV1[];
    unconsumedCapability?: MatrixCorpusLeaseV1['unconsumedCapability'];
    leaseOverrides?: Partial<MatrixCorpusLeaseV1>;
  }>): FakeMatrixCorpusIssueConsumeSeed {
    const transportReceipts = input.transportReceipts ?? [];
    const ingestOutboxes = input.ingestOutboxes ?? [];
    const acquire = {
      version: 1,
      operation: 'acquire',
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      resultCode: 'ACQUIRED',
      replayProjection: {
        operation: 'acquire',
        result: 'acquired',
        runId: 'run_1',
        leaseFence: '1',
        phase: 'provisioning',
        acquiredAt: timestamp,
        expiresAt: '2026-07-20T00:01:00.000Z',
      },
      resultDigest: digest,
      recordedAt: timestamp,
    } as const;
    const activate = {
      version: 1,
      operation: 'activate',
      idempotencyKeyDigest: 'e'.repeat(64),
      canonicalRequestDigest: 'f'.repeat(64),
      resultCode: 'ACTIVATED',
      replayProjection: {
        operation: 'activate',
        result: 'activated',
        runId: 'run_1',
        leaseFence: '1',
        phase: 'active',
        activatedAt: '2026-07-20T00:00:01.000Z',
      },
      resultDigest: digest,
      recordedAt: '2026-07-20T00:00:01.000Z',
    } as const;
    const terminalFailureReceiptRefs = transportReceipts
      .filter((receipt) => receipt.terminalFailureCode !== null)
      .map((receipt) => ({
        transportReceiptId: receipt.transportMessageIdDigest,
        capabilityDigest: receipt.capabilityDigest,
      }));
    const lease = {
      version: 1,
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      phase: 'active',
      leaseFence: '1',
      fenceEpoch: '1',
      acquiredAt: timestamp,
      activatedAt: '2026-07-20T00:00:01.000Z',
      renewedAt: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
      quiescedAt: null,
      releasedAt: null,
      abandonedAt: null,
      operationReceipts: { acquire, activate, quiesce: null, release: null },
      renewReceiptIds: [],
      capabilityIssuanceReceiptIds: input.issued.map(({ receipt }) => receipt.matrixIdempotencyKeyDigest),
      unconsumedCapability: input.unconsumedCapability ?? null,
      capabilityDigests: input.issued.map(({ capability }) => capability.capabilityDigest),
      terminalFailureReceiptRefs,
      nonterminalIngestOutboxIds: ingestOutboxes
        .filter((outbox) => outbox.status !== 'closed')
        .map((outbox) => outbox.ingestOutboxId),
      ingestOutboxIds: ingestOutboxes.map((outbox) => outbox.ingestOutboxId),
      terminalControlOutboxIds: [],
      transportReceiptIds: transportReceipts.map((receipt) => receipt.transportMessageIdDigest),
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
      ...input.leaseOverrides,
    } satisfies MatrixCorpusLeaseV1;
    const pair = {
      leaseSlotDigest: digest,
      current: lease,
      history: { ...lease, leaseSlotDigest: digest },
    } satisfies MatrixCorpusCurrentLeaseHistoryPairV1;
    return {
      pair,
      renewReceipts: [],
      issuanceReceipts: input.issued.map(({ receipt }) => receipt),
      capabilities: input.issued.map(({ capability }) => capability),
      transportReceipts,
      ingestOutboxes,
    };
  }

  function expectedLeaseSummary(lease: MatrixCorpusLeaseV1) {
    const acquire = lease.operationReceipts.acquire;
    if (acquire === null) throw new Error('seed lease requires an acquire receipt');
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
      terminalWinner: lease.terminalWinner,
      cleanupProgress: lease.cleanupProgress,
      priorFinalCleanupReceipts: lease.priorFinalCleanupReceipts ?? [],
      finalCleanupReceipt: lease.finalCleanupReceipt,
      drain: lease.drain,
    };
  }

  function expectedIssueConsumeSummary(seed: FakeMatrixCorpusIssueConsumeSeed): FakeMatrixCorpusCoreStateSummary {
    const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
    return {
      version: 1,
      current: [
        {
          leaseSlotDigest: seed.pair.leaseSlotDigest,
          lease: expectedLeaseSummary(seed.pair.current),
        },
      ],
      histories: [expectedLeaseSummary(seed.pair.history)],
      renewReceipts: seed.renewReceipts
        .map((receipt) => {
          const projection = receipt.replayProjection;
          if (projection.operation !== 'renew') throw new Error('seed renew receipt requires a renew projection');
          return {
            runFenceDigest: seed.pair.history.runFenceDigest,
            idempotencyKeyDigest: receipt.idempotencyKeyDigest,
            canonicalRequestDigest: receipt.canonicalRequestDigest,
            replayExpiresAt: projection.expiresAt,
          };
        })
        .sort((left, right) => compare(left.idempotencyKeyDigest, right.idempotencyKeyDigest)),
      issuanceReceipts: seed.issuanceReceipts
        .map((receipt) => {
          const projection = receipt.replayProjection;
          if (projection.operation !== 'issue') throw new Error('seed issuance receipt requires an issue projection');
          return {
            runFenceDigest: seed.pair.history.runFenceDigest,
            matrixIdempotencyKeyDigest: receipt.matrixIdempotencyKeyDigest,
            issueRequestDigest: receipt.issueRequestDigest,
            capabilityDigest: receipt.capabilityDigest,
            resultDigest: receipt.resultDigest,
            replayIssuedAt: projection.issuedAt,
            replayExpiresAt: projection.expiresAt,
          };
        })
        .sort((left, right) => compare(left.matrixIdempotencyKeyDigest, right.matrixIdempotencyKeyDigest)),
      capabilities: seed.capabilities
        .map((capability) => ({
          capabilityDigest: capability.capabilityDigest,
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
        }))
        .sort((left, right) => compare(left.capabilityDigest, right.capabilityDigest)),
      transportReceipts: seed.transportReceipts
        .map((receipt) => ({
          transportMessageIdDigest: receipt.transportMessageIdDigest,
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
        }))
        .sort((left, right) => compare(left.transportMessageIdDigest, right.transportMessageIdDigest)),
      ingestOutboxes: seed.ingestOutboxes
        .map((outbox) => ({
          ingestOutboxId: outbox.ingestOutboxId,
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
          terminalMarker: outbox.terminalMarker,
          closedReason: outbox.closedReason,
          acknowledgementReceipts: outbox.acknowledgementReceipts,
          lastClaimRenewal: outbox.lastClaimRenewal,
          closedAt: outbox.closedAt,
          createdAt: outbox.createdAt,
        }))
        .sort((left, right) => compare(left.ingestOutboxId, right.ingestOutboxId)),
      terminalControlOutboxes: [],
    };
  }

  it('admits queued acquire callers only after their selected gates release', async () => {
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const firstGate = repository.deferNextBeforeAdmission('acquire');
    const secondGate = repository.deferNextBeforeAdmission('acquire');
    const firstCommand = {
      runtimeAudience: 'hetzner-prod' as const,
      runId: 'run_1',
      userId: 'user_1',
      matrixRoomBindingDigest: digest,
      whatsappAccountBindingDigest: digest,
      whatsappSenderBindingDigest: digest,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      now: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
      acquisitionReadiness: { kind: 'admission_ready' as const, current: 'absent' as const },
    } satisfies AcquireProvisioningLeaseCommand;
    const secondCommand = {
      ...firstCommand,
      runId: 'run_2',
      runFenceDigest: 'e'.repeat(64),
      idempotencyKeyDigest: 'f'.repeat(64),
      canonicalRequestDigest: '0'.repeat(64),
    } satisfies AcquireProvisioningLeaseCommand;

    const first = repository.acquireProvisioningLease(firstCommand);
    const second = repository.acquireProvisioningLease(secondCommand);

    await Promise.all([firstGate.entered, secondGate.entered]);

    expect(repository.safeStateSummary().version).toBe(0);
    expect(repository.operationCounts('acquire')).toEqual({ invocations: 2, commits: 0 });

    firstGate.release();
    secondGate.release();
    await Promise.all([first, second]);
  });

  it('commits only the selected winner when gated acquisitions target one lease slot', async () => {
    const replayDigests: string[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          replayDigests.push(JSON.stringify(projection));
          return digest;
        },
      },
    });
    const loserGate = repository.deferNextBeforeAdmission('acquire');
    const winnerGate = repository.deferNextBeforeAdmission('acquire');
    const loser = repository.acquireProvisioningLease(acquireCommand());
    const winner = repository.acquireProvisioningLease(
      acquireCommand({
        runId: 'run_2',
        runFenceDigest: 'e'.repeat(64),
        idempotencyKeyDigest: 'f'.repeat(64),
        canonicalRequestDigest: '0'.repeat(64),
      })
    );

    await Promise.all([loserGate.entered, winnerGate.entered]);
    winnerGate.release();

    await expect(winner).resolves.toEqual({
      code: 'ACQUIRED',
      runId: 'run_2',
      leaseFence: '1',
      phase: 'provisioning',
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
    });
    loserGate.release();

    await expect(loser).resolves.toEqual({ code: 'RUN_ALREADY_ACTIVE' });
    expect(replayDigests).toHaveLength(1);
    expect(repository.operationCounts('acquire')).toEqual({ invocations: 2, commits: 1 });
    expect(repository.safeStateSummary()).toMatchObject({
      version: 1,
      current: [{ leaseSlotDigest: digest, lease: { runId: 'run_2', phase: 'provisioning' } }],
      histories: [{ runId: 'run_2', phase: 'provisioning' }],
    });
  });

  it.each([{ kind: 'not_ready' as const }, { kind: 'admission_blocked' as const, reason: 'running' as const }])(
    'does not acquire when the $kind admission proof is closed',
    async (acquisitionReadiness) => {
      const replayDigests: string[] = [];
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: {
          digest: (projection) => {
            replayDigests.push(JSON.stringify(projection));
            return digest;
          },
        },
      });
      const before = repository.safeStateSummary();

      const result = await repository.acquireProvisioningLease(acquireCommand({ acquisitionReadiness }));

      expect(result).toEqual({ code: 'NOT_READY', gate: 'admission' });
      expect(replayDigests).toEqual([]);
      expect(repository.operationCounts('acquire')).toEqual({ invocations: 1, commits: 0 });
      expect(repository.safeStateSummary()).toEqual(before);
    }
  );

  it('replays the stored acquire result after response loss before checking retry readiness', async () => {
    const replayDigests: string[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          replayDigests.push(JSON.stringify(projection));
          return digest;
        },
      },
    });
    const command = acquireCommand();
    repository.loseNextResponseAfterCommit('acquire');

    await expect(repository.acquireProvisioningLease(command)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    await expect(
      repository.acquireProvisioningLease({
        ...command,
        acquisitionReadiness: { kind: 'not_ready' },
      })
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'acquire',
      result: 'acquired',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'provisioning',
      acquiredAt: timestamp,
      expiresAt: '2026-07-20T00:01:00.000Z',
    });
    await expect(
      repository.acquireProvisioningLease({ ...command, canonicalRequestDigest: 'e'.repeat(64) })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      repository.acquireProvisioningLease({ ...command, idempotencyKeyDigest: 'f'.repeat(64) })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(replayDigests).toHaveLength(1);
    expect(repository.operationCounts('acquire')).toEqual({ invocations: 4, commits: 1 });
    expect(repository.safeStateSummary().histories).toHaveLength(1);
  });

  it('replays an activation after response loss before checking retry readiness', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: () => {
          digestCalls += 1;
          return digest;
        },
      },
    });
    await repository.acquireProvisioningLease(acquireCommand());
    const command = activateCommand();
    repository.loseNextResponseAfterCommit('activate');

    await expect(repository.activateRun(command)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    await expect(
      repository.activateRun({ ...command, controlStatus: { kind: 'not_ready' } })
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'activate',
      result: 'activated',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'active',
      activatedAt: '2026-07-20T00:00:01.000Z',
    });
    expect(digestCalls).toBe(2);
    expect(repository.operationCounts('activate')).toEqual({ invocations: 2, commits: 1 });
  });

  it('retains an immutable renew replay after a later renewal commits', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: () => {
          digestCalls += 1;
          return digest;
        },
      },
    });
    await repository.acquireProvisioningLease(acquireCommand());
    await repository.activateRun(activateCommand());
    const renewA = renewCommand();
    const renewB = renewCommand({
      idempotencyKeyDigest: 'c'.repeat(64),
      canonicalRequestDigest: 'd'.repeat(64),
      now: '2026-07-20T00:00:03.000Z',
      expiresAt: '2026-07-20T00:01:03.000Z',
    });
    repository.loseNextResponseAfterCommit('renew');

    await expect(repository.renewLease(renewA)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    await expect(repository.renewLease(renewB)).resolves.toMatchObject({
      code: 'LEASE_RENEWED',
      renewedAt: '2026-07-20T00:00:03.000Z',
      expiresAt: '2026-07-20T00:01:03.000Z',
    });
    await expect(repository.renewLease(renewA)).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'renew',
      result: 'renewed',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'active',
      renewedAt: '2026-07-20T00:00:02.000Z',
      expiresAt: '2026-07-20T00:01:02.000Z',
    });
    expect(digestCalls).toBe(4);
    expect(repository.operationCounts('renew')).toEqual({ invocations: 3, commits: 2 });
  });

  it('does not expose mutable lease state through safe state summaries', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await repository.acquireProvisioningLease(acquireCommand());
    await repository.activateRun(activateCommand());
    await repository.renewLease(renewCommand());
    const summary = repository.safeStateSummary();
    const expected = JSON.parse(JSON.stringify(summary));
    const current = summary.current[0];
    const history = summary.histories[0];
    const receipt = summary.renewReceipts[0];
    expect(current).toBeDefined();
    expect(history).toBeDefined();
    expect(receipt).toBeDefined();
    if (current === undefined || history === undefined || receipt === undefined) return;

    Reflect.set(summary, 'version', 99);
    Reflect.apply(Array.prototype.push, summary.current, [current]);
    Reflect.apply(Array.prototype.push, summary.histories, [history]);
    Reflect.apply(Array.prototype.push, summary.renewReceipts, [receipt]);
    Reflect.set(current, 'leaseSlotDigest', '0'.repeat(64));
    Reflect.set(current.lease, 'runId', 'run_9');
    Reflect.apply(Array.prototype.push, current.lease.renewReceiptIds, ['e'.repeat(64)]);
    Reflect.set(history, 'runId', 'run_9');
    Reflect.set(receipt, 'canonicalRequestDigest', 'f'.repeat(64));

    expect(repository.safeStateSummary()).toEqual(expected);
    await expect(repository.renewLease(renewCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      renewedAt: '2026-07-20T00:00:02.000Z',
    });
  });

  it.each([
    { stage: 'acquire_after_current_draft' as const, operation: 'acquire' as const },
    { stage: 'acquire_after_history_draft' as const, operation: 'acquire' as const },
    { stage: 'activate_after_current_draft' as const, operation: 'activate' as const },
    { stage: 'activate_after_history_draft' as const, operation: 'activate' as const },
    { stage: 'renew_after_receipt_draft' as const, operation: 'renew' as const },
    { stage: 'renew_after_current_draft' as const, operation: 'renew' as const },
    { stage: 'renew_after_history_draft' as const, operation: 'renew' as const },
  ])('keeps the draft uncommitted and consumes $stage exactly once', async ({ stage, operation }) => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    if (operation === 'activate' || operation === 'renew') await repository.acquireProvisioningLease(acquireCommand());
    if (operation === 'renew') await repository.activateRun(activateCommand());
    const before = repository.safeStateSummary();
    const beforeCounts = repository.operationCounts(operation);
    repository.failNextAt(stage);
    const attempt =
      operation === 'acquire'
        ? repository.acquireProvisioningLease(acquireCommand())
        : operation === 'activate'
          ? repository.activateRun(activateCommand())
          : repository.renewLease(renewCommand());

    await expect(attempt).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts(operation)).toEqual({
      invocations: beforeCounts.invocations + 1,
      commits: beforeCounts.commits,
    });

    const retry =
      operation === 'acquire'
        ? await repository.acquireProvisioningLease(acquireCommand())
        : operation === 'activate'
          ? await repository.activateRun(activateCommand())
          : await repository.renewLease(renewCommand());
    expect(retry.code).not.toBe('CORRUPT_STATE');
    expect(repository.operationCounts(operation).commits).toBe(beforeCounts.commits + 1);
  });

  it('rejects a fresh 401st renewal while preserving the first immutable replay', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await repository.acquireProvisioningLease(acquireCommand());
    await repository.activateRun(activateCommand());
    const at = (offsetMs: number): string => new Date(Date.parse('2026-07-20T00:00:02.000Z') + offsetMs).toISOString();
    const key = (value: number): string => value.toString(16).padStart(64, '0');
    const commandAt = (index: number) =>
      renewCommand({
        idempotencyKeyDigest: key(index),
        canonicalRequestDigest: key(index + 400),
        now: at(index),
        expiresAt: at(60_000 + index),
      });

    for (let index = 0; index < 400; index += 1)
      await expect(repository.renewLease(commandAt(index))).resolves.toMatchObject({ code: 'LEASE_RENEWED' });

    const before = repository.safeStateSummary();
    await expect(repository.renewLease(commandAt(400))).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
    await expect(repository.renewLease(commandAt(0))).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      renewedAt: at(0),
      expiresAt: at(60_000),
    });
    expect(repository.safeStateSummary()).toEqual(before);
  });

  it('increments a valid large terminal fence with BigInt and rejects valid 20-digit overflow', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLeaseState(terminalSeedPair('9007199254740991'));

    await expect(
      repository.acquireProvisioningLease(
        acquireCommand({ runId: 'run_2', runFenceDigest: 'e'.repeat(64), idempotencyKeyDigest: 'f'.repeat(64) })
      )
    ).resolves.toMatchObject({ code: 'ACQUIRED', leaseFence: '9007199254740992' });

    const overflowing = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    overflowing.seedValidLeaseState(terminalSeedPair('99999999999999999999'));
    const before = overflowing.safeStateSummary();
    await expect(
      overflowing.acquireProvisioningLease(
        acquireCommand({ runId: 'run_2', runFenceDigest: 'e'.repeat(64), idempotencyKeyDigest: 'f'.repeat(64) })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'lease' });
    expect(overflowing.safeStateSummary()).toEqual(before);
  });

  it('keeps changed-key activation replays and every fresh closed activation outcome read-only', async () => {
    const changedReplay = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await changedReplay.acquireProvisioningLease(acquireCommand());
    await changedReplay.activateRun(activateCommand());
    const changedBefore = changedReplay.safeStateSummary();
    const changedCounts = changedReplay.operationCounts('activate');
    await expect(
      changedReplay.activateRun(activateCommand({ canonicalRequestDigest: '0'.repeat(64) }))
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(changedReplay.safeStateSummary()).toEqual(changedBefore);
    expect(changedReplay.operationCounts('activate')).toEqual({
      invocations: changedCounts.invocations + 1,
      commits: changedCounts.commits,
    });

    const controlStatus = activateCommand().controlStatus;
    if (controlStatus.kind !== 'status') throw new Error('active command status fixture must be ready');
    for (const command of [
      activateCommand({
        runId: 'run_2',
        controlStatus: { ...controlStatus, runId: 'run_2' },
      }),
      activateCommand({
        userId: 'user_2',
        controlStatus: { ...controlStatus, userId: 'user_2' },
      }),
      activateCommand({
        leaseFence: '2',
        controlStatus: { ...controlStatus, leaseFence: '2' },
      }),
      activateCommand({ runFenceDigest: '0'.repeat(64) }),
    ]) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      await repository.acquireProvisioningLease(acquireCommand());
      const before = repository.safeStateSummary();
      const counts = repository.operationCounts('activate');
      await expect(repository.activateRun(command)).resolves.toEqual({ code: 'STALE_FENCE' });
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('activate')).toEqual({ invocations: counts.invocations + 1, commits: counts.commits });
    }

    const expired = await activeRepository();
    const expiredBefore = expired.repository.safeStateSummary();
    const expiredCalls = expired.digestCalls();
    const expiredCounts = expired.repository.operationCounts('activate');
    await expect(
      expired.repository.activateRun(
        activateCommand({
          idempotencyKeyDigest: '0'.repeat(64),
          canonicalRequestDigest: '1'.repeat(64),
          now: '2026-07-20T00:01:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    expect(expired.repository.safeStateSummary()).toEqual(expiredBefore);
    expect(expired.digestCalls()).toBe(expiredCalls);
    expect(expired.repository.operationCounts('activate')).toEqual({
      invocations: expiredCounts.invocations + 1,
      commits: expiredCounts.commits,
    });

    const active = await activeRepository();
    const activeBefore = active.repository.safeStateSummary();
    const activeCalls = active.digestCalls();
    const activeCounts = active.repository.operationCounts('activate');
    await expect(
      active.repository.activateRun(
        activateCommand({ idempotencyKeyDigest: '0'.repeat(64), canonicalRequestDigest: '1'.repeat(64) })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(active.repository.safeStateSummary()).toEqual(activeBefore);
    expect(active.digestCalls()).toBe(activeCalls);
    expect(active.repository.operationCounts('activate')).toEqual({
      invocations: activeCounts.invocations + 1,
      commits: activeCounts.commits,
    });

    const notReady = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await notReady.acquireProvisioningLease(acquireCommand());
    const notReadyBefore = notReady.safeStateSummary();
    await expect(notReady.activateRun(activateCommand({ controlStatus: { kind: 'not_ready' } }))).resolves.toEqual({
      code: 'NOT_READY',
      gate: 'activation',
    });
    expect(notReady.safeStateSummary()).toEqual(notReadyBefore);
  });

  it('commits exactly one deterministic winner when two fresh activations are admitted in selected order', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    await repository.acquireProvisioningLease(acquireCommand());
    const firstGate = repository.deferNextBeforeAdmission('activate');
    const secondGate = repository.deferNextBeforeAdmission('activate');
    const first = repository.activateRun(activateCommand());
    const second = repository.activateRun(
      activateCommand({ idempotencyKeyDigest: '0'.repeat(64), canonicalRequestDigest: '1'.repeat(64) })
    );
    await Promise.all([firstGate.entered, secondGate.entered]);
    secondGate.release();
    await expect(second).resolves.toMatchObject({ code: 'ACTIVATED', phase: 'active' });
    firstGate.release();
    await expect(first).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(digestCalls).toBe(2);
    expect(repository.operationCounts('activate')).toEqual({ invocations: 2, commits: 1 });
  });

  it('keeps renew conflicts, stale fences, expiry, phase, and non-extension outcomes read-only', async () => {
    const changed = await activeRepository();
    const first = renewCommand();
    await changed.repository.renewLease(first);
    const changedBefore = changed.repository.safeStateSummary();
    const changedCalls = changed.digestCalls();
    const changedCounts = changed.repository.operationCounts('renew');
    await expect(
      changed.repository.renewLease(renewCommand({ canonicalRequestDigest: 'e'.repeat(64) }))
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(changed.repository.safeStateSummary()).toEqual(changedBefore);
    expect(changed.digestCalls()).toBe(changedCalls);
    expect(changed.repository.operationCounts('renew')).toEqual({
      invocations: changedCounts.invocations + 1,
      commits: changedCounts.commits,
    });

    for (const command of [
      renewCommand({ runId: 'run_2' }),
      renewCommand({ userId: 'user_2' }),
      renewCommand({ leaseFence: '2' }),
      renewCommand({ runFenceDigest: 'e'.repeat(64) }),
    ]) {
      const current = await activeRepository();
      const before = current.repository.safeStateSummary();
      const calls = current.digestCalls();
      const counts = current.repository.operationCounts('renew');
      await expect(current.repository.renewLease(command)).resolves.toEqual({ code: 'STALE_FENCE' });
      expect(current.repository.safeStateSummary()).toEqual(before);
      expect(current.digestCalls()).toBe(calls);
      expect(current.repository.operationCounts('renew')).toEqual({ invocations: counts.invocations + 1, commits: counts.commits });
    }

    const expired = await activeRepository();
    const expiredBefore = expired.repository.safeStateSummary();
    const expiredCalls = expired.digestCalls();
    const expiredCounts = expired.repository.operationCounts('renew');
    await expect(expired.repository.renewLease(renewCommand({ now: '2026-07-20T00:01:00.000Z', expiresAt: '2026-07-20T00:02:00.000Z' }))).resolves.toEqual({
      code: 'LEASE_EXPIRED',
      expiresAt: '2026-07-20T00:01:00.000Z',
    });
    expect(expired.repository.safeStateSummary()).toEqual(expiredBefore);
    expect(expired.digestCalls()).toBe(expiredCalls);
    expect(expired.repository.operationCounts('renew')).toEqual({
      invocations: expiredCounts.invocations + 1,
      commits: expiredCounts.commits,
    });

    let provisioningDigestCalls = 0;
    const provisioning = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((provisioningDigestCalls += 1), digest) },
    });
    await provisioning.acquireProvisioningLease(acquireCommand());
    const provisioningBefore = provisioning.safeStateSummary();
    const provisioningCalls = provisioningDigestCalls;
    const provisioningCounts = provisioning.operationCounts('renew');
    await expect(provisioning.renewLease(renewCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'provisioning',
    });
    expect(provisioning.safeStateSummary()).toEqual(provisioningBefore);
    expect(provisioningDigestCalls).toBe(provisioningCalls);
    expect(provisioning.operationCounts('renew')).toEqual({
      invocations: provisioningCounts.invocations + 1,
      commits: provisioningCounts.commits,
    });

    const nonExtending = await activeRepository();
    const nonExtendingBefore = nonExtending.repository.safeStateSummary();
    const nonExtendingCalls = nonExtending.digestCalls();
    await expect(
      nonExtending.repository.renewLease(renewCommand({ expiresAt: '2026-07-20T00:01:00.000Z' }))
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(nonExtending.repository.safeStateSummary()).toEqual(nonExtendingBefore);
    expect(nonExtending.digestCalls()).toBe(nonExtendingCalls);
  });

  it('evaluates activation and renewal lease horizons chronologically across RFC3339 offsets', async () => {
    const activationAtExpiry = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await activationAtExpiry.acquireProvisioningLease(acquireCommand());
    await expect(
      activationAtExpiry.activateRun(
        activateCommand({
          idempotencyKeyDigest: '0'.repeat(64),
          canonicalRequestDigest: '1'.repeat(64),
          now: '2026-07-19T19:01:00.000-05:00',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });

    const activationBeforeExpiry = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await activationBeforeExpiry.acquireProvisioningLease(acquireCommand());
    await expect(
      activationBeforeExpiry.activateRun(
        activateCommand({ now: '2026-07-20T02:00:00.000+02:00' })
      )
    ).resolves.toMatchObject({ code: 'ACTIVATED', activatedAt: '2026-07-20T02:00:00.000+02:00' });

    const renewalAtExpiry = await activeRepository();
    await expect(
      renewalAtExpiry.repository.renewLease(
        renewCommand({
          idempotencyKeyDigest: '0'.repeat(64),
          canonicalRequestDigest: '1'.repeat(64),
          now: '2026-07-19T19:01:00.000-05:00',
          expiresAt: '2026-07-19T19:02:00.000-05:00',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });

    const renewalBeforeExpiry = await activeRepository();
    await expect(
      renewalBeforeExpiry.repository.renewLease(
        renewCommand({
          now: '2026-07-20T02:00:00.000+02:00',
          expiresAt: '2026-07-20T02:02:00.000+02:00',
        })
      )
    ).resolves.toMatchObject({
      code: 'LEASE_RENEWED',
      renewedAt: '2026-07-20T02:00:00.000+02:00',
      expiresAt: '2026-07-20T02:02:00.000+02:00',
    });

    const nonExtendingRenewal = await activeRepository();
    await expect(
      nonExtendingRenewal.repository.renewLease(
        renewCommand({
          idempotencyKeyDigest: '0'.repeat(64),
          canonicalRequestDigest: '1'.repeat(64),
          now: '2026-07-19T19:00:00.000-05:00',
          expiresAt: '2026-07-20T02:01:00.000+02:00',
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
  });

  it.each([
    { name: 'throws', digest: () => { throw new Error('private dependency exception'); } },
    { name: 'returns an invalid value', digest: () => 'invalid digest' },
  ])('does not commit when the replay digest dependency $name', async ({ digest: dependencyDigest }) => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: dependencyDigest } });
    const before = repository.safeStateSummary();
    await expect(repository.acquireProvisioningLease(acquireCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('acquire')).toEqual({ invocations: 1, commits: 0 });
  });

  it('strictly rejects malformed core commands before replay-digest admission', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    for (const call of [
      () => Reflect.apply(repository.acquireProvisioningLease, repository, [{}]),
      () => Reflect.apply(repository.activateRun, repository, [{}]),
      () => Reflect.apply(repository.renewLease, repository, [{}]),
    ])
      await expect(call()).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(digestCalls).toBe(0);
    expect(repository.safeStateSummary().version).toBe(0);
    expect(repository.operationCounts('acquire').commits).toBe(0);
    expect(repository.operationCounts('activate').commits).toBe(0);
    expect(repository.operationCounts('renew').commits).toBe(0);
  });

  it('keeps a commit durable and releases the mutex while the successful response is after-commit gated', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const responseGate = repository.deferNextAfterCommit('acquire');
    const acquire = repository.acquireProvisioningLease(acquireCommand());
    await responseGate.entered;
    expect(repository.safeStateSummary().version).toBe(1);
    await expect(repository.activateRun(activateCommand())).resolves.toMatchObject({ code: 'ACTIVATED' });
    responseGate.release();
    await expect(acquire).resolves.toMatchObject({ code: 'ACQUIRED' });
  });

  it('rejects valid-state seeding after armed controls, faults, response loss, or an invocation', async () => {
    const gated = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    gated.deferNextBeforeAdmission('acquire');
    expect(() => gated.seedValidLeaseState(terminalSeedPair('1'))).toThrow(FakeMatrixCorpusRepositoryFault);

    const afterCommitGated = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    afterCommitGated.deferNextAfterCommit('acquire');
    expect(() => afterCommitGated.seedValidLeaseState(terminalSeedPair('1'))).toThrow(
      FakeMatrixCorpusRepositoryFault
    );

    const faulted = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    faulted.failNextAt('acquire_after_current_draft');
    expect(() => faulted.seedValidLeaseState(terminalSeedPair('1'))).toThrow(FakeMatrixCorpusRepositoryFault);

    const responseLost = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    responseLost.loseNextResponseAfterCommit('acquire');
    expect(() => responseLost.seedValidLeaseState(terminalSeedPair('1'))).toThrow(FakeMatrixCorpusRepositoryFault);

    const invoked = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    await invoked.acquireProvisioningLease(acquireCommand());
    expect(() => invoked.seedValidLeaseState(terminalSeedPair('1'))).toThrow(FakeMatrixCorpusRepositoryFault);
  });

  it('A2 fake issue/consume seed and safe inspection', async () => {
    const first = seededCapability(1, {
      consumedAt: '2026-07-20T00:00:03.000Z',
      consumedTransportMessageIdDigest: indexedDigest(6_100),
      ingestOutboxId: 'outbox_1',
    });
    const second = seededCapability(2);
    const pending = seededOutbox(1, 'pending');
    const accepted = acceptedTransportReceipt(first.capability, pending, indexedDigest(6_100));
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const acceptedSeed = issueConsumeSeed({
      issued: [second, first],
      transportReceipts: [accepted],
      ingestOutboxes: [pending],
      unconsumedCapability: { digest: second.capability.capabilityDigest, phase: second.capability.phase },
      leaseOverrides: {
        drain: {
          consumedCapabilityCount: 1,
          terminalIntexMarkerCount: 0,
          terminalOutboxCount: 0,
          replyOrDeliveryWorkInFlight: 0,
          drained: false,
        },
      },
    });
    repository.seedValidIssueConsumeState(acceptedSeed);

    const summary = repository.safeStateSummary();
    const expectedAcceptedSummary = expectedIssueConsumeSummary(acceptedSeed);
    expect(summary).toEqual(expectedAcceptedSummary);
    expect(repository.hasExactPrivateIngestPayload('outbox_1', pending.payload)).toBe(true);
    expect(repository.hasExactPrivateIngestPayload('outbox_missing', pending.payload)).toBe(false);
    expect(
      Reflect.apply(repository.hasExactPrivateIngestPayload, repository, [
        'outbox_1',
        { ...pending.payload, version: 2 },
      ])
    ).toBe(false);
    const safeSurface = JSON.stringify(summary);
    expect(safeSurface).not.toContain(attestedPayload.ordinaryIngest.text);
    expect(safeSurface).not.toContain(validIssueInput.rawCapability);
    Reflect.set(summary, 'version', 999);
    Reflect.set(summary.capabilities[0] ?? {}, 'consumedAt', timestamp);
    Reflect.set(summary.ingestOutboxes[0] ?? {}, 'status', 'closed');
    expect(repository.safeStateSummary()).toEqual(expectedAcceptedSummary);

    const terminalCapability = seededCapability(3);
    const terminal = terminalTransportReceipt(terminalCapability.capability, 1, 'CAPABILITY_MISMATCH');
    const claimed = seededOutbox(2, 'claimed');
    const claimedTransportDigest = indexedDigest(6_102);
    const claimedCapability = seededCapability(4, {
      consumedAt: claimed.createdAt,
      consumedTransportMessageIdDigest: claimedTransportDigest,
      ingestOutboxId: claimed.ingestOutboxId,
    });
    const claimedReceipt = acceptedTransportReceipt(claimedCapability.capability, claimed, claimedTransportDigest);
    const terminalRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const terminalSeed = issueConsumeSeed({
        issued: [terminalCapability, claimedCapability],
        transportReceipts: [terminal, claimedReceipt],
        ingestOutboxes: [claimed],
        unconsumedCapability: {
          digest: terminalCapability.capability.capabilityDigest,
          phase: terminalCapability.capability.phase,
        },
        leaseOverrides: {
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        },
      });
    terminalRepository.seedValidIssueConsumeState(terminalSeed);
    expect(terminalRepository.safeStateSummary()).toEqual(expectedIssueConsumeSummary(terminalSeed));

    for (const status of ['published', 'closed'] as const) {
      const outbox = seededOutbox(status === 'published' ? 3 : 4, status);
      const transportMessageIdDigest = indexedDigest(status === 'published' ? 6_103 : 6_104);
      const consumedCapability = seededCapability(status === 'published' ? 5 : 6, {
        consumedAt: outbox.createdAt,
        consumedTransportMessageIdDigest: transportMessageIdDigest,
        ingestOutboxId: outbox.ingestOutboxId,
      });
      const acceptedReceipt = acceptedTransportReceipt(
        consumedCapability.capability,
        outbox,
        transportMessageIdDigest
      );
      const statusRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      const statusSeed = issueConsumeSeed({
        issued: [consumedCapability],
        transportReceipts: [acceptedReceipt],
        ingestOutboxes: [outbox],
        leaseOverrides: {
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        },
      });
      statusRepository.seedValidIssueConsumeState(statusSeed);
      expect(statusRepository.safeStateSummary()).toEqual(expectedIssueConsumeSummary(statusSeed));
      expect(statusRepository.hasExactPrivateIngestPayload(outbox.ingestOutboxId, outbox.payload)).toBe(true);
    }

    const promptCapability = seededCapability(5);
    const promptReceipt = terminalTransportReceipt(promptCapability.capability, 5, 'CAPABILITY_MISMATCH');
    const promptMismatchRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const promptDivergentTerminalReceipt = {
      ...promptReceipt,
      promptDigest: 'f'.repeat(64),
    } satisfies MatrixCorpusTransportReceiptV1;
    promptMismatchRepository.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [promptCapability],
        transportReceipts: [promptDivergentTerminalReceipt],
        unconsumedCapability: {
          digest: promptCapability.capability.capabilityDigest,
          phase: promptCapability.capability.phase,
        },
      })
    );
    expect(
      promptMismatchRepository.safeStateSummary().transportReceipts.find(
        (receipt) => receipt.transportMessageIdDigest === promptDivergentTerminalReceipt.transportMessageIdDigest
      )?.promptDigest
    ).toBe(promptDivergentTerminalReceipt.promptDigest);
    await expect(
      promptMismatchRepository.consumeCapabilityAndEnqueueIngest(
        consumeCommandForCapability(
          promptCapability.capability,
          promptDivergentTerminalReceipt.transportMessageIdDigest,
          'receipt_prompt_divergent_retry',
          'outbox_prompt_divergent_retry',
          promptDivergentTerminalReceipt.ingressRequestDigest
        )
      )
    ).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });

    const firstLive = seededCapability(6);
    const secondLive = seededCapability(7);
    const multipleLiveRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    expect(() =>
      multipleLiveRepository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [firstLive, secondLive],
          unconsumedCapability: { digest: firstLive.capability.capabilityDigest, phase: firstLive.capability.phase },
        })
      )
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    const orphanConsumed = seededCapability(8, {
      consumedAt: '2026-07-20T00:00:03.000Z',
      consumedTransportMessageIdDigest: indexedDigest(6_108),
      ingestOutboxId: 'outbox_orphan',
    });
    const orphanConsumedRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() =>
      orphanConsumedRepository.seedValidIssueConsumeState(issueConsumeSeed({ issued: [orphanConsumed] }))
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    const orphanOutboxRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() =>
      orphanOutboxRepository.seedValidIssueConsumeState(
        issueConsumeSeed({ issued: [], ingestOutboxes: [seededOutbox(9)] })
      )
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    const referencedCapability = seededCapability(10, { revokedAt: '2026-07-20T00:00:03.000Z' });
    const alternateCapability = seededCapability(11, { revokedAt: '2026-07-20T00:00:03.000Z' });
    const referencedTerminalReceipt = terminalTransportReceipt(
      referencedCapability.capability,
      10,
      'CAPABILITY_REVOKED'
    );
    const referencedSeed = issueConsumeSeed({
      issued: [referencedCapability, alternateCapability],
      transportReceipts: [referencedTerminalReceipt],
    });
    const missingReferencedReceipt = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() =>
      missingReferencedReceipt.seedValidIssueConsumeState({ ...referencedSeed, transportReceipts: [] })
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    const mismatchedReference = {
      transportReceiptId: referencedTerminalReceipt.transportMessageIdDigest,
      capabilityDigest: alternateCapability.capability.capabilityDigest,
    };
    const mismatchedReferenceSeed = {
      ...referencedSeed,
      pair: {
        ...referencedSeed.pair,
        current: {
          ...referencedSeed.pair.current,
          terminalFailureReceiptRefs: [mismatchedReference],
        },
        history: {
          ...referencedSeed.pair.history,
          terminalFailureReceiptRefs: [mismatchedReference],
        },
      },
    } satisfies FakeMatrixCorpusIssueConsumeSeed;
    const mismatchedReferenceRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() => mismatchedReferenceRepository.seedValidIssueConsumeState(mismatchedReferenceSeed)).toThrow(
      FakeMatrixCorpusRepositoryFault
    );
  });

  it('valid seed permits a short-lived outstanding capability followed by lease renewal', () => {
    const shortLived = seededCapability(12, { expiresAt: '2026-07-20T00:00:02.500Z' });
    const seedBeforeRenewal = issueConsumeSeed({
      issued: [shortLived],
      unconsumedCapability: {
        digest: shortLived.capability.capabilityDigest,
        phase: shortLived.capability.phase,
      },
    });
    const renewalIdempotencyKeyDigest = indexedDigest(8_012);
    const renewedAt = '2026-07-20T00:00:03.000Z';
    const renewedExpiresAt = '2026-07-20T00:01:03.000Z';
    const renewalReceipt = {
      version: 1,
      idempotencyKeyDigest: renewalIdempotencyKeyDigest,
      runId: seedBeforeRenewal.pair.current.runId,
      userId: seedBeforeRenewal.pair.current.userId,
      leaseFence: seedBeforeRenewal.pair.current.leaseFence,
      canonicalRequestDigest: indexedDigest(8_013),
      replayProjection: {
        operation: 'renew',
        result: 'renewed',
        runId: seedBeforeRenewal.pair.current.runId,
        leaseFence: seedBeforeRenewal.pair.current.leaseFence,
        phase: 'active',
        renewedAt,
        expiresAt: renewedExpiresAt,
      },
      resultDigest: digest,
      recordedAt: renewedAt,
    } satisfies FakeMatrixCorpusIssueConsumeSeed['renewReceipts'][number];
    const renewedLease = {
      ...seedBeforeRenewal.pair.current,
      renewedAt,
      expiresAt: renewedExpiresAt,
      renewReceiptIds: [renewalIdempotencyKeyDigest],
    } satisfies MatrixCorpusLeaseV1;
    const renewedSeed = {
      ...seedBeforeRenewal,
      pair: {
        ...seedBeforeRenewal.pair,
        current: renewedLease,
        history: { ...renewedLease, leaseSlotDigest: seedBeforeRenewal.pair.leaseSlotDigest },
      },
      renewReceipts: [renewalReceipt],
    } satisfies FakeMatrixCorpusIssueConsumeSeed;
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });

    expect(() => repository.seedValidIssueConsumeState(renewedSeed)).not.toThrow();
    expect(repository.safeStateSummary()).toMatchObject({
      version: 1,
      current: [
        {
          lease: {
            renewedAt,
            expiresAt: renewedExpiresAt,
            unconsumedCapability: {
              digest: shortLived.capability.capabilityDigest,
              phase: shortLived.capability.phase,
            },
          },
        },
      ],
      renewReceipts: [{ idempotencyKeyDigest: renewalIdempotencyKeyDigest }],
    });
  });

  it('facade to real fake consume retry replays stored IDs despite a sequential legacy ID source', async () => {
    const active = await activeRepository();
    const intexAgent = createIntexAgentSpy();
    const capturedLogger = createCapturingLogger();
    const clockValues = [
      '2026-07-20T00:00:02.000Z',
      '2026-07-20T00:00:03.000Z',
      '2026-07-20T00:00:04.000Z',
    ];
    let shaCalls = 0;
    const legacyIdCalls: ('receipt' | 'outbox')[] = [];
    const controlPlane = new MatrixCorpusControlPlane(
      createControlDependencies({
        repository: active.repository,
        intexAgent: intexAgent.client,
        logger: capturedLogger.logger,
        clockNow: () => {
          const next = clockValues.shift();
          if (next === undefined) throw new Error('Unexpected clock call');
          return next;
        },
        digests: {
          digest(domain) {
            if (domain === 'imc-lease-slot-v1') return digest;
            if (domain === 'imc-run-fence-v1') return 'b'.repeat(64);
            if (domain === 'imc-capability-v1' || domain === 'imc-transport-v1') return digest;
            throw new Error('Unexpected digest domain');
          },
        },
        sha256: {
          digestCanonical: () => {
            shaCalls += 1;
            return digest;
          },
        },
        ids: {
          ingestReceiptId: () => {
            legacyIdCalls.push('receipt');
            return `receipt_random_${String(legacyIdCalls.length)}`;
          },
          ingestOutboxId: () => {
            legacyIdCalls.push('outbox');
            return `outbox_random_${String(legacyIdCalls.length)}`;
          },
        },
      })
    );

    await expect(controlPlane.issueCapability(validIssueInput)).resolves.toEqual({
      code: 'CAPABILITY_ISSUED',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      issuedAt: '2026-07-20T00:00:02.000Z',
      expiresAt: '2026-07-20T00:01:02.000Z',
    });
    const first = await controlPlane.consumeCapabilityAndEnqueueIngest(validConsumeInput);
    const second = await controlPlane.consumeCapabilityAndEnqueueIngest(validConsumeInput);

    expect(first).toEqual({
      code: 'INGEST_ENQUEUED',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId: defaultIngestReceiptId,
      ingestOutboxId: defaultIngestOutboxId,
      acceptedAt: '2026-07-20T00:00:03.000Z',
    });
    expect(second).toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
      result: 'enqueued',
      runId: safeId,
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId: defaultIngestReceiptId,
      ingestOutboxId: defaultIngestOutboxId,
      acceptedAt: '2026-07-20T00:00:03.000Z',
    });
    expect(active.repository.operationCounts('consume')).toEqual({ invocations: 2, commits: 1 });
    expect(active.repository.operationCounts('issue')).toEqual({ invocations: 1, commits: 1 });
    expect(active.digestCalls()).toBe(3);
    expect(shaCalls).toBe(5);
    expect(clockValues).toEqual([]);
    expect(legacyIdCalls).toEqual([]);
    const summary = active.repository.safeStateSummary();
    expect(summary.transportReceipts).toHaveLength(1);
    expect(summary.ingestOutboxes).toHaveLength(1);
    expect(summary.transportReceipts[0]).toMatchObject({
      ingestReceiptId: defaultIngestReceiptId,
      ingestOutboxId: defaultIngestOutboxId,
      acceptedAt: '2026-07-20T00:00:03.000Z',
    });
    expect(summary.capabilities[0]).toMatchObject({
      consumedAt: '2026-07-20T00:00:03.000Z',
      consumedTransportMessageIdDigest: digest,
      ingestOutboxId: defaultIngestOutboxId,
    });
    const safeSurface = JSON.stringify({ first, second, summary, logs: capturedLogger.records });
    expect(safeSurface).not.toContain(validIssueInput.rawCapability);
    expect(safeSurface).not.toContain(validConsumeInput.transportMessageId);
    expect(safeSurface).not.toContain(validConsumeInput.facts.payload.ordinaryIngest.text);
    expect(capturedLogger.records).toEqual([]);
    expect(intexAgent.postTerminalControlCalls()).toBe(0);
  });

  it('issue/consume exact touched-child corruption checks are causal', async () => {
    type CorruptIssueResult = Extract<CapabilityIssueResult, Readonly<{ code: 'CORRUPT_STATE' }>>;
    type CorruptConsumeResult = Extract<CapabilityConsumeResult, Readonly<{ code: 'CORRUPT_STATE' }>>;

    function applyCorruption(
      repository: FakeMatrixCorpusRepository,
      invariant: FakeMatrixCorpusIssueConsumeInvariantForTest
    ): void {
      expect(repository.corruptIssueConsumeInvariantForTest(invariant)).toBeUndefined();
    }

    async function expectIssueCorruption(
      repository: FakeMatrixCorpusRepository,
      invariant: FakeMatrixCorpusIssueConsumeInvariantForTest,
      command: import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand,
      expected: CorruptIssueResult
    ): Promise<void> {
      const beforeControl = repository.safeStateSummary();
      const beforeCounts = repository.operationCounts('issue');
      applyCorruption(repository, invariant);
      expect(repository.safeStateSummary().version).toBe(beforeControl.version);
      expect(repository.operationCounts('issue')).toEqual(beforeCounts);
      const corrupted = repository.safeStateSummary();
      await expect(repository.issueCapability(command)).resolves.toEqual(expected);
      expect(repository.safeStateSummary()).toEqual(corrupted);
      expect(repository.operationCounts('issue')).toEqual({
        invocations: beforeCounts.invocations + 1,
        commits: beforeCounts.commits,
      });
    }

    async function expectConsumeCorruption(
      repository: FakeMatrixCorpusRepository,
      invariant: FakeMatrixCorpusIssueConsumeInvariantForTest,
      command: ConsumeCapabilityAndEnqueueIngestCommand,
      expected: CorruptConsumeResult
    ): Promise<void> {
      const beforeControl = repository.safeStateSummary();
      const beforeCounts = repository.operationCounts('consume');
      applyCorruption(repository, invariant);
      expect(repository.safeStateSummary().version).toBe(beforeControl.version);
      expect(repository.operationCounts('consume')).toEqual(beforeCounts);
      const corrupted = repository.safeStateSummary();
      await expect(repository.consumeCapabilityAndEnqueueIngest(command)).resolves.toEqual(expected);
      expect(repository.safeStateSummary()).toEqual(corrupted);
      expect(repository.operationCounts('consume')).toEqual({
        invocations: beforeCounts.invocations + 1,
        commits: beforeCounts.commits,
      });
    }

    function newCandidateRepository(index: number): Readonly<{
      repository: FakeMatrixCorpusRepository;
      capability: MatrixCorpusCapabilityV1;
    }> {
      const issued = seededCapability(index, { revokedAt: '2026-07-20T00:00:02.500Z' });
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidIssueConsumeState(issueConsumeSeed({ issued: [issued] }));
      return { repository, capability: issued.capability };
    }

    function candidateIssueCommand(
      capabilityDigest: string,
      index: number
    ): import('../../../domain/matrixCorpus/types.js').IssueCapabilityCommand {
      const base = issueCommand().capability;
      return issueCommand({
        capability: {
          ...base,
          matrixIdempotencyKeyDigest: indexedDigest(10_000 + index),
          issueRequestDigest: indexedDigest(11_000 + index),
          capabilityDigest,
        },
      });
    }

    function newReplaySafetyRepository(index: number): Readonly<{
      repository: FakeMatrixCorpusRepository;
      consumedCapability: MatrixCorpusCapabilityV1;
    }> {
      const pending = seededOutbox(index, 'pending');
      const acceptedTransportDigest = indexedDigest(12_000 + index);
      const consumed = seededCapability(index, {
        consumedAt: pending.createdAt,
        consumedTransportMessageIdDigest: acceptedTransportDigest,
        ingestOutboxId: pending.ingestOutboxId,
      });
      const outstanding = seededCapability(index + 100);
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [consumed, outstanding],
          transportReceipts: [acceptedTransportReceipt(consumed.capability, pending, acceptedTransportDigest)],
          ingestOutboxes: [pending],
          unconsumedCapability: {
            digest: outstanding.capability.capabilityDigest,
            phase: outstanding.capability.phase,
          },
          leaseOverrides: {
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 0,
              terminalOutboxCount: 0,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        })
      );
      return { repository, consumedCapability: consumed.capability };
    }

    function replaySafetyCommand(
      capability: MatrixCorpusCapabilityV1,
      index: number
    ): ConsumeCapabilityAndEnqueueIngestCommand {
      return consumeCommandForCapability(
        capability,
        indexedDigest(13_000 + index),
        `receipt_replay_corrupt_${String(index)}`,
        `outbox_replay_corrupt_${String(index)}`,
        indexedDigest(14_000 + index)
      );
    }

    function newTerminalReferenceRepository(index: number): Readonly<{
      repository: FakeMatrixCorpusRepository;
      acceptedCapability: MatrixCorpusCapabilityV1;
      acceptedReceipt: MatrixCorpusTransportReceiptV1;
    }> {
      const closed = seededOutbox(index, 'closed');
      const acceptedTransportDigest = indexedDigest(15_000 + index);
      const acceptedCapability = seededCapability(index, {
        consumedAt: closed.createdAt,
        consumedTransportMessageIdDigest: acceptedTransportDigest,
        ingestOutboxId: closed.ingestOutboxId,
      });
      const terminalCapability = seededCapability(index + 100, { revokedAt: '2026-07-20T00:00:02.500Z' });
      const acceptedReceipt = acceptedTransportReceipt(acceptedCapability.capability, closed, acceptedTransportDigest);
      const terminalReceipt = terminalTransportReceipt(terminalCapability.capability, index, 'CAPABILITY_REVOKED');
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [acceptedCapability, terminalCapability],
          transportReceipts: [acceptedReceipt, terminalReceipt],
          ingestOutboxes: [closed],
          leaseOverrides: {
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 0,
              terminalOutboxCount: 0,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        })
      );
      return { repository, acceptedCapability: acceptedCapability.capability, acceptedReceipt };
    }

    function acceptedReplayCommand(
      capability: MatrixCorpusCapabilityV1,
      receipt: MatrixCorpusTransportReceiptV1,
      index: number
    ): ConsumeCapabilityAndEnqueueIngestCommand {
      return consumeCommandForCapability(
        capability,
        receipt.transportMessageIdDigest,
        `receipt_terminal_ref_retry_${String(index)}`,
        `outbox_terminal_ref_retry_${String(index)}`,
        receipt.ingressRequestDigest
      );
    }

    const candidateMapKey = newCandidateRepository(500);
    await expectIssueCorruption(
      candidateMapKey.repository,
      'candidate_capability_intrinsic_digest_map_key',
      candidateIssueCommand('f'.repeat(64), 500),
      { code: 'CORRUPT_STATE', recordKind: 'capability' }
    );

    const missingRequestedCapability = newCandidateRepository(508);
    await expectConsumeCorruption(
      missingRequestedCapability.repository,
      'candidate_capability_intrinsic_digest_map_key',
      consumeCommandForCapability(
        missingRequestedCapability.capability,
        indexedDigest(15_508),
        'receipt_missing_capability_retry',
        'outbox_missing_capability_retry',
        indexedDigest(16_508)
      ),
      { code: 'CORRUPT_STATE', recordKind: 'capability' }
    );

    const candidateHistory = newCandidateRepository(501);
    await expectIssueCorruption(
      candidateHistory.repository,
      'candidate_capability_history_membership',
      candidateIssueCommand(candidateHistory.capability.capabilityDigest, 501),
      { code: 'CORRUPT_STATE', recordKind: 'capability' }
    );

    const missingTransportOutbox = seededOutbox(502, 'pending');
    const missingTransportDigest = indexedDigest(12_502);
    const missingTransportCapability = seededCapability(502, {
      consumedAt: missingTransportOutbox.createdAt,
      consumedTransportMessageIdDigest: missingTransportDigest,
      ingestOutboxId: missingTransportOutbox.ingestOutboxId,
    });
    const missingTransportReceipt = acceptedTransportReceipt(
      missingTransportCapability.capability,
      missingTransportOutbox,
      missingTransportDigest
    );
    const missingTransportRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    missingTransportRepository.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [missingTransportCapability],
        transportReceipts: [missingTransportReceipt],
        ingestOutboxes: [missingTransportOutbox],
        leaseOverrides: {
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        },
      })
    );
    expect(missingTransportRepository.safeStateSummary().histories[0]?.terminalFailureReceiptRefs).toEqual([]);
    await expectConsumeCorruption(
      missingTransportRepository,
      'history_transport_reference_missing_receipt',
      consumeCommandForCapability(
        missingTransportCapability.capability,
        missingTransportReceipt.transportMessageIdDigest,
        'receipt_missing_transport_retry',
        'outbox_missing_transport_retry',
        missingTransportReceipt.ingressRequestDigest
      ),
      { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' }
    );

    for (const [index, invariant, expected] of [
      [503, 'replay_safety_pointed_capability_intrinsic_digest_map_key', 'capability'],
      [504, 'replay_safety_pointed_capability_phase', 'capability'],
      [505, 'pending_outbox_nonterminal_membership', 'ingest_outbox'],
    ] as const) {
      const replaySafety = newReplaySafetyRepository(index);
      await expectConsumeCorruption(
        replaySafety.repository,
        invariant,
        replaySafetyCommand(replaySafety.consumedCapability, index),
        { code: 'CORRUPT_STATE', recordKind: expected }
      );
    }

    for (const [index, invariant] of [
      [506, 'terminal_failure_reference_missing_receipt'],
      [507, 'terminal_failure_reference_capability_mismatch'],
    ] as const) {
      const terminalReference = newTerminalReferenceRepository(index);
      await expectConsumeCorruption(
        terminalReference.repository,
        invariant,
        acceptedReplayCommand(terminalReference.acceptedCapability, terminalReference.acceptedReceipt, index),
        { code: 'CORRUPT_STATE', recordKind: 'transport_receipt' }
      );
    }

    expect(() =>
      applyCorruption(
        new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } }),
        'candidate_capability_intrinsic_digest_map_key'
      )
    ).toThrow(FakeMatrixCorpusRepositoryFault);
  });

  it('R5/R15 receipt-first issue replay survives lifecycle and response loss', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    await repository.acquireProvisioningLease(acquireCommand());
    await repository.activateRun(activateCommand());
    const command = issueCommand();
    const digestCallsBeforeIssue = digestCalls;
    repository.loseNextResponseAfterCommit('issue');

    await expect(repository.issueCapability(command)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
    });
    await expect(
      repository.issueCapability({ ...command, now: '2026-07-20T00:01:03.000Z' })
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'issue',
      result: 'issued',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      issuedAt: '2026-07-20T00:00:02.000Z',
      expiresAt: '2026-07-20T00:01:02.000Z',
    });
    await expect(
      repository.issueCapability({
        ...command,
        capability: { ...command.capability, issueRequestDigest: '4'.repeat(64) },
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      repository.issueCapability({
        ...command,
        capability: { ...command.capability, capabilityDigest: '5'.repeat(64) },
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(repository.operationCounts('issue')).toEqual({ invocations: 4, commits: 1 });
    expect(digestCalls - digestCallsBeforeIssue).toBe(4);
  });

  it('R5 issue collisions and the 800-receipt boundary are inert', async () => {
    const consumedOutbox = seededOutbox(10, 'closed');
    const consumedTransportDigest = indexedDigest(8_010);
    const collisionRows = [
      {
        issued: seededCapability(10, {
          consumedAt: consumedOutbox.createdAt,
          consumedTransportMessageIdDigest: consumedTransportDigest,
          ingestOutboxId: consumedOutbox.ingestOutboxId,
        }),
        pointer: false,
        expected: { code: 'CAPABILITY_REPLAY' },
        outbox: consumedOutbox,
      },
      {
        issued: seededCapability(11, { revokedAt: '2026-07-20T00:00:02.500Z' }),
        pointer: false,
        expected: { code: 'CAPABILITY_REVOKED' },
        outbox: null,
      },
      {
        issued: seededCapability(12, {
          issuedAt: '2026-07-19T23:59:00.000Z',
          expiresAt: '2026-07-19T23:59:30.000Z',
        }),
        pointer: true,
        expected: { code: 'PHASE_CONFLICT', actualPhase: 'active' },
        outbox: null,
      },
      {
        issued: seededCapability(13),
        pointer: true,
        expected: { code: 'PHASE_CONFLICT', actualPhase: 'active' },
        outbox: null,
      },
    ] as const;
    for (const { issued, pointer, expected, outbox } of collisionRows) {
      let digestCalls = 0;
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
      });
      repository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [issued],
          transportReceipts:
            outbox === null ? [] : [acceptedTransportReceipt(issued.capability, outbox, consumedTransportDigest)],
          ingestOutboxes: outbox === null ? [] : [outbox],
          ...(outbox === null
            ? {}
            : {
                leaseOverrides: {
                  drain: {
                    consumedCapabilityCount: 1,
                    terminalIntexMarkerCount: 0,
                    terminalOutboxCount: 0,
                    replyOrDeliveryWorkInFlight: 0,
                    drained: false,
                  },
                },
              }),
          unconsumedCapability: pointer
            ? { digest: issued.capability.capabilityDigest, phase: issued.capability.phase }
            : null,
        })
      );
      const before = repository.safeStateSummary();
      const fresh = issueCommand({
        capability: {
          ...issueCommand().capability,
          matrixIdempotencyKeyDigest: indexedDigest(8_100),
          issueRequestDigest: indexedDigest(8_101),
          capabilityDigest: issued.capability.capabilityDigest,
        },
      });
      await expect(repository.issueCapability(fresh)).resolves.toEqual(expected);
      expect(repository.safeStateSummary()).toEqual(before);
      expect(digestCalls).toBe(0);
      expect(repository.operationCounts('issue')).toEqual({ invocations: 1, commits: 0 });
    }

    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    const issued = Array.from({ length: 800 }, (_, index) =>
      seededCapability(100 + index, { revokedAt: '2026-07-20T00:00:02.500Z' })
    );
    repository.seedValidIssueConsumeState(issueConsumeSeed({ issued }));
    const before = repository.safeStateSummary();
    const candidate = issueCommand({
      capability: {
        ...issueCommand().capability,
        matrixIdempotencyKeyDigest: indexedDigest(9_900),
        issueRequestDigest: indexedDigest(9_901),
        capabilityDigest: indexedDigest(9_902),
      },
    });
    await expect(repository.issueCapability(candidate)).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(digestCalls).toBe(0);
    const oldest = issued[0];
    expect(oldest).toBeDefined();
    if (oldest === undefined) throw new Error('fixture construction failed');
    await expect(
      repository.issueCapability({
        now: '2026-07-20T00:02:00.000Z',
        leaseSlotDigest: digest,
        runFenceDigest: 'b'.repeat(64),
        capability: oldest.capability,
      })
    ).resolves.toMatchObject({ code: 'ALREADY_APPLIED', operation: 'issue', result: 'issued' });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(digestCalls).toBe(1);
  });

  it('R6 active authority permits only one outstanding capability', async () => {
    const { repository } = await activeRepository();
    const firstCommand = issueCommand();
    const secondCommand = issueCommand({
      capability: {
        ...firstCommand.capability,
        matrixIdempotencyKeyDigest: '3'.repeat(64),
        issueRequestDigest: '4'.repeat(64),
        capabilityDigest: '5'.repeat(64),
      },
    });
    const firstGate = repository.deferNextBeforeAdmission('issue');
    const secondGate = repository.deferNextBeforeAdmission('issue');
    const first = repository.issueCapability(firstCommand);
    const second = repository.issueCapability(secondCommand);
    await Promise.all([firstGate.entered, secondGate.entered]);
    secondGate.release();
    await expect(second).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    firstGate.release();
    await expect(first).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    const semanticRows = [
      {
        phase: 'start' as const,
        turnIndex: 0,
        expectedSessionId: null,
        pendingConfirmationId: null,
        expectedDecision: null,
      },
      {
        phase: 'turn' as const,
        turnIndex: 1,
        expectedSessionId: 'session_1',
        pendingConfirmationId: null,
        expectedDecision: null,
      },
      {
        phase: 'confirmation' as const,
        turnIndex: 2,
        expectedSessionId: 'session_1',
        pendingConfirmationId: 'confirmation_1',
        expectedDecision: 'confirm' as const,
      },
    ];
    for (const [index, semantic] of semanticRows.entries()) {
      const candidate = issueCommand().capability;
      await expect(
        repository.issueCapability({
          ...issueCommand(),
          capability: {
            ...candidate,
            ...semantic,
            matrixIdempotencyKeyDigest: indexedDigest(8_200 + index),
            issueRequestDigest: indexedDigest(8_300 + index),
            capabilityDigest: indexedDigest(8_400 + index),
          },
        })
      ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    }
    expect(repository.safeStateSummary().capabilities).toEqual([
      expect.objectContaining({ capabilityDigest: secondCommand.capability.capabilityDigest, consumedAt: null }),
    ]);
    expect(repository.operationCounts('issue')).toEqual({ invocations: 5, commits: 1 });
  });

  it('issue static authority failures are read-only', async () => {
    const missing = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const missingBefore = missing.safeStateSummary();
    await expect(missing.issueCapability(issueCommand())).resolves.toEqual({ code: 'NOT_FOUND' });
    expect(missing.safeStateSummary()).toEqual(missingBefore);

    const active = await activeRepository();
    const before = active.repository.safeStateSummary();
    const digestCallsBefore = active.digestCalls();
    const staleRows = [
      issueCommand({ runFenceDigest: 'c'.repeat(64) }),
      issueCommand({ capability: { ...issueCommand().capability, runId: 'run_2' } }),
      issueCommand({ capability: { ...issueCommand().capability, userId: 'user_2' } }),
      issueCommand({ capability: { ...issueCommand().capability, leaseFence: '2' } }),
      issueCommand({ capability: { ...issueCommand().capability, matrixRoomBindingDigest: '1'.repeat(64) } }),
      issueCommand({ capability: { ...issueCommand().capability, whatsappAccountBindingDigest: '2'.repeat(64) } }),
      issueCommand({ capability: { ...issueCommand().capability, whatsappSenderBindingDigest: '3'.repeat(64) } }),
    ];
    for (const command of staleRows)
      await expect(active.repository.issueCapability(command)).resolves.toEqual({ code: 'STALE_FENCE' });
    const invalidAudienceIssue = structuredClone(issueCommand());
    Reflect.set(invalidAudienceIssue.capability, 'runtimeAudience', 'production');
    await expect(
      Reflect.apply(active.repository.issueCapability, active.repository, [invalidAudienceIssue])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      active.repository.issueCapability(issueCommand({ leaseSlotDigest: '4'.repeat(64) }))
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      active.repository.issueCapability(issueCommand({ now: '2026-07-20T00:01:00.000Z' }))
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    const candidate = issueCommand().capability;
    const lifecycleRows = [
      {
        ...candidate,
        consumedAt: '2026-07-20T00:00:02.000Z',
        consumedTransportMessageIdDigest: '3'.repeat(64),
        ingestOutboxId: 'outbox_1',
      },
      { ...candidate, revokedAt: '2026-07-20T00:00:02.000Z' },
      { ...candidate, issuedAt: '2026-07-20T00:00:01.000Z' },
    ];
    for (const capability of lifecycleRows)
      await expect(active.repository.issueCapability({ ...issueCommand(), capability })).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'command',
      });
    expect(active.repository.safeStateSummary()).toEqual(before);
    expect(active.digestCalls()).toBe(digestCallsBefore);
    expect(active.repository.operationCounts('issue')).toEqual({ invocations: 13, commits: 0 });

    const wrongPhase = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    wrongPhase.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [],
        leaseOverrides: {
          phase: 'quiescing',
          quiescedAt: '2026-07-20T00:00:02.000Z',
          drain: {
            consumedCapabilityCount: 0,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: true,
          },
        },
      })
    );
    const wrongPhaseBefore = wrongPhase.safeStateSummary();
    await expect(wrongPhase.issueCapability(issueCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'quiescing',
    });
    expect(wrongPhase.safeStateSummary()).toEqual(wrongPhaseBefore);
  });

  it('issue draft faults are atomic and response loss replays', async () => {
    for (const stage of [
      'issue_after_capability_draft',
      'issue_after_issuance_receipt_draft',
      'issue_after_lease_pair_draft',
    ] as const) {
      const { repository } = await activeRepository();
      const before = repository.safeStateSummary();
      repository.failNextAt(stage);
      await expect(repository.issueCapability(issueCommand())).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('issue')).toEqual({ invocations: 1, commits: 0 });
    }

    const { repository } = await activeRepository();
    repository.loseNextResponseAfterCommit('issue');
    await expect(repository.issueCapability(issueCommand())).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const committed = repository.safeStateSummary();
    await expect(repository.issueCapability({ ...issueCommand(), now: '2026-07-20T00:01:03.000Z' })).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'issue',
      result: 'issued',
    });
    expect(repository.safeStateSummary()).toEqual(committed);
  });

  it('issue digest failures are atomic and stored integrity is immutable', async () => {
    for (const behavior of ['throw', 'invalid'] as const) {
      let fail = false;
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: {
          digest: () => {
            if (!fail) return digest;
            if (behavior === 'throw') throw new Error('private digest failure');
            return 'INVALID';
          },
        },
      });
      await repository.acquireProvisioningLease(acquireCommand());
      await repository.activateRun(activateCommand());
      const before = repository.safeStateSummary();
      fail = true;
      await expect(repository.issueCapability(issueCommand())).resolves.toEqual({
        code: 'CORRUPT_STATE',
        recordKind: 'dependency_result',
      });
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('issue')).toEqual({ invocations: 1, commits: 0 });
    }

    let replayDigest = digest;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => replayDigest },
    });
    await repository.acquireProvisioningLease(acquireCommand());
    await repository.activateRun(activateCommand());
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const committed = repository.safeStateSummary();
    replayDigest = 'b'.repeat(64);
    await expect(repository.issueCapability(issueCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'issuance_receipt',
    });
    expect(repository.safeStateSummary()).toEqual(committed);
    expect(repository.operationCounts('issue')).toEqual({ invocations: 2, commits: 1 });
  });

  it('isolates fresh and replayed issue digest arguments at the transaction boundary', async () => {
    const privateRawInput = 'private digest-port raw input';
    const capturedProjections: MatrixCorpusPersistedReplayProjectionV1[] = [];
    const safeEvidence: MatrixCorpusReplayProjectionEvidence[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          if (projection.operation !== 'issue') return digest;
          capturedProjections.push(projection);
          safeEvidence.push(safeReplayProjectionEvidence(projection));
          Reflect.set(projection, 'runId', 'run_9');
          Reflect.set(projection, 'privateRawInput', privateRawInput);
          return digest;
        },
      },
    });
    await expect(repository.acquireProvisioningLease(acquireCommand())).resolves.toMatchObject({ code: 'ACQUIRED' });
    await expect(repository.activateRun(activateCommand())).resolves.toMatchObject({ code: 'ACTIVATED' });

    const command = issueCommand();
    await expect(repository.issueCapability(command)).resolves.toMatchObject({
      code: 'CAPABILITY_ISSUED',
      runId: 'run_1',
    });
    const committed = repository.safeStateSummary();
    await expect(repository.issueCapability(command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'issue',
      result: 'issued',
      runId: 'run_1',
    });
    expect(repository.safeStateSummary()).toEqual(committed);
    expect(capturedProjections).toHaveLength(2);
    expect(safeEvidence).toEqual([
      { operation: 'issue', result: 'issued' },
      { operation: 'issue', result: 'issued' },
    ]);
    expect(JSON.stringify({ committed, safeEvidence })).not.toContain(privateRawInput);
    for (const projection of capturedProjections) {
      expect(Reflect.get(projection, 'runId')).toBe('run_9');
      expect(Reflect.get(projection, 'privateRawInput')).toBe(privateRawInput);
    }
  });

  it('R7 deterministic same-transport consume race commits one product event', async () => {
    const fresh = await activeRepository();
    await expect(fresh.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    await expect(fresh.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
    });

    const repository = await activeRepository();
    await expect(repository.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const firstGate = repository.repository.deferNextBeforeAdmission('consume');
    const secondGate = repository.repository.deferNextBeforeAdmission('consume');
    const command = consumeCommand();
    const first = repository.repository.consumeCapabilityAndEnqueueIngest(command);
    const second = repository.repository.consumeCapabilityAndEnqueueIngest(command);
    await Promise.all([firstGate.entered, secondGate.entered]);
    secondGate.release();
    await expect(second).resolves.toMatchObject({ code: 'INGEST_ENQUEUED' });
    firstGate.release();
    await expect(first).resolves.toMatchObject({ code: 'ALREADY_APPLIED', operation: 'consume', result: 'enqueued' });

    const summary = repository.repository.safeStateSummary();
    expect(summary.capabilities).toMatchObject([
      {
        capabilityDigest: issueCommand().capability.capabilityDigest,
        consumedAt: '2026-07-20T00:00:03.000Z',
        consumedTransportMessageIdDigest: '3'.repeat(64),
        ingestOutboxId: 'outbox_1',
      },
    ]);
    expect(summary.ingestOutboxes).toEqual([
      expect.objectContaining({ ingestOutboxId: 'outbox_1', status: 'pending' }),
    ]);
    expect(summary.transportReceipts).toEqual([
      expect.objectContaining({
        transportMessageIdDigest: command.transportMessageIdDigest,
        ingestReceiptId: command.ingestReceiptId,
        ingestOutboxId: command.ingestOutboxId,
        acceptedAt: command.now,
        terminalFailureCode: null,
      }),
    ]);
    expect(summary.current[0]?.lease).toMatchObject({
      unconsumedCapability: null,
      nonterminalIngestOutboxIds: [command.ingestOutboxId],
      ingestOutboxIds: [command.ingestOutboxId],
      transportReceiptIds: [command.transportMessageIdDigest],
      drain: { consumedCapabilityCount: 1, drained: false },
    });
    expect(repository.repository.hasExactPrivateIngestPayload('outbox_1', command.facts.payload)).toBe(true);
    expect(repository.repository.operationCounts('consume')).toEqual({ invocations: 2, commits: 1 });
  });

  it('accepted consume replay survives later time and quiescing without digest work', async () => {
    const state = await activeRepository();
    await expect(state.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const accepted = consumeCommand();
    await expect(state.repository.consumeCapabilityAndEnqueueIngest(accepted)).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
    });
    await expect(
      state.repository.consumeCapabilityAndEnqueueIngest(
        consumeCommandForTransport('4'.repeat(64), 'receipt_2', 'outbox_2', '5'.repeat(64))
      )
    ).resolves.toEqual({ code: 'CAPABILITY_REPLAY' });
    const before = state.repository.safeStateSummary();
    const digestCallsBeforeReplay = state.digestCalls();
    const changedCandidateIds = consumeCommandForTransport(
      accepted.transportMessageIdDigest,
      'receipt_retry',
      'outbox_retry',
      accepted.ingressRequestDigest
    );
    await expect(
      state.repository.consumeCapabilityAndEnqueueIngest({
        ...changedCandidateIds,
        now: '2026-07-20T00:02:00.000Z',
      })
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
      result: 'enqueued',
      runId: 'run_1',
      scenarioId: 'scenario_1',
      phase: 'start',
      turnIndex: 0,
      ingestReceiptId: accepted.ingestReceiptId,
      ingestOutboxId: accepted.ingestOutboxId,
      acceptedAt: accepted.now,
    });
    expect(state.repository.safeStateSummary()).toEqual(before);
    expect(state.digestCalls()).toBe(digestCallsBeforeReplay);
  });

  it('serializes fresh issue against first consume in either selected admission order', async () => {
    const freshIssue = () => {
      const initial = issueCommand();
      return issueCommand({
        capability: {
          ...initial.capability,
          matrixIdempotencyKeyDigest: '4'.repeat(64),
          issueRequestDigest: '5'.repeat(64),
          capabilityDigest: '6'.repeat(64),
        },
      });
    };

    const issueFirst = await activeRepository();
    await expect(issueFirst.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const issueGate = issueFirst.repository.deferNextBeforeAdmission('issue');
    const consumeGate = issueFirst.repository.deferNextBeforeAdmission('consume');
    const pendingIssue = issueFirst.repository.issueCapability(freshIssue());
    const pendingConsume = issueFirst.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await Promise.all([issueGate.entered, consumeGate.entered]);
    issueGate.release();
    await expect(pendingIssue).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    consumeGate.release();
    await expect(pendingConsume).resolves.toMatchObject({ code: 'INGEST_ENQUEUED' });

    const consumeFirst = await activeRepository();
    await expect(consumeFirst.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const secondIssueGate = consumeFirst.repository.deferNextBeforeAdmission('issue');
    const secondConsumeGate = consumeFirst.repository.deferNextBeforeAdmission('consume');
    const pendingSecondIssue = consumeFirst.repository.issueCapability(freshIssue());
    const pendingSecondConsume = consumeFirst.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await Promise.all([secondIssueGate.entered, secondConsumeGate.entered]);
    secondConsumeGate.release();
    await expect(pendingSecondConsume).resolves.toMatchObject({ code: 'INGEST_ENQUEUED' });
    secondIssueGate.release();
    await expect(pendingSecondIssue).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
  });

  it('R8 different-transport capability replay quiesces once', async () => {
    const { repository } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
    });
    const initial = consumeCommand();
    const replay = {
      ...initial,
      now: '2026-07-20T00:00:04.000Z',
      transportMessageIdDigest: '4'.repeat(64),
      ingestReceiptId: 'receipt_2',
      ingestOutboxId: 'outbox_2',
      ingressRequestDigest: '5'.repeat(64),
      facts: {
        ...initial.facts,
        ingressRequestDigest: '5'.repeat(64),
        ingressRequest: {
          ...initial.facts.ingressRequest,
          transportMessageIdDigest: '4'.repeat(64),
          ingestReceiptId: 'receipt_2',
          ingestOutboxId: 'outbox_2',
          promptDigest: 'f'.repeat(64),
        },
        payload: {
          ...initial.facts.payload,
          context: {
            ...initial.facts.payload.context,
            ingestReceiptId: 'receipt_2',
            promptDigest: 'f'.repeat(64),
          },
        },
      },
    } satisfies ConsumeCapabilityAndEnqueueIngestCommand;

    await expect(repository.consumeCapabilityAndEnqueueIngest(replay)).resolves.toEqual({ code: 'CAPABILITY_REPLAY' });
    const summary = repository.safeStateSummary();
    expect(
      summary.transportReceipts.find(
        (receipt) => receipt.transportMessageIdDigest === replay.transportMessageIdDigest
      )?.promptDigest
    ).toBe(replay.facts.ingressRequest.promptDigest);
    expect(summary.current[0]?.lease).toMatchObject({
      phase: 'quiescing',
      quiescedAt: '2026-07-20T00:00:04.000Z',
      unconsumedCapability: null,
      nonterminalIngestOutboxIds: [],
      drain: { consumedCapabilityCount: 1, terminalIntexMarkerCount: 0, terminalOutboxCount: 0, drained: false },
    });
    expect(summary.ingestOutboxes).toEqual([
      expect.objectContaining({
        ingestOutboxId: 'outbox_1',
        status: 'closed',
        closedReason: 'capability_replay',
        closedAt: '2026-07-20T00:00:04.000Z',
      }),
    ]);
    expect(summary.transportReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transportMessageIdDigest: '4'.repeat(64),
          capabilityDigest: initial.capabilityDigest,
          terminalFailureCode: 'CAPABILITY_REPLAY',
        }),
      ])
    );
    await expect(repository.consumeCapabilityAndEnqueueIngest({ ...replay, now: '2026-07-20T00:00:05.000Z' })).resolves.toEqual({
      code: 'CAPABILITY_REPLAY',
    });
    await expect(
      repository.consumeCapabilityAndEnqueueIngest({
        ...replay,
        ingressRequestDigest: '6'.repeat(64),
        facts: { ...replay.facts, ingressRequestDigest: '6'.repeat(64) },
      })
    ).resolves.toEqual({ code: 'TRANSPORT_REPLAY' });

    for (const [offset, status] of (['claimed', 'published'] as const).entries()) {
      const retainedOutbox = seededOutbox(20 + offset, status);
      const acceptedTransportDigest = indexedDigest(9_000 + offset);
      const consumedCapability = seededCapability(20 + offset, {
        consumedAt: retainedOutbox.createdAt,
        consumedTransportMessageIdDigest: acceptedTransportDigest,
        ingestOutboxId: retainedOutbox.ingestOutboxId,
      });
      const outstandingCapability = seededCapability(30 + offset);
      const acceptedReceipt = acceptedTransportReceipt(
        consumedCapability.capability,
        retainedOutbox,
        acceptedTransportDigest
      );
      const seededRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      seededRepository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [outstandingCapability, consumedCapability],
          transportReceipts: [acceptedReceipt],
          ingestOutboxes: [retainedOutbox],
          unconsumedCapability: {
            digest: outstandingCapability.capability.capabilityDigest,
            phase: outstandingCapability.capability.phase,
          },
          leaseOverrides: {
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 0,
              terminalOutboxCount: 0,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        })
      );
      const baseReplay = consumeCommandForTransport(
        indexedDigest(9_100 + offset),
        `receipt_replay_${String(offset)}`,
        `outbox_replay_${String(offset)}`,
        indexedDigest(9_200 + offset)
      );
      const seededReplay = {
        ...baseReplay,
        capabilityDigest: consumedCapability.capability.capabilityDigest,
        facts: {
          ...baseReplay.facts,
          ingressRequest: {
            ...baseReplay.facts.ingressRequest,
            capabilityDigest: consumedCapability.capability.capabilityDigest,
          },
        },
      } satisfies ConsumeCapabilityAndEnqueueIngestCommand;
      await expect(seededRepository.consumeCapabilityAndEnqueueIngest(seededReplay)).resolves.toEqual({
        code: 'CAPABILITY_REPLAY',
      });
      const seededSummary = seededRepository.safeStateSummary();
      expect(seededSummary).toMatchObject({
        version: 2,
        current: [
          {
            lease: {
              phase: 'quiescing',
              unconsumedCapability: null,
              nonterminalIngestOutboxIds: [retainedOutbox.ingestOutboxId],
              terminalFailureReceiptRefs: [
                {
                  transportReceiptId: seededReplay.transportMessageIdDigest,
                  capabilityDigest: consumedCapability.capability.capabilityDigest,
                },
              ],
              drain: { consumedCapabilityCount: 1, drained: false },
            },
          },
        ],
        ingestOutboxes: [
          expect.objectContaining({
            ingestOutboxId: retainedOutbox.ingestOutboxId,
            status,
            closedReason: null,
          }),
        ],
      });
      expect(
        seededSummary.capabilities.find(
          (capability) => capability.capabilityDigest === consumedCapability.capability.capabilityDigest
        )
      ).toMatchObject({
        consumedAt: consumedCapability.capability.consumedAt,
        revokedAt: null,
      });
      expect(
        seededSummary.capabilities.find(
          (capability) => capability.capabilityDigest === outstandingCapability.capability.capabilityDigest
        )
      ).toMatchObject({ revokedAt: seededReplay.now });
      expect(seededRepository.hasExactPrivateIngestPayload(retainedOutbox.ingestOutboxId, retainedOutbox.payload)).toBe(
        true
      );
      expect(seededRepository.operationCounts('consume')).toEqual({ invocations: 1, commits: 1 });
    }
  });

  it('R9 immutable transport receipts and terminal failure quotas converge', async () => {
    const terminalRows = [
      {
        issued: seededCapability(40, {
          issuedAt: '2026-07-19T23:59:00.000Z',
          expiresAt: '2026-07-19T23:59:30.000Z',
        }),
        now: '2026-07-20T00:00:03.000Z',
        pointer: true,
        expectedCode: 'CAPABILITY_EXPIRED',
      },
      {
        issued: seededCapability(41, { revokedAt: '2026-07-20T00:00:02.500Z' }),
        now: '2026-07-20T00:00:03.000Z',
        pointer: false,
        expectedCode: 'CAPABILITY_REVOKED',
      },
      {
        issued: seededCapability(42),
        now: '2026-07-19T23:59:31.999Z',
        pointer: true,
        expectedCode: 'CAPABILITY_MISMATCH',
      },
      {
        issued: seededCapability(43),
        now: '2026-07-20T00:00:03.000Z',
        pointer: true,
        expectedCode: 'CAPABILITY_MISMATCH',
      },
    ] as const;
    for (const [index, row] of terminalRows.entries()) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [row.issued],
          unconsumedCapability: row.pointer
            ? { digest: row.issued.capability.capabilityDigest, phase: row.issued.capability.phase }
            : null,
        })
      );
      const base = consumeCommandForCapability(
        row.issued.capability,
        indexedDigest(9_300 + index),
        `receipt_terminal_${String(index)}`,
        `outbox_terminal_${String(index)}`,
        indexedDigest(9_400 + index)
      );
      const command = {
        ...base,
        now: row.now,
        facts: {
          ...base.facts,
          ingressRequest: { ...base.facts.ingressRequest, promptDigest: 'f'.repeat(64) },
          payload: {
            ...base.facts.payload,
            context: { ...base.facts.payload.context, promptDigest: 'f'.repeat(64) },
          },
        },
      } satisfies ConsumeCapabilityAndEnqueueIngestCommand;
      await expect(repository.consumeCapabilityAndEnqueueIngest(command)).resolves.toEqual({
        code: row.expectedCode,
      });
      const committed = repository.safeStateSummary();
      expect(committed.transportReceipts[0]?.promptDigest).toBe(command.facts.ingressRequest.promptDigest);
      expect(committed).toMatchObject({
        version: 2,
        transportReceipts: [
          {
            transportMessageIdDigest: command.transportMessageIdDigest,
            capabilityDigest: row.issued.capability.capabilityDigest,
            recordedAt: command.now,
            terminalFailureCode: row.expectedCode,
          },
        ],
        ingestOutboxes: [],
        current: [
          {
            lease: {
              terminalFailureReceiptRefs: [
                {
                  transportReceiptId: command.transportMessageIdDigest,
                  capabilityDigest: row.issued.capability.capabilityDigest,
                },
              ],
            },
          },
        ],
      });
      await expect(
        repository.consumeCapabilityAndEnqueueIngest({ ...command, now: '2026-07-20T00:00:59.000Z' })
      ).resolves.toEqual({ code: row.expectedCode });
      expect(repository.safeStateSummary()).toEqual(committed);
      expect(repository.operationCounts('consume')).toEqual({ invocations: 2, commits: 1 });
    }

    const { repository } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const mismatch = (transportDigest: string, receiptId: string, outboxId: string, ingressDigest: string) => {
      const command = consumeCommandForTransport(transportDigest, receiptId, outboxId, ingressDigest);
      return {
        ...command,
        facts: {
          ...command.facts,
          payload: {
            ...command.facts.payload,
            context: { ...command.facts.payload.context, currentDateTime: '2026-07-20T00:00:04.000Z' },
          },
        },
      } satisfies ConsumeCapabilityAndEnqueueIngestCommand;
    };
    const first = mismatch('4'.repeat(64), 'receipt_2', 'outbox_2', '5'.repeat(64));
    const second = mismatch('6'.repeat(64), 'receipt_3', 'outbox_3', '7'.repeat(64));
    const third = mismatch('8'.repeat(64), 'receipt_4', 'outbox_4', '9'.repeat(64));

    await expect(repository.consumeCapabilityAndEnqueueIngest(first)).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });
    await expect(
      repository.consumeCapabilityAndEnqueueIngest({
        ...first,
        ingressRequestDigest: 'a'.repeat(64),
        facts: { ...first.facts, ingressRequestDigest: 'a'.repeat(64) },
      })
    ).resolves.toEqual({ code: 'TRANSPORT_REPLAY' });
    await expect(repository.consumeCapabilityAndEnqueueIngest(second)).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });
    await expect(repository.consumeCapabilityAndEnqueueIngest(third)).resolves.toEqual({ code: 'TERMINAL_RECEIPT_LIMIT' });
    const afterLimit = repository.safeStateSummary();
    await expect(repository.consumeCapabilityAndEnqueueIngest(first)).resolves.toEqual({ code: 'CAPABILITY_MISMATCH' });
    const changedCapability = seededCapability(99).capability;
    await expect(
      repository.consumeCapabilityAndEnqueueIngest({
        ...first,
        capabilityDigest: changedCapability.capabilityDigest,
        facts: {
          ...first.facts,
          ingressRequest: {
            ...first.facts.ingressRequest,
            capabilityDigest: changedCapability.capabilityDigest,
          },
        },
      })
    ).resolves.toEqual({ code: 'TRANSPORT_REPLAY' });
    expect(repository.safeStateSummary()).toEqual(afterLimit);

    const summary = repository.safeStateSummary();
    expect(summary.current[0]?.lease.terminalFailureReceiptRefs).toHaveLength(2);
    expect(summary.transportReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transportMessageIdDigest: first.transportMessageIdDigest, terminalFailureCode: 'CAPABILITY_MISMATCH' }),
        expect.objectContaining({ transportMessageIdDigest: second.transportMessageIdDigest, terminalFailureCode: 'CAPABILITY_MISMATCH' }),
      ])
    );
    expect(summary.ingestOutboxes).toEqual([]);
    expect(summary.capabilities).toEqual([
      expect.objectContaining({ capabilityDigest: first.capabilityDigest, consumedAt: null, revokedAt: null }),
    ]);

    const runCapabilities = Array.from({ length: 33 }, (_, index) =>
      seededCapability(200 + index, { revokedAt: '2026-07-20T00:00:02.500Z' })
    );
    const runReceipts = runCapabilities.slice(0, 32).flatMap(({ capability }, index) => [
      terminalTransportReceipt(capability, 100 + index * 2, 'CAPABILITY_REVOKED'),
      terminalTransportReceipt(capability, 101 + index * 2, 'CAPABILITY_REVOKED'),
    ]);
    const boundedRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    boundedRepository.seedValidIssueConsumeState(
      issueConsumeSeed({ issued: runCapabilities, transportReceipts: runReceipts })
    );
    const boundedBefore = boundedRepository.safeStateSummary();
    const lastCapability = runCapabilities[32];
    const oldestReceipt = runReceipts[0];
    const oldestCapability = runCapabilities[0];
    expect(lastCapability).toBeDefined();
    expect(oldestReceipt).toBeDefined();
    expect(oldestCapability).toBeDefined();
    if (lastCapability === undefined || oldestReceipt === undefined || oldestCapability === undefined)
      throw new Error('fixture construction failed');
    const overRunLimit = consumeCommandForCapability(
      lastCapability.capability,
      indexedDigest(9_999),
      'receipt_over_run_limit',
      'outbox_over_run_limit',
      indexedDigest(9_998)
    );
    await expect(boundedRepository.consumeCapabilityAndEnqueueIngest(overRunLimit)).resolves.toEqual({
      code: 'TERMINAL_RECEIPT_LIMIT',
    });
    const oldestRetry = consumeCommandForCapability(
      oldestCapability.capability,
      oldestReceipt.transportMessageIdDigest,
      'receipt_old_retry',
      'outbox_old_retry',
      oldestReceipt.ingressRequestDigest
    );
    await expect(boundedRepository.consumeCapabilityAndEnqueueIngest(oldestRetry)).resolves.toEqual({
      code: 'CAPABILITY_REVOKED',
    });
    expect(boundedRepository.safeStateSummary()).toEqual(boundedBefore);
    expect(boundedRepository.operationCounts('consume')).toEqual({ invocations: 2, commits: 0 });
  });

  it('consume static authority failures are read-only', async () => {
    const missing = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const missingBefore = missing.safeStateSummary();
    await expect(missing.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toEqual({ code: 'NOT_FOUND' });
    expect(missing.safeStateSummary()).toEqual(missingBefore);

    const missingCapability = await activeRepository();
    const missingCapabilityBefore = missingCapability.repository.safeStateSummary();
    await expect(missingCapability.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toEqual({
      code: 'NOT_FOUND',
    });
    expect(missingCapability.repository.safeStateSummary()).toEqual(missingCapabilityBefore);

    const active = await activeRepository();
    await expect(active.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const before = active.repository.safeStateSummary();
    const base = consumeCommand();
    const staleRows = [
      consumeCommand({ runFenceDigest: 'c'.repeat(64) }),
      {
        ...base,
        facts: {
          ...base.facts,
          payload: {
            ...base.facts.payload,
            context: { ...base.facts.payload.context, runId: 'run_2' },
          },
        },
      },
      {
        ...base,
        facts: {
          ...base.facts,
          ingressRequest: { ...base.facts.ingressRequest, userId: 'user_2' },
          payload: {
            ...base.facts.payload,
            ordinaryIngest: { ...base.facts.payload.ordinaryIngest, userId: 'user_2' },
          },
        },
      },
      {
        ...base,
        facts: {
          ...base.facts,
          payload: {
            ...base.facts.payload,
            context: { ...base.facts.payload.context, leaseFence: '2' },
          },
        },
      },
      ...(['matrixRoomBindingDigest', 'whatsappAccountBindingDigest', 'whatsappSenderBindingDigest'] as const).map(
        (binding, index) => ({
          ...base,
          facts: {
            ...base.facts,
            ingressRequest: { ...base.facts.ingressRequest, [binding]: indexedDigest(9_700 + index) },
          },
        })
      ),
    ] satisfies ConsumeCapabilityAndEnqueueIngestCommand[];
    for (const command of staleRows)
      await expect(active.repository.consumeCapabilityAndEnqueueIngest(command)).resolves.toEqual({ code: 'STALE_FENCE' });
    const invalidAudienceConsume = structuredClone(base);
    Reflect.set(invalidAudienceConsume.facts.payload.context, 'runtimeAudience', 'production');
    await expect(
      Reflect.apply(active.repository.consumeCapabilityAndEnqueueIngest, active.repository, [invalidAudienceConsume])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      active.repository.consumeCapabilityAndEnqueueIngest(consumeCommand({ leaseSlotDigest: '4'.repeat(64) }))
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      active.repository.consumeCapabilityAndEnqueueIngest({ ...consumeCommand(), now: '2026-07-20T00:01:00.000Z' })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    expect(active.repository.safeStateSummary()).toEqual(before);

    const wrongPhaseCapability = seededCapability(400);
    const wrongPhase = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    wrongPhase.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [wrongPhaseCapability],
        unconsumedCapability: {
          digest: wrongPhaseCapability.capability.capabilityDigest,
          phase: wrongPhaseCapability.capability.phase,
        },
        leaseOverrides: {
          phase: 'quiescing',
          quiescedAt: '2026-07-20T00:00:02.000Z',
        },
      })
    );
    const wrongPhaseBefore = wrongPhase.safeStateSummary();
    await expect(
      wrongPhase.consumeCapabilityAndEnqueueIngest(
        consumeCommandForCapability(
          wrongPhaseCapability.capability,
          indexedDigest(9_710),
          'receipt_wrong_phase',
          'outbox_wrong_phase',
          indexedDigest(9_711)
        )
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
    expect(wrongPhase.safeStateSummary()).toEqual(wrongPhaseBefore);

    const liveCapability = seededCapability(401);
    const pendingIntent = seededOutbox(401, 'pending');
    const pendingTransportDigest = indexedDigest(9_719);
    const pendingCapability = seededCapability(402, {
      consumedAt: pendingIntent.createdAt,
      consumedTransportMessageIdDigest: pendingTransportDigest,
      ingestOutboxId: pendingIntent.ingestOutboxId,
    });
    const nonterminal = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    nonterminal.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [liveCapability, pendingCapability],
        transportReceipts: [acceptedTransportReceipt(pendingCapability.capability, pendingIntent, pendingTransportDigest)],
        ingestOutboxes: [pendingIntent],
        leaseOverrides: {
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        },
        unconsumedCapability: { digest: liveCapability.capability.capabilityDigest, phase: liveCapability.capability.phase },
      })
    );
    const nonterminalBefore = nonterminal.safeStateSummary();
    const liveCommand = consumeCommandForCapability(
      liveCapability.capability,
      indexedDigest(9_720),
      'receipt_nonterminal',
      'outbox_nonterminal',
      indexedDigest(9_721)
    );
    await expect(nonterminal.consumeCapabilityAndEnqueueIngest(liveCommand)).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
    expect(nonterminal.safeStateSummary()).toEqual(nonterminalBefore);

    const closedCollision = seededOutbox(402, 'closed');
    const closedTransportDigest = indexedDigest(9_729);
    const closedCapability = seededCapability(403, {
      consumedAt: closedCollision.createdAt,
      consumedTransportMessageIdDigest: closedTransportDigest,
      ingestOutboxId: closedCollision.ingestOutboxId,
    });
    const collision = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    collision.seedValidIssueConsumeState(
      issueConsumeSeed({
        issued: [liveCapability, closedCapability],
        transportReceipts: [
          acceptedTransportReceipt(closedCapability.capability, closedCollision, closedTransportDigest),
        ],
        ingestOutboxes: [closedCollision],
        leaseOverrides: {
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        },
        unconsumedCapability: { digest: liveCapability.capability.capabilityDigest, phase: liveCapability.capability.phase },
      })
    );
    const collisionBefore = collision.safeStateSummary();
    await expect(
      collision.consumeCapabilityAndEnqueueIngest(
        consumeCommandForCapability(
          liveCapability.capability,
          indexedDigest(9_730),
          'receipt_collision',
          closedCollision.ingestOutboxId,
          indexedDigest(9_731)
        )
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
    expect(collision.safeStateSummary()).toEqual(collisionBefore);

    const divergentPointer = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    expect(() =>
      divergentPointer.seedValidIssueConsumeState(
        issueConsumeSeed({
          issued: [liveCapability],
          unconsumedCapability: { digest: indexedDigest(9_999), phase: liveCapability.capability.phase },
        })
      )
    ).toThrow(FakeMatrixCorpusRepositoryFault);
  });

  it('does not let a candidate outbox collision mask capability replay', async () => {
    const active = await activeRepository();
    await expect(active.repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    await expect(active.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'INGEST_ENQUEUED',
    });
    const collidingOutbox = consumeCommandForTransport('4'.repeat(64), 'receipt_2', 'outbox_1', '5'.repeat(64));
    await expect(active.repository.consumeCapabilityAndEnqueueIngest(collidingOutbox)).resolves.toEqual({
      code: 'CAPABILITY_REPLAY',
    });
    expect(active.repository.safeStateSummary()).toMatchObject({
      version: 5,
      current: [{ lease: { phase: 'quiescing', nonterminalIngestOutboxIds: [] } }],
      transportReceipts: [
        { terminalFailureCode: null },
        { transportMessageIdDigest: '4'.repeat(64), terminalFailureCode: 'CAPABILITY_REPLAY' },
      ],
      ingestOutboxes: [{ ingestOutboxId: 'outbox_1', status: 'closed', closedReason: 'capability_replay' }],
    });
  });

  it('R10 captured consume time honors inclusive skew boundaries', async () => {
    const rows = [
      ['2026-07-19T23:59:32.000Z', 'INGEST_ENQUEUED'],
      ['2026-07-19T23:59:31.999Z', 'CAPABILITY_MISMATCH'],
      ['2026-07-20T00:01:32.000Z', 'INGEST_ENQUEUED'],
      ['2026-07-20T00:01:32.001Z', 'CAPABILITY_EXPIRED'],
      ['2026-07-20T01:59:32.000+02:00', 'INGEST_ENQUEUED'],
      ['2026-07-20T02:01:32.000+02:00', 'INGEST_ENQUEUED'],
      ['2026-07-20T02:01:32.001+02:00', 'CAPABILITY_EXPIRED'],
    ] as const;
    for (const [now, expectedCode] of rows) {
      const { repository } = await activeRepository();
      await expect(repository.renewLease(renewCommand({ expiresAt: '2026-07-20T00:05:02.000Z' }))).resolves.toMatchObject({
        code: 'LEASE_RENEWED',
      });
      await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
      const command = { ...consumeCommand(), now };
      const gate = repository.deferNextBeforeAdmission('consume');
      const pending = repository.consumeCapabilityAndEnqueueIngest(command);
      await gate.entered;
      gate.release();
      await expect(pending).resolves.toMatchObject({ code: expectedCode });
      const summary = repository.safeStateSummary();
      expect(summary.ingestOutboxes).toHaveLength(expectedCode === 'INGEST_ENQUEUED' ? 1 : 0);
      expect(summary.transportReceipts).toHaveLength(1);
    }

    const { repository } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const before = repository.safeStateSummary();
    await expect(
      repository.consumeCapabilityAndEnqueueIngest({ ...consumeCommand(), now: '2026-07-20T00:01:00.000Z' })
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    expect(repository.safeStateSummary()).toEqual(before);
  });

  it('R16 consume draft faults are atomic and response loss replays', async () => {
    for (const stage of [
      'consume_after_capability_draft',
      'consume_after_transport_receipt_draft',
      'consume_after_outbox_draft',
      'consume_after_lease_pair_draft',
    ] as const) {
      const { repository } = await activeRepository();
      await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
      const before = repository.safeStateSummary();
      repository.failNextAt(stage);
      await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('consume')).toEqual({ invocations: 1, commits: 0 });
    }

    const { repository } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    repository.loseNextResponseAfterCommit('consume');
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    const committed = repository.safeStateSummary();
    await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
      result: 'enqueued',
    });
    expect(repository.safeStateSummary()).toEqual(committed);
    expect(repository.operationCounts('consume')).toEqual({ invocations: 2, commits: 1 });

    for (const stage of ['consume_after_transport_receipt_draft', 'consume_after_lease_pair_draft'] as const) {
      const { repository: terminalRepository } = await activeRepository();
      await expect(terminalRepository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
      const base = consumeCommandForTransport('4'.repeat(64), 'receipt_2', 'outbox_2', '5'.repeat(64));
      const mismatch = {
        ...base,
        facts: {
          ...base.facts,
          payload: {
            ...base.facts.payload,
            context: { ...base.facts.payload.context, currentDateTime: '2026-07-20T00:00:04.000Z' },
          },
        },
      } satisfies ConsumeCapabilityAndEnqueueIngestCommand;
      const before = terminalRepository.safeStateSummary();
      terminalRepository.failNextAt(stage);
      await expect(terminalRepository.consumeCapabilityAndEnqueueIngest(mismatch)).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(terminalRepository.safeStateSummary()).toEqual(before);
      expect(terminalRepository.safeStateSummary()).toMatchObject({
        transportReceipts: [],
        ingestOutboxes: [],
        current: [{ lease: { transportReceiptIds: [], terminalFailureReceiptRefs: [] } }],
      });
      expect(terminalRepository.operationCounts('consume')).toEqual({ invocations: 1, commits: 0 });
    }

    for (const stage of ['consume_after_outbox_draft', 'consume_after_lease_pair_draft'] as const) {
      const { repository: replayRepository } = await activeRepository();
      await expect(replayRepository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
      await expect(replayRepository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
        code: 'INGEST_ENQUEUED',
      });
      const before = replayRepository.safeStateSummary();
      replayRepository.failNextAt(stage);
      await expect(
        replayRepository.consumeCapabilityAndEnqueueIngest(
          consumeCommandForTransport('4'.repeat(64), 'receipt_2', 'outbox_2', '5'.repeat(64))
        )
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(replayRepository.safeStateSummary()).toEqual(before);
      expect(replayRepository.safeStateSummary()).toMatchObject({
        transportReceipts: [{ terminalFailureCode: null }],
        ingestOutboxes: [{ ingestOutboxId: 'outbox_1', status: 'pending' }],
        current: [
          {
            lease: {
              transportReceiptIds: ['3'.repeat(64)],
              terminalFailureReceiptRefs: [],
              nonterminalIngestOutboxIds: ['outbox_1'],
            },
          },
        ],
      });
      expect(replayRepository.operationCounts('consume')).toEqual({ invocations: 2, commits: 1 });
    }
  });

  it('A2 fake lifecycle seed, safe inspection, and terminal privacy', async () => {
    const active = { ...issueConsumeSeed({ issued: [] }), terminalControlOutboxes: [] };
    const variants = [
      provisioningCleanupSeed(),
      active,
      quiescingSeed(),
      releasePendingSeed('pending'),
      releasePendingSeed('claimed'),
      abandonWithExpiredReleaseSeed(),
    ] satisfies FakeMatrixCorpusLifecycleSeed[];

    for (const seed of variants) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidLifecycleState(seed);
      const summary = repository.safeStateSummary();
      expect(summary).toMatchObject({
        version: 1,
        current: [{ lease: { terminalWinner: null, releasedAt: null, abandonedAt: null } }],
      });
      expect(JSON.stringify(summary)).not.toContain(attestedPayload.ordinaryIngest.text);
    }

    const sorted = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    sorted.seedValidLifecycleState(abandonWithExpiredReleaseSeed());
    const summary = sorted.safeStateSummary();
    expect(summary.terminalControlOutboxes.map((outbox) => outbox.terminalControlId)).toEqual([
      'terminal_abandoned',
      'terminal_release',
    ]);
    expect(summary.current[0]?.lease.terminalControlOutboxIds).toEqual(['terminal_release', 'terminal_abandoned']);
    Reflect.set(summary.terminalControlOutboxes[0] ?? {}, 'status', 'published');
    Reflect.set(summary.current[0]?.lease ?? {}, 'phase', 'released');
    expect(sorted.safeStateSummary().current[0]?.lease.phase).toBe('abandon_pending');
    expect(sorted.safeStateSummary().terminalControlOutboxes[0]?.status).toBe('pending');

    const publishedTerminalInNonterminalLease = (() => {
      const seed = releasePendingSeed('pending');
      const terminal = seed.terminalControlOutboxes[0];
      if (terminal === undefined) throw new Error('release seed requires one terminal outbox');
      const published = {
        ...terminal,
        status: 'published' as const,
        claim: {
          ownerDigest: 'e'.repeat(64),
          purpose: 'publish' as const,
          claimedAt: '2026-07-20T00:00:05.000Z',
          expiresAt: '2026-07-20T00:05:05.000Z',
        },
        acknowledgedAt: '2026-07-20T00:00:05.000Z',
      } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
      expect(matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(published).success).toBe(true);
      return {
        ...seed,
        terminalControlOutboxes: [published],
      } satisfies FakeMatrixCorpusLifecycleSeed;
    })();
    const supersededClosureWithoutAuthoritativeWinner = (() => {
      const seed = abandonWithExpiredReleaseSeed();
      const release = seed.terminalControlOutboxes.find((outbox) => outbox.kind === 'release');
      if (release === undefined) throw new Error('abandon seed requires a release terminal');
      const superseded = {
        ...release,
        closedReason: 'superseded_by_authoritative_winner' as const,
      } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
      expect(matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(superseded).success).toBe(true);
      return {
        ...seed,
        terminalControlOutboxes: seed.terminalControlOutboxes.map((outbox) =>
          outbox.terminalControlId === superseded.terminalControlId ? superseded : outbox
        ),
      } satisfies FakeMatrixCorpusLifecycleSeed;
    })();
    const invalidSeeds = [
      publishedTerminalInNonterminalLease,
      supersededClosureWithoutAuthoritativeWinner,
      {
        ...abandonWithExpiredReleaseSeed(),
        terminalControlOutboxes: abandonWithExpiredReleaseSeed().terminalControlOutboxes.filter(
          (outbox) => outbox.kind === 'release'
        ),
        pair: (() => {
          const seed = abandonWithExpiredReleaseSeed();
          const current = {
            ...seed.pair.current,
            terminalControlOutboxIds: ['terminal_release'],
          } satisfies MatrixCorpusLeaseV1;
          return {
            leaseSlotDigest: seed.pair.leaseSlotDigest,
            current,
            history: { ...current, leaseSlotDigest: seed.pair.leaseSlotDigest },
          } satisfies MatrixCorpusCurrentLeaseHistoryPairV1;
        })(),
      },
    ] satisfies FakeMatrixCorpusLifecycleSeed[];
    for (const invalidSeed of invalidSeeds) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      expect(() => repository.seedValidLifecycleState(invalidSeed)).toThrow(FakeMatrixCorpusRepositoryFault);
    }

    const controls = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    for (const operation of ['quiesce', 'release', 'abandon', 'status'] as const)
      expect(controls.operationCounts(operation)).toEqual({ invocations: 0, commits: 0 });
    controls.seedValidLifecycleState(active);
    const gate = controls.deferNextBeforeAdmission('status');
    const observation = controls.getTransportStatus(transportStatusCommand({ now: '2026-07-20T00:00:04.000Z' }));
    await gate.entered;
    gate.release();
    await expect(observation).resolves.toMatchObject({ code: 'TRANSPORT_STATUS', phase: 'active' });
    expect(controls.operationCounts('status')).toEqual({ invocations: 1, commits: 0 });
  });

  it('A2 final fake seed, safe inspection, and payload privacy', () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const seed = Reflect.get(repository, 'seedValidCleanupOutboxState');
    expect(typeof seed).toBe('function');
    if (typeof seed !== 'function') return;

    const currentPair = provisioningCleanupSeed().pair;
    const target = {
      ...terminalSeedPair('1').pair.history,
      runFenceDigest: 'a'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const retainedTerminal = {
      version: 1,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: target.runId,
      userId: target.userId,
      leaseFence: target.leaseFence,
      kind: 'release',
      payload: {
        version: 1,
        kind: 'release',
        eventId: 'event_1',
        runId: target.runId,
        userId: target.userId,
        leaseFence: target.leaseFence,
        createdAt: target.releasedAt ?? timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      payloadDigest: digest,
      status: 'published',
      claim: {
        ownerDigest: 'e'.repeat(64),
        purpose: 'publish',
        claimedAt: timestamp,
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      acknowledgedAt: target.releasedAt ?? timestamp,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: target.releasedAt ?? timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    Reflect.apply(seed, repository, [
      {
        currentPair,
        retainedHistories: [target],
        renewReceipts: [],
        issuanceReceipts: [],
        capabilities: [],
        transportReceipts: [],
        ingestOutboxes: [],
        terminalControlOutboxes: [retainedTerminal],
      },
    ]);

    const summary = repository.safeStateSummary();
    expect(summary).toMatchObject({
      version: 1,
      current: [{ lease: { phase: 'provisioning' } }],
      histories: expect.arrayContaining([expect.objectContaining({ phase: 'released' })]),
      terminalControlOutboxes: [{ terminalControlId: 'event_1', status: 'published' }],
    });
    expect(JSON.stringify(summary)).not.toContain(attestedPayload.ordinaryIngest.text);
    Reflect.set(summary.terminalControlOutboxes[0] ?? {}, 'status', 'closed');
    expect(repository.safeStateSummary().terminalControlOutboxes[0]?.status).toBe('published');

    const partialTarget = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
      renewReceiptIds: ['2'.repeat(64)],
      capabilityIssuanceReceiptIds: ['3'.repeat(64)],
      cleanupProgress: {
        version: 1,
        targetRunId: 'run_9',
        targetLeaseFence: '2',
        targetRunFenceDigest: 'c'.repeat(64),
        revision: 1,
        cursor: { kind: 'terminal_outbox', nextIndex: 0 },
        remaining: {
          renewReceiptIds: [],
          capabilityIssuanceReceiptIds: [],
          capabilityDigests: [],
          transportReceiptIds: [],
          ingestOutboxIds: [],
          terminalControlOutboxIds: ['event_1'],
        },
        chunkReceipts: [
          {
            version: 1,
            idempotencyKeyDigest: '4'.repeat(64),
            canonicalRequestDigest: '5'.repeat(64),
            expectedRevision: 0,
            committedRevision: 1,
            replayProjection: {
              operation: 'cleanup',
              result: 'progress',
              targetRunId: 'run_9',
              targetLeaseFence: '2',
              targetRunFenceDigest: 'c'.repeat(64),
              committedRevision: 1,
              remainingChildCount: 1,
              chunkCommittedAt: timestamp,
            },
            resultDigest: digest,
            recordedAt: timestamp,
          },
        ],
      },
    } satisfies MatrixCorpusLeaseHistoryV1;
    const partialTerminal = {
      ...retainedTerminal,
      runId: partialTarget.runId,
      leaseFence: partialTarget.leaseFence,
      payload: {
        ...retainedTerminal.payload,
        runId: partialTarget.runId,
        leaseFence: partialTarget.leaseFence,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const partialSeed = {
      currentPair,
      retainedHistories: [partialTarget],
      renewReceipts: [],
      issuanceReceipts: [],
      capabilities: [],
      transportReceipts: [],
      ingestOutboxes: [],
      terminalControlOutboxes: [partialTerminal],
    } satisfies FakeMatrixCorpusCleanupOutboxSeed;
    const partial = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    partial.seedValidCleanupOutboxState(partialSeed);
    expect(partial.safeStateSummary()).toMatchObject({
      histories: expect.arrayContaining([
        expect.objectContaining({
          runFenceDigest: partialTarget.runFenceDigest,
          cleanupProgress: expect.objectContaining({ revision: 1 }),
          renewReceiptIds: ['2'.repeat(64)],
          capabilityIssuanceReceiptIds: ['3'.repeat(64)],
        }),
      ]),
      terminalControlOutboxes: [{ terminalControlId: 'event_1', status: 'published' }],
    });

    const deletedRenewReceipt = {
      version: 1,
      idempotencyKeyDigest: '2'.repeat(64),
      runId: partialTarget.runId,
      userId: partialTarget.userId,
      leaseFence: partialTarget.leaseFence,
      canonicalRequestDigest: '3'.repeat(64),
      replayProjection: {
        operation: 'renew',
        result: 'renewed',
        runId: partialTarget.runId,
        leaseFence: partialTarget.leaseFence,
        phase: 'released',
        renewedAt: timestamp,
        expiresAt: '2026-07-20T00:01:00.000Z',
      },
      resultDigest: digest,
      recordedAt: timestamp,
    };
    const unreferencedTerminal = {
      ...partialTerminal,
      terminalControlId: 'event_2',
      eventId: 'event_2',
      payload: { ...partialTerminal.payload, eventId: 'event_2' },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const invalidFinalCurrent = {
      ...currentPair.current,
      finalCleanupReceipt: {
        ...currentPair.current.finalCleanupReceipt,
        resultDigest: 'not-a-digest',
      },
    };
    const invalidFinalPair = {
      leaseSlotDigest: currentPair.leaseSlotDigest,
      current: invalidFinalCurrent,
      history: { ...invalidFinalCurrent, leaseSlotDigest: currentPair.leaseSlotDigest },
    };
    const invalidCurrentMissingChild = {
      ...currentPair.current,
      renewReceiptIds: ['2'.repeat(64)],
    } satisfies MatrixCorpusLeaseV1;
    const invalidCurrentPair = {
      leaseSlotDigest: currentPair.leaseSlotDigest,
      current: invalidCurrentMissingChild,
      history: { ...invalidCurrentMissingChild, leaseSlotDigest: currentPair.leaseSlotDigest },
    } satisfies MatrixCorpusCurrentLeaseHistoryPairV1;
    const crossHistory = {
      ...terminalSeedPair('3').pair.history,
      runFenceDigest: 'd'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const mismatchedWinner = {
      ...partialTarget,
      terminalWinner: { ...partialTarget.terminalWinner, payloadDigest: 'f'.repeat(64) },
    } satisfies MatrixCorpusLeaseHistoryV1;
    const mismatchedTerminalRequest = {
      ...partialTerminal,
      payload: { ...partialTerminal.payload, eventId: 'event_wrong' },
    };
    const markerTarget = {
      ...partialTarget,
      ingestOutboxIds: ['outbox_991'],
      cleanupProgress: {
        ...partialTarget.cleanupProgress,
        cursor: { kind: 'ingest_outbox', nextIndex: 0 },
        remaining: {
          ...partialTarget.cleanupProgress?.remaining,
          ingestOutboxIds: ['outbox_991'],
        },
        chunkReceipts: partialTarget.cleanupProgress?.chunkReceipts.map((receipt) => ({
          ...receipt,
          replayProjection: { ...receipt.replayProjection, remainingChildCount: 2 },
        })),
      },
    } satisfies MatrixCorpusLeaseHistoryV1;
    const markerlessPublishedIngest = {
      ...seededOutbox(991, 'published'),
      runId: markerTarget.runId,
      leaseFence: markerTarget.leaseFence,
      payload: {
        ...seededOutbox(991, 'published').payload,
        context: {
          ...seededOutbox(991, 'published').payload.context,
          runId: markerTarget.runId,
          leaseFence: markerTarget.leaseFence,
        },
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const markerWithInvalidAcknowledgement = {
      ...markerlessPublishedIngest,
      terminalMarker: { kind: 'completed', digest, recordedAt: '2026-07-20T00:00:05.000Z' },
    };
    const invalidCounterHistory = {
      ...partialTarget,
      drain: {
        ...partialTarget.drain,
        consumedCapabilityCount: 1,
        terminalIntexMarkerCount: 0,
        terminalOutboxCount: 0,
      },
    };
    const invalidInputs: readonly unknown[] = [
      { ...partialSeed, retainedHistories: [partialTarget, partialTarget] },
      { ...partialSeed, terminalControlOutboxes: [...partialSeed.terminalControlOutboxes, unreferencedTerminal] },
      { ...partialSeed, terminalControlOutboxes: [] },
      {
        ...partialSeed,
        renewReceipts: [{ runFenceDigest: partialTarget.runFenceDigest, receipt: deletedRenewReceipt }],
      },
      {
        ...partialSeed,
        retainedHistories: [
          {
            ...partialTarget,
            cleanupProgress: {
              ...partialTarget.cleanupProgress,
              chunkReceipts: partialTarget.cleanupProgress?.chunkReceipts.map((receipt) => ({
                ...receipt,
                expectedRevision: 1,
              })),
            },
          },
        ],
      },
      { ...partialSeed, currentPair: invalidFinalPair },
      { ...partialSeed, currentPair: invalidCurrentPair },
      { ...partialSeed, retainedHistories: [partialTarget, crossHistory] },
      { ...partialSeed, retainedHistories: [mismatchedWinner] },
      { ...partialSeed, terminalControlOutboxes: [mismatchedTerminalRequest] },
      {
        ...partialSeed,
        retainedHistories: [markerTarget],
        ingestOutboxes: [markerWithInvalidAcknowledgement],
      },
      { ...partialSeed, retainedHistories: [invalidCounterHistory] },
    ];
    for (const [index, invalid] of invalidInputs.entries()) {
      const rejected = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      expect(() => Reflect.apply(seed, rejected, [invalid]), `invalid cleanup seed ${String(index)}`).toThrow(
        FakeMatrixCorpusRepositoryFault
      );
    }
    expect(() => Reflect.apply(seed, repository, [partialSeed])).toThrow(FakeMatrixCorpusRepositoryFault);
  });

  function cleanupTerminalFixture(): Readonly<{
    target: MatrixCorpusLeaseHistoryV1;
    terminal: MatrixCorpusTerminalControlOutboxRecordV1;
    seed: Parameters<FakeMatrixCorpusRepository['seedValidCleanupOutboxState']>[0];
    command: CleanupExactRunCommand;
  }> {
    const target = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const terminal = {
      version: 1,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: target.runId,
      userId: target.userId,
      leaseFence: target.leaseFence,
      kind: 'release',
      payload: {
        version: 1,
        kind: 'release',
        eventId: 'event_1',
        runId: target.runId,
        userId: target.userId,
        leaseFence: target.leaseFence,
        createdAt: target.releasedAt ?? timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      payloadDigest: digest,
      status: 'published',
      claim: {
        ownerDigest: 'e'.repeat(64),
        purpose: 'publish',
        claimedAt: timestamp,
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      acknowledgedAt: target.releasedAt ?? timestamp,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: target.releasedAt ?? timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const currentSeed = provisioningCleanupSeed().pair;
    const seed = {
      currentPair: {
        ...currentSeed,
        current: { ...currentSeed.current, finalCleanupReceipt: null },
        history: { ...currentSeed.history, finalCleanupReceipt: null },
      },
      retainedHistories: [target],
      renewReceipts: [],
      issuanceReceipts: [],
      capabilities: [],
      transportReceipts: [],
      ingestOutboxes: [],
      terminalControlOutboxes: [terminal],
    } satisfies Parameters<FakeMatrixCorpusRepository['seedValidCleanupOutboxState']>[0];
    const command = {
      runtimeAudience: 'hetzner-prod',
      currentRunId: 'run_1',
      userId: 'user_1',
      currentLeaseFence: '1',
      leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64),
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest: target.runFenceDigest,
      expectedRevision: 0,
      idempotencyKeyDigest: '4'.repeat(64),
      canonicalRequestDigest: '5'.repeat(64),
      now: '2026-07-20T00:00:06.000Z',
    } satisfies CleanupExactRunCommand;
    return { target, terminal, seed, command };
  }

  function cleanupTransportFixture(
    firstTransportIndex: number,
    transportCount = 97
  ): Readonly<{
    target: MatrixCorpusLeaseHistoryV1;
    terminal: MatrixCorpusTerminalControlOutboxRecordV1;
    transportReceipts: readonly MatrixCorpusTransportReceiptV1[];
    seed: Parameters<FakeMatrixCorpusRepository['seedValidCleanupOutboxState']>[0];
    command: CleanupExactRunCommand;
  }> {
    const base = cleanupTerminalFixture();
    const transportReceipts = Array.from(
      { length: transportCount },
      (_, index): MatrixCorpusTransportReceiptV1 => ({
        version: 1,
        transportMessageIdDigest: indexedDigest(firstTransportIndex + index),
        capabilityDigest: digest,
        runId: base.target.runId,
        leaseFence: base.target.leaseFence,
        userId: base.target.userId,
        promptDigest: digest,
        ingressRequestDigest: digest,
        ingestReceiptId: null,
        ingestOutboxId: null,
        acceptedAt: null,
        recordedAt: timestamp,
        terminalFailureCode: 'CAPABILITY_REPLAY',
      })
    );
    const target = {
      ...base.target,
      transportReceiptIds: transportReceipts.map((receipt) => receipt.transportMessageIdDigest),
    } satisfies MatrixCorpusLeaseHistoryV1;
    return {
      target,
      terminal: base.terminal,
      transportReceipts,
      seed: {
        ...base.seed,
        retainedHistories: [target],
        transportReceipts,
      },
      command: {
        ...base.command,
        targetRunId: target.runId,
        targetLeaseFence: target.leaseFence,
        targetRunFenceDigest: target.runFenceDigest,
      },
    };
  }

  function ingestOutboxSeed(
    index: number,
    outbox: MatrixCorpusIngestOutboxRecordV1,
    leaseOverrides: Partial<MatrixCorpusLeaseV1> = {}
  ): FakeMatrixCorpusIssueConsumeSeed {
    const transportMessageIdDigest = indexedDigest(300_000 + index);
    const consumed = seededCapability(20_000 + index, {
      consumedAt: outbox.createdAt,
      consumedTransportMessageIdDigest: transportMessageIdDigest,
      ingestOutboxId: outbox.ingestOutboxId,
    });
    return issueConsumeSeed({
      issued: [consumed],
      transportReceipts: [
        acceptedTransportReceipt(consumed.capability, outbox, transportMessageIdDigest),
      ],
      ingestOutboxes: [outbox],
      leaseOverrides: {
        drain: {
          consumedCapabilityCount: 1,
          terminalIntexMarkerCount: 0,
          terminalOutboxCount: 0,
          replyOrDeliveryWorkInFlight: 0,
          drained: false,
        },
        ...leaseOverrides,
      },
    });
  }

  function claimIngestInput(
    outbox: MatrixCorpusIngestOutboxRecordV1,
    overrides: Partial<ClaimPendingIngestOutboxInput> = {}
  ): ClaimPendingIngestOutboxInput {
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      ingestOutboxId: outbox.ingestOutboxId,
      payloadDigest: outbox.payloadDigest,
      ownerDigest: indexedDigest(310_000),
      purpose: 'publish',
      now: '2026-07-20T00:00:10.000Z',
      claimExpiresAt: '2026-07-20T00:05:10.000Z',
      ...overrides,
    };
  }

  function renewIngestInput(
    outbox: MatrixCorpusIngestOutboxRecordV1,
    overrides: Partial<RenewIngestOutboxClaimInput> = {}
  ): RenewIngestOutboxClaimInput {
    if (outbox.claim === null) throw new Error('renewal fixture requires a claim');
    return {
      runtimeAudience: 'hetzner-prod',
      runId: 'run_1',
      userId: 'user_1',
      leaseFence: '1',
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      ingestOutboxId: outbox.ingestOutboxId,
      payloadDigest: outbox.payloadDigest,
      ownerDigest: outbox.claim.ownerDigest,
      purpose: outbox.claim.purpose,
      now: '2026-07-20T00:00:10.000Z',
      expectedClaimExpiresAt: outbox.claim.expiresAt,
      newClaimExpiresAt: '2026-07-20T00:05:10.000Z',
      ...overrides,
    };
  }

  function acknowledgeIngestInput(
    outbox: MatrixCorpusIngestOutboxRecordV1,
    overrides: Partial<AcknowledgeIngestOutboxInput> = {}
  ): AcknowledgeIngestOutboxInput {
    if (outbox.claim === null) throw new Error('acknowledgement fixture requires a claim');
    const publisherReceiptDigest = indexedDigest(311_000);
    const publishedAt = '2026-07-20T00:00:10.000Z';
    return {
      runtimeAudience: 'hetzner-prod',
      runId: outbox.runId,
      userId: outbox.userId,
      leaseFence: outbox.leaseFence,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      ingestOutboxId: outbox.ingestOutboxId,
      ingestReceiptId: outbox.ingestReceiptId,
      payloadDigest: outbox.payloadDigest,
      ownerDigest: outbox.claim.ownerDigest,
      claimPurpose: outbox.claim.purpose,
      expectedClaimExpiresAt: outbox.claim.expiresAt,
      now: publishedAt,
      outcome: { kind: 'publication_acknowledged', publisherReceiptDigest, publishedAt },
      ...overrides,
    };
  }

  function claimTerminalInput(
    outbox: MatrixCorpusTerminalControlOutboxRecordV1,
    overrides: Partial<ClaimPendingTerminalControlOutboxInput> = {}
  ): ClaimPendingTerminalControlOutboxInput {
    return {
      runtimeAudience: 'hetzner-prod',
      runId: outbox.runId,
      userId: outbox.userId,
      leaseFence: outbox.leaseFence,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      terminalControlId: outbox.terminalControlId,
      eventId: outbox.eventId,
      payloadDigest: outbox.payloadDigest,
      ownerDigest: indexedDigest(370_000),
      now: '2026-07-20T00:00:10.000Z',
      claimExpiresAt: '2026-07-20T00:05:10.000Z',
      ...overrides,
    };
  }

  function renewTerminalInput(
    outbox: MatrixCorpusTerminalControlOutboxRecordV1,
    overrides: Partial<RenewTerminalControlOutboxClaimInput> = {}
  ): RenewTerminalControlOutboxClaimInput {
    if (outbox.claim === null) throw new Error('terminal renewal fixture requires a claim');
    return {
      runtimeAudience: 'hetzner-prod',
      runId: outbox.runId,
      userId: outbox.userId,
      leaseFence: outbox.leaseFence,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      terminalControlId: outbox.terminalControlId,
      eventId: outbox.eventId,
      payloadDigest: outbox.payloadDigest,
      ownerDigest: outbox.claim.ownerDigest,
      now: '2026-07-20T00:00:10.000Z',
      expectedClaimExpiresAt: outbox.claim.expiresAt,
      newClaimExpiresAt: '2026-07-20T00:05:10.000Z',
      ...overrides,
    };
  }

  function terminalWinnerFor(
    outbox: MatrixCorpusTerminalControlOutboxRecordV1,
    acknowledgedAt: string,
    outcome?: MatrixCorpusTerminalAuthoritativeWinnerV1['outcome']
  ): MatrixCorpusTerminalAuthoritativeWinnerV1 {
    return outbox.kind === 'release'
      ? {
          kind: 'release',
          eventId: outbox.eventId,
          payloadDigest: outbox.payloadDigest,
          outcome:
            outcome === 'completed_failed' ||
            outcome === 'stopped_not_evaluated' ||
            outcome === 'completed_passed'
              ? outcome
              : 'completed_passed',
          acknowledgedAt,
        }
      : {
          kind: 'abandoned',
          eventId: outbox.eventId,
          payloadDigest: outbox.payloadDigest,
          outcome:
            outcome === 'provisioning_noop' ||
            outcome === 'provisioning_rolled_back' ||
            outcome === 'stopped_not_evaluated'
              ? outcome
              : 'provisioning_rolled_back',
          acknowledgedAt,
        };
  }

  function acknowledgeTerminalInput(
    request: MatrixCorpusTerminalControlOutboxRecordV1,
    authoritativeWinner: MatrixCorpusTerminalAuthoritativeWinnerV1,
    overrides: Partial<AcknowledgeTerminalControlInput> = {}
  ): AcknowledgeTerminalControlInput {
    if (request.claim === null) throw new Error('terminal acknowledgement fixture requires a claim');
    return {
      runtimeAudience: 'hetzner-prod',
      runId: request.runId,
      userId: request.userId,
      leaseFence: request.leaseFence,
      leaseSlotDigest: digest,
      runFenceDigest: 'b'.repeat(64),
      requestTerminalControlId: request.terminalControlId,
      requestEventId: request.eventId,
      requestPayloadDigest: request.payloadDigest,
      ownerDigest: request.claim.ownerDigest,
      now: authoritativeWinner.acknowledgedAt,
      expectedClaimExpiresAt: request.claim.expiresAt,
      authoritativeWinner,
      ...overrides,
    };
  }

  function mixedClaimedTerminalSeed(): Readonly<{
    seed: FakeMatrixCorpusLifecycleSeed;
    release: MatrixCorpusTerminalControlOutboxRecordV1;
    abandoned: MatrixCorpusTerminalControlOutboxRecordV1;
  }> {
    const base = abandonWithExpiredReleaseSeed();
    const releaseBase = releasePendingSeed('claimed').terminalControlOutboxes[0];
    const abandonedBase = base.terminalControlOutboxes.find((outbox) => outbox.kind === 'abandoned');
    if (releaseBase?.claim === null || releaseBase === undefined || abandonedBase === undefined)
      throw new Error('mixed terminal fixture requires release and abandoned intents');
    const release = structuredClone(releaseBase);
    const abandoned = {
      ...abandonedBase,
      status: 'claimed',
      claim: {
        ownerDigest: indexedDigest(372_000),
        purpose: 'publish',
        claimedAt: '2026-07-20T00:01:00.000Z',
        expiresAt: '2026-07-20T00:06:00.000Z',
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    return {
      seed: {
        ...base,
        terminalControlOutboxes: [release, abandoned],
      },
      release,
      abandoned,
    };
  }

  function ingestPhaseRepository(
    index: number,
    outbox: MatrixCorpusIngestOutboxRecordV1,
    phase: 'active' | 'quiescing' | 'abandon_pending' | 'abandoned'
  ): Readonly<{ repository: FakeMatrixCorpusRepository; digestCalls: () => number }> {
    const base = ingestOutboxSeed(index, outbox);
    const terminalControlId = `terminal_abandoned_${String(index)}`;
    const abandonedAt = '2026-07-20T00:01:00.000Z';
    const pendingAbandonment = abandonedTerminalOutbox(terminalControlId, abandonedAt);
    let terminalControlOutboxes: readonly MatrixCorpusTerminalControlOutboxRecordV1[] = [];
    let current = base.pair.current;

    if (phase === 'quiescing') {
      const quiescedAt = '2026-07-20T00:00:05.000Z';
      current = {
        ...current,
        phase,
        quiescedAt,
        operationReceipts: {
          ...current.operationReceipts,
          quiesce: {
            version: 1,
            operation: 'quiesce',
            idempotencyKeyDigest: indexedDigest(320_000 + index),
            canonicalRequestDigest: indexedDigest(330_000 + index),
            resultCode: 'QUIESCED',
            replayProjection: {
              operation: 'quiesce',
              result: 'quiesced',
              runId: current.runId,
              leaseFence: current.leaseFence,
              phase: 'quiescing',
              quiescedAt,
              drained: false,
            },
            resultDigest: digest,
            recordedAt: quiescedAt,
          },
        },
      } satisfies MatrixCorpusLeaseV1;
    } else if (phase === 'abandon_pending') {
      terminalControlOutboxes = [pendingAbandonment];
      current = {
        ...current,
        phase,
        terminalControlOutboxIds: [terminalControlId],
      } satisfies MatrixCorpusLeaseV1;
    } else if (phase === 'abandoned') {
      const terminal = {
        ...pendingAbandonment,
        status: 'published',
        claim: {
          ownerDigest: indexedDigest(340_000 + index),
          purpose: 'publish',
          claimedAt: abandonedAt,
          expiresAt: '2026-07-20T00:06:00.000Z',
        },
        acknowledgedAt: abandonedAt,
      } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
      terminalControlOutboxes = [terminal];
      current = {
        ...current,
        phase,
        abandonedAt,
        terminalControlOutboxIds: [terminalControlId],
        terminalWinner: {
          kind: 'abandoned',
          eventId: terminal.eventId,
          payloadDigest: terminal.payloadDigest,
          outcome: 'provisioning_noop',
          acknowledgedAt: abandonedAt,
        },
      } satisfies MatrixCorpusLeaseV1;
    }

    const pair = {
      leaseSlotDigest: base.pair.leaseSlotDigest,
      current,
      history: { ...current, leaseSlotDigest: base.pair.leaseSlotDigest },
    } satisfies MatrixCorpusCurrentLeaseHistoryPairV1;
    let digestCallCount = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCallCount += 1), digest) },
    });
    repository.seedValidCleanupOutboxState({
      currentPair: pair,
      retainedHistories: [],
      renewReceipts: base.renewReceipts.map((receipt) => ({
        runFenceDigest: pair.history.runFenceDigest,
        receipt,
      })),
      issuanceReceipts: base.issuanceReceipts.map((receipt) => ({
        runFenceDigest: pair.history.runFenceDigest,
        receipt,
      })),
      capabilities: base.capabilities,
      transportReceipts: base.transportReceipts,
      ingestOutboxes: base.ingestOutboxes,
      terminalControlOutboxes,
    });
    return { repository, digestCalls: () => digestCallCount };
  }

  function terminalState(
    seed: FakeMatrixCorpusLifecycleSeed
  ): Readonly<{ repository: FakeMatrixCorpusRepository; digestCalls: () => number }> {
    let digestCallCount = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCallCount += 1), digest) },
    });
    repository.seedValidLifecycleState(seed);
    return { repository, digestCalls: () => digestCallCount };
  }

  function pendingLosingTerminalAcknowledgementFixture(
    winnerKind: 'release' | 'abandoned'
  ): Readonly<{
    seed: FakeMatrixCorpusLifecycleSeed;
    request: MatrixCorpusTerminalControlOutboxRecordV1;
    winner: MatrixCorpusTerminalAuthoritativeWinnerV1;
  }> {
    const base = abandonWithExpiredReleaseSeed();
    const releaseBase = base.terminalControlOutboxes.find((outbox) => outbox.kind === 'release');
    const abandonedBase = base.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'abandoned'
    );
    if (releaseBase === undefined || abandonedBase === undefined)
      throw new Error('pending losing fixture requires both terminal intents');
    const release = {
      ...releaseBase,
      status: winnerKind === 'release' ? ('claimed' as const) : ('pending' as const),
      claim:
        winnerKind === 'release'
          ? {
              ownerDigest: indexedDigest(374_000),
              purpose: 'publish' as const,
              claimedAt: '2026-07-20T00:01:00.000Z',
              expiresAt: '2026-07-20T00:06:00.000Z',
            }
          : null,
      acknowledgedAt: null,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const abandoned = {
      ...abandonedBase,
      status: winnerKind === 'abandoned' ? ('claimed' as const) : ('pending' as const),
      claim:
        winnerKind === 'abandoned'
          ? {
              ownerDigest: indexedDigest(374_001),
              purpose: 'publish' as const,
              claimedAt: '2026-07-20T00:01:00.000Z',
              expiresAt: '2026-07-20T00:06:00.000Z',
            }
          : null,
      acknowledgedAt: null,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const request = winnerKind === 'release' ? release : abandoned;
    const acknowledgedAt = '2026-07-20T00:01:10.000Z';
    const winner = terminalWinnerFor(
      request,
      acknowledgedAt,
      winnerKind === 'release' ? 'completed_passed' : 'provisioning_rolled_back'
    );
    return {
      seed: {
        ...base,
        terminalControlOutboxes: [abandoned, release],
      },
      request,
      winner,
    };
  }

  function replaceTerminalOutbox(
    seed: FakeMatrixCorpusLifecycleSeed,
    replacement: MatrixCorpusTerminalControlOutboxRecordV1
  ): FakeMatrixCorpusLifecycleSeed {
    return {
      ...seed,
      terminalControlOutboxes: seed.terminalControlOutboxes.map((outbox) =>
        outbox.terminalControlId === replacement.terminalControlId ? replacement : outbox
      ),
    };
  }

  it('A2 cleanup deletes an exact terminal target and durably replays the final receipt', async () => {
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    const target = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const terminal = {
      version: 1,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: target.runId,
      userId: target.userId,
      leaseFence: target.leaseFence,
      kind: 'release',
      payload: {
        version: 1,
        kind: 'release',
        eventId: 'event_1',
        runId: target.runId,
        userId: target.userId,
        leaseFence: target.leaseFence,
        createdAt: target.releasedAt ?? timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      payloadDigest: digest,
      status: 'published',
      claim: {
        ownerDigest: 'e'.repeat(64),
        purpose: 'publish',
        claimedAt: timestamp,
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      acknowledgedAt: target.releasedAt ?? timestamp,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: target.releasedAt ?? timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    repository.seedValidCleanupOutboxState({
      currentPair: {
        ...provisioningCleanupSeed().pair,
        current: { ...provisioningCleanupSeed().pair.current, finalCleanupReceipt: null },
        history: {
          ...provisioningCleanupSeed().pair.history,
          finalCleanupReceipt: null,
        },
      },
      retainedHistories: [target],
      renewReceipts: [],
      issuanceReceipts: [],
      capabilities: [],
      transportReceipts: [],
      ingestOutboxes: [],
      terminalControlOutboxes: [terminal],
    });
    const command = {
      runtimeAudience: 'hetzner-prod',
      currentRunId: 'run_1',
      userId: 'user_1',
      currentLeaseFence: '1',
      leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64),
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest: target.runFenceDigest,
      expectedRevision: 0,
      idempotencyKeyDigest: '4'.repeat(64),
      canonicalRequestDigest: '5'.repeat(64),
      now: '2026-07-20T00:00:06.000Z',
    } satisfies CleanupExactRunCommand;
    repository.loseNextResponseAfterCommit('cleanup');
    await expect(repository.cleanupExactRun(command)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const committed = repository.safeStateSummary();
    expect(repository.safeStateSummary()).toMatchObject({
      histories: [expect.objectContaining({ runFenceDigest: command.currentRunFenceDigest })],
      terminalControlOutboxes: [],
    });
    await expect(repository.cleanupExactRun(command)).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest: target.runFenceDigest,
      finalRevision: 1,
      cleanedAt: command.now,
    });
    expect(repository.safeStateSummary()).toEqual(committed);
    expect(digestCalls).toBe(2);
    await expect(repository.cleanupExactRun({ ...command, canonicalRequestDigest: '7'.repeat(64) })).resolves.toEqual({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(digestCalls).toBe(3);
    await expect(repository.cleanupExactRun({ ...command, idempotencyKeyDigest: '6'.repeat(64) })).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'provisioning',
    });
    expect(digestCalls).toBe(3);
    expect(repository.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 1 });
  });

  it('A2 cleanup preserves and exposes receipts while reconciling sequential terminal targets', async () => {
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const first = cleanupTerminalFixture();
    const acquireReceipt = first.target.operationReceipts.acquire;
    const activateReceipt = first.target.operationReceipts.activate;
    const quiesceReceipt = first.target.operationReceipts.quiesce;
    const releaseReceipt = first.target.operationReceipts.release;
    const terminalWinner = first.target.terminalWinner;
    if (
      acquireReceipt === null ||
      acquireReceipt.replayProjection.operation !== 'acquire' ||
      activateReceipt === null ||
      activateReceipt.replayProjection.operation !== 'activate' ||
      quiesceReceipt === null ||
      quiesceReceipt.replayProjection.operation !== 'quiesce' ||
      releaseReceipt === null ||
      releaseReceipt.replayProjection.operation !== 'release' ||
      terminalWinner?.kind !== 'release'
    )
      throw new Error('terminal cleanup fixture requires complete lifecycle receipts');
    const secondRunId = 'run_10';
    const secondLeaseFence = '3';
    const secondRunFenceDigest = 'd'.repeat(64);
    const secondTerminalControlId = 'event_2';
    const secondTarget = {
      ...first.target,
      runId: secondRunId,
      leaseFence: secondLeaseFence,
      fenceEpoch: secondLeaseFence,
      runFenceDigest: secondRunFenceDigest,
      operationReceipts: {
        acquire: {
          ...acquireReceipt,
          replayProjection: {
            ...acquireReceipt.replayProjection,
            runId: secondRunId,
            leaseFence: secondLeaseFence,
          },
        },
        activate: {
          ...activateReceipt,
          replayProjection: {
            ...activateReceipt.replayProjection,
            runId: secondRunId,
            leaseFence: secondLeaseFence,
          },
        },
        quiesce: {
          ...quiesceReceipt,
          replayProjection: {
            ...quiesceReceipt.replayProjection,
            runId: secondRunId,
            leaseFence: secondLeaseFence,
          },
        },
        release: {
          ...releaseReceipt,
          replayProjection: {
            ...releaseReceipt.replayProjection,
            runId: secondRunId,
            leaseFence: secondLeaseFence,
            terminalControlId: secondTerminalControlId,
            eventId: secondTerminalControlId,
          },
        },
      },
      terminalControlOutboxIds: [secondTerminalControlId],
      terminalWinner: {
        ...terminalWinner,
        eventId: secondTerminalControlId,
      },
    } satisfies MatrixCorpusLeaseHistoryV1;
    const secondTerminal = {
      ...first.terminal,
      terminalControlId: secondTerminalControlId,
      eventId: secondTerminalControlId,
      runId: secondRunId,
      leaseFence: secondLeaseFence,
      payload: {
        ...first.terminal.payload,
        eventId: secondTerminalControlId,
        runId: secondRunId,
        leaseFence: secondLeaseFence,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    repository.seedValidCleanupOutboxState({
      ...first.seed,
      retainedHistories: [first.target, secondTarget],
      terminalControlOutboxes: [first.terminal, secondTerminal],
    });
    const secondCommand = {
      ...first.command,
      targetRunId: secondTarget.runId,
      targetLeaseFence: secondTarget.leaseFence,
      targetRunFenceDigest: secondTarget.runFenceDigest,
      idempotencyKeyDigest: '6'.repeat(64),
      canonicalRequestDigest: '7'.repeat(64),
      now: '2026-07-20T00:00:07.000Z',
    } satisfies CleanupExactRunCommand;

    await expect(repository.cleanupExactRun(first.command)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 1,
    });
    await expect(repository.cleanupExactRun(secondCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 1,
    });
    await expect(repository.cleanupExactRun(first.command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      targetRunFenceDigest: first.target.runFenceDigest,
    });
    await expect(repository.cleanupExactRun(secondCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      targetRunFenceDigest: secondTarget.runFenceDigest,
    });
    expect(repository.safeStateSummary().current[0]?.lease).toMatchObject({
      priorFinalCleanupReceipts: [
        {
          replayProjection: {
            targetRunFenceDigest: first.target.runFenceDigest,
          },
        },
      ],
      finalCleanupReceipt: {
        replayProjection: {
          targetRunFenceDigest: secondTarget.runFenceDigest,
        },
      },
    });
    expect(repository.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 2 });
  });

  it('A2 cleanup gives the current non-provisioning phase precedence over a missing target', async () => {
    const { repository } = await activeRepository();
    await expect(
      repository.cleanupExactRun({
        runtimeAudience: 'hetzner-prod',
        currentRunId: 'run_1',
        userId: 'user_1',
        currentLeaseFence: '1',
        leaseSlotDigest: digest,
        currentRunFenceDigest: 'b'.repeat(64),
        targetRunId: 'run_9',
        targetLeaseFence: '2',
        targetRunFenceDigest: 'c'.repeat(64),
        expectedRevision: 0,
        idempotencyKeyDigest: '4'.repeat(64),
        canonicalRequestDigest: '5'.repeat(64),
        now: '2026-07-20T00:00:06.000Z',
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
  });

  it('A2 cleanup keeps absent-target and stale-current precedence read-only', async () => {
    const seeded = provisioningCleanupSeed();
    const current = { ...seeded.pair.current, finalCleanupReceipt: null } satisfies MatrixCorpusLeaseV1;
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLifecycleState({
      ...seeded,
      pair: { leaseSlotDigest: seeded.pair.leaseSlotDigest, current, history: { ...current, leaseSlotDigest: seeded.pair.leaseSlotDigest } },
    });
    const command = {
      runtimeAudience: 'hetzner-prod', currentRunId: 'run_1', userId: 'user_1', currentLeaseFence: '1', leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64), targetRunId: 'run_9', targetLeaseFence: '2', targetRunFenceDigest: 'c'.repeat(64),
      expectedRevision: 0, idempotencyKeyDigest: '4'.repeat(64), canonicalRequestDigest: '5'.repeat(64), now: '2026-07-20T00:00:06.000Z',
    } satisfies CleanupExactRunCommand;
    const before = repository.safeStateSummary();
    await expect(repository.cleanupExactRun(command)).resolves.toEqual({ code: 'NOT_FOUND' });
    expect(repository.safeStateSummary()).toEqual(before);
    await expect(repository.cleanupExactRun({ ...command, currentRunId: 'run_wrong' })).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 0 });
  });

  it('A2 cleanup bytewise-sorts original child refs before choosing a chunk', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const ids = Array.from({ length: 97 }, (_, index) => indexedDigest(70_000 + index));
    const target = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
      renewReceiptIds: [...ids].reverse(),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const terminal = {
      version: 1,
      terminalControlId: 'event_1', eventId: 'event_1', runId: target.runId, userId: target.userId,
      leaseFence: target.leaseFence, kind: 'release',
      payload: { version: 1, kind: 'release', eventId: 'event_1', runId: target.runId, userId: target.userId, leaseFence: target.leaseFence, createdAt: timestamp, tombstoneDigest: digest, terminalCandidateDigest: digest, artifactStageDigest: digest },
      payloadDigest: digest, status: 'published', claim: { ownerDigest: 'e'.repeat(64), purpose: 'publish', claimedAt: timestamp, expiresAt: '2026-07-20T00:05:00.000Z' },
      acknowledgedAt: timestamp, closedReason: null, lastClaimRenewal: null, closedAt: null, createdAt: timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    repository.seedValidCleanupOutboxState({
      currentPair: {
        ...provisioningCleanupSeed().pair,
        current: { ...provisioningCleanupSeed().pair.current, finalCleanupReceipt: null },
        history: { ...provisioningCleanupSeed().pair.history, finalCleanupReceipt: null },
      },
      retainedHistories: [target],
      renewReceipts: ids.map((id) => ({
        runFenceDigest: target.runFenceDigest,
        receipt: {
          version: 1, idempotencyKeyDigest: id, runId: target.runId, userId: target.userId,
          leaseFence: target.leaseFence, canonicalRequestDigest: '3'.repeat(64),
          replayProjection: { operation: 'renew', result: 'renewed', runId: target.runId, leaseFence: target.leaseFence, phase: 'active', renewedAt: timestamp, expiresAt: '2026-07-20T00:01:00.000Z' },
          resultDigest: digest, recordedAt: timestamp,
        },
      })),
      issuanceReceipts: [], capabilities: [], transportReceipts: [], ingestOutboxes: [], terminalControlOutboxes: [terminal],
    });
    const command = {
      runtimeAudience: 'hetzner-prod', currentRunId: 'run_1', userId: 'user_1', currentLeaseFence: '1', leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64), targetRunId: target.runId, targetLeaseFence: target.leaseFence, targetRunFenceDigest: target.runFenceDigest,
      expectedRevision: 0, idempotencyKeyDigest: '4'.repeat(64), canonicalRequestDigest: '5'.repeat(64), now: '2026-07-20T00:00:06.000Z',
    } satisfies CleanupExactRunCommand;
    repository.loseNextResponseAfterCommit('cleanup');
    await expect(repository.cleanupExactRun(command)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const committed = repository.safeStateSummary();
    await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({ code: 'ALREADY_APPLIED', operation: 'cleanup', result: 'progress', remainingChildCount: 2 });
    expect(repository.safeStateSummary()).toEqual(committed);
    const progress = repository.safeStateSummary().histories.find((history) => history.runFenceDigest === target.runFenceDigest)?.cleanupProgress;
    expect(progress?.remaining.renewReceiptIds).toEqual([ids[96]]);
    expect(progress?.remaining.terminalControlOutboxIds).toEqual(['event_1']);
  });

  it('R21 cleanup exhausts child kinds in fixed order before touching later kinds', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    const baseTarget = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const renewIds = Array.from({ length: 95 }, (_, index) => indexedDigest(110_000 + index));
    const issued = [
      seededCapability(12_000, {
        runId: baseTarget.runId,
        userId: baseTarget.userId,
        leaseFence: baseTarget.leaseFence,
      }),
      seededCapability(12_001, {
        runId: baseTarget.runId,
        userId: baseTarget.userId,
        leaseFence: baseTarget.leaseFence,
      }),
    ];
    const issuanceIds = issued.map((entry) => entry.receipt.matrixIdempotencyKeyDigest).sort();
    const retainedCapability = issued[0]?.capability;
    if (retainedCapability === undefined) throw new Error('six-kind fixture requires one capability');
    const transportReceipt = {
      version: 1,
      transportMessageIdDigest: indexedDigest(120_100),
      capabilityDigest: retainedCapability.capabilityDigest,
      runId: baseTarget.runId,
      leaseFence: baseTarget.leaseFence,
      userId: baseTarget.userId,
      promptDigest: retainedCapability.promptDigest,
      ingressRequestDigest: indexedDigest(120_101),
      ingestReceiptId: null,
      ingestOutboxId: null,
      acceptedAt: null,
      recordedAt: timestamp,
      terminalFailureCode: 'CAPABILITY_REPLAY',
    } satisfies MatrixCorpusTransportReceiptV1;
    const sourceIngest = seededOutbox(12_100, 'closed');
    const ingestOutbox = {
      ...sourceIngest,
      runId: baseTarget.runId,
      leaseFence: baseTarget.leaseFence,
      payload: {
        ...sourceIngest.payload,
        context: {
          ...sourceIngest.payload.context,
          runId: baseTarget.runId,
          leaseFence: baseTarget.leaseFence,
        },
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const terminal = {
      version: 1,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: baseTarget.runId,
      userId: baseTarget.userId,
      leaseFence: baseTarget.leaseFence,
      kind: 'release',
      payload: {
        version: 1,
        kind: 'release',
        eventId: 'event_1',
        runId: baseTarget.runId,
        userId: baseTarget.userId,
        leaseFence: baseTarget.leaseFence,
        createdAt: timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      payloadDigest: digest,
      status: 'published',
      claim: {
        ownerDigest: 'e'.repeat(64),
        purpose: 'publish',
        claimedAt: timestamp,
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      acknowledgedAt: timestamp,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const target = {
      ...baseTarget,
      renewReceiptIds: [...renewIds].reverse(),
      capabilityIssuanceReceiptIds: [...issuanceIds].reverse(),
      capabilityDigests: [retainedCapability.capabilityDigest],
      transportReceiptIds: [transportReceipt.transportMessageIdDigest],
      ingestOutboxIds: [ingestOutbox.ingestOutboxId],
      terminalControlOutboxIds: [terminal.terminalControlId],
    } satisfies MatrixCorpusLeaseHistoryV1;
    repository.seedValidCleanupOutboxState({
      currentPair: {
        ...provisioningCleanupSeed().pair,
        current: { ...provisioningCleanupSeed().pair.current, finalCleanupReceipt: null },
        history: { ...provisioningCleanupSeed().pair.history, finalCleanupReceipt: null },
      },
      retainedHistories: [target],
      renewReceipts: renewIds.map((id) => ({
        runFenceDigest: target.runFenceDigest,
        receipt: {
          version: 1,
          idempotencyKeyDigest: id,
          runId: target.runId,
          userId: target.userId,
          leaseFence: target.leaseFence,
          canonicalRequestDigest: indexedDigest(120_200),
          replayProjection: {
            operation: 'renew',
            result: 'renewed',
            runId: target.runId,
            leaseFence: target.leaseFence,
            phase: 'active',
            renewedAt: timestamp,
            expiresAt: '2026-07-20T00:01:00.000Z',
          },
          resultDigest: digest,
          recordedAt: timestamp,
        },
      })),
      issuanceReceipts: issued.map((entry) => ({
        runFenceDigest: target.runFenceDigest,
        receipt: entry.receipt,
      })),
      capabilities: [retainedCapability],
      transportReceipts: [transportReceipt],
      ingestOutboxes: [ingestOutbox],
      terminalControlOutboxes: [terminal],
    });
    const command = {
      runtimeAudience: 'hetzner-prod',
      currentRunId: 'run_1',
      userId: 'user_1',
      currentLeaseFence: '1',
      leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64),
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest: target.runFenceDigest,
      expectedRevision: 0,
      idempotencyKeyDigest: indexedDigest(120_300),
      canonicalRequestDigest: indexedDigest(120_301),
      now: '2026-07-20T00:00:06.000Z',
    } satisfies CleanupExactRunCommand;

    await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
      remainingChildCount: 5,
    });
    const afterFirst = repository.safeStateSummary();
    const progress = afterFirst.histories.find(
      (history) => history.runFenceDigest === target.runFenceDigest
    )?.cleanupProgress;
    expect(progress?.remaining).toEqual({
      renewReceiptIds: [],
      capabilityIssuanceReceiptIds: [issuanceIds[1]],
      capabilityDigests: [retainedCapability.capabilityDigest],
      transportReceiptIds: [transportReceipt.transportMessageIdDigest],
      ingestOutboxIds: [ingestOutbox.ingestOutboxId],
      terminalControlOutboxIds: [terminal.terminalControlId],
    });
    expect(afterFirst.renewReceipts).toEqual([]);
    expect(afterFirst.issuanceReceipts.map((receipt) => receipt.matrixIdempotencyKeyDigest)).toEqual([
      issuanceIds[1],
    ]);
    expect(afterFirst.capabilities).toHaveLength(1);
    expect(afterFirst.transportReceipts).toHaveLength(1);
    expect(afterFirst.ingestOutboxes).toHaveLength(1);
    expect(afterFirst.terminalControlOutboxes).toHaveLength(1);

    await expect(
      repository.cleanupExactRun({
        ...command,
        expectedRevision: 1,
        idempotencyKeyDigest: indexedDigest(120_302),
        canonicalRequestDigest: indexedDigest(120_303),
      })
    ).resolves.toMatchObject({ code: 'RUN_CLEANED', finalRevision: 2 });
    const afterFinal = repository.safeStateSummary();
    expect(afterFinal.histories.map((history) => history.runFenceDigest)).not.toContain(target.runFenceDigest);
    expect(afterFinal.issuanceReceipts).toEqual([]);
    expect(afterFinal.capabilities).toEqual([]);
    expect(afterFinal.transportReceipts).toEqual([]);
    expect(afterFinal.ingestOutboxes).toEqual([]);
    expect(afterFinal.terminalControlOutboxes).toEqual([]);
    expect(repository.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 2 });
  });

  it('R21 cleanup enforces phase identity slot revision and digest precedence read-only', async () => {
    const fixture = cleanupTerminalFixture();
    const activeTarget = {
      ...fixture.target,
      phase: 'active',
      quiescedAt: null,
      releasedAt: null,
      terminalControlOutboxIds: [],
      terminalWinner: null,
      operationReceipts: {
        ...fixture.target.operationReceipts,
        quiesce: null,
        release: null,
      },
      drain: { ...fixture.target.drain, drained: false },
    } satisfies MatrixCorpusLeaseHistoryV1;
    const phaseRepository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    phaseRepository.seedValidCleanupOutboxState({
      ...fixture.seed,
      retainedHistories: [activeTarget],
      terminalControlOutboxes: [],
    });
    const phaseBefore = phaseRepository.safeStateSummary();
    await expect(phaseRepository.cleanupExactRun(fixture.command)).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
    expect(phaseRepository.safeStateSummary()).toEqual(phaseBefore);
    expect(phaseRepository.operationCounts('cleanup')).toEqual({ invocations: 1, commits: 0 });

    const identityRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    identityRepository.seedValidCleanupOutboxState(fixture.seed);
    const identityBefore = identityRepository.safeStateSummary();
    await expect(
      identityRepository.cleanupExactRun({ ...fixture.command, targetRunId: 'run_wrong' })
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      identityRepository.cleanupExactRun({ ...fixture.command, expectedRevision: 1 })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'released' });
    expect(identityRepository.safeStateSummary()).toEqual(identityBefore);
    expect(identityRepository.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 0 });

    const invalidSlotTarget = {
      ...fixture.target,
      leaseSlotDigest: 'f'.repeat(64),
    } satisfies MatrixCorpusLeaseHistoryV1;
    const invalidSlotRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() =>
      invalidSlotRepository.seedValidCleanupOutboxState({
        ...fixture.seed,
        retainedHistories: [invalidSlotTarget],
      })
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    const crossRunTerminal = {
      ...fixture.terminal,
      runId: 'run_other',
      payload: { ...fixture.terminal.payload, runId: 'run_other' },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    expect(matrixCorpusTerminalControlOutboxRecordV1Schema.safeParse(crossRunTerminal).success).toBe(true);
    const crossRunRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expect(() =>
      crossRunRepository.seedValidCleanupOutboxState({
        ...fixture.seed,
        terminalControlOutboxes: [crossRunTerminal],
      })
    ).toThrow(FakeMatrixCorpusRepositoryFault);

    let digestMode: 'valid' | 'invalid' | 'throw' = 'invalid';
    const dependencyRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: () => {
          if (digestMode === 'throw') throw new Error('private digest failure');
          return digestMode === 'valid' ? digest : 'invalid-digest';
        },
      },
    });
    dependencyRepository.seedValidCleanupOutboxState(fixture.seed);
    dependencyRepository.failNextAt('cleanup_after_child_deletes_draft');
    const dependencyBefore = dependencyRepository.safeStateSummary();
    await expect(dependencyRepository.cleanupExactRun(fixture.command)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });
    digestMode = 'throw';
    await expect(dependencyRepository.cleanupExactRun(fixture.command)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });
    expect(dependencyRepository.safeStateSummary()).toEqual(dependencyBefore);
    expect(dependencyRepository.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 0 });
    digestMode = 'valid';
    await expect(dependencyRepository.cleanupExactRun(fixture.command)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(dependencyRepository.safeStateSummary()).toEqual(dependencyBefore);
    await expect(dependencyRepository.cleanupExactRun(fixture.command)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 1,
    });
    expect(dependencyRepository.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 1 });
  });

  it('R21 cleanup verifies stored progress and final receipt integrity on exact replay', async () => {
    type DigestMode = 'valid' | 'invalid' | 'mismatch';
    let progressDigestMode: DigestMode = 'valid';
    let progressDigestCalls = 0;
    const progressRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: () => {
          progressDigestCalls += 1;
          if (progressDigestMode === 'invalid') return 'invalid-digest';
          return progressDigestMode === 'mismatch' ? 'f'.repeat(64) : digest;
        },
      },
    });
    const progressFixture = cleanupTerminalFixture();
    const transportIds = Array.from({ length: 97 }, (_, index) => indexedDigest(130_000 + index));
    const progressTarget = {
      ...progressFixture.target,
      transportReceiptIds: transportIds,
    } satisfies MatrixCorpusLeaseHistoryV1;
    progressRepository.seedValidCleanupOutboxState({
      ...progressFixture.seed,
      retainedHistories: [progressTarget],
      transportReceipts: transportIds.map(
        (transportMessageIdDigest): MatrixCorpusTransportReceiptV1 => ({
          version: 1,
          transportMessageIdDigest,
          capabilityDigest: digest,
          runId: progressTarget.runId,
          leaseFence: progressTarget.leaseFence,
          userId: progressTarget.userId,
          promptDigest: digest,
          ingressRequestDigest: digest,
          ingestReceiptId: null,
          ingestOutboxId: null,
          acceptedAt: null,
          recordedAt: timestamp,
          terminalFailureCode: 'CAPABILITY_REPLAY',
        })
      ),
    });
    const progressCommand = {
      ...progressFixture.command,
      targetRunId: progressTarget.runId,
      targetLeaseFence: progressTarget.leaseFence,
      targetRunFenceDigest: progressTarget.runFenceDigest,
    } satisfies CleanupExactRunCommand;
    await expect(progressRepository.cleanupExactRun(progressCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
      remainingChildCount: 2,
    });
    const progressCommitted = progressRepository.safeStateSummary();
    expect(progressDigestCalls).toBe(1);
    progressDigestMode = 'mismatch';
    await expect(progressRepository.cleanupExactRun(progressCommand)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'cleanup_progress',
    });
    progressDigestMode = 'invalid';
    await expect(progressRepository.cleanupExactRun(progressCommand)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });
    progressDigestMode = 'valid';
    await expect(progressRepository.cleanupExactRun(progressCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'progress',
      committedRevision: 1,
    });
    expect(progressRepository.safeStateSummary()).toEqual(progressCommitted);
    expect(progressRepository.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 1 });
    expect(progressDigestCalls).toBe(4);

    let finalDigestMode: DigestMode = 'valid';
    let finalDigestCalls = 0;
    const finalRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: () => {
          finalDigestCalls += 1;
          if (finalDigestMode === 'invalid') return 'invalid-digest';
          return finalDigestMode === 'mismatch' ? 'f'.repeat(64) : digest;
        },
      },
    });
    const finalFixture = cleanupTerminalFixture();
    finalRepository.seedValidCleanupOutboxState(finalFixture.seed);
    await expect(finalRepository.cleanupExactRun(finalFixture.command)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 1,
    });
    const finalCommitted = finalRepository.safeStateSummary();
    expect(finalDigestCalls).toBe(1);
    finalDigestMode = 'mismatch';
    await expect(finalRepository.cleanupExactRun(finalFixture.command)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'cleanup_progress',
    });
    finalDigestMode = 'invalid';
    await expect(finalRepository.cleanupExactRun(finalFixture.command)).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'dependency_result',
    });
    finalDigestMode = 'valid';
    await expect(finalRepository.cleanupExactRun(finalFixture.command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      finalRevision: 1,
    });
    expect(finalRepository.safeStateSummary()).toEqual(finalCommitted);
    expect(finalRepository.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 1 });
    expect(finalDigestCalls).toBe(4);
  });

  it('R21 cleanup successor resume and stale owner race are deterministic', async () => {
    for (const winner of [0, 1] as const) {
      let digestCalls = 0;
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
      });
      const fixture = cleanupTransportFixture(140_000 + winner * 1_000);
      repository.seedValidCleanupOutboxState(fixture.seed);
      const commands = [
        {
          ...fixture.command,
          idempotencyKeyDigest: indexedDigest(142_000 + winner * 10),
          canonicalRequestDigest: indexedDigest(142_001 + winner * 10),
        },
        {
          ...fixture.command,
          idempotencyKeyDigest: indexedDigest(142_002 + winner * 10),
          canonicalRequestDigest: indexedDigest(142_003 + winner * 10),
        },
      ] as const;
      const firstGate = repository.deferNextBeforeAdmission('cleanup');
      const secondGate = repository.deferNextBeforeAdmission('cleanup');
      const pending = [
        repository.cleanupExactRun(commands[0]),
        repository.cleanupExactRun(commands[1]),
      ] as const;
      await Promise.all([firstGate.entered, secondGate.entered]);

      const winnerGate = winner === 0 ? firstGate : secondGate;
      const loserGate = winner === 0 ? secondGate : firstGate;
      winnerGate.release();
      await expect(pending[winner]).resolves.toMatchObject({
        code: 'RUN_CLEANUP_PROGRESS',
        committedRevision: 1,
        remainingChildCount: 2,
      });
      loserGate.release();
      await expect(pending[winner === 0 ? 1 : 0]).resolves.toEqual({
        code: 'PHASE_CONFLICT',
        actualPhase: 'released',
      });
      const committed = repository.safeStateSummary();
      await expect(repository.cleanupExactRun(commands[winner])).resolves.toMatchObject({
        code: 'ALREADY_APPLIED',
        operation: 'cleanup',
        result: 'progress',
        committedRevision: 1,
      });
      expect(repository.safeStateSummary()).toEqual(committed);
      expect(repository.operationCounts('cleanup')).toEqual({ invocations: 3, commits: 1 });
      expect(digestCalls).toBe(2);
    }

    const sourceFixture = cleanupTransportFixture(150_000);
    const source = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    source.seedValidCleanupOutboxState(sourceFixture.seed);
    await expect(source.cleanupExactRun(sourceFixture.command)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
      remainingChildCount: 2,
    });
    const progressedTarget = source
      .safeStateSummary()
      .histories.find((history) => history.runFenceDigest === sourceFixture.target.runFenceDigest);
    if (progressedTarget?.cleanupProgress === null || progressedTarget?.cleanupProgress === undefined)
      throw new Error('successor fixture requires cleanup progress');
    const acquisition = sourceFixture.seed.currentPair.current.operationReceipts.acquire;
    if (
      acquisition === null ||
      acquisition.operation !== 'acquire' ||
      acquisition.replayProjection.operation !== 'acquire'
    )
      throw new Error('successor fixture requires acquisition receipt');
    const acquisitionProjection = acquisition.replayProjection;
    const successorRunFenceDigest = 'e'.repeat(64);
    const successorCurrent = {
      ...sourceFixture.seed.currentPair.current,
      runId: 'run_successor',
      runFenceDigest: successorRunFenceDigest,
      leaseFence: '3',
      fenceEpoch: '3',
      operationReceipts: {
        acquire: {
          ...acquisition,
          idempotencyKeyDigest: indexedDigest(151_000),
          canonicalRequestDigest: indexedDigest(151_001),
          replayProjection: {
            ...acquisitionProjection,
            runId: 'run_successor',
            leaseFence: '3',
          },
        },
        activate: null,
        quiesce: null,
        release: null,
      },
    } satisfies MatrixCorpusLeaseV1;
    let successorDigestCalls = 0;
    const successor = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((successorDigestCalls += 1), digest) },
    });
    const remainingTransportIds = new Set(progressedTarget.cleanupProgress.remaining.transportReceiptIds);
    successor.seedValidCleanupOutboxState({
      ...sourceFixture.seed,
      currentPair: {
        leaseSlotDigest: sourceFixture.seed.currentPair.leaseSlotDigest,
        current: successorCurrent,
        history: {
          ...successorCurrent,
          leaseSlotDigest: sourceFixture.seed.currentPair.leaseSlotDigest,
        },
      },
      retainedHistories: [
        {
          ...sourceFixture.target,
          cleanupProgress: progressedTarget.cleanupProgress,
        },
      ],
      transportReceipts: sourceFixture.transportReceipts.filter((receipt) =>
        remainingTransportIds.has(receipt.transportMessageIdDigest)
      ),
    });
    const beforeStaleOwner = successor.safeStateSummary();
    await expect(successor.cleanupExactRun(sourceFixture.command)).resolves.toEqual({
      code: 'STALE_FENCE',
    });
    expect(successor.safeStateSummary()).toEqual(beforeStaleOwner);
    expect(successorDigestCalls).toBe(0);

    const successorCommand = {
      ...sourceFixture.command,
      currentRunId: successorCurrent.runId,
      currentLeaseFence: successorCurrent.leaseFence,
      currentRunFenceDigest: successorCurrent.runFenceDigest,
      expectedRevision: 1,
      idempotencyKeyDigest: indexedDigest(151_002),
      canonicalRequestDigest: indexedDigest(151_003),
    } satisfies CleanupExactRunCommand;
    await expect(successor.cleanupExactRun(successorCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 2,
    });
    const cleaned = successor.safeStateSummary();
    expect(cleaned.histories.map((history) => history.runFenceDigest)).not.toContain(
      sourceFixture.target.runFenceDigest
    );
    expect(cleaned.current[0]?.lease.finalCleanupReceipt?.replayProjection).toMatchObject({
      targetRunFenceDigest: sourceFixture.target.runFenceDigest,
      finalRevision: 2,
    });
    expect(successorDigestCalls).toBe(1);
    await expect(successor.cleanupExactRun(sourceFixture.command)).resolves.toEqual({
      code: 'STALE_FENCE',
    });
    expect(successorDigestCalls).toBe(1);
    expect(successor.operationCounts('cleanup')).toEqual({ invocations: 3, commits: 1 });
  });

  it('R21 cleanup draft faults are atomic', async () => {
    const cases = [
      {
        stage: 'cleanup_after_child_deletes_draft',
        path: 'progress',
      },
      {
        stage: 'cleanup_after_progress_draft',
        path: 'progress',
      },
      {
        stage: 'cleanup_after_child_deletes_draft',
        path: 'cleaned',
      },
      {
        stage: 'cleanup_after_final_receipt_pair_draft',
        path: 'cleaned',
      },
      {
        stage: 'cleanup_after_target_history_delete_draft',
        path: 'cleaned',
      },
    ] as const;
    for (const [index, testCase] of cases.entries()) {
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: { digest: () => digest },
      });
      const fixture =
        testCase.path === 'progress'
          ? cleanupTransportFixture(160_000 + index * 1_000)
          : cleanupTerminalFixture();
      repository.seedValidCleanupOutboxState(fixture.seed);
      repository.failNextAt(testCase.stage);
      const before = repository.safeStateSummary();
      await expect(repository.cleanupExactRun(fixture.command)).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('cleanup')).toEqual({ invocations: 1, commits: 0 });

      await expect(repository.cleanupExactRun(fixture.command)).resolves.toMatchObject(
        testCase.path === 'progress'
          ? { code: 'RUN_CLEANUP_PROGRESS', committedRevision: 1, remainingChildCount: 2 }
          : { code: 'RUN_CLEANED', finalRevision: 1 }
      );
      expect(repository.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 1 });
    }

    const unreachable = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const unreachableFixture = cleanupTransportFixture(170_000);
    unreachable.seedValidCleanupOutboxState(unreachableFixture.seed);
    unreachable.failNextAt('cleanup_after_final_receipt_pair_draft');
    await expect(unreachable.cleanupExactRun(unreachableFixture.command)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
      remainingChildCount: 2,
    });
    const beforeFinalFault = unreachable.safeStateSummary();
    const finalCommand = {
      ...unreachableFixture.command,
      expectedRevision: 1,
      idempotencyKeyDigest: indexedDigest(171_000),
      canonicalRequestDigest: indexedDigest(171_001),
    } satisfies CleanupExactRunCommand;
    await expect(unreachable.cleanupExactRun(finalCommand)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(unreachable.safeStateSummary()).toEqual(beforeFinalFault);
    expect(unreachable.operationCounts('cleanup')).toEqual({ invocations: 2, commits: 1 });
    await expect(unreachable.cleanupExactRun(finalCommand)).resolves.toMatchObject({
      code: 'RUN_CLEANED',
      finalRevision: 2,
    });
    expect(unreachable.operationCounts('cleanup')).toEqual({ invocations: 3, commits: 2 });

    const responseLoss = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const responseLossFixture = cleanupTransportFixture(180_000);
    responseLoss.seedValidCleanupOutboxState(responseLossFixture.seed);
    responseLoss.loseNextResponseAfterCommit('cleanup');
    await expect(responseLoss.cleanupExactRun(responseLossFixture.command)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    const progressCommitted = responseLoss.safeStateSummary();
    await expect(responseLoss.cleanupExactRun(responseLossFixture.command)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'progress',
      committedRevision: 1,
    });
    expect(responseLoss.safeStateSummary()).toEqual(progressCommitted);
    const responseLossFinalCommand = {
      ...responseLossFixture.command,
      expectedRevision: 1,
      idempotencyKeyDigest: indexedDigest(181_000),
      canonicalRequestDigest: indexedDigest(181_001),
    } satisfies CleanupExactRunCommand;
    responseLoss.loseNextResponseAfterCommit('cleanup');
    await expect(responseLoss.cleanupExactRun(responseLossFinalCommand)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    const finalCommitted = responseLoss.safeStateSummary();
    await expect(responseLoss.cleanupExactRun(responseLossFinalCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      finalRevision: 2,
    });
    expect(responseLoss.safeStateSummary()).toEqual(finalCommitted);
    expect(responseLoss.operationCounts('cleanup')).toEqual({ invocations: 4, commits: 2 });
  });

  it('R21 cleanup deletes exact bounded chunks and replays response loss', async () => {
    let digestCalls = 0;
    const digestInputs: MatrixCorpusPersistedReplayProjectionV1[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          digestCalls += 1;
          digestInputs.push(structuredClone(projection));
          return digest;
        },
      },
    });
    const transportIds = Array.from({ length: 6_143 }, (_, index) => indexedDigest(80_000 + index));
    const target = {
      ...terminalSeedPair('2').pair.history,
      runFenceDigest: 'c'.repeat(64),
      transportReceiptIds: transportIds,
    } satisfies MatrixCorpusLeaseHistoryV1;
    const terminal = {
      version: 1,
      terminalControlId: 'event_1',
      eventId: 'event_1',
      runId: target.runId,
      userId: target.userId,
      leaseFence: target.leaseFence,
      kind: 'release',
      payload: {
        version: 1,
        kind: 'release',
        eventId: 'event_1',
        runId: target.runId,
        userId: target.userId,
        leaseFence: target.leaseFence,
        createdAt: timestamp,
        tombstoneDigest: digest,
        terminalCandidateDigest: digest,
        artifactStageDigest: digest,
      },
      payloadDigest: digest,
      status: 'published',
      claim: {
        ownerDigest: 'e'.repeat(64),
        purpose: 'publish',
        claimedAt: timestamp,
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      acknowledgedAt: timestamp,
      closedReason: null,
      lastClaimRenewal: null,
      closedAt: null,
      createdAt: timestamp,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const currentSeed = provisioningCleanupSeed().pair;
    repository.seedValidCleanupOutboxState({
      currentPair: {
        ...currentSeed,
        current: { ...currentSeed.current, finalCleanupReceipt: null },
        history: { ...currentSeed.history, finalCleanupReceipt: null },
      },
      retainedHistories: [target],
      renewReceipts: [],
      issuanceReceipts: [],
      capabilities: [],
      ingestOutboxes: [],
      terminalControlOutboxes: [terminal],
      transportReceipts: transportIds.map(
        (transportMessageIdDigest): MatrixCorpusTransportReceiptV1 => ({
          version: 1,
          transportMessageIdDigest,
          capabilityDigest: digest,
          runId: target.runId,
          leaseFence: target.leaseFence,
          userId: target.userId,
          promptDigest: digest,
          ingressRequestDigest: digest,
          ingestReceiptId: null,
          ingestOutboxId: null,
          acceptedAt: null,
          recordedAt: timestamp,
          terminalFailureCode: 'CAPABILITY_REPLAY',
        })
      ),
    });
    const commandFor = (revision: number): CleanupExactRunCommand => ({
      runtimeAudience: 'hetzner-prod',
      currentRunId: 'run_1',
      userId: 'user_1',
      currentLeaseFence: '1',
      leaseSlotDigest: digest,
      currentRunFenceDigest: 'b'.repeat(64),
      targetRunId: target.runId,
      targetLeaseFence: target.leaseFence,
      targetRunFenceDigest: target.runFenceDigest,
      expectedRevision: revision,
      idempotencyKeyDigest: indexedDigest(90_000 + revision),
      canonicalRequestDigest: indexedDigest(100_000 + revision),
      now: '2026-07-20T00:00:06.000Z',
    });

    for (let revision = 0; revision < 63; revision += 1) {
      const command = commandFor(revision);
      const before = repository.safeStateSummary();
      if (revision === 0) {
        repository.loseNextResponseAfterCommit('cleanup');
        await expect(repository.cleanupExactRun(command)).rejects.toBeInstanceOf(
          FakeMatrixCorpusRepositoryFault
        );
        const committed = repository.safeStateSummary();
        expect(before.transportReceipts).toHaveLength(committed.transportReceipts.length + 96);
        expect(before.current).toEqual(committed.current);
        expect(before.terminalControlOutboxes).toEqual(committed.terminalControlOutboxes);
        const targetBefore = before.histories.find(
          (history) => history.runFenceDigest === target.runFenceDigest
        );
        const targetAfter = committed.histories.find(
          (history) => history.runFenceDigest === target.runFenceDigest
        );
        expect(targetBefore).not.toEqual(targetAfter);
        const progressReceipt = targetAfter?.cleanupProgress?.chunkReceipts[0];
        if (progressReceipt === undefined)
          throw new Error('response-loss fixture requires a progress receipt');
        const progressMutationCount =
          before.transportReceipts.length - committed.transportReceipts.length +
          (JSON.stringify(targetBefore) === JSON.stringify(targetAfter) ? 0 : 1);
        expect(progressMutationCount).toBe(97);
        const beforeProgressReplayDigestCalls = digestInputs.length;
        await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({
          code: 'ALREADY_APPLIED',
          operation: 'cleanup',
          result: 'progress',
          committedRevision: 1,
          remainingChildCount: 6_048,
        });
        expect(digestInputs).toHaveLength(beforeProgressReplayDigestCalls + 1);
        expect(digestInputs.at(-1)).toEqual(progressReceipt.replayProjection);
        expect(repository.safeStateSummary()).toEqual(committed);
        await expect(
          repository.cleanupExactRun({
            ...command,
            canonicalRequestDigest: indexedDigest(200_000),
          })
        ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
        expect(repository.safeStateSummary()).toEqual(committed);
      } else {
        await expect(repository.cleanupExactRun(command)).resolves.toMatchObject({
          code: 'RUN_CLEANUP_PROGRESS',
          committedRevision: revision + 1,
          remainingChildCount: 6_144 - 96 * (revision + 1),
        });
      }
      const after = repository.safeStateSummary();
      const progress = after.histories.find(
        (history) => history.runFenceDigest === target.runFenceDigest
      )?.cleanupProgress;
      expect(progress?.revision).toBe(revision + 1);
      expect(
        progress === null || progress === undefined
          ? 0
          : progress.remaining.renewReceiptIds.length +
              progress.remaining.capabilityIssuanceReceiptIds.length +
              progress.remaining.capabilityDigests.length +
              progress.remaining.transportReceiptIds.length +
              progress.remaining.ingestOutboxIds.length +
              progress.remaining.terminalControlOutboxIds.length
      ).toBe(6_144 - 96 * (revision + 1));
    }

    const finalCommand = commandFor(63);
    const beforeFinal = repository.safeStateSummary();
    repository.loseNextResponseAfterCommit('cleanup');
    await expect(repository.cleanupExactRun(finalCommand)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    const afterFinal = repository.safeStateSummary();
    expect(beforeFinal.transportReceipts).toHaveLength(afterFinal.transportReceipts.length + 95);
    expect(beforeFinal.terminalControlOutboxes).toHaveLength(
      afterFinal.terminalControlOutboxes.length + 1
    );
    expect(beforeFinal.histories).toHaveLength(afterFinal.histories.length + 1);
    expect(afterFinal.histories.map((history) => history.runFenceDigest)).not.toContain(
      target.runFenceDigest
    );
    const finalReceipt = afterFinal.current[0]?.lease.finalCleanupReceipt;
    expect(finalReceipt?.replayProjection).toMatchObject({
      result: 'cleaned',
      finalRevision: 64,
      targetRunFenceDigest: target.runFenceDigest,
    });
    expect(
      afterFinal.histories.find((history) => history.runFenceDigest === 'b'.repeat(64))
        ?.finalCleanupReceipt
    ).toEqual(finalReceipt);
    const finalMutationCount =
      beforeFinal.transportReceipts.length - afterFinal.transportReceipts.length +
      (beforeFinal.terminalControlOutboxes.length - afterFinal.terminalControlOutboxes.length) +
      2 +
      (beforeFinal.histories.length - afterFinal.histories.length);
    expect(finalMutationCount).toBe(99);

    const beforeFinalReplayDigestCalls = digestInputs.length;
    await expect(repository.cleanupExactRun(finalCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      finalRevision: 64,
    });
    expect(digestInputs).toHaveLength(beforeFinalReplayDigestCalls + 1);
    expect(digestInputs.at(-1)).toEqual(finalReceipt?.replayProjection);
    expect(repository.safeStateSummary()).toEqual(afterFinal);
    await expect(
      repository.cleanupExactRun({
        ...finalCommand,
        canonicalRequestDigest: indexedDigest(200_001),
      })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      repository.cleanupExactRun({
        ...finalCommand,
        idempotencyKeyDigest: indexedDigest(200_002),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'provisioning' });
    expect(repository.safeStateSummary()).toEqual(afterFinal);
    expect(repository.operationCounts('cleanup')).toEqual({ invocations: 69, commits: 64 });
    expect(digestCalls).toBe(68);
  }, 30_000);

  it('R20 ingest claim and renewal eligibility is exact', async () => {
    const pending = seededOutbox(30_000, 'pending');
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    repository.seedValidIssueConsumeState(ingestOutboxSeed(30_000, pending));
    const command = claimIngestInput(pending);

    await expect(repository.claimPendingIngestOutbox(command)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      outboxKind: 'ingest',
      ingestOutboxId: pending.ingestOutboxId,
      ownerDigest: command.ownerDigest,
      purpose: 'publish',
      claimExpiresAt: command.claimExpiresAt,
      payloadDigest: pending.payloadDigest,
    });
    const committed = repository.safeStateSummary();
    await expect(
      repository.claimPendingIngestOutbox({
        ...command,
        now: '2026-07-20T00:00:11.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'claim_ingest',
      claimExpiresAt: command.claimExpiresAt,
    });
    await expect(
      repository.claimPendingIngestOutbox({
        ...command,
        now: '2026-07-20T00:00:11.000Z',
        claimExpiresAt: '2026-07-20T00:05:11.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(repository.safeStateSummary()).toEqual(committed);
    expect(repository.operationCounts('claim_ingest')).toEqual({ invocations: 3, commits: 1 });

    const expiredPending = seededOutbox(30_001, 'pending');
    const expiredRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    expiredRepository.seedValidIssueConsumeState(ingestOutboxSeed(30_001, expiredPending));
    await expect(
      expiredRepository.claimPendingIngestOutbox(
        claimIngestInput(expiredPending, {
          now: '2026-07-20T00:01:00.000Z',
          claimExpiresAt: '2026-07-20T00:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    expect(expiredRepository.operationCounts('claim_ingest')).toEqual({ invocations: 1, commits: 0 });

    const claimedBase = seededOutbox(30_002, 'claimed');
    if (claimedBase.claim === null) throw new Error('takeover fixture requires a claim');
    const expiredClaimed = {
      ...claimedBase,
      claim: {
        ...claimedBase.claim,
        expiresAt: '2026-07-20T00:05:04.000Z',
      },
      lastClaimRenewal: {
        ownerDigest: claimedBase.claim.ownerDigest,
        purpose: 'publish',
        previousClaimExpiresAt: '2026-07-20T00:04:04.000Z',
        claimExpiresAt: '2026-07-20T00:05:04.000Z',
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const takeoverRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    takeoverRepository.seedValidIssueConsumeState(ingestOutboxSeed(30_002, expiredClaimed));
    const takeoverCommand = claimIngestInput(expiredClaimed, {
      now: '2026-07-20T00:05:04.000Z',
      claimExpiresAt: '2026-07-20T00:10:04.000Z',
    });
    await expect(takeoverRepository.claimPendingIngestOutbox(takeoverCommand)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      ownerDigest: takeoverCommand.ownerDigest,
      purpose: 'publish',
      claimExpiresAt: takeoverCommand.claimExpiresAt,
    });
    expect(takeoverRepository.safeStateSummary().ingestOutboxes[0]).toMatchObject({
      status: 'claimed',
      claimOwnerDigest: takeoverCommand.ownerDigest,
      claimPurpose: 'publish',
      claimClaimedAt: takeoverCommand.now,
      claimExpiresAt: takeoverCommand.claimExpiresAt,
      lastClaimRenewal: null,
    });
    expect(takeoverRepository.operationCounts('claim_ingest')).toEqual({ invocations: 1, commits: 1 });

    const renewable = seededOutbox(30_003, 'claimed');
    const renewalRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    renewalRepository.seedValidIssueConsumeState(ingestOutboxSeed(30_003, renewable));
    const renewalCommand = renewIngestInput(renewable);
    await expect(renewalRepository.renewIngestOutboxClaim(renewalCommand)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      outboxKind: 'ingest',
      ingestOutboxId: renewable.ingestOutboxId,
      ownerDigest: renewalCommand.ownerDigest,
      purpose: 'publish',
      previousClaimExpiresAt: renewalCommand.expectedClaimExpiresAt,
      claimExpiresAt: renewalCommand.newClaimExpiresAt,
    });
    const renewalCommitted = renewalRepository.safeStateSummary();
    expect(renewalCommitted.ingestOutboxes[0]).toMatchObject({
      claimClaimedAt: renewalCommand.now,
      claimExpiresAt: renewalCommand.newClaimExpiresAt,
      lastClaimRenewal: {
        ownerDigest: renewalCommand.ownerDigest,
        purpose: 'publish',
        previousClaimExpiresAt: renewalCommand.expectedClaimExpiresAt,
        claimExpiresAt: renewalCommand.newClaimExpiresAt,
      },
    });
    await expect(
      renewalRepository.renewIngestOutboxClaim({
        ...renewalCommand,
        now: '2026-07-20T00:00:03.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew_claim',
      claimExpiresAt: renewalCommand.newClaimExpiresAt,
    });
    await expect(
      renewalRepository.renewIngestOutboxClaim({
        ...renewalCommand,
        payloadDigest: 'f'.repeat(64),
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(renewalRepository.safeStateSummary()).toEqual(renewalCommitted);
    expect(renewalRepository.operationCounts('renew_ingest_claim')).toEqual({
      invocations: 3,
      commits: 1,
    });

    const overBoundRenewalRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    overBoundRenewalRepository.seedValidIssueConsumeState(ingestOutboxSeed(30_004, seededOutbox(30_004, 'claimed')));
    const overBoundRenewable = seededOutbox(30_004, 'claimed');
    await expect(
      overBoundRenewalRepository.renewIngestOutboxClaim(
        renewIngestInput(overBoundRenewable, {
          newClaimExpiresAt: '2026-07-20T00:05:10.001Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(overBoundRenewalRepository.operationCounts('renew_ingest_claim')).toEqual({
      invocations: 1,
      commits: 0,
    });

    const nonExtendingRenewable = seededOutbox(30_006, 'claimed');
    const nonExtendingRenewalRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    nonExtendingRenewalRepository.seedValidIssueConsumeState(
      ingestOutboxSeed(30_006, nonExtendingRenewable)
    );
    await expect(
      nonExtendingRenewalRepository.renewIngestOutboxClaim(
        renewIngestInput(nonExtendingRenewable, {
          newClaimExpiresAt: '2026-07-20T00:05:03.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(nonExtendingRenewalRepository.operationCounts('renew_ingest_claim')).toEqual({
      invocations: 1,
      commits: 0,
    });

    const expiryBoundaryBase = seededOutbox(30_009, 'claimed');
    if (expiryBoundaryBase.claim === null)
      throw new Error('renewal expiry boundary fixture requires a claim');
    const expiryBoundary = {
      ...expiryBoundaryBase,
      claim: {
        ...expiryBoundaryBase.claim,
        expiresAt: '2026-07-20T00:00:10.000Z',
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const expiryBoundaryState = ingestPhaseRepository(30_009, expiryBoundary, 'active');
    await expect(
      expiryBoundaryState.repository.renewIngestOutboxClaim(
        renewIngestInput(expiryBoundary, {
          now: '2026-07-20T00:00:10.000Z',
          newClaimExpiresAt: '2026-07-20T00:05:10.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(expiryBoundaryState.digestCalls()).toBe(0);

    const missingRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    const retained = seededOutbox(30_005, 'claimed');
    missingRepository.seedValidIssueConsumeState(ingestOutboxSeed(30_005, retained));
    await expect(
      missingRepository.claimPendingIngestOutbox(
        claimIngestInput(retained, { ingestOutboxId: 'outbox_missing' })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      missingRepository.renewIngestOutboxClaim(
        renewIngestInput(retained, { ingestOutboxId: 'outbox_missing' })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });

    for (const [offset, invariant] of (
      [
        'referenced_ingest_outbox_missing_record',
        'present_ingest_outbox_missing_history_reference',
      ] as const
    ).entries()) {
      const corruptedOutbox = seededOutbox(30_030 + offset, 'claimed');
      const corruptedState = ingestPhaseRepository(30_030 + offset, corruptedOutbox, 'active');
      corruptedState.repository.corruptIngestClaimInvariantForTest(invariant);
      const corruptedBefore = corruptedState.repository.safeStateSummary();
      await expect(
        corruptedState.repository.claimPendingIngestOutbox(claimIngestInput(corruptedOutbox)),
        `${invariant} claim`
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
      await expect(
        corruptedState.repository.renewIngestOutboxClaim(renewIngestInput(corruptedOutbox)),
        `${invariant} renewal`
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
      expect(corruptedState.repository.safeStateSummary()).toEqual(corruptedBefore);
      expect(corruptedState.repository.operationCounts('claim_ingest')).toEqual({
        invocations: 1,
        commits: 0,
      });
      expect(corruptedState.repository.operationCounts('renew_ingest_claim')).toEqual({
        invocations: 1,
        commits: 0,
      });
      expect(corruptedState.digestCalls()).toBe(0);
    }

    const liveClaimed = seededOutbox(30_007, 'claimed');
    const liveClaimedState = ingestPhaseRepository(30_007, liveClaimed, 'active');
    await expect(
      liveClaimedState.repository.claimPendingIngestOutbox(claimIngestInput(liveClaimed))
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(liveClaimedState.digestCalls()).toBe(0);

    const livePublished = seededOutbox(30_008, 'published');
    if (livePublished.claim === null) throw new Error('live recovery fixture requires a claim');
    const livePublishedState = ingestPhaseRepository(30_008, livePublished, 'active');
    const exactRecoveryClaim = claimIngestInput(livePublished, {
      ownerDigest: livePublished.claim.ownerDigest,
      purpose: 'terminal_marker_recovery',
      now: '2026-07-20T00:05:10.000Z',
      claimExpiresAt: livePublished.claim.expiresAt,
    });
    await expect(
      livePublishedState.repository.claimPendingIngestOutbox(exactRecoveryClaim)
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'claim_ingest',
      purpose: 'terminal_marker_recovery',
      claimExpiresAt: livePublished.claim.expiresAt,
    });
    await expect(
      livePublishedState.repository.claimPendingIngestOutbox({
        ...exactRecoveryClaim,
        purpose: 'publish',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(livePublishedState.digestCalls()).toBe(0);

    for (const [offset, phase] of (
      ['quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const pendingOutsideActive = seededOutbox(30_010 + offset, 'pending');
      const pendingState = ingestPhaseRepository(30_010 + offset, pendingOutsideActive, phase);
      await expect(
        pendingState.repository.claimPendingIngestOutbox(
          claimIngestInput(pendingOutsideActive, {
            now: '2026-07-20T00:01:10.000Z',
            claimExpiresAt: '2026-07-20T00:06:10.000Z',
          })
        ),
        `fresh pending publish in ${phase}`
      ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: phase });
      expect(pendingState.digestCalls()).toBe(0);
    }

    const invalidClaimTtl = seededOutbox(30_020, 'pending');
    const invalidClaimTtlState = ingestPhaseRepository(30_020, invalidClaimTtl, 'active');
    await expect(
      invalidClaimTtlState.repository.claimPendingIngestOutbox(
        claimIngestInput(invalidClaimTtl, {
          claimExpiresAt: '2026-07-20T00:00:10.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      invalidClaimTtlState.repository.claimPendingIngestOutbox(
        claimIngestInput(invalidClaimTtl, {
          claimExpiresAt: '2026-07-20T00:05:10.001Z',
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(invalidClaimTtlState.digestCalls()).toBe(0);

    for (const [offset, phase] of (
      ['active', 'quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const phaseRenewable = seededOutbox(30_100 + offset, 'claimed');
      const phaseState = ingestPhaseRepository(30_100 + offset, phaseRenewable, phase);
      const now =
        phase === 'abandon_pending' || phase === 'abandoned'
          ? '2026-07-20T00:01:10.000Z'
          : '2026-07-20T00:00:10.000Z';
      const phaseRenewal = renewIngestInput(phaseRenewable, {
        now,
        newClaimExpiresAt:
          phase === 'abandon_pending' || phase === 'abandoned'
            ? '2026-07-20T00:06:10.000Z'
            : '2026-07-20T00:05:10.000Z',
      });
      await expect(
        phaseState.repository.renewIngestOutboxClaim(phaseRenewal),
        `live publish renewal in ${phase}`
      ).resolves.toMatchObject({
        code: 'OUTBOX_CLAIM_RENEWED',
        purpose: 'publish',
        previousClaimExpiresAt: phaseRenewal.expectedClaimExpiresAt,
        claimExpiresAt: phaseRenewal.newClaimExpiresAt,
      });
      expect(phaseState.digestCalls()).toBe(0);
    }

    const closed = seededOutbox(30_500, 'closed');
    const closedState = ingestPhaseRepository(30_500, closed, 'active');
    await expect(
      closedState.repository.claimPendingIngestOutbox(claimIngestInput(closed))
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    const claimedRenewalSource = seededOutbox(30_501, 'claimed');
    await expect(
      closedState.repository.renewIngestOutboxClaim(
        renewIngestInput(claimedRenewalSource, {
          ingestOutboxId: closed.ingestOutboxId,
          payloadDigest: closed.payloadDigest,
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(closedState.digestCalls()).toBe(0);

    const markerless = seededOutbox(30_502, 'published');
    if (
      markerless.claim === null ||
      markerless.publisherReceiptDigest === null ||
      markerless.publishedAt === null
    )
      throw new Error('terminal marker fixture requires published recovery state');
    const markerState = ingestPhaseRepository(30_502, markerless, 'active');
    const terminalMarker = {
      kind: 'completed' as const,
      digest: indexedDigest(350_000),
      recordedAt: '2026-07-20T00:05:10.000Z',
    };
    await expect(
      markerState.repository.acknowledgeIngestOutbox({
        runtimeAudience: 'hetzner-prod',
        runId: markerless.runId,
        userId: markerless.userId,
        leaseFence: markerless.leaseFence,
        leaseSlotDigest: digest,
        runFenceDigest: 'b'.repeat(64),
        ingestOutboxId: markerless.ingestOutboxId,
        ingestReceiptId: markerless.ingestReceiptId,
        payloadDigest: markerless.payloadDigest,
        ownerDigest: markerless.claim.ownerDigest,
        claimPurpose: 'terminal_marker_recovery',
        expectedClaimExpiresAt: markerless.claim.expiresAt,
        now: terminalMarker.recordedAt,
        outcome: {
          kind: 'terminal_marker_acknowledged',
          publisherReceiptDigest: markerless.publisherReceiptDigest,
          publishedAt: markerless.publishedAt,
          terminalMarker,
          replyOrDeliveryWorkInFlight: 0,
        },
      })
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED' });
    await expect(
      markerState.repository.claimPendingIngestOutbox(
        claimIngestInput(markerless, {
          ownerDigest: markerless.claim.ownerDigest,
          purpose: 'terminal_marker_recovery',
          now: '2026-07-20T00:05:11.000Z',
          claimExpiresAt: markerless.claim.expiresAt,
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    await expect(
      markerState.repository.renewIngestOutboxClaim(
        renewIngestInput(markerless, {
          now: '2026-07-20T00:05:11.000Z',
          newClaimExpiresAt: '2026-07-20T00:10:11.000Z',
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(markerState.digestCalls()).toBe(0);

    const beforePublication = seededOutbox(30_503, 'claimed');
    const publicationState = ingestPhaseRepository(30_503, beforePublication, 'active');
    const publishRenewalA = renewIngestInput(beforePublication);
    await expect(
      publicationState.repository.renewIngestOutboxClaim(publishRenewalA)
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIM_RENEWED' });
    const publishRenewalB = {
      ...publishRenewalA,
      now: '2026-07-20T00:00:11.000Z',
      expectedClaimExpiresAt: publishRenewalA.newClaimExpiresAt,
      newClaimExpiresAt: '2026-07-20T00:05:11.000Z',
    } satisfies RenewIngestOutboxClaimInput;
    await expect(
      publicationState.repository.renewIngestOutboxClaim(publishRenewalB)
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIM_RENEWED' });
    const publisherReceiptDigest = indexedDigest(350_001);
    const publishedAt = '2026-07-20T00:00:12.000Z';
    await expect(
      publicationState.repository.acknowledgeIngestOutbox({
        runtimeAudience: 'hetzner-prod',
        runId: beforePublication.runId,
        userId: beforePublication.userId,
        leaseFence: beforePublication.leaseFence,
        leaseSlotDigest: digest,
        runFenceDigest: 'b'.repeat(64),
        ingestOutboxId: beforePublication.ingestOutboxId,
        ingestReceiptId: beforePublication.ingestReceiptId,
        payloadDigest: beforePublication.payloadDigest,
        ownerDigest: publishRenewalB.ownerDigest,
        claimPurpose: 'publish',
        expectedClaimExpiresAt: publishRenewalB.newClaimExpiresAt,
        now: publishedAt,
        outcome: { kind: 'publication_acknowledged', publisherReceiptDigest, publishedAt },
      })
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED' });
    expect(publicationState.repository.safeStateSummary().ingestOutboxes[0]).toMatchObject({
      status: 'published',
      claimOwnerDigest: publishRenewalB.ownerDigest,
      claimPurpose: 'terminal_marker_recovery',
      publisherReceiptDigest,
      publishedAt,
      lastClaimRenewal: {
        ownerDigest: publishRenewalB.ownerDigest,
        purpose: 'publish',
        previousClaimExpiresAt: publishRenewalB.expectedClaimExpiresAt,
        claimExpiresAt: publishRenewalB.newClaimExpiresAt,
      },
    });
    await expect(
      publicationState.repository.renewIngestOutboxClaim({
        ...publishRenewalB,
        now: '2026-07-20T00:05:12.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew_claim',
      purpose: 'publish',
      previousClaimExpiresAt: publishRenewalB.expectedClaimExpiresAt,
      claimExpiresAt: publishRenewalB.newClaimExpiresAt,
    });
    await expect(
      publicationState.repository.renewIngestOutboxClaim({
        ...publishRenewalA,
        now: '2026-07-20T00:00:13.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      publicationState.repository.renewIngestOutboxClaim({
        ...publishRenewalB,
        now: '2026-07-20T00:00:13.000Z',
        newClaimExpiresAt: '2026-07-20T00:05:12.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(publicationState.digestCalls()).toBe(0);

    const backdatedBase = seededOutbox(30_504, 'claimed');
    if (backdatedBase.claim === null) throw new Error('backdated renewal fixture requires a claim');
    const backdatedClaim = {
      ...backdatedBase,
      claim: {
        ...backdatedBase.claim,
        claimedAt: '2026-07-20T00:00:10.000Z',
        expiresAt: '2026-07-20T00:04:10.000Z',
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const backdatedState = ingestPhaseRepository(30_504, backdatedClaim, 'active');
    await expect(
      backdatedState.repository.renewIngestOutboxClaim(
        renewIngestInput(backdatedClaim, {
          now: '2026-07-20T00:00:09.000Z',
          newClaimExpiresAt: '2026-07-20T00:04:11.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(backdatedState.digestCalls()).toBe(0);

    for (const [offset, phase] of (
      ['active', 'quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const claimed = seededOutbox(30_300 + offset, 'claimed');
      if (claimed.claim === null) throw new Error('publish takeover fixture requires a claim');
      const expiredPublish = {
        ...claimed,
        claim: { ...claimed.claim, expiresAt: '2026-07-20T00:01:09.000Z' },
      } satisfies MatrixCorpusIngestOutboxRecordV1;
      const phaseState = ingestPhaseRepository(30_300 + offset, expiredPublish, phase);
      const takeover = claimIngestInput(expiredPublish, {
        now: '2026-07-20T00:01:10.000Z',
        claimExpiresAt: '2026-07-20T00:06:10.000Z',
      });
      const result = await phaseState.repository.claimPendingIngestOutbox(takeover);
      if (phase === 'active' || phase === 'quiescing') {
        expect(result, `expired publish takeover in ${phase}`).toMatchObject({
          code: 'OUTBOX_CLAIMED',
          ownerDigest: takeover.ownerDigest,
          purpose: 'publish',
        });
      } else {
        expect(result, `expired publish takeover in ${phase}`).toEqual({
          code: 'PHASE_CONFLICT',
          actualPhase: phase,
        });
      }
      expect(phaseState.digestCalls()).toBe(0);
    }

    for (const [offset, phase] of (
      ['active', 'quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const published = seededOutbox(30_400 + offset, 'published');
      if (published.claim === null) throw new Error('recovery takeover fixture requires a claim');
      const expiredRecovery = {
        ...published,
        claim: { ...published.claim, expiresAt: '2026-07-20T00:06:10.000Z' },
      } satisfies MatrixCorpusIngestOutboxRecordV1;
      const phaseState = ingestPhaseRepository(30_400 + offset, expiredRecovery, phase);
      const takeover = claimIngestInput(expiredRecovery, {
        purpose: 'terminal_marker_recovery',
        now: '2026-07-20T00:06:10.000Z',
        claimExpiresAt: '2026-07-20T00:11:10.000Z',
      });
      await expect(
        phaseState.repository.claimPendingIngestOutbox(takeover),
        `expired recovery takeover in ${phase}`
      ).resolves.toMatchObject({
        code: 'OUTBOX_CLAIMED',
        ownerDigest: takeover.ownerDigest,
        purpose: 'terminal_marker_recovery',
      });
      expect(phaseState.repository.safeStateSummary().ingestOutboxes[0]).toMatchObject({
        status: 'published',
        publisherReceiptDigest: expiredRecovery.publisherReceiptDigest,
        publishedAt: expiredRecovery.publishedAt,
        claimOwnerDigest: takeover.ownerDigest,
        claimPurpose: 'terminal_marker_recovery',
        lastClaimRenewal: null,
      });
      expect(phaseState.digestCalls()).toBe(0);
    }

    for (const [offset, phase] of (
      ['active', 'quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const recoveryRenewable = seededOutbox(30_200 + offset, 'published');
      const phaseState = ingestPhaseRepository(30_200 + offset, recoveryRenewable, phase);
      const recoveryRenewal = renewIngestInput(recoveryRenewable, {
        now: '2026-07-20T00:05:10.000Z',
        newClaimExpiresAt: '2026-07-20T00:10:10.000Z',
      });
      await expect(
        phaseState.repository.renewIngestOutboxClaim(recoveryRenewal),
        `live recovery renewal in ${phase}`
      ).resolves.toMatchObject({
        code: 'OUTBOX_CLAIM_RENEWED',
        purpose: 'terminal_marker_recovery',
        previousClaimExpiresAt: recoveryRenewal.expectedClaimExpiresAt,
        claimExpiresAt: recoveryRenewal.newClaimExpiresAt,
      });
      expect(phaseState.digestCalls()).toBe(0);
    }
  });

  it('R19 stale ingest owner cannot claim or renew', async () => {
    const claimed = seededOutbox(30_600, 'claimed');
    if (claimed.claim === null) throw new Error('stale ingest fixture requires a claim');
    const retained = {
      ...claimed,
      claim: {
        ...claimed.claim,
        claimedAt: '2026-07-20T00:00:10.000Z',
        expiresAt: '2026-07-20T00:05:10.000Z',
      },
      lastClaimRenewal: {
        ownerDigest: claimed.claim.ownerDigest,
        purpose: 'publish',
        previousClaimExpiresAt: claimed.claim.expiresAt,
        claimExpiresAt: '2026-07-20T00:05:10.000Z',
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const staleState = ingestPhaseRepository(30_600, retained, 'abandoned');

    await expect(
      staleState.repository.acquireProvisioningLease(
        acquireCommand({
          runId: 'run_2',
          runFenceDigest: 'e'.repeat(64),
          idempotencyKeyDigest: 'f'.repeat(64),
          canonicalRequestDigest: '0'.repeat(64),
        })
      )
    ).resolves.toMatchObject({
      code: 'ACQUIRED',
      runId: 'run_2',
      leaseFence: '2',
      phase: 'provisioning',
    });
    const before = staleState.repository.safeStateSummary();
    const digestCallsBefore = staleState.digestCalls();
    const exactClaimReplay = claimIngestInput(retained, {
      ownerDigest: retained.claim.ownerDigest,
      purpose: retained.claim.purpose,
      claimExpiresAt: retained.claim.expiresAt,
      now: '2026-07-20T00:00:11.000Z',
    });
    const exactRenewalReplay = renewIngestInput(retained, {
      expectedClaimExpiresAt: retained.lastClaimRenewal.previousClaimExpiresAt,
      newClaimExpiresAt: retained.lastClaimRenewal.claimExpiresAt,
      now: '2026-07-20T00:00:03.000Z',
    });

    await expect(
      staleState.repository.claimPendingIngestOutbox(exactClaimReplay)
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      staleState.repository.claimPendingIngestOutbox({
        ...exactClaimReplay,
        ingestOutboxId: 'outbox_missing',
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      staleState.repository.renewIngestOutboxClaim(exactRenewalReplay)
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    await expect(
      staleState.repository.renewIngestOutboxClaim({
        ...exactRenewalReplay,
        ingestOutboxId: 'outbox_missing',
      })
    ).resolves.toEqual({ code: 'STALE_FENCE' });

    expect(staleState.repository.safeStateSummary()).toEqual(before);
    expect(staleState.repository.operationCounts('claim_ingest')).toEqual({
      invocations: 2,
      commits: 0,
    });
    expect(staleState.repository.operationCounts('renew_ingest_claim')).toEqual({
      invocations: 2,
      commits: 0,
    });
    expect(staleState.digestCalls()).toBe(digestCallsBefore);
  });

  it('R12/R20 ingest acknowledgements preserve E1 across E2 recovery', async () => {
    const pending = seededOutbox(31_000, 'pending');
    const state = ingestPhaseRepository(31_000, pending, 'active');
    const publishClaim = claimIngestInput(pending);
    await expect(state.repository.claimPendingIngestOutbox(publishClaim)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      purpose: 'publish',
    });
    const claimed = {
      ...pending,
      status: 'claimed',
      claim: {
        ownerDigest: publishClaim.ownerDigest,
        purpose: 'publish',
        claimedAt: publishClaim.now,
        expiresAt: publishClaim.claimExpiresAt,
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const publication = acknowledgeIngestInput(claimed);
    if (publication.outcome.kind !== 'publication_acknowledged')
      throw new Error('E1 fixture requires a publication acknowledgement');

    state.repository.loseNextResponseAfterCommit('acknowledge_ingest');
    await expect(state.repository.acknowledgeIngestOutbox(publication)).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    const afterE1 = state.repository.safeStateSummary();
    expect(afterE1.ingestOutboxes[0]).toMatchObject({
      status: 'published',
      claimOwnerDigest: publishClaim.ownerDigest,
      claimPurpose: 'terminal_marker_recovery',
      publisherReceiptDigest: publication.outcome.publisherReceiptDigest,
      publishedAt: publication.outcome.publishedAt,
      acknowledgementReceipts: [
        expect.objectContaining({
          ownerDigest: publishClaim.ownerDigest,
          claimPurpose: 'publish',
          outcome: publication.outcome,
          drained: false,
        }),
      ],
    });
    const e1Receipt = afterE1.ingestOutboxes[0]?.acknowledgementReceipts[0];
    if (e1Receipt === undefined) throw new Error('E1 acknowledgement receipt must be durable');
    const e1ReplayProjection = {
      code: 'ALREADY_APPLIED',
      operation: 'acknowledge_ingest',
      outboxKind: 'ingest',
      ingestOutboxId: pending.ingestOutboxId,
      runId: pending.runId,
      leaseFence: pending.leaseFence,
      payloadDigest: pending.payloadDigest,
      outcome: publication.outcome,
      acknowledgedAt: publication.outcome.publishedAt,
      drained: false,
    } as const;
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        now: '2026-07-20T00:00:11.000Z',
      })
    ).resolves.toEqual(e1ReplayProjection);
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        now: '2026-07-20T00:00:09.000Z',
      })
    ).resolves.toEqual(e1ReplayProjection);
    expect(state.repository.safeStateSummary()).toEqual(afterE1);

    const published = {
      ...claimed,
      status: 'published',
      claim: { ...claimed.claim, purpose: 'terminal_marker_recovery' },
      publisherReceiptDigest: publication.outcome.publisherReceiptDigest,
      publishedAt: publication.outcome.publishedAt,
      acknowledgementReceipts: [
        {
          version: 1,
          ownerDigest: publication.ownerDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: publication.expectedClaimExpiresAt,
          outcome: publication.outcome,
          acknowledgedAt: publication.outcome.publishedAt,
          drained: false,
        },
      ],
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const recoveryClaim = claimIngestInput(published, {
      ownerDigest: indexedDigest(360_000),
      purpose: 'terminal_marker_recovery',
      now: publishClaim.claimExpiresAt,
      claimExpiresAt: '2026-07-20T00:10:10.000Z',
    });
    await expect(state.repository.claimPendingIngestOutbox(recoveryClaim)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      ownerDigest: recoveryClaim.ownerDigest,
      purpose: 'terminal_marker_recovery',
    });
    await expect(state.repository.acknowledgeIngestOutbox(publication)).resolves.toEqual(
      e1ReplayProjection
    );
    expect(
      state.repository.safeStateSummary().ingestOutboxes[0]?.acknowledgementReceipts[0]
    ).toEqual(e1Receipt);

    const recovered = {
      ...published,
      claim: {
        ownerDigest: recoveryClaim.ownerDigest,
        purpose: 'terminal_marker_recovery',
        claimedAt: recoveryClaim.now,
        expiresAt: recoveryClaim.claimExpiresAt,
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const recoveryRenewal = renewIngestInput(recovered, {
      now: '2026-07-20T00:05:11.000Z',
      newClaimExpiresAt: '2026-07-20T00:10:11.000Z',
    });
    await expect(state.repository.renewIngestOutboxClaim(recoveryRenewal)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      purpose: 'terminal_marker_recovery',
    });
    await expect(state.repository.acknowledgeIngestOutbox(publication)).resolves.toEqual(
      e1ReplayProjection
    );
    expect(
      state.repository.safeStateSummary().ingestOutboxes[0]?.acknowledgementReceipts[0]
    ).toEqual(e1Receipt);

    const renewedRecovery = {
      ...recovered,
      claim: {
        ...recovered.claim,
        claimedAt: recoveryRenewal.now,
        expiresAt: recoveryRenewal.newClaimExpiresAt,
      },
      lastClaimRenewal: {
        ownerDigest: recoveryRenewal.ownerDigest,
        purpose: 'terminal_marker_recovery',
        previousClaimExpiresAt: recoveryRenewal.expectedClaimExpiresAt,
        claimExpiresAt: recoveryRenewal.newClaimExpiresAt,
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const terminalMarker = {
      kind: 'completed' as const,
      digest: indexedDigest(360_001),
      recordedAt: '2026-07-20T00:05:12.000Z',
    };
    const markerAcknowledgement = acknowledgeIngestInput(renewedRecovery, {
      now: terminalMarker.recordedAt,
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: publication.outcome.publisherReceiptDigest,
        publishedAt: publication.outcome.publishedAt,
        terminalMarker,
        replyOrDeliveryWorkInFlight: 0,
      },
    });
    if (markerAcknowledgement.outcome.kind !== 'terminal_marker_acknowledged')
      throw new Error('E2 fixture requires a terminal-marker acknowledgement');
    state.repository.loseNextResponseAfterCommit('acknowledge_ingest');
    await expect(
      state.repository.acknowledgeIngestOutbox(markerAcknowledgement)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const afterE2 = state.repository.safeStateSummary();
    expect(afterE2).toMatchObject({
      current: [
        {
          lease: {
            nonterminalIngestOutboxIds: [],
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 1,
              terminalOutboxCount: 1,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        },
      ],
      ingestOutboxes: [
        {
          status: 'published',
          publisherReceiptDigest: publication.outcome.publisherReceiptDigest,
          publishedAt: publication.outcome.publishedAt,
          terminalMarker,
          acknowledgementReceipts: [
            expect.objectContaining({ outcome: publication.outcome }),
            expect.objectContaining({ outcome: markerAcknowledgement.outcome }),
          ],
        },
      ],
    });
    expect(afterE2.ingestOutboxes[0]?.acknowledgementReceipts[0]).toEqual(e1Receipt);
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...markerAcknowledgement,
        now: '2026-07-20T00:10:12.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      outcome: markerAcknowledgement.outcome,
      acknowledgedAt: terminalMarker.recordedAt,
      drained: false,
    });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...markerAcknowledgement,
        now: '2026-07-20T00:00:01.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'acknowledge_ingest',
      outcome: markerAcknowledgement.outcome,
      acknowledgedAt: terminalMarker.recordedAt,
      drained: false,
    });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        now: '2026-07-20T00:10:12.000Z',
      })
    ).resolves.toEqual(e1ReplayProjection);
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...markerAcknowledgement,
        outcome: {
          ...markerAcknowledgement.outcome,
          publisherReceiptDigest: indexedDigest(360_002),
        },
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        ownerDigest: indexedDigest(360_005),
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        claimPurpose: 'terminal_marker_recovery',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        expectedClaimExpiresAt: '2026-07-20T00:05:11.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      state.repository.acknowledgeIngestOutbox({
        ...publication,
        outcome: {
          ...publication.outcome,
          publisherReceiptDigest: indexedDigest(360_006),
        },
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(state.repository.safeStateSummary()).toEqual(afterE2);
    expect(state.repository.operationCounts('acknowledge_ingest')).toEqual({
      invocations: 14,
      commits: 2,
    });
    expect(state.digestCalls()).toBe(0);

    const payloadClaimed = seededOutbox(31_001, 'claimed');
    const payloadState = ingestPhaseRepository(31_001, payloadClaimed, 'active');
    const payloadBefore = payloadState.repository.safeStateSummary();
    await expect(
      payloadState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(payloadClaimed, { payloadDigest: indexedDigest(360_003) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      payloadState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(payloadClaimed, { ingestReceiptId: 'receipt_wrong' })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(payloadState.repository.safeStateSummary()).toEqual(payloadBefore);
    expect(payloadState.repository.operationCounts('acknowledge_ingest')).toEqual({
      invocations: 2,
      commits: 0,
    });
    expect(payloadState.digestCalls()).toBe(0);

    const failedMarkerOutbox = seededOutbox(31_002, 'published');
    if (
      failedMarkerOutbox.claim === null ||
      failedMarkerOutbox.publisherReceiptDigest === null ||
      failedMarkerOutbox.publishedAt === null
    )
      throw new Error('failed marker fixture requires published recovery state');
    const failedMarkerState = ingestPhaseRepository(31_002, failedMarkerOutbox, 'quiescing');
    const failedMarkerAcknowledgement = acknowledgeIngestInput(failedMarkerOutbox, {
      now: '2026-07-20T00:05:10.000Z',
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: failedMarkerOutbox.publisherReceiptDigest,
        publishedAt: failedMarkerOutbox.publishedAt,
        terminalMarker: {
          kind: 'failed',
          digest: indexedDigest(360_004),
          recordedAt: '2026-07-20T00:05:10.000Z',
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
    if (failedMarkerAcknowledgement.outcome.kind !== 'terminal_marker_acknowledged')
      throw new Error('failed marker fixture requires a terminal-marker acknowledgement');
    await expect(
      failedMarkerState.repository.acknowledgeIngestOutbox(failedMarkerAcknowledgement)
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      outcome: failedMarkerAcknowledgement.outcome,
      drained: true,
    });
    expect(failedMarkerState.repository.safeStateSummary()).toMatchObject({
      current: [
        {
          lease: {
            phase: 'quiescing',
            nonterminalIngestOutboxIds: [],
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 1,
              terminalOutboxCount: 1,
              replyOrDeliveryWorkInFlight: 0,
              drained: true,
            },
          },
        },
      ],
      ingestOutboxes: [
        {
          status: 'published',
          terminalMarker: failedMarkerAcknowledgement.outcome.terminalMarker,
          acknowledgementReceipts: [
            expect.objectContaining({ outcome: failedMarkerOutbox.acknowledgementReceipts[0]?.outcome }),
            expect.objectContaining({ outcome: failedMarkerAcknowledgement.outcome, drained: true }),
          ],
        },
      ],
    });
    expect(failedMarkerState.digestCalls()).toBe(0);

    await expect(
      failedMarkerState.repository.acknowledgeIngestOutbox({
        ...failedMarkerAcknowledgement,
        now: '2026-07-20T00:10:11.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'acknowledge_ingest',
      outcome: failedMarkerAcknowledgement.outcome,
      drained: true,
    });

    for (const [offset, phase] of (
      ['active', 'quiescing', 'abandon_pending', 'abandoned'] as const
    ).entries()) {
      const phaseClaimed = seededOutbox(31_010 + offset, 'claimed');
      const phaseState = ingestPhaseRepository(31_010 + offset, phaseClaimed, phase);
      const acknowledgedAt =
        phase === 'abandon_pending' || phase === 'abandoned'
          ? '2026-07-20T00:01:10.000Z'
          : '2026-07-20T00:00:10.000Z';
      const phasePublicationOutcome = {
        kind: 'publication_acknowledged' as const,
        publisherReceiptDigest: indexedDigest(360_010 + offset),
        publishedAt: acknowledgedAt,
      };
      const phasePublication = acknowledgeIngestInput(phaseClaimed, {
        now: acknowledgedAt,
        outcome: phasePublicationOutcome,
      });
      await expect(
        phaseState.repository.acknowledgeIngestOutbox(phasePublication),
        `publication acknowledgement in ${phase}`
      ).resolves.toMatchObject({
        code: 'OUTBOX_ACKNOWLEDGED',
        outcome: phasePublication.outcome,
        drained: false,
      });
      expect(phaseState.repository.safeStateSummary().ingestOutboxes[0]).toMatchObject({
        status: 'published',
        claimOwnerDigest: phasePublication.ownerDigest,
        claimPurpose: 'terminal_marker_recovery',
        claimExpiresAt: phasePublication.expectedClaimExpiresAt,
        publisherReceiptDigest: phasePublicationOutcome.publisherReceiptDigest,
        publishedAt: phasePublicationOutcome.publishedAt,
      });
      expect(phaseState.digestCalls()).toBe(0);
    }

    const closureRows = [
      ['quiescing', 'quiesced'],
      ['quiescing', 'capability_replay'],
      ['abandon_pending', 'abandoned'],
      ['abandoned', 'abandoned'],
    ] as const;
    for (const [offset, [phase, reason]] of closureRows.entries()) {
      const closureClaimed = seededOutbox(31_020 + offset, 'claimed');
      const closureState = ingestPhaseRepository(31_020 + offset, closureClaimed, phase);
      const closedAt =
        phase === 'quiescing' ? '2026-07-20T00:00:10.000Z' : '2026-07-20T00:01:10.000Z';
      const closure = acknowledgeIngestInput(closureClaimed, {
        now: closedAt,
        outcome: { kind: 'claimed_not_published_closed', reason, closedAt },
      });
      closureState.repository.loseNextResponseAfterCommit('acknowledge_ingest');
      await expect(closureState.repository.acknowledgeIngestOutbox(closure)).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      const closedState = closureState.repository.safeStateSummary();
      expect(closedState).toMatchObject({
        current: [
          {
            lease: {
              phase,
              nonterminalIngestOutboxIds: [],
              drain: {
                consumedCapabilityCount: 1,
                terminalIntexMarkerCount: 0,
                terminalOutboxCount: 0,
                drained: false,
              },
            },
          },
        ],
        ingestOutboxes: [
          {
            status: 'closed',
            claimOwnerDigest: closure.ownerDigest,
            claimPurpose: 'publish',
            publisherReceiptDigest: null,
            terminalMarker: null,
            closedReason: reason,
            closedAt,
            acknowledgementReceipts: [expect.objectContaining({ outcome: closure.outcome, drained: false })],
          },
        ],
      });
      await expect(
        closureState.repository.acknowledgeIngestOutbox({
          ...closure,
          now: '2026-07-20T00:10:10.000Z',
        })
      ).resolves.toMatchObject({
        code: 'ALREADY_APPLIED',
        operation: 'acknowledge_ingest',
        outcome: closure.outcome,
        acknowledgedAt: closedAt,
        drained: false,
      });
      expect(closureState.repository.safeStateSummary()).toEqual(closedState);
      expect(closureState.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 2,
        commits: 1,
      });
      expect(closureState.digestCalls()).toBe(0);
    }

    const invalidClosureRows = [
      ['active', 'quiesced'],
      ['quiescing', 'abandoned'],
      ['abandon_pending', 'quiesced'],
      ['abandoned', 'capability_replay'],
    ] as const;
    for (const [offset, [phase, reason]] of invalidClosureRows.entries()) {
      const invalidClaimed = seededOutbox(31_030 + offset, 'claimed');
      const invalidState = ingestPhaseRepository(31_030 + offset, invalidClaimed, phase);
      const closedAt =
        phase === 'active' || phase === 'quiescing'
          ? '2026-07-20T00:00:10.000Z'
          : '2026-07-20T00:01:10.000Z';
      const beforeInvalid = invalidState.repository.safeStateSummary();
      await expect(
        invalidState.repository.acknowledgeIngestOutbox(
          acknowledgeIngestInput(invalidClaimed, {
            now: closedAt,
            outcome: { kind: 'claimed_not_published_closed', reason, closedAt },
          })
        ),
        `${reason} closure in ${phase}`
      ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: phase });
      expect(invalidState.repository.safeStateSummary()).toEqual(beforeInvalid);
      expect(invalidState.digestCalls()).toBe(0);
    }

    const backdatedClaimedBase = seededOutbox(31_040, 'claimed');
    if (backdatedClaimedBase.claim === null)
      throw new Error('backdated acknowledgement fixture requires a claim');
    const backdatedClaimed = {
      ...backdatedClaimedBase,
      claim: {
        ...backdatedClaimedBase.claim,
        claimedAt: '2026-07-20T00:00:10.000Z',
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const backdatedState = ingestPhaseRepository(31_040, backdatedClaimed, 'quiescing');
    const backdatedBefore = backdatedState.repository.safeStateSummary();
    await expect(
      backdatedState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(backdatedClaimed, {
          now: '2026-07-20T00:00:09.000Z',
          outcome: {
            kind: 'claimed_not_published_closed',
            reason: 'quiesced',
            closedAt: '2026-07-20T00:00:09.000Z',
          },
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(backdatedState.repository.safeStateSummary()).toEqual(backdatedBefore);

    const backdatedPublicationBase = seededOutbox(31_042, 'claimed');
    if (backdatedPublicationBase.claim === null)
      throw new Error('backdated publication fixture requires a claim');
    const backdatedPublication = {
      ...backdatedPublicationBase,
      claim: { ...backdatedPublicationBase.claim, claimedAt: '2026-07-20T00:00:10.000Z' },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const backdatedPublicationState = ingestPhaseRepository(31_042, backdatedPublication, 'active');
    const backdatedPublicationBefore = backdatedPublicationState.repository.safeStateSummary();
    await expect(
      backdatedPublicationState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(backdatedPublication, { now: '2026-07-20T00:00:09.000Z' })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(backdatedPublicationState.repository.safeStateSummary()).toEqual(backdatedPublicationBefore);

    const backdatedMarkerBase = seededOutbox(31_043, 'published');
    if (
      backdatedMarkerBase.claim === null ||
      backdatedMarkerBase.publisherReceiptDigest === null ||
      backdatedMarkerBase.publishedAt === null
    )
      throw new Error('backdated marker fixture requires publication proof');
    const backdatedPublisherReceiptDigest = backdatedMarkerBase.publisherReceiptDigest;
    const backdatedPublishedAt = backdatedMarkerBase.publishedAt;
    const backdatedMarker = {
      ...backdatedMarkerBase,
      claim: { ...backdatedMarkerBase.claim, claimedAt: '2026-07-20T00:05:10.000Z' },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const backdatedMarkerState = ingestPhaseRepository(31_043, backdatedMarker, 'active');
    const backdatedMarkerBefore = backdatedMarkerState.repository.safeStateSummary();
    await expect(
      backdatedMarkerState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(backdatedMarker, {
          now: '2026-07-20T00:05:09.000Z',
          outcome: {
            kind: 'terminal_marker_acknowledged',
            publisherReceiptDigest: backdatedPublisherReceiptDigest,
            publishedAt: backdatedPublishedAt,
            terminalMarker: {
              kind: 'completed',
              digest: indexedDigest(360_043),
              recordedAt: '2026-07-20T00:05:10.000Z',
            },
            replyOrDeliveryWorkInFlight: 0,
          },
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(backdatedMarkerState.repository.safeStateSummary()).toEqual(backdatedMarkerBefore);

    const delayedPublicationOutbox = seededOutbox(31_044, 'claimed');
    const delayedPublicationState = ingestPhaseRepository(31_044, delayedPublicationOutbox, 'active');
    await expect(
      delayedPublicationState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(delayedPublicationOutbox, {
          now: '2026-07-20T00:00:10.000Z',
          outcome: {
            kind: 'publication_acknowledged',
            publisherReceiptDigest: indexedDigest(360_044),
            publishedAt: '2026-07-20T00:00:09.000Z',
          },
        })
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      acknowledgedAt: '2026-07-20T00:00:09.000Z',
      drained: false,
    });

    const delayedMarkerOutbox = seededOutbox(31_045, 'published');
    if (delayedMarkerOutbox.publisherReceiptDigest === null || delayedMarkerOutbox.publishedAt === null)
      throw new Error('delayed marker fixture requires publication proof');
    await expect(
      ingestPhaseRepository(31_045, delayedMarkerOutbox, 'active').repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(delayedMarkerOutbox, {
          now: '2026-07-20T00:05:10.000Z',
          outcome: {
            kind: 'terminal_marker_acknowledged',
            publisherReceiptDigest: delayedMarkerOutbox.publisherReceiptDigest,
            publishedAt: delayedMarkerOutbox.publishedAt,
            terminalMarker: {
              kind: 'completed',
              digest: indexedDigest(360_045),
              recordedAt: '2026-07-20T00:05:09.000Z',
            },
            replyOrDeliveryWorkInFlight: 0,
          },
        })
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      acknowledgedAt: '2026-07-20T00:05:09.000Z',
      drained: false,
    });

    const publisherMismatchOutbox = seededOutbox(31_041, 'published');
    const publisherMismatchState = ingestPhaseRepository(31_041, publisherMismatchOutbox, 'active');
    const publisherMismatchBefore = publisherMismatchState.repository.safeStateSummary();
    await expect(
      publisherMismatchState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(publisherMismatchOutbox, {
          now: '2026-07-20T00:05:10.000Z',
          outcome: {
            kind: 'terminal_marker_acknowledged',
            publisherReceiptDigest: indexedDigest(360_041),
            publishedAt: publisherMismatchOutbox.publishedAt ?? timestamp,
            terminalMarker: {
              kind: 'completed',
              digest: indexedDigest(360_042),
              recordedAt: '2026-07-20T00:05:10.000Z',
            },
            replyOrDeliveryWorkInFlight: 0,
          },
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(publisherMismatchState.repository.safeStateSummary()).toEqual(publisherMismatchBefore);

    const missingOutbox = seededOutbox(31_050, 'claimed');
    const missingState = ingestPhaseRepository(31_050, missingOutbox, 'active');
    await expect(
      missingState.repository.acknowledgeIngestOutbox(
        acknowledgeIngestInput(missingOutbox, { ingestOutboxId: 'outbox_missing' })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    for (const [offset, invariant] of (
      [
        'referenced_ingest_outbox_missing_record',
        'present_ingest_outbox_missing_history_reference',
      ] as const
    ).entries()) {
      const corruptOutbox = seededOutbox(31_051 + offset, 'claimed');
      const corruptState = ingestPhaseRepository(31_051 + offset, corruptOutbox, 'active');
      corruptState.repository.corruptIngestClaimInvariantForTest(invariant);
      const corruptBefore = corruptState.repository.safeStateSummary();
      await expect(
        corruptState.repository.acknowledgeIngestOutbox(acknowledgeIngestInput(corruptOutbox)),
        `${invariant} acknowledgement`
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'ingest_outbox' });
      expect(corruptState.repository.safeStateSummary()).toEqual(corruptBefore);
      expect(corruptState.digestCalls()).toBe(0);
    }
  });

  it('R12 ingest acknowledgement races lifecycle transitions atomically', async () => {
    function markerAcknowledgementFor(
      outbox: MatrixCorpusIngestOutboxRecordV1,
      index: number
    ): AcknowledgeIngestOutboxInput {
      if (
        outbox.claim === null ||
        outbox.publisherReceiptDigest === null ||
        outbox.publishedAt === null
      )
        throw new Error('race fixture requires published recovery state');
      return acknowledgeIngestInput(outbox, {
        now: '2026-07-20T00:05:10.000Z',
        outcome: {
          kind: 'terminal_marker_acknowledged',
          publisherReceiptDigest: outbox.publisherReceiptDigest,
          publishedAt: outbox.publishedAt,
          terminalMarker: {
            kind: 'completed',
            digest: indexedDigest(361_000 + index),
            recordedAt: '2026-07-20T00:05:10.000Z',
          },
          replyOrDeliveryWorkInFlight: 0,
        },
      });
    }

    for (const acknowledgementFirst of [false, true]) {
      const index = acknowledgementFirst ? 31_101 : 31_100;
      const outbox = seededOutbox(index, 'published');
      const state = ingestPhaseRepository(index, outbox, 'active');
      const acknowledgement = markerAcknowledgementFor(outbox, index);
      const acknowledgementGate = state.repository.deferNextBeforeAdmission('acknowledge_ingest');
      const quiesceGate = state.repository.deferNextBeforeAdmission('quiesce');
      const pendingAcknowledgement = state.repository.acknowledgeIngestOutbox(acknowledgement);
      const pendingQuiesce = state.repository.quiesceRun(quiesceCommand());
      await acknowledgementGate.entered;
      await quiesceGate.entered;

      if (acknowledgementFirst) {
        acknowledgementGate.release();
        await expect(pendingAcknowledgement).resolves.toMatchObject({
          code: 'OUTBOX_ACKNOWLEDGED',
          drained: false,
        });
        quiesceGate.release();
        await expect(pendingQuiesce).resolves.toMatchObject({ code: 'QUIESCED', drained: true });
      } else {
        quiesceGate.release();
        await expect(pendingQuiesce).resolves.toMatchObject({ code: 'QUIESCED', drained: false });
        acknowledgementGate.release();
        await expect(pendingAcknowledgement).resolves.toMatchObject({
          code: 'OUTBOX_ACKNOWLEDGED',
          drained: true,
        });
      }

      expect(state.repository.safeStateSummary()).toMatchObject({
        current: [
          {
            lease: {
              phase: 'quiescing',
              nonterminalIngestOutboxIds: [],
              drain: {
                consumedCapabilityCount: 1,
                terminalIntexMarkerCount: 1,
                terminalOutboxCount: 1,
                replyOrDeliveryWorkInFlight: 0,
                drained: true,
              },
            },
          },
        ],
        ingestOutboxes: [
          {
            status: 'published',
            terminalMarker: acknowledgement.outcome.kind === 'terminal_marker_acknowledged'
              ? acknowledgement.outcome.terminalMarker
              : null,
          },
        ],
      });
      expect(state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 1,
        commits: 1,
      });
      expect(state.repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 1 });
    }

    for (const acknowledgementFirst of [false, true]) {
      const index = acknowledgementFirst ? 31_111 : 31_110;
      const outbox = seededOutbox(index, 'published');
      const state = ingestPhaseRepository(index, outbox, 'active');
      const acknowledgement = markerAcknowledgementFor(outbox, index);
      const acknowledgementGate = state.repository.deferNextBeforeAdmission('acknowledge_ingest');
      const abandonGate = state.repository.deferNextBeforeAdmission('abandon');
      const pendingAcknowledgement = state.repository.acknowledgeIngestOutbox(acknowledgement);
      const pendingAbandon = state.repository.abandonExpiredRun(abandonCommand());
      await acknowledgementGate.entered;
      await abandonGate.entered;

      if (acknowledgementFirst) {
        acknowledgementGate.release();
        await expect(pendingAcknowledgement).resolves.toMatchObject({
          code: 'OUTBOX_ACKNOWLEDGED',
          drained: false,
        });
        abandonGate.release();
        await expect(pendingAbandon).resolves.toMatchObject({ code: 'ABANDON_PENDING' });
      } else {
        abandonGate.release();
        await expect(pendingAbandon).resolves.toMatchObject({ code: 'ABANDON_PENDING' });
        acknowledgementGate.release();
        await expect(pendingAcknowledgement).resolves.toMatchObject({
          code: 'OUTBOX_ACKNOWLEDGED',
          drained: false,
        });
      }

      expect(state.repository.safeStateSummary()).toMatchObject({
        current: [
          {
            lease: {
              phase: 'abandon_pending',
              nonterminalIngestOutboxIds: [],
              terminalControlOutboxIds: ['terminal_abandoned'],
              drain: {
                consumedCapabilityCount: 1,
                terminalIntexMarkerCount: 1,
                terminalOutboxCount: 1,
                replyOrDeliveryWorkInFlight: 0,
                drained: false,
              },
            },
          },
        ],
        ingestOutboxes: [
          {
            status: 'published',
            terminalMarker: acknowledgement.outcome.kind === 'terminal_marker_acknowledged'
              ? acknowledgement.outcome.terminalMarker
              : null,
          },
        ],
        terminalControlOutboxes: [
          { terminalControlId: 'terminal_abandoned', kind: 'abandoned', status: 'pending' },
        ],
      });
      expect(state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 1,
        commits: 1,
      });
      expect(state.repository.operationCounts('abandon')).toEqual({ invocations: 1, commits: 1 });
    }
  });

  it('R17 ingest acknowledgement draft faults are atomic', async () => {
    function publicationFixture(index: number): Readonly<{
      state: ReturnType<typeof ingestPhaseRepository>;
      command: AcknowledgeIngestOutboxInput;
    }> {
      const outbox = seededOutbox(index, 'claimed');
      return {
        state: ingestPhaseRepository(index, outbox, 'active'),
        command: acknowledgeIngestInput(outbox, {
          outcome: {
            kind: 'publication_acknowledged',
            publisherReceiptDigest: indexedDigest(362_000 + index),
            publishedAt: '2026-07-20T00:00:10.000Z',
          },
        }),
      };
    }

    function markerFixture(index: number): Readonly<{
      state: ReturnType<typeof ingestPhaseRepository>;
      command: AcknowledgeIngestOutboxInput;
    }> {
      const outbox = seededOutbox(index, 'published');
      if (outbox.publisherReceiptDigest === null || outbox.publishedAt === null)
        throw new Error('marker fault fixture requires publication proof');
      return {
        state: ingestPhaseRepository(index, outbox, 'quiescing'),
        command: acknowledgeIngestInput(outbox, {
          now: '2026-07-20T00:05:10.000Z',
          outcome: {
            kind: 'terminal_marker_acknowledged',
            publisherReceiptDigest: outbox.publisherReceiptDigest,
            publishedAt: outbox.publishedAt,
            terminalMarker: {
              kind: 'completed',
              digest: indexedDigest(363_000 + index),
              recordedAt: '2026-07-20T00:05:10.000Z',
            },
            replyOrDeliveryWorkInFlight: 0,
          },
        }),
      };
    }

    function closureFixture(index: number): Readonly<{
      state: ReturnType<typeof ingestPhaseRepository>;
      command: AcknowledgeIngestOutboxInput;
    }> {
      const outbox = seededOutbox(index, 'claimed');
      return {
        state: ingestPhaseRepository(index, outbox, 'quiescing'),
        command: acknowledgeIngestInput(outbox, {
          outcome: {
            kind: 'claimed_not_published_closed',
            reason: 'quiesced',
            closedAt: '2026-07-20T00:00:10.000Z',
          },
        }),
      };
    }

    const publicationFault = publicationFixture(31_200);
    const publicationBefore = publicationFault.state.repository.safeStateSummary();
    publicationFault.state.repository.failNextAt('acknowledge_ingest_after_outbox_draft');
    await expect(
      publicationFault.state.repository.acknowledgeIngestOutbox(publicationFault.command)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    expect(publicationFault.state.repository.safeStateSummary()).toEqual(publicationBefore);
    expect(publicationFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
      invocations: 1,
      commits: 0,
    });
    await expect(
      publicationFault.state.repository.acknowledgeIngestOutbox(publicationFault.command)
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', drained: false });
    expect(publicationFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
      invocations: 2,
      commits: 1,
    });

    for (const [offset, stage] of (
      [
        'acknowledge_ingest_after_outbox_draft',
        'acknowledge_ingest_after_lease_pair_draft',
      ] as const
    ).entries()) {
      const markerFault = markerFixture(31_210 + offset);
      const before = markerFault.state.repository.safeStateSummary();
      markerFault.state.repository.failNextAt(stage);
      await expect(
        markerFault.state.repository.acknowledgeIngestOutbox(markerFault.command),
        `marker fault at ${stage}`
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(markerFault.state.repository.safeStateSummary()).toEqual(before);
      expect(markerFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 1,
        commits: 0,
      });
      await expect(
        markerFault.state.repository.acknowledgeIngestOutbox(markerFault.command)
      ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', drained: true });
      expect(markerFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 2,
        commits: 1,
      });
    }

    for (const [offset, stage] of (
      [
        'acknowledge_ingest_after_outbox_draft',
        'acknowledge_ingest_after_lease_pair_draft',
      ] as const
    ).entries()) {
      const closureFault = closureFixture(31_220 + offset);
      const before = closureFault.state.repository.safeStateSummary();
      closureFault.state.repository.failNextAt(stage);
      await expect(
        closureFault.state.repository.acknowledgeIngestOutbox(closureFault.command),
        `closure fault at ${stage}`
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(closureFault.state.repository.safeStateSummary()).toEqual(before);
      expect(closureFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 1,
        commits: 0,
      });
      await expect(
        closureFault.state.repository.acknowledgeIngestOutbox(closureFault.command)
      ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', drained: false });
      expect(closureFault.state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 2,
        commits: 1,
      });
    }

    const responseLossFixtures = [
      publicationFixture(31_230),
      markerFixture(31_231),
      closureFixture(31_232),
    ];
    for (const fixture of responseLossFixtures) {
      fixture.state.repository.loseNextResponseAfterCommit('acknowledge_ingest');
      await expect(
        fixture.state.repository.acknowledgeIngestOutbox(fixture.command)
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      const committed = fixture.state.repository.safeStateSummary();
      await expect(
        fixture.state.repository.acknowledgeIngestOutbox({
          ...fixture.command,
          now: '2026-07-20T00:10:10.000Z',
        })
      ).resolves.toMatchObject({
        code: 'ALREADY_APPLIED',
        operation: 'acknowledge_ingest',
        outcome: fixture.command.outcome,
      });
      expect(fixture.state.repository.safeStateSummary()).toEqual(committed);
      expect(fixture.state.repository.operationCounts('acknowledge_ingest')).toEqual({
        invocations: 2,
        commits: 1,
      });
      expect(fixture.state.digestCalls()).toBe(0);
    }

    const unreachablePairFault = publicationFixture(31_240);
    unreachablePairFault.state.repository.failNextAt('acknowledge_ingest_after_lease_pair_draft');
    await expect(
      unreachablePairFault.state.repository.acknowledgeIngestOutbox(unreachablePairFault.command)
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', drained: false });
    const publicationOutcome = unreachablePairFault.command.outcome;
    if (publicationOutcome.kind !== 'publication_acknowledged')
      throw new Error('publication fault fixture requires publication outcome');
    const source = seededOutbox(31_240, 'claimed');
    if (source.claim === null) throw new Error('publication fault fixture requires a claim');
    const published = {
      ...source,
      status: 'published',
      claim: { ...source.claim, purpose: 'terminal_marker_recovery' },
      publisherReceiptDigest: publicationOutcome.publisherReceiptDigest,
      publishedAt: publicationOutcome.publishedAt,
      acknowledgementReceipts: [
        {
          version: 1,
          ownerDigest: unreachablePairFault.command.ownerDigest,
          claimPurpose: 'publish',
          expectedClaimExpiresAt: unreachablePairFault.command.expectedClaimExpiresAt,
          outcome: publicationOutcome,
          acknowledgedAt: publicationOutcome.publishedAt,
          drained: false,
        },
      ],
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    const markerAfterPublication = acknowledgeIngestInput(published, {
      now: '2026-07-20T00:00:11.000Z',
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: publicationOutcome.publisherReceiptDigest,
        publishedAt: publicationOutcome.publishedAt,
        terminalMarker: {
          kind: 'completed',
          digest: indexedDigest(363_240),
          recordedAt: '2026-07-20T00:00:11.000Z',
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
    const afterPublication = unreachablePairFault.state.repository.safeStateSummary();
    await expect(
      unreachablePairFault.state.repository.acknowledgeIngestOutbox(markerAfterPublication)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    expect(unreachablePairFault.state.repository.safeStateSummary()).toEqual(afterPublication);
    await expect(
      unreachablePairFault.state.repository.acknowledgeIngestOutbox(markerAfterPublication)
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED' });
  });

  it('R20 terminal claim and renewal recovery is phase-safe', async () => {
    const pendingSeed = releasePendingSeed('pending');
    const pendingRelease = pendingSeed.terminalControlOutboxes[0];
    if (pendingRelease === undefined) throw new Error('terminal claim fixture requires a release');
    let digestCalls = 0;
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    repository.seedValidLifecycleState(pendingSeed);
    const claim = claimTerminalInput(pendingRelease);

    await expect(repository.claimPendingTerminalControlOutbox(claim)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      outboxKind: 'terminal',
      terminalControlId: pendingRelease.terminalControlId,
      eventId: pendingRelease.eventId,
      runId: pendingRelease.runId,
      leaseFence: pendingRelease.leaseFence,
      ownerDigest: claim.ownerDigest,
      claimExpiresAt: claim.claimExpiresAt,
      payload: pendingRelease.payload,
      payloadDigest: pendingRelease.payloadDigest,
    });
    const claimedState = repository.safeStateSummary();
    expect(claimedState.terminalControlOutboxes[0]).toMatchObject({
      status: 'claimed',
      claim: {
        ownerDigest: claim.ownerDigest,
        purpose: 'publish',
        claimedAt: claim.now,
        expiresAt: claim.claimExpiresAt,
      },
      lastClaimRenewal: null,
    });
    await expect(
      repository.claimPendingTerminalControlOutbox({
        ...claim,
        now: '2026-07-20T00:00:11.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'claim_terminal',
      ownerDigest: claim.ownerDigest,
      claimExpiresAt: claim.claimExpiresAt,
    });
    await expect(
      repository.claimPendingTerminalControlOutbox({
        ...claim,
        now: '2026-07-20T00:00:11.000Z',
        claimExpiresAt: '2026-07-20T00:05:11.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(repository.safeStateSummary()).toEqual(claimedState);
    expect(repository.operationCounts('claim_terminal')).toEqual({ invocations: 3, commits: 1 });
    expect(digestCalls).toBe(0);

    const expiryBoundarySeed = releasePendingSeed('pending');
    const expiryBoundaryRelease = expiryBoundarySeed.terminalControlOutboxes[0];
    if (expiryBoundaryRelease === undefined)
      throw new Error('terminal expiry fixture requires a release');
    const expiryBoundary = terminalState(expiryBoundarySeed);
    await expect(
      expiryBoundary.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(expiryBoundaryRelease, {
          now: '2026-07-20T00:01:00.000Z',
          claimExpiresAt: '2026-07-20T00:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    expect(expiryBoundary.repository.operationCounts('claim_terminal')).toEqual({
      invocations: 1,
      commits: 0,
    });

    const expiredReleaseSeed = releasePendingSeed('claimed');
    const claimedRelease = expiredReleaseSeed.terminalControlOutboxes[0];
    if (claimedRelease?.claim === null || claimedRelease === undefined)
      throw new Error('terminal takeover fixture requires a claimed release');
    const expiredRelease = {
      ...claimedRelease,
      claim: { ...claimedRelease.claim, expiresAt: '2026-07-20T00:00:10.000Z' },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const takeoverState = terminalState(replaceTerminalOutbox(expiredReleaseSeed, expiredRelease));
    const takeover = claimTerminalInput(expiredRelease, {
      ownerDigest: indexedDigest(370_001),
      now: '2026-07-20T00:00:10.000Z',
      claimExpiresAt: '2026-07-20T00:05:10.000Z',
    });
    await expect(takeoverState.repository.claimPendingTerminalControlOutbox(takeover)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      ownerDigest: takeover.ownerDigest,
      claimExpiresAt: takeover.claimExpiresAt,
    });
    expect(takeoverState.repository.safeStateSummary().terminalControlOutboxes[0]).toMatchObject({
      status: 'claimed',
      claim: {
        ownerDigest: takeover.ownerDigest,
        purpose: 'publish',
        claimedAt: takeover.now,
        expiresAt: takeover.claimExpiresAt,
      },
      lastClaimRenewal: null,
    });

    const liveClaimSeed = releasePendingSeed('claimed');
    const liveClaim = liveClaimSeed.terminalControlOutboxes[0];
    if (liveClaim === undefined) throw new Error('terminal live-claim fixture requires a release');
    const liveClaimState = terminalState(liveClaimSeed);
    if (liveClaim.claim === null) throw new Error('terminal live-claim fixture requires claim data');
    await expect(
      liveClaimState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(liveClaim, {
          ownerDigest: liveClaim.claim.ownerDigest,
          now: '2026-07-20T00:01:00.000Z',
          claimExpiresAt: liveClaim.claim.expiresAt,
        })
      )
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'claim_terminal',
      ownerDigest: liveClaim.claim.ownerDigest,
      claimExpiresAt: liveClaim.claim.expiresAt,
    });
    await expect(
      liveClaimState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(liveClaim, { ownerDigest: indexedDigest(370_002) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    const abandonSeed = abandonWithExpiredReleaseSeed();
    const pendingAbandoned = abandonSeed.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'abandoned'
    );
    if (pendingAbandoned === undefined)
      throw new Error('terminal abandonment fixture requires an abandoned intent');
    const abandonedClaimState = terminalState(abandonSeed);
    const abandonedClaim = claimTerminalInput(pendingAbandoned, {
      now: '2026-07-20T00:01:10.000Z',
      claimExpiresAt: '2026-07-20T00:06:10.000Z',
    });
    const abandonedClaimResult = await abandonedClaimState.repository.claimPendingTerminalControlOutbox(
      abandonedClaim
    );
    expect(abandonedClaimResult).toMatchObject({
      code: 'OUTBOX_CLAIMED',
      terminalControlId: pendingAbandoned.terminalControlId,
      ownerDigest: abandonedClaim.ownerDigest,
    });
    expect('terminalWinner' in abandonedClaimResult).toBe(false);

    const expiredAbandoned = {
      ...pendingAbandoned,
      status: 'claimed',
      claim: {
        ownerDigest: indexedDigest(370_007),
        purpose: 'publish',
        claimedAt: '2026-07-20T00:01:00.000Z',
        expiresAt: '2026-07-20T00:01:10.000Z',
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const abandonedTakeoverState = terminalState(
      replaceTerminalOutbox(abandonSeed, expiredAbandoned)
    );
    const abandonedTakeover = claimTerminalInput(expiredAbandoned, {
      ownerDigest: indexedDigest(370_008),
      now: expiredAbandoned.claim.expiresAt,
      claimExpiresAt: '2026-07-20T00:06:10.000Z',
    });
    await expect(
      abandonedTakeoverState.repository.claimPendingTerminalControlOutbox(abandonedTakeover)
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      terminalControlId: expiredAbandoned.terminalControlId,
      ownerDigest: abandonedTakeover.ownerDigest,
    });

    const retainedReleaseSeed = replaceTerminalOutbox(abandonSeed, claimedRelease);
    const retainedReleaseState = terminalState(retainedReleaseSeed);
    const retainedTakeover = claimTerminalInput(claimedRelease, {
      ownerDigest: indexedDigest(370_003),
      now: claimedRelease.claim.expiresAt,
      claimExpiresAt: '2026-07-20T00:10:05.000Z',
    });
    await expect(
      retainedReleaseState.repository.claimPendingTerminalControlOutbox(retainedTakeover)
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIMED',
      ownerDigest: retainedTakeover.ownerDigest,
      claimExpiresAt: retainedTakeover.claimExpiresAt,
    });

    const renewalSeed = releasePendingSeed('claimed');
    const renewableRelease = renewalSeed.terminalControlOutboxes[0];
    if (renewableRelease?.claim === null || renewableRelease === undefined)
      throw new Error('terminal renewal fixture requires a release');
    const renewalState = terminalState(renewalSeed);
    const renewalA = renewTerminalInput(renewableRelease);
    await expect(renewalState.repository.renewTerminalControlOutboxClaim(renewalA)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      outboxKind: 'terminal',
      terminalControlId: renewableRelease.terminalControlId,
      eventId: renewableRelease.eventId,
      ownerDigest: renewalA.ownerDigest,
      previousClaimExpiresAt: renewalA.expectedClaimExpiresAt,
      claimExpiresAt: renewalA.newClaimExpiresAt,
    });
    const renewedA = {
      ...renewableRelease,
      claim: {
        ...renewableRelease.claim,
        claimedAt: renewalA.now,
        expiresAt: renewalA.newClaimExpiresAt,
      },
      lastClaimRenewal: {
        ownerDigest: renewalA.ownerDigest,
        previousClaimExpiresAt: renewalA.expectedClaimExpiresAt,
        claimExpiresAt: renewalA.newClaimExpiresAt,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const renewalB = renewTerminalInput(renewedA, {
      now: '2026-07-20T00:00:11.000Z',
      newClaimExpiresAt: '2026-07-20T00:05:11.000Z',
    });
    await expect(renewalState.repository.renewTerminalControlOutboxClaim(renewalB)).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      previousClaimExpiresAt: renewalB.expectedClaimExpiresAt,
      claimExpiresAt: renewalB.newClaimExpiresAt,
    });
    const afterRenewalB = renewalState.repository.safeStateSummary();
    expect(afterRenewalB.terminalControlOutboxes[0]).toMatchObject({
      claim: {
        ownerDigest: renewalB.ownerDigest,
        claimedAt: renewalB.now,
        expiresAt: renewalB.newClaimExpiresAt,
      },
      lastClaimRenewal: {
        ownerDigest: renewalB.ownerDigest,
        previousClaimExpiresAt: renewalB.expectedClaimExpiresAt,
        claimExpiresAt: renewalB.newClaimExpiresAt,
      },
    });
    await expect(
      renewalState.repository.renewTerminalControlOutboxClaim({
        ...renewalB,
        now: '2026-07-20T00:00:03.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew_claim',
      previousClaimExpiresAt: renewalB.expectedClaimExpiresAt,
      claimExpiresAt: renewalB.newClaimExpiresAt,
    });
    await expect(
      renewalState.repository.renewTerminalControlOutboxClaim({
        ...renewalA,
        now: '2026-07-20T00:00:12.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      renewalState.repository.renewTerminalControlOutboxClaim({
        ...renewalB,
        now: '2026-07-20T00:00:12.000Z',
        newClaimExpiresAt: '2026-07-20T00:05:12.000Z',
      })
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(renewalState.repository.safeStateSummary()).toEqual(afterRenewalB);
    expect(renewalState.digestCalls()).toBe(0);

    const overBoundSeed = releasePendingSeed('claimed');
    const overBoundRelease = overBoundSeed.terminalControlOutboxes[0];
    if (overBoundRelease === undefined)
      throw new Error('terminal renewal bound fixture requires a release');
    const overBoundState = terminalState(overBoundSeed);
    await expect(
      overBoundState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(overBoundRelease, {
          newClaimExpiresAt: '2026-07-20T00:05:10.001Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(overBoundState.repository.operationCounts('renew_terminal_claim')).toEqual({
      invocations: 1,
      commits: 0,
    });
    await expect(
      overBoundState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(overBoundRelease, {
          newClaimExpiresAt: overBoundRelease.claim?.expiresAt ?? timestamp,
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });

    const backdatedSeed = releasePendingSeed('claimed');
    const backdatedReleaseBase = backdatedSeed.terminalControlOutboxes[0];
    if (backdatedReleaseBase?.claim === null || backdatedReleaseBase === undefined)
      throw new Error('terminal backdated fixture requires a claimed release');
    const backdatedRelease = {
      ...backdatedReleaseBase,
      claim: {
        ...backdatedReleaseBase.claim,
        claimedAt: '2026-07-20T00:00:10.000Z',
        expiresAt: '2026-07-20T00:04:10.000Z',
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const backdatedRenewalState = terminalState(
      replaceTerminalOutbox(backdatedSeed, backdatedRelease)
    );
    await expect(
      backdatedRenewalState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(backdatedRelease, {
          now: '2026-07-20T00:00:09.000Z',
          newClaimExpiresAt: '2026-07-20T00:04:11.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    const expiredRenewalSeed = releasePendingSeed('claimed');
    const expiredRenewalRelease = expiredRenewalSeed.terminalControlOutboxes[0];
    if (expiredRenewalRelease === undefined)
      throw new Error('terminal expired-renewal fixture requires a release');
    const expiredRenewalState = terminalState(expiredRenewalSeed);
    await expect(
      expiredRenewalState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(expiredRenewalRelease, {
          now: '2026-07-20T00:01:00.000Z',
          newClaimExpiresAt: '2026-07-20T00:06:00.000Z',
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });

    const claimedAbandoned = {
      ...pendingAbandoned,
      status: 'claimed',
      claim: {
        ownerDigest: abandonedClaim.ownerDigest,
        purpose: 'publish',
        claimedAt: abandonedClaim.now,
        expiresAt: abandonedClaim.claimExpiresAt,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const abandonedRenewal = renewTerminalInput(claimedAbandoned, {
      now: '2026-07-20T00:01:11.000Z',
      newClaimExpiresAt: '2026-07-20T00:06:11.000Z',
    });
    const abandonedRenewalResult = await abandonedClaimState.repository.renewTerminalControlOutboxClaim(
      abandonedRenewal
    );
    expect(abandonedRenewalResult).toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      terminalControlId: pendingAbandoned.terminalControlId,
      claimExpiresAt: abandonedRenewal.newClaimExpiresAt,
    });
    expect('terminalWinner' in abandonedRenewalResult).toBe(false);

    const closedRelease = abandonSeed.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'release'
    );
    if (closedRelease === undefined) throw new Error('terminal closure fixture requires a release');
    const closedState = terminalState(abandonSeed);
    await expect(
      closedState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(closedRelease, {
          now: '2026-07-20T00:01:10.000Z',
          claimExpiresAt: '2026-07-20T00:06:10.000Z',
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });
    await expect(
      closedState.repository.renewTerminalControlOutboxClaim({
        runtimeAudience: 'hetzner-prod',
        runId: closedRelease.runId,
        userId: closedRelease.userId,
        leaseFence: closedRelease.leaseFence,
        leaseSlotDigest: digest,
        runFenceDigest: 'b'.repeat(64),
        terminalControlId: closedRelease.terminalControlId,
        eventId: closedRelease.eventId,
        payloadDigest: closedRelease.payloadDigest,
        ownerDigest: indexedDigest(370_004),
        now: '2026-07-20T00:01:10.000Z',
        expectedClaimExpiresAt: '2026-07-20T00:05:10.000Z',
        newClaimExpiresAt: '2026-07-20T00:06:10.000Z',
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });

    const finalIndex = 31_300;
    const finalIngest = seededOutbox(finalIndex, 'closed');
    const finalState = ingestPhaseRepository(finalIndex, finalIngest, 'abandoned');
    const finalTerminalId = `terminal_abandoned_${String(finalIndex)}`;
    const finalTerminal = {
      ...abandonedTerminalOutbox(finalTerminalId, '2026-07-20T00:01:00.000Z'),
      status: 'published',
      claim: {
        ownerDigest: indexedDigest(340_000 + finalIndex),
        purpose: 'publish',
        claimedAt: '2026-07-20T00:01:00.000Z',
        expiresAt: '2026-07-20T00:06:00.000Z',
      },
      acknowledgedAt: '2026-07-20T00:01:00.000Z',
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    await expect(
      finalState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(finalTerminal, {
          ownerDigest: finalTerminal.claim.ownerDigest,
          now: '2026-07-20T00:01:01.000Z',
          claimExpiresAt: finalTerminal.claim.expiresAt,
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });
    await expect(
      finalState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(finalTerminal, {
          now: '2026-07-20T00:01:01.000Z',
          newClaimExpiresAt: '2026-07-20T00:06:01.000Z',
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });
    expect(finalState.digestCalls()).toBe(0);

    const losingReleaseSeed = releasePendingSeed('claimed');
    const losingReleaseBase = losingReleaseSeed.terminalControlOutboxes[0];
    if (losingReleaseBase?.claim === null || losingReleaseBase === undefined)
      throw new Error('final losing-row fixture requires a claimed release');
    const losingReleaseClaim = losingReleaseBase.claim;
    const losingRelease = {
      ...losingReleaseBase,
      lastClaimRenewal: {
        ownerDigest: losingReleaseClaim.ownerDigest,
        previousClaimExpiresAt: '2026-07-20T00:05:00.000Z',
        claimExpiresAt: losingReleaseClaim.expiresAt,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const finalAcknowledgedAt = '2026-07-20T00:01:00.000Z';
    const winningAbandonedBase = abandonedTerminalOutbox('terminal_abandoned', finalAcknowledgedAt);
    const winningAbandoned = {
      ...winningAbandonedBase,
      status: 'published',
      claim: {
        ownerDigest: indexedDigest(370_009),
        purpose: 'publish',
        claimedAt: finalAcknowledgedAt,
        expiresAt: '2026-07-20T00:06:00.000Z',
      },
      acknowledgedAt: finalAcknowledgedAt,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const finalCurrent = {
      ...losingReleaseSeed.pair.current,
      phase: 'abandoned',
      terminalControlOutboxIds: [losingRelease.terminalControlId, winningAbandoned.terminalControlId],
      terminalWinner: {
        kind: 'abandoned',
        eventId: winningAbandoned.eventId,
        payloadDigest: winningAbandoned.payloadDigest,
        outcome: 'provisioning_noop',
        acknowledgedAt: finalAcknowledgedAt,
      },
      releasedAt: null,
      abandonedAt: finalAcknowledgedAt,
      drain: { ...losingReleaseSeed.pair.current.drain, drained: false },
    } satisfies MatrixCorpusLeaseV1;
    const finalLosingPair = {
      leaseSlotDigest: losingReleaseSeed.pair.leaseSlotDigest,
      current: finalCurrent,
      history: {
        ...finalCurrent,
        leaseSlotDigest: losingReleaseSeed.pair.leaseSlotDigest,
      },
    } satisfies MatrixCorpusCurrentLeaseHistoryPairV1;
    let finalLosingDigestCalls = 0;
    const finalLosingRepository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((finalLosingDigestCalls += 1), digest) },
    });
    finalLosingRepository.seedValidCleanupOutboxState({
      currentPair: finalLosingPair,
      retainedHistories: [],
      renewReceipts: losingReleaseSeed.renewReceipts.map((receipt) => ({
        runFenceDigest: finalLosingPair.history.runFenceDigest,
        receipt,
      })),
      issuanceReceipts: losingReleaseSeed.issuanceReceipts.map((receipt) => ({
        runFenceDigest: finalLosingPair.history.runFenceDigest,
        receipt,
      })),
      capabilities: losingReleaseSeed.capabilities,
      transportReceipts: losingReleaseSeed.transportReceipts,
      ingestOutboxes: losingReleaseSeed.ingestOutboxes,
      terminalControlOutboxes: [losingRelease, winningAbandoned],
    });
    await expect(
      finalLosingRepository.claimPendingTerminalControlOutbox(
        claimTerminalInput(losingRelease, {
          ownerDigest: losingReleaseClaim.ownerDigest,
          claimExpiresAt: losingReleaseClaim.expiresAt,
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });
    await expect(
      finalLosingRepository.renewTerminalControlOutboxClaim(
        renewTerminalInput(losingRelease, {
          ownerDigest: losingRelease.lastClaimRenewal.ownerDigest,
          now: '2026-07-20T00:00:03.000Z',
          expectedClaimExpiresAt: losingRelease.lastClaimRenewal.previousClaimExpiresAt,
          newClaimExpiresAt: losingRelease.lastClaimRenewal.claimExpiresAt,
        })
      )
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandoned' });
    await expect(
      finalLosingRepository.claimPendingTerminalControlOutbox(
        claimTerminalInput(losingRelease, {
          terminalControlId: 'terminal_missing',
          eventId: 'terminal_missing',
        })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      finalLosingRepository.renewTerminalControlOutboxClaim(
        renewTerminalInput(losingRelease, {
          terminalControlId: 'terminal_missing',
          eventId: 'terminal_missing',
        })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      finalLosingRepository.claimPendingTerminalControlOutbox(
        claimTerminalInput(losingRelease, { payloadDigest: indexedDigest(370_010) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      finalLosingRepository.renewTerminalControlOutboxClaim(
        renewTerminalInput(losingRelease, { payloadDigest: indexedDigest(370_011) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(finalLosingDigestCalls).toBe(0);

    const invalidClaimState = terminalState(releasePendingSeed('pending'));
    await expect(
      invalidClaimState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(pendingRelease, {
          claimExpiresAt: '2026-07-20T00:00:10.000Z',
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      invalidClaimState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(pendingRelease, {
          claimExpiresAt: '2026-07-20T00:05:10.001Z',
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    expect(invalidClaimState.repository.operationCounts('claim_terminal')).toEqual({
      invocations: 2,
      commits: 0,
    });

    const missingState = terminalState(releasePendingSeed('claimed'));
    await expect(
      missingState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(claimedRelease, {
          terminalControlId: 'terminal_missing',
          eventId: 'terminal_missing',
        })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      missingState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(claimedRelease, {
          terminalControlId: 'terminal_missing',
          eventId: 'terminal_missing',
        })
      )
    ).resolves.toEqual({ code: 'NOT_FOUND' });
    await expect(
      missingState.repository.claimPendingTerminalControlOutbox(
        claimTerminalInput(claimedRelease, { payloadDigest: indexedDigest(370_005) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    await expect(
      missingState.repository.renewTerminalControlOutboxClaim(
        renewTerminalInput(claimedRelease, { payloadDigest: indexedDigest(370_006) })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });

    for (const invariant of [
      'referenced_terminal_outbox_missing_record',
      'present_terminal_outbox_missing_history_reference',
    ] as const) {
      const corruptState = terminalState(releasePendingSeed('claimed'));
      corruptState.repository.corruptTerminalClaimInvariantForTest(invariant);
      const corruptBefore = corruptState.repository.safeStateSummary();
      await expect(
        corruptState.repository.claimPendingTerminalControlOutbox(claimTerminalInput(claimedRelease)),
        `${invariant} claim`
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
      await expect(
        corruptState.repository.renewTerminalControlOutboxClaim(renewTerminalInput(claimedRelease)),
        `${invariant} renewal`
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
      expect(corruptState.repository.safeStateSummary()).toEqual(corruptBefore);
      expect(corruptState.repository.operationCounts('claim_terminal')).toEqual({
        invocations: 1,
        commits: 0,
      });
      expect(corruptState.repository.operationCounts('renew_terminal_claim')).toEqual({
        invocations: 1,
        commits: 0,
      });
      expect(corruptState.digestCalls()).toBe(0);
    }
  });

  it('R17 terminal claim drafts are atomic', async () => {
    const claimFaultSeed = releasePendingSeed('pending');
    const claimFaultOutbox = claimFaultSeed.terminalControlOutboxes[0];
    if (claimFaultOutbox === undefined)
      throw new Error('terminal claim fault fixture requires a release');
    const claimFault = terminalState(claimFaultSeed);
    const claimCommand = claimTerminalInput(claimFaultOutbox);
    const beforeClaimFault = claimFault.repository.safeStateSummary();
    claimFault.repository.failNextAt('claim_terminal_after_outbox_draft');
    await expect(
      claimFault.repository.claimPendingTerminalControlOutbox(claimCommand)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    expect(claimFault.repository.safeStateSummary()).toEqual(beforeClaimFault);
    expect(claimFault.repository.operationCounts('claim_terminal')).toEqual({
      invocations: 1,
      commits: 0,
    });
    await expect(
      claimFault.repository.claimPendingTerminalControlOutbox(claimCommand)
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIMED', ownerDigest: claimCommand.ownerDigest });
    expect(claimFault.repository.operationCounts('claim_terminal')).toEqual({
      invocations: 2,
      commits: 1,
    });

    const claimLossSeed = releasePendingSeed('pending');
    const claimLossOutbox = claimLossSeed.terminalControlOutboxes[0];
    if (claimLossOutbox === undefined)
      throw new Error('terminal claim response-loss fixture requires a release');
    const claimLoss = terminalState(claimLossSeed);
    const claimLossCommand = claimTerminalInput(claimLossOutbox);
    claimLoss.repository.loseNextResponseAfterCommit('claim_terminal');
    await expect(
      claimLoss.repository.claimPendingTerminalControlOutbox(claimLossCommand)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const committedClaim = claimLoss.repository.safeStateSummary();
    await expect(
      claimLoss.repository.claimPendingTerminalControlOutbox({
        ...claimLossCommand,
        now: '2026-07-20T00:00:11.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'claim_terminal',
      ownerDigest: claimLossCommand.ownerDigest,
      claimExpiresAt: claimLossCommand.claimExpiresAt,
    });
    expect(claimLoss.repository.safeStateSummary()).toEqual(committedClaim);
    expect(claimLoss.repository.operationCounts('claim_terminal')).toEqual({
      invocations: 2,
      commits: 1,
    });

    const renewalFaultSeed = releasePendingSeed('claimed');
    const renewalFaultOutbox = renewalFaultSeed.terminalControlOutboxes[0];
    if (renewalFaultOutbox === undefined)
      throw new Error('terminal renewal fault fixture requires a release');
    const renewalFault = terminalState(renewalFaultSeed);
    const renewalCommand = renewTerminalInput(renewalFaultOutbox);
    const beforeRenewalFault = renewalFault.repository.safeStateSummary();
    renewalFault.repository.failNextAt('renew_terminal_claim_after_outbox_draft');
    await expect(
      renewalFault.repository.renewTerminalControlOutboxClaim(renewalCommand)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    expect(renewalFault.repository.safeStateSummary()).toEqual(beforeRenewalFault);
    expect(renewalFault.repository.operationCounts('renew_terminal_claim')).toEqual({
      invocations: 1,
      commits: 0,
    });
    await expect(
      renewalFault.repository.renewTerminalControlOutboxClaim(renewalCommand)
    ).resolves.toMatchObject({
      code: 'OUTBOX_CLAIM_RENEWED',
      claimExpiresAt: renewalCommand.newClaimExpiresAt,
    });
    expect(renewalFault.repository.operationCounts('renew_terminal_claim')).toEqual({
      invocations: 2,
      commits: 1,
    });

    const renewalLossSeed = releasePendingSeed('claimed');
    const renewalLossOutbox = renewalLossSeed.terminalControlOutboxes[0];
    if (renewalLossOutbox === undefined)
      throw new Error('terminal renewal response-loss fixture requires a release');
    const renewalLoss = terminalState(renewalLossSeed);
    const renewalLossCommand = renewTerminalInput(renewalLossOutbox);
    renewalLoss.repository.loseNextResponseAfterCommit('renew_terminal_claim');
    await expect(
      renewalLoss.repository.renewTerminalControlOutboxClaim(renewalLossCommand)
    ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const committedRenewal = renewalLoss.repository.safeStateSummary();
    await expect(
      renewalLoss.repository.renewTerminalControlOutboxClaim({
        ...renewalLossCommand,
        now: '2026-07-20T00:00:03.000Z',
      })
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'renew_claim',
      previousClaimExpiresAt: renewalLossCommand.expectedClaimExpiresAt,
      claimExpiresAt: renewalLossCommand.newClaimExpiresAt,
    });
    expect(renewalLoss.repository.safeStateSummary()).toEqual(committedRenewal);
    expect(renewalLoss.repository.operationCounts('renew_terminal_claim')).toEqual({
      invocations: 2,
      commits: 1,
    });

    for (const firstOwnerWins of [true, false]) {
      const takeoverSeed = releasePendingSeed('claimed');
      const takeoverBase = takeoverSeed.terminalControlOutboxes[0];
      if (takeoverBase?.claim === null || takeoverBase === undefined)
        throw new Error('terminal takeover race fixture requires a claimed release');
      const expired = {
        ...takeoverBase,
        claim: { ...takeoverBase.claim, expiresAt: '2026-07-20T00:00:10.000Z' },
      } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
      const race = terminalState(replaceTerminalOutbox(takeoverSeed, expired));
      const first = claimTerminalInput(expired, {
        ownerDigest: indexedDigest(371_000),
        now: '2026-07-20T00:00:10.000Z',
        claimExpiresAt: '2026-07-20T00:05:10.000Z',
      });
      const second = { ...first, ownerDigest: indexedDigest(371_001) };
      const firstGate = race.repository.deferNextBeforeAdmission('claim_terminal');
      const secondGate = race.repository.deferNextBeforeAdmission('claim_terminal');
      const firstAttempt = race.repository.claimPendingTerminalControlOutbox(first);
      const secondAttempt = race.repository.claimPendingTerminalControlOutbox(second);
      await firstGate.entered;
      await secondGate.entered;

      const winnerGate = firstOwnerWins ? firstGate : secondGate;
      const loserGate = firstOwnerWins ? secondGate : firstGate;
      const winnerAttempt = firstOwnerWins ? firstAttempt : secondAttempt;
      const loserAttempt = firstOwnerWins ? secondAttempt : firstAttempt;
      const expectedOwner = firstOwnerWins ? first.ownerDigest : second.ownerDigest;
      winnerGate.release();
      await expect(winnerAttempt).resolves.toMatchObject({
        code: 'OUTBOX_CLAIMED',
        ownerDigest: expectedOwner,
      });
      loserGate.release();
      await expect(loserAttempt).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      expect(race.repository.safeStateSummary().terminalControlOutboxes[0]).toMatchObject({
        status: 'claimed',
        claim: { ownerDigest: expectedOwner },
      });
      expect(race.repository.operationCounts('claim_terminal')).toEqual({
        invocations: 2,
        commits: 1,
      });
      expect(race.digestCalls()).toBe(0);
    }
  });

  it('R14a opposite-kind terminal acknowledgements converge on one winner', async () => {
    for (const winnerKind of ['release', 'abandoned'] as const) {
      const fixture = mixedClaimedTerminalSeed();
      const state = terminalState(fixture.seed);
      const winnerOutbox = winnerKind === 'release' ? fixture.release : fixture.abandoned;
      const firstRequest = winnerKind === 'release' ? fixture.abandoned : fixture.release;
      const winner = terminalWinnerFor(
        winnerOutbox,
        '2026-07-20T00:01:10.000Z',
        winnerKind === 'release' ? 'completed_passed' : 'provisioning_rolled_back'
      );
      const firstAcknowledgement = acknowledgeTerminalInput(firstRequest, winner);
      const firstProjection = {
        outboxKind: 'terminal' as const,
        requestTerminalControlId: firstRequest.terminalControlId,
        requestEventId: firstRequest.eventId,
        runId: firstRequest.runId,
        leaseFence: firstRequest.leaseFence,
        requestPayloadDigest: firstRequest.payloadDigest,
        authoritativeWinner: winner,
        leasePhase: winnerKind === 'release' ? ('released' as const) : ('abandoned' as const),
      };
      state.repository.loseNextResponseAfterCommit('acknowledge_terminal');
      await expect(
        state.repository.acknowledgeTerminalControl(firstAcknowledgement),
        `${firstRequest.kind} request with ${winnerKind} winner`
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      const afterFirst = state.repository.safeStateSummary();
      expect(afterFirst).toMatchObject({
        current: [
          {
            lease: {
              phase: winnerKind === 'release' ? 'released' : 'abandoned',
              terminalWinner: winner,
              releasedAt: winnerKind === 'release' ? winner.acknowledgedAt : null,
              abandonedAt: winnerKind === 'abandoned' ? winner.acknowledgedAt : null,
              drain: { drained: false },
            },
          },
        ],
        terminalControlOutboxes: expect.arrayContaining([
          expect.objectContaining({
            terminalControlId: firstRequest.terminalControlId,
            status: 'published',
            acknowledgedAt: winner.acknowledgedAt,
          }),
          expect.objectContaining({
            terminalControlId: winnerOutbox.terminalControlId,
            status: 'claimed',
            acknowledgedAt: null,
          }),
        ]),
      });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          now: '2026-07-20T00:10:10.000Z',
        })
      ).resolves.toEqual({
        code: 'ALREADY_APPLIED',
        operation: 'acknowledge_terminal',
        ...firstProjection,
      });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          now: '2026-07-20T00:00:01.000Z',
        })
      ).resolves.toEqual({
        code: 'ALREADY_APPLIED',
        operation: 'acknowledge_terminal',
        ...firstProjection,
      });

      const secondAcknowledgement = acknowledgeTerminalInput(winnerOutbox, winner, {
        now: '2026-07-20T00:01:11.000Z',
      });
      const secondProjection = {
        outboxKind: 'terminal' as const,
        requestTerminalControlId: winnerOutbox.terminalControlId,
        requestEventId: winnerOutbox.eventId,
        runId: winnerOutbox.runId,
        leaseFence: winnerOutbox.leaseFence,
        requestPayloadDigest: winnerOutbox.payloadDigest,
        authoritativeWinner: winner,
        leasePhase: winnerKind === 'release' ? ('released' as const) : ('abandoned' as const),
      };
      state.repository.loseNextResponseAfterCommit('acknowledge_terminal');
      await expect(
        state.repository.acknowledgeTerminalControl(secondAcknowledgement)
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      const afterSecond = state.repository.safeStateSummary();
      expect(afterSecond).toMatchObject({
        current: [{ lease: { terminalWinner: winner } }],
        terminalControlOutboxes: [
          expect.objectContaining({ status: 'published', acknowledgedAt: winner.acknowledgedAt }),
          expect.objectContaining({ status: 'published', acknowledgedAt: winner.acknowledgedAt }),
        ],
      });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...secondAcknowledgement,
          now: '2026-07-20T00:10:10.000Z',
        })
      ).resolves.toEqual({
        code: 'ALREADY_APPLIED',
        operation: 'acknowledge_terminal',
        ...secondProjection,
      });
      expect(state.repository.safeStateSummary()).toEqual(afterSecond);

      const changedWinner = {
        ...winner,
        payloadDigest: indexedDigest(372_001),
      } satisfies MatrixCorpusTerminalAuthoritativeWinnerV1;
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          authoritativeWinner: changedWinner,
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          requestPayloadDigest: indexedDigest(372_002),
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          ownerDigest: indexedDigest(372_003),
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          expectedClaimExpiresAt: '2026-07-20T00:05:04.000Z',
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      const changedOutcome = terminalWinnerFor(
        winnerOutbox,
        winner.acknowledgedAt,
        winnerKind === 'release' ? 'completed_failed' : 'provisioning_noop'
      );
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          authoritativeWinner: changedOutcome,
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      await expect(
        state.repository.acknowledgeTerminalControl({
          ...firstAcknowledgement,
          authoritativeWinner: {
            ...winner,
            acknowledgedAt: '2026-07-20T00:01:11.000Z',
          },
        })
      ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      expect(state.repository.safeStateSummary()).toEqual(afterSecond);
      expect(state.repository.operationCounts('acknowledge_terminal')).toEqual({
        invocations: 11,
        commits: 2,
      });
      expect(state.digestCalls()).toBe(0);
    }

    const backdatedFixture = mixedClaimedTerminalSeed();
    const backdatedState = terminalState(backdatedFixture.seed);
    const backdatedWinner = terminalWinnerFor(
      backdatedFixture.release,
      '2026-07-20T00:01:10.000Z'
    );
    const backdatedBefore = backdatedState.repository.safeStateSummary();
    await expect(
      backdatedState.repository.acknowledgeTerminalControl(
        acknowledgeTerminalInput(backdatedFixture.abandoned, backdatedWinner, {
          now: '2026-07-20T00:00:59.999Z',
        })
      )
    ).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
    expect(backdatedState.repository.safeStateSummary()).toEqual(backdatedBefore);

    for (const invariant of [
      'referenced_release_winner_missing_record',
      'release_winner_payload_digest_mismatch',
    ] as const) {
      const corruptFixture = mixedClaimedTerminalSeed();
      const corruptState = terminalState(corruptFixture.seed);
      const winner = terminalWinnerFor(
        corruptFixture.release,
        '2026-07-20T00:01:10.000Z'
      );
      corruptState.repository.corruptTerminalAcknowledgementInvariantForTest(invariant);
      const corruptBefore = corruptState.repository.safeStateSummary();
      await expect(
        corruptState.repository.acknowledgeTerminalControl(
          acknowledgeTerminalInput(corruptFixture.abandoned, winner)
        ),
        invariant
      ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
      expect(corruptState.repository.safeStateSummary()).toEqual(corruptBefore);
      expect(corruptState.repository.operationCounts('acknowledge_terminal')).toEqual({
        invocations: 1,
        commits: 0,
      });
      expect(corruptState.digestCalls()).toBe(0);
    }
  });

  it('R14/R20 terminal acknowledgement closes only safe losing intents', async () => {
    const pendingBase = abandonWithExpiredReleaseSeed();
    const pendingReleaseBase = pendingBase.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'release'
    );
    const pendingAbandonedBase = pendingBase.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'abandoned'
    );
    if (pendingReleaseBase === undefined || pendingAbandonedBase === undefined)
      throw new Error('pending loser fixture requires both terminal intents');
    const pendingRelease = {
      ...pendingReleaseBase,
      status: 'pending',
      claim: null,
      closedReason: null,
      closedAt: null,
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const pendingAbandoned = {
      ...pendingAbandonedBase,
      status: 'claimed',
      claim: {
        ownerDigest: indexedDigest(373_000),
        purpose: 'publish',
        claimedAt: '2026-07-20T00:01:00.000Z',
        expiresAt: '2026-07-20T00:06:00.000Z',
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const pendingSeed = {
      ...pendingBase,
      terminalControlOutboxes: [pendingAbandoned, pendingRelease],
    } satisfies FakeMatrixCorpusLifecycleSeed;
    const pendingState = terminalState(pendingSeed);
    const pendingBefore = pendingState.repository.safeStateSummary();
    const pendingWinner = terminalWinnerFor(
      pendingAbandoned,
      '2026-07-20T00:01:10.000Z',
      'provisioning_rolled_back'
    );

    await expect(
      pendingState.repository.acknowledgeTerminalControl(
        acknowledgeTerminalInput(pendingAbandoned, pendingWinner)
      )
    ).resolves.toMatchObject({
      code: 'OUTBOX_ACKNOWLEDGED',
      requestTerminalControlId: pendingAbandoned.terminalControlId,
      authoritativeWinner: pendingWinner,
      leasePhase: 'abandoned',
    });
    const pendingAfter = pendingState.repository.safeStateSummary();
    const pendingRequestBefore = pendingBefore.terminalControlOutboxes.find(
      (outbox) => outbox.terminalControlId === pendingAbandoned.terminalControlId
    );
    const pendingRequestAfter = pendingAfter.terminalControlOutboxes.find(
      (outbox) => outbox.terminalControlId === pendingAbandoned.terminalControlId
    );
    const pendingLoserBefore = pendingBefore.terminalControlOutboxes.find(
      (outbox) => outbox.terminalControlId === pendingRelease.terminalControlId
    );
    const pendingLoserAfter = pendingAfter.terminalControlOutboxes.find(
      (outbox) => outbox.terminalControlId === pendingRelease.terminalControlId
    );
    expect(pendingRequestBefore).toBeDefined();
    expect(pendingLoserBefore).toBeDefined();
    expect(pendingRequestAfter).toEqual({
      ...pendingRequestBefore,
      status: 'published',
      acknowledgedAt: pendingWinner.acknowledgedAt,
    });
    expect(pendingLoserAfter).toEqual({
      ...pendingLoserBefore,
      status: 'closed',
      closedReason: 'superseded_by_authoritative_winner',
      closedAt: pendingWinner.acknowledgedAt,
    });
    const pendingLeaseBefore = pendingBefore.current[0]?.lease;
    const pendingLeaseAfter = pendingAfter.current[0]?.lease;
    expect(pendingLeaseBefore).toBeDefined();
    expect(pendingLeaseAfter).toMatchObject({
      phase: 'abandoned',
      terminalWinner: pendingWinner,
      releasedAt: null,
      abandonedAt: pendingWinner.acknowledgedAt,
      capabilityIssuanceReceiptIds: pendingLeaseBefore?.capabilityIssuanceReceiptIds,
      capabilityDigests: pendingLeaseBefore?.capabilityDigests,
      terminalFailureReceiptRefs: pendingLeaseBefore?.terminalFailureReceiptRefs,
      nonterminalIngestOutboxIds: pendingLeaseBefore?.nonterminalIngestOutboxIds,
      ingestOutboxIds: pendingLeaseBefore?.ingestOutboxIds,
      transportReceiptIds: pendingLeaseBefore?.transportReceiptIds,
      terminalControlOutboxIds: pendingLeaseBefore?.terminalControlOutboxIds,
      drain: {
        consumedCapabilityCount: pendingLeaseBefore?.drain.consumedCapabilityCount,
        terminalIntexMarkerCount: pendingLeaseBefore?.drain.terminalIntexMarkerCount,
        terminalOutboxCount: pendingLeaseBefore?.drain.terminalOutboxCount,
        replyOrDeliveryWorkInFlight: pendingLeaseBefore?.drain.replyOrDeliveryWorkInFlight,
        drained: false,
      },
    });
    expect(pendingState.repository.operationCounts('acknowledge_terminal')).toEqual({
      invocations: 1,
      commits: 1,
    });
    expect(pendingState.digestCalls()).toBe(0);

    const claimedFixture = mixedClaimedTerminalSeed();
    const claimedState = terminalState(claimedFixture.seed);
    const claimedBefore = claimedState.repository.safeStateSummary();
    const claimedWinner = terminalWinnerFor(
      claimedFixture.abandoned,
      '2026-07-20T00:01:10.000Z',
      'provisioning_noop'
    );
    await expect(
      claimedState.repository.acknowledgeTerminalControl(
        acknowledgeTerminalInput(claimedFixture.abandoned, claimedWinner)
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED', authoritativeWinner: claimedWinner });
    expect(
      claimedState.repository
        .safeStateSummary()
        .terminalControlOutboxes.find(
          (outbox) => outbox.terminalControlId === claimedFixture.release.terminalControlId
        )
    ).toEqual(
      claimedBefore.terminalControlOutboxes.find(
        (outbox) => outbox.terminalControlId === claimedFixture.release.terminalControlId
      )
    );

    const publishedFixture = mixedClaimedTerminalSeed();
    const publishedState = terminalState(publishedFixture.seed);
    const publishedWinner = terminalWinnerFor(
      publishedFixture.abandoned,
      '2026-07-20T00:01:10.000Z',
      'provisioning_rolled_back'
    );
    await publishedState.repository.acknowledgeTerminalControl(
      acknowledgeTerminalInput(publishedFixture.release, publishedWinner)
    );
    const publishedLoser = publishedState.repository
      .safeStateSummary()
      .terminalControlOutboxes.find(
        (outbox) => outbox.terminalControlId === publishedFixture.release.terminalControlId
      );
    await publishedState.repository.acknowledgeTerminalControl(
      acknowledgeTerminalInput(publishedFixture.abandoned, publishedWinner, {
        now: '2026-07-20T00:01:11.000Z',
      })
    );
    expect(
      publishedState.repository
        .safeStateSummary()
        .terminalControlOutboxes.find(
          (outbox) => outbox.terminalControlId === publishedFixture.release.terminalControlId
        )
    ).toEqual(publishedLoser);

    const expiredBase = abandonWithExpiredReleaseSeed();
    const expiredRelease = expiredBase.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'release'
    );
    const expiredAbandonedBase = expiredBase.terminalControlOutboxes.find(
      (outbox) => outbox.kind === 'abandoned'
    );
    if (expiredRelease === undefined || expiredAbandonedBase === undefined)
      throw new Error('expired loser fixture requires both terminal intents');
    const expiredAbandoned = {
      ...expiredAbandonedBase,
      status: 'claimed',
      claim: {
        ownerDigest: indexedDigest(373_001),
        purpose: 'publish',
        claimedAt: '2026-07-20T00:01:00.000Z',
        expiresAt: '2026-07-20T00:06:00.000Z',
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const expiredSeed = {
      ...expiredBase,
      terminalControlOutboxes: [expiredAbandoned, expiredRelease],
    } satisfies FakeMatrixCorpusLifecycleSeed;
    const expiredState = terminalState(expiredSeed);
    const expiredBefore = expiredState.repository.safeStateSummary();
    const expiredWinner = terminalWinnerFor(
      expiredAbandoned,
      '2026-07-20T00:01:10.000Z',
      'provisioning_rolled_back'
    );
    await expiredState.repository.acknowledgeTerminalControl(
      acknowledgeTerminalInput(expiredAbandoned, expiredWinner)
    );
    const expiredAfter = expiredState.repository.safeStateSummary();
    const expiredLoserBefore = expiredBefore.terminalControlOutboxes.find(
      (outbox) => outbox.terminalControlId === expiredRelease.terminalControlId
    );
    expect(
      expiredAfter.terminalControlOutboxes.find(
        (outbox) => outbox.terminalControlId === expiredRelease.terminalControlId
      )
    ).toEqual({
      ...expiredLoserBefore,
      closedReason: 'superseded_by_authoritative_winner',
      closedAt: expiredWinner.acknowledgedAt,
    });

    const forbiddenState = terminalState(expiredSeed);
    const forbiddenBefore = forbiddenState.repository.safeStateSummary();
    await expect(
      forbiddenState.repository.acknowledgeTerminalControl(
        acknowledgeTerminalInput(
          expiredAbandoned,
          terminalWinnerFor(expiredRelease, '2026-07-20T00:01:10.000Z', 'completed_passed')
        )
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    expect(forbiddenState.repository.safeStateSummary()).toEqual(forbiddenBefore);
    expect(forbiddenState.repository.operationCounts('acknowledge_terminal')).toEqual({
      invocations: 1,
      commits: 0,
    });
    expect(forbiddenState.digestCalls()).toBe(0);

    const supersededFixture = mixedClaimedTerminalSeed();
    const supersededState = terminalState(supersededFixture.seed);
    supersededState.repository.corruptTerminalAcknowledgementInvariantForTest(
      'release_winner_superseded_closed'
    );
    const supersededBefore = supersededState.repository.safeStateSummary();
    await expect(
      supersededState.repository.acknowledgeTerminalControl(
        acknowledgeTerminalInput(
          supersededFixture.abandoned,
          terminalWinnerFor(
            supersededFixture.release,
            '2026-07-20T00:01:10.000Z',
            'completed_passed'
          )
        )
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'terminal_outbox' });
    expect(supersededState.repository.safeStateSummary()).toEqual(supersededBefore);
    expect(supersededState.repository.operationCounts('acknowledge_terminal')).toEqual({
      invocations: 1,
      commits: 0,
    });
    expect(supersededState.digestCalls()).toBe(0);
  });

  it('R17 terminal acknowledgement drafts are atomic', async () => {
    for (const winnerKind of ['release', 'abandoned'] as const) {
      for (const stage of [
        'acknowledge_terminal_after_request_outbox_draft',
        'acknowledge_terminal_after_losing_outbox_draft',
        'acknowledge_terminal_after_lease_pair_draft',
      ] as const) {
        const fixture = pendingLosingTerminalAcknowledgementFixture(winnerKind);
        const state = terminalState(fixture.seed);
        const input = acknowledgeTerminalInput(fixture.request, fixture.winner);
        const before = state.repository.safeStateSummary();
        const losingBefore = before.terminalControlOutboxes.find(
          (outbox) => outbox.terminalControlId !== fixture.request.terminalControlId
        );
        expect(losingBefore).toMatchObject({
          kind: winnerKind === 'release' ? 'abandoned' : 'release',
          status: 'pending',
          claim: null,
        });

        state.repository.failNextAt(stage);
        await expect(
          state.repository.acknowledgeTerminalControl(input),
          `${winnerKind}/${stage}`
        ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
        expect(state.repository.safeStateSummary()).toEqual(before);
        expect(state.repository.operationCounts('acknowledge_terminal')).toEqual({
          invocations: 1,
          commits: 0,
        });

        await expect(state.repository.acknowledgeTerminalControl(input)).resolves.toEqual({
          code: 'OUTBOX_ACKNOWLEDGED',
          outboxKind: 'terminal',
          requestTerminalControlId: fixture.request.terminalControlId,
          requestEventId: fixture.request.eventId,
          runId: fixture.request.runId,
          leaseFence: fixture.request.leaseFence,
          requestPayloadDigest: fixture.request.payloadDigest,
          authoritativeWinner: fixture.winner,
          leasePhase: winnerKind === 'release' ? 'released' : 'abandoned',
        });
        const after = state.repository.safeStateSummary();
        expect(after.version).toBe(before.version + 1);
        expect(after.current[0]?.lease).toMatchObject({
          phase: winnerKind === 'release' ? 'released' : 'abandoned',
          terminalWinner: fixture.winner,
          releasedAt: winnerKind === 'release' ? fixture.winner.acknowledgedAt : null,
          abandonedAt: winnerKind === 'abandoned' ? fixture.winner.acknowledgedAt : null,
          drain: { drained: false },
        });
        expect(
          after.terminalControlOutboxes.find(
            (outbox) => outbox.terminalControlId === fixture.request.terminalControlId
          )
        ).toMatchObject({
          status: 'published',
          acknowledgedAt: fixture.winner.acknowledgedAt,
        });
        expect(
          after.terminalControlOutboxes.find(
            (outbox) => outbox.terminalControlId !== fixture.request.terminalControlId
          )
        ).toEqual({
          ...losingBefore,
          status: 'closed',
          closedReason: 'superseded_by_authoritative_winner',
          closedAt: fixture.winner.acknowledgedAt,
        });
        expect(state.repository.operationCounts('acknowledge_terminal')).toEqual({
          invocations: 2,
          commits: 1,
        });
        expect(state.digestCalls()).toBe(0);
      }
    }

    for (const firstWinnerKind of ['release', 'abandoned'] as const) {
      const fixture = mixedClaimedTerminalSeed();
      const state = terminalState(fixture.seed);
      const releaseWinner = terminalWinnerFor(
        fixture.release,
        '2026-07-20T00:01:10.000Z',
        'completed_passed'
      );
      const abandonedWinner = terminalWinnerFor(
        fixture.abandoned,
        '2026-07-20T00:01:10.000Z',
        'provisioning_rolled_back'
      );
      const releaseInput = acknowledgeTerminalInput(fixture.release, releaseWinner);
      const abandonedInput = acknowledgeTerminalInput(fixture.abandoned, abandonedWinner);
      const releaseGate = state.repository.deferNextBeforeAdmission('acknowledge_terminal');
      const abandonedGate = state.repository.deferNextBeforeAdmission('acknowledge_terminal');
      const releaseAttempt = state.repository.acknowledgeTerminalControl(releaseInput);
      const abandonedAttempt = state.repository.acknowledgeTerminalControl(abandonedInput);
      await releaseGate.entered;
      await abandonedGate.entered;

      const winnerGate = firstWinnerKind === 'release' ? releaseGate : abandonedGate;
      const loserGate = firstWinnerKind === 'release' ? abandonedGate : releaseGate;
      const winnerAttempt = firstWinnerKind === 'release' ? releaseAttempt : abandonedAttempt;
      const loserAttempt = firstWinnerKind === 'release' ? abandonedAttempt : releaseAttempt;
      const expectedWinner = firstWinnerKind === 'release' ? releaseWinner : abandonedWinner;
      winnerGate.release();
      await expect(winnerAttempt).resolves.toMatchObject({
        code: 'OUTBOX_ACKNOWLEDGED',
        authoritativeWinner: expectedWinner,
      });
      loserGate.release();
      await expect(loserAttempt).resolves.toEqual({ code: 'CLAIM_CONFLICT' });
      expect(state.repository.safeStateSummary().current[0]?.lease).toMatchObject({
        phase: firstWinnerKind === 'release' ? 'released' : 'abandoned',
        terminalWinner: expectedWinner,
        releasedAt: firstWinnerKind === 'release' ? expectedWinner.acknowledgedAt : null,
        abandonedAt: firstWinnerKind === 'abandoned' ? expectedWinner.acknowledgedAt : null,
      });
      expect(state.repository.operationCounts('acknowledge_terminal')).toEqual({
        invocations: 2,
        commits: 1,
      });
      expect(state.digestCalls()).toBe(0);
    }
  });

  it('R19 stale owner cannot clean claim renew or acknowledge', async () => {
    const publishedBase = seededOutbox(380_000, 'published');
    if (publishedBase.claim === null)
      throw new Error('stale ingest acknowledgement fixture requires a recovery claim');
    const published = {
      ...publishedBase,
      lastClaimRenewal: {
        ownerDigest: publishedBase.claim.ownerDigest,
        purpose: publishedBase.claim.purpose,
        previousClaimExpiresAt: '2026-07-20T00:05:04.000Z',
        claimExpiresAt: publishedBase.claim.expiresAt,
      },
    } satisfies MatrixCorpusIngestOutboxRecordV1;
    if (published.claim === null)
      throw new Error('stale ingest replay fixture requires a retained recovery claim');
    const ingestState = ingestPhaseRepository(380_000, published, 'abandoned');
    const markerAcknowledgement = acknowledgeIngestInput(published, {
      now: '2026-07-20T00:05:10.000Z',
      outcome: {
        kind: 'terminal_marker_acknowledged',
        publisherReceiptDigest: published.publisherReceiptDigest ?? indexedDigest(380_010),
        publishedAt: published.publishedAt ?? '2026-07-20T00:00:04.000Z',
        terminalMarker: {
          kind: 'completed',
          digest: indexedDigest(380_011),
          recordedAt: '2026-07-20T00:05:10.000Z',
        },
        replyOrDeliveryWorkInFlight: 0,
      },
    });
    const ingestClaimReplay = claimIngestInput(published, {
      ownerDigest: published.claim.ownerDigest,
      purpose: 'terminal_marker_recovery',
      now: '2026-07-20T00:05:11.000Z',
      claimExpiresAt: published.claim.expiresAt,
    });
    const ingestRenewalReplay = renewIngestInput(published, {
      purpose: 'terminal_marker_recovery',
      expectedClaimExpiresAt: published.lastClaimRenewal.previousClaimExpiresAt,
      newClaimExpiresAt: published.lastClaimRenewal.claimExpiresAt,
      now: '2026-07-20T00:05:05.000Z',
    });
    const ingestClaimResult = await ingestState.repository.claimPendingIngestOutbox(
      ingestClaimReplay
    );
    expect(ingestClaimResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableIngestClaimResult = structuredClone(ingestClaimResult);
    expect('payload' in immutableIngestClaimResult).toBe(true);
    Reflect.set(ingestClaimResult, 'ownerDigest', indexedDigest(380_030));
    if ('payload' in ingestClaimResult)
      Reflect.set(ingestClaimResult.payload.context, 'runId', 'run_mutated');
    await expect(
      ingestState.repository.claimPendingIngestOutbox(ingestClaimReplay)
    ).resolves.toEqual(immutableIngestClaimResult);

    const ingestRenewalResult = await ingestState.repository.renewIngestOutboxClaim(
      ingestRenewalReplay
    );
    expect(ingestRenewalResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableIngestRenewalResult = structuredClone(ingestRenewalResult);
    Reflect.set(ingestRenewalResult, 'claimExpiresAt', '2026-07-20T00:59:00.000Z');
    await expect(
      ingestState.repository.renewIngestOutboxClaim(ingestRenewalReplay)
    ).resolves.toEqual(immutableIngestRenewalResult);

    await expect(
      ingestState.repository.acknowledgeIngestOutbox(markerAcknowledgement)
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED' });
    const ingestAcknowledgementResult = await ingestState.repository.acknowledgeIngestOutbox(
      markerAcknowledgement
    );
    expect(ingestAcknowledgementResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableIngestAcknowledgementResult = structuredClone(ingestAcknowledgementResult);
    Reflect.set(ingestAcknowledgementResult, 'acknowledgedAt', '2026-07-20T00:59:00.000Z');
    await expect(
      ingestState.repository.acknowledgeIngestOutbox(markerAcknowledgement)
    ).resolves.toEqual(immutableIngestAcknowledgementResult);
    await expect(
      ingestState.repository.acquireProvisioningLease(
        acquireCommand({
          runId: 'run_ingest_successor',
          runFenceDigest: indexedDigest(380_012),
          idempotencyKeyDigest: indexedDigest(380_013),
          canonicalRequestDigest: indexedDigest(380_014),
        })
      )
    ).resolves.toMatchObject({ code: 'ACQUIRED', leaseFence: '2' });
    const ingestBefore = ingestState.repository.safeStateSummary();
    const ingestDigestCallsBefore = ingestState.digestCalls();
    const ingestRows = [
      {
        operation: 'claim_ingest' as const,
        call: (): Promise<IngestClaimResult> =>
          ingestState.repository.claimPendingIngestOutbox(ingestClaimReplay),
      },
      {
        operation: 'renew_ingest_claim' as const,
        call: (): Promise<ClaimRenewResult> =>
          ingestState.repository.renewIngestOutboxClaim(ingestRenewalReplay),
      },
      {
        operation: 'acknowledge_ingest' as const,
        call: (): Promise<import('../../../domain/matrixCorpus/types.js').AcknowledgeResult> =>
          ingestState.repository.acknowledgeIngestOutbox(markerAcknowledgement),
      },
    ];
    const ingestCountsBefore = new Map(
      ingestRows.map((row) => [row.operation, ingestState.repository.operationCounts(row.operation)])
    );
    const ingestStaleResults = [];
    for (const row of ingestRows) {
      const result = await row.call();
      expect(result, row.operation).toEqual({ code: 'STALE_FENCE' });
      ingestStaleResults.push(result);
    }
    expect(ingestState.repository.safeStateSummary()).toEqual(ingestBefore);
    for (const row of ingestRows) {
      const countsBefore = ingestCountsBefore.get(row.operation);
      expect(countsBefore).toBeDefined();
      expect(ingestState.repository.operationCounts(row.operation)).toEqual({
        invocations: (countsBefore?.invocations ?? 0) + 1,
        commits: countsBefore?.commits ?? 0,
      });
    }
    expect(ingestState.digestCalls()).toBe(ingestDigestCallsBefore);

    const cleanupFixture = cleanupTransportFixture(380_100);
    const cleanupSource = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => digest },
    });
    cleanupSource.seedValidCleanupOutboxState(cleanupFixture.seed);
    await expect(cleanupSource.cleanupExactRun(cleanupFixture.command)).resolves.toMatchObject({
      code: 'RUN_CLEANUP_PROGRESS',
      committedRevision: 1,
    });
    const progressedCleanupTarget = cleanupSource
      .safeStateSummary()
      .histories.find(
        (history) => history.runFenceDigest === cleanupFixture.target.runFenceDigest
      );
    if (
      progressedCleanupTarget?.cleanupProgress === null ||
      progressedCleanupTarget?.cleanupProgress === undefined
    )
      throw new Error('stale cleanup replay fixture requires durable progress');
    const cleanupAcquisition =
      cleanupFixture.seed.currentPair.current.operationReceipts.acquire;
    if (
      cleanupAcquisition === null ||
      cleanupAcquisition.replayProjection.operation !== 'acquire'
    )
      throw new Error('stale cleanup replay fixture requires an acquisition receipt');
    const cleanupSuccessorRunFenceDigest = indexedDigest(380_015);
    const cleanupSuccessor = {
      ...cleanupFixture.seed.currentPair.current,
      runId: 'run_cleanup_successor',
      runFenceDigest: cleanupSuccessorRunFenceDigest,
      leaseFence: '3',
      fenceEpoch: '3',
      operationReceipts: {
        acquire: {
          ...cleanupAcquisition,
          idempotencyKeyDigest: indexedDigest(380_016),
          canonicalRequestDigest: indexedDigest(380_017),
          replayProjection: {
            ...cleanupAcquisition.replayProjection,
            runId: 'run_cleanup_successor',
            leaseFence: '3',
          },
        },
        activate: null,
        quiesce: null,
        release: null,
      },
      finalCleanupReceipt: null,
    } satisfies MatrixCorpusLeaseV1;
    let cleanupDigestCalls = 0;
    const cleanupStaleState = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((cleanupDigestCalls += 1), digest) },
    });
    const remainingTransportIds = new Set(
      progressedCleanupTarget.cleanupProgress.remaining.transportReceiptIds
    );
    cleanupStaleState.seedValidCleanupOutboxState({
      ...cleanupFixture.seed,
      currentPair: {
        leaseSlotDigest: cleanupFixture.seed.currentPair.leaseSlotDigest,
        current: cleanupSuccessor,
        history: {
          ...cleanupSuccessor,
          leaseSlotDigest: cleanupFixture.seed.currentPair.leaseSlotDigest,
        },
      },
      retainedHistories: [
        {
          ...cleanupFixture.target,
          cleanupProgress: progressedCleanupTarget.cleanupProgress,
        },
      ],
      transportReceipts: cleanupFixture.transportReceipts.filter((receipt) =>
        remainingTransportIds.has(receipt.transportMessageIdDigest)
      ),
    });
    const cleanupBefore = cleanupStaleState.safeStateSummary();
    await expect(cleanupStaleState.cleanupExactRun(cleanupFixture.command)).resolves.toEqual({
      code: 'STALE_FENCE',
    });
    expect(cleanupStaleState.safeStateSummary()).toEqual(cleanupBefore);
    expect(cleanupStaleState.operationCounts('cleanup')).toEqual({
      invocations: 1,
      commits: 0,
    });
    expect(cleanupDigestCalls).toBe(0);

    const terminalFixture = mixedClaimedTerminalSeed();
    const terminalStateWithReplay = terminalState(terminalFixture.seed);
    const terminalRenewalReplay = renewTerminalInput(terminalFixture.abandoned, {
      now: '2026-07-20T00:01:10.000Z',
      newClaimExpiresAt: '2026-07-20T00:06:10.000Z',
    });
    await expect(
      terminalStateWithReplay.repository.renewTerminalControlOutboxClaim(
        terminalRenewalReplay
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_CLAIM_RENEWED' });
    const terminalRenewalResult =
      await terminalStateWithReplay.repository.renewTerminalControlOutboxClaim(
        terminalRenewalReplay
      );
    expect(terminalRenewalResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableTerminalRenewalResult = structuredClone(terminalRenewalResult);
    Reflect.set(terminalRenewalResult, 'ownerDigest', indexedDigest(380_031));
    await expect(
      terminalStateWithReplay.repository.renewTerminalControlOutboxClaim(
        terminalRenewalReplay
      )
    ).resolves.toEqual(immutableTerminalRenewalResult);
    if (terminalFixture.abandoned.claim === null)
      throw new Error('stale terminal acknowledgement fixture requires a claim');
    const renewedAbandoned = {
      ...terminalFixture.abandoned,
      claim: {
        ...terminalFixture.abandoned.claim,
        claimedAt: terminalRenewalReplay.now,
        expiresAt: terminalRenewalReplay.newClaimExpiresAt,
      },
      lastClaimRenewal: {
        ownerDigest: terminalRenewalReplay.ownerDigest,
        previousClaimExpiresAt: terminalRenewalReplay.expectedClaimExpiresAt,
        claimExpiresAt: terminalRenewalReplay.newClaimExpiresAt,
      },
    } satisfies MatrixCorpusTerminalControlOutboxRecordV1;
    const terminalWinner = terminalWinnerFor(
      renewedAbandoned,
      '2026-07-20T00:01:11.000Z',
      'provisioning_rolled_back'
    );
    const terminalAcknowledgementReplay = acknowledgeTerminalInput(
      renewedAbandoned,
      terminalWinner
    );
    const terminalClaimReplay = claimTerminalInput(renewedAbandoned, {
      ownerDigest: terminalRenewalReplay.ownerDigest,
      now: '2026-07-20T00:01:12.000Z',
      claimExpiresAt: terminalRenewalReplay.newClaimExpiresAt,
    });
    const terminalClaimResult =
      await terminalStateWithReplay.repository.claimPendingTerminalControlOutbox(
        terminalClaimReplay
      );
    expect(terminalClaimResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableTerminalClaimResult = structuredClone(terminalClaimResult);
    expect('payload' in immutableTerminalClaimResult).toBe(true);
    Reflect.set(terminalClaimResult, 'ownerDigest', indexedDigest(380_032));
    if ('payload' in terminalClaimResult)
      Reflect.set(terminalClaimResult.payload, 'runId', 'run_mutated');
    await expect(
      terminalStateWithReplay.repository.claimPendingTerminalControlOutbox(
        terminalClaimReplay
      )
    ).resolves.toEqual(immutableTerminalClaimResult);
    await expect(
      terminalStateWithReplay.repository.acknowledgeTerminalControl(
        terminalAcknowledgementReplay
      )
    ).resolves.toMatchObject({ code: 'OUTBOX_ACKNOWLEDGED' });
    const terminalAcknowledgementResult =
      await terminalStateWithReplay.repository.acknowledgeTerminalControl(
        terminalAcknowledgementReplay
      );
    expect(terminalAcknowledgementResult).toMatchObject({ code: 'ALREADY_APPLIED' });
    const immutableTerminalAcknowledgementResult = structuredClone(
      terminalAcknowledgementResult
    );
    Reflect.set(terminalAcknowledgementResult, 'leasePhase', 'released');
    if ('authoritativeWinner' in terminalAcknowledgementResult)
      Reflect.set(
        terminalAcknowledgementResult.authoritativeWinner,
        'payloadDigest',
        indexedDigest(380_033)
      );
    await expect(
      terminalStateWithReplay.repository.acknowledgeTerminalControl(
        terminalAcknowledgementReplay
      )
    ).resolves.toEqual(immutableTerminalAcknowledgementResult);
    await expect(
      terminalStateWithReplay.repository.acquireProvisioningLease(
        acquireCommand({
          runId: 'run_terminal_successor',
          runFenceDigest: indexedDigest(380_020),
          idempotencyKeyDigest: indexedDigest(380_021),
          canonicalRequestDigest: indexedDigest(380_022),
        })
      )
    ).resolves.toMatchObject({ code: 'ACQUIRED', leaseFence: '2' });
    const terminalBefore = terminalStateWithReplay.repository.safeStateSummary();
    const terminalDigestCallsBefore = terminalStateWithReplay.digestCalls();
    const terminalRows = [
      {
        operation: 'claim_terminal' as const,
        call: (): Promise<TerminalClaimResult> =>
          terminalStateWithReplay.repository.claimPendingTerminalControlOutbox(
            terminalClaimReplay
          ),
      },
      {
        operation: 'renew_terminal_claim' as const,
        call: (): Promise<ClaimRenewResult> =>
          terminalStateWithReplay.repository.renewTerminalControlOutboxClaim(
            terminalRenewalReplay
          ),
      },
      {
        operation: 'acknowledge_terminal' as const,
        call: (): Promise<TerminalControlAcknowledgementResult> =>
          terminalStateWithReplay.repository.acknowledgeTerminalControl(
            terminalAcknowledgementReplay
          ),
      },
    ];
    const terminalCountsBefore = new Map(
      terminalRows.map((row) => [
        row.operation,
        terminalStateWithReplay.repository.operationCounts(row.operation),
      ])
    );
    const terminalStaleResults = [];
    for (const row of terminalRows) {
      const result = await row.call();
      expect(result, row.operation).toEqual({ code: 'STALE_FENCE' });
      terminalStaleResults.push(result);
    }
    expect(terminalStateWithReplay.repository.safeStateSummary()).toEqual(terminalBefore);
    for (const row of terminalRows) {
      const countsBefore = terminalCountsBefore.get(row.operation);
      expect(countsBefore).toBeDefined();
      expect(terminalStateWithReplay.repository.operationCounts(row.operation)).toEqual({
        invocations: (countsBefore?.invocations ?? 0) + 1,
        commits: countsBefore?.commits ?? 0,
      });
    }
    expect(terminalStateWithReplay.digestCalls()).toBe(terminalDigestCallsBefore);

    const safeSurface = JSON.stringify({
      ingest: ingestState.repository.safeStateSummary(),
      cleanup: cleanupStaleState.safeStateSummary(),
      terminal: terminalStateWithReplay.repository.safeStateSummary(),
      ingestStaleResults,
      terminalStaleResults,
      error: new FakeMatrixCorpusRepositoryFault(),
    });
    for (const forbidden of [
      validIssueInput.rawCapability,
      validAcquireInput.idempotencyKey,
      validConsumeInput.transportMessageId,
      attestedPayload.ordinaryIngest.text,
      'ordinaryIngest',
      'matrix_corpus_ingest_payload',
      'tombstoneDigest',
      'terminalCandidateDigest',
      'artifactStageDigest',
      'private arbitrary exception',
    ])
      expect(safeSurface).not.toContain(forbidden);
  });

  it('final cleanup receipt survives replay and clears only on lifecycle exit', async () => {
    const finalizedCleanup = async (
      loseResponse = false
    ): Promise<
      Readonly<{
        repository: FakeMatrixCorpusRepository;
        command: CleanupExactRunCommand;
        digestCalls: () => number;
      }>
    > => {
      let digestCallCount = 0;
      const repository = new FakeMatrixCorpusRepository({
        replayProjectionDigest: { digest: () => ((digestCallCount += 1), digest) },
      });
      const fixture = cleanupTerminalFixture();
      repository.seedValidCleanupOutboxState(fixture.seed);
      if (loseResponse) {
        repository.loseNextResponseAfterCommit('cleanup');
        await expect(repository.cleanupExactRun(fixture.command)).rejects.toBeInstanceOf(
          FakeMatrixCorpusRepositoryFault
        );
      } else {
        await expect(repository.cleanupExactRun(fixture.command)).resolves.toMatchObject({
          code: 'RUN_CLEANED',
          finalRevision: 1,
        });
      }
      expect(repository.safeStateSummary().current[0]?.lease).toMatchObject({
        phase: 'provisioning',
        finalCleanupReceipt: {
          idempotencyKeyDigest: fixture.command.idempotencyKeyDigest,
          canonicalRequestDigest: fixture.command.canonicalRequestDigest,
          replayProjection: {
            targetRunFenceDigest: fixture.command.targetRunFenceDigest,
            finalRevision: 1,
          },
        },
      });
      return { repository, command: fixture.command, digestCalls: () => digestCallCount };
    };

    const activation = await finalizedCleanup(true);
    const committed = activation.repository.safeStateSummary();
    const firstReplay = await activation.repository.cleanupExactRun(activation.command);
    expect(firstReplay).toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'cleanup',
      result: 'cleaned',
      finalRevision: 1,
    });
    expect(activation.repository.safeStateSummary()).toEqual(committed);
    const immutableReplay = structuredClone(firstReplay);
    Reflect.set(firstReplay, 'finalRevision', 63);
    const mutatedSummary = activation.repository.safeStateSummary();
    Reflect.set(mutatedSummary, 'version', 999);
    Reflect.set(mutatedSummary.current[0]?.lease.finalCleanupReceipt ?? {}, 'committedRevision', 63);
    await expect(activation.repository.cleanupExactRun(activation.command)).resolves.toEqual(
      immutableReplay
    );
    expect(activation.repository.safeStateSummary()).toEqual(committed);

    const activationReady = activateCommand().controlStatus;
    if (activationReady.kind !== 'status')
      throw new Error('cleanup activation fixture requires a ready status');
    for (const failure of [
      {
        command: activateCommand({ controlStatus: { kind: 'not_ready' } }),
        expected: { code: 'NOT_READY', gate: 'activation' } as const,
      },
      {
        command: activateCommand({
          runId: 'run_stale',
          controlStatus: { ...activationReady, runId: 'run_stale' },
        }),
        expected: { code: 'STALE_FENCE' } as const,
      },
    ]) {
      const before = activation.repository.safeStateSummary();
      await expect(activation.repository.activateRun(failure.command)).resolves.toEqual(
        failure.expected
      );
      expect(activation.repository.safeStateSummary()).toEqual(before);
      expect(before.current[0]?.lease.finalCleanupReceipt).not.toBeNull();
    }

    for (const stage of [
      'activate_after_current_draft',
      'activate_after_history_draft',
    ] as const) {
      const faulted = await finalizedCleanup();
      const before = faulted.repository.safeStateSummary();
      faulted.repository.failNextAt(stage);
      await expect(faulted.repository.activateRun(activateCommand())).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(faulted.repository.safeStateSummary()).toEqual(before);
      expect(before.current[0]?.lease.finalCleanupReceipt).not.toBeNull();
    }

    await expect(activation.repository.activateRun(activateCommand())).resolves.toMatchObject({
      code: 'ACTIVATED',
      phase: 'active',
    });
    const activated = activation.repository.safeStateSummary();
    expect(activated.current[0]?.lease).toMatchObject({
      phase: 'active',
      finalCleanupReceipt: null,
    });
    await expect(activation.repository.activateRun(activateCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'activate',
    });
    await expect(
      activation.repository.cleanupExactRun({
        ...activation.command,
        idempotencyKeyDigest: indexedDigest(381_000),
        canonicalRequestDigest: indexedDigest(381_001),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'active' });
    expect(activation.repository.safeStateSummary()).toEqual(activated);

    const abandonment = await finalizedCleanup();
    const abandonmentBefore = abandonment.repository.safeStateSummary();
    const abandonBase = abandonCommand();
    await expect(
      abandonment.repository.abandonExpiredRun(
        abandonCommand({
          now: '2026-07-20T00:00:59.999Z',
          terminalControl: {
            ...abandonBase.terminalControl,
            createdAt: '2026-07-20T00:00:59.999Z',
          },
        })
      )
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'abandon' });
    await expect(
      abandonment.repository.abandonExpiredRun(
        abandonCommand({
          observedRunId: 'run_stale',
          terminalControl: { ...abandonBase.terminalControl, runId: 'run_stale' },
        })
      )
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(abandonment.repository.safeStateSummary()).toEqual(abandonmentBefore);

    for (const stage of [
      'abandon_after_capability_draft',
      'abandon_after_ingest_outboxes_draft',
      'abandon_after_terminal_outbox_draft',
      'abandon_after_lease_pair_draft',
    ] as const) {
      const faulted = await finalizedCleanup();
      const before = faulted.repository.safeStateSummary();
      faulted.repository.failNextAt(stage);
      await expect(
        faulted.repository.abandonExpiredRun(abandonCommand())
      ).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(faulted.repository.safeStateSummary()).toEqual(before);
      expect(before.current[0]?.lease.finalCleanupReceipt).not.toBeNull();
    }

    await expect(
      abandonment.repository.abandonExpiredRun(abandonCommand())
    ).resolves.toMatchObject({ code: 'ABANDON_PENDING' });
    const abandoned = abandonment.repository.safeStateSummary();
    expect(abandoned.current[0]?.lease).toMatchObject({
      phase: 'abandon_pending',
      finalCleanupReceipt: null,
    });
    await expect(
      abandonment.repository.abandonExpiredRun(
        abandonCommand({
          now: '2026-07-20T00:02:00.000Z',
          terminalControl: {
            ...abandonBase.terminalControl,
            createdAt: '2026-07-20T00:02:00.000Z',
          },
        })
      )
    ).resolves.toMatchObject({ code: 'ALREADY_APPLIED', operation: 'abandon' });
    await expect(
      abandonment.repository.cleanupExactRun({
        ...abandonment.command,
        idempotencyKeyDigest: indexedDigest(381_002),
        canonicalRequestDigest: indexedDigest(381_003),
      })
    ).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'abandon_pending' });
    expect(abandonment.repository.safeStateSummary()).toEqual(abandoned);
    expect(activation.digestCalls()).toBeGreaterThan(0);
    expect(abandonment.digestCalls()).toBeGreaterThan(0);
  });

  it('R11 quiesce revokes authority and closes pending work atomically', async () => {
    const { repository, digestCalls } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({
      code: 'CAPABILITY_ISSUED',
    });

    await expect(repository.quiesceRun(quiesceCommand())).resolves.toEqual({
      code: 'QUIESCED',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'quiescing',
      quiescedAt: '2026-07-20T00:00:04.000Z',
      drained: true,
    });
    expect(repository.safeStateSummary()).toMatchObject({
      version: 4,
      capabilities: [{ capabilityDigest: '1'.repeat(64), revokedAt: '2026-07-20T00:00:04.000Z' }],
      current: [
        {
          lease: {
            phase: 'quiescing',
            unconsumedCapability: null,
            nonterminalIngestOutboxIds: [],
            drain: { drained: true },
          },
        },
      ],
    });
    expect(repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 1 });
    expect(digestCalls()).toBe(4);
  });

  it('R11 quiesce without a pointed capability commits an exactly drained state', async () => {
    const { repository } = await activeRepository();
    await expect(repository.quiesceRun(quiesceCommand())).resolves.toEqual({
      code: 'QUIESCED',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'quiescing',
      quiescedAt: '2026-07-20T00:00:04.000Z',
      drained: true,
    });
    expect(repository.safeStateSummary()).toMatchObject({
      capabilities: [],
      ingestOutboxes: [],
      current: [
        {
          lease: {
            phase: 'quiescing',
            unconsumedCapability: null,
            nonterminalIngestOutboxIds: [],
            drain: { drained: true },
          },
        },
      ],
    });
    expect(repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 1 });
  });

  it('R11 quiesce races issue and first consume in selected admission order', async () => {
    const quiesceFirst = await activeRepository();
    const deferredIssue = quiesceFirst.repository.deferNextBeforeAdmission('issue');
    const deferredQuiesce = quiesceFirst.repository.deferNextBeforeAdmission('quiesce');
    const blockedIssue = quiesceFirst.repository.issueCapability(issueCommand());
    const winningQuiesce = quiesceFirst.repository.quiesceRun(quiesceCommand());
    await deferredIssue.entered;
    await deferredQuiesce.entered;
    deferredQuiesce.release();
    await expect(winningQuiesce).resolves.toMatchObject({ code: 'QUIESCED', drained: true });
    deferredIssue.release();
    await expect(blockedIssue).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
    expect(quiesceFirst.repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 1 });
    expect(quiesceFirst.repository.operationCounts('issue')).toEqual({ invocations: 1, commits: 0 });

    const issueFirst = await activeRepository();
    const firstIssueGate = issueFirst.repository.deferNextBeforeAdmission('issue');
    const secondQuiesceGate = issueFirst.repository.deferNextBeforeAdmission('quiesce');
    const winningIssue = issueFirst.repository.issueCapability(issueCommand());
    const followingQuiesce = issueFirst.repository.quiesceRun(quiesceCommand());
    await firstIssueGate.entered;
    await secondQuiesceGate.entered;
    firstIssueGate.release();
    await expect(winningIssue).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    secondQuiesceGate.release();
    await expect(followingQuiesce).resolves.toMatchObject({ code: 'QUIESCED', drained: true });
    expect(issueFirst.repository.safeStateSummary()).toMatchObject({
      capabilities: [{ revokedAt: '2026-07-20T00:00:04.000Z' }],
      current: [{ lease: { phase: 'quiescing', unconsumedCapability: null } }],
    });

    const consumeFirst = await activeRepository();
    await consumeFirst.repository.issueCapability(issueCommand());
    const heldConsume = consumeFirst.repository.deferNextBeforeAdmission('consume');
    const heldQuiesce = consumeFirst.repository.deferNextBeforeAdmission('quiesce');
    const pendingConsume = consumeFirst.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const afterConsumeQuiesce = consumeFirst.repository.quiesceRun(quiesceCommand());
    await heldConsume.entered;
    await heldQuiesce.entered;
    heldConsume.release();
    await expect(pendingConsume).resolves.toMatchObject({ code: 'INGEST_ENQUEUED' });
    heldQuiesce.release();
    await expect(afterConsumeQuiesce).resolves.toMatchObject({ code: 'QUIESCED', drained: false });
    expect(consumeFirst.repository.safeStateSummary()).toMatchObject({
      ingestOutboxes: [{ status: 'closed', closedReason: 'quiesced' }],
      current: [{ lease: { phase: 'quiescing', nonterminalIngestOutboxIds: [] } }],
    });
    await expect(consumeFirst.repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'consume',
      result: 'enqueued',
    });

    const quiesceBeforeConsume = await activeRepository();
    await quiesceBeforeConsume.repository.issueCapability(issueCommand());
    const consumeGate = quiesceBeforeConsume.repository.deferNextBeforeAdmission('consume');
    const quiesceGate = quiesceBeforeConsume.repository.deferNextBeforeAdmission('quiesce');
    const blockedConsume = quiesceBeforeConsume.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const firstQuiesce = quiesceBeforeConsume.repository.quiesceRun(quiesceCommand());
    await consumeGate.entered;
    await quiesceGate.entered;
    quiesceGate.release();
    await expect(firstQuiesce).resolves.toMatchObject({ code: 'QUIESCED' });
    consumeGate.release();
    await expect(blockedConsume).resolves.toEqual({ code: 'PHASE_CONFLICT', actualPhase: 'quiescing' });
  });

  it('R11 quiesce closes only pending nonterminal work and preserves historical children', async () => {
    const statuses = ['pending', 'claimed', 'published', 'closed'] as const;
    for (const [index, status] of statuses.entries()) {
      const outbox = seededOutbox(100 + index, status);
      const transportDigest = indexedDigest(8_100 + index);
      const consumedCapability = seededCapability(100 + index, {
        consumedAt: outbox.createdAt,
        consumedTransportMessageIdDigest: transportDigest,
        ingestOutboxId: outbox.ingestOutboxId,
      });
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidLifecycleState({
        ...issueConsumeSeed({
          issued: [consumedCapability],
          transportReceipts: [acceptedTransportReceipt(consumedCapability.capability, outbox, transportDigest)],
          ingestOutboxes: [outbox],
          leaseOverrides: {
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 0,
              terminalOutboxCount: 0,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        }),
        terminalControlOutboxes: [],
      });
      const historicalClosed = repository.safeStateSummary().ingestOutboxes[0];

      await expect(repository.quiesceRun(quiesceCommand())).resolves.toMatchObject({
        code: 'QUIESCED',
        drained: false,
      });
      const after = repository.safeStateSummary();
      expect(after.ingestOutboxes[0]).toMatchObject({
        ingestOutboxId: outbox.ingestOutboxId,
        status: status === 'pending' ? 'closed' : status,
      });
      expect(after.current[0]?.lease.nonterminalIngestOutboxIds).toEqual(
        status === 'pending' || status === 'closed' ? [] : [outbox.ingestOutboxId]
      );
      if (status === 'closed') expect(after.ingestOutboxes[0]).toEqual(historicalClosed);
      expect(repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 1 });
    }
  });

  it('R11 quiesce rejects an already-consumed pointed capability without committing', async () => {
    const { repository } = await activeRepository();
    await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
    const corrupt = Reflect.get(repository, 'corruptLifecycleInvariantForTest');
    expect(typeof corrupt).toBe('function');
    if (typeof corrupt !== 'function') return;
    const before = repository.safeStateSummary();
    const operationCountsBefore = Object.fromEntries(
      ['acquire', 'activate', 'renew', 'issue', 'consume', 'quiesce', 'release', 'abandon', 'status'].map(
        (operation) => [operation, repository.operationCounts(operation as Parameters<typeof repository.operationCounts>[0])]
      )
    );
    Reflect.apply(corrupt, repository, ['pointed_capability_consumed']);
    const afterControl = repository.safeStateSummary();
    const expectedCapability = before.capabilities[0];
    if (expectedCapability === undefined) throw new Error('issued capability is required');
    expect(afterControl).toEqual({
      ...before,
      capabilities: [
        {
          ...expectedCapability,
          consumedAt: '2026-07-20T00:00:03.000Z',
          consumedTransportMessageIdDigest: 'f'.repeat(64),
          ingestOutboxId: 'outbox_consumed',
        },
      ],
    });
    expect(
      Object.fromEntries(
        ['acquire', 'activate', 'renew', 'issue', 'consume', 'quiesce', 'release', 'abandon', 'status'].map(
          (operation) => [operation, repository.operationCounts(operation as Parameters<typeof repository.operationCounts>[0])]
        )
      )
    ).toEqual(operationCountsBefore);

    await expect(repository.quiesceRun(quiesceCommand())).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'capability',
    });
    expect(repository.safeStateSummary()).toEqual(afterControl);
    expect(repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 0 });
  });

  it('R15 quiesce receipt replay survives loss and stale takeover', async () => {
    const { repository, digestCalls } = await activeRepository();
    repository.loseNextResponseAfterCommit('quiesce');
    await expect(repository.quiesceRun(quiesceCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    await expect(
      repository.quiesceRun({ ...quiesceCommand(), now: '2026-07-20T00:00:10.000Z' })
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'quiesce',
      result: 'quiesced',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'quiescing',
      quiescedAt: '2026-07-20T00:00:04.000Z',
      drained: true,
    });
    await expect(
      repository.quiesceRun({ ...quiesceCommand(), canonicalRequestDigest: '9'.repeat(64) })
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(repository.operationCounts('quiesce')).toEqual({ invocations: 3, commits: 1 });
    expect(digestCalls()).toBe(3);

    const successor = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    successor.seedValidLeaseState(terminalSeedPair('1'));
    await expect(
      successor.acquireProvisioningLease(
        acquireCommand({
          runId: 'run_2',
          runFenceDigest: 'e'.repeat(64),
          idempotencyKeyDigest: 'f'.repeat(64),
          canonicalRequestDigest: '0'.repeat(64),
        })
      )
    ).resolves.toMatchObject({ code: 'ACQUIRED' });
    const beforeStaleTakeover = successor.safeStateSummary();
    await expect(
      successor.quiesceRun(
        quiesceCommand({
          runId: 'run_9',
          leaseFence: '1',
          runFenceDigest: 'b'.repeat(64),
          idempotencyKeyDigest: '0'.repeat(64),
          canonicalRequestDigest: '1'.repeat(64),
        })
      )
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(successor.safeStateSummary()).toEqual(beforeStaleTakeover);
    expect(successor.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 0 });
  });

  it('R17 quiesce draft faults are all-or-nothing', async () => {
    for (const stage of [
      'quiesce_after_capability_draft',
      'quiesce_after_ingest_outboxes_draft',
      'quiesce_after_lease_pair_draft',
    ] as const) {
      const { repository } = await activeRepository();
      await repository.issueCapability(issueCommand());
      const before = repository.safeStateSummary();
      repository.failNextAt(stage);
      await expect(repository.quiesceRun(quiesceCommand())).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('quiesce')).toEqual({ invocations: 1, commits: 0 });
      await expect(repository.quiesceRun(quiesceCommand())).resolves.toMatchObject({ code: 'QUIESCED' });
      expect(repository.operationCounts('quiesce')).toEqual({ invocations: 2, commits: 1 });
    }
  });

  it('R17 an unreached quiesce draft fault remains armed through stale authority', async () => {
    const { repository } = await activeRepository();
    await repository.issueCapability(issueCommand());
    await repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    const before = repository.safeStateSummary();
    repository.failNextAt('quiesce_after_ingest_outboxes_draft');
    await expect(repository.quiesceRun(quiesceCommand({ leaseFence: '2' }))).resolves.toEqual({
      code: 'STALE_FENCE',
    });
    expect(repository.safeStateSummary()).toEqual(before);
    await expect(repository.quiesceRun(quiesceCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(repository.safeStateSummary()).toEqual(before);
    await expect(repository.quiesceRun(quiesceCommand())).resolves.toMatchObject({
      code: 'QUIESCED',
      phase: 'quiescing',
    });
    expect(repository.operationCounts('quiesce')).toEqual({ invocations: 3, commits: 1 });
  });

  it('R10 status is read-only and honors captured expiry', async () => {
    const { repository, digestCalls } = await activeRepository();
    const before = repository.safeStateSummary();

    await expect(
      repository.getTransportStatus(transportStatusCommand({ now: '2026-07-20T00:00:59.999Z' }))
    ).resolves.toMatchObject({ code: 'TRANSPORT_STATUS', phase: 'active' });
    for (const now of [
      '2026-07-20T00:01:00.000Z',
      '2026-07-20T01:01:00.000+01:00',
      '2026-07-20T00:01:00.001Z',
    ])
      await expect(repository.getTransportStatus(transportStatusCommand({ now }))).resolves.toEqual({
        code: 'LEASE_EXPIRED',
        expiresAt: '2026-07-20T00:01:00.000Z',
      });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('status')).toEqual({ invocations: 4, commits: 0 });
    expect(digestCalls()).toBe(2);
  });

  it('R10 abandon-pending status is recoverable after expiry', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLifecycleState(abandonPendingSeed());
    const before = repository.safeStateSummary();

    await expect(repository.getTransportStatus(transportStatusCommand())).resolves.toEqual({
      code: 'TRANSPORT_STATUS',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'abandon_pending',
      consumedCapabilityCount: 0,
      terminalIntexMarkerCount: 0,
      terminalOutboxCount: 0,
      replyOrDeliveryWorkInFlight: 0,
      nonterminalIngestOutboxCount: 0,
      drained: false,
    });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('status')).toEqual({ invocations: 1, commits: 0 });
  });

  it('R19 status stale fence cannot read a successor', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLeaseState(terminalSeedPair('1'));
    await repository.acquireProvisioningLease(
      acquireCommand({
        runId: 'run_2',
        runFenceDigest: 'e'.repeat(64),
        idempotencyKeyDigest: 'f'.repeat(64),
        canonicalRequestDigest: '0'.repeat(64),
      })
    );
    const before = repository.safeStateSummary();
    await expect(
      repository.getTransportStatus(
        transportStatusCommand({ runId: 'run_9', runFenceDigest: 'b'.repeat(64) })
      )
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(repository.safeStateSummary()).toEqual(before);

    const serialized = await activeRepository();
    const statusGate = serialized.repository.deferNextBeforeAdmission('status');
    const afterAdmission = serialized.repository.getTransportStatus(
      transportStatusCommand({ now: '2026-07-20T00:00:04.000Z' })
    );
    await statusGate.entered;
    await serialized.repository.quiesceRun(quiesceCommand());
    statusGate.release();
    await expect(afterAdmission).resolves.toMatchObject({
      code: 'TRANSPORT_STATUS',
      phase: 'quiescing',
      drained: true,
    });
    expect(serialized.repository.operationCounts('status')).toEqual({ invocations: 1, commits: 0 });

    const statusBeforeMutation = await activeRepository();
    const mutationGate = statusBeforeMutation.repository.deferNextBeforeAdmission('quiesce');
    const pendingMutation = statusBeforeMutation.repository.quiesceRun(quiesceCommand());
    await mutationGate.entered;
    await expect(
      statusBeforeMutation.repository.getTransportStatus(transportStatusCommand({ now: '2026-07-20T00:00:04.000Z' }))
    ).resolves.toMatchObject({ code: 'TRANSPORT_STATUS', phase: 'active' });
    mutationGate.release();
    await expect(pendingMutation).resolves.toMatchObject({ code: 'QUIESCED', phase: 'quiescing' });
    expect(statusBeforeMutation.repository.operationCounts('status')).toEqual({ invocations: 1, commits: 0 });
  });

  it('R13 release creates one deterministic pending intent and receipt', async () => {
    const { repository, digestCalls } = await activeRepository();
    await repository.issueCapability(issueCommand());
    await repository.quiesceRun(quiesceCommand());

    await expect(repository.releaseRun(releaseCommand())).resolves.toEqual({
      code: 'RELEASE_PENDING',
      runId: 'run_1',
      leaseFence: '1',
      terminalControlId: 'terminal_release',
      eventId: 'terminal_release',
      createdAt: '2026-07-20T00:00:05.000Z',
    });
    expect(repository.safeStateSummary()).toMatchObject({
      version: 5,
      current: [
        {
          lease: {
            phase: 'release_pending',
            terminalControlOutboxIds: ['terminal_release'],
            terminalWinner: null,
            releasedAt: null,
            abandonedAt: null,
            drain: { drained: false },
          },
        },
      ],
      terminalControlOutboxes: [
        {
          terminalControlId: 'terminal_release',
          eventId: 'terminal_release',
          kind: 'release',
          status: 'pending',
          claim: null,
          acknowledgedAt: null,
          closedReason: null,
          closedAt: null,
          createdAt: '2026-07-20T00:00:05.000Z',
        },
      ],
    });
    expect(repository.operationCounts('release')).toEqual({ invocations: 1, commits: 1 });
    expect(digestCalls()).toBe(5);
  });

  it('R13 release requires exact quiesced drain and finalizing proof', async () => {
    const active = await activeRepository();
    const before = active.repository.safeStateSummary();
    await expect(active.repository.releaseRun(releaseCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'active',
    });
    expect(active.repository.safeStateSummary()).toEqual(before);

    await active.repository.issueCapability(issueCommand());
    await active.repository.quiesceRun(quiesceCommand());
    const quiesced = active.repository.safeStateSummary();
    await expect(
      active.repository.releaseRun(releaseCommand({ controlStatus: { kind: 'not_ready' } }))
    ).resolves.toEqual({ code: 'NOT_READY', gate: 'release' });
    expect(active.repository.safeStateSummary()).toEqual(quiesced);

    await expect(
      active.repository.releaseRun(
        releaseCommand({
          now: '2026-07-20T00:01:00.000Z',
          terminalControl: { ...releaseCommand().terminalControl, createdAt: '2026-07-20T00:01:00.000Z' },
        })
      )
    ).resolves.toEqual({ code: 'LEASE_EXPIRED', expiresAt: '2026-07-20T00:01:00.000Z' });
    const mismatchedStatus = releaseCommand().controlStatus;
    if (mismatchedStatus.kind !== 'status') throw new Error('release command requires a status proof');
    await expect(
      active.repository.releaseRun(
        releaseCommand({
          controlStatus: {
            ...mismatchedStatus,
            artifactStageDigest: 'd'.repeat(64),
          },
        })
      )
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });

    const consumedWork = await activeRepository();
    await consumedWork.repository.issueCapability(issueCommand());
    await consumedWork.repository.consumeCapabilityAndEnqueueIngest(consumeCommand());
    await consumedWork.repository.quiesceRun(quiesceCommand());
    const nonDrained = consumedWork.repository.safeStateSummary();
    await expect(consumedWork.repository.releaseRun(releaseCommand())).resolves.toEqual({
      code: 'PHASE_CONFLICT',
      actualPhase: 'quiescing',
    });
    expect(consumedWork.repository.safeStateSummary()).toEqual(nonDrained);
  });

  it('R13 release rejects every independently non-drained quiescing source without mutation', async () => {
    const pointed = seededCapability(401);
    const consumed = seededCapability(402, {
      consumedAt: '2026-07-20T00:00:03.000Z',
      consumedTransportMessageIdDigest: indexedDigest(8_403),
      ingestOutboxId: 'outbox_402',
    });
    const claimedOutbox = seededOutbox(402, 'claimed');
    const accepted = acceptedTransportReceipt(consumed.capability, claimedOutbox, indexedDigest(8_403));
    const cases = [
      [
        'a live unconsumed capability pointer',
        nonDrainedQuiescingSeed({
          issued: [pointed],
          unconsumedCapability: { digest: pointed.capability.capabilityDigest, phase: pointed.capability.phase },
          drain: {
            consumedCapabilityCount: 0,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        }),
      ],
      [
        'a nonterminal ingest outbox',
        nonDrainedQuiescingSeed({
          issued: [consumed],
          transportReceipts: [accepted],
          ingestOutboxes: [claimedOutbox],
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 1,
            terminalOutboxCount: 1,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        }),
      ],
      [
        'a consumed-vs-intex drain-count mismatch',
        nonDrainedQuiescingSeed({
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 1,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        }),
      ],
      [
        'a consumed-vs-outbox drain-count mismatch',
        nonDrainedQuiescingSeed({
          drain: {
            consumedCapabilityCount: 1,
            terminalIntexMarkerCount: 1,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        }),
      ],
      [
        'a terminal-intex-vs-outbox drain-count mismatch',
        nonDrainedQuiescingSeed({
          drain: {
            consumedCapabilityCount: 0,
            terminalIntexMarkerCount: 1,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 0,
            drained: false,
          },
        }),
      ],
      [
        'reply or delivery work in flight',
        nonDrainedQuiescingSeed({
          drain: {
            consumedCapabilityCount: 0,
            terminalIntexMarkerCount: 0,
            terminalOutboxCount: 0,
            replyOrDeliveryWorkInFlight: 1,
            drained: false,
          },
        }),
      ],
    ] as const;

    for (const [source, seed] of cases) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      try {
        repository.seedValidLifecycleState(seed);
      } catch {
        throw new Error(`valid seed rejected for ${source}`);
      }
      const before = repository.safeStateSummary();
      await expect(repository.releaseRun(releaseCommand())).resolves.toEqual({
        code: 'PHASE_CONFLICT',
        actualPhase: 'quiescing',
      });
      expect(repository.safeStateSummary()).toEqual(before);
      expect(repository.operationCounts('release')).toEqual({ invocations: 1, commits: 0 });
      expect(source).toBeTruthy();
    }
  });

  it('R13 receipt-first release replay wins outage and response loss', async () => {
    const { repository, digestCalls } = await activeRepository();
    await repository.issueCapability(issueCommand());
    await repository.quiesceRun(quiesceCommand());
    repository.loseNextResponseAfterCommit('release');
    await expect(repository.releaseRun(releaseCommand())).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    await expect(
      repository.releaseRun(
        releaseCommand({
          now: '2026-07-20T00:00:10.000Z',
          controlStatus: { kind: 'not_ready' },
        })
      )
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'release',
      result: 'release_pending',
      runId: 'run_1',
      leaseFence: '1',
      terminalControlId: 'terminal_release',
      eventId: 'terminal_release',
      createdAt: '2026-07-20T00:00:05.000Z',
    });
    await expect(
      repository.releaseRun(releaseCommand({ canonicalRequestDigest: 'd'.repeat(64) }))
    ).resolves.toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    const currentStatus = releaseCommand().controlStatus;
    if (currentStatus.kind !== 'status') throw new Error('release command requires a status proof');
    const staleReplay = releaseCommand({
      leaseFence: '2',
      controlStatus: { ...currentStatus, leaseFence: '2' },
      terminalControl: { ...releaseCommand().terminalControl, leaseFence: '2' },
    });
    await expect(repository.releaseRun(staleReplay)).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(repository.operationCounts('release')).toEqual({ invocations: 4, commits: 1 });
    expect(digestCalls()).toBe(5);
  });

  it('R17 release draft faults are atomic', async () => {
    for (const stage of ['release_after_terminal_outbox_draft', 'release_after_lease_pair_draft'] as const) {
      const { repository } = await activeRepository();
      await repository.issueCapability(issueCommand());
      await repository.quiesceRun(quiesceCommand());
      const before = repository.safeStateSummary();
      repository.failNextAt(stage);
      await expect(repository.releaseRun(releaseCommand())).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
      expect(repository.safeStateSummary()).toEqual(before);
      await expect(repository.releaseRun(releaseCommand())).resolves.toMatchObject({ code: 'RELEASE_PENDING' });
      expect(repository.operationCounts('release')).toEqual({ invocations: 2, commits: 1 });
    }
  });

  it('R14 expiry creates one abandoned intent without a winner', async () => {
    const { repository, digestCalls } = await activeRepository();

    await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toEqual({
      code: 'ABANDON_PENDING',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'abandon_pending',
      terminalControlId: 'terminal_abandoned',
      eventId: 'terminal_abandoned',
      reconciledAt: '2026-07-20T00:01:00.000Z',
    });
    expect(repository.safeStateSummary()).toMatchObject({
      version: 3,
      current: [
        {
          lease: {
            phase: 'abandon_pending',
            terminalControlOutboxIds: ['terminal_abandoned'],
            terminalWinner: null,
            releasedAt: null,
            abandonedAt: null,
            drain: { drained: false },
          },
        },
      ],
      terminalControlOutboxes: [
        {
          terminalControlId: 'terminal_abandoned',
          kind: 'abandoned',
          status: 'pending',
          claim: null,
          acknowledgedAt: null,
        },
      ],
    });
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 1, commits: 1 });
    expect(digestCalls()).toBe(2);
  });

  it('R14 abandonment honors before/equal/after expiry from every permitted source phase', async () => {
    const sourceSeeds = [
      provisioningCleanupSeed(),
      { ...issueConsumeSeed({ issued: [] }), terminalControlOutboxes: [] },
      quiescingSeed(),
      releasePendingSeed('pending'),
    ] satisfies FakeMatrixCorpusLifecycleSeed[];
    const commandAt = (now: string): AbandonExpiredRunCommand => {
      const base = abandonCommand();
      return abandonCommand({ now, terminalControl: { ...base.terminalControl, createdAt: now } });
    };

    for (const seed of sourceSeeds) {
      const beforeExpiry = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      beforeExpiry.seedValidLifecycleState(seed);
      const before = beforeExpiry.safeStateSummary();
      await expect(beforeExpiry.abandonExpiredRun(commandAt('2026-07-20T00:00:59.999Z'))).resolves.toEqual({
        code: 'NOT_READY',
        gate: 'abandon',
      });
      expect(beforeExpiry.safeStateSummary()).toEqual(before);
      expect(beforeExpiry.operationCounts('abandon')).toEqual({ invocations: 1, commits: 0 });

      for (const now of ['2026-07-20T00:01:00.000Z', '2026-07-20T00:01:00.001Z']) {
        const expired = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
        expired.seedValidLifecycleState(seed);
        await expect(expired.abandonExpiredRun(commandAt(now))).resolves.toMatchObject({
          code: 'ABANDON_PENDING',
          phase: 'abandon_pending',
          reconciledAt: now,
        });
        expect(expired.safeStateSummary().current[0]?.lease).toMatchObject({
          phase: 'abandon_pending',
          terminalWinner: null,
          releasedAt: null,
          abandonedAt: null,
        });
        expect(expired.operationCounts('abandon')).toEqual({ invocations: 1, commits: 1 });
      }
    }
  });

  it('R14 abandoned replay retains original intent across a new command time', async () => {
    const { repository } = await activeRepository();
    repository.loseNextResponseAfterCommit('abandon');
    await expect(repository.abandonExpiredRun(abandonCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    await expect(
      repository.abandonExpiredRun(
        abandonCommand({
          now: '2026-07-20T00:02:00.000Z',
          terminalControl: { ...abandonCommand().terminalControl, createdAt: '2026-07-20T00:02:00.000Z' },
        })
      )
    ).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
      result: 'abandon_pending',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'abandon_pending',
      terminalControlId: 'terminal_abandoned',
      eventId: 'terminal_abandoned',
      reconciledAt: '2026-07-20T00:01:00.000Z',
    });
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 2, commits: 1 });
  });

  it('R14 stale abandon authority is read-only before abandon replay or phase disclosure', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLifecycleState(abandonPendingSeed());
    const before = repository.safeStateSummary();
    const base = abandonCommand();
    await expect(
      repository.abandonExpiredRun(
        abandonCommand({
          observedLeaseFence: '2',
          terminalControl: { ...base.terminalControl, leaseFence: '2' },
        })
      )
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 1, commits: 0 });
  });

  it('R14 real fake stale abandon authority remains opaque after a durable abandonment', async () => {
    const { repository } = await activeRepository();
    await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
      code: 'ABANDON_PENDING',
      phase: 'abandon_pending',
    });
    const before = repository.safeStateSummary();
    const base = abandonCommand();
    await expect(
      repository.abandonExpiredRun(
        abandonCommand({
          observedLeaseFence: '2',
          terminalControl: { ...base.terminalControl, leaseFence: '2' },
        })
      )
    ).resolves.toEqual({ code: 'STALE_FENCE' });
    expect(repository.safeStateSummary()).toEqual(before);
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 2, commits: 1 });
  });

  it('R12/R14 abandonment preserves uncertainty', async () => {
    for (const status of ['pending', 'claimed'] as const) {
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidLifecycleState(releasePendingSeed(status));
      await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
        code: 'ABANDON_PENDING',
      });
      const terminalOutboxes = repository.safeStateSummary().terminalControlOutboxes;
      const release = terminalOutboxes.find((outbox) => outbox.kind === 'release');
      const abandoned = terminalOutboxes.find((outbox) => outbox.kind === 'abandoned');
      expect(abandoned).toMatchObject({ status: 'pending', terminalControlId: 'terminal_abandoned' });
      if (status === 'pending')
        expect(release).toMatchObject({ status: 'closed', closedReason: 'expired_unclaimed_release' });
      else expect(release).toMatchObject({ status: 'claimed', closedReason: null });
      expect(repository.safeStateSummary().current[0]?.lease).toMatchObject({
        phase: 'abandon_pending',
        terminalWinner: null,
        releasedAt: null,
        abandonedAt: null,
        terminalControlOutboxIds: ['terminal_release', 'terminal_abandoned'],
      });
    }
  });

  it('R14 abandonment closes only pending ingest work while retaining claimed and published work', async () => {
    for (const [index, status] of (['pending', 'claimed', 'published'] as const).entries()) {
      const outbox = seededOutbox(200 + index, status);
      const transportDigest = indexedDigest(8_200 + index);
      const consumedCapability = seededCapability(200 + index, {
        consumedAt: outbox.createdAt,
        consumedTransportMessageIdDigest: transportDigest,
        ingestOutboxId: outbox.ingestOutboxId,
      });
      const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
      repository.seedValidLifecycleState({
        ...issueConsumeSeed({
          issued: [consumedCapability],
          transportReceipts: [acceptedTransportReceipt(consumedCapability.capability, outbox, transportDigest)],
          ingestOutboxes: [outbox],
          leaseOverrides: {
            drain: {
              consumedCapabilityCount: 1,
              terminalIntexMarkerCount: 0,
              terminalOutboxCount: 0,
              replyOrDeliveryWorkInFlight: 0,
              drained: false,
            },
          },
        }),
        terminalControlOutboxes: [],
      });
      const before = repository.safeStateSummary();

      await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
        code: 'ABANDON_PENDING',
      });
      const after = repository.safeStateSummary();
      expect(after.ingestOutboxes[0]).toMatchObject({
        ingestOutboxId: outbox.ingestOutboxId,
        status: status === 'pending' ? 'closed' : status,
      });
      expect(after.current[0]?.lease.nonterminalIngestOutboxIds).toEqual(
        status === 'pending' ? [] : [outbox.ingestOutboxId]
      );
      if (status !== 'pending') expect(after.ingestOutboxes[0]).toEqual(before.ingestOutboxes[0]);
    }
  });

  it('R14 provisioning cleanup abandonment is durable only after expiry, survives faults, and replays', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLifecycleState(provisioningCleanupSeed());
    const before = repository.safeStateSummary();
    const base = abandonCommand();
    const beforeExpiry = abandonCommand({
      now: '2026-07-20T00:00:59.999Z',
      terminalControl: { ...base.terminalControl, createdAt: '2026-07-20T00:00:59.999Z' },
    });
    await expect(repository.abandonExpiredRun(beforeExpiry)).resolves.toEqual({ code: 'NOT_READY', gate: 'abandon' });
    expect(repository.safeStateSummary()).toEqual(before);

    repository.failNextAt('abandon_after_terminal_outbox_draft');
    await expect(repository.abandonExpiredRun(abandonCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(repository.safeStateSummary()).toEqual(before);

    repository.loseNextResponseAfterCommit('abandon');
    await expect(repository.abandonExpiredRun(abandonCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(repository.safeStateSummary().current[0]?.lease).toMatchObject({
      phase: 'abandon_pending',
      terminalControlOutboxIds: ['terminal_abandoned'],
    });
    await expect(
      repository.abandonExpiredRun(
        abandonCommand({
          now: '2026-07-20T00:02:00.000Z',
          terminalControl: { ...base.terminalControl, createdAt: '2026-07-20T00:02:00.000Z' },
        })
      )
    ).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
      result: 'abandon_pending',
      reconciledAt: '2026-07-20T00:01:00.000Z',
    });
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 4, commits: 1 });
  });

  it('R17 unreachable release-branch fault remains armed until release work is reachable', async () => {
    const repository = new FakeMatrixCorpusRepository({ replayProjectionDigest: { digest: () => digest } });
    repository.seedValidLifecycleState(releasePendingSeed('pending'));
    const before = repository.safeStateSummary();
    const early = abandonCommand({
      now: '2026-07-20T00:00:59.999Z',
      terminalControl: { ...abandonCommand().terminalControl, createdAt: '2026-07-20T00:00:59.999Z' },
    });
    repository.failNextAt('abandon_after_release_outbox_draft');
    await expect(repository.abandonExpiredRun(early)).resolves.toEqual({ code: 'NOT_READY', gate: 'abandon' });
    expect(repository.safeStateSummary()).toEqual(before);
    await expect(repository.abandonExpiredRun(abandonCommand())).rejects.toBeInstanceOf(
      FakeMatrixCorpusRepositoryFault
    );
    expect(repository.safeStateSummary()).toEqual(before);
    await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
      code: 'ABANDON_PENDING',
    });
    expect(repository.operationCounts('abandon')).toEqual({ invocations: 3, commits: 1 });
  });

  it('R17 abandonment faults only after each named real draft and dense response loss converges once', async () => {
    const activeWithPointedCapability = async (): Promise<FakeMatrixCorpusRepository> => {
      const { repository } = await activeRepository();
      await expect(repository.issueCapability(issueCommand())).resolves.toMatchObject({ code: 'CAPABILITY_ISSUED' });
      return repository;
    };
    const activeWithPendingIngest = async (): Promise<FakeMatrixCorpusRepository> => {
      const repository = await activeWithPointedCapability();
      await expect(repository.consumeCapabilityAndEnqueueIngest(consumeCommand())).resolves.toMatchObject({
        code: 'INGEST_ENQUEUED',
      });
      return repository;
    };
    const withPendingRelease = async (): Promise<FakeMatrixCorpusRepository> => {
      const { repository } = await activeRepository();
      await expect(repository.quiesceRun(quiesceCommand())).resolves.toMatchObject({ code: 'QUIESCED', drained: true });
      await expect(repository.releaseRun(releaseCommand())).resolves.toMatchObject({ code: 'RELEASE_PENDING' });
      return repository;
    };
    const faultCases = [
      {
        stage: 'abandon_after_capability_draft' as const,
        source: 'active pointed capability',
        prepare: activeWithPointedCapability,
        assertRealDraftSource: (summary: FakeMatrixCorpusCoreStateSummary): void => {
          expect(summary.current[0]?.lease.unconsumedCapability).not.toBeNull();
          expect(summary.capabilities[0]).toMatchObject({ consumedAt: null, revokedAt: null });
        },
      },
      {
        stage: 'abandon_after_ingest_outboxes_draft' as const,
        source: 'active pending ingest',
        prepare: activeWithPendingIngest,
        assertRealDraftSource: (summary: FakeMatrixCorpusCoreStateSummary): void => {
          expect(summary.ingestOutboxes).toMatchObject([{ ingestOutboxId: 'outbox_1', status: 'pending' }]);
          expect(summary.current[0]?.lease.nonterminalIngestOutboxIds).toEqual(['outbox_1']);
        },
      },
      {
        stage: 'abandon_after_release_outbox_draft' as const,
        source: 'release-pending terminal intent',
        prepare: withPendingRelease,
        assertRealDraftSource: (summary: FakeMatrixCorpusCoreStateSummary): void => {
          expect(summary.terminalControlOutboxes).toMatchObject([
            { terminalControlId: 'terminal_release', kind: 'release', status: 'pending' },
          ]);
        },
      },
      {
        stage: 'abandon_after_terminal_outbox_draft' as const,
        source: 'release-pending terminal intent',
        prepare: withPendingRelease,
        assertRealDraftSource: (summary: FakeMatrixCorpusCoreStateSummary): void => {
          expect(summary.terminalControlOutboxes).toMatchObject([
            { terminalControlId: 'terminal_release', kind: 'release', status: 'pending' },
          ]);
        },
      },
      {
        stage: 'abandon_after_lease_pair_draft' as const,
        source: 'release-pending terminal intent',
        prepare: withPendingRelease,
        assertRealDraftSource: (summary: FakeMatrixCorpusCoreStateSummary): void => {
          expect(summary.terminalControlOutboxes).toMatchObject([
            { terminalControlId: 'terminal_release', kind: 'release', status: 'pending' },
          ]);
        },
      },
    ] as const;

    for (const faultCase of faultCases) {
      const repository = await faultCase.prepare();
      const before = repository.safeStateSummary();
      faultCase.assertRealDraftSource(before);
      repository.failNextAt(faultCase.stage);
      await expect(repository.abandonExpiredRun(abandonCommand())).rejects.toBeInstanceOf(
        FakeMatrixCorpusRepositoryFault
      );
      expect(repository.safeStateSummary()).toEqual(before);
      await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
        code: 'ABANDON_PENDING',
      });
      expect(repository.operationCounts('abandon')).toEqual({ invocations: 2, commits: 1 });
      expect(faultCase.source).toBeTruthy();
    }

    const dense = await activeWithPendingIngest();
    const initialControl = abandonCommand().terminalControl;
    const initial = abandonCommand({
      terminalControl: initialControl,
      terminalPayloadDigest: createHash('sha256')
        .update(canonicalMatrixCorpusTerminalControlV1(initialControl))
        .digest('hex'),
    });
    dense.loseNextResponseAfterCommit('abandon');
    await expect(dense.abandonExpiredRun(initial)).rejects.toBeInstanceOf(FakeMatrixCorpusRepositoryFault);
    const durable = dense.safeStateSummary();
    expect(durable).toMatchObject({
      ingestOutboxes: [{ ingestOutboxId: 'outbox_1', status: 'closed', closedReason: 'abandoned' }],
      terminalControlOutboxes: [{ terminalControlId: 'terminal_abandoned', kind: 'abandoned', status: 'pending' }],
      current: [{ lease: { phase: 'abandon_pending', nonterminalIngestOutboxIds: [] } }],
    });
    const retryTerminalControl = {
      ...initial.terminalControl,
      createdAt: '2026-07-20T00:02:00.000Z',
    };
    const retry = abandonCommand({
      now: '2026-07-20T00:02:00.000Z',
      terminalControl: retryTerminalControl,
      terminalPayloadDigest: createHash('sha256')
        .update(canonicalMatrixCorpusTerminalControlV1(retryTerminalControl))
        .digest('hex'),
    });
    expect(canonicalMatrixCorpusTerminalControlV1(retry.terminalControl)).not.toBe(
      canonicalMatrixCorpusTerminalControlV1(initial.terminalControl)
    );
    expect(retry.terminalPayloadDigest).not.toBe(initial.terminalPayloadDigest);
    await expect(dense.abandonExpiredRun(retry)).resolves.toEqual({
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
      result: 'abandon_pending',
      runId: 'run_1',
      leaseFence: '1',
      phase: 'abandon_pending',
      terminalControlId: 'terminal_abandoned',
      eventId: 'terminal_abandoned',
      reconciledAt: '2026-07-20T00:01:00.000Z',
    });
    expect(dense.safeStateSummary()).toEqual(durable);
    expect(dense.operationCounts('abandon')).toEqual({ invocations: 2, commits: 1 });
  });

  it('keeps invalid issue and consume commands read-only and safe surfaces private', async () => {
    let digestCalls = 0;
    const invalid = new FakeMatrixCorpusRepository({
      replayProjectionDigest: { digest: () => ((digestCalls += 1), digest) },
    });
    const before = invalid.safeStateSummary();
    await expect(Reflect.apply(invalid.issueCapability, invalid, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(invalid.consumeCapabilityAndEnqueueIngest, invalid, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    expect(invalid.safeStateSummary()).toEqual(before);
    expect(digestCalls).toBe(0);
    expect(invalid.operationCounts('issue')).toEqual({ invocations: 1, commits: 0 });
    expect(invalid.operationCounts('consume')).toEqual({ invocations: 1, commits: 0 });

    const forbiddenBindingDigests = ['7'.repeat(64), '8'.repeat(64), '9'.repeat(64)] as const;
    const active = await activeRepository({
      matrixRoomBindingDigest: forbiddenBindingDigests[0],
      whatsappAccountBindingDigest: forbiddenBindingDigests[1],
      whatsappSenderBindingDigest: forbiddenBindingDigests[2],
    });
    const { repository } = active;
    const issueBase = issueCommand();
    const privateIssueCommand = issueCommand({
      capability: {
        ...issueBase.capability,
        matrixRoomBindingDigest: forbiddenBindingDigests[0],
        whatsappAccountBindingDigest: forbiddenBindingDigests[1],
        whatsappSenderBindingDigest: forbiddenBindingDigests[2],
      },
    });
    const consumeBase = consumeCommand();
    const privateConsumeCommand = {
      ...consumeBase,
      facts: {
        ...consumeBase.facts,
        ingressRequest: {
          ...consumeBase.facts.ingressRequest,
          matrixRoomBindingDigest: forbiddenBindingDigests[0],
          whatsappAccountBindingDigest: forbiddenBindingDigests[1],
          whatsappSenderBindingDigest: forbiddenBindingDigests[2],
        },
      },
    } satisfies ConsumeCapabilityAndEnqueueIngestCommand;
    const issued = await repository.issueCapability(privateIssueCommand);
    const consumed = await repository.consumeCapabilityAndEnqueueIngest(privateConsumeCommand);
    const summary = repository.safeStateSummary();
    const digestEvidence = active.digestEvidence();
    const digestEvidenceBeforeMutation = structuredClone(digestEvidence);
    const control = repository.deferNextBeforeAdmission('consume');
    const originalRelease = control.release;
    const sentinel = new FakeMatrixCorpusRepositoryFault();
    const exposedBeforeMutation = JSON.stringify({ issued, consumed, summary, digestEvidence, control, sentinel });
    for (const forbidden of [
      ...forbiddenBindingDigests,
      validIssueInput.rawCapability,
      validAcquireInput.idempotencyKey,
      validConsumeInput.transportMessageId,
      attestedPayload.ordinaryIngest.text,
      'private-room-id',
      'private-account-id',
      'private-sender-id',
      'person@example.test',
      'private-hmac-input',
      'private arbitrary exception',
    ])
      expect(exposedBeforeMutation).not.toContain(forbidden);
    Reflect.set(issued, 'runId', 'run_9');
    Reflect.set(consumed, 'ingestOutboxId', 'outbox_9');
    Reflect.set(control, 'release', () => undefined);
    Reflect.set(sentinel, 'message', 'private arbitrary exception');
    Reflect.set(summary, 'version', 999);
    Reflect.set(summary.capabilities[0] ?? {}, 'consumedAt', '2026-07-20T00:02:00.000Z');
    Reflect.set(summary.issuanceReceipts[0] ?? {}, 'capabilityDigest', indexedDigest(9_990));
    Reflect.set(summary.transportReceipts[0] ?? {}, 'terminalFailureCode', 'CAPABILITY_REPLAY');
    Reflect.set(summary.ingestOutboxes[0] ?? {}, 'status', 'closed');
    Reflect.set(digestEvidence[0] ?? {}, 'operation', 'consume');
    Reflect.set(digestEvidence, 'mutated', true);
    const firstCurrent = summary.current[0];
    const firstHistory = summary.histories[0];
    if (firstCurrent !== undefined) {
      Reflect.set(firstCurrent, 'leaseSlotDigest', indexedDigest(9_991));
      Reflect.set(firstCurrent.lease, 'phase', 'released');
      for (const values of [
        firstCurrent.lease.renewReceiptIds,
        firstCurrent.lease.capabilityIssuanceReceiptIds,
        firstCurrent.lease.capabilityDigests,
        firstCurrent.lease.terminalFailureReceiptRefs,
        firstCurrent.lease.nonterminalIngestOutboxIds,
        firstCurrent.lease.ingestOutboxIds,
        firstCurrent.lease.transportReceiptIds,
      ])
        Reflect.set(values, 0, 'mutated');
      Reflect.set(firstCurrent.lease.drain, 'consumedCapabilityCount', 999);
    }
    if (firstHistory !== undefined) Reflect.set(firstHistory, 'phase', 'abandoned');
    for (const values of [
      summary.current,
      summary.histories,
      summary.renewReceipts,
      summary.issuanceReceipts,
      summary.capabilities,
      summary.transportReceipts,
      summary.ingestOutboxes,
    ])
      Reflect.set(values, 'mutated', true);
    expect(active.digestEvidence()).toEqual(digestEvidenceBeforeMutation);
    originalRelease();
    expect(repository.safeStateSummary()).toMatchObject({
      version: 4,
      capabilities: [expect.objectContaining({ consumedAt: '2026-07-20T00:00:03.000Z' })],
      ingestOutboxes: [expect.objectContaining({ ingestOutboxId: 'outbox_1' })],
    });
    await expect(repository.issueCapability(privateIssueCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      runId: 'run_1',
    });
    await expect(repository.consumeCapabilityAndEnqueueIngest(privateConsumeCommand)).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      ingestOutboxId: 'outbox_1',
    });
    expect(active.digestEvidence()).toEqual([
      ...digestEvidenceBeforeMutation,
      { operation: 'issue', result: 'issued' },
    ]);
  });

  it('keeps lifecycle command failures and outbox inputs read-only and free of safe-surface secrets', async () => {
    const forbiddenBindingDigests = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)] as const;
    const capturedDependencyArguments: MatrixCorpusPersistedReplayProjectionV1[] = [];
    const digestEvidence: MatrixCorpusReplayProjectionEvidence[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          capturedDependencyArguments.push(structuredClone(projection));
          digestEvidence.push(safeReplayProjectionEvidence(projection));
          return digest;
        },
      },
    });

    await expect(
      repository.acquireProvisioningLease(
        acquireCommand({
          matrixRoomBindingDigest: forbiddenBindingDigests[0],
          whatsappAccountBindingDigest: forbiddenBindingDigests[1],
          whatsappSenderBindingDigest: forbiddenBindingDigests[2],
          runFenceDigest: '4'.repeat(64),
          idempotencyKeyDigest: '5'.repeat(64),
          canonicalRequestDigest: '6'.repeat(64),
        })
      )
    ).resolves.toMatchObject({ code: 'ACQUIRED' });
    await expect(
      repository.activateRun(
        activateCommand({
          runFenceDigest: '4'.repeat(64),
          idempotencyKeyDigest: '7'.repeat(64),
          canonicalRequestDigest: '8'.repeat(64),
        })
      )
    ).resolves.toMatchObject({ code: 'ACTIVATED' });
    await expect(
      repository.renewLease(
        renewCommand({
          runFenceDigest: '4'.repeat(64),
          idempotencyKeyDigest: '9'.repeat(64),
          canonicalRequestDigest: 'c'.repeat(64),
        })
      )
    ).resolves.toMatchObject({ code: 'LEASE_RENEWED' });

    const dependencySurface = JSON.stringify(digestEvidence);
    const dependencyArgumentSurface = JSON.stringify(capturedDependencyArguments);
    expect(digestEvidence).toHaveLength(3);
    expect(capturedDependencyArguments).toHaveLength(3);
    for (const forbidden of [
      ...forbiddenBindingDigests,
      validAcquireInput.idempotencyKey,
      validIssueInput.rawCapability,
      validConsumeInput.transportMessageId,
      attestedPayload.ordinaryIngest.text,
    ]) {
      expect(dependencySurface).not.toContain(forbidden);
      expect(dependencyArgumentSurface).not.toContain(forbidden);
    }

    const before = repository.safeStateSummary();
    await expect(Reflect.apply(repository.quiesceRun, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.releaseRun, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.abandonExpiredRun, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.getTransportStatus, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.cleanupExactRun, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.claimPendingIngestOutbox, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.renewIngestOutboxClaim, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(Reflect.apply(repository.acknowledgeIngestOutbox, repository, [undefined])).resolves.toEqual({
      code: 'CORRUPT_STATE',
      recordKind: 'command',
    });
    await expect(
      Reflect.apply(repository.claimPendingTerminalControlOutbox, repository, [undefined])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      Reflect.apply(repository.renewTerminalControlOutboxClaim, repository, [undefined])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    await expect(
      Reflect.apply(repository.acknowledgeTerminalControl, repository, [undefined])
    ).resolves.toEqual({ code: 'CORRUPT_STATE', recordKind: 'command' });
    const controls = [
      repository.deferNextBeforeAdmission('acquire'),
      repository.deferNextAfterCommit('renew'),
      new FakeMatrixCorpusRepositoryFault(),
      repository.safeStateSummary(),
      structuredClone(digestEvidence),
    ];
    const surface = JSON.stringify(controls);
    for (const forbidden of forbiddenBindingDigests) expect(surface).not.toContain(forbidden);
    for (const dependencyArgument of capturedDependencyArguments)
      expect(surface).not.toContain(JSON.stringify(dependencyArgument));
    expect(repository.safeStateSummary()).toEqual(before);
  });

  it('deep-clones every lifecycle result and terminal summary without exposing private authority', async () => {
    const privateBindingDigests = ['7'.repeat(64), '8'.repeat(64), '9'.repeat(64)] as const;
    const { repository } = await activeRepository({
      matrixRoomBindingDigest: privateBindingDigests[0],
      whatsappAccountBindingDigest: privateBindingDigests[1],
      whatsappSenderBindingDigest: privateBindingDigests[2],
    });
    const baseIssue = issueCommand();
    await repository.issueCapability(
      issueCommand({
        capability: {
          ...baseIssue.capability,
          matrixRoomBindingDigest: privateBindingDigests[0],
          whatsappAccountBindingDigest: privateBindingDigests[1],
          whatsappSenderBindingDigest: privateBindingDigests[2],
        },
      })
    );
    const quiesced = await repository.quiesceRun(quiesceCommand());
    const status = await repository.getTransportStatus(transportStatusCommand({ now: '2026-07-20T00:00:05.000Z' }));
    const released = await repository.releaseRun(releaseCommand());
    const abandoned = await repository.abandonExpiredRun(abandonCommand());
    const terminalSummary = repository.safeStateSummary();
    const expectedState = structuredClone(terminalSummary);
    const exposed = JSON.stringify({ quiesced, status, released, abandoned, terminalSummary });
    for (const forbidden of [
      ...privateBindingDigests,
      validIssueInput.rawCapability,
      validAcquireInput.idempotencyKey,
      validConsumeInput.transportMessageId,
      attestedPayload.ordinaryIngest.text,
    ])
      expect(exposed).not.toContain(forbidden);

    Reflect.set(quiesced, 'runId', 'run_9');
    Reflect.set(quiesced, 'drained', false);
    Reflect.set(status, 'phase', 'released');
    Reflect.set(status, 'replyOrDeliveryWorkInFlight', 999);
    Reflect.set(released, 'terminalControlId', 'terminal_mutated');
    Reflect.set(released, 'createdAt', '2026-07-20T00:02:00.000Z');
    Reflect.set(abandoned, 'terminalControlId', 'terminal_mutated');
    Reflect.set(abandoned, 'reconciledAt', '2026-07-20T00:02:00.000Z');
    Reflect.set(terminalSummary, 'version', 999);
    Reflect.set(terminalSummary.terminalControlOutboxes[0] ?? {}, 'status', 'published');
    Reflect.set(terminalSummary.current[0]?.lease.terminalControlOutboxIds ?? [], 0, 'terminal_mutated');

    await expect(repository.quiesceRun(quiesceCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'quiesce',
      phase: 'quiescing',
    });
    await expect(
      repository.getTransportStatus(transportStatusCommand({ now: '2026-07-20T00:02:00.000Z' }))
    ).resolves.toMatchObject({ code: 'TRANSPORT_STATUS', phase: 'abandon_pending' });
    await expect(repository.releaseRun(releaseCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'release',
      terminalControlId: 'terminal_release',
    });
    await expect(repository.abandonExpiredRun(abandonCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      operation: 'abandon',
      terminalControlId: 'terminal_abandoned',
    });
    expect(repository.safeStateSummary()).toEqual(expectedState);
  });

  it('deep-clones result, control, sentinel, summary, and captured-digest surfaces', async () => {
    const capturedDependencyArguments: MatrixCorpusPersistedReplayProjectionV1[] = [];
    const digestEvidence: MatrixCorpusReplayProjectionEvidence[] = [];
    const repository = new FakeMatrixCorpusRepository({
      replayProjectionDigest: {
        digest: (projection) => {
          capturedDependencyArguments.push(projection);
          digestEvidence.push(safeReplayProjectionEvidence(projection));
          return digest;
        },
      },
    });
    const acquireGate = repository.deferNextBeforeAdmission('acquire');
    const originalRelease = acquireGate.release;
    const pendingAcquire = repository.acquireProvisioningLease(acquireCommand());
    await acquireGate.entered;
    Reflect.set(acquireGate, 'release', () => undefined);
    originalRelease();
    const acquired = await pendingAcquire;
    const originalRunId = acquired.code === 'ACQUIRED' ? acquired.runId : '';
    Reflect.set(acquired, 'runId', 'run_9');
    const activated = await repository.activateRun(activateCommand());
    Reflect.set(activated, 'phase', 'provisioning');
    const renewed = await repository.renewLease(renewCommand());
    Reflect.set(renewed, 'renewedAt', timestamp);
    for (const argument of capturedDependencyArguments) Reflect.set(argument, 'runId', 'run_9');
    for (const evidence of digestEvidence) Reflect.set(evidence, 'operation', 'consume');
    capturedDependencyArguments.splice(0, capturedDependencyArguments.length);
    digestEvidence.splice(0, digestEvidence.length);
    const sentinel = new FakeMatrixCorpusRepositoryFault();
    Reflect.set(sentinel, 'message', 'private arbitrary exception');
    Reflect.set(sentinel, 'name', 'private sentinel');

    expect(originalRunId).toBe('run_1');
    await expect(repository.acquireProvisioningLease(acquireCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      runId: 'run_1',
    });
    await expect(repository.activateRun(activateCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      phase: 'active',
    });
    await expect(repository.renewLease(renewCommand())).resolves.toMatchObject({
      code: 'ALREADY_APPLIED',
      renewedAt: '2026-07-20T00:00:02.000Z',
    });
    expect(new FakeMatrixCorpusRepositoryFault()).toMatchObject({
      name: 'FakeMatrixCorpusRepositoryFault',
      message: 'FAKE_MATRIX_CORPUS_REPOSITORY_FAULT',
    });
  });
});
