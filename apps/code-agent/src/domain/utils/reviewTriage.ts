import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import type { WorkerType } from '../models/codeTask.js';

export const REVIEW_COMMAND_PREFIX = '@review';

// Use shared worker types from common-core
export const SUPPORTED_REVIEW_WORKER_TYPES = CODE_TASK_WORKER_TYPES satisfies readonly WorkerType[];

// Map user-facing worker names to internal types
const REVIEW_WORKER_TYPE_ALIASES: Record<string, WorkerType> = {
  auto: 'auto',
  opus: 'opus',
  sonnet: 'sonnet',
  minimax: 'minimax',
  glm: 'glm',
  qwen: 'qwen',
};

export function isReviewCommandComment(commentBody: string): boolean {
  return /^\s*@review(?:\b|$)/i.test(commentBody);
}

export function normalizeReviewWorkerType(workerType: string): WorkerType | undefined {
  return REVIEW_WORKER_TYPE_ALIASES[workerType.trim().toLowerCase()];
}
