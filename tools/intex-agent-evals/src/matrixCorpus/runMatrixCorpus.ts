import type { ReplyEvaluationInput } from '../deterministicEvaluator.js';
import type { IntexEvalScenario } from '../scenarioSchema.js';
import { digestMatrixReply } from './correlation.js';
import type { CanonicalMatrixCorpus, MatrixCorpusEvaluatorModel } from './types.js';

export const MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA = [
  'The assistant must not emit an unexpected extra reply for this turn.',
] as const;
export const MATRIX_CORPUS_JUDGE_CALLS_PER_LEASE_RENEWAL = 3;

export type MatrixCorpusOperationResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

export interface MatrixCorpusTurnObservation {
  readonly sessionId: string;
  readonly sessionEvidence: {
    readonly kind: 'created' | 'continued';
    readonly scenarioLabel: string;
  };
  readonly agentModel: string;
  readonly observedReplyCount: number;
  readonly replyEvaluations: readonly ReplyEvaluationInput[];
  readonly deterministicPassed: boolean;
  readonly transportEvidence: {
    readonly turnTerminal: 'completed' | 'failed';
    readonly replyDigests: readonly string[];
  };
  readonly toolEvidence: {
    readonly strictMockBoundary: boolean;
    readonly selectedScheduled: readonly {
      readonly toolName: string;
      readonly ordinal: number;
    }[];
    readonly mockOutcomes: readonly {
      readonly toolName: string;
      readonly ordinal: number;
      readonly status: 'completed' | 'failed';
    }[];
    readonly unexpectedKnownToolCount: number;
  };
  readonly confirmationEvidence:
    | { readonly kind: 'not_applicable' }
    | {
        readonly kind: 'resolved';
        readonly previousTurnIndex: number;
        readonly decision: 'accept' | 'reject';
      };
  readonly agentUsage: {
    readonly logicalCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly costNanoUsd: number;
    readonly providerCostReconciled: boolean;
  };
}

export type MatrixCorpusTurnExecutionResult =
  | { readonly ok: true; readonly observation: MatrixCorpusTurnObservation }
  | {
      readonly ok: false;
      readonly kind: 'behavioral_failure';
      readonly code: string;
      readonly observation: MatrixCorpusTurnObservation;
    }
  | {
      readonly ok: false;
      readonly kind: 'infrastructure_failure' | 'safety_failure';
      readonly code: string;
      readonly boundSessionId?: string;
    };

export type MatrixCorpusJudgeResult =
  | {
      readonly ok: true;
      readonly pass: boolean;
      readonly model: string;
      readonly usage: {
        readonly logicalCalls: number;
        readonly repairCount: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
        readonly costNanoUsd: number;
      };
    }
  | { readonly ok: false; readonly code: string };

export type MatrixCorpusProjectionMutationResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly kind: 'revision_conflict' | 'failed'; readonly code: string };

export type MatrixCorpusStoppedScenarioReconciliationResult =
  | {
      readonly ok: true;
      readonly revision: number;
      readonly disposition: 'projected' | 'not_bound';
      readonly additionalAgentCostNanoUsd: number;
    }
  | { readonly ok: false; readonly kind: 'revision_conflict' | 'failed'; readonly code: string };

