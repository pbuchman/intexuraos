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

/**
 * Extract worker type from a review command comment.
 * Searches for any supported worker alias token and returns the first match.
 * Returns undefined if no recognized worker type is found.
 */
export function extractReviewWorkerType(commentBody: string): WorkerType | undefined {
  const lowerBody = commentBody.toLowerCase();
  const tokens = lowerBody.split(/\s+/);

  for (const token of tokens) {
    const normalized = REVIEW_WORKER_TYPE_ALIASES[token];
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}
