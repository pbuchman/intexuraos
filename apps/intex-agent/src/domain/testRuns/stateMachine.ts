import { createHash } from 'node:crypto';

import type {
  IntexAgentTestRunRecordV1,
  TestArtifactDeliveryV1,
  TestRunArtifactDeliveryCommandV1,
  TestRunProjectionCasCommandV1,
  TestRunTerminalControlCommandV1,
  TestRunTransitionFailureCode,
  TestRunTransitionResult,
} from './types.js';
import {
  deriveTestRunScenarioTotals,
  isScenarioProjectionEvidenceConsistent,
  isIntexAgentTestRunRecordV1,
  isTerminalOutcomeCompatible,
} from './types.js';

export function applyTestRunProjectionCas(
  current: IntexAgentTestRunRecordV1,
  command: TestRunProjectionCasCommandV1
): TestRunTransitionResult {
  if (!isIntexAgentTestRunRecordV1(current)) return failure('INVALID_RECORD');
  if (command.expectedRevision !== current.revision) return failure('REVISION_CONFLICT');
  if (!isEvaluatorTransitionAllowed(current.lifecycle, command.nextLifecycle))
    return failure('INVALID_TRANSITION');
  if (
    command.retentionReconciled === true &&
    (current.lifecycle !== 'preflight' ||
      command.nextLifecycle !== 'preflight' ||
      command.scenario !== null ||
      command.finalization !== null)
  )
    return failure('INVALID_TRANSITION');

  let scenarios = current.scenarios;
  if (command.scenario !== null) {
    const index = scenarios.findIndex(
      (scenario) => scenario.scenarioId === command.scenario?.scenarioId
    );
    const existing = scenarios[index];
    if (existing === undefined) return failure('INVALID_TRANSITION');
    if (existing.scenarioRevision !== command.scenario.expectedScenarioRevision)
      return failure('SCENARIO_REVISION_CONFLICT');
    if (
      command.scenario.eventWatermark < existing.eventWatermark
    )
      return failure('EVENT_WATERMARK_GAP');
    if (existing.sessionId !== null && existing.sessionId !== command.scenario.sessionId)
      return failure('INVALID_TRANSITION');
    if (
      command.scenario.summary.scenarioId !== existing.scenarioId ||
      command.scenario.summary.scenarioNumber !== existing.scenarioNumber ||
      command.scenario.summary.scenarioLabel !== existing.scenarioLabel ||
      command.scenario.summary.plannedTurns !== existing.plannedTurns ||
      command.scenario.summary.expectedReplies !== existing.expectedReplies ||
      command.scenario.summary.scenarioRevision !== existing.scenarioRevision + 1 ||
      command.scenario.summary.lifecycle !== command.scenario.lifecycle ||
      command.scenario.summary.verdict !== command.scenario.verdict ||
      !isScenarioTransitionAllowed(existing.lifecycle, command.scenario.lifecycle) ||
      command.scenario.projection.runId !== current.runId ||
      command.scenario.projection.userId !== current.userId ||
      command.scenario.projection.sessionId !== command.scenario.sessionId ||
      command.scenario.projection.sessionBindingDigest !== command.scenario.sessionBindingDigest ||
      command.scenario.projection.scenarioId !== existing.scenarioId ||
      command.scenario.projection.scenarioNumber !== existing.scenarioNumber ||
      command.scenario.projection.scenarioLabel !== existing.scenarioLabel ||
      command.scenario.projection.scenarioRevision !== existing.scenarioRevision + 1 ||
      command.scenario.projection.runRevision !== current.revision + 1 ||
      command.scenario.projection.eventWatermark !== command.scenario.eventWatermark ||
      command.scenario.projection.lifecycle !== command.scenario.lifecycle ||
      command.scenario.projection.verdict !== command.scenario.verdict ||
      command.scenario.projection.plannedTurns !== command.scenario.summary.plannedTurns ||
      command.scenario.projection.completedTurns !== command.scenario.summary.completedTurns ||
      !isScenarioProjectionEvidenceConsistent(
        command.scenario.summary,
        command.scenario.projection
      )
    )
      return failure('INVALID_TRANSITION');
    const updated = {
      ...structuredClone(command.scenario.summary),
      scenarioRevision: existing.scenarioRevision + 1,
      eventWatermark: command.scenario.eventWatermark,
      sessionId: command.scenario.sessionId,
      sessionBindingDigest: command.scenario.sessionBindingDigest,
    };
    scenarios = scenarios.map((scenario, scenarioIndex) =>
      scenarioIndex === index ? updated : scenario
    );
  }

  const artifactDelivery = current.artifactDelivery;
  let contextFinalizationTombstoneDigest = current.contextFinalizationTombstoneDigest;
  let artifactStageDigest = current.artifactStageDigest;
  let terminalCandidate = current.terminalCandidate;
  if (command.nextLifecycle === 'finalizing') {
    if (
      current.lifecycle !== 'running' ||
      current.artifactDelivery.status !== 'staged' ||
      current.artifactStageDigest !== command.finalization?.artifactStageDigest ||
      command.finalization.terminalCandidate.artifactCandidateDigest !==
        current.artifactStageDigest ||
      command.finalization.terminalCandidate.artifactStageRevision !== current.revision ||
      command.finalization.terminalCandidate.createdAt !== command.updatedAt ||
      command.finalization.terminalCandidate.runId !== current.runId ||
      command.finalization.terminalCandidate.userId !== current.userId ||
      command.finalization.terminalCandidate.leaseFence !== current.leaseFence ||
      !isTerminalOutcomeCompatible(
        current.scenarios,
        current.cost,
        command.finalization.terminalCandidate.outcome
      )
    )
      return failure('FINALIZATION_MISMATCH');
    contextFinalizationTombstoneDigest = command.finalization.tombstoneDigest;
    artifactStageDigest = command.finalization.artifactStageDigest;
    terminalCandidate = structuredClone(command.finalization.terminalCandidate);
  } else if (command.finalization !== null) {
    return failure('FINALIZATION_MISMATCH');
  }

  const next: IntexAgentTestRunRecordV1 = {
    ...structuredClone(current),
    revision: current.revision + 1,
    lifecycle: command.nextLifecycle,
    updatedAt: command.updatedAt,
    retentionReconciled:
      command.retentionReconciled === true ? true : current.retentionReconciled,
    artifactDelivery,
    contextFinalizationTombstoneDigest,
    artifactStageDigest,
    terminalCandidate,
    scenarios,
    currentScenarioNumber:
      scenarios.find((scenario) => scenario.lifecycle === 'running')?.scenarioNumber ?? null,
    totals: {
      ...current.totals,
      ...deriveTestRunScenarioTotals(scenarios),
      replies: {
        ...deriveTestRunScenarioTotals(scenarios).replies,
        judged: current.totals.replies.judged,
      },
    },
  };
  return isIntexAgentTestRunRecordV1(next)
    ? { ok: true, disposition: 'applied', record: next }
    : failure('INVALID_TRANSITION');
}

