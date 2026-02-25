/**
 * Label normalization utilities for Linear issue labels.
 *
 * Replicates the orchestrator's normalization from:
 * workers/orchestrator/src/services/task-dispatcher.ts:1111-1116
 *
 * Tracked debt: hasCodeTaskLabel is duplicated in the orchestrator as a private method.
 * Long-term home: @intexuraos/common-core or @intexuraos/infra-linear.
 */

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

export function hasCodeTaskLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'code-task');
}

export function hasUnclearLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'unclear');
}

const WORKER_TYPE_LABELS = new Set(['opus', 'sonnet', 'minimax', 'glm'] as const);
type WorkerTypeLabel = 'opus' | 'sonnet' | 'minimax' | 'glm';

export function getWorkerTypeFromLabels(labels: string[]): WorkerTypeLabel | undefined {
  const matches = labels
    .map((label) => normalizeLabel(label))
    .filter((normalized): normalized is WorkerTypeLabel => WORKER_TYPE_LABELS.has(normalized as WorkerTypeLabel));

  return matches.length === 1 ? matches[0] : undefined;
}
