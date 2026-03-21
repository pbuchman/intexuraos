import { CODE_TASK_WORKER_TYPES } from '@intexuraos/common-core';
import type { CodeTaskWorkerType } from '@intexuraos/common-core';

interface KeywordRule {
  readonly pattern: RegExp;
  readonly workerType: CodeTaskWorkerType;
}

/**
 * Build keyword rules by generating a "use <name>" rule
 * for every non-auto worker type in CODE_TASK_WORKER_TYPES.
 *
 * Uses word-boundary matching to prevent false positives when
 * one type name is a prefix of another (e.g., "qwen" vs "qwen2").
 *
 * When a new worker type is added to the array, it is
 * automatically supported here — no code change needed.
 */
function buildKeywordRules(): readonly KeywordRule[] {
  return CODE_TASK_WORKER_TYPES
    .filter((t) => t !== 'auto')
    .map((workerType) => ({
      pattern: new RegExp(`\\buse ${workerType}\\b`, 'i'),
      workerType,
    }));
}

const KEYWORD_RULES: readonly KeywordRule[] = buildKeywordRules();

export function detectWorkerTypeFromMessage(message: string): CodeTaskWorkerType | undefined {
  let matched: CodeTaskWorkerType | undefined;

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(message)) {
      if (matched !== undefined) {
        return undefined;
      }
      matched = rule.workerType;
    }
  }

  return matched;
}