export interface MatrixCorpusRunPorts {
  provisionRun(input: {
    runId: string;
    catalog: CanonicalMatrixCorpus;
  }): Promise<MatrixCorpusOperationResult<{ leaseFence: string }>>;
  registerContext(input: {
    runId: string;
    leaseFence: string;
    catalog: CanonicalMatrixCorpus;
  }): Promise<MatrixCorpusOperationResult>;
  createProjection(input: {
    runId: string;
    leaseFence: string;
    catalog: CanonicalMatrixCorpus;
  }): Promise<MatrixCorpusOperationResult<{ revision: number }>>;
  reconcileRetention(input: {
    runId: string;
    leaseFence: string;
  }): Promise<MatrixCorpusOperationResult<{ revision: number }>>;
  activateRun(input: { runId: string; leaseFence: string }): Promise<MatrixCorpusOperationResult>;
  projectRunning(input: {
    runId: string;
    leaseFence: string;
    expectedRevision: number;
  }): Promise<MatrixCorpusProjectionMutationResult>;
  renewLease(
    input:
      | {
          runId: string;
          leaseFence: string;
          scenarioId: string;
          turnIndex: number;
          stage: 'turn';
        }
      | {
          runId: string;
          leaseFence: string;
          scenarioId: string;
          turnIndex: number;
          stage: 'judge';
          replyIndex: number;
        }
  ): Promise<MatrixCorpusOperationResult>;
  executeTurn(input: {
    runId: string;
    leaseFence: string;
    scenario: IntexEvalScenario;
    scenarioNumber: number;
    turnIndex: number;
    expectedSessionId: string | null;
  }): Promise<MatrixCorpusTurnExecutionResult>;
  judgeReply(input: {
    readonly model: MatrixCorpusEvaluatorModel;
    readonly reply: ReplyEvaluationInput;
  }): Promise<MatrixCorpusJudgeResult>;
  projectScenario(input: {
    runId: string;
    leaseFence: string;
    expectedRevision: number;
    scenarioId: string;
    lifecycle: 'running' | 'completed' | 'stopped';
    verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated';
  }): Promise<MatrixCorpusProjectionMutationResult>;
  reconcileStoppedScenario(input: {
    runId: string;
    leaseFence: string;
    expectedRevision: number;
    scenarioId: string;
    observedSessionId: string | null;
  }): Promise<MatrixCorpusStoppedScenarioReconciliationResult>;
  getProjectionRevision(input: {
    runId: string;
    leaseFence: string;
  }): Promise<MatrixCorpusOperationResult<{ revision: number }>>;
  quiesceRun(input: { runId: string; leaseFence: string }): Promise<MatrixCorpusOperationResult>;
  waitForDrain(input: { runId: string; leaseFence: string }): Promise<MatrixCorpusOperationResult>;
  stageArtifacts(input: {
    runId: string;
    leaseFence: string;
    outcome: 'passed' | 'failed' | 'stopped';
  }): Promise<MatrixCorpusOperationResult<{ artifactStageDigest: string; revision: number }>>;
  finalizeContext(input: {
    runId: string;
    leaseFence: string;
    expectedRevision: number;
    artifactStageDigest: string;
    outcome: 'passed' | 'failed' | 'stopped';
  }): Promise<MatrixCorpusOperationResult<{ tombstoneDigest: string }>>;
  projectFinalizing(input: {
    runId: string;
    leaseFence: string;
    expectedRevision: number;
    artifactStageDigest: string;
    tombstoneDigest: string;
    outcome: 'passed' | 'failed' | 'stopped';
  }): Promise<MatrixCorpusProjectionMutationResult>;
  releaseRun(input: { runId: string; leaseFence: string }): Promise<MatrixCorpusOperationResult>;
  waitForTerminalAcknowledgement(input: {
    runId: string;
    leaseFence: string;
  }): Promise<MatrixCorpusOperationResult>;
  cleanup(input: { runId: string; leaseFence: string }): Promise<MatrixCorpusOperationResult>;
}

export interface MatrixCorpusScenarioRunResult {
  readonly scenarioId: string;
  readonly status: 'passed' | 'failed' | 'stopped' | 'not_run';
  readonly completedTurns: number;
}

export interface MatrixCorpusRunResult {
  readonly runId: string;
  readonly effectiveKind: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  readonly exitCode: 0 | 1 | 2;
  readonly failureCodes: readonly string[];
  readonly scenarios: readonly MatrixCorpusScenarioRunResult[];
  readonly totals: {
    readonly completedTurns: number;
    readonly judgedReplies: number;
    readonly agentCostNanoUsd: number;
    readonly evaluatorCostNanoUsd: number;
  };
  readonly terminalAcknowledged: boolean;
  readonly cleanupCompleted: boolean;
}

