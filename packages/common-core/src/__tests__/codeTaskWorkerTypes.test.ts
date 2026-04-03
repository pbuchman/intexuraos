import { describe, expect, it } from 'vitest';

const EXPECTED_CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'minimax',
  'glm',
  'qwen',
  'kimi',
  'codex',
  'codex-xhigh',
  'openrouter-free',
];

describe('code task worker types', () => {
  it('exports the canonical worker type list from common-core', async () => {
    const commonCore = (await import('../index.js')) as Record<string, unknown>;

    expect(commonCore['CODE_TASK_WORKER_TYPES']).toEqual(EXPECTED_CODE_TASK_WORKER_TYPES);
  });

  it('exports a runtime worker type guard that recognizes all supported values', async () => {
    const commonCore = (await import('../index.js')) as Record<string, unknown>;
    const guard = commonCore['isCodeTaskWorkerType'];

    expect(typeof guard).toBe('function');

    if (typeof guard !== 'function') {
      return;
    }

    for (const workerType of EXPECTED_CODE_TASK_WORKER_TYPES) {
      expect(guard(workerType)).toBe(true);
    }

    expect(guard('invalid-worker-type')).toBe(false);
  });
});
