import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCanonicalMatrixCorpus } from '../matrixCorpus/catalog.js';
import { createProductionMatrixCorpusExecutor } from '../matrixCorpus/liveExecution.js';
import { MatrixCorpusReportV1Schema } from '../matrixCorpus/reportSchema.js';
import { createPassingMatrixCorpusCompositionHarness } from './fixtures/matrixCorpusCompositionHarness.js';

const scenariosDirectory = fileURLToPath(new URL('../../scenarios/', import.meta.url));

describe('production Matrix corpus composition', () => {
  const cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map(async (remove) => await remove()));
  });

  it('composes the real live executor across all 20 scenarios and 60 strict-mock turns', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog);
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run.failureCodes).toEqual([]);
    expect(result).toMatchObject({
      reportReady: true,
      relativeReportDirectory: `.artifacts/intex-agent-evals/${harness.runId}`,
      run: {
        exitCode: 0,
        effectiveKind: 'passed',
        terminalAcknowledged: true,
        cleanupCompleted: true,
        totals: {
          completedTurns: 60,
          judgedReplies: 60,
        },
      },
    });
    expect(result.run.scenarios).toHaveLength(20);
    expect(result.run.scenarios.every((scenario) => scenario.status === 'passed')).toBe(true);
    expect(new Set(harness.metrics.scenarioProjectionSessions).size).toBe(20);
    expect(harness.metrics.maxConcurrentTurns).toBe(1);
    expect(harness.metrics.initialCursorCaptures).toBe(1);
    expect(harness.metrics.matrixSyncSince).toEqual([
      undefined,
      ...Array.from({ length: 120 }, (_, index) => `batch_${String(index + 1)}`),
    ]);
    expect(harness.metrics.matrixMessages).toHaveLength(60);
    expect(
      harness.metrics.matrixMessages.filter((message) => message.startsWith('new session:'))
    ).toHaveLength(20);
    expect(harness.metrics.matrixMessages[0]).toContain('Scenario 001/020');
    expect(harness.metrics.matrixMessages.at(-1)).toContain('Scenario 020/020');
    expect(harness.metrics.leaseRenewalKeys).toHaveLength(60 * 3);
    expect(harness.metrics.leaseRenewalKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining('renew:intex-eval-001:0'),
        expect.stringContaining('renew:intex-eval-020:1'),
        expect.stringContaining('reply:intex-eval-001:0'),
        expect.stringContaining('reply:intex-eval-020:1'),
        expect.stringContaining('judge:intex-eval-001:0'),
        expect.stringContaining('judge:intex-eval-020:1'),
      ])
    );
    const firstReplyRenewal = harness.trace.findIndex((item) =>
      item.includes('reply:intex-eval-001:0')
    );
    const firstReply = harness.trace.indexOf('matrix:reply:$matrix_reply_1');
    const firstJudgeRenewal = harness.trace.findIndex(
      (item) => item.includes('judge:intex-eval-001:0') && item.startsWith('lease:')
    );
    const firstJudge = harness.trace.indexOf('judge:intex-eval-001:0');
    expect(firstReplyRenewal).toBeGreaterThanOrEqual(0);
    expect(firstReplyRenewal).toBeLessThan(firstReply);
    expect(firstReply).toBeLessThan(firstJudgeRenewal);
    expect(firstJudgeRenewal).toBeLessThan(firstJudge);
    expect(harness.metrics.deepSeekAgentCalls).toBeGreaterThan(0);
    expect(harness.metrics.confirmationAgentCalls).toBe(0);
    expect(harness.metrics.miniMaxJudgeCalls).toBe(60);
    expect(harness.metrics.judgeAssistantTexts[0]).toContain('Content: [redacted]');
    expect(harness.metrics.judgeAssistantTexts.join('\n')).not.toContain('INTEX-EVAL-001-F01');
    expect(harness.metrics.productionExecutorResolutions).toBe(0);
    expect(harness.metrics.productionExecutorAdmissions).toBe(0);
    expect(
      harness.metrics.scenarioProjectionDeterministicChecks
        .flat()
        .some(
          (check) =>
            check.code === 'session_transition' &&
            check.status === 'passed' &&
            check.evidence.expectedTransition === 'superseded' &&
            check.evidence.actualTransition === 'superseded'
        )
    ).toBe(true);
    expect(harness.trace.slice(-8)).toEqual([
      'quiesce',
      'drain',
      'artifact:staged',
      'context:finalized',
      'terminal:projected',
      'release',
      'terminal:acknowledged',
      'artifact:ready',
    ]);

    const reportPath = `${harness.repositoryRoot}/${result.relativeReportDirectory}/report.json`;
    const reportText = await readFile(reportPath, 'utf8');
    const reportMarkdown = await readFile(
      `${harness.repositoryRoot}/${result.relativeReportDirectory}/report.md`,
      'utf8'
    );
    const report = MatrixCorpusReportV1Schema.parse(JSON.parse(reportText));
    expect(report.terminal.runOutcomeCode).toBe('PASS');
    expect(report.agentModel).toBe('or:deepseek/deepseek-v4-flash');
    expect(report.evaluatorModel).toBe('or:minimax/minimax-m3');
    expect(report.totals).toMatchObject({
      scenariosPassed: 20,
      turnsCompleted: 60,
      confirmationsAccepted: 17,
      confirmationsRejected: 0,
      repliesJudged: 60,
      toolSelections: 24,
      mockCompletions: 24,
      mockFailures: 0,
      sessionsContinued: 39,
      sessionsClosed: 1,
      productionExecutorResolutions: 0,
      productionExecutorAdmissions: 0,
    });
    for (const sentinel of [
      'private-user-sentinel',
      '@private_user_sentinel:example.test',
      'private-room-sentinel',
      'private-token-sentinel',
      'private-puppet-sentinel',
    ]) {
      expect(reportText).not.toContain(sentinel);
      expect(reportMarkdown).not.toContain(sentinel);
    }
  });

  it('fails the real live run when a Matrix reply contains an inline raw date record', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      rawDateReplyScenarioNumber: 2,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run).toMatchObject({
      exitCode: 1,
      effectiveKind: 'behavioral_failure',
      failureCodes: ['deterministic_evidence_failed'],
      totals: { completedTurns: 60 },
    });
    expect(result.run.scenarios[1]).toMatchObject({
      scenarioId: 'intex-eval-002',
      status: 'failed',
    });
    expect(
      harness.metrics.scenarioProjectionDeterministicChecks
        .flat()
        .some((check) => check.code === 'reply_format' && check.status === 'failed')
    ).toBe(true);
    expect(harness.metrics.judgeAssistantTexts.join('\n')).toContain(
      '[date-presentation: raw-record]'
    );
    expect(harness.metrics.judgeAssistantTexts.join('\n')).not.toContain('2026-08-18T14:30');
  });

  it('persists a missing-confirmation failure, closes only that scenario, and reaches scenario 20', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      missingConfirmationScenarioNumber: 14,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run).toMatchObject({
      exitCode: 1,
      effectiveKind: 'behavioral_failure',
      failureCodes: expect.arrayContaining([
        'deterministic_evidence_failed',
        'required_confirmation_missing',
      ]),
      totals: { completedTurns: 59 },
    });
    expect(result.run.scenarios[13]).toMatchObject({
      scenarioId: 'intex-eval-014',
      status: 'failed',
      completedTurns: 1,
    });
    expect(result.run.scenarios[19]).toMatchObject({
      scenarioId: 'intex-eval-020',
      status: 'passed',
      completedTurns: 20,
    });
    expect(harness.metrics.matrixMessages.at(-1)).toContain('Scenario 020/020');
    expect(
      harness.metrics.scenarioProjectionDeterministicChecks
        .flat()
        .some(
          (check) =>
            check.code === 'confirmation_count' &&
            check.status === 'failed' &&
            check.turnIndex === 1 &&
            check.evidence.expectedCount === 1 &&
            check.evidence.actualCount === 0
        )
    ).toBe(true);
  });

  it('bounds the initial Matrix cursor with the configured correlation deadline', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      hangInitialCursor: true,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      correlationTimeoutMs: 5,
      replyTimeoutMs: 7,
      pollIntervalMs: 1,
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run).toMatchObject({
      exitCode: 2,
      failureCodes: ['reply_timeout'],
      terminalAcknowledged: true,
      cleanupCompleted: true,
    });
    expect(harness.metrics.matrixMessages).toHaveLength(0);
  });

  it('waits for the prior ingest outbox before issuing capability for turn 26', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      transportBusyAfterMessageNumber: 25,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      correlationTimeoutMs: 50,
      pollIntervalMs: 1,
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run).toMatchObject({
      exitCode: 0,
      effectiveKind: 'passed',
      totals: { completedTurns: 60 },
    });
    expect(harness.metrics.matrixMessages).toHaveLength(60);
    expect(harness.metrics.transportReadinessChecks).toBeGreaterThanOrEqual(3);
  });

  it('wires an explicit reply deadline override into the live executor', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      dropReplyScenarioNumber: 1,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      correlationTimeoutMs: 50,
      replyTimeoutMs: 5,
      pollIntervalMs: 1,
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result.run).toMatchObject({ exitCode: 2, failureCodes: ['reply_timeout'] });
    expect(harness.metrics.matrixMessages).toHaveLength(1);
  });

  it('keeps the executor default reply wait alive past 180 seconds and stops at 240 seconds', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      dropReplyScenarioNumber: 1,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = execute({
        runId: harness.runId,
        preflight: harness.preflight,
        prepared: harness.prepared,
      }).then((result) => {
        settled = true;
        return result;
      });

      await harness.replyWaitStarted;
      expect(harness.metrics.leaseRenewalKeys).toEqual(
        expect.arrayContaining([expect.stringContaining('reply:intex-eval-001:0')])
      );
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(60 * 1000);

      const result = await pending;
      expect(result.run).toMatchObject({ exitCode: 2, failureCodes: ['reply_timeout'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves passing scenario evidence when post-terminal report publication fails', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      failArtifactReady: true,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: false,
      run: {
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: ['REPORT_PUBLICATION_FAILED'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
      },
    });
    expect(result).not.toHaveProperty('relativeReportDirectory');
    expect(result.run.scenarios).toHaveLength(20);
    expect(result.run.scenarios.every((scenario) => scenario.status === 'passed')).toBe(true);
  });

  it('preserves behavioral scenario evidence while publication failure wins exit precedence', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      failArtifactReady: true,
      failMiniMaxScenarioNumber: 1,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: false,
      run: {
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: ['REPORT_PUBLICATION_FAILED'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
      },
    });
    expect(result).not.toHaveProperty('relativeReportDirectory');
    expect(result.run.scenarios[0]).toMatchObject({ status: 'failed', completedTurns: 2 });
    expect(result.run.scenarios.slice(1).every((scenario) => scenario.status === 'passed')).toBe(
      true
    );
    expect(
      harness.metrics.scenarioProjectionReplyEvaluations
        .flat()
        .some(
          (evaluation) =>
            evaluation.verdict === 'failed' &&
            evaluation.usage.logicalCalls === 2 &&
            evaluation.usage.repairCount === 1
        )
    ).toBe(true);
  });

  it('publishes a valid stopped report when MiniMax infrastructure fails after a completed turn', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      failMiniMaxScenarioNumber: 3,
      failMiniMaxInfrastructureScenarioNumber: 12,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: true,
      relativeReportDirectory: `.artifacts/intex-agent-evals/${harness.runId}`,
      run: {
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: ['MINIMAX_JUDGE_INVALID_OUTPUT'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
        totals: {
          completedTurns: 26,
          judgedReplies: 25,
          evaluatorCostNanoUsd: 33_000,
        },
      },
    });
    expect(result.run.scenarios[11]).toMatchObject({
      scenarioId: 'intex-eval-012',
      status: 'stopped',
      completedTurns: 1,
    });
    expect(result.run.scenarios[2]).toMatchObject({
      scenarioId: 'intex-eval-003',
      status: 'failed',
      completedTurns: 3,
    });
    expect(result.run.scenarios.slice(12).every((scenario) => scenario.status === 'not_run')).toBe(
      true
    );
    const report = MatrixCorpusReportV1Schema.parse(
      JSON.parse(
        await readFile(
          `${harness.repositoryRoot}/.artifacts/intex-agent-evals/${harness.runId}/report.json`,
          'utf8'
        )
      )
    );
    expect(report.artifactDelivery).toMatchObject({ status: 'ready', failureCode: null });
    expect(report.totals.turnsCompleted).toBe(26);
    expect(report.scenarios[11]).toMatchObject({
      lifecycle: 'stopped',
      verdict: 'not_evaluated',
      completedTurns: 1,
      judge: {
        status: 'not_run',
        usage: {
          logicalCalls: 1,
          repairCount: 1,
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          costNanoUsd: 2_000,
          costComplete: true,
        },
      },
    });
    expect(report.usage.evaluator).toEqual({
      logicalCalls: 29,
      repairCount: 4,
      inputTokens: 330,
      outputTokens: 165,
      totalTokens: 495,
      costNanoUsd: 33_000,
      costComplete: true,
    });
  });

  it('terminally marks delivery failed when the ready report does not validate', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      finalizedScenarioContextCount: 19,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: false,
      run: {
        effectiveKind: 'infrastructure_failure',
        exitCode: 2,
        failureCodes: ['REPORT_VALIDATION_FAILED'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
      },
    });
    expect(harness.metrics.artifactDeliveryStatus).toBe('failed');
    expect(harness.metrics.artifactDeliveryFailureCode).toBe('REPORT_VALIDATION_FAILED');
    expect(harness.metrics.artifactDeliveryTransitions.at(-1)).toEqual({
      status: 'failed',
      failureCode: 'REPORT_VALIDATION_FAILED',
      terminalControlEventId: 'terminal_event_1',
    });
  });

  it('terminalizes a persisted session binding when Matrix correlation fails before observation', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      wrongPuppetScenarioNumber: 1,
      advanceEventRevisionAfterBindingScenarioNumber: 1,
      conflictStoppedScenarioProjectionOnce: true,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: true,
      run: {
        exitCode: 2,
        effectiveKind: 'infrastructure_failure',
        failureCodes: ['wrong_puppet'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
        totals: { agentCostNanoUsd: 1_000 },
      },
    });
    expect(result.run.scenarios[0]).toMatchObject({ status: 'stopped', completedTurns: 0 });
    expect(result.run.scenarios.slice(1).every((scenario) => scenario.status === 'not_run')).toBe(
      true
    );
    expect(harness.metrics.scenarioProjectionSessions).toEqual(['matrix_session_1_1']);
    expect(harness.metrics.scenarioProjectionEventWatermarks).toEqual([2]);
    const report = MatrixCorpusReportV1Schema.parse(
      JSON.parse(
        await readFile(
          `${harness.repositoryRoot}/${result.relativeReportDirectory}/report.json`,
          'utf8'
        )
      )
    );
    expect(report.scenarios[0]?.agentUsage).toMatchObject({
      logicalCalls: 1,
      totalTokens: 15,
      costNanoUsd: 1_000,
      costComplete: true,
    });
    expect(report.scenarios[0]?.judge).toMatchObject({ status: 'not_run', passed: null });
    expect(report.scenarios[0]?.strictMockProof.status).toBe('passed');
    expect(report.usage.agent).toMatchObject({
      logicalCalls: 1,
      totalTokens: 15,
      costNanoUsd: 1_000,
      costComplete: true,
    });
    expect(report.usage).toMatchObject({ totalCostNanoUsd: 1_000, costComplete: true });
  });

  it('reconciles a session binding that appears while the failed turn is draining', async () => {
    const catalog = await loadCanonicalMatrixCorpus(scenariosDirectory);
    const harness = await createPassingMatrixCorpusCompositionHarness(catalog, {
      deferBindingUntilQuiesceScenarioNumber: 1,
    });
    cleanup.push(harness.cleanup);
    const execute = createProductionMatrixCorpusExecutor({
      repositoryRoot: harness.repositoryRoot,
      matrix: harness.matrix,
      whatsapp: harness.whatsapp,
      intex: harness.intex,
      evaluator: harness.evaluator,
      env: {
        INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY:
          'composition-harness-binding-key-with-at-least-thirty-two-bytes',
      },
      correlationTimeoutMs: 5,
      pollIntervalMs: 1,
      now: harness.now,
    });

    const result = await execute({
      runId: harness.runId,
      preflight: harness.preflight,
      prepared: harness.prepared,
    });

    expect(result).toMatchObject({
      reportReady: true,
      run: {
        exitCode: 2,
        failureCodes: ['scenario_binding_timeout'],
        terminalAcknowledged: true,
        cleanupCompleted: true,
      },
    });
    expect(result.run.scenarios[0]).toMatchObject({ status: 'stopped', completedTurns: 0 });
    expect(harness.metrics.scenarioProjectionSessions).toEqual(['matrix_session_1_1']);
    expect(harness.metrics.scenarioProjectionEventWatermarks).toEqual([1]);
  });
});