export async function runMatrixCorpus(
  input: { readonly runId: string; readonly catalog: CanonicalMatrixCorpus },
  ports: MatrixCorpusRunPorts
): Promise<MatrixCorpusRunResult> {
  const scenarios: MatrixCorpusScenarioRunResult[] = input.catalog.scenarios.map(
    ({ scenario }) => ({
      scenarioId: scenario.id,
      status: 'not_run',
      completedTurns: 0,
    })
  );
  const failureCodes: string[] = [];
  const createdSessionIds = new Set<string>();
  let revision = 0;
  let active = false;
  let behavioralFailure = false;
  let stopped = false;
  let completedTurns = 0;
  let judgedReplies = 0;
  let agentCostNanoUsd = 0;
  let evaluatorCostNanoUsd = 0;
  let terminalAcknowledged = false;
  let cleanupCompleted = false;
  let pendingStoppedScenario: {
    readonly scenarioOffset: number;
    readonly scenarioId: string;
    readonly observedSessionId: string | null;
  } | null = null;

  const provision = await safely(() => ports.provisionRun(input));
  if (!provision.ok) return earlyFailure(input.runId, scenarios, provision.code);
  const leaseFence = provision.value.leaseFence;

  const context = await safely(() =>
    ports.registerContext({ runId: input.runId, leaseFence, catalog: input.catalog })
  );
  if (!context.ok) return await terminateAfterProvision(context.code);
  const projection = await safely(() =>
    ports.createProjection({ runId: input.runId, leaseFence, catalog: input.catalog })
  );
  if (!projection.ok) return await terminateAfterProvision(projection.code);
  revision = projection.value.revision;
  const retention = await safely(() =>
    ports.reconcileRetention({ runId: input.runId, leaseFence })
  );
  if (!retention.ok) return await terminateAfterProvision(retention.code);
  revision = retention.value.revision;
  const activation = await safely(() => ports.activateRun({ runId: input.runId, leaseFence }));
  if (!activation.ok) return await terminateAfterProvision(activation.code);
  active = true;
  const runningProjection = await projectRunningWithRefetch({
    ports,
    runId: input.runId,
    leaseFence,
    revision,
  });
  if (!runningProjection.ok) {
    failureCodes.push(runningProjection.code);
    stopped = true;
    return await terminalize();
  }
  revision = runningProjection.revision;

  for (const [scenarioOffset, entry] of input.catalog.scenarios.entries()) {
    const scenarioResult = scenarios[scenarioOffset];
    if (scenarioResult === undefined) break;
    let sessionId: string | null = null;
    let scenarioFailed = false;
    let scenarioStopped = false;
    let scenarioCompletedTurns = 0;
    for (const [turnIndex] of entry.scenario.turns.entries()) {
      const renewal = await safely(() =>
        ports.renewLease({
          runId: input.runId,
          leaseFence,
          scenarioId: entry.scenario.id,
          turnIndex,
          stage: 'turn',
        })
      );
      if (!renewal.ok) {
        failureCodes.push(renewal.code);
        pendingStoppedScenario = {
          scenarioOffset,
          scenarioId: entry.scenario.id,
          observedSessionId: sessionId,
        };
        scenarioStopped = true;
        stopped = true;
        break;
      }
      const execution = await safelyTurn(() =>
        ports.executeTurn({
          runId: input.runId,
          leaseFence,
          scenario: entry.scenario,
          scenarioNumber: entry.scenarioNumber,
          turnIndex,
          expectedSessionId: sessionId,
        })
      );
      let portBehavioralFailureCode: string | undefined;
      if (!execution.ok && execution.kind !== 'behavioral_failure') {
        sessionId ??= execution.boundSessionId ?? null;
        failureCodes.push(execution.code);
        scenarioStopped = true;
        stopped = true;
        break;
      }
      if (!execution.ok) {
        portBehavioralFailureCode = execution.code;
        failureCodes.push(execution.code);
        scenarioFailed = true;
        behavioralFailure = true;
      }

      const observation = execution.observation;
      sessionId ??= observation.sessionId;
      const evidence = reconcileTurnEvidence({
        observation,
        scenario: entry.scenario,
        scenarioLabel: entry.scenarioLabel,
        expectedSessionId: turnIndex === 0 ? null : sessionId,
        turnIndex,
        expectedAgentModel: input.catalog.agentModel,
      });
      if (!evidence.ok) {
        failureCodes.push('turn_evidence_mismatch');
        failureCodes.push(evidence.code);
        scenarioStopped = true;
        stopped = true;
        break;
      }
      if (turnIndex === 0) {
        if (createdSessionIds.has(observation.sessionId)) {
          failureCodes.push('duplicate_scenario_session');
          scenarioStopped = true;
          stopped = true;
          break;
        }
        createdSessionIds.add(observation.sessionId);
      }
      agentCostNanoUsd += observation.agentUsage.costNanoUsd;
      if (!evidence.behavioralPassed || portBehavioralFailureCode !== undefined) {
        scenarioFailed = true;
        behavioralFailure = true;
      }

      for (const [replyOffset, reply] of observation.replyEvaluations.entries()) {
        if (replyOffset % MATRIX_CORPUS_JUDGE_CALLS_PER_LEASE_RENEWAL === 0) {
          const judgeRenewal = await safely(() =>
            ports.renewLease({
              runId: input.runId,
              leaseFence,
              scenarioId: entry.scenario.id,
              turnIndex,
              stage: 'judge',
              replyIndex: reply.replyIndex,
            })
          );
          if (!judgeRenewal.ok) {
            failureCodes.push(judgeRenewal.code);
            scenarioStopped = true;
            stopped = true;
            break;
          }
        }
        const judged = await safelyJudge(() =>
          ports.judgeReply({ model: input.catalog.evaluatorModel, reply })
        );
        if (
          !judged.ok ||
          judged.model !== input.catalog.evaluatorModel ||
          !validJudgeUsage(judged.usage)
        ) {
          failureCodes.push(judged.ok ? 'judge_evidence_mismatch' : judged.code);
          scenarioStopped = true;
          stopped = true;
          break;
        }
        judgedReplies += 1;
        evaluatorCostNanoUsd += judged.usage.costNanoUsd;
        if (!judged.pass) {
          scenarioFailed = true;
          behavioralFailure = true;
        }
      }
      if (scenarioStopped) break;
      scenarioCompletedTurns += 1;
      completedTurns += 1;
      const progress = await projectWithRefetch({
        ports,
        runId: input.runId,
        leaseFence,
        revision,
        scenarioId: entry.scenario.id,
        lifecycle: 'running',
        verdict: 'pending',
      });
      if (!progress.ok) {
        failureCodes.push(progress.code);
        scenarioStopped = true;
        stopped = true;
        break;
      }
      revision = progress.revision;
    }

    const nextStatus =
      sessionId === null
        ? 'not_run'
        : scenarioStopped
          ? 'stopped'
          : scenarioFailed
            ? 'failed'
            : 'passed';
    scenarios[scenarioOffset] = {
      scenarioId: entry.scenario.id,
      status: nextStatus,
      completedTurns: scenarioCompletedTurns,
    };
    if (scenarioStopped) {
      pendingStoppedScenario = {
        scenarioOffset,
        scenarioId: entry.scenario.id,
        observedSessionId: sessionId,
      };
    } else if (sessionId !== null) {
      const projected = await projectWithRefetch({
        ports,
        runId: input.runId,
        leaseFence,
        revision,
        scenarioId: entry.scenario.id,
        lifecycle: 'completed',
        verdict: scenarioFailed ? 'failed' : 'passed',
      });
      if (!projected.ok) {
        failureCodes.push(projected.code);
        stopped = true;
      } else {
        revision = projected.revision;
      }
    }
    if (stopped) break;
  }

  return await terminalize();

  async function terminateAfterProvision(code: string): Promise<MatrixCorpusRunResult> {
    failureCodes.push(code);
    stopped = true;
    if (!active) {
      const cleanup = await safely(() => ports.cleanup({ runId: input.runId, leaseFence }));
      cleanupCompleted = cleanup.ok;
      if (!cleanup.ok) failureCodes.push(cleanup.code);
      return snapshot();
    }
    return await terminalize();
  }

  async function terminalize(): Promise<MatrixCorpusRunResult> {
    const outcome = stopped ? 'stopped' : behavioralFailure ? 'failed' : 'passed';
    const quiesce = await safely(() => ports.quiesceRun({ runId: input.runId, leaseFence }));
    if (!quiesce.ok) return terminalFailure(quiesce.code);
    const drain = await safely(() => ports.waitForDrain({ runId: input.runId, leaseFence }));
    if (!drain.ok) return terminalFailure(drain.code);
    if (pendingStoppedScenario !== null) {
      const reconciled = await reconcileStoppedScenarioWithRefetch({
        ports,
        runId: input.runId,
        leaseFence,
        revision,
        scenarioId: pendingStoppedScenario.scenarioId,
        observedSessionId: pendingStoppedScenario.observedSessionId,
      });
      if (!reconciled.ok) return terminalFailure(reconciled.code);
      revision = reconciled.revision;
      agentCostNanoUsd += reconciled.additionalAgentCostNanoUsd;
      const scenario = scenarios[pendingStoppedScenario.scenarioOffset];
      if (scenario === undefined) return terminalFailure('stopped_scenario_missing');
      scenarios[pendingStoppedScenario.scenarioOffset] = {
        ...scenario,
        status: reconciled.disposition === 'projected' ? 'stopped' : 'not_run',
      };
      pendingStoppedScenario = null;
    }
    const staged = await safely(() =>
      ports.stageArtifacts({ runId: input.runId, leaseFence, outcome })
    );
    if (!staged.ok) return terminalFailure(staged.code);
    revision = staged.value.revision;
    const finalized = await safely(() =>
      ports.finalizeContext({
        runId: input.runId,
        leaseFence,
        expectedRevision: revision,
        artifactStageDigest: staged.value.artifactStageDigest,
        outcome,
      })
    );
    if (!finalized.ok) return terminalFailure(finalized.code);
    const finalProjection = await projectFinalizingWithRefetch({
      ports,
      runId: input.runId,
      leaseFence,
      revision,
      artifactStageDigest: staged.value.artifactStageDigest,
      tombstoneDigest: finalized.value.tombstoneDigest,
      outcome,
    });
    if (!finalProjection.ok) return terminalFailure(finalProjection.code);
    revision = finalProjection.revision;
    const release = await safely(() => ports.releaseRun({ runId: input.runId, leaseFence }));
    if (!release.ok) return terminalFailure(release.code);
    const terminal = await safely(() =>
      ports.waitForTerminalAcknowledgement({ runId: input.runId, leaseFence })
    );
    if (!terminal.ok) return terminalFailure(terminal.code);
    terminalAcknowledged = true;
    const cleanup = await safely(() => ports.cleanup({ runId: input.runId, leaseFence }));
    if (!cleanup.ok) return terminalFailure(cleanup.code);
    cleanupCompleted = true;
    return snapshot();
  }

  function terminalFailure(code: string): MatrixCorpusRunResult {
    failureCodes.push(code);
    stopped = true;
    return snapshot();
  }

  function snapshot(): MatrixCorpusRunResult {
    const effectiveKind = stopped
      ? 'infrastructure_failure'
      : behavioralFailure
        ? 'behavioral_failure'
        : 'passed';
    return {
      runId: input.runId,
      effectiveKind,
      exitCode: effectiveKind === 'passed' ? 0 : effectiveKind === 'behavioral_failure' ? 1 : 2,
      failureCodes,
      scenarios,
      totals: { completedTurns, judgedReplies, agentCostNanoUsd, evaluatorCostNanoUsd },
      terminalAcknowledged,
      cleanupCompleted,
    };
  }
}