function isScenarioTransitionAllowed(
  current: IntexAgentTestRunRecordV1['scenarios'][number]['lifecycle'],
  next: IntexAgentTestRunRecordV1['scenarios'][number]['lifecycle']
): boolean {
  if (current === 'pending' || current === 'not_run')
    return next === 'running' || next === 'stopped';
  if (current === 'running')
    return next === 'running' || next === 'completed' || next === 'stopped';
  return false;
}

export function applyTestRunTerminalControl(
  current: IntexAgentTestRunRecordV1,
  command: TestRunTerminalControlCommandV1,
  actualTerminalCandidateDigest: string | null
): TestRunTransitionResult {
  if (!isIntexAgentTestRunRecordV1(current)) return failure('INVALID_RECORD');
  if (current.terminalWinner !== null)
    return { ok: true, disposition: 'already_applied', record: structuredClone(current) };

  if (command.kind === 'release') {
    if (
      current.lifecycle !== 'finalizing' ||
      current.terminalCandidate === null ||
      actualTerminalCandidateDigest === null ||
      command.tombstoneDigest !== current.contextFinalizationTombstoneDigest ||
      command.terminalCandidateDigest !== actualTerminalCandidateDigest ||
      command.artifactStageDigest !== current.artifactStageDigest
    )
      return failure('FINALIZATION_MISMATCH');
    const terminal = outcomeToTerminal(current.terminalCandidate.outcome);
    const next: IntexAgentTestRunRecordV1 = {
      ...structuredClone(current),
      revision: current.revision + 1,
      lifecycle: terminal.lifecycle,
      verdict: terminal.verdict,
      updatedAt: command.acknowledgedAt,
      finishedAt: command.acknowledgedAt,
      terminalWinner: {
        kind: 'release',
        eventId: command.eventId,
        payloadDigest: command.payloadDigest,
        outcome: current.terminalCandidate.outcome,
        acknowledgedAt: command.acknowledgedAt,
      },
    };
    return isIntexAgentTestRunRecordV1(next)
      ? { ok: true, disposition: 'applied', record: next }
      : failure('INVALID_TRANSITION');
  }

  if (current.lifecycle !== 'running' && current.lifecycle !== 'finalizing')
    return failure('INVALID_TRANSITION');
  const artifactDelivery = abandonedArtifactDelivery(
    current.artifactDelivery,
    command.acknowledgedAt
  );
  const scenarios = current.scenarios.map((scenario) => {
    if (scenario.lifecycle === 'completed') return structuredClone(scenario);
    if (scenario.lifecycle === 'running')
      return {
        ...scenario,
        scenarioRevision: scenario.scenarioRevision + 1,
        lifecycle: 'stopped' as const,
        verdict: 'not_evaluated' as const,
        deterministicVerdict: 'not_evaluated' as const,
        semanticVerdict: 'not_evaluated' as const,
      };
    return {
      ...scenario,
      scenarioRevision: scenario.scenarioRevision + 1,
      lifecycle: 'not_run' as const,
      verdict: 'not_evaluated' as const,
      deterministicVerdict: 'not_evaluated' as const,
      semanticVerdict: 'not_evaluated' as const,
    };
  });
  const next: IntexAgentTestRunRecordV1 = {
    ...structuredClone(current),
    revision: current.revision + 1,
    lifecycle: 'stopped',
    verdict: 'not_evaluated',
    artifactDelivery,
    scenarios,
    updatedAt: command.acknowledgedAt,
    finishedAt: command.acknowledgedAt,
    terminalWinner: {
      kind: 'abandoned',
      eventId: command.eventId,
      payloadDigest: command.payloadDigest,
      outcome: 'stopped_not_evaluated',
      acknowledgedAt: command.acknowledgedAt,
    },
    currentScenarioNumber: null,
    totals: terminalTotals(current.totals, scenarios),
  };
  return isIntexAgentTestRunRecordV1(next)
    ? { ok: true, disposition: 'applied', record: next }
    : failure('INVALID_TRANSITION');
}

