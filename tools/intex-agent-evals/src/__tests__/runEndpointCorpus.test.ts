import { describe, expect, it, vi } from 'vitest';
import { runEndpointCorpus } from '../runEndpointCorpus.js';
import type { IntexEvalScenario } from '../scenarioSchema.js';
import { IntexEvalScenarioSchema } from '../scenarioSchema.js';
import type { JudgeUsageSummary, ScenarioLifecycleResult } from '../runEndpointScenario.js';
import { createScenario } from './scenarioFixtures.js';

describe('run endpoint corpus', () => {
  it('runs an all-pass catalog serially in exact order', async () => {
    const scenarios = scenarioCatalog();
    const results = scenarios.map((scenario) => resultFor(scenario, 'passed'));
    const calls: string[] = [];
    let active = 0;
    const runScenario = vi.fn(async (scenario: IntexEvalScenario) => {
      expect(active).toBe(0);
      active += 1;
      calls.push(scenario.id);
      await Promise.resolve();
      active -= 1;
      return requiredItem(results, calls.length - 1);
    });

    const result = await runEndpointCorpus(scenarios, { runScenario });

    expect(calls).toEqual(scenarios.map((scenario) => scenario.id));
    expect(result).toEqual({ scenarios: results, effectiveKind: 'passed', exitCode: 0 });
  });

  it('continues after deterministic behavioral failure and preserves every exact result', async () => {
    const scenarios = scenarioCatalog();
    const results = [
      resultFor(requiredItem(scenarios, 0), 'behavioral_failure'),
      resultFor(requiredItem(scenarios, 1), 'passed'),
      resultFor(requiredItem(scenarios, 2), 'behavioral_failure'),
    ];
    const runScenario = orderedRunner(results);

    const result = await runEndpointCorpus(scenarios, { runScenario });

    expect(runScenario).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      scenarios: results,
      effectiveKind: 'behavioral_failure',
      exitCode: 1,
    });
  });

  it('continues after a valid judge rejection', async () => {
    const scenarios = scenarioCatalog();
    const judgeRejection = resultFor(requiredItem(scenarios, 0), 'behavioral_failure');
    judgeRejection.primary.judge = {
      status: 'completed',
      value: {
        ok: true,
        verdicts: [],
        usage: zeroUsage(),
      },
    };
    const results = [
      judgeRejection,
      resultFor(requiredItem(scenarios, 1), 'passed'),
      resultFor(requiredItem(scenarios, 2), 'passed'),
    ];
    const runScenario = orderedRunner(results);

    const result = await runEndpointCorpus(scenarios, { runScenario });

    expect(result.scenarios).toEqual(results);
    expect(runScenario).toHaveBeenCalledTimes(3);
    expect(result.exitCode).toBe(1);
  });

  it('stops before the next scenario after primary infrastructure failure', async () => {
    const scenarios = scenarioCatalog();
    const results = [
      resultFor(requiredItem(scenarios, 0), 'passed'),
      resultFor(requiredItem(scenarios, 1), 'infrastructure_failure'),
      resultFor(requiredItem(scenarios, 2), 'passed'),
    ];
    const runScenario = orderedRunner(results);

    const result = await runEndpointCorpus(scenarios, { runScenario });

    expect(runScenario).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      scenarios: results.slice(0, 2),
      effectiveKind: 'infrastructure_failure',
      exitCode: 2,
    });
  });

  it('stops after a cleanup-only infrastructure failure', async () => {
    const scenarios = scenarioCatalog();
    const cleanupFailure = resultFor(requiredItem(scenarios, 0), 'passed');
    cleanupFailure.cleanup = { status: 'infrastructure_failure', code: 'cleanup_failed' };
    cleanupFailure.effectiveKind = 'infrastructure_failure';
    cleanupFailure.exitCode = 2;
    const later = resultFor(requiredItem(scenarios, 1), 'passed');
    const runScenario = orderedRunner([cleanupFailure, later]);

    const result = await runEndpointCorpus(scenarios, { runScenario });

    expect(runScenario).toHaveBeenCalledOnce();
    expect(result.scenarios).toEqual([cleanupFailure]);
    expect(result.effectiveKind).toBe('infrastructure_failure');
    expect(result.exitCode).toBe(2);
  });

  it('applies pass/behavior precedence independent of position', async () => {
    const scenarios = scenarioCatalog();
    const results = [
      resultFor(requiredItem(scenarios, 0), 'passed'),
      resultFor(requiredItem(scenarios, 1), 'behavioral_failure'),
      resultFor(requiredItem(scenarios, 2), 'passed'),
    ];

    const result = await runEndpointCorpus(scenarios, { runScenario: orderedRunner(results) });

    expect(result.effectiveKind).toBe('behavioral_failure');
    expect(result.exitCode).toBe(1);
  });

  it('does not mutate scenarios, results, or share synthetic identities', async () => {
    const scenarios = scenarioCatalog();
    const scenarioSnapshot = structuredClone(scenarios);
    const results = scenarios.map((scenario) => resultFor(scenario, 'passed'));
    const resultSnapshots = structuredClone(results);
    const runScenario = orderedRunner(results);

    const corpus = await runEndpointCorpus(scenarios, { runScenario });

    expect(scenarios).toEqual(scenarioSnapshot);
    expect(results).toEqual(resultSnapshots);
    expect(corpus.scenarios).not.toBe(results);
    expect(corpus.scenarios[0]).toBe(results[0]);
    expect(
      new Set(
        corpus.scenarios.map((entry) =>
          entry.identity.status === 'completed' ? entry.identity.value.runId : 'missing'
        )
      ).size
    ).toBe(3);
    for (const [index, catalogScenario] of scenarios.entries()) {
      expect(runScenario).toHaveBeenNthCalledWith(index + 1, catalogScenario);
    }
  });
});

function scenarioCatalog(): IntexEvalScenario[] {
  return ['intex-eval-001', 'intex-eval-002', 'intex-eval-003'].map((id) =>
    IntexEvalScenarioSchema.parse(createScenario(1, id))
  );
}

function resultFor(
  scenario: IntexEvalScenario,
  kind: ScenarioLifecycleResult['effectiveKind']
): ScenarioLifecycleResult {
  const suffix = scenario.id.slice(-3);
  const effectiveKind = kind;
  const exitCode = kind === 'passed' ? 0 : kind === 'behavioral_failure' ? 1 : 2;
  return {
    scenarioId: scenario.id,
    identity: {
      status: 'completed',
      value: {
        runId: `run-${suffix}`,
        userId: `test-intex-agent-run-${suffix}`,
      },
    },
    primary: {
      kind,
      endpoint: { status: 'not_run' },
      deterministic: { status: 'not_run' },
      judge: { status: 'not_run' },
    },
    cleanup: { status: 'passed', deleted: 0, total: 0 },
    effectiveKind,
    exitCode,
  };
}

function orderedRunner(
  results: readonly ScenarioLifecycleResult[]
): (scenario: IntexEvalScenario) => Promise<ScenarioLifecycleResult> {
  let index = 0;
  return vi.fn(async (_scenario: IntexEvalScenario) => {
    const result = results[index];
    index += 1;
    if (result === undefined) throw new Error('Unexpected corpus call');
    return result;
  });
}

function zeroUsage(): JudgeUsageSummary {
  return {
    logicalCalls: 0,
    repairCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    providerReportedUsd: 0,
    providerReportedUsdComplete: true,
  };
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('Expected fixture item');
  return item;
}