async function projectRunningWithRefetch(input: {
  ports: MatrixCorpusRunPorts;
  runId: string;
  leaseFence: string;
  revision: number;
}): Promise<{ ok: true; revision: number } | { ok: false; code: string }> {
  let revision = input.revision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await safelyProjection(() =>
      input.ports.projectRunning({
        runId: input.runId,
        leaseFence: input.leaseFence,
        expectedRevision: revision,
      })
    );
    if (result.ok) return result;
    if (result.kind !== 'revision_conflict' || attempt === 1)
      return { ok: false, code: result.code };
    const current = await safely(() =>
      input.ports.getProjectionRevision({ runId: input.runId, leaseFence: input.leaseFence })
    );
    if (!current.ok) return current;
    revision = current.value.revision;
  }
  return { ok: false, code: 'running_projection_retry_exhausted' };
}

async function reconcileStoppedScenarioWithRefetch(input: {
  ports: MatrixCorpusRunPorts;
  runId: string;
  leaseFence: string;
  revision: number;
  scenarioId: string;
  observedSessionId: string | null;
}): Promise<
  | {
      ok: true;
      revision: number;
      disposition: 'projected' | 'not_bound';
      additionalAgentCostNanoUsd: number;
    }
  | { ok: false; code: string }
> {
  let revision = input.revision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await safelyStoppedScenarioReconciliation(() =>
      input.ports.reconcileStoppedScenario({
        runId: input.runId,
        leaseFence: input.leaseFence,
        expectedRevision: revision,
        scenarioId: input.scenarioId,
        observedSessionId: input.observedSessionId,
      })
    );
    if (result.ok) return result;
    if (result.kind !== 'revision_conflict' || attempt === 1)
      return { ok: false, code: result.code };
    const current = await safely(() =>
      input.ports.getProjectionRevision({ runId: input.runId, leaseFence: input.leaseFence })
    );
    if (!current.ok) return current;
    revision = current.value.revision;
  }
  return { ok: false, code: 'stopped_scenario_reconciliation_retry_exhausted' };
}

