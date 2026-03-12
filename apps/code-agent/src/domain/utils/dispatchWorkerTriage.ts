import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import type { WorkerType } from '../models/codeTask.js';

export const DISPATCH_WORKER_PATTERNS = ['@worker', '@model'] as const;

export const SUPPORTED_DISPATCH_WORKER_TYPES = CODE_TASK_WORKER_TYPES satisfies readonly WorkerType[];

const WORKER_TYPE_ALIASES: Record<string, WorkerType> = {
  auto: 'auto',
  opus: 'opus',
  sonnet: 'sonnet',
  minimax: 'minimax',
  glm: 'glm',
  qwen: 'qwen3.5-plus',
  'qwen3.5-plus': 'qwen3.5-plus',
};

// Build regex from patterns for maintainability
const WORKER_PATTERN = new RegExp(
  `@(?:${DISPATCH_WORKER_PATTERNS.map(p => p.slice(1)).join('|')})\\s+(\\S+)`,
  'i'
);

/**
 * Extracts worker type from comment like "Fix this @worker minimax" or "@model qwen".
 * Returns undefined if no @worker/@model directive found.
 */
export function extractDispatchWorkerType(commentBody: string): WorkerType | undefined {
  const match = WORKER_PATTERN.exec(commentBody);
  if (match === null) return undefined;

  /* v8 ignore start -- ts-type: regex always captures group when match succeeds @preserve */
  const typeStr = match[1];
  if (typeStr === undefined) return undefined;
  /* v8 ignore stop @preserve */

  return WORKER_TYPE_ALIASES[typeStr.toLowerCase()];
}
