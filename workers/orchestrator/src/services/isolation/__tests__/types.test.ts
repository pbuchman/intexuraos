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

  it('sets effort to high for opus worker type', () => {
    expect(WORKER_TYPES.opus.effort).toBe('high');
  });

  it('does not set effort for auto worker type', () => {
    expect(WORKER_TYPES.auto.effort).toBeUndefined();
  });

  it('routes opus workers to the Anthropic API', () => {
    expect(WORKER_TYPES.opus.apiBaseUrl).toBe('https://api.anthropic.com');
    expect(WORKER_TYPES.opus.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
  });

  it('routes public codex workers through the Codex runtime', () => {
    expect(WORKER_TYPES.codex.runtime).toBe('codex');
    expect(WORKER_TYPES.codex.apiBaseUrl).toBe('https://api.openai.com');
    expect(WORKER_TYPES.codex.apiKeyEnvVar).toBeUndefined();
  });

  it('keeps existing worker types on the Claude runtime', () => {
    for (const [workerType, config] of Object.entries(WORKER_TYPES)) {
      if (workerType === 'codex' || workerType === 'codex-xhigh') {
        continue;
      }
      expect(config.runtime).toBe('claude');
    }
  });

  it('routes codex-xhigh through the Codex runtime with xhigh effort', () => {
    expect(WORKER_TYPES['codex-xhigh'].runtime).toBe('codex');
    expect(WORKER_TYPES['codex-xhigh'].apiBaseUrl).toBe('https://api.openai.com');
    expect(WORKER_TYPES['codex-xhigh'].effort).toBe('xhigh');
    expect(WORKER_TYPES['codex-xhigh'].apiKeyEnvVar).toBeUndefined();
  });

  it('does not set effort for base codex worker type', () => {
    expect(WORKER_TYPES.codex.effort).toBeUndefined();
  });

  it('routes openrouter-free through the Claude runtime with OpenRouter API', () => {
    expect(WORKER_TYPES['openrouter-free'].runtime).toBe('claude');
    expect(WORKER_TYPES['openrouter-free'].apiBaseUrl).toBe('https://openrouter.ai/api');
    expect(WORKER_TYPES['openrouter-free'].apiKeyEnvVar).toBe('OPENROUTER_API_KEY');
    expect(WORKER_TYPES['openrouter-free'].model).toBe('qwen/qwen3.6-plus:free');
    expect(WORKER_TYPES['openrouter-free'].effort).toBe('high');
  });
});
