/**
 * Label normalization utilities for Linear issue labels.
 *
 * Re-exports from @intexuraos/common-core.
 */

import { normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/common-core';
import type { WorkerType } from '../models/codeTask.js';

export { hasCodeTaskLabel, hasPlanningTaskLabel };

export function hasUnclearLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'unclear');
}

const WORKER_TYPE_LABELS = ['opus', 'sonnet', 'minimax', 'glm', 'kimi'] as const satisfies readonly WorkerType[];
type WorkerTypeLabel = typeof WORKER_TYPE_LABELS[number];
const WORKER_TYPE_LABEL_SET = new Set<WorkerTypeLabel>(WORKER_TYPE_LABELS);

export function getWorkerTypeFromLabels(labels: string[]): WorkerType | undefined {
  const matches = labels
    .map((label) => normalizeLabel(label))
    .filter((normalized): normalized is WorkerTypeLabel => WORKER_TYPE_LABEL_SET.has(normalized as WorkerTypeLabel));

  // Filter to unique types
  const unique = [...new Set(matches)];

  return unique.length === 1 ? unique[0] : undefined;
}
