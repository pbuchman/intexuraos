import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

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

  it('composes the real live executor across all 20 scenarios and 59 strict-mock turns', async () => {
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
          completedTurns: 59,
          judgedReplies: 59,
        },
      },
    });
    expect(result.run.scenarios).toHaveLength(20);
    expect(result.run.scenarios.every((scenario) => scenario.status === 'passed')).toBe(true);
    expect(harness.metrics.maxConcurrentTurns).toBe(1);
    expect(harness.metrics.matrixMessages).toHaveLength(59);
    expect(
      harness.metrics.matrixMessages.filter((message) => message.startsWith('new session:'))
    ).toHaveLength(20);
    expect(harness.metrics.matrixMessages[0]).toContain('Scenario 001/020');
    expect(harness.metrics.matrixMessages.at(-1)).toContain('Scenario 020/020');
    expect(harness.metrics.deepSeekAgentCalls).toBeGreaterThan(0);
    expect(harness.metrics.confirmationAgentCalls).toBe(0);
    expect(harness.metrics.miniMaxJudgeCalls).toBe(59);
    expect(harness.metrics.productionExecutorResolutions).toBe(0);
    expect(harness.metrics.productionExecutorAdmissions).toBe(0);
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
      turnsCompleted: 59,
      confirmationsAccepted: 17,
      confirmationsRejected: 0,
      repliesJudged: 59,
      toolSelections: 19,
      mockCompletions: 19,
      mockFailures: 0,
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
  });
});
