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

const WORKER_TYPE_LABELS = new Set(['opus', 'sonnet', 'minimax', 'glm'] as const);
type WorkerTypeLabel = 'opus' | 'sonnet' | 'minimax' | 'glm';

export function getWorkerTypeFromLabels(labels: string[]): WorkerTypeLabel | undefined {
  const matches = labels
    .map((label) => normalizeLabel(label))
    .filter((normalized): normalized is WorkerTypeLabel => WORKER_TYPE_LABELS.has(normalized as WorkerTypeLabel));

  return matches.length === 1 ? matches[0] : undefined;
}
