/* eslint-disable @typescript-eslint/explicit-function-return-type -- Stateful boundary fixtures preserve the exact inferred client result literals. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  IntexAgentServiceClient,
  MatrixCorpusArtifactDeliveryResult,
  MatrixCorpusEvidenceResult,
  MatrixCorpusProjectionRequest,
  WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import {
  safeToolFactNameV1Schema,
  safeToolFactV1Schema,
  type MatrixCorpusSignedControlMutationV1,
  type SafeDeterministicCheckV1,
  type SafeToolFactV1,
} from '@intexuraos/http-contracts';

import type { MiniMaxEvaluator } from '../../minimaxJudge.js';
import type {
  MatrixClient,
  MatrixTargetSyncResult,
  MatrixTimelineEvent,
} from '../../live/matrixClient.js';
import {
  digestMatrixReply,
  MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX,
} from '../../matrixCorpus/correlation.js';
import type { MatrixCorpusPreparedContext } from '../../matrixCorpus/liveRuntime.js';
import {
  MATRIX_CORPUS_PREFLIGHT_CHECKS,
  type MatrixCorpusPreflightResult,
} from '../../matrixCorpus/preflight.js';
import type {
  CanonicalMatrixCorpus,
  CanonicalMatrixCorpusScenario,
} from '../../matrixCorpus/types.js';

const RUN_ID = 'eval-123e4567-e89b-42d3-a456-426614174000';
const USER_ID = 'private-user-sentinel';
const LEASE_FENCE = '7';
const NOW = '2026-07-21T10:00:00.000Z';
const REVISION = 'a'.repeat(40);

interface ScenarioProgress {
  readonly sessionId: string;
  lastTurnIndex: number;
  eventRevision: number;
  readonly replies: Map<number, string>;
}

interface IssuedTurn {
  readonly scenarioId: string;
  readonly turnIndex: number;
  readonly phase: 'start' | 'turn' | 'confirmation';
}

interface SharedState {
  readonly catalog: CanonicalMatrixCorpus;
  readonly trace: string[];
  readonly metrics: MatrixCorpusCompositionMetrics;
  readonly progress: Map<string, ScenarioProgress>;
  readonly matrixEvents: MatrixTimelineEvent[];
  issued: IssuedTurn | null;
  transportPhase:
    | 'provisioning'
    | 'active'
    | 'quiescing'
    | 'release_pending'
    | 'released'
    | 'abandoned';
  revision: number;
  lifecycle: 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
  retentionReconciled: boolean;
  artifactStageDigest: string | null;
  contextTombstoneDigest: string | null;
  terminalControlEventId: string | null;
  activeTurns: number;
  terminalProjectionObserved: boolean;
  terminalAcknowledged: boolean;
  readonly failArtifactReady: boolean;
  readonly failMiniMaxScenarioNumber: number | null;
  readonly failMiniMaxInfrastructureScenarioNumber: number | null;
  readonly finalizedScenarioContextCount: number;
  readonly wrongPuppetScenarioNumber: number | null;
  readonly advanceEventRevisionAfterBindingScenarioNumber: number | null;
  readonly deferBindingUntilQuiesceScenarioNumber: number | null;
  readonly scenarioStatusReads: Map<string, number>;
  readonly conflictStoppedScenarioProjectionOnce: boolean;
  stoppedScenarioProjectionConflictInjected: boolean;
  readonly hangInitialCursor: boolean;
  readonly dropReplyScenarioNumber: number | null;
  readonly rawDateReplyScenarioNumber: number | null;
  readonly missingConfirmationScenarioNumber: number | null;
  readonly transportBusyAfterMessageNumber: number | null;
  transportBusyReadsRemaining: number;
  readonly onReplyWaitStarted: () => void;
}

export interface MatrixCorpusCompositionHarnessOptions {
  readonly failArtifactReady?: boolean;
  readonly failMiniMaxScenarioNumber?: number;
  readonly failMiniMaxInfrastructureScenarioNumber?: number;
  readonly finalizedScenarioContextCount?: number;
  readonly wrongPuppetScenarioNumber?: number;
  readonly advanceEventRevisionAfterBindingScenarioNumber?: number;
  readonly deferBindingUntilQuiesceScenarioNumber?: number;
  readonly conflictStoppedScenarioProjectionOnce?: boolean;
  readonly hangInitialCursor?: boolean;
  readonly dropReplyScenarioNumber?: number;
  readonly rawDateReplyScenarioNumber?: number;
  readonly missingConfirmationScenarioNumber?: number;
  readonly transportBusyAfterMessageNumber?: number;
}

export interface MatrixCorpusCompositionMetrics {
  maxConcurrentTurns: number;
  initialCursorCaptures: number;
  readonly matrixSyncSince: (string | undefined)[];
  readonly matrixMessages: string[];
  readonly leaseRenewalKeys: string[];
  deepSeekAgentCalls: number;
  confirmationAgentCalls: number;
  miniMaxJudgeCalls: number;
  readonly scenarioProjectionSessions: string[];
  readonly scenarioProjectionEventWatermarks: number[];
  readonly scenarioProjectionDeterministicChecks: SafeDeterministicCheckV1[][];
  readonly judgeAssistantTexts: string[];
  transportReadinessChecks: number;
  artifactDeliveryStatus: 'pending' | 'staged' | 'ready' | 'failed';
  artifactDeliveryFailureCode:
    | 'REPORT_STAGING_INTERRUPTED'
    | 'REPORT_STAGING_FAILED'
    | 'REPORT_VALIDATION_FAILED'
    | 'REPORT_PUBLICATION_FAILED'
    | null;
  readonly artifactDeliveryTransitions: Readonly<Record<string, unknown>>[];
  productionExecutorResolutions: 0;
  productionExecutorAdmissions: 0;
}

export interface MatrixCorpusCompositionHarness {
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly matrix: MatrixClient;
  readonly whatsapp: WhatsAppServiceClient;
  readonly intex: IntexAgentServiceClient;
  readonly evaluator: MiniMaxEvaluator;
  readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
  readonly prepared: MatrixCorpusPreparedContext;
  readonly metrics: MatrixCorpusCompositionMetrics;
  readonly trace: string[];
  readonly replyWaitStarted: Promise<void>;
  readonly now: () => Date;
  readonly cleanup: () => Promise<void>;
}

export async function createPassingMatrixCorpusCompositionHarness(
  catalog: CanonicalMatrixCorpus,
  options: MatrixCorpusCompositionHarnessOptions = {}
): Promise<MatrixCorpusCompositionHarness> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'matrix-corpus-composition-'));
  const trace: string[] = [];
  let resolveReplyWaitStarted: (() => void) | null = null;
  const replyWaitStarted = new Promise<void>((resolve) => {
    resolveReplyWaitStarted = resolve;
  });
  const metrics: MatrixCorpusCompositionMetrics = {
    maxConcurrentTurns: 0,
    initialCursorCaptures: 0,
    matrixSyncSince: [],
    matrixMessages: [],
    leaseRenewalKeys: [],
    deepSeekAgentCalls: 0,
    confirmationAgentCalls: 0,
    miniMaxJudgeCalls: 0,
    scenarioProjectionSessions: [],
    scenarioProjectionEventWatermarks: [],
    scenarioProjectionDeterministicChecks: [],
    judgeAssistantTexts: [],
    transportReadinessChecks: 0,
    artifactDeliveryStatus: 'pending',
    artifactDeliveryFailureCode: null,
    artifactDeliveryTransitions: [],
    productionExecutorResolutions: 0,
    productionExecutorAdmissions: 0,
  };
  const state: SharedState = {
    catalog,
    trace,
    metrics,
    progress: new Map(),
    matrixEvents: [],
    issued: null,
    transportPhase: 'provisioning',
    revision: 0,
    lifecycle: 'preflight',
    retentionReconciled: false,
    artifactStageDigest: null,
    contextTombstoneDigest: null,
    terminalControlEventId: null,
    activeTurns: 0,
    terminalProjectionObserved: false,
    terminalAcknowledged: false,
    failArtifactReady: options.failArtifactReady ?? false,
    failMiniMaxScenarioNumber: options.failMiniMaxScenarioNumber ?? null,
    failMiniMaxInfrastructureScenarioNumber:
      options.failMiniMaxInfrastructureScenarioNumber ?? null,
    finalizedScenarioContextCount: options.finalizedScenarioContextCount ?? 20,
    wrongPuppetScenarioNumber: options.wrongPuppetScenarioNumber ?? null,
    advanceEventRevisionAfterBindingScenarioNumber:
      options.advanceEventRevisionAfterBindingScenarioNumber ?? null,
    deferBindingUntilQuiesceScenarioNumber: options.deferBindingUntilQuiesceScenarioNumber ?? null,
    scenarioStatusReads: new Map(),
    conflictStoppedScenarioProjectionOnce: options.conflictStoppedScenarioProjectionOnce ?? false,
    stoppedScenarioProjectionConflictInjected: false,
    hangInitialCursor: options.hangInitialCursor ?? false,
    dropReplyScenarioNumber: options.dropReplyScenarioNumber ?? null,
    rawDateReplyScenarioNumber: options.rawDateReplyScenarioNumber ?? null,
    missingConfirmationScenarioNumber: options.missingConfirmationScenarioNumber ?? null,
    transportBusyAfterMessageNumber: options.transportBusyAfterMessageNumber ?? null,
    transportBusyReadsRemaining: 0,
    onReplyWaitStarted: () => resolveReplyWaitStarted?.(),
  };

  return {
    runId: RUN_ID,
    repositoryRoot,
    matrix: createMatrixBoundary(state),
    whatsapp: createWhatsAppBoundary(state),
    intex: createIntexBoundary(state),
    evaluator: createMiniMaxBoundary(state),
    preflight: passingPreflight(catalog),
    prepared: {
      account: {
        userId: USER_ID,
        matrixUserId: '@private_user_sentinel:example.test',
        homeserverUrl: 'https://matrix.example.test',
        accessToken: 'private-token-sentinel',
        targetRoomId: '!private-room-sentinel:example.test',
      },
      accountAlias: 'Primary test account',
      expectedPuppetSender: '@whatsapp_lid-private-puppet-sentinel:example.test',
    },
    metrics,
    trace,
    replyWaitStarted,
    now: () => new Date(NOW),
    cleanup: async () => await rm(repositoryRoot, { recursive: true, force: true }),
  };
}

function createMatrixBoundary(state: SharedState): MatrixClient {
  let cursor = 0;
  return {
    async whoAmI() {
      return { ok: true, userId: '@private_user_sentinel:example.test' };
    },
    async syncTargetRoom(input) {
      state.metrics.matrixSyncSince.push(input.since);
      cursor += 1;
      if (input.timeoutMs === 0) {
        state.metrics.initialCursorCaptures += 1;
        if (state.hangInitialCursor) return await matrixTimeoutAfterAbort(input.signal);
        return { ok: true, nextBatch: `batch_${String(cursor)}`, limited: false, events: [] };
      }
      const event = state.matrixEvents.shift();
      if (event === undefined) return await matrixTimeoutAfterAbort(input.signal);
      if (event.sender.startsWith('@whatsapp_lid-')) {
        state.trace.push(`matrix:reply:${event.eventId ?? 'missing'}`);
      }
      return {
        ok: true,
        nextBatch: `batch_${String(cursor)}`,
        limited: false,
        events: [event],
      };
    },
  };
}

async function matrixTimeoutAfterAbort(signal: AbortSignal): Promise<MatrixTargetSyncResult> {
  if (signal.aborted) return { ok: false, reason: 'timeout' };
  return await new Promise<MatrixTargetSyncResult>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve({ ok: false, reason: 'timeout' });
      },
      { once: true }
    );
  });
}

function createWhatsAppBoundary(state: SharedState): WhatsAppServiceClient {
  return {
    async getMatrixCorpusReadiness() {
      return { ok: true, value: { status: 'ready' } };
    },
    async getPrivateMatrixDeliveryStatus() {
      throw new Error('unexpected private delivery readiness call');
    },
    async provisionMatrixCorpusRun({ runId }) {
      state.transportPhase = 'provisioning';
      return {
        ok: true,
        value: {
          code: 'ACQUIRED',
          runId,
          phase: 'provisioning',
          leaseFence: LEASE_FENCE,
          acquiredAt: NOW,
          expiresAt: '2026-07-21T10:30:00.000Z',
        },
      };
    },
    async activateMatrixCorpusRun({ runId, leaseFence }) {
      state.transportPhase = 'active';
      return {
        ok: true,
        value: { code: 'ACTIVATED', runId, leaseFence, phase: 'active', activatedAt: NOW },
      };
    },
    async renewMatrixCorpusLease({ runId, leaseFence, idempotencyKey }) {
      state.metrics.leaseRenewalKeys.push(idempotencyKey);
      state.trace.push(`lease:${idempotencyKey}`);
      if (idempotencyKey.includes(':reply:')) state.onReplyWaitStarted();
      return {
        ok: true,
        value: {
          code: 'LEASE_RENEWED',
          runId,
          leaseFence,
          phase: 'active',
          renewedAt: NOW,
          expiresAt: '2026-07-21T10:30:00.000Z',
        },
      };
    },
    async issueMatrixCorpusCapability(input) {
      if (state.transportBusyReadsRemaining > 0) {
        return { ok: false, error: { code: 'rejected' as const, httpStatus: 409 } };
      }
      state.issued = {
        scenarioId: input.scenarioId,
        turnIndex: input.turnIndex,
        phase: input.phase,
      };
      return {
        ok: true,
        value: {
          code: 'CAPABILITY_ISSUED',
          runId: input.runId,
          leaseFence: input.leaseFence,
          scenarioId: input.scenarioId,
          phase: input.phase,
          turnIndex: input.turnIndex,
          issuedAt: NOW,
          expiresAt: '2026-07-21T10:05:00.000Z',
        },
      };
    },
    async sendPrivateOutboundMatrixMessage(request) {
      const issued = state.issued;
      if (issued === null) throw new Error('turn capability was not issued');
      const entry = findEntry(state.catalog, issued.scenarioId);
      const progress =
        state.progress.get(issued.scenarioId) ??
        createScenarioProgress(entry, state.progress.size + 1);
      state.progress.set(issued.scenarioId, progress);
      const reply =
        entry.scenarioNumber === state.rawDateReplyScenarioNumber && issued.turnIndex === 0
          ? 'Event created for 2026-08-18T14:30:00.000Z.'
          : entry.scenarioNumber === 1 && issued.turnIndex === 0
            ? 'Add this note?\n\nContent: private INTEX-EVAL-001-F01 content'
            : `Scenario ${String(entry.scenarioNumber).padStart(3, '0')} turn ${String(issued.turnIndex + 1)} completed.`;
      const expectedTurn = entry.scenario.expected.turns[issued.turnIndex];
      if (expectedTurn === undefined) throw new Error('turn expectation is missing');
      const matrixReply = expectedTurn.timeline.requiredEventTypes.includes(
        'confirmation_requested'
      )
        ? `${reply}${MATRIX_WHATSAPP_CONFIRMATION_MIRROR_SUFFIX}`
        : reply;
      progress.lastTurnIndex = issued.turnIndex;
      progress.eventRevision = issued.turnIndex + 1;
      progress.replies.set(issued.turnIndex, reply);
      const eventOrdinal = state.metrics.matrixMessages.length + 1;
      const matrixEventId = `$matrix_outbound_${String(eventOrdinal)}`;
      state.matrixEvents.push({
        eventId: matrixEventId,
        originServerTs: Date.parse(NOW) + state.metrics.matrixMessages.length,
        type: 'm.room.message',
        sender: '@private_user_sentinel:example.test',
        content: { msgtype: 'm.text', body: request.text },
      });
      if (entry.scenarioNumber !== state.dropReplyScenarioNumber) {
        state.matrixEvents.push({
          eventId: `$matrix_reply_${String(state.metrics.matrixMessages.length + 1)}`,
          originServerTs: Date.parse(NOW) + state.metrics.matrixMessages.length,
          type: 'm.room.message',
          sender:
            entry.scenarioNumber === state.wrongPuppetScenarioNumber
              ? '@whatsapp_lid-wrong-puppet-sentinel:example.test'
              : '@whatsapp_lid-private-puppet-sentinel:example.test',
          content: { msgtype: 'm.text', body: matrixReply },
        });
      }
      state.metrics.matrixMessages.push(request.text);
      if (state.metrics.matrixMessages.length === state.transportBusyAfterMessageNumber) {
        state.transportBusyReadsRemaining = 1;
      }
      state.activeTurns += 1;
      state.metrics.maxConcurrentTurns = Math.max(
        state.metrics.maxConcurrentTurns,
        state.activeTurns
      );
      if (issued.phase === 'confirmation' || isIdleNewSessionTurn(entry, issued.turnIndex)) {
        state.metrics.confirmationAgentCalls += 0;
      } else {
        state.metrics.deepSeekAgentCalls += 1;
      }
      return { ok: true, value: { status: 'sent', matrixEventId } };
    },
    async recordMatrixCorpusSendProof(input) {
      return {
        ok: true,
        value: {
          code: 'MATRIX_SEND_PROOF_RECORDED',
          runId: input.runId,
          leaseFence: input.leaseFence,
          scenarioId: input.scenarioId,
          phase: input.phase,
          turnIndex: input.turnIndex,
          recordedAt: NOW,
        },
      };
    },
    async authorizeMatrixCorpusControl(input) {
      return {
        ok: true,
        value: {
          code: 'AUTHORIZED',
          authorization: authorization(input.leaseFence),
        },
      };
    },
    async getMatrixCorpusTransportStatus({ runId, leaseFence }) {
      state.metrics.transportReadinessChecks += 1;
      const transportBusy = state.transportBusyReadsRemaining > 0;
      if (transportBusy) state.transportBusyReadsRemaining -= 1;
      if (state.transportPhase === 'quiescing') state.trace.push('drain');
      return {
        ok: true,
        value: {
          code: 'TRANSPORT_STATUS',
          runId,
          leaseFence,
          phase: state.transportPhase,
          consumedCapabilityCount: state.metrics.matrixMessages.length,
          terminalIntexMarkerCount: state.transportPhase === 'released' ? 1 : 0,
          terminalOutboxCount: state.transportPhase === 'released' ? 1 : 0,
          replyOrDeliveryWorkInFlight: 0,
          nonterminalIngestOutboxCount: transportBusy ? 1 : 0,
          drained: state.transportPhase === 'quiescing' || state.transportPhase === 'released',
        },
      };
    },
    async quiesceMatrixCorpusRun({ runId, leaseFence }) {
      state.transportPhase = 'quiescing';
      state.trace.push('quiesce');
      return {
        ok: true,
        value: {
          code: 'QUIESCED',
          runId,
          leaseFence,
          phase: 'quiescing',
          quiescedAt: NOW,
          drained: true,
        },
      };
    },
    async releaseMatrixCorpusRun({ runId, leaseFence }) {
      state.transportPhase = 'released';
      state.trace.push('release');
      return {
        ok: true,
        value: {
          code: 'RELEASE_PENDING',
          runId,
          leaseFence,
          phase: 'release_pending',
          createdAt: NOW,
        },
      };
    },
    async abortProvisioningMatrixCorpusRun({ runId, leaseFence }) {
      state.transportPhase = 'abandoned';
      return {
        ok: true,
        value: {
          code: 'ABANDON_PENDING',
          runId,
          leaseFence,
          phase: 'abandon_pending',
          reconciledAt: NOW,
        },
      };
    },
    async cleanupMatrixCorpusRun() {
      throw new Error('retention cleanup must not target the current-only fixture');
    },
  };
}

function createIntexBoundary(state: SharedState): IntexAgentServiceClient {
  return {
    async getMatrixCorpusCurrentAcceptance() {
      return { ok: true, value: { kind: 'admission_ready', current: 'absent' } };
    },
    async registerMatrixCorpusContext(input) {
      return {
        ok: true,
        value: {
          disposition: 'applied',
          runId: input.runId,
          userId: input.request.userId,
          leaseFence: input.request.leaseFence,
          promptPreferencesVersion: 1,
          promptPreferencesDigest: 'b'.repeat(64),
          agentModel: 'or:deepseek/deepseek-v4-flash',
          userTimeZone: 'Europe/Warsaw',
          expiresAt: '2026-07-21T10:30:00.000Z',
        },
      };
    },
    async mutateMatrixCorpusProjection(input) {
      const request = input.request;
      if (request.kind === 'create') {
        state.revision = 1;
        state.lifecycle = 'preflight';
      } else {
        const expectedRevision = readExpectedRevision(request);
        if (expectedRevision !== state.revision) {
          return { ok: false, error: { code: 'rejected', httpStatus: 409 } };
        }
        const scenario = request.command['scenario'];
        if (
          state.conflictStoppedScenarioProjectionOnce &&
          !state.stoppedScenarioProjectionConflictInjected &&
          scenario !== null &&
          scenario !== undefined &&
          (scenario as Readonly<Record<string, unknown>>)['lifecycle'] === 'stopped'
        ) {
          state.stoppedScenarioProjectionConflictInjected = true;
          state.revision += 1;
          return { ok: false, error: { code: 'rejected', httpStatus: 409 } };
        }
        state.revision += 1;
        const command = request.command;
        if (command['retentionReconciled'] === true) state.retentionReconciled = true;
        if (command['scenario'] !== null && command['scenario'] !== undefined) {
          const scenario = command['scenario'] as Readonly<Record<string, unknown>>;
          state.metrics.scenarioProjectionSessions.push(String(scenario['sessionId']));
          state.metrics.scenarioProjectionEventWatermarks.push(Number(scenario['eventWatermark']));
          const projection = scenario['projection'] as Readonly<Record<string, unknown>>;
          state.metrics.scenarioProjectionDeterministicChecks.push(
            structuredClone(projection['deterministicChecks'] as SafeDeterministicCheckV1[])
          );
          state.lifecycle = 'running';
        }
      }
      return {
        ok: true,
        value: projectionResult(state),
      };
    },
    async getMatrixCorpusRetentionPlan() {
      return {
        ok: true,
        value: {
          kind: 'retention_plan',
          runId: RUN_ID,
          userId: USER_ID,
          leaseFence: LEASE_FENCE,
          records: [
            {
              runId: RUN_ID,
              leaseFence: LEASE_FENCE,
              startedAt: NOW,
              lifecycle: state.lifecycle,
              verdict: 'pending',
              artifactDelivery: 'pending',
              completedAt: null,
              isCurrent: true,
            },
          ],
        },
      };
    },
    async getMatrixCorpusScenarioStatus(input) {
      const entry = findEntry(state.catalog, input.scenarioId);
      const progress = state.progress.get(input.scenarioId);
      if (progress === undefined) return { ok: true, value: { kind: 'not_ready' } };
      const priorReads = state.scenarioStatusReads.get(input.scenarioId) ?? 0;
      state.scenarioStatusReads.set(input.scenarioId, priorReads + 1);
      if (
        entry.scenarioNumber === state.deferBindingUntilQuiesceScenarioNumber &&
        state.transportPhase === 'active'
      )
        return { ok: true, value: { kind: 'not_ready' } };
      const nextTurn = entry.scenario.turns[progress.lastTurnIndex + 1];
      const eventRevision = progress.eventRevision;
      if (
        entry.scenarioNumber === state.advanceEventRevisionAfterBindingScenarioNumber &&
        priorReads === 0
      )
        progress.eventRevision += 1;
      return {
        ok: true,
        value: {
          kind: 'status',
          runId: input.runId,
          userId: input.userId,
          leaseFence: input.leaseFence,
          scenarioId: input.scenarioId,
          sessionId: progress.sessionId,
          eventRevision,
          lifecycle: 'running',
          pendingConfirmationId:
            nextTurn?.kind === 'confirmation_button' &&
            entry.scenarioNumber !== state.missingConfirmationScenarioNumber
              ? `confirmation_${entry.scenarioNumber}`
              : null,
        },
      };
    },
    async getMatrixCorpusEvidence(input) {
      const entry = findEntry(state.catalog, input.scenarioId);
      const progress = requiredProgress(state, input.scenarioId);
      const evidence = evidenceFor(entry, progress);
      if (state.activeTurns > 0) state.activeTurns -= 1;
      return { ok: true, value: evidence };
    },
    async mutateMatrixCorpusArtifactDelivery(input) {
      const expectedRevision = Number(input.command['expectedRevision']);
      if (expectedRevision !== state.revision) {
        return { ok: false, error: { code: 'rejected', httpStatus: 409 } };
      }
      const next = input.command['next'];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      const record = next as Readonly<Record<string, unknown>>;
      const status = record['status'];
      if (status !== 'staged' && status !== 'ready' && status !== 'failed') {
        return { ok: false, error: { code: 'invalid_request' } };
      }
      state.metrics.artifactDeliveryTransitions.push(structuredClone(record));
      if (status === 'ready' && state.failArtifactReady) {
        return { ok: false, error: { code: 'rejected', httpStatus: 409 } };
      }
      state.revision += 1;
      if (status === 'staged') {
        const jsonDigest = String(record['jsonCandidateDigest']);
        const markdownDigest = String(record['markdownCandidateDigest']);
        state.artifactStageDigest = sha256(
          JSON.stringify({
            jsonCandidateDigest: jsonDigest,
            markdownCandidateDigest: markdownDigest,
          })
        );
        state.trace.push('artifact:staged');
      }
      if (status === 'ready') state.trace.push('artifact:ready');
      let artifactDelivery: MatrixCorpusArtifactDeliveryResult['artifactDelivery'];
      if (status === 'failed') {
        const failureCode = record['failureCode'];
        if (
          failureCode !== 'REPORT_STAGING_INTERRUPTED' &&
          failureCode !== 'REPORT_STAGING_FAILED' &&
          failureCode !== 'REPORT_VALIDATION_FAILED' &&
          failureCode !== 'REPORT_PUBLICATION_FAILED'
        ) {
          return { ok: false, error: { code: 'invalid_request' } };
        }
        artifactDelivery = { status, failureCode, updatedAt: NOW };
        state.metrics.artifactDeliveryFailureCode = failureCode;
      } else {
        artifactDelivery = { status, failureCode: null, updatedAt: NOW };
        state.metrics.artifactDeliveryFailureCode = null;
      }
      state.metrics.artifactDeliveryStatus = status;
      return {
        ok: true,
        value: {
          ...projectionResult(state),
          artifactDelivery,
        },
      };
    },
    async getMatrixCorpusFinalizationReadiness(input) {
      if (state.artifactStageDigest === null) {
        return { ok: true, value: { kind: 'not_ready' } };
      }
      return {
        ok: true,
        value: {
          kind: 'ready',
          runId: input.runId,
          userId: input.userId,
          leaseFence: input.leaseFence,
          revision: state.revision,
          projectionDigest: 'c'.repeat(64),
          artifactStageDigest: state.artifactStageDigest,
        },
      };
    },
    async finalizeMatrixCorpusContext(input) {
      if (input.request.expectedRevision !== state.revision) {
        return { ok: false, error: { code: 'rejected', httpStatus: 409 } };
      }
      state.revision += 1;
      state.lifecycle = 'finalizing';
      state.contextTombstoneDigest = 'd'.repeat(64);
      state.trace.push('context:finalized');
      return {
        ok: true,
        value: {
          disposition: 'applied',
          runId: input.runId,
          userId: input.request.userId,
          leaseFence: input.request.leaseFence,
          tombstoneDigest: state.contextTombstoneDigest,
          scenarioContextCount: state.finalizedScenarioContextCount,
          finalizedAt: NOW,
        },
      };
    },
    async getMatrixCorpusControlStatus(input) {
      if (
        state.lifecycle === 'finalizing' &&
        state.transportPhase !== 'released' &&
        !state.terminalProjectionObserved
      ) {
        state.terminalProjectionObserved = true;
        state.trace.push('terminal:projected');
      }
      if (state.transportPhase === 'released' && !state.terminalAcknowledged) {
        state.lifecycle = 'completed';
        state.terminalControlEventId = 'terminal_event_1';
        state.terminalAcknowledged = true;
        state.trace.push('terminal:acknowledged');
      }
      return {
        ok: true,
        value: {
          kind: 'status',
          runId: input.runId,
          userId: input.userId,
          leaseFence: input.leaseFence,
          lifecycle: state.lifecycle,
          revision: state.revision,
          contextReady: true,
          manifestReady: true,
          preflightProjectionReady: true,
          retentionReconciled: state.retentionReconciled,
          contextFinalizationTombstoneDigest: state.contextTombstoneDigest,
          terminalCandidateDigest: state.contextTombstoneDigest,
          artifactStageDigest: state.artifactStageDigest,
          terminalControlEventId: state.terminalControlEventId,
        },
      };
    },
    async cleanupMatrixCorpusRun() {
      throw new Error('retention cleanup must not target the current-only fixture');
    },
    async applyMatrixCorpusTerminalControl() {
      throw new Error('terminal control is owned by the transport fixture');
    },
  };
}

function createMiniMaxBoundary(state: SharedState): MiniMaxEvaluator {
  return {
    async probe() {
      return { ok: true };
    },
    async judgeReplies(inputs) {
      state.metrics.judgeAssistantTexts.push(...inputs.map((input) => input.assistantText));
      state.metrics.miniMaxJudgeCalls += inputs.length;
      for (const input of inputs) {
        state.trace.push(`judge:${input.scenarioId}:${String(input.turnIndex)}`);
      }
      const failedInput = inputs.find(
        (input) =>
          findEntry(state.catalog, input.scenarioId).scenarioNumber ===
          state.failMiniMaxInfrastructureScenarioNumber
      );
      if (failedInput !== undefined) {
        return {
          ok: false,
          code: 'MINIMAX_JUDGE_INVALID_OUTPUT',
          failedReply: {
            scenarioId: failedInput.scenarioId,
            turnIndex: failedInput.turnIndex,
            replyIndex: failedInput.replyIndex,
          },
          completedVerdicts: [],
          usage: {
            logicalCalls: 2,
            repairCount: 1,
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            providerReportedUsd: 0.000002,
            providerReportedUsdComplete: true,
          },
        };
      }
      return {
        ok: true,
        verdicts: inputs.map((input) => {
          const entry = findEntry(state.catalog, input.scenarioId);
          const pass = entry.scenarioNumber !== state.failMiniMaxScenarioNumber;
          return {
            scenarioId: input.scenarioId,
            turnIndex: input.turnIndex,
            replyIndex: input.replyIndex,
            pass,
            score: pass ? 5 : 2,
            criteria: {
              understoodIntent: true,
              helpful: pass,
              conciseAndClear: true,
              professionalTone: true,
              noPassiveAggression: true,
            },
            failures: pass ? [] : ['unhelpful' as const],
            rationale: pass
              ? 'Sanitized reply satisfies the scenario criteria.'
              : 'Sanitized reply does not satisfy the scenario criteria.',
          };
        }),
        usage: {
          logicalCalls: inputs.length,
          repairCount: 0,
          inputTokens: inputs.length * 10,
          outputTokens: inputs.length * 5,
          totalTokens: inputs.length * 15,
          providerReportedUsd: inputs.length * 0.000001,
          providerReportedUsdComplete: true,
        },
      };
    },
    async judgeMatrixSmokeReply() {
      throw new Error('Matrix smoke judge is outside corpus composition');
    },
  };
}

function evidenceFor(
  entry: CanonicalMatrixCorpusScenario,
  progress: ScenarioProgress
): MatrixCorpusEvidenceResult {
  const toolEvidence: MatrixCorpusEvidenceResult['toolEvidence'][number][] = [];
  const agentUsage: MatrixCorpusEvidenceResult['agentUsage'][number][] = [];
  const turnTerminals: MatrixCorpusEvidenceResult['turnTerminals'][number][] = [];
  for (let turnIndex = 0; turnIndex <= progress.lastTurnIndex; turnIndex += 1) {
    const expected = entry.scenario.expected.turns[turnIndex];
    const turn = entry.scenario.turns[turnIndex];
    const reply = progress.replies.get(turnIndex);
    if (expected === undefined || turn === undefined || reply === undefined) {
      throw new Error('composition evidence is incomplete');
    }
    for (const required of expected.requiredToolCalls) {
      for (let ordinal = 1; ordinal <= required.count; ordinal += 1) {
        toolEvidence.push({
          event: 'selected',
          toolName: required.toolName,
          turnIndex,
          ordinal,
          facts: passingSafeFacts(required.argumentAssertions),
        });
        toolEvidence.push({
          event: 'mock_completed',
          toolName: required.toolName,
          turnIndex,
          ordinal,
          facts: [],
        });
      }
    }
    if (turn.kind !== 'confirmation_button' && !isIdleNewSessionTurn(entry, turnIndex)) {
      agentUsage.push({
        turnIndex,
        stage: 'agent_generation',
        callOrdinal: 1,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costNanoUsd: 1_000,
      });
    }
    turnTerminals.push({
      status: 'completed',
      turnIndex,
      replyCount: 1,
      replyDigests: [digestMatrixReply(reply)],
      terminalMarkerDigest: createHash('sha256')
        .update(`terminal:${entry.scenario.id}:${String(turnIndex)}`, 'utf8')
        .digest('hex'),
      recordedAt: NOW,
    });
  }
  const totals = agentUsage.reduce(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + usage.inputTokens,
      outputTokens: sum.outputTokens + usage.outputTokens,
      totalTokens: sum.totalTokens + usage.totalTokens,
      costNanoUsd: sum.costNanoUsd + usage.costNanoUsd,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costNanoUsd: 0 }
  );
  return {
    version: 1,
    eventRevision: progress.eventRevision,
    toolEvidence,
    agentUsage,
    agentUsageTotals: totals,
    sessionProof: {
      status: 'waiting_for_user',
      startReason:
        entry.scenarioNumber === 9 || (entry.scenarioNumber === 4 && progress.lastTurnIndex >= 1)
          ? 'user_requested_new_session'
          : 'no_active_session',
      userMessageCount:
        entry.scenarioNumber === 9
          ? 0
          : entry.scenario.turns
              .slice(0, progress.lastTurnIndex + 1)
              .filter((turn) => turn.kind === 'message').length,
      sessionStartedCount: entry.scenarioNumber === 4 && progress.lastTurnIndex >= 1 ? 2 : 1,
      supersededSessionCount: entry.scenarioNumber === 4 && progress.lastTurnIndex >= 1 ? 1 : 0,
    },
    turnTerminals,
    strictMockProof: {
      version: 1,
      status: 'passed',
      executionMode: 'strict_mock_tools',
      mockProfileDigest: entry.mockProfileDigest,
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    },
  };
}

function isIdleNewSessionTurn(entry: CanonicalMatrixCorpusScenario, turnIndex: number): boolean {
  const expectation = entry.scenario.expected.turns[turnIndex];
  return (
    expectation?.sessionAfterTurn.startReason === 'user_requested_new_session' &&
    expectation.timeline.forbiddenEventTypes.includes('user_message')
  );
}

function passingSafeFacts(
  assertions: CanonicalMatrixCorpusScenario['scenario']['expected']['turns'][number]['requiredToolCalls'][number]['argumentAssertions']
): SafeToolFactV1[] {
  const facts: SafeToolFactV1[] = [];
  for (const assertion of assertions) {
    const name = safeToolFactNameV1Schema.safeParse(assertion.path);
    if (!name.success || assertion.operator === 'contains') continue;
    const value =
      assertion.operator === 'absent'
        ? false
        : assertion.operator === 'exists'
          ? 1
          : assertion.value;
    const fact = safeToolFactV1Schema.safeParse({ name: name.data, value });
    if (fact.success) facts.push(fact.data);
  }
  return facts;
}

function passingPreflight(
  catalog: CanonicalMatrixCorpus
): Extract<MatrixCorpusPreflightResult, { ok: true }> {
  return {
    ok: true,
    exitCode: 0,
    checks: MATRIX_CORPUS_PREFLIGHT_CHECKS,
    catalog,
    snapshot: {
      requestedRevision: REVISION,
      deployedRevision: REVISION,
      localCriticalPathsClean: true,
      remoteCriticalPathsClean: true,
      runtimeAudience: 'hetzner-prod',
      environmentAlias: 'prod',
      protectedConfigReady: true,
      servicesReady: true,
      clocksReady: true,
      userReady: true,
      accountTupleCount: 1,
      matrixReady: true,
      whatsappReady: true,
      capabilityBoundaryReady: true,
      strictMockToolCount: 11,
      catalogDigest: catalog.catalogDigest,
      scenarioCount: 20,
      turnCount: 59,
      catalogMatchesTracked: true,
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      modelBoundaryReady: true,
      runAdmission: 'absent',
      artifactRootReady: true,
      artifactCapacityReady: true,
      accountAlias: 'Primary test account',
    },
  };
}

function findEntry(
  catalog: CanonicalMatrixCorpus,
  scenarioId: string
): CanonicalMatrixCorpusScenario {
  const entry = catalog.scenarios.find((candidate) => candidate.scenario.id === scenarioId);
  if (entry === undefined) throw new Error(`unknown scenario ${scenarioId}`);
  return entry;
}

function createScenarioProgress(
  entry: CanonicalMatrixCorpusScenario,
  ordinal: number
): ScenarioProgress {
  return {
    sessionId: `matrix_session_${String(entry.scenarioNumber)}_${String(ordinal)}`,
    lastTurnIndex: -1,
    eventRevision: 0,
    replies: new Map(),
  };
}

function requiredProgress(state: SharedState, scenarioId: string): ScenarioProgress {
  const progress = state.progress.get(scenarioId);
  if (progress === undefined) throw new Error(`missing progress for ${scenarioId}`);
  return progress;
}

function readExpectedRevision(
  request: Extract<MatrixCorpusProjectionRequest, { kind: 'cas' }>
): number {
  const value = request.command['expectedRevision'];
  return typeof value === 'number' ? value : Number.NaN;
}

function projectionResult(state: SharedState) {
  return {
    disposition: 'applied' as const,
    runId: RUN_ID,
    userId: USER_ID,
    leaseFence: LEASE_FENCE,
    revision: state.revision,
    lifecycle: state.lifecycle,
    verdict: 'pending' as const,
  };
}

function authorization(leaseFence: string): MatrixCorpusSignedControlMutationV1 {
  return {
    version: 1,
    kind: 'matrix_corpus_control_mutation',
    eventId: `authorization_${leaseFence}`,
    leaseFence,
    payloadDigest: 'e'.repeat(64),
    attestation: 'aaa.bbb.ccc',
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
