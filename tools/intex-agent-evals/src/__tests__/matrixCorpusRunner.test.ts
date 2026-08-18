import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { ReplyEvaluationInput } from '../deterministicEvaluator.js';
import { loadCanonicalMatrixCorpus } from '../matrixCorpus/catalog.js';
import {
  MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA,
  MATRIX_CORPUS_JUDGE_CALLS_PER_LEASE_RENEWAL,
  runMatrixCorpus,
  type MatrixCorpusRunPorts,
  type MatrixCorpusTurnExecutionResult,
  type MatrixCorpusTurnObservation,
} from '../matrixCorpus/runMatrixCorpus.js';
import {
  digestMatrixReply,
  MATRIX_CORPUS_MAX_REPLIES_PER_TURN,
} from '../matrixCorpus/correlation.js';
import type { IntexEvalScenario } from '../scenarioSchema.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('sequential Matrix corpus state machine', () => {
  it('runs all 20 scenarios and 59 turns with concurrency one before terminal release', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    let activeTurns = 0;
    let maxActiveTurns = 0;
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      activeTurns += 1;
      maxActiveTurns = Math.max(maxActiveTurns, activeTurns);
      trace.push(`turn:${input.scenario.id}:${String(input.turnIndex)}`);
      activeTurns -= 1;
      return { ok: true, observation: observation(input.scenario, input.turnIndex) };
    });

    const result = await runMatrixCorpus({ runId: 'run_1', catalog }, ports);

    expect(result.exitCode).toBe(0);
    expect(result.scenarios).toHaveLength(20);
    expect(result.scenarios.every(({ status }) => status === 'passed')).toBe(true);
    expect(result.totals.completedTurns).toBe(59);
    expect(maxActiveTurns).toBe(1);
    expect(ports.projectScenario).toHaveBeenCalledTimes(79);
    expect(
      vi
        .mocked(ports.projectScenario)
        .mock.calls.map(([call]) => call)
        .filter(({ scenarioId }) => scenarioId === 'intex-eval-001')
        .map(({ lifecycle, verdict }) => ({ lifecycle, verdict }))
    ).toEqual([
      { lifecycle: 'running', verdict: 'pending' },
      { lifecycle: 'running', verdict: 'pending' },
      { lifecycle: 'completed', verdict: 'passed' },
    ]);
    expect(trace.filter((item) => item.startsWith('renew:'))).toEqual(
      catalog.scenarios.flatMap(({ scenario }) =>
        scenario.turns.flatMap((_turn, turnIndex) => [
          `renew:turn:${scenario.id}:${String(turnIndex)}`,
          ...(scenario.expected.turns[turnIndex]?.replies ?? []).map(
            (_reply, replyIndex) =>
              `renew:judge:${scenario.id}:${String(turnIndex)}:${String(replyIndex)}`
          ),
        ])
      )
    );
    expect(trace.indexOf('retention')).toBeLessThan(trace.indexOf('activate'));
    expect(trace.indexOf('activate')).toBeLessThan(trace.indexOf('project-running'));
    expect(trace.indexOf('project-running')).toBeLessThan(trace.indexOf('turn:intex-eval-001:0'));
    expect(trace.slice(-7)).toEqual([
      'quiesce',
      'drain',
      'stage',
      'finalize',
      'project-finalizing',
      'release',
      'terminal-ack',
    ]);
    expect(result.terminalAcknowledged).toBe(true);
    expect(result.cleanupCompleted).toBe(true);
  });

  it('records a behavioral failure but still runs every remaining turn and scenario', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => ({
      ok: true,
      observation: {
        ...observation(input.scenario, input.turnIndex),
        deterministicPassed: !(input.scenario.id === 'intex-eval-003' && input.turnIndex === 1),
      },
    }));

    const result = await runMatrixCorpus({ runId: 'run_1', catalog }, ports);

    expect(result.exitCode).toBe(1);
    expect(result.scenarios[2]?.status).toBe('failed');
    expect(result.scenarios[2]?.completedTurns).toBe(3);
    expect(result.scenarios[19]?.status).toBe('passed');
    expect(
      vi
        .mocked(ports.executeTurn)
        .mock.calls.map(([input]) => input)
        .filter(({ scenario }) => scenario.id === 'intex-eval-003')
        .map(({ turnIndex }) => turnIndex)
    ).toEqual([0, 1, 2]);
    expect(result.totals.completedTurns).toBe(59);
  });

  it('ends only the current scenario when a dependent turn cannot run after behavioral failure', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      if (input.scenario.id === 'intex-eval-003' && input.turnIndex === 1) {
        return {
          ok: false,
          kind: 'scenario_behavioral_failure',
          code: 'required_confirmation_missing',
          boundSessionId: 'session_intex-eval-003',
        } as unknown as MatrixCorpusTurnExecutionResult;
      }
      return { ok: true, observation: observation(input.scenario, input.turnIndex) };
    });

    const result = await runMatrixCorpus({ runId: 'run_1', catalog }, ports);

    expect(result.exitCode).toBe(1);
    expect(result.failureCodes).toContain('required_confirmation_missing');
    expect(result.scenarios[2]).toMatchObject({ status: 'failed', completedTurns: 1 });
    expect(result.scenarios[3]?.status).toBe('passed');
    expect(result.scenarios[19]?.status).toBe('passed');
    expect(
      vi
        .mocked(ports.executeTurn)
        .mock.calls.map(([input]) => input)
        .filter(({ scenario }) => scenario.id === 'intex-eval-003')
        .map(({ turnIndex }) => turnIndex)
    ).toEqual([0, 1]);
    expect(result.totals.completedTurns).toBe(57);
    expect(ports.reconcileStoppedScenario).not.toHaveBeenCalled();
  });

  it('stops immediately on safety failure, marks later scenarios not run, and still terminalizes', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) =>
      input.scenario.id === 'intex-eval-003'
        ? {
            ok: false,
            kind: 'safety_failure',
            code: 'wrong_puppet',
            boundSessionId: `session_${input.scenario.id}`,
          }
        : { ok: true, observation: observation(input.scenario, input.turnIndex) }
    );

    const result = await runMatrixCorpus({ runId: 'run_1', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('wrong_puppet');
    expect(result.scenarios[2]?.status).toBe('stopped');
    expect(result.scenarios[3]?.status).toBe('not_run');
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('does not invent a scenario projection when infrastructure fails before session binding', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockResolvedValue({
      ok: false,
      kind: 'infrastructure_failure',
      code: 'scenario_binding_timeout',
    });

    const result = await runMatrixCorpus({ runId: 'run_unbound', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('scenario_binding_timeout');
    expect(result.scenarios[0]).toMatchObject({ status: 'not_run', completedTurns: 0 });
    expect(ports.projectScenario).not.toHaveBeenCalled();
    expect(ports.reconcileStoppedScenario).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'intex-eval-001', observedSessionId: null })
    );
    expect(trace).toContain('stage');
    expect(result.terminalAcknowledged).toBe(true);
    expect(result.cleanupCompleted).toBe(true);
  });

  it('projects a persisted session binding as stopped when correlation fails before observation', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockResolvedValue({
      ok: false,
      kind: 'infrastructure_failure',
      code: 'reply_timeout',
      boundSessionId: 'session_intex-eval-001',
    });

    const result = await runMatrixCorpus({ runId: 'run_bound_failure', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.scenarios[0]).toMatchObject({ status: 'stopped', completedTurns: 0 });
    expect(ports.reconcileStoppedScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: 'intex-eval-001',
        observedSessionId: 'session_intex-eval-001',
      })
    );
    expect(ports.projectScenario).not.toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'intex-eval-001', lifecycle: 'stopped' })
    );
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('reconciles a late session binding only after the stopped turn is drained', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.executeTurn).mockResolvedValue({
      ok: false,
      kind: 'infrastructure_failure',
      code: 'scenario_binding_timeout',
    });
    vi.mocked(ports.reconcileStoppedScenario).mockImplementation(async (input) => {
      trace.push('reconcile-stopped');
      return {
        ok: true,
        revision: input.expectedRevision + 1,
        disposition: 'projected',
        additionalAgentCostNanoUsd: 0,
      };
    });

    const result = await runMatrixCorpus({ runId: 'run_late_binding', catalog }, ports);

    expect(result.scenarios[0]?.status).toBe('stopped');
    expect(trace.indexOf('drain')).toBeLessThan(trace.indexOf('reconcile-stopped'));
    expect(trace.indexOf('reconcile-stopped')).toBeLessThan(trace.indexOf('stage'));
    expect(ports.reconcileStoppedScenario).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'intex-eval-001', observedSessionId: null })
    );
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('refetches once after a projection CAS conflict and never releases before staging/finalization', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const trace: string[] = [];
    const ports = passingPorts(trace);
    vi.mocked(ports.projectScenario)
      .mockResolvedValueOnce({ ok: false, kind: 'revision_conflict', code: 'revision_conflict' })
      .mockImplementation(async (input) => ({ ok: true, revision: input.expectedRevision + 1 }));

    const result = await runMatrixCorpus({ runId: 'run_1', catalog }, ports);

    expect(result.exitCode).toBe(0);
    expect(ports.getProjectionRevision).toHaveBeenCalledTimes(1);
    expect(trace.indexOf('stage')).toBeLessThan(trace.indexOf('finalize'));
    expect(trace.indexOf('finalize')).toBeLessThan(trace.indexOf('release'));
  });

  it('fails closed when first-turn creation or strict evidence reconciliation is missing', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const firstPorts = passingPorts([]);
    vi.mocked(firstPorts.executeTurn).mockImplementation(async (input) => ({
      ok: true,
      observation: {
        ...observation(input.scenario, input.turnIndex),
        sessionEvidence: {
          kind: 'continued',
          scenarioLabel: input.scenario.title,
        },
      },
    }));

    const reused = await runMatrixCorpus({ runId: 'run_reused', catalog }, firstPorts);
    expect(reused.exitCode).toBe(2);
    expect(reused.failureCodes).toContain('turn_evidence_mismatch');

    const mockPorts = passingPorts([]);
    vi.mocked(mockPorts.executeTurn).mockImplementation(async (input) => ({
      ok: true,
      observation: {
        ...observation(input.scenario, input.turnIndex),
        toolEvidence: {
          ...observation(input.scenario, input.turnIndex).toolEvidence,
          strictMockBoundary: false,
        },
      },
    }));

    const unsafeMock = await runMatrixCorpus({ runId: 'run_mock', catalog }, mockPorts);
    expect(unsafeMock.exitCode).toBe(2);
    expect(unsafeMock.failureCodes).toContain('turn_evidence_mismatch');
  });

  it('rejects reply evidence from another turn before invoking MiniMax', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      return {
        ok: true,
        observation: {
          ...valid,
          replyEvaluations: valid.replyEvaluations.map((reply) => ({
            ...reply,
            scenarioId: 'intex-eval-020',
          })),
        },
      };
    });

    const result = await runMatrixCorpus({ runId: 'run_cross_turn', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('turn_evidence_mismatch');
    expect(ports.judgeReply).not.toHaveBeenCalled();
  });

  it('accepts zero agent calls for explicit session-only context retention turns', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      if (input.scenario.id !== 'intex-eval-020' || input.turnIndex !== 0) {
        return { ok: true, observation: valid };
      }
      return {
        ok: true,
        observation: {
          ...valid,
          agentUsage: {
            logicalCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costNanoUsd: 0,
            providerCostReconciled: true,
          },
        },
      };
    });

    const result = await runMatrixCorpus(
      { runId: 'run_retain_only_zero_agent_calls', catalog },
      ports
    );

    expect(result.exitCode).toBe(0);
    expect(result.failureCodes).not.toContain('turn_evidence_mismatch');
    expect(result.scenarios[19]).toMatchObject({
      scenarioId: 'intex-eval-020',
      status: 'passed',
      completedTurns: 20,
    });
  });

  it('requires an agent call when a supplied start completes calendar clarification', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      if (input.scenario.id !== 'intex-eval-003' || input.turnIndex !== 1) {
        return { ok: true, observation: valid };
      }
      return {
        ok: true,
        observation: {
          ...valid,
          agentUsage: {
            logicalCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costNanoUsd: 0,
            providerCostReconciled: true,
          },
        },
      };
    });

    const result = await runMatrixCorpus(
      { runId: 'run_calendar_start_clarification_zero_agent_calls', catalog },
      ports
    );

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('TURN_AGENT_CALL_COUNT_MISMATCH');
    expect(result.scenarios[2]).toMatchObject({
      scenarioId: 'intex-eval-003',
      status: 'stopped',
      completedTurns: 1,
    });
  });

  it('rejects zero agent calls for a mixed calculation and retention turn', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const mixedEntry = catalog.scenarios[19];
    expect(mixedEntry?.scenario.id).toBe('intex-eval-020');
    if (mixedEntry === undefined) return;

    const turns = [...mixedEntry.scenario.turns];
    turns[0] = {
      kind: 'message',
      text: "Calculate 2+2, but don't save it; only keep this context.",
      sourceType: 'whatsapp_text',
    };
    const scenarios = [...catalog.scenarios];
    scenarios[19] = {
      ...mixedEntry,
      scenario: { ...mixedEntry.scenario, turns },
    };
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      if (input.scenario.id !== 'intex-eval-020' || input.turnIndex !== 0) {
        return { ok: true, observation: valid };
      }
      return {
        ok: true,
        observation: {
          ...valid,
          agentUsage: {
            logicalCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costNanoUsd: 0,
            providerCostReconciled: true,
          },
        },
      };
    });

    const result = await runMatrixCorpus(
      {
        runId: 'run_mixed_retention_zero_agent_calls',
        catalog: { ...catalog, scenarios },
      },
      ports
    );

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('TURN_AGENT_CALL_COUNT_MISMATCH');
    expect(result.scenarios[19]).toMatchObject({
      scenarioId: 'intex-eval-020',
      status: 'stopped',
    });
  });

  it('judges correlated replies even when the execution port reports a behavioral failure', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const result = {
        ok: false,
        kind: 'behavioral_failure',
        code: 'deterministic_failure',
        observation: observation(input.scenario, input.turnIndex),
      } as const;
      return result as unknown as MatrixCorpusTurnExecutionResult;
    });

    const result = await runMatrixCorpus({ runId: 'run_behavioral', catalog }, ports);

    expect(result.exitCode).toBe(1);
    expect(ports.judgeReply).toHaveBeenCalledTimes(59);
    expect(result.totals.completedTurns).toBe(59);
    expect(result.scenarios.every(({ status }) => status === 'failed')).toBe(true);
  });

  it('judges a bounded extra correlated reply and classifies it as behavioral', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      if (input.scenario.id !== 'intex-eval-001' || input.turnIndex !== 0) {
        return { ok: true, observation: valid };
      }
      const extraText = 'Unexpected but fully correlated extra reply';
      const extraReply = replyInput(
        input.scenario.id,
        input.turnIndex,
        valid.replyEvaluations.length,
        MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA
      );
      extraReply.assistantText = extraText;
      return {
        ok: true,
        observation: {
          ...valid,
          observedReplyCount: valid.observedReplyCount + 1,
          replyEvaluations: [...valid.replyEvaluations, extraReply],
          transportEvidence: {
            ...valid.transportEvidence,
            replyDigests: [
              ...valid.transportEvidence.replyDigests,
              digestMatrixReply(extraText, valid.replyEvaluations.length),
            ],
          },
        },
      };
    });

    const result = await runMatrixCorpus({ runId: 'run_extra_reply', catalog }, ports);

    expect(result.exitCode).toBe(1);
    expect(result.scenarios[0]?.status).toBe('failed');
    expect(ports.judgeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: expect.objectContaining({
          semanticCriteria: MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA,
        }),
      })
    );
    expect(result.scenarios[19]?.status).toBe('passed');
  });

  it('binds every judge call to MiniMax M3 and retries one terminal CAS conflict', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.projectFinalizing)
      .mockResolvedValueOnce({
        ok: false,
        kind: 'revision_conflict',
        code: 'revision_conflict',
      })
      .mockImplementation(async (input) => ({ ok: true, revision: input.expectedRevision + 1 }));

    const result = await runMatrixCorpus({ runId: 'run_terminal_cas', catalog }, ports);

    expect(result.exitCode).toBe(0);
    expect(ports.getProjectionRevision).toHaveBeenCalledTimes(1);
    expect(ports.judgeReply).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'or:minimax/minimax-m3',
        reply: expect.objectContaining({ scenarioId: 'intex-eval-001' }),
      })
    );
  });

  it('cleans a failed pre-activation run without quiescing or releasing it', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.activateRun).mockResolvedValue({ ok: false, code: 'activation_failed' });

    const result = await runMatrixCorpus({ runId: 'run_activation', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('activation_failed');
    expect(ports.cleanup).toHaveBeenCalledOnce();
    expect(ports.quiesceRun).not.toHaveBeenCalled();
    expect(ports.releaseRun).not.toHaveBeenCalled();
  });

  it.each(['register', 'projection'] as const)(
    'cleans a %s failure before activation',
    async (phase) => {
      const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
      const ports = passingPorts([]);
      if (phase === 'register') {
        vi.mocked(ports.registerContext).mockResolvedValue({
          ok: false,
          code: 'context_registration_failed',
        });
      } else {
        vi.mocked(ports.createProjection).mockResolvedValue({
          ok: false,
          code: 'projection_creation_failed',
        });
      }

      const result = await runMatrixCorpus({ runId: `run_${phase}`, catalog }, ports);

      expect(result.exitCode).toBe(2);
      expect(ports.cleanup).toHaveBeenCalledOnce();
      expect(ports.activateRun).not.toHaveBeenCalled();
      expect(ports.releaseRun).not.toHaveBeenCalled();
    }
  );

  it('stops on lease-renewal failure before executing the turn', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.renewLease).mockResolvedValue({ ok: false, code: 'lease_renewal_failed' });

    const result = await runMatrixCorpus({ runId: 'run_lease', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('lease_renewal_failed');
    expect(ports.executeTurn).not.toHaveBeenCalled();
    expect(result.scenarios[0]?.status).toBe('not_run');
    expect(ports.projectScenario).not.toHaveBeenCalled();
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('renews the lease before each judge batch and stops if that renewal fails', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.renewLease).mockImplementation(async (input) =>
      input.stage === 'judge'
        ? { ok: false, code: 'lease_renewal_failed' }
        : { ok: true, value: undefined }
    );

    const result = await runMatrixCorpus({ runId: 'run_judge_lease', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('lease_renewal_failed');
    expect(ports.executeTurn).toHaveBeenCalledOnce();
    expect(ports.judgeReply).not.toHaveBeenCalled();
    expect(result.scenarios[0]?.status).toBe('stopped');
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('batches the maximum reply count under the bounded lease-renewal receipt cap', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    const firstScenario = catalog.scenarios[0]?.scenario;
    if (firstScenario === undefined) throw new Error('missing first scenario');
    const base = observation(firstScenario, 0);
    const expectedReply = base.replyEvaluations[0];
    if (expectedReply === undefined) throw new Error('missing expected first reply');
    const replies = [
      expectedReply,
      ...Array.from({ length: MATRIX_CORPUS_MAX_REPLIES_PER_TURN - 1 }, (_value, offset) => {
        const replyIndex = offset + 1;
        const reply = replyInput(
          firstScenario.id,
          0,
          replyIndex,
          MATRIX_CORPUS_EXTRA_REPLY_SEMANTIC_CRITERIA
        );
        reply.assistantText = `Synthetic extra reply ${String(replyIndex)}`;
        return reply;
      }),
    ];
    vi.mocked(ports.executeTurn).mockResolvedValueOnce({
      ok: false,
      kind: 'behavioral_failure',
      code: 'deterministic_evidence_failed',
      observation: {
        ...base,
        observedReplyCount: replies.length,
        replyEvaluations: replies,
        deterministicPassed: false,
        transportEvidence: {
          turnTerminal: 'completed',
          replyDigests: replies.map((reply, replyIndex) =>
            digestMatrixReply(reply.assistantText, replyIndex)
          ),
        },
      },
    });

    await runMatrixCorpus({ runId: 'run_batched_judges', catalog }, ports);

    const firstTurnJudgeRenewals = vi
      .mocked(ports.renewLease)
      .mock.calls.map(([input]) => input)
      .filter(
        (input) =>
          input.stage === 'judge' && input.scenarioId === firstScenario.id && input.turnIndex === 0
      );
    expect(firstTurnJudgeRenewals).toEqual([
      expect.objectContaining({ replyIndex: 0 }),
      expect.objectContaining({ replyIndex: 3 }),
    ]);

    const turnCount = catalog.scenarios.reduce(
      (total, entry) => total + entry.scenario.turns.length,
      0
    );
    const maximumRenewalReceipts =
      turnCount *
      (2 +
        Math.ceil(
          MATRIX_CORPUS_MAX_REPLIES_PER_TURN / MATRIX_CORPUS_JUDGE_CALLS_PER_LEASE_RENEWAL
        ));
    expect(maximumRenewalReceipts).toBe(236);
    expect(maximumRenewalReceipts).toBeLessThan(400);
  });

  it.each([
    ['ambiguous outbound send', 'safety_failure', 'ambiguous_outbound_send'],
    ['Matrix infrastructure failure', 'infrastructure_failure', 'matrix_sync_failed'],
  ] as const)('stops immediately on %s', async (_label, kind, code) => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockResolvedValue({ ok: false, kind, code });

    const result = await runMatrixCorpus({ runId: `run_${code}`, catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain(code);
    expect(ports.executeTurn).toHaveBeenCalledOnce();
    expect(ports.judgeReply).not.toHaveBeenCalled();
    expect(result.terminalAcknowledged).toBe(true);
  });

  it('rejects a changed continuation session and invalid judge usage evidence', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const sessionPorts = passingPorts([]);
    vi.mocked(sessionPorts.executeTurn).mockImplementation(async (input) => ({
      ok: true,
      observation: {
        ...observation(input.scenario, input.turnIndex),
        sessionId:
          input.scenario.id === 'intex-eval-001' && input.turnIndex === 1
            ? 'session_reused_elsewhere'
            : `session_${input.scenario.id}`,
      },
    }));

    const sessionResult = await runMatrixCorpus(
      { runId: 'run_session_drift', catalog },
      sessionPorts
    );
    expect(sessionResult.exitCode).toBe(2);
    expect(sessionResult.failureCodes).toContain('turn_evidence_mismatch');

    const judgePorts = passingPorts([]);
    vi.mocked(judgePorts.judgeReply).mockResolvedValue({
      ok: true,
      pass: true,
      model: 'or:minimax/minimax-m3',
      usage: {
        logicalCalls: 4,
        repairCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    });
    const judgeResult = await runMatrixCorpus({ runId: 'run_judge_drift', catalog }, judgePorts);
    expect(judgeResult.exitCode).toBe(2);
    expect(judgeResult.failureCodes).toContain('judge_evidence_mismatch');

    const modelPorts = passingPorts([]);
    vi.mocked(modelPorts.judgeReply).mockResolvedValue({
      ok: true,
      pass: true,
      model: 'or:google/gemini-2.5-flash',
      usage: {
        logicalCalls: 1,
        repairCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        costNanoUsd: 1,
      },
    });
    const modelResult = await runMatrixCorpus(
      { runId: 'run_judge_model_drift', catalog },
      modelPorts
    );
    expect(modelResult.exitCode).toBe(2);
    expect(modelResult.failureCodes).toContain('judge_evidence_mismatch');
  });

  it('accepts one MiniMax repair attempt as valid judge evidence', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.judgeReply).mockResolvedValue({
      ok: true,
      pass: true,
      model: 'or:minimax/minimax-m3',
      usage: {
        logicalCalls: 2,
        repairCount: 1,
        inputTokens: 2,
        outputTokens: 2,
        totalTokens: 4,
        costNanoUsd: 2,
      },
    });

    const result = await runMatrixCorpus({ runId: 'run_repaired_judge', catalog }, ports);

    expect(result.exitCode).toBe(0);
    expect(result.failureCodes).not.toContain('judge_evidence_mismatch');
    expect(result.scenarios.every(({ status }) => status === 'passed')).toBe(true);
  });

  it.each([
    ['two-vote negative quorum', false, 2, 0, 1],
    ['three-vote positive tie breaker', true, 3, 0, 0],
    ['two-vote negative quorum with one repaired response', false, 3, 1, 1],
    ['three-vote positive tie breaker with three repaired responses', true, 6, 3, 0],
  ] as const)(
    'accepts MiniMax %s as valid judge evidence',
    async (_label, pass, logicalCalls, repairCount, expectedExitCode) => {
      const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
      const ports = passingPorts([]);
      vi.mocked(ports.judgeReply).mockResolvedValue({
        ok: true,
        pass,
        model: 'or:minimax/minimax-m3',
        usage: {
          logicalCalls,
          repairCount,
          inputTokens: logicalCalls,
          outputTokens: logicalCalls,
          totalTokens: logicalCalls * 2,
          costNanoUsd: logicalCalls,
        },
      });

      const result = await runMatrixCorpus(
        {
          runId: `run_judge_quorum_${String(logicalCalls)}_${String(repairCount)}`,
          catalog,
        },
        ports
      );

      expect(result.exitCode).toBe(expectedExitCode);
      expect(result.failureCodes).not.toContain('judge_evidence_mismatch');
      expect(result.scenarios.every(({ status }) => status === (pass ? 'passed' : 'failed'))).toBe(
        true
      );
    }
  );

  it.each([
    ['a passing verdict after two decision votes', true, 2, 0],
    ['four decision votes', true, 4, 0],
    ['more repairs than decision votes', true, 3, 2],
    ['zero decision votes', true, 0, 0],
  ] as const)(
    'rejects MiniMax evidence with %s',
    async (_label, pass, logicalCalls, repairCount) => {
      const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
      const ports = passingPorts([]);
      vi.mocked(ports.judgeReply).mockResolvedValue({
        ok: true,
        pass,
        model: 'or:minimax/minimax-m3',
        usage: {
          logicalCalls,
          repairCount,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          costNanoUsd: 1,
        },
      });

      const result = await runMatrixCorpus(
        {
          runId: `run_invalid_judge_evidence_${String(logicalCalls)}_${String(repairCount)}`,
          catalog,
        },
        ports
      );

      expect(result.exitCode).toBe(2);
      expect(result.failureCodes).toContain('judge_evidence_mismatch');
    }
  );

  it('rejects reuse of one created session across two scenarios before judging the second', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      return {
        ok: true,
        observation: {
          ...valid,
          sessionId:
            input.scenario.id === 'intex-eval-002' ? 'session_intex-eval-001' : valid.sessionId,
        },
      };
    });

    const result = await runMatrixCorpus({ runId: 'run_cross_scenario_session', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('duplicate_scenario_session');
    expect(result.scenarios[0]?.status).toBe('passed');
    expect(result.scenarios[1]?.status).toBe('stopped');
    expect(vi.mocked(ports.judgeReply).mock.calls).not.toContainEqual([
      expect.objectContaining({
        reply: expect.objectContaining({ scenarioId: 'intex-eval-002' }),
      }),
    ]);
  });

  it('gives infrastructure and cleanup failures precedence over earlier behavioral failures', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.executeTurn).mockImplementation(async (input) => {
      if (input.scenario.id === 'intex-eval-002') {
        return {
          ok: false,
          kind: 'infrastructure_failure',
          code: 'matrix_sync_failed',
          boundSessionId: `session_${input.scenario.id}`,
        };
      }
      return {
        ok: true,
        observation: {
          ...observation(input.scenario, input.turnIndex),
          deterministicPassed: input.scenario.id !== 'intex-eval-001',
        },
      };
    });

    const result = await runMatrixCorpus({ runId: 'run_precedence', catalog }, ports);
    expect(result.exitCode).toBe(2);
    expect(result.scenarios[0]?.status).toBe('failed');
    expect(result.scenarios[1]?.status).toBe('stopped');

    const cleanupPorts = passingPorts([]);
    vi.mocked(cleanupPorts.cleanup).mockResolvedValue({ ok: false, code: 'cleanup_failed' });
    const cleanupResult = await runMatrixCorpus({ runId: 'run_cleanup', catalog }, cleanupPorts);
    expect(cleanupResult.exitCode).toBe(2);
    expect(cleanupResult.terminalAcknowledged).toBe(true);
    expect(cleanupResult.cleanupCompleted).toBe(false);
  });

  it.each(['quiesce', 'drain', 'stage', 'finalize'] as const)(
    'does not release when the %s terminal barrier fails',
    async (phase) => {
      const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
      const ports = passingPorts([]);
      if (phase === 'quiesce')
        vi.mocked(ports.quiesceRun).mockResolvedValue({ ok: false, code: 'quiesce_failed' });
      if (phase === 'drain')
        vi.mocked(ports.waitForDrain).mockResolvedValue({ ok: false, code: 'drain_failed' });
      if (phase === 'stage')
        vi.mocked(ports.stageArtifacts).mockResolvedValue({ ok: false, code: 'stage_failed' });
      if (phase === 'finalize')
        vi.mocked(ports.finalizeContext).mockResolvedValue({
          ok: false,
          code: 'finalize_failed',
        });

      const result = await runMatrixCorpus({ runId: `run_${phase}_barrier`, catalog }, ports);

      expect(result.exitCode).toBe(2);
      expect(ports.releaseRun).not.toHaveBeenCalled();
      expect(result.terminalAcknowledged).toBe(false);
    }
  );

  it('does not release after final projection retry exhaustion', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.projectFinalizing).mockResolvedValue({
      ok: false,
      kind: 'revision_conflict',
      code: 'revision_conflict',
    });

    const result = await runMatrixCorpus({ runId: 'run_final_projection_barrier', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('revision_conflict');
    expect(ports.projectFinalizing).toHaveBeenCalledTimes(2);
    expect(ports.getProjectionRevision).toHaveBeenCalledOnce();
    expect(ports.releaseRun).not.toHaveBeenCalled();
    expect(ports.waitForTerminalAcknowledgement).not.toHaveBeenCalled();
    expect(ports.cleanup).not.toHaveBeenCalled();
  });

  it('does not acknowledge or clean up when release fails', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.releaseRun).mockResolvedValue({ ok: false, code: 'release_failed' });

    const result = await runMatrixCorpus({ runId: 'run_release_barrier', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(result.failureCodes).toContain('release_failed');
    expect(ports.waitForTerminalAcknowledgement).not.toHaveBeenCalled();
    expect(ports.cleanup).not.toHaveBeenCalled();
    expect(result.terminalAcknowledged).toBe(false);
  });

  it('fails closed on terminal acknowledgement after release and does not clean early', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const ports = passingPorts([]);
    vi.mocked(ports.waitForTerminalAcknowledgement).mockResolvedValue({
      ok: false,
      code: 'terminal_ack_failed',
    });

    const result = await runMatrixCorpus({ runId: 'run_terminal_ack', catalog }, ports);

    expect(result.exitCode).toBe(2);
    expect(ports.releaseRun).toHaveBeenCalledOnce();
    expect(ports.cleanup).not.toHaveBeenCalled();
    expect(result.terminalAcknowledged).toBe(false);
  });

  it('distinguishes invalid evidence from a reconciled behavioral tool mismatch', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const invalidPorts = passingPorts([]);
    vi.mocked(invalidPorts.executeTurn).mockImplementation(async (input) => ({
      ok: true,
      observation: {
        ...observation(input.scenario, input.turnIndex),
        transportEvidence: { turnTerminal: 'failed', replyDigests: [] },
      },
    }));
    const terminalFailure = await runMatrixCorpus(
      { runId: 'run_terminal_evidence', catalog },
      invalidPorts
    );
    expect(terminalFailure.exitCode).toBe(2);

    const confirmationPorts = passingPorts([]);
    vi.mocked(confirmationPorts.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      return {
        ok: true,
        observation:
          input.scenario.id === 'intex-eval-001' && input.turnIndex === 1
            ? { ...valid, confirmationEvidence: { kind: 'not_applicable' } }
            : valid,
      };
    });
    const confirmationFailure = await runMatrixCorpus(
      { runId: 'run_confirmation_evidence', catalog },
      confirmationPorts
    );
    expect(confirmationFailure.exitCode).toBe(2);

    const usagePorts = passingPorts([]);
    vi.mocked(usagePorts.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      return {
        ok: true,
        observation: {
          ...valid,
          agentUsage: { ...valid.agentUsage, providerCostReconciled: false },
        },
      };
    });
    const usageFailure = await runMatrixCorpus(
      { runId: 'run_usage_evidence', catalog },
      usagePorts
    );
    expect(usageFailure.exitCode).toBe(2);

    const toolPorts = passingPorts([]);
    vi.mocked(toolPorts.executeTurn).mockImplementation(async (input) => {
      const valid = observation(input.scenario, input.turnIndex);
      if (input.scenario.id !== 'intex-eval-001' || input.turnIndex !== 1) {
        return { ok: true, observation: valid };
      }
      const wrongTool = [{ toolName: 'create_link', ordinal: 1 }];
      return {
        ok: true,
        observation: {
          ...valid,
          toolEvidence: {
            strictMockBoundary: true,
            selectedScheduled: wrongTool,
            mockOutcomes: wrongTool.map((tool) => ({ ...tool, status: 'completed' as const })),
            unexpectedKnownToolCount: 0,
          },
        },
      };
    });
    const toolFailure = await runMatrixCorpus({ runId: 'run_tool_behavior', catalog }, toolPorts);
    expect(toolFailure.exitCode).toBe(1);
    expect(toolFailure.scenarios[0]?.status).toBe('failed');
    expect(toolFailure.scenarios[19]?.status).toBe('passed');
  });
});