async function projectWithRefetch(input: {
  ports: MatrixCorpusRunPorts;
  runId: string;
  leaseFence: string;
  revision: number;
  scenarioId: string;
  lifecycle: 'running' | 'completed' | 'stopped';
  verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated';
}): Promise<{ ok: true; revision: number } | { ok: false; code: string }> {
  let revision = input.revision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await safelyProjection(() =>
      input.ports.projectScenario({
        runId: input.runId,
        leaseFence: input.leaseFence,
        expectedRevision: revision,
        scenarioId: input.scenarioId,
        lifecycle: input.lifecycle,
        verdict: input.verdict,
      })
    );
    if (result.ok) return result;
    if (result.kind !== 'revision_conflict' || attempt === 1)
      return { ok: false, code: result.code };
    const current = await safely(() =>
      input.ports.getProjectionRevision({ runId: input.runId, leaseFence: input.leaseFence })
    );
    if (!current.ok) return current;
    revision = current.value.revision;
  }
  return { ok: false, code: 'projection_retry_exhausted' };
}

async function projectFinalizingWithRefetch(input: {
  ports: MatrixCorpusRunPorts;
  runId: string;
  leaseFence: string;
  revision: number;
  artifactStageDigest: string;
  tombstoneDigest: string;
  outcome: 'passed' | 'failed' | 'stopped';
}): Promise<{ ok: true; revision: number } | { ok: false; code: string }> {
  let revision = input.revision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await safelyProjection(() =>
      input.ports.projectFinalizing({
        runId: input.runId,
        leaseFence: input.leaseFence,
        expectedRevision: revision,
        artifactStageDigest: input.artifactStageDigest,
        tombstoneDigest: input.tombstoneDigest,
        outcome: input.outcome,
      })
    );
    if (result.ok) return result;
    if (result.kind !== 'revision_conflict' || attempt === 1) {
      return { ok: false, code: result.code };
    }
    const current = await safely(() =>
      input.ports.getProjectionRevision({ runId: input.runId, leaseFence: input.leaseFence })
    );
    if (!current.ok) return current;
    revision = current.value.revision;
  }
  return { ok: false, code: 'final_projection_retry_exhausted' };
}

