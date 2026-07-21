import { createHash } from 'node:crypto';
import { mapPublicTestRun } from './safeMapper.js';
import type { IntexAgentTestRunRecordV1, TestRunScenarioProjectionV1 } from './types.js';

export function digestMatrixCorpusFinalizationProjection(
  record: IntexAgentTestRunRecordV1,
  projections: readonly TestRunScenarioProjectionV1[]
): string {
  return createHash('sha256')
    .update(
      stableJson({
        version: 1,
        run: mapPublicTestRun(record),
        scenarios: [...projections]
          .sort((left, right) => left.scenarioNumber - right.scenarioNumber)
          .map(safeScenarioProjectionForDigest),
      }),
      'utf8'
    )
    .digest('hex');
}

function safeScenarioProjectionForDigest(
  projection: TestRunScenarioProjectionV1
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: projection.schemaVersion,
    runId: projection.runId,
    scenarioId: projection.scenarioId,
    scenarioNumber: projection.scenarioNumber,
    scenarioLabel: projection.scenarioLabel,
    runRevision: projection.runRevision,
    scenarioRevision: projection.scenarioRevision,
    eventWatermark: projection.eventWatermark,
    lifecycle: projection.lifecycle,
    verdict: projection.verdict,
    plannedTurns: projection.plannedTurns,
    completedTurns: projection.completedTurns,
    toolEvidence: structuredClone(projection.toolEvidence),
    deterministicChecks: structuredClone(projection.deterministicChecks),
    replyEvaluations: structuredClone(projection.replyEvaluations),
    agentUsage: structuredClone(projection.agentUsage),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}