function passingPorts(trace: string[]): MatrixCorpusRunPorts {
  let revision = 0;
  return {
    provisionRun: vi.fn(async () => ({ ok: true, value: { leaseFence: '7' } }) as const),
    registerContext: vi.fn(async () => ({ ok: true, value: undefined }) as const),
    createProjection: vi.fn(async () => ({ ok: true, value: { revision } }) as const),
    reconcileRetention: vi.fn(async () => {
      trace.push('retention');
      return { ok: true, value: { revision } } as const;
    }),
    activateRun: vi.fn(async () => {
      trace.push('activate');
      return { ok: true, value: undefined } as const;
    }),
    projectRunning: vi.fn(async (input) => {
      trace.push('project-running');
      revision = input.expectedRevision + 1;
      return { ok: true, revision } as const;
    }),
    renewLease: vi.fn(async (input) => {
      trace.push(
        input.stage === 'turn'
          ? `renew:turn:${input.scenarioId}:${String(input.turnIndex)}`
          : `renew:judge:${input.scenarioId}:${String(input.turnIndex)}:${String(input.replyIndex)}`
      );
      return { ok: true, value: undefined } as const;
    }),
    executeTurn: vi.fn(
      async (input) =>
        ({ ok: true, observation: observation(input.scenario, input.turnIndex) }) as const
    ),
    judgeReply: vi.fn(
      async () =>
        ({
          ok: true,
          pass: true,
          model: 'or:minimax/minimax-m3',
          usage: {
            logicalCalls: 1,
            repairCount: 0,
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            costNanoUsd: 1,
          },
        }) as const
    ),
    projectScenario: vi.fn(async (input) => {
      revision = input.expectedRevision + 1;
      return { ok: true, revision } as const;
    }),
    reconcileStoppedScenario: vi.fn(
      async (input: { expectedRevision: number; observedSessionId: string | null }) => {
        trace.push('reconcile-stopped');
        if (input.observedSessionId === null)
          return {
            ok: true,
            revision: input.expectedRevision,
            disposition: 'not_bound',
            additionalAgentCostNanoUsd: 0,
          } as const;
        revision = input.expectedRevision + 1;
        return {
          ok: true,
          revision,
          disposition: 'projected',
          additionalAgentCostNanoUsd: 0,
        } as const;
      }
    ),
    getProjectionRevision: vi.fn(async () => ({ ok: true, value: { revision } }) as const),
    quiesceRun: vi.fn(async () => {
      trace.push('quiesce');
      return { ok: true, value: undefined } as const;
    }),
    waitForDrain: vi.fn(async () => {
      trace.push('drain');
      return { ok: true, value: undefined } as const;
    }),
    stageArtifacts: vi.fn(async () => {
      trace.push('stage');
      revision += 1;
      return { ok: true, value: { artifactStageDigest: 'a'.repeat(64), revision } } as const;
    }),
    finalizeContext: vi.fn(async () => {
      trace.push('finalize');
      return { ok: true, value: { tombstoneDigest: 'b'.repeat(64) } } as const;
    }),
    projectFinalizing: vi.fn(async (input) => {
      trace.push('project-finalizing');
      return { ok: true, revision: input.expectedRevision + 1 } as const;
    }),
    releaseRun: vi.fn(async () => {
      trace.push('release');
      return { ok: true, value: undefined } as const;
    }),
    waitForTerminalAcknowledgement: vi.fn(async () => {
      trace.push('terminal-ack');
      return { ok: true, value: undefined } as const;
    }),
    cleanup: vi.fn(async () => ({ ok: true, value: undefined }) as const),
  };
}