function terminalTotals(
  current: IntexAgentTestRunRecordV1['totals'],
  scenarios: IntexAgentTestRunRecordV1['scenarios']
): IntexAgentTestRunRecordV1['totals'] {
  const derived = deriveTestRunScenarioTotals(scenarios);
  return {
    ...current,
    ...derived,
    replies: { ...derived.replies, judged: current.replies.judged },
  };
}

export function applyArtifactDeliveryTransition(
  current: IntexAgentTestRunRecordV1,
  command: TestRunArtifactDeliveryCommandV1
): TestRunTransitionResult {
  if (!isIntexAgentTestRunRecordV1(current)) return failure('INVALID_RECORD');
  if (command.expectedRevision !== current.revision) return failure('REVISION_CONFLICT');

  let artifactDelivery: TestArtifactDeliveryV1;
  let artifactStageDigest = current.artifactStageDigest;
  if (command.next.status === 'staged') {
    if (
      current.artifactDelivery.status !== 'pending' ||
      (current.lifecycle !== 'preflight' && current.lifecycle !== 'running')
    )
      return failure('INVALID_TRANSITION');
    artifactStageDigest = digestArtifactCandidates(
      command.next.jsonCandidateDigest,
      command.next.markdownCandidateDigest
    );
    artifactDelivery = { status: 'staged', failureCode: null, updatedAt: command.updatedAt };
  } else if (command.next.status === 'failed') {
    const preterminal = current.lifecycle === 'preflight' || current.lifecycle === 'running';
    if (
      (preterminal &&
        (current.artifactDelivery.status !== 'pending' ||
          command.next.failureCode === 'REPORT_PUBLICATION_FAILED')) ||
      (!preterminal &&
        (current.artifactDelivery.status !== 'staged' ||
          command.next.failureCode !== 'REPORT_PUBLICATION_FAILED' ||
          current.terminalWinner?.eventId !== command.next.terminalControlEventId))
    )
      return failure('INVALID_TRANSITION');
    artifactDelivery = {
      status: 'failed',
      failureCode: command.next.failureCode,
      updatedAt: command.updatedAt,
    };
  } else if (command.next.status === 'ready') {
    if (
      current.artifactDelivery.status !== 'staged' ||
      (current.lifecycle !== 'completed' && current.lifecycle !== 'stopped') ||
      current.terminalWinner?.eventId !== command.next.terminalControlEventId
    )
      return failure('INVALID_TRANSITION');
    artifactDelivery = { status: 'ready', failureCode: null, updatedAt: command.updatedAt };
  } else {
    if (
      current.artifactDelivery.status !== 'staged' ||
      (current.lifecycle !== 'completed' && current.lifecycle !== 'stopped') ||
      current.finishedAt === null
    )
      return failure('INVALID_TRANSITION');
    artifactDelivery = {
      status: 'unknown',
      failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
      updatedAt: command.updatedAt,
    };
  }

  const next = {
    ...structuredClone(current),
    revision: current.revision + 1,
    updatedAt: command.updatedAt,
    artifactDelivery,
    artifactStageDigest,
  };
  return isIntexAgentTestRunRecordV1(next)
    ? { ok: true, disposition: 'applied', record: next }
    : failure('INVALID_TRANSITION');
}

