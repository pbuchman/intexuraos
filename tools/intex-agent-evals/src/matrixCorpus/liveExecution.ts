import { createHash, randomBytes } from 'node:crypto';
import { join, relative } from 'node:path';

import {
  createIntexAgentServiceClient,
  createWhatsAppServiceClient,
  type IntexAgentServiceClient,
  type MatrixCorpusEvidenceResult,
  type MatrixCorpusScenarioStatusResult,
  type WhatsAppServiceClient,
} from '@intexuraos/internal-clients';
import {
  safeAgentUsageV1Schema,
  safeToolFactNameV1Schema,
  safeToolEvidenceV1Schema,
  type IntexAgentToolNameV1,
  type SafeAgentUsageV1,
  type SafeDeterministicCheckV1,
  type SafeDeterministicEvidenceV1,
  type SafeExpectedToolFactV1,
  type SafeReplyEvaluationV1,
  type SafeToolEvidenceV1,
} from '@intexuraos/http-contracts';

import type { ReplyEvaluationInput, ReplyTechnicalFacts } from '../deterministicEvaluator.js';
import { createMiniMaxEvaluator, type MiniMaxEvaluator } from '../minimaxJudge.js';
import type { IntexEvalScenario } from '../scenarioSchema.js';
import type { MatrixClient } from '../live/matrixClient.js';
import {
  captureMatrixCorpusCursor,
  collectCorrelatedReplies,
  proveMatrixCorpusOutboundEvent,
  type MatrixCorpusTurnTerminal,
} from './correlation.js';
import { createMatrixCorpusControlPlaneClient } from './controlPlaneClient.js';
import type { MatrixCorpusPreparedContext } from './liveRuntime.js';
import type { MatrixCorpusPreflightResult } from './preflight.js';
import {
  createNodeMatrixCorpusArtifactPort,
  publishMatrixCorpusArtifacts,
  stageMatrixCorpusArtifacts,
  type MatrixCorpusArtifactDeliveryPort,
  type StagedMatrixCorpusArtifacts,
} from './reportArtifacts.js';
import { type MatrixCorpusReportV1 } from './reportSchema.js';
import {
  createNodeMatrixCorpusRetentionSagaPort,
  reconcileMatrixCorpusRetention,
  type MatrixCorpusCleanupCounts,
  type MatrixCorpusRetentionSagaPort,
  type MatrixCorpusRetentionStats,
} from './retentionExecution.js';
import {
  runMatrixCorpus,
  type MatrixCorpusJudgeResult,
  type MatrixCorpusProjectionMutationResult,
  type MatrixCorpusRunPorts,
  type MatrixCorpusRunResult,
  type MatrixCorpusStoppedScenarioReconciliationResult,
  type MatrixCorpusTurnObservation,
} from './runMatrixCorpus.js';
import type { CanonicalMatrixCorpus, CanonicalMatrixCorpusScenario } from './types.js';
import { createProductionControlAuthorizationHeaderProvider } from './productionControlTransport.js';

const PRODUCTION_ORIGIN = 'https://intexuraos.cloud';
const INTEX_AGENT_EDGE_PREFIX = '/internal/evals/intex-agent';
const WHATSAPP_EDGE_PREFIX = '/internal/evals/whatsapp';
export const PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS = 3 * 60 * 1000;
export const PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS = 4 * 60 * 1000;
export const PRODUCTION_MATRIX_CORPUS_LEASE_TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 250;
const CORPUS_VERSION = '2026-07-19';
const CORPUS_ID = 'intex-agent-matrix-corpus';

interface ScenarioExecutionState {
  readonly entry: CanonicalMatrixCorpusScenario;
  startedAt: string | null;
  finishedAt: string | null;
  sessionId: string | null;
  eventRevision: number;
  projectionRevision: number;
  completedTurns: number;
  observedReplies: number;
  matrixSends: number;
  whatsappIngress: number;
  whatsappEgress: number;
  matrixMirrors: number;
  readonly replies: ReplyEvaluationInput[];
  readonly replyEvaluations: SafeReplyEvaluationV1[];
  toolEvidence: SafeToolEvidenceV1[];
  agentUsage: SafeAgentUsageV1[];
  readonly deterministicChecks: SafeDeterministicCheckV1[];
  deterministicPassed: boolean;
  strictMockProofTurns: number;
  strictMockProofReconciled: boolean;
  readonly failureCodes: string[];
}

interface LiveRunState {
  readonly runId: string;
  readonly catalog: CanonicalMatrixCorpus;
  readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
  readonly prepared: MatrixCorpusPreparedContext;
  readonly startedAt: string;
  leaseFence: string | null;
  revision: number;
  turnsSent: number;
  turnsCorrelated: number;
  finalizedScenarioContextCount: number;
  finalizedRunContextCount: number;
  released: boolean;
  terminalControlEventId: string | null;
  staged: StagedMatrixCorpusArtifacts | null;
  finalizationReadiness: {
    revision: number;
    projectionDigest: string;
    artifactStageDigest: string;
  } | null;
  retention: MatrixCorpusRetentionStats;
  readonly scenarios: Map<string, ScenarioExecutionState>;
}

export interface ProductionMatrixCorpusExecutorOptions {
  readonly matrix: MatrixClient;
  readonly repositoryRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly intex?: IntexAgentServiceClient;
  readonly whatsapp?: WhatsAppServiceClient;
  readonly evaluator?: MiniMaxEvaluator;
  readonly retentionSagas?: MatrixCorpusRetentionSagaPort;
  readonly correlationTimeoutMs?: number;
  readonly replyTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => Date;
}

export function createProductionMatrixCorpusExecutor(
  options: ProductionMatrixCorpusExecutorOptions
): (input: {
  readonly runId: string;
  readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
  readonly prepared: MatrixCorpusPreparedContext;
}) => Promise<{
  readonly run: MatrixCorpusRunResult;
  readonly reportReady: boolean;
  readonly relativeReportDirectory?: string;
}> {
  const env = options.env ?? process.env;
  const now = options.now ?? ((): Date => new Date());
  const logger = {
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
    debug: (): void => undefined,
  };
  const authorizationHeaderProvider = createProductionControlAuthorizationHeaderProvider();
  const intex =
    options.intex ??
    createIntexAgentServiceClient({
      baseUrl: PRODUCTION_ORIGIN,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 15_000,
      logger,
      pathPrefix: INTEX_AGENT_EDGE_PREFIX,
      authorizationHeaderProvider,
    });
  const whatsapp =
    options.whatsapp ??
    createWhatsAppServiceClient({
      baseUrl: PRODUCTION_ORIGIN,
      internalAuthToken: env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '',
      defaultTimeoutMs: 15_000,
      logger,
      pathPrefix: WHATSAPP_EDGE_PREFIX,
      authorizationHeaderProvider,
    });
  const evaluator =
    options.evaluator ??
    createMiniMaxEvaluator({ apiKey: env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '' });
  const control = createMatrixCorpusControlPlaneClient({ whatsapp, intex });
  const artifactRoot = join(options.repositoryRoot, '.artifacts', 'intex-agent-evals');
  const files = createNodeMatrixCorpusArtifactPort();
  const retentionSagas =
    options.retentionSagas ?? createNodeMatrixCorpusRetentionSagaPort(artifactRoot);

  return async (input) => {
    const state = createState(input, now);
    const delivery = createDeliveryPort(state, intex, now);
    const ports = createRunPorts({
      state,
      matrix: options.matrix,
      whatsapp,
      intex,
      evaluator,
      control,
      artifactRoot,
      files,
      retentionSagas,
      delivery,
      bindingHmacKey: env['INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY'] ?? '',
      correlationTimeoutMs:
        options.correlationTimeoutMs ?? PRODUCTION_MATRIX_CORPUS_CORRELATION_TIMEOUT_MS,
      replyTimeoutMs: options.replyTimeoutMs ?? PRODUCTION_MATRIX_CORPUS_REPLY_TIMEOUT_MS,
      pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
      now,
    });
    const run = await runMatrixCorpus(
      { runId: input.runId, catalog: input.preflight.catalog },
      ports
    );
    if (!run.terminalAcknowledged || !run.cleanupCompleted || state.staged === null) {
      return { run, reportReady: false };
    }
    const readyReport = buildReport(state, run, 'ready', now());
    const published = await publishMatrixCorpusArtifacts({
      staged: state.staged,
      report: readyReport,
      terminalAcknowledged: run.terminalAcknowledged,
      leaseReleased: state.released,
      files,
      delivery,
    });
    if (!published.ok) {
      return {
        run: withInfrastructureFailure(run, published.code),
        reportReady: false,
      };
    }
    return {
      run,
      reportReady: true,
      relativeReportDirectory: relative(options.repositoryRoot, published.reportDirectory),
    };
  };
}

