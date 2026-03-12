/**
 * Label normalization utilities for Linear issue labels.
 *
 * Re-exports from @intexuraos/common-core.
 */

import { normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/common-core';

export { hasCodeTaskLabel, hasPlanningTaskLabel };

export function hasUnclearLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'unclear');
}

const WORKER_TYPE_LABELS = new Set(['opus', 'sonnet', 'minimax', 'glm-5', 'glm'] as const);
type WorkerTypeLabel = 'opus' | 'sonnet' | 'minimax' | 'glm-5';

/**
 * Normalize legacy 'glm' label to 'glm-5'.
 */
function normalizeWorkerTypeLabel(label: string): WorkerTypeLabel | undefined {
  const normalized = normalizeLabel(label);
  if (normalized === 'glm') {
    return 'glm-5';
  }
  return WORKER_TYPE_LABELS.has(normalized as WorkerTypeLabel) ? (normalized as WorkerTypeLabel) : undefined;
}

export function getWorkerTypeFromLabels(labels: string[]): WorkerTypeLabel | undefined {
  const matches = labels
    .map((label) => normalizeWorkerTypeLabel(label))
    .filter((normalized): normalized is WorkerTypeLabel => normalized !== undefined);

  return matches.length === 1 ? matches[0] : undefined;
}