function observation(
  scenario: Pick<IntexEvalScenario, 'id' | 'title' | 'turns' | 'expected'>,
  turnIndex: number
): MatrixCorpusTurnObservation {
  const turn = scenario.turns[turnIndex] as { kind?: string } | undefined;
  const expectedTurn = scenario.expected.turns[turnIndex];
  const replies = expectedTurn?.replies ?? [];
  const requiredTools = expectedTurn?.requiredToolCalls ?? [];
  const expectedTools = requiredTools.flatMap((requirement) =>
    Array.from({ length: requirement.count }, (_, index) => ({
      toolName: requirement.toolName,
      ordinal: index + 1,
    }))
  );
  const assistantTexts = replies.map(() => 'Synthetic reply');
  const confirmationTurn = turn as
    | { kind?: string; previousTurnIndex?: number; decision?: 'accept' | 'reject' }
    | undefined;
  const zeroAgentCalls =
    confirmationTurn?.kind === 'confirmation_button' ||
    (expectedTurn?.sessionAfterTurn.startReason === 'user_requested_new_session' &&
      expectedTurn.timeline.forbiddenEventTypes.includes('user_message'));
  return {
    sessionId: `session_${scenario.id}`,
    sessionEvidence: {
      kind:
        expectedTurn?.transition.action === 'started'
          ? 'created'
          : expectedTurn?.transition.action === 'superseded_previous'
            ? 'superseded'
            : 'continued',
      scenarioLabel: scenario.title,
    },
    agentModel: 'or:deepseek/deepseek-v4-flash',
    observedReplyCount: replies.length,
    replyEvaluations: replies.map((reply, replyIndex) =>
      replyInput(scenario.id, turnIndex, replyIndex, reply.semanticCriteria)
    ),
    deterministicPassed: true,
    transportEvidence: {
      turnTerminal: 'completed',
      replyDigests: assistantTexts.map(digestMatrixReply),
    },
    toolEvidence: {
      strictMockBoundary: true,
      selectedScheduled: expectedTools,
      mockOutcomes: expectedTools.map((tool) => ({ ...tool, status: 'completed' as const })),
      unexpectedKnownToolCount: 0,
    },
    confirmationEvidence:
      confirmationTurn?.kind === 'confirmation_button'
        ? {
            kind: 'resolved',
            previousTurnIndex: confirmationTurn.previousTurnIndex ?? -1,
            decision: confirmationTurn.decision ?? 'reject',
          }
        : { kind: 'not_applicable' },
    agentUsage: {
      logicalCalls: zeroAgentCalls ? 0 : 1,
      inputTokens: zeroAgentCalls ? 0 : 1,
      outputTokens: zeroAgentCalls ? 0 : 1,
      totalTokens: zeroAgentCalls ? 0 : 2,
      costNanoUsd: zeroAgentCalls ? 0 : 1,
      providerCostReconciled: true,
    },
  };
}

function replyInput(
  scenarioId: string,
  turnIndex: number,
  replyIndex: number,
  semanticCriteria: readonly string[]
): ReplyEvaluationInput {
  return {
    scenarioId,
    turnIndex,
    replyIndex,
    assistantText: 'Synthetic reply',
    semanticCriteria: [...semanticCriteria],
    technicalFacts: {
      turnPassed: true,
      failureCodes: [],
      tools: [],
      transition: { expectedAction: 'continued', outcome: 'passed' },
      session: { allowedStatuses: ['waiting_for_user'], outcome: 'passed' },
      timeline: { required: [], forbidden: [], payloadGroups: [] },
      confirmationAction: 'none',
      toolOutcome: null,
    },
  };
}