function createRunPorts(input: {
  readonly state: LiveRunState;
  readonly matrix: MatrixClient;
  readonly whatsapp: WhatsAppServiceClient;
  readonly intex: IntexAgentServiceClient;
  readonly evaluator: MiniMaxEvaluator;
  readonly control: ReturnType<typeof createMatrixCorpusControlPlaneClient>;
  readonly artifactRoot: string;
  readonly files: ReturnType<typeof createNodeMatrixCorpusArtifactPort>;
  readonly retentionSagas: ReturnType<typeof createNodeMatrixCorpusRetentionSagaPort>;
  readonly delivery: MatrixCorpusArtifactDeliveryPort;
  readonly bindingHmacKey: string;
  readonly correlationTimeoutMs: number;
  readonly replyTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly now: () => Date;
}): MatrixCorpusRunPorts {
  const { state } = input;
  return {
    async provisionRun({ runId }): MatrixCorpusPortReturn<'provisionRun'> {
      const result = await input.whatsapp.provisionMatrixCorpusRun({
        runId,
        idempotencyKey: operationKey(runId, 'provision'),
      });
      if (!result.ok) return failed('provision_failed');
      state.leaseFence = result.value.leaseFence;
      return passed({ leaseFence: result.value.leaseFence });
    },

    async registerContext({
      runId,
      leaseFence,
      catalog,
    }): MatrixCorpusPortReturn<'registerContext'> {
      const result = await input.control.registerContext({
        runId,
        leaseFence,
        request: {
          runtimeAudience: 'hetzner-prod',
          userId: state.prepared.account.userId,
          leaseFence,
          catalogDigest: catalog.catalogDigest,
          agentModel: catalog.agentModel,
          evaluatorModel: catalog.evaluatorModel,
          expectedTimeZone: 'Europe/Warsaw',
        },
      });
      return result.ok ? passed(undefined) : failed('context_registration_failed');
    },

    async createProjection({
      runId,
      leaseFence,
      catalog,
    }): MatrixCorpusPortReturn<'createProjection'> {
      const result = await input.control.mutateProjection({
        runId,
        leaseFence,
        request: {
          kind: 'create',
          record: createInitialProjectionRecord(state, catalog, leaseFence),
        },
      });
      if (!result.ok) return failed('projection_creation_failed');
      state.revision = result.value.revision;
      return passed({ revision: result.value.revision });
    },

    async reconcileRetention({ runId, leaseFence }): MatrixCorpusPortReturn<'reconcileRetention'> {
      const result = await reconcileMatrixCorpusRetention({
        runId,
        userId: state.prepared.account.userId,
        leaseFence,
        currentRevision: state.revision,
        bindingHmacKey: input.bindingHmacKey,
        artifactRoot: input.artifactRoot,
        files: input.files,
        sagas: input.retentionSagas,
        intex: input.intex,
        whatsapp: input.whatsapp,
        now: input.now,
      });
      state.retention = result.stats;
      if (!result.ok) return failed(result.code);
      state.revision = result.revision;
      const reconciled = await input.control.mutateProjection({
        runId,
        leaseFence,
        request: {
          kind: 'cas',
          userId: state.prepared.account.userId,
          leaseFence,
          command: {
            expectedRevision: result.revision,
            nextLifecycle: 'preflight',
            updatedAt: input.now().toISOString(),
            retentionReconciled: true,
            scenario: null,
            finalization: null,
          },
        },
      });
      if (!reconciled.ok) return failed('retention_cleanup_failed');
      state.revision = reconciled.value.revision;
      return passed({ revision: reconciled.value.revision });
    },

    async activateRun({ runId, leaseFence }): MatrixCorpusPortReturn<'activateRun'> {
      const activated = await activateMatrixCorpusRunWithReconciliation({
        whatsapp: input.whatsapp,
        runId,
        leaseFence,
        idempotencyKey: operationKey(runId, 'activate'),
      });
      return activated ? passed(undefined) : failed('activation_failed');
    },

    async projectRunning(command): MatrixCorpusPortReturn<'projectRunning'> {
      const result = await input.control.mutateProjection({
        runId: command.runId,
        leaseFence: command.leaseFence,
        request: {
          kind: 'cas',
          userId: state.prepared.account.userId,
          leaseFence: command.leaseFence,
          command: {
            expectedRevision: command.expectedRevision,
            nextLifecycle: 'running',
            updatedAt: input.now().toISOString(),
            scenario: null,
            finalization: null,
          },
        },
      });
      if (!result.ok)
        return result.error.httpStatus === 409
          ? { ok: false, kind: 'revision_conflict', code: 'projection_revision_conflict' }
          : projectionFailed('running_projection_failed');
      state.revision = result.value.revision;
      return { ok: true, revision: result.value.revision };
    },

    async renewLease(command): MatrixCorpusPortReturn<'renewLease'> {
      const result = await input.whatsapp.renewMatrixCorpusLease({
        runId: command.runId,
        leaseFence: command.leaseFence,
        idempotencyKey: operationKey(
          command.runId,
          command.stage === 'turn'
            ? `renew:${command.scenarioId}:${String(command.turnIndex)}`
            : `judge:${command.scenarioId}:${String(command.turnIndex)}:${String(command.replyIndex)}`
        ),
      });
      return result.ok ? passed(undefined) : failed('lease_renewal_failed');
    },

    async executeTurn(command): MatrixCorpusPortReturn<'executeTurn'> {
      return await executeLiveTurn({ ...input, ...command });
    },

    async judgeReply({ model, reply }): Promise<MatrixCorpusJudgeResult> {
      const started = Date.now();
      const result = await input.evaluator.judgeReplies([reply]);
      if (!result.ok) return { ok: false, code: result.code };
      const verdict = result.verdicts[0];
      const nanoUsd = toNanoUsd(result.usage.providerReportedUsd);
      if (
        verdict?.scenarioId !== reply.scenarioId ||
        verdict.turnIndex !== reply.turnIndex ||
        verdict.replyIndex !== reply.replyIndex ||
        !isJudgeScore(verdict.score) ||
        !result.usage.providerReportedUsdComplete ||
        nanoUsd === null
      )
        return { ok: false, code: 'MINIMAX_JUDGE_USAGE_INVALID' };
      const safeEvaluation = toSafeReplyEvaluation(
        { ...verdict, score: verdict.score },
        result.usage.repairCount,
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.totalTokens,
        nanoUsd,
        Math.max(0, Date.now() - started)
      );
      state.scenarios.get(reply.scenarioId)?.replyEvaluations.push(safeEvaluation);
      return {
        ok: true,
        pass: verdict.pass,
        model,
        usage: {
          logicalCalls: result.usage.logicalCalls,
          repairCount: result.usage.repairCount,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          costNanoUsd: nanoUsd,
        },
      };
    },

    async projectScenario(command): MatrixCorpusPortReturn<'projectScenario'> {
      const scenario = state.scenarios.get(command.scenarioId);
      if (scenario?.sessionId === null || scenario === undefined)
        return projectionFailed('scenario_projection_missing_evidence');
      const updatedAt = input.now().toISOString();
      scenario.finishedAt = command.lifecycle === 'running' ? null : updatedAt;
      const projectionCommand = createScenarioProjectionCommand(
        state,
        scenario,
        command.expectedRevision,
        command.lifecycle,
        command.verdict,
        updatedAt
      );
      const result = await input.control.mutateProjection({
        runId: command.runId,
        leaseFence: command.leaseFence,
        request: {
          kind: 'cas',
          userId: state.prepared.account.userId,
          leaseFence: command.leaseFence,
          command: projectionCommand,
        },
      });
      if (!result.ok)
        return result.error.httpStatus === 409
          ? { ok: false, kind: 'revision_conflict', code: 'projection_revision_conflict' }
          : projectionFailed('scenario_projection_failed');
      state.revision = result.value.revision;
      scenario.projectionRevision += 1;
      return { ok: true, revision: result.value.revision };
    },

    async reconcileStoppedScenario(command): MatrixCorpusPortReturn<'reconcileStoppedScenario'> {
      const scenario = state.scenarios.get(command.scenarioId);
      if (scenario === undefined)
        return stoppedScenarioReconciliationFailed('stopped_scenario_missing');
      const status = await readScenarioStatus(
        input.intex,
        state,
        command.scenarioId,
        command.leaseFence
      );
      if (status === null) {
        if (scenario.sessionId !== null || command.observedSessionId !== null)
          return stoppedScenarioReconciliationFailed('stopped_scenario_status_missing');
        return {
          ok: true,
          revision: command.expectedRevision,
          disposition: 'not_bound',
          additionalAgentCostNanoUsd: 0,
        };
      }
      if (
        (command.observedSessionId !== null && command.observedSessionId !== status.sessionId) ||
        (scenario.sessionId !== null && scenario.sessionId !== status.sessionId)
      )
        return stoppedScenarioReconciliationFailed('stopped_scenario_binding_mismatch');
      const evidenceResult = await input.intex.getMatrixCorpusEvidence({
        ...identity(state, command.runId, command.leaseFence),
        scenarioId: command.scenarioId,
        sessionId: status.sessionId,
        eventRevision: status.eventRevision,
      });
      if (!evidenceResult.ok)
        return stoppedScenarioReconciliationFailed('stopped_scenario_evidence_missing');
      const evidence = evidenceResult.value;
      if (evidence.eventRevision !== status.eventRevision)
        return stoppedScenarioReconciliationFailed('stopped_scenario_evidence_revision_mismatch');
      if (evidence.strictMockProof.mockProfileDigest !== scenario.entry.mockProfileDigest)
        return stoppedScenarioReconciliationFailed('stopped_scenario_strict_mock_proof_failed');
      const safeToolEvidence = evidence.toolEvidence.flatMap((item) => {
        const parsed = safeToolEvidenceV1Schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      const safeAgentUsage = evidence.agentUsage.flatMap((item) => {
        const parsed = safeAgentUsageV1Schema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      if (
        safeToolEvidence.length !== evidence.toolEvidence.length ||
        safeAgentUsage.length !== evidence.agentUsage.length
      )
        return stoppedScenarioReconciliationFailed('stopped_scenario_unsafe_evidence_shape');
      const previousUsageTotals = sumAgentUsage(scenario.agentUsage);
      const usageTotals = sumAgentUsage(safeAgentUsage);
      if (
        usageTotals.inputTokens !== evidence.agentUsageTotals.inputTokens ||
        usageTotals.outputTokens !== evidence.agentUsageTotals.outputTokens ||
        usageTotals.totalTokens !== evidence.agentUsageTotals.totalTokens ||
        usageTotals.costNanoUsd !== evidence.agentUsageTotals.costNanoUsd
      )
        return stoppedScenarioReconciliationFailed('stopped_scenario_usage_totals_mismatch');
      if (usageTotals.costNanoUsd < previousUsageTotals.costNanoUsd)
        return stoppedScenarioReconciliationFailed('stopped_scenario_usage_regressed');
      const updatedAt = input.now().toISOString();
      const reconciledScenario: ScenarioExecutionState = {
        ...scenario,
        sessionId: status.sessionId,
        eventRevision: evidence.eventRevision,
        toolEvidence: safeToolEvidence,
        agentUsage: safeAgentUsage,
        strictMockProofReconciled: true,
        finishedAt: updatedAt,
      };
      const result = await input.control.mutateProjection({
        runId: command.runId,
        leaseFence: command.leaseFence,
        request: {
          kind: 'cas',
          userId: state.prepared.account.userId,
          leaseFence: command.leaseFence,
          command: createScenarioProjectionCommand(
            state,
            reconciledScenario,
            command.expectedRevision,
            'stopped',
            'not_evaluated',
            updatedAt
          ),
        },
      });
      if (!result.ok)
        return result.error.httpStatus === 409
          ? { ok: false, kind: 'revision_conflict', code: 'projection_revision_conflict' }
          : stoppedScenarioReconciliationFailed('stopped_scenario_projection_failed');
      state.revision = result.value.revision;
      scenario.sessionId = reconciledScenario.sessionId;
      scenario.eventRevision = reconciledScenario.eventRevision;
      scenario.toolEvidence = reconciledScenario.toolEvidence;
      scenario.agentUsage = reconciledScenario.agentUsage;
      scenario.strictMockProofReconciled = reconciledScenario.strictMockProofReconciled;
      scenario.finishedAt = reconciledScenario.finishedAt;
      scenario.projectionRevision += 1;
      return {
        ok: true,
        revision: result.value.revision,
        disposition: 'projected',
        additionalAgentCostNanoUsd: usageTotals.costNanoUsd - previousUsageTotals.costNanoUsd,
      };
    },

    async getProjectionRevision({
      runId,
      leaseFence,
    }): MatrixCorpusPortReturn<'getProjectionRevision'> {
      const status = await input.intex.getMatrixCorpusControlStatus(
        identity(state, runId, leaseFence)
      );
      if (!status.ok || status.value.kind !== 'status') return failed('projection_status_failed');
      state.revision = status.value.revision;
      return passed({ revision: status.value.revision });
    },

    async quiesceRun({ runId, leaseFence }): MatrixCorpusPortReturn<'quiesceRun'> {
      const result = await input.whatsapp.quiesceMatrixCorpusRun({
        runId,
        leaseFence,
        idempotencyKey: operationKey(runId, 'quiesce'),
      });
      return result.ok ? passed(undefined) : failed('quiesce_failed');
    },

    async waitForDrain({ runId, leaseFence }): MatrixCorpusPortReturn<'waitForDrain'> {
      const drained = await poll(
        async () => {
          const status = await input.whatsapp.getMatrixCorpusTransportStatus({ runId, leaseFence });
          return status.ok && status.value.drained ? true : undefined;
        },
        input.correlationTimeoutMs,
        input.pollIntervalMs
      );
      return drained ? passed(undefined) : failed('drain_timeout');
    },

    async stageArtifacts({ outcome }): MatrixCorpusPortReturn<'stageArtifacts'> {
      const pendingReport = buildReport(
        state,
        provisionalRunResult(state, outcome),
        'pending',
        input.now()
      );
      const staged = await stageMatrixCorpusArtifacts({
        artifactRoot: input.artifactRoot,
        report: pendingReport,
        files: input.files,
        delivery: input.delivery,
      });
      if (!staged.ok) return failed(staged.code);
      state.staged = staged.value;
      state.revision = staged.value.revision;
      return passed({
        artifactStageDigest: staged.value.artifactStageDigest,
        revision: staged.value.revision,
      });
    },

    async finalizeContext(command): MatrixCorpusPortReturn<'finalizeContext'> {
      const readiness = await input.intex.getMatrixCorpusFinalizationReadiness(
        identity(state, command.runId, command.leaseFence)
      );
      if (!readiness.ok || readiness.value.kind !== 'ready')
        return failed('finalization_readiness_failed');
      if (
        readiness.value.revision !== command.expectedRevision ||
        readiness.value.artifactStageDigest !== command.artifactStageDigest
      )
        return failed('finalization_readiness_mismatch');
      state.finalizationReadiness = readiness.value;
      const createdAt = input.now().toISOString();
      const result = await input.control.finalizeContext({
        runId: command.runId,
        leaseFence: command.leaseFence,
        request: {
          runtimeAudience: 'hetzner-prod',
          userId: state.prepared.account.userId,
          leaseFence: command.leaseFence,
          expectedRevision: command.expectedRevision,
          artifactStageDigest: command.artifactStageDigest,
          terminalCandidate: {
            version: 1,
            runId: command.runId,
            userId: state.prepared.account.userId,
            leaseFence: command.leaseFence,
            outcome: terminalOutcome(command.outcome),
            projectionDigest: readiness.value.projectionDigest,
            artifactStageRevision: readiness.value.revision,
            artifactCandidateDigest: readiness.value.artifactStageDigest,
            createdAt,
          },
        },
      });
      if (result.ok) {
        state.finalizedScenarioContextCount = result.value.scenarioContextCount;
        state.finalizedRunContextCount = 1;
      }
      return result.ok
        ? passed({ tombstoneDigest: result.value.tombstoneDigest })
        : failed('context_finalization_failed');
    },

    async projectFinalizing(command): MatrixCorpusPortReturn<'projectFinalizing'> {
      const status = await input.intex.getMatrixCorpusControlStatus(
        identity(state, command.runId, command.leaseFence)
      );
      if (
        !status.ok ||
        status.value.kind !== 'status' ||
        status.value.lifecycle !== 'finalizing' ||
        status.value.contextFinalizationTombstoneDigest !== command.tombstoneDigest ||
        status.value.artifactStageDigest !== command.artifactStageDigest
      )
        return projectionFailed('finalizing_projection_failed');
      state.revision = status.value.revision;
      return { ok: true, revision: status.value.revision };
    },

    async releaseRun({ runId, leaseFence }): MatrixCorpusPortReturn<'releaseRun'> {
      const result = await input.whatsapp.releaseMatrixCorpusRun({
        runId,
        leaseFence,
        idempotencyKey: operationKey(runId, 'release'),
      });
      return result.ok ? passed(undefined) : failed('release_failed');
    },

    async waitForTerminalAcknowledgement({
      runId,
      leaseFence,
    }): MatrixCorpusPortReturn<'waitForTerminalAcknowledgement'> {
      const terminal = await poll(
        async () => {
          const [transport, controlStatus] = await Promise.all([
            input.whatsapp.getMatrixCorpusTransportStatus({ runId, leaseFence }),
            input.intex.getMatrixCorpusControlStatus(identity(state, runId, leaseFence)),
          ]);
          if (
            !transport.ok ||
            transport.value.phase !== 'released' ||
            !controlStatus.ok ||
            controlStatus.value.kind !== 'status' ||
            !['completed', 'stopped'].includes(controlStatus.value.lifecycle) ||
            controlStatus.value.terminalControlEventId === null
          )
            return undefined;
          return controlStatus.value;
        },
        input.correlationTimeoutMs,
        input.pollIntervalMs
      );
      if (terminal === undefined) return failed('terminal_ack_timeout');
      state.released = true;
      state.revision = terminal.revision;
      state.terminalControlEventId = terminal.terminalControlEventId;
      return passed(undefined);
    },

    async cleanup({ runId, leaseFence }): MatrixCorpusPortReturn<'cleanup'> {
      if (state.released) return passed(undefined);
      const abort = await input.whatsapp.abortProvisioningMatrixCorpusRun({
        runId,
        leaseFence,
        idempotencyKey: operationKey(runId, 'abort-provisioning'),
      });
      if (!abort.ok) return failed('provisioning_abort_failed');
      const terminal = await poll(
        async () => {
          const status = await input.whatsapp.getMatrixCorpusTransportStatus({
            runId,
            leaseFence,
          });
          return status.ok && status.value.phase === 'abandoned' ? status.value : undefined;
        },
        input.correlationTimeoutMs,
        input.pollIntervalMs
      );
      if (terminal === undefined) return failed('provisioning_abort_ack_timeout');
      state.released = true;
      return passed(undefined);
    },
  };
}

export async function activateMatrixCorpusRunWithReconciliation(
  input: Readonly<{
    whatsapp: Pick<
      WhatsAppServiceClient,
      'activateMatrixCorpusRun' | 'getMatrixCorpusTransportStatus'
    >;
    runId: string;
    leaseFence: string;
    idempotencyKey: string;
  }>
): Promise<boolean> {
  const operation = {
    runId: input.runId,
    leaseFence: input.leaseFence,
    idempotencyKey: input.idempotencyKey,
  };
  const first = await input.whatsapp.activateMatrixCorpusRun(operation);
  if (first.ok) return true;

  const reconciled = await input.whatsapp.getMatrixCorpusTransportStatus({
    runId: input.runId,
    leaseFence: input.leaseFence,
  });
  if (!reconciled.ok) return false;
  if (reconciled.value.phase === 'active') return true;
  if (reconciled.value.phase !== 'provisioning') return false;

  const retry = await input.whatsapp.activateMatrixCorpusRun(operation);
  if (retry.ok) return true;
  const final = await input.whatsapp.getMatrixCorpusTransportStatus({
    runId: input.runId,
    leaseFence: input.leaseFence,
  });
  return final.ok && final.value.phase === 'active';
}

export async function sendMatrixMessageWithReconciliation(
  whatsapp: Pick<WhatsAppServiceClient, 'sendPrivateOutboundMatrixMessage'>,
  request: Parameters<WhatsAppServiceClient['sendPrivateOutboundMatrixMessage']>[0]
): Promise<Readonly<{ matrixEventId: string }> | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await whatsapp.sendPrivateOutboundMatrixMessage(request);
    if (result.ok && result.value.status === 'sent' && result.value.matrixEventId.trim() !== '')
      return { matrixEventId: result.value.matrixEventId };
    if (result.ok && result.value.status === 'setup_required') return null;
  }
  return null;
}

type MatrixCorpusPortReturn<TKey extends keyof MatrixCorpusRunPorts> = ReturnType<
  MatrixCorpusRunPorts[TKey]
>;

async function executeLiveTurn(input: {
  readonly state: LiveRunState;
  readonly matrix: MatrixClient;
  readonly whatsapp: WhatsAppServiceClient;
  readonly intex: IntexAgentServiceClient;
  readonly runId: string;
  readonly leaseFence: string;
  readonly scenario: IntexEvalScenario;
  readonly scenarioNumber: number;
  readonly turnIndex: number;
  readonly expectedSessionId: string | null;
  readonly correlationTimeoutMs: number;
  readonly replyTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly now: () => Date;
}): Promise<ReturnType<MatrixCorpusRunPorts['executeTurn']> extends Promise<infer T> ? T : never> {
  const state = input.state.scenarios.get(input.scenario.id);
  const entry = input.state.catalog.scenarios[input.scenarioNumber - 1];
  const turn = input.scenario.turns[input.turnIndex];
  const expectation = input.scenario.expected.turns[input.turnIndex];
  if (state === undefined || entry === undefined || turn === undefined || expectation === undefined)
    return { ok: false, kind: 'infrastructure_failure', code: 'turn_catalog_mismatch' };
  state.startedAt ??= input.now().toISOString();

  const cursor = await runWithMatrixCorpusDeadline(
    input.correlationTimeoutMs,
    async (signal) =>
      await captureMatrixCorpusCursor({
        matrix: input.matrix,
        context: input.state.prepared.account,
        signal,
      })
  );
  if (!cursor.ok) return { ok: false, kind: 'infrastructure_failure', code: cursor.code };

  const before =
    input.expectedSessionId === null
      ? null
      : await readScenarioStatus(input.intex, input.state, input.scenario.id, input.leaseFence);
  if (
    input.expectedSessionId !== null &&
    (before?.sessionId !== input.expectedSessionId ||
      (turn.kind === 'confirmation_button' && before.pendingConfirmationId === null))
  )
    return { ok: false, kind: 'safety_failure', code: 'scenario_status_mismatch' };

  const visible = visibleTurn(entry, turn, input.turnIndex);
  const capability = `imc1_${randomBytes(32).toString('base64url')}`;
  const phase =
    turn.kind === 'confirmation_button' ? 'confirmation' : input.turnIndex === 0 ? 'start' : 'turn';
  const startNewSession = phase === 'start';
  const matrixIdempotencyKey = operationKey(
    input.runId,
    `${input.scenario.id}:${String(input.turnIndex)}:matrix-send`
  );
  const issued = await input.whatsapp.issueMatrixCorpusCapability({
    runId: input.runId,
    leaseFence: input.leaseFence,
    idempotencyKey: matrixIdempotencyKey,
    capability,
    scenarioId: input.scenario.id,
    scenarioNumber: input.scenarioNumber,
    scenarioLabel: entry.scenarioLabel,
    promptNormalizationVersion: 1,
    promptDigest: digestPrompt(visible.body, startNewSession),
    phase,
    turnIndex: input.turnIndex,
    expectedSessionId: input.expectedSessionId,
    pendingConfirmationId:
      turn.kind === 'confirmation_button' ? (before?.pendingConfirmationId ?? null) : null,
    expectedDecision:
      turn.kind === 'confirmation_button'
        ? turn.decision === 'accept'
          ? 'confirm'
          : 'reject'
        : null,
    mockProfile: entry.mockProfile,
    mockProfileDigest: entry.mockProfileDigest,
    expectedToolSchedule: entry.expectedToolSchedule,
    currentDateTime: input.scenario.currentDateTime,
    timeZone: input.scenario.timeZone,
  });
  if (!issued.ok)
    return { ok: false, kind: 'infrastructure_failure', code: 'capability_issue_failed' };
  const messageText = `${visible.header(capability)}\n\n${visible.body}`;
  const sendRequest = {
    userId: input.state.prepared.account.userId,
    text: messageText,
    startNewSession: false,
    idempotencyKey: matrixIdempotencyKey,
  } as const;
  const sent = await sendMatrixMessageWithReconciliation(input.whatsapp, sendRequest);
  if (sent === null)
    return { ok: false, kind: 'safety_failure', code: 'matrix_outbound_ambiguous' };

  const observedProof = await runWithMatrixCorpusDeadline(
    input.correlationTimeoutMs,
    async (signal) =>
      await proveMatrixCorpusOutboundEvent({
        matrix: input.matrix,
        context: input.state.prepared.account,
        cursor: cursor.cursor,
        matrixUserId: input.state.prepared.account.matrixUserId,
        matrixEventId: sent.matrixEventId,
        messageText,
        signal,
      })
  );
  if (!observedProof.ok) return { ok: false, kind: 'safety_failure', code: observedProof.code };
  const attached = await input.whatsapp.recordMatrixCorpusSendProof({
    runId: input.runId,
    leaseFence: input.leaseFence,
    idempotencyKey: matrixIdempotencyKey,
    capability,
    scenarioId: input.scenario.id,
    scenarioNumber: input.scenarioNumber,
    phase,
    turnIndex: input.turnIndex,
    matrixEventId: sent.matrixEventId,
    matrixRoomId: input.state.prepared.account.targetRoomId,
    messageText,
  });
  if (!attached.ok)
    return { ok: false, kind: 'safety_failure', code: 'matrix_send_proof_rejected' };
  input.state.turnsSent += 1;
  state.matrixSends += 1;

  const status = await poll(
    async () => {
      const current = await readScenarioStatus(
        input.intex,
        input.state,
        input.scenario.id,
        input.leaseFence
      );
      if (
        current === null ||
        (input.expectedSessionId !== null && current.sessionId !== input.expectedSessionId)
      )
        return undefined;
      return current;
    },
    input.correlationTimeoutMs,
    input.pollIntervalMs
  );
  if (status === undefined)
    return { ok: false, kind: 'infrastructure_failure', code: 'scenario_binding_timeout' };
  state.sessionId = status.sessionId;
  state.eventRevision = status.eventRevision;

  const replyLeaseRenewal = await input.whatsapp.renewMatrixCorpusLease({
    runId: input.runId,
    leaseFence: input.leaseFence,
    idempotencyKey: operationKey(
      input.runId,
      `reply:${input.scenario.id}:${String(input.turnIndex)}`
    ),
  });
  if (!replyLeaseRenewal.ok)
    return {
      ok: false,
      kind: 'infrastructure_failure',
      code: 'lease_renewal_failed',
      boundSessionId: status.sessionId,
    };

  const evidenceCapture: { value: MatrixCorpusEvidenceResult | null } = { value: null };
  const correlated = await runWithMatrixCorpusDeadline(
    input.replyTimeoutMs,
    async (signal) =>
      await collectCorrelatedReplies({
        matrix: input.matrix,
        context: input.state.prepared.account,
        cursor: cursor.cursor,
        matrixUserId: input.state.prepared.account.matrixUserId,
        expectedPuppetSender: input.state.prepared.expectedPuppetSender,
        runId: input.runId,
        scenarioId: input.scenario.id,
        turnIndex: input.turnIndex,
        sessionId: status.sessionId,
        expectedReplyRendering: expectation.timeline.requiredEventTypes.includes(
          'confirmation_requested'
        )
          ? 'whatsapp_confirmation_buttons'
          : 'plain',
        signal,
        evidence: {
          async getTurnTerminal(): Promise<MatrixCorpusTurnTerminal> {
            const current = await readScenarioStatus(
              input.intex,
              input.state,
              input.scenario.id,
              input.leaseFence
            );
            if (current?.sessionId !== status.sessionId) return { status: 'pending' };
            const evidence = await input.intex.getMatrixCorpusEvidence({
              ...identity(input.state, input.runId, input.leaseFence),
              scenarioId: input.scenario.id,
              sessionId: status.sessionId,
              eventRevision: current.eventRevision,
            });
            if (!evidence.ok) return { status: 'pending' };
            evidenceCapture.value = evidence.value;
            const terminal = evidence.value.turnTerminals.find(
              (candidate) => candidate.turnIndex === input.turnIndex
            );
            if (terminal === undefined) return { status: 'pending' };
            return terminal.status === 'completed'
              ? {
                  status: 'completed',
                  replyCount: terminal.replyCount,
                  replyDigests: terminal.replyDigests,
                }
              : { status: 'failed', failureCode: terminal.failureCode };
          },
        },
      })
  );
  if (!correlated.ok || evidenceCapture.value === null)
    return {
      ok: false,
      kind: 'infrastructure_failure',
      code: correlated.ok ? 'turn_evidence_missing' : correlated.code,
      boundSessionId: status.sessionId,
    };

  input.state.turnsCorrelated += 1;
  state.whatsappIngress += 1;
  state.whatsappEgress += correlated.replies.length;
  state.matrixMirrors += correlated.replies.length;

  const evidence = evidenceCapture.value;
  state.eventRevision = evidence.eventRevision;
  if (evidence.strictMockProof.mockProfileDigest !== entry.mockProfileDigest)
    return {
      ok: false,
      kind: 'safety_failure',
      code: 'strict_mock_proof_failed',
      boundSessionId: status.sessionId,
    };
  const safeToolEvidence = evidence.toolEvidence.flatMap((item) => {
    const parsed = safeToolEvidenceV1Schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const safeAgentUsage = evidence.agentUsage.flatMap((item) => {
    const parsed = safeAgentUsageV1Schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  if (
    safeToolEvidence.length !== evidence.toolEvidence.length ||
    safeAgentUsage.length !== evidence.agentUsage.length
  )
    return {
      ok: false,
      kind: 'safety_failure',
      code: 'unsafe_evidence_shape',
      boundSessionId: status.sessionId,
    };
  const toolEvidence = safeToolEvidence.filter((item) => item.turnIndex === input.turnIndex);
  const agentUsage = safeAgentUsage.filter((item) => item.turnIndex === input.turnIndex);
  const selected = toolEvidence
    .filter((item) => item.event === 'selected')
    .map(({ toolName, ordinal }) => ({ toolName, ordinal }));
  const outcomes = toolEvidence
    .filter((item) => item.event === 'mock_completed' || item.event === 'mock_failed')
    .map(({ toolName, ordinal, event }) => ({
      toolName,
      ordinal,
      status: event === 'mock_completed' ? ('completed' as const) : ('failed' as const),
    }));
  const unexpectedKnownToolCount = toolEvidence.filter(
    (item) => item.event === 'unexpected_known_no_execution'
  ).length;
  const deterministicPassed =
    correlated.replies.length === expectation.replies.length &&
    sameToolSchedule(selected, expectation.requiredToolCalls) &&
    outcomes.every((item) => item.status === 'completed') &&
    unexpectedKnownToolCount === 0;
  const technicalFacts = buildTechnicalFacts(
    input.scenario,
    input.turnIndex,
    deterministicPassed,
    correlated.replies.length,
    selected,
    outcomes
  );
  const replyEvaluations = correlated.replies.map((reply, replyIndex) => ({
    scenarioId: input.scenario.id,
    turnIndex: input.turnIndex,
    replyIndex,
    assistantText: reply.body,
    semanticCriteria: expectation.replies[replyIndex]?.semanticCriteria ?? [
      'The assistant must not emit an unexpected extra reply for this turn.',
    ],
    technicalFacts,
  }));
  const turnUsage = sumAgentUsage(agentUsage);
  const observation: MatrixCorpusTurnObservation = {
    sessionId: status.sessionId,
    sessionEvidence: {
      kind: input.expectedSessionId === null ? 'created' : 'continued',
      scenarioLabel: entry.scenarioLabel,
    },
    agentModel: input.state.catalog.agentModel,
    observedReplyCount: correlated.replies.length,
    replyEvaluations,
    deterministicPassed,
    transportEvidence: {
      turnTerminal: 'completed',
      replyDigests: correlated.replies.map((reply) => reply.digest),
    },
    toolEvidence: {
      strictMockBoundary: true,
      selectedScheduled: selected,
      mockOutcomes: outcomes,
      unexpectedKnownToolCount,
    },
    confirmationEvidence:
      turn.kind === 'confirmation_button'
        ? {
            kind: 'resolved',
            previousTurnIndex: turn.previousTurnIndex,
            decision: turn.decision,
          }
        : { kind: 'not_applicable' },
    agentUsage: {
      ...turnUsage,
      providerCostReconciled: true,
    },
  };
  state.sessionId = status.sessionId;
  state.eventRevision = evidence.eventRevision;
  state.completedTurns += 1;
  state.strictMockProofTurns += 1;
  state.observedReplies += correlated.replies.length;
  state.replies.push(...replyEvaluations);
  state.toolEvidence = safeToolEvidence;
  state.agentUsage = safeAgentUsage;
  state.deterministicPassed &&= deterministicPassed;
  state.deterministicChecks.push(
    ...buildMatrixCorpusTurnChecks({
      turnIndex: input.turnIndex,
      expectation,
      actualReplyCount: correlated.replies.length,
      expectedTransition: input.expectedSessionId === null ? 'created' : 'continued',
      actualTransition: observation.sessionEvidence.kind,
      actualLifecycle: observation.transportEvidence.turnTerminal,
      toolEvidence,
    })
  );
  if (!deterministicPassed) state.failureCodes.push('DETERMINISTIC_EVIDENCE_FAILED');
  return deterministicPassed
    ? { ok: true, observation }
    : { ok: false, kind: 'behavioral_failure', code: 'deterministic_evidence_failed', observation };
}

function createState(
  input: {
    readonly runId: string;
    readonly preflight: Extract<MatrixCorpusPreflightResult, { ok: true }>;
    readonly prepared: MatrixCorpusPreparedContext;
  },
  now: () => Date
): LiveRunState {
  return {
    runId: input.runId,
    catalog: input.preflight.catalog,
    preflight: input.preflight,
    prepared: input.prepared,
    startedAt: now().toISOString(),
    leaseFence: null,
    revision: 0,
    turnsSent: 0,
    turnsCorrelated: 0,
    finalizedScenarioContextCount: 0,
    finalizedRunContextCount: 0,
    released: false,
    terminalControlEventId: null,
    staged: null,
    finalizationReadiness: null,
    retention: {
      status: 'passed',
      runs: emptyCleanupCounts(),
      sessions: emptyCleanupCounts(),
      capabilities: emptyCleanupCounts(),
      artifacts: emptyCleanupCounts(),
    },
    scenarios: new Map(
      input.preflight.catalog.scenarios.map((entry) => [
        entry.scenario.id,
        {
          entry,
          startedAt: null,
          finishedAt: null,
          sessionId: null,
          eventRevision: 0,
          projectionRevision: 0,
          completedTurns: 0,
          observedReplies: 0,
          matrixSends: 0,
          whatsappIngress: 0,
          whatsappEgress: 0,
          matrixMirrors: 0,
          replies: [],
          replyEvaluations: [],
          toolEvidence: [],
          agentUsage: [],
          deterministicChecks: [],
          deterministicPassed: true,
          strictMockProofTurns: 0,
          strictMockProofReconciled: false,
          failureCodes: [],
        },
      ])
    ),
  };
}

function createInitialProjectionRecord(
  state: LiveRunState,
  catalog: CanonicalMatrixCorpus,
  leaseFence: string
): Readonly<Record<string, unknown>> {
  const scenarios = catalog.scenarios.map(({ scenario, scenarioNumber, scenarioLabel }) => ({
    scenarioId: scenario.id,
    scenarioNumber,
    scenarioLabel,
    scenarioRevision: 0,
    eventWatermark: 0,
    lifecycle: 'not_run',
    verdict: 'pending',
    plannedTurns: scenario.turns.length,
    completedTurns: 0,
    expectedReplies: scenario.expected.turns.reduce(
      (sum, expectation) => sum + expectation.replies.length,
      0
    ),
    completedReplies: 0,
    selectedTools: [],
    deterministicVerdict: 'pending',
    semanticVerdict: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    sessionId: null,
    sessionBindingDigest: null,
  }));
  const expectedReplies = scenarios.reduce((sum, scenario) => sum + scenario.expectedReplies, 0);
  return {
    schemaVersion: 1,
    runId: state.runId,
    userId: state.prepared.account.userId,
    leaseFence,
    revision: 0,
    corpusId: CORPUS_ID,
    corpusVersion: CORPUS_VERSION,
    catalogDigest: catalog.catalogDigest,
    runtimeAudience: 'hetzner-prod',
    transport: 'matrix_whatsapp',
    executionMode: 'strict_mock_tools',
    lifecycle: 'preflight',
    verdict: 'pending',
    artifactDelivery: { status: 'pending', failureCode: null, updatedAt: state.startedAt },
    agentModel: catalog.agentModel,
    evaluatorModel: catalog.evaluatorModel,
    startedAt: state.startedAt,
    updatedAt: state.startedAt,
    finishedAt: null,
    currentScenarioNumber: null,
    totals: {
      scenarios: {
        planned: 20,
        started: 0,
        running: 0,
        completed: 0,
        passed: 0,
        failed: 0,
        notRun: 20,
      },
      turns: { planned: 59, completed: 0 },
      replies: { expected: expectedReplies, observed: 0, judged: 0 },
      tools: { selected: 0, mockCompleted: 0, mockFailed: 0, unexpectedKnown: 0 },
      evaluations: {
        deterministicPassed: 0,
        deterministicFailed: 0,
        minimaxPassed: 0,
        minimaxFailed: 0,
        pending: 20,
      },
    },
    cost: { agentNanoUsd: null, evaluatorNanoUsd: null, totalNanoUsd: null },
    retentionReconciled: false,
    contextFinalizationTombstoneDigest: null,
    artifactStageDigest: null,
    terminalCandidate: null,
    terminalWinner: null,
    scenarios,
  };
}

function createScenarioProjectionCommand(
  state: LiveRunState,
  scenario: ScenarioExecutionState,
  expectedRevision: number,
  lifecycle: 'running' | 'completed' | 'stopped',
  verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated',
  updatedAt: string
): Readonly<Record<string, unknown>> {
  const sessionId = scenario.sessionId;
  if (sessionId === null) throw new Error('missing session');
  const sessionBindingDigest = sha256(sessionId);
  const toolEvidence = [...scenario.toolEvidence].sort(compareToolEvidence);
  const deterministicChecks = [...scenario.deterministicChecks].sort(compareDeterministicChecks);
  const replyEvaluations = [...scenario.replyEvaluations].sort((left, right) =>
    compareCanonicalKeys(
      `${String(left.turnIndex)}:${String(left.replyIndex)}`,
      `${String(right.turnIndex)}:${String(right.replyIndex)}`
    )
  );
  const agentUsage = [...scenario.agentUsage].sort((left, right) =>
    compareCanonicalKeys(
      `${String(left.turnIndex)}:${left.stage}:${String(left.callOrdinal)}`,
      `${String(right.turnIndex)}:${right.stage}:${String(right.callOrdinal)}`
    )
  );
  const deterministicVerdict =
    lifecycle === 'stopped'
      ? 'not_evaluated'
      : deterministicChecks.some((check) => check.status === 'failed')
        ? 'failed'
        : deterministicChecks.length === 0 ||
            deterministicChecks.some((check) => check.status === 'pending')
          ? 'pending'
          : 'passed';
  const semanticVerdict =
    lifecycle === 'stopped'
      ? 'not_evaluated'
      : replyEvaluations.some((evaluation) => evaluation.verdict === 'failed')
        ? 'failed'
        : replyEvaluations.length === scenario.observedReplies && scenario.observedReplies > 0
          ? 'passed'
          : deterministicVerdict === 'failed'
            ? 'not_evaluated'
            : 'pending';
  const selectedTools = [
    ...new Set(
      toolEvidence.filter((item) => item.event === 'selected').map((item) => item.toolName)
    ),
  ];
  const summary = {
    scenarioId: scenario.entry.scenario.id,
    scenarioNumber: scenario.entry.scenarioNumber,
    scenarioLabel: scenario.entry.scenarioLabel,
    scenarioRevision: scenario.projectionRevision + 1,
    lifecycle,
    verdict,
    plannedTurns: scenario.entry.scenario.turns.length,
    completedTurns: scenario.completedTurns,
    expectedReplies: scenario.entry.scenario.expected.turns.reduce(
      (sum, expectation) => sum + expectation.replies.length,
      0
    ),
    completedReplies: scenario.observedReplies,
    selectedTools,
    deterministicVerdict,
    semanticVerdict,
    startedAt: scenario.startedAt,
    finishedAt: lifecycle === 'running' ? null : updatedAt,
    durationMs:
      lifecycle === 'running' || scenario.startedAt === null
        ? null
        : Math.max(0, Date.parse(updatedAt) - Date.parse(scenario.startedAt)),
  };
  return {
    expectedRevision,
    nextLifecycle: 'running',
    updatedAt,
    scenario: {
      scenarioId: scenario.entry.scenario.id,
      expectedScenarioRevision: scenario.projectionRevision,
      eventWatermark: scenario.eventRevision,
      lifecycle,
      verdict,
      sessionId,
      sessionBindingDigest,
      summary,
      projection: {
        schemaVersion: 1,
        runId: state.runId,
        userId: state.prepared.account.userId,
        sessionId,
        sessionBindingDigest,
        scenarioId: scenario.entry.scenario.id,
        scenarioNumber: scenario.entry.scenarioNumber,
        scenarioLabel: scenario.entry.scenarioLabel,
        runRevision: expectedRevision + 1,
        scenarioRevision: scenario.projectionRevision + 1,
        eventWatermark: scenario.eventRevision,
        lifecycle,
        verdict,
        plannedTurns: scenario.entry.scenario.turns.length,
        completedTurns: scenario.completedTurns,
        toolEvidence,
        deterministicChecks,
        replyEvaluations,
        agentUsage,
      },
    },
    finalization: null,
  };
}

function createDeliveryPort(
  state: LiveRunState,
  intex: IntexAgentServiceClient,
  now: () => Date
): MatrixCorpusArtifactDeliveryPort {
  async function mutate(next: Readonly<Record<string, unknown>>): Promise<boolean> {
    if (state.leaseFence === null) return false;
    const result = await intex.mutateMatrixCorpusArtifactDelivery({
      ...identity(state, state.runId, state.leaseFence),
      command: { expectedRevision: state.revision, next, updatedAt: now().toISOString() },
    });
    if (!result.ok) return false;
    state.revision = result.value.revision;
    return true;
  }
  return {
    async recordStaged({
      jsonDigest,
      markdownDigest,
    }): ReturnType<MatrixCorpusArtifactDeliveryPort['recordStaged']> {
      const ok = await mutate({
        status: 'staged',
        jsonCandidateDigest: jsonDigest,
        markdownCandidateDigest: markdownDigest,
      });
      return ok ? { ok: true, revision: state.revision } : { ok: false };
    },
    async markReady(): ReturnType<MatrixCorpusArtifactDeliveryPort['markReady']> {
      if (state.terminalControlEventId === null) return false;
      return await mutate({
        status: 'ready',
        terminalControlEventId: state.terminalControlEventId,
      });
    },
    async markFailed({ code }): ReturnType<MatrixCorpusArtifactDeliveryPort['markFailed']> {
      if (code === 'REPORT_PUBLICATION_FAILED') {
        if (state.terminalControlEventId === null) return;
        await mutate({
          status: 'failed',
          failureCode: code,
          terminalControlEventId: state.terminalControlEventId,
        });
        return;
      }
      await mutate({ status: 'failed', failureCode: code });
    },
  };
}

function buildReport(
  state: LiveRunState,
  run: MatrixCorpusRunResult,
  artifactStatus: 'pending' | 'ready',
  completedAt: Date
): MatrixCorpusReportV1 {
  const scenarioResults = new Map(run.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const scenarios = state.catalog.scenarios.map((entry) => {
    const execution = state.scenarios.get(entry.scenario.id);
    if (execution === undefined) throw new Error('scenario state missing');
    const result = scenarioResults.get(entry.scenario.id);
    const lifecycle: 'completed' | 'stopped' | 'not_run' =
      result?.status === 'stopped'
        ? 'stopped'
        : result?.status === 'not_run' || result === undefined
          ? 'not_run'
          : 'completed';
    const verdict: 'passed' | 'failed' | 'not_evaluated' =
      result?.status === 'passed'
        ? 'passed'
        : result?.status === 'failed'
          ? 'failed'
          : 'not_evaluated';
    const expectedToolCounts = new Map<string, number>();
    for (const expectation of entry.scenario.expected.turns) {
      for (const required of expectation.requiredToolCalls) {
        expectedToolCounts.set(
          `${String(expectation.turnIndex)}:${required.toolName}`,
          required.count
        );
      }
    }
    const toolKeys = new Set([
      ...expectedToolCounts.keys(),
      ...execution.toolEvidence.map((item) => `${String(item.turnIndex)}:${item.toolName}`),
    ]);
    const toolRows = [...toolKeys].sort().map((key) => {
      const [turnIndexText, toolNameText] = key.split(':');
      const turnIndex = Number(turnIndexText);
      const toolName = safeToolName(toolNameText);
      const matching = execution.toolEvidence.filter(
        (item) => item.turnIndex === turnIndex && item.toolName === toolName
      );
      return {
        toolName,
        turnIndex,
        expected: expectedToolCounts.get(key) ?? 0,
        selected: matching.filter((item) => item.event === 'selected').length,
        completed: matching.filter((item) => item.event === 'mock_completed').length,
        failed: matching.filter(
          (item) => item.event === 'mock_failed' || item.event === 'unexpected_known_no_execution'
        ).length,
      };
    });
    const agentUsage = reportUsageFromAgent(execution.agentUsage);
    const judgeUsage = reportUsageFromJudges(execution.replyEvaluations);
    const criteria = execution.replyEvaluations.flatMap((evaluation) =>
      Object.values(evaluation.criteria)
    );
    const averageScore =
      execution.replyEvaluations.length === 0
        ? null
        : Math.round(
            (execution.replyEvaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) /
              execution.replyEvaluations.length) *
              20
          );
    const judgeStatus: 'passed' | 'failed' | 'not_run' =
      lifecycle === 'not_run' || execution.replyEvaluations.length === 0
        ? 'not_run'
        : execution.replyEvaluations.every((evaluation) => evaluation.verdict === 'passed')
          ? 'passed'
          : 'failed';
    const strictMockStatus: 'passed' | 'failed' | 'not_run' =
      lifecycle === 'not_run'
        ? 'not_run'
        : execution.strictMockProofReconciled ||
            (execution.completedTurns > 0 &&
              execution.strictMockProofTurns === execution.completedTurns)
          ? 'passed'
          : 'failed';
    return {
      scenarioId: entry.scenario.id,
      ordinal: entry.scenarioNumber,
      safeTitle: entry.scenario.title,
      scenarioDigest: entry.scenarioDigest,
      lifecycle,
      verdict,
      plannedTurns: entry.scenario.turns.length,
      completedTurns: execution.completedTurns,
      sessionReferenceDigest: execution.sessionId === null ? null : sha256(execution.sessionId),
      transport: {
        matrixSends: execution.matrixSends,
        whatsappIngress: execution.whatsappIngress,
        whatsappEgress: execution.whatsappEgress,
        assistantReplies: execution.observedReplies,
        matrixMirrors: execution.matrixMirrors,
      },
      tools: toolRows,
      deterministic: {
        passed: execution.deterministicChecks.filter((check) => check.status === 'passed').length,
        failed: execution.deterministicChecks.filter((check) => check.status === 'failed').length,
      },
      judge: {
        status: judgeStatus,
        passed:
          execution.replyEvaluations.length === 0
            ? null
            : execution.replyEvaluations.every((evaluation) => evaluation.verdict === 'passed'),
        score: averageScore,
        criteriaPassed: criteria.filter(Boolean).length,
        criteriaFailed: criteria.filter((value) => !value).length,
        usage: judgeUsage,
      },
      agentUsage,
      strictMockProof: {
        version: 1 as const,
        status: strictMockStatus,
        mockProfileDigest: entry.mockProfileDigest,
        productionExecutorResolutions: 0 as const,
        productionExecutorAdmissions: 0 as const,
      },
      failureCodes: execution.failureCodes,
    };
  });
  const allAgentUsage = [...state.scenarios.values()].flatMap((scenario) => scenario.agentUsage);
  const allJudgeUsage = [...state.scenarios.values()].flatMap(
    (scenario) => scenario.replyEvaluations
  );
  const agentUsage = reportUsageFromAgent(allAgentUsage);
  const evaluatorUsage = reportUsageFromJudges(allJudgeUsage);
  const totalCostNanoUsd = agentUsage.costNanoUsd + evaluatorUsage.costNanoUsd;
  const expectedReplies = state.catalog.scenarios.reduce(
    (sum, entry) =>
      sum + entry.scenario.expected.turns.reduce((turns, turn) => turns + turn.replies.length, 0),
    0
  );
  const executedConfirmationTurns = [...state.scenarios.values()].reduce(
    (sum, scenario) =>
      sum +
      scenario.entry.scenario.turns
        .slice(0, scenario.completedTurns)
        .filter((turn) => turn.kind === 'confirmation_button').length,
    0
  );
  return {
    schemaVersion: 1,
    runId: state.runId,
    command: 'matrix-corpus',
    requestedRevision: state.preflight.snapshot.requestedRevision,
    deployedRevision: state.preflight.snapshot.deployedRevision,
    accountAlias: state.prepared.accountAlias,
    runnerHost: 'home-dev',
    runtimeAudience: 'hetzner-prod',
    environmentAlias: 'prod',
    catalog: {
      digest: state.catalog.catalogDigest,
      scenarioCount: 20,
      turnCount: 59,
    },
    agentModel: state.catalog.agentModel,
    evaluatorModel: state.catalog.evaluatorModel,
    executionMode: 'real_matrix_whatsapp_strict_mock_tools',
    startedAt: state.startedAt,
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - Date.parse(state.startedAt)),
    terminal: {
      lifecycle: run.effectiveKind === 'infrastructure_failure' ? 'stopped' : 'completed',
      verdict:
        run.effectiveKind === 'passed'
          ? 'passed'
          : run.effectiveKind === 'behavioral_failure'
            ? 'failed'
            : 'not_evaluated',
      acknowledged: artifactStatus === 'ready' && run.terminalAcknowledged,
      leaseReleased: artifactStatus === 'ready' && state.released,
      runOutcomeCode:
        run.effectiveKind === 'passed'
          ? 'PASS'
          : run.effectiveKind === 'behavioral_failure'
            ? 'BEHAVIORAL_FAILURE'
            : 'INFRASTRUCTURE_FAILURE',
      exitCode: run.exitCode,
    },
    preflight: state.preflight.checks.map((check) => ({ check, status: 'passed', code: null })),
    totals: {
      scenariosPlanned: 20,
      scenariosExecuted: scenarios.filter((scenario) => scenario.lifecycle !== 'not_run').length,
      scenariosPassed: scenarios.filter((scenario) => scenario.verdict === 'passed').length,
      scenariosFailed: scenarios.filter((scenario) => scenario.verdict === 'failed').length,
      scenariosNotRun: scenarios.filter((scenario) => scenario.lifecycle === 'not_run').length,
      turnsPlanned: 59,
      turnsSent: state.turnsSent,
      turnsCorrelated: state.turnsCorrelated,
      turnsCompleted: run.totals.completedTurns,
      sessionsExpected: 20,
      sessionsCreated: [...state.scenarios.values()].filter(
        (scenario) => scenario.sessionId !== null
      ).length,
      sessionsContinued: Math.max(
        0,
        run.totals.completedTurns -
          [...state.scenarios.values()].filter((scenario) => scenario.sessionId !== null).length
      ),
      sessionsClosed: 0,
      confirmationsRequested: executedConfirmationTurns,
      confirmationsAccepted: [...state.scenarios.values()].reduce(
        (sum, scenario) =>
          sum +
          scenario.entry.scenario.turns
            .slice(0, scenario.completedTurns)
            .filter((turn) => turn.kind === 'confirmation_button' && turn.decision === 'accept')
            .length,
        0
      ),
      confirmationsRejected: [...state.scenarios.values()].reduce(
        (sum, scenario) =>
          sum +
          scenario.entry.scenario.turns
            .slice(0, scenario.completedTurns)
            .filter((turn) => turn.kind === 'confirmation_button' && turn.decision === 'reject')
            .length,
        0
      ),
      confirmationsCompleted: executedConfirmationTurns,
      repliesExpected: expectedReplies,
      repliesObserved: [...state.scenarios.values()].reduce(
        (sum, scenario) => sum + scenario.observedReplies,
        0
      ),
      repliesJudged: run.totals.judgedReplies,
      toolSelections: allToolEvidence(state, 'selected'),
      mockCompletions: allToolEvidence(state, 'mock_completed'),
      mockFailures:
        allToolEvidence(state, 'mock_failed') +
        allToolEvidence(state, 'unexpected_known_no_execution'),
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    },
    usage: {
      agent: agentUsage,
      evaluator: evaluatorUsage,
      totalCostNanoUsd,
      costComplete: true,
    },
    scenarios,
    cleanup: {
      contextFinalization: artifactStatus === 'ready' ? 'passed' : 'failed',
      scenarioContextsDeleted: state.finalizedScenarioContextCount,
      runContextsDeleted: state.finalizedRunContextCount,
      retainedSessionsUnchanged: 'not_observed',
      retainedProjectionsUnchanged: 'not_observed',
      quiesce: 'passed',
      drain: 'passed',
      finalizingCandidate: artifactStatus === 'ready' ? 'passed' : 'failed',
      releasePending: artifactStatus === 'ready' ? 'passed' : 'failed',
      terminalAcknowledgement: artifactStatus === 'ready' ? 'passed' : 'failed',
      leaseRelease: artifactStatus === 'ready' ? 'passed' : 'failed',
      retention: state.retention,
    },
    artifactDelivery: {
      status: artifactStatus,
      stagedJsonDigest: state.staged?.jsonDigest ?? null,
      stagedMarkdownDigest: state.staged?.markdownDigest ?? null,
      failureCode: null,
    },
    failures: run.failureCodes.map((code) => ({
      stage: 'scenario' as const,
      code: safeFailureCode(code),
      scenarioNumber: null,
      turnIndex: null,
      replyOrdinal: null,
    })),
  };
}

function provisionalRunResult(
  state: LiveRunState,
  outcome: 'passed' | 'failed' | 'stopped'
): MatrixCorpusRunResult {
  const scenarios = state.catalog.scenarios.map((entry) => {
    const scenario = state.scenarios.get(entry.scenario.id);
    const executed = scenario !== undefined && scenario.sessionId !== null;
    const scenarioPassed =
      scenario !== undefined &&
      scenario.deterministicPassed &&
      scenario.replyEvaluations.every((item) => item.verdict === 'passed');
    return {
      scenarioId: entry.scenario.id,
      status: !executed
        ? ('not_run' as const)
        : outcome === 'stopped'
          ? ('stopped' as const)
          : scenarioPassed
            ? ('passed' as const)
            : ('failed' as const),
      completedTurns: scenario?.completedTurns ?? 0,
    };
  });
  const effectiveKind =
    outcome === 'passed'
      ? 'passed'
      : outcome === 'failed'
        ? 'behavioral_failure'
        : 'infrastructure_failure';
  return {
    runId: state.runId,
    effectiveKind,
    exitCode: effectiveKind === 'passed' ? 0 : effectiveKind === 'behavioral_failure' ? 1 : 2,
    failureCodes: [],
    scenarios,
    totals: {
      completedTurns: [...state.scenarios.values()].reduce(
        (sum, scenario) => sum + scenario.completedTurns,
        0
      ),
      judgedReplies: [...state.scenarios.values()].reduce(
        (sum, scenario) => sum + scenario.replyEvaluations.length,
        0
      ),
      agentCostNanoUsd: [...state.scenarios.values()]
        .flatMap((scenario) => scenario.agentUsage)
        .reduce((sum, usage) => sum + usage.costNanoUsd, 0),
      evaluatorCostNanoUsd: [...state.scenarios.values()]
        .flatMap((scenario) => scenario.replyEvaluations)
        .reduce((sum, evaluation) => sum + evaluation.usage.costNanoUsd, 0),
    },
    terminalAcknowledged: false,
    cleanupCompleted: false,
  };
}

function visibleTurn(
  entry: CanonicalMatrixCorpusScenario,
  turn: IntexEvalScenario['turns'][number],
  turnIndex: number
): { body: string; header(capability: string): string } {
  const marker = `Scenario ${String(entry.scenarioNumber).padStart(3, '0')}/020`;
  if (turn.kind === 'confirmation_button') {
    const body = turn.decision === 'accept' ? 'Potwierdzam.' : 'Odrzucam.';
    return {
      body,
      header: (capability) => `🧪 ${marker} · confirmation · ${capability}`,
    };
  }
  if (turnIndex === 0) {
    return {
      body: turn.text,
      header: (capability) =>
        `new session: 🧪 ${marker} · Matrix corpus · tools mocked · ${capability}`,
    };
  }
  return {
    body: turn.text,
    header: (capability) =>
      `🧪 ${marker} · step ${String(turnIndex + 1)}/${String(entry.scenario.turns.length)} · ${capability}`,
  };
}

function digestPrompt(body: string, startNewSession: boolean): string {
  return sha256(
    JSON.stringify({
      version: 1,
      body: body.replace(/\r\n|\r/g, '\n').normalize('NFC'),
      startNewSession,
    })
  );
}

async function readScenarioStatus(
  intex: IntexAgentServiceClient,
  state: LiveRunState,
  scenarioId: string,
  leaseFence: string
): Promise<Extract<MatrixCorpusScenarioStatusResult, { kind: 'status' }> | null> {
  const result = await intex.getMatrixCorpusScenarioStatus({
    ...identity(state, state.runId, leaseFence),
    scenarioId,
  });
  return result.ok && result.value.kind === 'status' ? result.value : null;
}

export function buildMatrixCorpusTechnicalFacts(
  scenario: IntexEvalScenario,
  turnIndex: number,
  passed: boolean,
  observedReplyCount: number,
  selected: readonly { toolName: IntexAgentToolNameV1; ordinal: number }[],
  outcomes: readonly {
    toolName: IntexAgentToolNameV1;
    ordinal: number;
    status: 'completed' | 'failed';
  }[]
): ReplyTechnicalFacts {
  const expected = scenario.expected.turns[turnIndex];
  if (expected === undefined) throw new Error('missing expectation');
  const currentTurn = scenario.turns[turnIndex];
  const expectedReplyCount = expected.replies.length;
  const requiredToolScheduleMatches = sameToolSchedule(selected, expected.requiredToolCalls);
  const failureCodes: ReplyTechnicalFacts['failureCodes'] = [];
  if (observedReplyCount < expectedReplyCount) failureCodes.push('assistant_reply_missing');
  if (observedReplyCount > expectedReplyCount) failureCodes.push('assistant_reply_unexpected');
  if (!requiredToolScheduleMatches) failureCodes.push('required_tool_count_mismatch');
  if (!passed && failureCodes.length === 0) failureCodes.push('forbidden_tool_called');
  return {
    turnPassed: passed,
    failureCodes,
    tools: expected.requiredToolCalls.map((required) => ({
      toolName: required.toolName,
      expectation: 'required',
      expectedCount: required.count,
      actualCount: selected.filter((item) => item.toolName === required.toolName).length,
      actualStatuses: outcomes
        .filter((item) => item.toolName === required.toolName)
        .map((item) => item.status),
      argumentAssertions: 'not_observed',
      syntheticMarkerEvidence: 'not_observed',
    })),
    transition: {
      expectedAction: expected.transition.action,
      ...(expected.transition.previousEndReason !== undefined
        ? {
            expectedPreviousEndReason: expected.transition.previousEndReason,
          }
        : {}),
      outcome: 'not_observed',
    },
    session: {
      allowedStatuses: expected.sessionAfterTurn.allowedStatuses,
      ...(expected.sessionAfterTurn.startReason !== undefined
        ? {
            expectedStartReason: expected.sessionAfterTurn.startReason,
          }
        : {}),
      ...(expected.sessionAfterTurn.endReason !== undefined
        ? {
            expectedEndReason: expected.sessionAfterTurn.endReason,
          }
        : {}),
      ...(expected.sessionAfterTurn.activeTool !== undefined
        ? {
            expectedActiveTool: expected.sessionAfterTurn.activeTool,
          }
        : {}),
      outcome: 'not_observed',
    },
    timeline: {
      required: expected.timeline.requiredEventTypes.map((eventType) => ({
        eventType,
        outcome: 'not_observed' as const,
      })),
      forbidden: expected.timeline.forbiddenEventTypes.map((eventType) => ({
        eventType,
        outcome: 'not_observed' as const,
      })),
      payloadGroups: expected.timeline.payloadAssertions.map(({ eventType }) => ({
        eventType,
        outcome: 'not_observed' as const,
        syntheticMarkerEvidence: 'not_observed' as const,
      })),
    },
    confirmationAction:
      currentTurn?.kind === 'confirmation_button'
        ? currentTurn.decision === 'accept'
          ? 'accepted'
          : 'rejected'
        : expected.timeline.requiredEventTypes.includes('confirmation_requested')
          ? 'requested'
          : 'none',
    toolOutcome:
      outcomes[0] === undefined
        ? null
        : { toolName: outcomes[0].toolName, status: outcomes[0].status },
  };
}

const buildTechnicalFacts = buildMatrixCorpusTechnicalFacts;

function sameToolSchedule(
  selected: readonly { toolName: IntexAgentToolNameV1; ordinal: number }[],
  requirements: IntexEvalScenario['expected']['turns'][number]['requiredToolCalls']
): boolean {
  const expected = requirements.flatMap((requirement) =>
    Array.from({ length: requirement.count }, (_, index) => ({
      toolName: requirement.toolName,
      ordinal: index + 1,
    }))
  );
  return JSON.stringify(selected) === JSON.stringify(expected);
}

interface AggregatedAgentUsage {
  readonly logicalCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costNanoUsd: number;
}

function sumAgentUsage(agentUsage: readonly SafeAgentUsageV1[]): AggregatedAgentUsage {
  return {
    logicalCalls: agentUsage.length,
    inputTokens: agentUsage.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: agentUsage.reduce((sum, usage) => sum + usage.outputTokens, 0),
    totalTokens: agentUsage.reduce((sum, usage) => sum + usage.totalTokens, 0),
    costNanoUsd: agentUsage.reduce((sum, usage) => sum + usage.costNanoUsd, 0),
  };
}

function toSafeReplyEvaluation(
  verdict: {
    turnIndex: number;
    replyIndex: number;
    pass: boolean;
    score: 1 | 2 | 3 | 4 | 5;
    criteria: SafeReplyEvaluationV1['criteria'];
  },
  repairCount: number,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  costNanoUsd: number,
  latencyMs: number
): SafeReplyEvaluationV1 {
  const failureCodes = (
    [
      'understoodIntent',
      'helpful',
      'conciseAndClear',
      'professionalTone',
      'noPassiveAggression',
    ] as const
  ).filter((criterion) => !verdict.criteria[criterion]);
  return {
    turnIndex: verdict.turnIndex,
    replyIndex: verdict.replyIndex + 1,
    verdict: verdict.pass ? 'passed' : 'failed',
    score: verdict.score,
    criteria: verdict.criteria,
    failureCodes,
    latencyMs,
    usage: {
      logicalCalls: 1,
      repairCount: repairCount === 0 ? 0 : 1,
      inputTokens,
      outputTokens,
      totalTokens,
      costNanoUsd,
    },
  };
}

export function buildMatrixCorpusTurnChecks(
  input: Readonly<{
    turnIndex: number;
    expectation: IntexEvalScenario['expected']['turns'][number];
    actualReplyCount: number;
    expectedTransition: 'created' | 'continued';
    actualTransition: 'created' | 'continued';
    actualLifecycle: 'completed' | 'failed';
    toolEvidence: readonly SafeToolEvidenceV1[];
  }>
): SafeDeterministicCheckV1[] {
  const expectedReplyCount = input.expectation.replies.length;
  const checks: SafeDeterministicCheckV1[] = [
    check(
      'reply_count',
      expectedReplyCount === input.actualReplyCount,
      input.turnIndex,
      evidence({ expectedCount: expectedReplyCount, actualCount: input.actualReplyCount })
    ),
    check(
      'session_transition',
      input.expectedTransition === input.actualTransition,
      input.turnIndex,
      evidence({
        expectedTransition: input.expectedTransition,
        actualTransition: input.actualTransition,
      })
    ),
    check(
      'lifecycle_event',
      input.actualLifecycle === 'completed',
      input.turnIndex,
      evidence({ expectedTransition: 'completed', actualTransition: input.actualLifecycle })
    ),
    check(
      'transport',
      expectedReplyCount === input.actualReplyCount,
      input.turnIndex,
      evidence({ expectedCount: expectedReplyCount, actualCount: input.actualReplyCount })
    ),
  ];

  const required = input.expectation.requiredToolCalls[0];
  const unexpected = input.toolEvidence.find(
    (item) => item.event === 'unexpected_known_no_execution'
  );
  if (required !== undefined) {
    const selected = input.toolEvidence.filter(
      (item) => item.event === 'selected' && item.toolName === required.toolName
    );
    const completed = input.toolEvidence.filter(
      (item) => item.event === 'mock_completed' && item.toolName === required.toolName
    );
    const firstSelected = selected[0];
    const actualTool = unexpected?.toolName ?? firstSelected?.toolName ?? null;
    checks.push(
      check(
        'tool_name',
        unexpected === undefined && firstSelected?.toolName === required.toolName,
        input.turnIndex,
        evidence({
          expectedToolName: required.toolName,
          actualToolName: actualTool,
        })
      ),
      check(
        'tool_count',
        selected.length === required.count && completed.length === required.count,
        input.turnIndex,
        evidence({
          expectedToolName: required.toolName,
          actualToolName: firstSelected?.toolName ?? null,
          expectedCount: required.count,
          actualCount: selected.length,
        })
      ),
      check(
        'tool_turn',
        firstSelected?.turnIndex === input.turnIndex,
        input.turnIndex,
        evidence({
          expectedToolName: required.toolName,
          actualToolName: firstSelected?.toolName ?? null,
          expectedTurnIndex: input.turnIndex,
          actualTurnIndex: firstSelected?.turnIndex ?? null,
        })
      )
    );
    const expectedFacts = safeFactExpectations(required.argumentAssertions);
    if (expectedFacts.length > 0) {
      const actualFacts = firstSelected?.facts ?? [];
      checks.push(
        check(
          'tool_fact',
          expectedFacts.every((expected) => safeFactExpectationPasses(expected, actualFacts)),
          input.turnIndex,
          evidence({
            expectedToolName: required.toolName,
            actualToolName: firstSelected?.toolName ?? null,
            expectedFacts,
            actualFacts: [...actualFacts],
          })
        )
      );
    }
  } else {
    const selected = input.toolEvidence.filter(
      (item) => item.event === 'selected' || item.event === 'unexpected_known_no_execution'
    );
    checks.push(
      check(
        'tool_count',
        selected.length === 0,
        input.turnIndex,
        evidence({ expectedCount: 0, actualCount: selected.length })
      )
    );
    const unexpected = selected[0];
    if (unexpected !== undefined) {
      checks.push(
        check(
          'tool_name',
          false,
          input.turnIndex,
          evidence({ actualToolName: unexpected.toolName })
        )
      );
    }
  }
  return checks;
}

function check(
  code: SafeDeterministicCheckV1['code'],
  passed: boolean,
  turnIndex: number,
  safeEvidence: SafeDeterministicEvidenceV1
): SafeDeterministicCheckV1 {
  return {
    code,
    status: passed ? 'passed' : 'failed',
    turnIndex,
    replyIndex: null,
    evidence: safeEvidence,
  };
}

function evidence(overrides: Partial<SafeDeterministicEvidenceV1>): SafeDeterministicEvidenceV1 {
  return {
    expectedToolName: null,
    actualToolName: null,
    expectedTurnIndex: null,
    actualTurnIndex: null,
    expectedCount: null,
    actualCount: null,
    expectedTransition: null,
    actualTransition: null,
    expectedFacts: [],
    actualFacts: [],
    ...overrides,
  };
}

function safeFactExpectations(
  assertions: IntexEvalScenario['expected']['turns'][number]['requiredToolCalls'][number]['argumentAssertions']
): SafeExpectedToolFactV1[] {
  const expectations: SafeExpectedToolFactV1[] = [];
  for (const assertion of assertions) {
    const parsedName = safeToolFactNameV1Schema.safeParse(assertion.path);
    if (!parsedName.success || assertion.operator === 'contains') continue;
    if (assertion.operator === 'equals') {
      const value = assertion.value;
      if (
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        value !== 'list' &&
        value !== 'count' &&
        value !== 'codex' &&
        value !== 'codex-xhigh' &&
        value !== 'minimax' &&
        value !== 'planning' &&
        value !== 'execution'
      )
        continue;
      expectations.push({ name: parsedName.data, operator: 'equals', value });
      continue;
    }
    expectations.push({ name: parsedName.data, operator: assertion.operator, value: null });
  }
  return expectations;
}

function safeFactExpectationPasses(
  expected: SafeExpectedToolFactV1,
  actualFacts: readonly SafeToolEvidenceV1['facts'][number][]
): boolean {
  const actual = actualFacts.find((fact) => fact.name === expected.name);
  if (expected.operator === 'exists') return actual !== undefined;
  if (expected.operator === 'absent') return actual === undefined || actual.value === false;
  return actual?.value === expected.value;
}

function reportUsageFromAgent(entries: readonly SafeAgentUsageV1[]): CompleteUsageReport {
  const total = sumAgentUsage(entries);
  return {
    logicalCalls: total.logicalCalls,
    repairCount: entries.filter((entry) => entry.stage === 'response_schema_repair').length,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    totalTokens: total.totalTokens,
    costNanoUsd: total.costNanoUsd,
    costComplete: true,
  };
}

function reportUsageFromJudges(entries: readonly SafeReplyEvaluationV1[]): CompleteUsageReport {
  return {
    logicalCalls: entries.length,
    repairCount: entries.reduce((sum, entry) => sum + entry.usage.repairCount, 0),
    inputTokens: entries.reduce((sum, entry) => sum + entry.usage.inputTokens, 0),
    outputTokens: entries.reduce((sum, entry) => sum + entry.usage.outputTokens, 0),
    totalTokens: entries.reduce((sum, entry) => sum + entry.usage.totalTokens, 0),
    costNanoUsd: entries.reduce((sum, entry) => sum + entry.usage.costNanoUsd, 0),
    costComplete: true,
  };
}

type CompleteUsageReport = Omit<
  MatrixCorpusReportV1['usage']['agent'],
  'costNanoUsd' | 'costComplete'
> & {
  readonly costNanoUsd: number;
  readonly costComplete: true;
};

function allToolEvidence(state: LiveRunState, event: SafeToolEvidenceV1['event']): number {
  return [...state.scenarios.values()]
    .flatMap((scenario) => scenario.toolEvidence)
    .filter((evidence) => evidence.event === event).length;
}

function compareToolEvidence(left: SafeToolEvidenceV1, right: SafeToolEvidenceV1): number {
  return compareCanonicalKeys(
    `${String(left.turnIndex)}:${String(left.ordinal)}:${left.event}:${left.toolName}`,
    `${String(right.turnIndex)}:${String(right.ordinal)}:${right.event}:${right.toolName}`
  );
}

function compareDeterministicChecks(
  left: SafeDeterministicCheckV1,
  right: SafeDeterministicCheckV1
): number {
  return compareCanonicalKeys(
    `${String(left.turnIndex)}:${String(left.replyIndex)}:${left.code}`,
    `${String(right.turnIndex)}:${String(right.replyIndex)}:${right.code}`
  );
}

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terminalOutcome(
  outcome: 'passed' | 'failed' | 'stopped'
): 'completed_passed' | 'completed_failed' | 'stopped_not_evaluated' {
  return outcome === 'passed'
    ? ('completed_passed' as const)
    : outcome === 'failed'
      ? ('completed_failed' as const)
      : ('stopped_not_evaluated' as const);
}

function identity(
  state: LiveRunState,
  runId: string,
  leaseFence: string
): { runId: string; userId: string; leaseFence: string } {
  return { runId, userId: state.prepared.account.userId, leaseFence };
}

function operationKey(runId: string, operation: string): string {
  return `${runId}:${operation}`.slice(0, 128);
}

function toNanoUsd(value: number): number | null {
  const result = Math.round(value * 1_000_000_000);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function isJudgeScore(value: number): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export async function runWithMatrixCorpusDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function poll<T>(
  read: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs: number
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return undefined;
}

function passed<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

function failed(code: string): { readonly ok: false; readonly code: string } {
  return { ok: false, code };
}

function projectionFailed(code: string): MatrixCorpusProjectionMutationResult {
  return { ok: false as const, kind: 'failed' as const, code };
}

function stoppedScenarioReconciliationFailed(
  code: string
): MatrixCorpusStoppedScenarioReconciliationResult {
  return { ok: false as const, kind: 'failed' as const, code };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeFailureCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/gu, '_')
    .slice(0, 96);
  return normalized === '' ? 'UNKNOWN_FAILURE' : normalized;
}

function safeToolName(value: string | undefined): IntexAgentToolNameV1 {
  const parsed = safeToolEvidenceV1Schema.shape.toolName.safeParse(value);
  if (!parsed.success) throw new Error('invalid safe tool name');
  return parsed.data;
}

function emptyCleanupCounts(): MatrixCorpusCleanupCounts {
  return {
    observation: 'not_observed',
    considered: 0,
    retained: 0,
    removed: 0,
    missing: 0,
    failed: 0,
  };
}

function withInfrastructureFailure(
  run: MatrixCorpusRunResult,
  code: string
): MatrixCorpusRunResult {
  return {
    ...run,
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: [...run.failureCodes, code],
  };
}