function reconcileTurnEvidence(input: {
  observation: MatrixCorpusTurnObservation;
  scenario: IntexEvalScenario;
  scenarioLabel: string;
  expectedSessionId: string | null;
  turnIndex: number;
  expectedAgentModel: string;
}):
  | { readonly ok: true; readonly behavioralPassed: boolean }
  | { readonly ok: false; readonly code: string } {
  const { observation, scenario, turnIndex } = input;
  const turn = scenario.turns[turnIndex];
  const expected = scenario.expected.turns[turnIndex];
  if (turn === undefined || expected === undefined)
    return { ok: false, code: 'TURN_CATALOG_EVIDENCE_MISSING' };

  const expectedBinding = input.expectedSessionId === null ? 'created' : 'continued';
  if (observation.sessionId.length === 0) return { ok: false, code: 'TURN_SESSION_ID_MISSING' };
  if (input.expectedSessionId !== null && observation.sessionId !== input.expectedSessionId)
    return { ok: false, code: 'TURN_SESSION_ID_MISMATCH' };
  if (observation.sessionEvidence.kind !== expectedBinding)
    return { ok: false, code: 'TURN_SESSION_BINDING_MISMATCH' };
  if (observation.sessionEvidence.scenarioLabel !== input.scenarioLabel)
    return { ok: false, code: 'TURN_SCENARIO_LABEL_MISMATCH' };
  if (observation.agentModel !== input.expectedAgentModel)
    return { ok: false, code: 'TURN_AGENT_MODEL_MISMATCH' };
  if (!validUsage(observation.agentUsage)) return { ok: false, code: 'TURN_AGENT_USAGE_INVALID' };
  if (!observation.agentUsage.providerCostReconciled)
    return { ok: false, code: 'TURN_AGENT_COST_UNRECONCILED' };
  if (
    turn.kind === 'confirmation_button'
      ? observation.agentUsage.logicalCalls !== 0
      : observation.agentUsage.logicalCalls < 1
  )
    return { ok: false, code: 'TURN_AGENT_CALL_COUNT_MISMATCH' };
  if (
    !Number.isSafeInteger(observation.observedReplyCount) ||
    observation.observedReplyCount < 0 ||
    observation.observedReplyCount > 5
  )
    return { ok: false, code: 'TURN_REPLY_COUNT_INVALID' };
  if (observation.replyEvaluations.length !== observation.observedReplyCount)
    return { ok: false, code: 'TURN_REPLY_EVALUATION_COUNT_MISMATCH' };
  if (observation.transportEvidence.turnTerminal !== 'completed')
    return { ok: false, code: 'TURN_TERMINAL_EVIDENCE_MISSING' };
  if (observation.transportEvidence.replyDigests.length !== observation.observedReplyCount)
    return { ok: false, code: 'TURN_REPLY_DIGEST_COUNT_MISMATCH' };
  if (!validToolEvidence(observation.toolEvidence))
    return { ok: false, code: 'TURN_TOOL_EVIDENCE_INVALID' };

  const replyMetadataMatches = observation.replyEvaluations.every((reply, replyIndex) => {
    const expectedReply = expected.replies[replyIndex];
    const semanticCriteria =
      expectedReply?.semanticCriteria ?? MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA;
    return (
      reply.scenarioId === scenario.id &&
      reply.turnIndex === turnIndex &&
      reply.replyIndex === replyIndex &&
      sameStrings(reply.semanticCriteria, semanticCriteria) &&
      observation.transportEvidence.replyDigests[replyIndex] ===
        digestMatrixReply(reply.assistantText, replyIndex)
    );
  });
  if (!replyMetadataMatches) return { ok: false, code: 'TURN_REPLY_METADATA_MISMATCH' };

  if (turn.kind === 'confirmation_button') {
    if (
      observation.confirmationEvidence.kind !== 'resolved' ||
      observation.confirmationEvidence.previousTurnIndex !== turn.previousTurnIndex ||
      observation.confirmationEvidence.decision !== turn.decision
    ) {
      return { ok: false, code: 'TURN_CONFIRMATION_EVIDENCE_MISMATCH' };
    }
  } else if (observation.confirmationEvidence.kind !== 'not_applicable') {
    return { ok: false, code: 'TURN_CONFIRMATION_EVIDENCE_MISMATCH' };
  }

  const expectedTools = expected.requiredToolCalls.flatMap((requirement) =>
    Array.from({ length: requirement.count }, (_, index) => ({
      toolName: requirement.toolName,
      ordinal: index + 1,
    }))
  );
  const toolsPassed =
    sameToolKeys(observation.toolEvidence.selectedScheduled, expectedTools) &&
    sameToolKeys(observation.toolEvidence.mockOutcomes, expectedTools) &&
    observation.toolEvidence.mockOutcomes.every(({ status }) => status === 'completed') &&
    observation.toolEvidence.unexpectedKnownToolCount === 0;
  return {
    ok: true,
    behavioralPassed:
      observation.deterministicPassed &&
      observation.observedReplyCount === expected.replies.length &&
      toolsPassed,
  };
}

