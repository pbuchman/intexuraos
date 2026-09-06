import { describe, expect, it } from 'vitest';

const EXPECTED_CODE_TASK_WORKER_TYPES = [
  'auto',
  'opus',
  'sonnet',
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

  it('preserves the runtime and auth contract for every supported worker', async () => {
    const commonCore = (await import('../index.js')) as Record<string, unknown>;
    const capabilities = commonCore['CODE_TASK_WORKER_CAPABILITIES'] as Record<
      string,
      { runtimeFamily: string; auth: { kind: string; envVar?: string }; requiresDocker: boolean }
    >;

    expect(capabilities).toEqual({
      auto: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
      opus: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
      sonnet: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
      codex: expect.objectContaining({ runtimeFamily: 'codex', auth: { kind: 'codex' } }),
      'codex-xhigh': expect.objectContaining({
        runtimeFamily: 'codex',
        auth: { kind: 'codex' },
      }),
      'openrouter-free': expect.objectContaining({
        runtimeFamily: 'provider',
        auth: { kind: 'api_key', envVar: 'OPENROUTER_API_KEY' },
      }),
    });
  });
});
