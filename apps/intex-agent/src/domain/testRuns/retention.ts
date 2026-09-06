import type { IntexAgentTestRunRecordV1 } from './types.js';

export const TEST_RUN_RETENTION_QUERY_LIMIT = 4 as const;
export const TEST_RUN_RETENTION_VISIBLE_LIMIT = 2 as const;

export function selectRetainedTestRuns(
  candidates: readonly IntexAgentTestRunRecordV1[]
): IntexAgentTestRunRecordV1[] {
  if (candidates.length > TEST_RUN_RETENTION_QUERY_LIMIT)
    throw new Error('TEST_RUN_RETENTION_QUERY_OVERFLOW');
  const byLatest = (
    left: IntexAgentTestRunRecordV1,
    right: IntexAgentTestRunRecordV1
  ): number =>
    right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId);
  const ordered = [...candidates].sort(byLatest);
  const current = ordered.find(isCurrentAcceptance);
  const latestSuccess = ordered.find(isArtifactReadySuccess);
  const latestFailed = ordered.find(
    (record) => !isCurrentAcceptance(record) && !isArtifactReadySuccess(record)
  );
  const selected = current === undefined
    ? [latestSuccess, latestFailed]
    : [current, latestSuccess];
  const unique = new Map<string, IntexAgentTestRunRecordV1>();
  for (const record of selected) {
    if (record !== undefined) unique.set(record.runId, record);
  }
  return [...unique.values()]
    .sort(byLatest)
    .slice(0, TEST_RUN_RETENTION_VISIBLE_LIMIT)
    .map((record) => structuredClone(record));
}

export function isVisibleRetainedTestRun(
  runId: string,
  retained: readonly IntexAgentTestRunRecordV1[]
): boolean {
  return retained.some((record) => record.runId === runId);
}

function isCurrentAcceptance(record: IntexAgentTestRunRecordV1): boolean {
  return (
    record.lifecycle === 'preflight' ||
    record.lifecycle === 'running' ||
    record.lifecycle === 'finalizing' ||
    record.artifactDelivery.status === 'pending' ||
    record.artifactDelivery.status === 'staged'
  );
}

function isArtifactReadySuccess(record: IntexAgentTestRunRecordV1): boolean {
  return (
    record.lifecycle === 'completed' &&
    record.verdict === 'passed' &&
    record.artifactDelivery.status === 'ready'
  );
}