export function applyAbandonedRecovery(
  current: IntexAgentTestRunRecordV1,
  command: Extract<TestRunTerminalControlCommandV1, { kind: 'abandoned' }>
): TestRunTransitionResult {
  return applyTestRunTerminalControl(current, command, null);
}

function isEvaluatorTransitionAllowed(
  current: IntexAgentTestRunRecordV1['lifecycle'],
  next: TestRunProjectionCasCommandV1['nextLifecycle']
): boolean {
  return (
    (current === 'preflight' && (next === 'preflight' || next === 'running')) ||
    (current === 'running' && (next === 'running' || next === 'finalizing'))
  );
}

function outcomeToTerminal(
  outcome: NonNullable<IntexAgentTestRunRecordV1['terminalCandidate']>['outcome']
): Pick<IntexAgentTestRunRecordV1, 'lifecycle' | 'verdict'> {
  if (outcome === 'completed_passed') return { lifecycle: 'completed', verdict: 'passed' };
  if (outcome === 'completed_failed') return { lifecycle: 'completed', verdict: 'failed' };
  return { lifecycle: 'stopped', verdict: 'not_evaluated' };
}

function abandonedArtifactDelivery(
  current: TestArtifactDeliveryV1,
  updatedAt: string
): TestArtifactDeliveryV1 {
  if (current.status === 'pending')
    return { status: 'failed', failureCode: 'REPORT_STAGING_INTERRUPTED', updatedAt };
  if (current.status === 'staged')
    return { status: 'unknown', failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT', updatedAt };
  return current;
}

export function digestArtifactCandidates(jsonDigest: string, markdownDigest: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ jsonCandidateDigest: jsonDigest, markdownCandidateDigest: markdownDigest }), 'utf8')
    .digest('hex');
}

function failure(
  code: TestRunTransitionFailureCode
): Readonly<{ ok: false; code: TestRunTransitionFailureCode }> {
  return { ok: false, code } as const;
}
