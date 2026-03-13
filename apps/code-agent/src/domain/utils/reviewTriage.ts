import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import type { WorkerType } from '../models/codeTask.js';

export const REVIEW_COMMAND_PREFIX = '@review';

export const SUPPORTED_REVIEW_WORKER_TYPES = CODE_TASK_WORKER_TYPES satisfies readonly WorkerType[];

const REVIEW_WORKER_TYPE_ALIASES: Record<string, WorkerType> = {
  auto: 'auto',
  opus: 'opus',
  sonnet: 'sonnet',
  minimax: 'minimax',
  glm: 'glm',
  qwen: 'qwen',
  kimi: 'kimi',
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
 *
 * Note: this scans ALL whitespace-delimited tokens in the comment body.
 * Review type keywords (e.g. "architecture", "security", "code_quality")
 * must NOT overlap with REVIEW_WORKER_TYPE_ALIASES keys to avoid
 * false matches.
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
