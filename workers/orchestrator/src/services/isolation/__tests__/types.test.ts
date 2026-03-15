import { describe, it, expect } from 'vitest';
import { WORKER_TYPES } from '../types.js';

describe('WORKER_TYPES configuration', () => {
  it('stays in sync with the shared code task worker type list', async () => {
    const commonCore = (await import('@intexuraos/common-core')) as Record<string, unknown>;

    expect(commonCore['CODE_TASK_WORKER_TYPES']).toEqual(Object.keys(WORKER_TYPES));
  });

  it('uses generic opus alias so CLI resolves the latest model at runtime', () => {
    expect(WORKER_TYPES.opus.model).toBe('opus');
  });

  it('uses generic sonnet alias so CLI resolves the latest model at runtime', () => {
    expect(WORKER_TYPES.sonnet.model).toBe('sonnet');
  });

  it('uses qwen as the worker key and preserves qwen3.5-plus as the provider model id', () => {
    expect(WORKER_TYPES.qwen.model).toBe('qwen3.5-plus');
  });

  it('uses kimi as the worker key and preserves kimi-k2.5 as the provider model id', () => {
    expect(WORKER_TYPES.kimi.model).toBe('kimi-k2.5');
  });

  it('does not set a model for auto worker type', () => {
    expect(WORKER_TYPES.auto.model).toBeUndefined();
  });

  it('routes opus workers to the Anthropic API', () => {
    expect(WORKER_TYPES.opus.apiBaseUrl).toBe('https://api.anthropic.com');
    expect(WORKER_TYPES.opus.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
  });
});