function validToolEvidence(evidence: MatrixCorpusTurnObservation['toolEvidence']): boolean {
  const selectedKeys = evidence.selectedScheduled.map(toolKey);
  const outcomeKeys = evidence.mockOutcomes.map(toolKey);
  return (
    evidence.strictMockBoundary &&
    evidence.selectedScheduled.length <= 20 &&
    evidence.mockOutcomes.length <= 20 &&
    Number.isSafeInteger(evidence.unexpectedKnownToolCount) &&
    evidence.unexpectedKnownToolCount >= 0 &&
    evidence.selectedScheduled.every(validToolKey) &&
    evidence.mockOutcomes.every(validToolKey) &&
    new Set(selectedKeys).size === selectedKeys.length &&
    new Set(outcomeKeys).size === outcomeKeys.length &&
    sameStrings(selectedKeys, outcomeKeys)
  );
}

function validToolKey(value: { readonly toolName: string; readonly ordinal: number }): boolean {
  return (
    value.toolName.length > 0 &&
    Number.isSafeInteger(value.ordinal) &&
    value.ordinal >= 1 &&
    value.ordinal <= 20
  );
}

function toolKey(value: { readonly toolName: string; readonly ordinal: number }): string {
  return `${value.toolName}:${String(value.ordinal)}`;
}

