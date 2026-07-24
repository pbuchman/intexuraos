import { describe, expect, it } from 'vitest';

import {
  applyArtifactDeliveryTransition,
  applyTestRunProjectionCas,
  applyTestRunTerminalControl,
  digestArtifactCandidates,
} from '../../../domain/testRuns/stateMachine.js';
import {
  isIntexAgentTestRunRecordV1,
  type TestRunProjectionCasCommandV1,
} from '../../../domain/testRuns/types.js';
import {
  emptyDeterministicEvidence,
  testRunRecord,
  testRunScenario,
} from './testRunFixtures.js';

const later = '2026-07-20T10:05:00.000Z';
const candidate = {
  version: 1 as const,
  runId: 'run_1',
  userId: 'auth0:user_1',
  leaseFence: '7',
  outcome: 'stopped_not_evaluated' as const,
  projectionDigest: 'b'.repeat(64),
  artifactStageRevision: 2,
  artifactCandidateDigest: digestArtifactCandidates('1'.repeat(64), '2'.repeat(64)),
  createdAt: later,
};

describe('Test Run foundation state machine', () => {
  it('requires canonical UTC-millisecond timestamps for ordered persistence', () => {
    expect(
      isIntexAgentTestRunRecordV1({
        ...testRunRecord(),
        startedAt: '2026-07-20T12:00:00+02:00',
      })
    ).toBe(false);
  });
  it('allows only preflight -> running -> finalizing evaluator progression', () => {
    const running = applyTestRunProjectionCas(testRunRecord(), {
      expectedRevision: 0,
      nextLifecycle: 'running',
      updatedAt: later,
      scenario: null,
      finalization: null,
    });
    expect(running).toMatchObject({
      ok: true,
      disposition: 'applied',
      record: { revision: 1, lifecycle: 'running', verdict: 'pending' },
    });
    if (!running.ok) throw new Error('fixture transition failed');

    const staged = applyArtifactDeliveryTransition(running.record, {
      expectedRevision: 1,
      updatedAt: later,
      next: {
        status: 'staged',
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
      },
    });
    if (!staged.ok || staged.record.artifactStageDigest === null)
      throw new Error('fixture staging transition failed');
    const finalizing = applyTestRunProjectionCas(staged.record, {
      expectedRevision: 2,
      nextLifecycle: 'finalizing',
      updatedAt: later,
      scenario: null,
      finalization: {
        tombstoneDigest: 'd'.repeat(64),
        artifactStageDigest: staged.record.artifactStageDigest,
        terminalCandidate: candidate,
      },
    });
    expect(finalizing).toMatchObject({
      ok: true,
      record: {
        revision: 3,
        lifecycle: 'finalizing',
        terminalCandidate: candidate,
      },
    });

    if (!finalizing.ok) throw new Error('fixture finalizing transition failed');
    expect(
      applyTestRunProjectionCas(finalizing.record, {
        expectedRevision: 3,
        nextLifecycle: 'finalizing',
        updatedAt: later,
        scenario: null,
        finalization: {
          tombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: staged.record.artifactStageDigest,
          terminalCandidate: candidate,
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('marks retention reconciled only as a dedicated preflight mutation', () => {
    const current = testRunRecord({ retentionReconciled: false });
    expect(
      applyTestRunProjectionCas(current, {
        expectedRevision: 0,
        nextLifecycle: 'preflight',
        updatedAt: later,
        retentionReconciled: true,
        scenario: null,
        finalization: null,
      })
    ).toMatchObject({
      ok: true,
      record: { revision: 1, lifecycle: 'preflight', retentionReconciled: true },
    });
    expect(
      applyTestRunProjectionCas(
        testRunRecord({ lifecycle: 'running', revision: 1, retentionReconciled: false }),
        {
          expectedRevision: 1,
          nextLifecycle: 'running',
          updatedAt: later,
          retentionReconciled: true,
          scenario: null,
          finalization: null,
        }
      )
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('rejects stale revisions and direct terminal writes while allowing watermark catch-up', () => {
    expect(
      applyTestRunProjectionCas(testRunRecord(), {
        expectedRevision: 1,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: null,
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    expect(
      applyTestRunProjectionCas(testRunRecord(), {
        expectedRevision: 0,
        nextLifecycle: 'completed' as never,
        updatedAt: later,
        scenario: null,
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const withScenario = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: Array.from({ length: 20 }, (_, index) =>
        testRunScenario(index + 1, index === 0 ? {
          scenarioRevision: 1,
          eventWatermark: 3,
          lifecycle: 'running',
          verdict: 'pending',
          sessionId: 'matrix_session_1',
          sessionBindingDigest: '9'.repeat(64),
        } : {})
      ),
    });
    const result = applyTestRunProjectionCas(withScenario, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: projectionScenarioCommand({
          expectedScenarioRevision: 1,
          nextScenarioRevision: 2,
          eventWatermark: 5,
          runRevision: 3,
        }),
        finalization: null,
      });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('fixture projection failed');
    expect(result.record.scenarios[0]).toMatchObject({
      eventWatermark: 5,
      scenarioRevision: 2,
    });
  });

  it('covers every allowed scenario lifecycle edge', () => {
    const pendingCurrent = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: Array.from({ length: 20 }, (_, index) =>
        testRunScenario(index + 1, index === 0 ? { lifecycle: 'pending' } : {})
      ),
    });
    const start = projectionScenarioCommand({
      expectedScenarioRevision: 0,
      nextScenarioRevision: 1,
      eventWatermark: 1,
      runRevision: 3,
    });
    expect(
      applyTestRunProjectionCas(pendingCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: start,
        finalization: null,
      })
    ).toMatchObject({ ok: true, record: { currentScenarioNumber: 1 } });

    const stop = {
      ...start,
      lifecycle: 'stopped' as const,
      verdict: 'not_evaluated' as const,
      summary: {
        ...start.summary,
        lifecycle: 'stopped' as const,
        verdict: 'not_evaluated' as const,
        deterministicVerdict: 'not_evaluated' as const,
        semanticVerdict: 'not_evaluated' as const,
      },
      projection: {
        ...start.projection,
        lifecycle: 'stopped' as const,
        verdict: 'not_evaluated' as const,
      },
    };
    expect(
      applyTestRunProjectionCas(testRunRecord({ lifecycle: 'running', revision: 2 }), {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: stop,
        finalization: null,
      })
    ).toMatchObject({ ok: true, record: { currentScenarioNumber: null } });

    const runningCurrent = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: Array.from({ length: 20 }, (_, index) =>
        testRunScenario(
          index + 1,
          index === 0
            ? {
                scenarioRevision: 1,
                eventWatermark: 1,
                lifecycle: 'running',
                sessionId: 'matrix_session_1',
                sessionBindingDigest: '9'.repeat(64),
              }
            : {}
        )
      ),
    });
    expect(
      applyTestRunProjectionCas(runningCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          ...stop,
          expectedScenarioRevision: 1,
          summary: { ...stop.summary, scenarioRevision: 2 },
          projection: { ...stop.projection, scenarioRevision: 2 },
        },
        finalization: null,
      })
    ).toMatchObject({ ok: true, record: { currentScenarioNumber: null } });

    const completedSummary = {
      ...start.summary,
      scenarioRevision: 2,
      lifecycle: 'completed' as const,
      verdict: 'passed' as const,
      completedTurns: 1,
      completedReplies: 1,
      deterministicVerdict: 'passed' as const,
      semanticVerdict: 'passed' as const,
      startedAt: later,
      finishedAt: later,
      durationMs: 1,
    };
    expect(
      applyTestRunProjectionCas(runningCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          ...start,
          expectedScenarioRevision: 1,
          eventWatermark: 2,
          lifecycle: 'completed',
          verdict: 'passed',
          summary: completedSummary,
          projection: {
            ...start.projection,
            scenarioRevision: 2,
            eventWatermark: 2,
            lifecycle: 'completed',
            verdict: 'passed',
            completedTurns: 1,
            deterministicChecks: [
              {
                code: 'reply_count',
                status: 'passed',
                turnIndex: 0,
                replyIndex: 1,
                evidence: emptyDeterministicEvidence(),
              },
            ],
            replyEvaluations: [
              {
                turnIndex: 0,
                replyIndex: 1,
                verdict: 'passed',
                score: 5,
                criteria: {
                  understoodIntent: true,
                  helpful: true,
                  conciseAndClear: true,
                  professionalTone: true,
                  noPassiveAggression: true,
                },
                failureCodes: [],
                latencyMs: 1,
                usage: {
                  logicalCalls: 1,
                  repairCount: 0,
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                  costNanoUsd: 1,
                },
              },
            ],
          },
        },
        finalization: null,
      })
    ).toMatchObject({ ok: true, record: { currentScenarioNumber: null } });
  });

  it('fails closed when a transition constructs an invalid persisted record', () => {
    expect(
      applyTestRunProjectionCas({ ...testRunRecord(), revision: -1 } as never, {
        expectedRevision: -1,
        nextLifecycle: 'preflight',
        updatedAt: later,
        scenario: null,
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_RECORD' });
    expect(
      applyTestRunProjectionCas(testRunRecord(), {
        expectedRevision: 0,
        nextLifecycle: 'running',
        updatedAt: 'invalid',
        scenario: null,
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyTestRunProjectionCas(testRunRecord(), {
        expectedRevision: 0,
        nextLifecycle: 'preflight',
        updatedAt: later,
        scenario: null,
        finalization: {
          tombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: 'e'.repeat(64),
          terminalCandidate: candidate,
        },
      })
    ).toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });

    const finalizing = testRunRecord({
      lifecycle: 'finalizing',
      revision: 2,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      contextFinalizationTombstoneDigest: 'd'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      terminalCandidate: candidate,
    });
    const release = {
      kind: 'release' as const,
      eventId: 'terminal_event_1',
      payloadDigest: 'f'.repeat(64),
      tombstoneDigest: 'd'.repeat(64),
      terminalCandidateDigest: 'a'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      acknowledgedAt: 'invalid',
    };
    expect(applyTestRunTerminalControl(finalizing, release, 'a'.repeat(64))).toEqual({
      ok: false,
      code: 'INVALID_TRANSITION',
    });
    expect(
      applyTestRunTerminalControl(
        testRunRecord({ lifecycle: 'running' }),
        {
          kind: 'abandoned',
          eventId: 'abandoned_event_1',
          payloadDigest: 'f'.repeat(64),
          acknowledgedAt: 'invalid',
        },
        null
      )
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyArtifactDeliveryTransition(testRunRecord({ lifecycle: 'running' }), {
        expectedRevision: 0,
        updatedAt: 'invalid',
        next: {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('enforces immutable scenario catalog fields, lifecycle monotonicity, and projection-summary parity', () => {
    const completedScenario = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'completed',
      verdict: 'passed',
      completedTurns: 1,
      completedReplies: 1,
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
      startedAt: later,
      finishedAt: later,
      durationMs: 1,
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const current = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: [
        completedScenario,
        ...Array.from({ length: 19 }, (_, index) => testRunScenario(index + 2)),
      ],
    });
    const command = projectionScenarioCommand({
      expectedScenarioRevision: 1,
      nextScenarioRevision: 2,
      eventWatermark: 1,
      runRevision: 3,
    });

    expect(
      applyTestRunProjectionCas(current, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: command,
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const runningCurrent = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: Array.from({ length: 20 }, (_, index) =>
        testRunScenario(index + 1, index === 0 ? {
          scenarioRevision: 1,
          eventWatermark: 1,
          lifecycle: 'running',
          sessionId: 'matrix_session_1',
          sessionBindingDigest: '9'.repeat(64),
        } : {})
      ),
    });
    expect(
      applyTestRunProjectionCas(runningCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          ...command,
          summary: { ...command.summary, scenarioLabel: 'Changed label' },
        },
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyTestRunProjectionCas(runningCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          ...command,
          projection: { ...command.projection, lifecycle: 'completed', verdict: 'passed' },
        },
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const incompleteCompletion = projectionScenarioCommand({
      expectedScenarioRevision: 1,
      nextScenarioRevision: 2,
      eventWatermark: 2,
      runRevision: 3,
    });
    expect(
      applyTestRunProjectionCas(runningCurrent, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          ...incompleteCompletion,
          lifecycle: 'completed',
          verdict: 'passed',
          summary: {
            ...incompleteCompletion.summary,
            lifecycle: 'completed',
            verdict: 'passed',
            deterministicVerdict: 'passed',
            semanticVerdict: 'passed',
          },
          projection: {
            ...incompleteCompletion.projection,
            lifecycle: 'completed',
            verdict: 'passed',
          },
        },
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('closes a partially executed scenario as failed when deterministic evidence proves the blocker', () => {
    const runningScenario = testRunScenario(1, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      plannedTurns: 2,
      completedTurns: 1,
      expectedReplies: 2,
      completedReplies: 1,
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
      startedAt: later,
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
    });
    const current = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: [
        runningScenario,
        ...Array.from({ length: 19 }, (_, index) => testRunScenario(index + 2)),
      ],
    });
    const deterministicCheck = {
      code: 'confirmation_count' as const,
      status: 'failed' as const,
      turnIndex: 1,
      replyIndex: null,
      evidence: {
        ...emptyDeterministicEvidence(),
        expectedCount: 1,
        actualCount: 0,
      },
    };
    const summary = {
      ...runningScenario,
      scenarioRevision: 2,
      eventWatermark: 2,
      lifecycle: 'completed' as const,
      verdict: 'failed' as const,
      deterministicVerdict: 'failed' as const,
      semanticVerdict: 'passed' as const,
      finishedAt: later,
      durationMs: 0,
    };

    const result = applyTestRunProjectionCas(current, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: {
          scenarioId: summary.scenarioId,
          expectedScenarioRevision: 1,
          eventWatermark: 2,
          lifecycle: 'completed',
          verdict: 'failed',
          sessionId: 'matrix_session_1',
          sessionBindingDigest: '9'.repeat(64),
          summary,
          projection: {
            schemaVersion: 1,
            runId: 'run_1',
            userId: 'auth0:user_1',
            sessionId: 'matrix_session_1',
            sessionBindingDigest: '9'.repeat(64),
            scenarioId: summary.scenarioId,
            scenarioNumber: 1,
            scenarioLabel: summary.scenarioLabel,
            runRevision: 3,
            scenarioRevision: 2,
            eventWatermark: 2,
            lifecycle: 'completed',
            verdict: 'failed',
            plannedTurns: 2,
            completedTurns: 1,
            toolEvidence: [],
            deterministicChecks: [deterministicCheck],
            replyEvaluations: [
              {
                turnIndex: 0,
                replyIndex: 0,
                verdict: 'passed',
                score: 5,
                criteria: {
                  understoodIntent: true,
                  helpful: true,
                  conciseAndClear: true,
                  professionalTone: true,
                  noPassiveAggression: true,
                },
                failureCodes: [],
                latencyMs: 1,
                usage: {
                  logicalCalls: 1,
                  repairCount: 0,
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                  costNanoUsd: 1,
                },
              },
            ],
            agentUsage: [],
          },
        },
        finalization: null,
      });
    expect(result).toMatchObject({
      ok: true,
      record: {
        revision: 3,
        lifecycle: 'running',
      },
    });
    if (!result.ok) throw new Error('partial failed scenario projection was rejected');
    expect(result.record.scenarios[0]).toMatchObject({
      lifecycle: 'completed',
      verdict: 'failed',
      completedTurns: 1,
      plannedTurns: 2,
    });
  });

  it('rejects every changed scenario and projection correlation field', () => {
    const current = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: Array.from({ length: 20 }, (_, index) =>
        testRunScenario(
          index + 1,
          index === 0
            ? {
                scenarioRevision: 1,
                eventWatermark: 1,
                lifecycle: 'running',
                sessionId: 'matrix_session_1',
                sessionBindingDigest: '9'.repeat(64),
              }
            : {}
        )
      ),
    });
    const base = projectionScenarioCommand({
      expectedScenarioRevision: 1,
      nextScenarioRevision: 2,
      eventWatermark: 2,
      runRevision: 3,
    });
    expect(
      applyTestRunProjectionCas(current, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: { ...base, expectedScenarioRevision: 0 },
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'SCENARIO_REVISION_CONFLICT' });
    expect(
      applyTestRunProjectionCas(current, {
        expectedRevision: 2,
        nextLifecycle: 'running',
        updatedAt: later,
        scenario: { ...base, eventWatermark: 0 },
        finalization: null,
      })
    ).toEqual({ ok: false, code: 'EVENT_WATERMARK_GAP' });

    const changedCommands = [
      { ...base, scenarioId: 'scenario_unknown' },
      { ...base, sessionId: 'matrix_session_other' },
      { ...base, summary: { ...base.summary, scenarioId: 'scenario_other' } },
      { ...base, summary: { ...base.summary, scenarioNumber: 2 } },
      { ...base, summary: { ...base.summary, scenarioLabel: 'Other' } },
      { ...base, summary: { ...base.summary, plannedTurns: 2 } },
      { ...base, summary: { ...base.summary, expectedReplies: 2 } },
      { ...base, summary: { ...base.summary, scenarioRevision: 3 } },
      { ...base, summary: { ...base.summary, lifecycle: 'completed' as const } },
      { ...base, summary: { ...base.summary, verdict: 'passed' as const } },
      { ...base, projection: { ...base.projection, runId: 'run_other' } },
      { ...base, projection: { ...base.projection, userId: 'auth0:other' } },
      { ...base, projection: { ...base.projection, sessionId: 'matrix_session_other' } },
      {
        ...base,
        projection: { ...base.projection, sessionBindingDigest: '8'.repeat(64) },
      },
      { ...base, projection: { ...base.projection, scenarioId: 'scenario_other' } },
      { ...base, projection: { ...base.projection, scenarioNumber: 2 } },
      { ...base, projection: { ...base.projection, scenarioLabel: 'Other' } },
      { ...base, projection: { ...base.projection, scenarioRevision: 3 } },
      { ...base, projection: { ...base.projection, runRevision: 4 } },
      { ...base, projection: { ...base.projection, eventWatermark: 3 } },
      { ...base, projection: { ...base.projection, lifecycle: 'completed' as const } },
      { ...base, projection: { ...base.projection, verdict: 'passed' as const } },
      { ...base, projection: { ...base.projection, plannedTurns: 2 } },
      { ...base, projection: { ...base.projection, completedTurns: 1 } },
    ];
    for (const scenario of changedCommands)
      expect(
        applyTestRunProjectionCas(current, {
          expectedRevision: 2,
          nextLifecycle: 'running',
          updatedAt: later,
          scenario: scenario as never,
          finalization: null,
        })
      ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('lets signed release apply the immutable candidate exactly once', () => {
    const passedScenarios = Array.from({ length: 20 }, (_, index) =>
      testRunScenario(index + 1, {
        lifecycle: 'completed',
        verdict: 'passed',
        completedTurns: 1,
        completedReplies: 1,
        deterministicVerdict: 'passed',
        semanticVerdict: 'passed',
        startedAt: later,
        finishedAt: later,
        durationMs: 1,
      })
    );
    const passedCandidate = { ...candidate, outcome: 'completed_passed' as const };
    const finalizing = testRunRecord({
      lifecycle: 'finalizing',
      revision: 2,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      contextFinalizationTombstoneDigest: 'd'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      terminalCandidate: passedCandidate,
      scenarios: passedScenarios,
      cost: { agentNanoUsd: 10, evaluatorNanoUsd: 5, totalNanoUsd: 15 },
    });
    const command = {
      kind: 'release' as const,
      eventId: 'terminal_event_1',
      payloadDigest: 'f'.repeat(64),
      tombstoneDigest: 'd'.repeat(64),
      terminalCandidateDigest: 'a'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      acknowledgedAt: later,
    };
    const applied = applyTestRunTerminalControl(finalizing, command, 'a'.repeat(64));
    expect(applied).toMatchObject({
      ok: true,
      disposition: 'applied',
      record: { lifecycle: 'completed', verdict: 'passed', terminalWinner: { kind: 'release' } },
    });
    if (!applied.ok) throw new Error('fixture terminal transition failed');
    expect(
      applyTestRunTerminalControl(
        applied.record,
        {
          kind: 'abandoned',
          eventId: 'later_opposite_event',
          payloadDigest: '1'.repeat(64),
          acknowledgedAt: later,
        },
        null
      )
    ).toMatchObject({
      ok: true,
      disposition: 'already_applied',
      record: { lifecycle: 'completed', verdict: 'passed', terminalWinner: { kind: 'release' } },
    });
  });

  it('finalizes a failed run after an evidence-backed scenario ends before its last dependent turn', () => {
    const passedScenarios = Array.from({ length: 19 }, (_, index) =>
      testRunScenario(index + 1, {
        lifecycle: 'completed',
        verdict: 'passed',
        completedTurns: 1,
        completedReplies: 1,
        deterministicVerdict: 'passed',
        semanticVerdict: 'passed',
        startedAt: later,
        finishedAt: later,
        durationMs: 1,
      })
    );
    const runningFinalScenario = testRunScenario(20, {
      scenarioRevision: 1,
      eventWatermark: 1,
      lifecycle: 'running',
      plannedTurns: 2,
      completedTurns: 1,
      expectedReplies: 2,
      completedReplies: 1,
      deterministicVerdict: 'passed',
      semanticVerdict: 'passed',
      startedAt: later,
      sessionId: 'matrix_session_20',
      sessionBindingDigest: '9'.repeat(64),
    });
    const current = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      scenarios: [...passedScenarios, runningFinalScenario],
      cost: { agentNanoUsd: 10, evaluatorNanoUsd: 5, totalNanoUsd: 15 },
    });
    const failedSummary = {
      ...runningFinalScenario,
      scenarioRevision: 2,
      eventWatermark: 2,
      lifecycle: 'completed' as const,
      verdict: 'failed' as const,
      deterministicVerdict: 'failed' as const,
      finishedAt: later,
      durationMs: 1,
    };
    const projected = applyTestRunProjectionCas(current, {
      expectedRevision: 2,
      nextLifecycle: 'running',
      updatedAt: later,
      scenario: {
        scenarioId: failedSummary.scenarioId,
        expectedScenarioRevision: 1,
        eventWatermark: 2,
        lifecycle: 'completed',
        verdict: 'failed',
        sessionId: 'matrix_session_20',
        sessionBindingDigest: '9'.repeat(64),
        summary: failedSummary,
        projection: {
          schemaVersion: 1,
          runId: 'run_1',
          userId: 'auth0:user_1',
          sessionId: 'matrix_session_20',
          sessionBindingDigest: '9'.repeat(64),
          scenarioId: failedSummary.scenarioId,
          scenarioNumber: 20,
          scenarioLabel: failedSummary.scenarioLabel,
          runRevision: 3,
          scenarioRevision: 2,
          eventWatermark: 2,
          lifecycle: 'completed',
          verdict: 'failed',
          plannedTurns: 2,
          completedTurns: 1,
          toolEvidence: [],
          deterministicChecks: [
            {
              code: 'confirmation_count',
              status: 'failed',
              turnIndex: 1,
              replyIndex: null,
              evidence: {
                ...emptyDeterministicEvidence(),
                expectedCount: 1,
                actualCount: 0,
              },
            },
          ],
          replyEvaluations: [
            {
              turnIndex: 0,
              replyIndex: 0,
              verdict: 'passed',
              score: 5,
              criteria: {
                understoodIntent: true,
                helpful: true,
                conciseAndClear: true,
                professionalTone: true,
                noPassiveAggression: true,
              },
              failureCodes: [],
              latencyMs: 1,
              usage: {
                logicalCalls: 1,
                repairCount: 0,
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                costNanoUsd: 1,
              },
            },
          ],
          agentUsage: [],
        },
      },
      finalization: null,
    });
    if (!projected.ok) throw new Error('partial failed scenario projection was rejected');
    const staged = applyArtifactDeliveryTransition(projected.record, {
      expectedRevision: 3,
      updatedAt: later,
      next: {
        status: 'staged',
        jsonCandidateDigest: '1'.repeat(64),
        markdownCandidateDigest: '2'.repeat(64),
      },
    });
    if (!staged.ok || staged.record.artifactStageDigest === null)
      throw new Error('artifact staging was rejected');
    const failedCandidate = {
      ...candidate,
      outcome: 'completed_failed' as const,
      artifactStageRevision: 4,
      artifactCandidateDigest: staged.record.artifactStageDigest,
    };
    expect(
      applyTestRunProjectionCas(staged.record, {
        expectedRevision: 4,
        nextLifecycle: 'finalizing',
        updatedAt: later,
        scenario: null,
        finalization: {
          tombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: staged.record.artifactStageDigest,
          terminalCandidate: failedCandidate,
        },
      })
    ).toMatchObject({
      ok: true,
      record: {
        lifecycle: 'finalizing',
        terminalCandidate: { outcome: 'completed_failed' },
      },
    });
  });

  it('maps failed and stopped signed outcomes to their terminal states', () => {
    const failedScenarios = Array.from({ length: 20 }, (_, index) =>
      testRunScenario(index + 1, {
        lifecycle: 'completed',
        verdict: 'failed',
        completedTurns: 1,
        completedReplies: 1,
        deterministicVerdict: 'failed',
        semanticVerdict: 'not_evaluated',
        startedAt: later,
        finishedAt: later,
        durationMs: 1,
      })
    );
    const failedCandidate = { ...candidate, outcome: 'completed_failed' as const };
    const cases = [
      {
        record: testRunRecord({
          lifecycle: 'finalizing',
          revision: 2,
          artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
          contextFinalizationTombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: 'e'.repeat(64),
          terminalCandidate: failedCandidate,
          scenarios: failedScenarios,
          cost: { agentNanoUsd: 10, evaluatorNanoUsd: 5, totalNanoUsd: 15 },
        }),
        lifecycle: 'completed',
        verdict: 'failed',
      },
      {
        record: testRunRecord({
          lifecycle: 'finalizing',
          revision: 2,
          artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
          contextFinalizationTombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: 'e'.repeat(64),
          terminalCandidate: candidate,
        }),
        lifecycle: 'stopped',
        verdict: 'not_evaluated',
      },
    ] as const;
    for (const entry of cases) {
      const result = applyTestRunTerminalControl(
        entry.record,
        {
          kind: 'release',
          eventId: 'terminal_event_1',
          payloadDigest: 'f'.repeat(64),
          tombstoneDigest: 'd'.repeat(64),
          terminalCandidateDigest: 'a'.repeat(64),
          artifactStageDigest: 'e'.repeat(64),
          acknowledgedAt: later,
        },
        'a'.repeat(64)
      );
      expect(result).toMatchObject({
        ok: true,
        record: { lifecycle: entry.lifecycle, verdict: entry.verdict },
      });
    }
  });

  it('rejects a completed pass candidate until all twenty scenarios and both costs are complete', () => {
    const running = testRunRecord({
      lifecycle: 'running',
      revision: 2,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      artifactStageDigest: candidate.artifactCandidateDigest,
    });

    expect(
      applyTestRunProjectionCas(running, {
        expectedRevision: 2,
        nextLifecycle: 'finalizing',
        updatedAt: later,
        scenario: null,
        finalization: {
          tombstoneDigest: 'd'.repeat(64),
          artifactStageDigest: candidate.artifactCandidateDigest,
          terminalCandidate: { ...candidate, outcome: 'completed_passed' },
        },
      })
    ).toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });
  });

  it('keeps artifact delivery monotonic and separate from the terminal agent outcome', () => {
    const staged = applyArtifactDeliveryTransition(
      testRunRecord({ lifecycle: 'running', revision: 1 }),
      {
        expectedRevision: 1,
        updatedAt: later,
        next: {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
      }
    );
    expect(staged).toMatchObject({
      ok: true,
      record: {
        revision: 2,
        lifecycle: 'running',
        verdict: 'pending',
        artifactDelivery: { status: 'staged', failureCode: null },
      },
    });
    if (!staged.ok || staged.record.artifactStageDigest === null)
      throw new Error('fixture staging transition failed');

    expect(
      applyArtifactDeliveryTransition(staged.record, {
        expectedRevision: 2,
        updatedAt: later,
        next: {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });

    const terminal = testRunRecord({
      lifecycle: 'completed',
      verdict: 'passed',
      revision: 4,
      finishedAt: later,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      artifactStageDigest: staged.record.artifactStageDigest,
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_event_1',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
    });
    const ready = applyArtifactDeliveryTransition(terminal, {
      expectedRevision: 4,
      updatedAt: later,
      next: { status: 'ready', terminalControlEventId: 'terminal_event_1' },
    });
    expect(ready).toMatchObject({
      ok: true,
      record: {
        lifecycle: 'completed',
        verdict: 'passed',
        artifactDelivery: { status: 'ready', failureCode: null },
      },
    });
  });

  it('restricts preterminal and post-terminal artifact failure codes', () => {
    expect(
      applyArtifactDeliveryTransition(testRunRecord({ lifecycle: 'running' }), {
        expectedRevision: 0,
        updatedAt: later,
        next: {
          status: 'failed',
          failureCode: 'REPORT_PUBLICATION_FAILED',
          terminalControlEventId: 'terminal_event_1',
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyArtifactDeliveryTransition(testRunRecord({ lifecycle: 'running' }), {
        expectedRevision: 0,
        updatedAt: later,
        next: { status: 'failed', failureCode: 'REPORT_VALIDATION_FAILED' },
      })
    ).toMatchObject({
      ok: true,
      record: { lifecycle: 'running', artifactDelivery: { status: 'failed' } },
    });

    const terminal = testRunRecord({
      lifecycle: 'completed',
      verdict: 'passed',
      revision: 4,
      finishedAt: later,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_event_1',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
    });
    expect(
      applyArtifactDeliveryTransition(terminal, {
        expectedRevision: 4,
        updatedAt: later,
        next: {
          status: 'failed',
          failureCode: 'REPORT_PUBLICATION_FAILED',
          terminalControlEventId: 'wrong_terminal_event',
        },
      })
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyArtifactDeliveryTransition(terminal, {
        expectedRevision: 4,
        updatedAt: later,
        next: {
          status: 'failed',
          failureCode: 'REPORT_PUBLICATION_FAILED',
          terminalControlEventId: 'terminal_event_1',
        },
      })
    ).toMatchObject({
      ok: true,
      record: {
        lifecycle: 'completed',
        verdict: 'passed',
        artifactDelivery: { status: 'failed', failureCode: 'REPORT_PUBLICATION_FAILED' },
      },
    });
  });

  it('fails closed for every invalid artifact transition gate and allows terminal timeout', () => {
    expect(
      applyArtifactDeliveryTransition(testRunRecord(), {
        expectedRevision: 1,
        updatedAt: later,
        next: {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
      })
    ).toEqual({ ok: false, code: 'REVISION_CONFLICT' });
    const terminal = testRunRecord({
      lifecycle: 'completed',
      verdict: 'passed',
      revision: 4,
      finishedAt: later,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      terminalWinner: {
        kind: 'release',
        eventId: 'terminal_event_1',
        payloadDigest: 'f'.repeat(64),
        outcome: 'completed_passed',
        acknowledgedAt: later,
      },
    });
    expect(
      applyArtifactDeliveryTransition(terminal, {
        expectedRevision: 4,
        updatedAt: later,
        next: { status: 'unknown', failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' },
      })
    ).toMatchObject({
      ok: true,
      record: { artifactDelivery: { status: 'unknown' }, revision: 5 },
    });
    for (const [record, next] of [
      [
        testRunRecord({ lifecycle: 'completed', verdict: 'passed', finishedAt: later, terminalWinner: terminal.terminalWinner }),
        {
          status: 'staged',
          jsonCandidateDigest: '1'.repeat(64),
          markdownCandidateDigest: '2'.repeat(64),
        },
      ],
      [testRunRecord({ artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later } }), { status: 'failed', failureCode: 'REPORT_VALIDATION_FAILED' }],
      [testRunRecord(), { status: 'ready', terminalControlEventId: 'terminal_event_1' }],
      [{ ...terminal, lifecycle: 'running', verdict: 'pending', finishedAt: null, terminalWinner: null }, { status: 'ready', terminalControlEventId: 'terminal_event_1' }],
      [testRunRecord(), { status: 'unknown', failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' }],
      [{ ...terminal, lifecycle: 'running', verdict: 'pending', finishedAt: null, terminalWinner: null }, { status: 'unknown', failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' }],
    ] as const)
      expect(
        applyArtifactDeliveryTransition(record as never, {
          expectedRevision: record.revision,
          updatedAt: later,
          next: next as never,
        })
      ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(
      applyArtifactDeliveryTransition(
        { ...terminal, finishedAt: null },
        {
          expectedRevision: terminal.revision,
          updatedAt: later,
          next: { status: 'unknown', failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT' },
        }
      )
    ).toEqual({ ok: false, code: 'INVALID_RECORD' });
  });

  it('checks every signed release correlation digest before terminalization', () => {
    const finalizing = testRunRecord({
      lifecycle: 'finalizing',
      revision: 2,
      artifactDelivery: { status: 'staged', failureCode: null, updatedAt: later },
      contextFinalizationTombstoneDigest: 'd'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      terminalCandidate: candidate,
    });
    const base = {
      kind: 'release' as const,
      eventId: 'terminal_event_1',
      payloadDigest: 'f'.repeat(64),
      tombstoneDigest: 'd'.repeat(64),
      terminalCandidateDigest: 'a'.repeat(64),
      artifactStageDigest: 'e'.repeat(64),
      acknowledgedAt: later,
    };
    for (const [record, command, digest] of [
      [{ ...finalizing, lifecycle: 'running' }, base, 'a'.repeat(64)],
      [finalizing, base, null],
      [finalizing, { ...base, tombstoneDigest: '0'.repeat(64) }, 'a'.repeat(64)],
      [finalizing, { ...base, terminalCandidateDigest: '0'.repeat(64) }, 'a'.repeat(64)],
      [finalizing, { ...base, artifactStageDigest: '0'.repeat(64) }, 'a'.repeat(64)],
    ] as const)
      expect(
        applyTestRunTerminalControl(record as never, command, digest)
      ).toEqual({ ok: false, code: 'FINALIZATION_MISMATCH' });
    expect(
      applyTestRunTerminalControl(
        { ...finalizing, terminalCandidate: null },
        base,
        'a'.repeat(64)
      )
    ).toEqual({ ok: false, code: 'INVALID_RECORD' });
  });

  it.each([
    ['pending', 'failed', 'REPORT_STAGING_INTERRUPTED'],
    ['staged', 'unknown', 'REPORT_DELIVERY_STATUS_TIMEOUT'],
  ] as const)(
    'abandoned recovery maps %s artifact delivery to %s',
    (sourceStatus, expectedStatus, expectedCode) => {
      const current = testRunRecord({
        lifecycle: 'running',
        artifactDelivery:
          sourceStatus === 'pending'
            ? { status: 'pending', failureCode: null, updatedAt: later }
            : { status: 'staged', failureCode: null, updatedAt: later },
      });
      const result = applyTestRunTerminalControl(
        current,
        {
          kind: 'abandoned',
          eventId: 'abandoned_event_1',
          payloadDigest: 'f'.repeat(64),
          acknowledgedAt: later,
        },
        null
      );
      expect(result).toMatchObject({
        ok: true,
        record: {
          lifecycle: 'stopped',
          verdict: 'not_evaluated',
          artifactDelivery: { status: expectedStatus, failureCode: expectedCode },
        },
      });
    }
  );

  it('rejects abandoned terminalization from preflight provisioning state', () => {
    expect(
      applyTestRunTerminalControl(
        testRunRecord(),
        {
          kind: 'abandoned',
          eventId: 'abandoned_event_1',
          payloadDigest: 'f'.repeat(64),
          acknowledgedAt: later,
        },
        null
      )
    ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('preserves an already failed artifact state during abandonment', () => {
    const result = applyTestRunTerminalControl(
      testRunRecord({
        lifecycle: 'running',
        artifactDelivery: {
          status: 'failed',
          failureCode: 'REPORT_STAGING_FAILED',
          updatedAt: later,
        },
      }),
      {
        kind: 'abandoned',
        eventId: 'abandoned_event_1',
        payloadDigest: 'f'.repeat(64),
        acknowledgedAt: later,
      },
      null
    );
    expect(result).toMatchObject({
      ok: true,
      record: {
        artifactDelivery: { status: 'failed', failureCode: 'REPORT_STAGING_FAILED' },
      },
    });
  });

  it('preserves completed scenarios and stops only the active scenario during abandonment', () => {
    const result = applyTestRunTerminalControl(
      testRunRecord({
        lifecycle: 'running',
        scenarios: Array.from({ length: 20 }, (_, index) => {
          if (index === 0) return testRunScenario(1, {
            scenarioRevision: 3,
            eventWatermark: 2,
            lifecycle: 'completed',
            verdict: 'passed',
            completedTurns: 1,
            completedReplies: 1,
            deterministicVerdict: 'passed',
            semanticVerdict: 'passed',
            startedAt: later,
            finishedAt: later,
            durationMs: 1,
            sessionId: 'session_001',
            sessionBindingDigest: '8'.repeat(64),
          });
          if (index === 1) return testRunScenario(2, {
            scenarioRevision: 1,
            eventWatermark: 1,
            lifecycle: 'running',
            verdict: 'pending',
            sessionId: 'session_002',
            sessionBindingDigest: '9'.repeat(64),
          });
          return testRunScenario(index + 1);
        }),
      }),
      {
        kind: 'abandoned',
        eventId: 'abandoned_event_1',
        payloadDigest: 'f'.repeat(64),
        acknowledgedAt: later,
      },
      null
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('fixture abandonment failed');
    expect(result.record.scenarios.slice(0, 3)).toMatchObject([
          { lifecycle: 'completed', verdict: 'passed', scenarioRevision: 3 },
          {
            lifecycle: 'stopped',
            verdict: 'not_evaluated',
            deterministicVerdict: 'not_evaluated',
            semanticVerdict: 'not_evaluated',
            scenarioRevision: 2,
          },
          {
            lifecycle: 'not_run',
            verdict: 'not_evaluated',
            deterministicVerdict: 'not_evaluated',
            semanticVerdict: 'not_evaluated',
            scenarioRevision: 1,
          },
    ]);
  });
});

function projectionScenarioCommand(input: Readonly<{
  expectedScenarioRevision: number;
  nextScenarioRevision: number;
  eventWatermark: number;
  runRevision: number;
}>): NonNullable<TestRunProjectionCasCommandV1['scenario']> {
  const summary = testRunScenario(1, {
    scenarioRevision: input.nextScenarioRevision,
    lifecycle: 'running',
    sessionId: null,
    sessionBindingDigest: null,
  });
  const publicSummary = {
    scenarioId: summary.scenarioId,
    scenarioNumber: summary.scenarioNumber,
    scenarioLabel: summary.scenarioLabel,
    scenarioRevision: summary.scenarioRevision,
    lifecycle: summary.lifecycle,
    verdict: summary.verdict,
    plannedTurns: summary.plannedTurns,
    completedTurns: summary.completedTurns,
    expectedReplies: summary.expectedReplies,
    completedReplies: summary.completedReplies,
    selectedTools: summary.selectedTools,
    deterministicVerdict: summary.deterministicVerdict,
    semanticVerdict: summary.semanticVerdict,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    durationMs: summary.durationMs,
  };
  return {
    scenarioId: 'scenario_001',
    expectedScenarioRevision: input.expectedScenarioRevision,
    eventWatermark: input.eventWatermark,
    lifecycle: 'running' as const,
    verdict: 'pending' as const,
    sessionId: 'matrix_session_1',
    sessionBindingDigest: '9'.repeat(64),
    summary: publicSummary,
    projection: {
      schemaVersion: 1 as const,
      runId: 'run_1',
      userId: 'auth0:user_1',
      sessionId: 'matrix_session_1',
      sessionBindingDigest: '9'.repeat(64),
      scenarioId: 'scenario_001',
      scenarioNumber: 1,
      scenarioLabel: 'Scenario 001/020',
      runRevision: input.runRevision,
      scenarioRevision: input.nextScenarioRevision,
      eventWatermark: input.eventWatermark,
      lifecycle: 'running' as const,
      verdict: 'pending' as const,
      plannedTurns: 1,
      completedTurns: 0,
      toolEvidence: [],
      deterministicChecks: [],
      replyEvaluations: [],
      agentUsage: [],
    },
  };
}
