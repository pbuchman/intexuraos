import type { IntexEvalScenario } from './scenarioSchema.js';
import type { ScenarioLifecycleResult } from './runEndpointScenario.js';

export interface EndpointCorpusResult {
  scenarios: ScenarioLifecycleResult[];
  effectiveKind: 'passed' | 'behavioral_failure' | 'infrastructure_failure';
  exitCode: 0 | 1 | 2;
}

export async function runEndpointCorpus(
  scenarios: readonly IntexEvalScenario[],
  deps: {
    runScenario: (scenario: IntexEvalScenario) => Promise<ScenarioLifecycleResult>;
  }
): Promise<EndpointCorpusResult> {
  const results: ScenarioLifecycleResult[] = [];
  for (const scenario of scenarios) {
    const result = await deps.runScenario(scenario);
    results.push(result);
    if (result.effectiveKind === 'infrastructure_failure') break;
  }

  const effectiveKind = results.some((result) => result.effectiveKind === 'infrastructure_failure')
    ? 'infrastructure_failure'
    : results.some((result) => result.effectiveKind === 'behavioral_failure')
      ? 'behavioral_failure'
      : 'passed';
  const exitCode =
    effectiveKind === 'infrastructure_failure' ? 2 : effectiveKind === 'behavioral_failure' ? 1 : 0;
  return { scenarios: results, effectiveKind, exitCode };
}
