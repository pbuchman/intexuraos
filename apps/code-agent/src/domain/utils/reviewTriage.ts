import type { WorkerType } from '../models/codeTask.js';

export const REVIEW_COMMAND_PREFIX = '@review';

export const SUPPORTED_REVIEW_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'minimax',
  'glm',
  'qwen3.5-plus',
] as const satisfies readonly WorkerType[];

const REVIEW_WORKER_TYPE_ALIASES: Record<string, WorkerType> = {
  auto: 'auto',
  opus: 'opus',
  sonnet: 'sonnet',
  minimax: 'minimax',
  glm: 'glm',
  qwen: 'qwen3.5-plus',
  'qwen3.5-plus': 'qwen3.5-plus',
};

export function isReviewCommandComment(commentBody: string): boolean {
  return /^\s*@review(?:\b|$)/i.test(commentBody);
}

export function normalizeReviewWorkerType(workerType: string): WorkerType | undefined {
  return REVIEW_WORKER_TYPE_ALIASES[workerType.trim().toLowerCase()];
}
