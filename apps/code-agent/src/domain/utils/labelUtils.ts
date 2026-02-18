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