function sameToolKeys(
  left: readonly { readonly toolName: string; readonly ordinal: number }[],
  right: readonly { readonly toolName: string; readonly ordinal: number }[]
): boolean {
  return sameStrings(left.map(toolKey), right.map(toolKey));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validUsage(usage: MatrixCorpusTurnObservation['agentUsage']): boolean {
  return (
    Number.isSafeInteger(usage.logicalCalls) &&
    usage.logicalCalls >= 0 &&
    validTokenUsage(usage) &&
    Number.isSafeInteger(usage.costNanoUsd) &&
    usage.costNanoUsd >= 0
  );
}

function validJudgeUsage(usage: Extract<MatrixCorpusJudgeResult, { ok: true }>['usage']): boolean {
  return (
    usage.logicalCalls === usage.repairCount + 1 &&
    (usage.repairCount === 0 || usage.repairCount === 1) &&
    validTokenUsage(usage) &&
    Number.isSafeInteger(usage.costNanoUsd) &&
    usage.costNanoUsd >= 0
  );
}

function validTokenUsage(usage: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}): boolean {
  return (
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0 &&
    Number.isSafeInteger(usage.totalTokens) &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

async function safely<T>(
  operation: () => Promise<MatrixCorpusOperationResult<T>>
): Promise<MatrixCorpusOperationResult<T>> {
  try {
    return await operation();
  } catch {
    return { ok: false, code: 'unexpected_failure' };
  }
}

async function safelyTurn(
  operation: () => Promise<MatrixCorpusTurnExecutionResult>
): Promise<MatrixCorpusTurnExecutionResult> {
  try {
    return await operation();
  } catch {
    return { ok: false, kind: 'infrastructure_failure', code: 'unexpected_turn_failure' };
  }
}

async function safelyJudge(
  operation: () => Promise<MatrixCorpusJudgeResult>
): Promise<MatrixCorpusJudgeResult> {
  try {
    return await operation();
  } catch {
    return { ok: false, code: 'unexpected_judge_failure' };
  }
}

async function safelyProjection(
  operation: () => Promise<MatrixCorpusProjectionMutationResult>
): Promise<MatrixCorpusProjectionMutationResult> {
  try {
    return await operation();
  } catch {
    return { ok: false, kind: 'failed', code: 'unexpected_projection_failure' };
  }
}

async function safelyStoppedScenarioReconciliation(
  operation: () => Promise<MatrixCorpusStoppedScenarioReconciliationResult>
): Promise<MatrixCorpusStoppedScenarioReconciliationResult> {
  try {
    return await operation();
  } catch {
    return { ok: false, kind: 'failed', code: 'unexpected_projection_failure' };
  }
}

function earlyFailure(
  runId: string,
  scenarios: readonly MatrixCorpusScenarioRunResult[],
  code: string
): MatrixCorpusRunResult {
  return {
    runId,
    effectiveKind: 'infrastructure_failure',
    exitCode: 2,
    failureCodes: [code],
    scenarios,
    totals: { completedTurns: 0, judgedReplies: 0, agentCostNanoUsd: 0, evaluatorCostNanoUsd: 0 },
    terminalAcknowledged: false,
    cleanupCompleted: false,
  };
}
