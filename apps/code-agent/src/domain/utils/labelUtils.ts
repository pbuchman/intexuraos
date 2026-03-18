/**
 * Label normalization utilities for Linear issue labels.
 *
 * Re-exports from @intexuraos/common-core.
 */

import { CODE_TASK_WORKER_TYPES, normalizeLabel, hasCodeTaskLabel, hasPlanningTaskLabel, hasComplexTaskLabel } from '@intexuraos/common-core';
import type { WorkerType } from '../models/codeTask.js';

export { hasCodeTaskLabel, hasPlanningTaskLabel, hasComplexTaskLabel };

export function hasUnclearLabel(labels: string[]): boolean {
  return labels.some((label) => normalizeLabel(label) === 'unclear');
}

const WORKER_TYPE_LABEL_SET = new Set<string>(
  CODE_TASK_WORKER_TYPES.filter((t) => t !== 'auto')
);

export function getWorkerTypeFromLabels(labels: string[]): WorkerType | undefined {
  const matches = labels
    .map((label) => normalizeLabel(label))
    .filter((normalized): normalized is WorkerType => WORKER_TYPE_LABEL_SET.has(normalized));

  // Filter to unique types
  const unique = [...new Set(matches)];

  return unique.length === 1 ? unique[0] : undefined;
}
