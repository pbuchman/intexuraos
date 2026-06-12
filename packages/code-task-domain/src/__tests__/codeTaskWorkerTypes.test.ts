import { describe, expect, it } from 'vitest';

const EXPECTED_CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
  'minimax',
  'mimo-pro',
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

  it('exports capability metadata for every supported worker type', async () => {
    const commonCore = (await import('../index.js')) as Record<string, unknown>;
    const capabilities = commonCore['CODE_TASK_WORKER_CAPABILITIES'];

    expect(capabilities).toBeDefined();
    expect(Object.keys(capabilities as Record<string, unknown>)).toEqual(
      EXPECTED_CODE_TASK_WORKER_TYPES
    );
  });

  it('describes auth requirements for codex, claude, and provider-backed workers', async () => {
    const commonCore = (await import('../index.js')) as Record<string, unknown>;
    const capabilities = commonCore['CODE_TASK_WORKER_CAPABILITIES'] as Record<
      string,
      { runtimeFamily: string; auth: { kind: string; envVar?: string }; requiresDocker: boolean }
    >;

    expect(capabilities['codex']).toMatchObject({
      runtimeFamily: 'codex',
      auth: { kind: 'codex' },
      requiresDocker: true,
    });
    expect(capabilities['sonnet']).toMatchObject({
      runtimeFamily: 'claude',
      auth: { kind: 'claude' },
      requiresDocker: true,
    });
    expect(capabilities['glm']).toMatchObject({
      runtimeFamily: 'provider',
      auth: { kind: 'api_key', envVar: 'DASHSCOPE_API_KEY' },
      requiresDocker: true,
    });
    expect(capabilities['openrouter-free']).toMatchObject({
      runtimeFamily: 'provider',
      auth: { kind: 'api_key', envVar: 'OPENROUTER_API_KEY' },
      requiresDocker: true,
    });
  });
});
