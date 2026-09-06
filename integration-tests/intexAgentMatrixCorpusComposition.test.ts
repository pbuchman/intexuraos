import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { createIntexAgentMatrixCorpusRuntimeHarness } from './fixtures/intexAgentMatrixCorpusRuntimeHarness.js';
import { MatrixCorpusReportV1Schema } from '../tools/intex-agent-evals/src/matrixCorpus/reportSchema.js';

describe('Intex Agent Matrix corpus runtime composition', () => {
  const cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map(async (remove) => await remove()));
  });

  it('executes all 20 scenarios and 60 turns through the real WhatsApp and Intex runtimes', async () => {
    const harness = await createIntexAgentMatrixCorpusRuntimeHarness();
    cleanup.push(harness.cleanup);

    expect(harness.runtimeCompositionProven).toBe(true);
    expect(harness.metrics.retentionSagaProbe).toBe('ok');
    expect(harness.metrics.retentionSagaLoads).toEqual([
      { outcome: 'ok', sagaCount: 0 },
      { outcome: 'ok', sagaCount: 0 },
    ]);
    expect(harness.metrics.retentionPlans).toEqual([
      {
        outcome: 'ok',
        recordCount: 1,
        records: [{ lifecycle: 'preflight', artifactDelivery: 'pending', isCurrent: true }],
      },
    ]);
    expect(harness.metrics.controlAuthorizations.every(({ outcome }) => outcome === 'ok')).toBe(
      true
    );
    expect(harness.metrics.stateMachineProjectionFailures).toEqual([]);
    expect(harness.metrics.repositoryProjectionFailures).toEqual([]);
    expect(harness.metrics.projectionCommandValidationFailures).toEqual([]);
    expect(harness.metrics.projectionMutations.every(({ outcome }) => outcome === 'ok')).toBe(true);
    expect(harness.metrics.leaseRenewals.every(({ outcome }) => outcome === 'ok')).toBe(true);
    expect(harness.result).toMatchObject({
      reportReady: true,
      relativeReportDirectory: `.artifacts/intex-agent-evals/${harness.runId}`,
      run: {
        exitCode: 0,
        effectiveKind: 'passed',
        failureCodes: [],
        terminalAcknowledged: true,
        cleanupCompleted: true,
        totals: {
          completedTurns: 60,
          judgedReplies: 60,
        },
      },
    });
    expect(harness.result.run.scenarios).toHaveLength(20);
    expect(harness.result.run.scenarios.every(({ status }) => status === 'passed')).toBe(true);
    expect(harness.metrics.matrixMessages).toHaveLength(60);
    expect(
      harness.metrics.matrixMessages.filter((message) => message.startsWith('new session:'))
    ).toHaveLength(20);
    expect(harness.metrics.matrixMessages[0]).toContain('Scenario 001/020');
    expect(harness.metrics.matrixMessages.at(-1)).toContain('Scenario 020/020');
    expect(harness.metrics.maxConcurrentTurns).toBe(1);
    expect(harness.metrics.ingestPublications).toBe(60);
    expect(harness.metrics.replyPublications).toBe(60);
    expect(harness.metrics.terminalPublications).toBe(1);
    expect(harness.metrics.miniMaxJudgeCalls).toBe(60);
    expect(harness.metrics.deepSeekCalls.length).toBeGreaterThan(0);
    expect(
      harness.metrics.deepSeekCalls.every(
        ({ modelId }) => modelId === 'or:deepseek/deepseek-v4-flash'
      )
    ).toBe(true);
    expect(harness.metrics.deepSeekCalls).toContainEqual(
      expect.objectContaining({
        scenarioId: 'intex-eval-008',
        turnIndex: 1,
        stage: 'response_schema_repair',
      })
    );
    expect(harness.metrics.deepSeekCalls).toContainEqual(
      expect.objectContaining({
        scenarioId: 'intex-eval-008',
        turnIndex: 2,
        stage: 'calendar_update_planning',
      })
    );

    const reportDirectory = `${harness.repositoryRoot}/${harness.result.relativeReportDirectory ?? ''}`;
    const reportText = await readFile(`${reportDirectory}/report.json`, 'utf8');
    const reportMarkdown = await readFile(`${reportDirectory}/report.md`, 'utf8');
    const report = MatrixCorpusReportV1Schema.parse(JSON.parse(reportText));
    expect(report).toMatchObject({
      agentModel: 'or:deepseek/deepseek-v4-flash',
      evaluatorModel: 'or:minimax/minimax-m3',
      executionMode: 'real_matrix_whatsapp_strict_mock_tools',
      terminal: { runOutcomeCode: 'PASS', exitCode: 0 },
      totals: {
        scenariosPassed: 20,
        turnsCompleted: 60,
        repliesJudged: 60,
        productionExecutorResolutions: 0,
        productionExecutorAdmissions: 0,
      },
    });
    expect(
      report.scenarios.find(({ scenarioId }) => scenarioId === 'intex-eval-008')?.tools
    ).toEqual(
      expect.arrayContaining([
        {
          toolName: 'query_calendar_events',
          turnIndex: 0,
          expected: 1,
          selected: 1,
          completed: 1,
          failed: 0,
        },
        {
          toolName: 'query_calendar_events',
          turnIndex: 2,
          expected: 1,
          selected: 1,
          completed: 1,
          failed: 0,
        },
        {
          toolName: 'update_calendar_event',
          turnIndex: 3,
          expected: 4,
          selected: 4,
          completed: 4,
          failed: 0,
        },
      ])
    );
    const scenario008Projection = harness.metrics.scenarioProjectionDeterministicChecks.find(
      ({ scenarioId, lifecycle }) => scenarioId === 'intex-eval-008' && lifecycle === 'completed'
    );
    expect(scenario008Projection).toBeDefined();
    for (const turnIndex of [0, 2]) {
      const queryCheck = scenario008Projection?.checks.find(
        (check) => check.code === 'tool_fact' && check.turnIndex === turnIndex
      );
      expect(queryCheck).toMatchObject({ status: 'passed', operationOrdinal: 1 });
      expect(queryCheck?.evidence.actualFacts).toEqual(
        expect.arrayContaining([
          { name: 'startMatchesCatalog', value: true },
          { name: 'endMatchesCatalog', value: true },
          { name: 'queryMatchesCatalog', value: true },
        ])
      );
    }
    const updateChecks =
      scenario008Projection?.checks.filter(
        (check) => check.code === 'tool_fact' && check.turnIndex === 3
      ) ?? [];
    expect(
      updateChecks.map(({ status, operationOrdinal }) => ({ status, operationOrdinal }))
    ).toEqual([1, 2, 3, 4].map((operationOrdinal) => ({ status: 'passed', operationOrdinal })));
    for (const updateCheck of updateChecks) {
      expect(updateCheck.evidence.actualFacts).toEqual(
        expect.arrayContaining([
          { name: 'eventIdMatchesCatalog', value: true },
          { name: 'startMatchesCatalog', value: true },
          { name: 'endMatchesCatalog', value: true },
          { name: 'durationMatchesCatalog', value: true },
          { name: 'changesMatchCatalog', value: true },
        ])
      );
    }
    for (const sentinel of [
      'private-user-sentinel',
      '@private_user_sentinel:example.test',
      'private-room-sentinel',
      'private-token-sentinel',
      'private-puppet-sentinel',
      'private-whatsapp-account-sentinel',
      'private-whatsapp-sender-sentinel',
    ]) {
      expect(reportText).not.toContain(sentinel);
      expect(reportMarkdown).not.toContain(sentinel);
    }
  }, 30_000);
});
