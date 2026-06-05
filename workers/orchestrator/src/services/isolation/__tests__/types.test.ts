import { describe, it, expect } from 'vitest';
import { WORKER_TYPES, type WorkerSecrets } from '../types.js';

describe('WORKER_TYPES configuration', () => {
  it('stays in sync with the shared code task worker type list', async () => {
    const codeTaskDomain = (await import('@intexuraos/code-task-domain')) as Record<
      string,
      unknown
    >;

    expect(codeTaskDomain['CODE_TASK_WORKER_TYPES']).toEqual(Object.keys(WORKER_TYPES));
  });

  it('keeps orchestrator runtime config in sync with shared capability metadata', async () => {
    const codeTaskDomain = (await import('@intexuraos/code-task-domain')) as Record<
      string,
      unknown
    >;
    const capabilities = codeTaskDomain['CODE_TASK_WORKER_CAPABILITIES'] as Record<
      string,
      { runtimeFamily: string; auth: { kind: string; envVar?: string } }
    >;

    for (const [workerType, config] of Object.entries(WORKER_TYPES)) {
      const capability = capabilities[workerType];
      expect(capability, `${workerType} missing shared capability metadata`).toBeDefined();
      expect(capability.runtimeFamily === 'codex' ? 'codex' : 'claude').toBe(config.runtime);
      if (capability.auth.kind === 'api_key') {
        expect(config.apiKeyEnvVar).toBe(capability.auth.envVar);
      }
      if (capability.auth.kind === 'claude') {
        expect(config.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
      }
      if (capability.auth.kind === 'codex') {
        expect(config.apiKeyEnvVar).toBeUndefined();
      }
    }
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

  it('routes kimi to native Kimi Code API using stable coding model with thinking enabled', () => {
    expect(WORKER_TYPES.kimi.runtime).toBe('claude');
    expect(WORKER_TYPES.kimi.apiBaseUrl).toBe('https://api.kimi.com/coding');
    expect(WORKER_TYPES.kimi.apiKeyEnvVar).toBe('KIMI_API_KEY');
    expect(WORKER_TYPES.kimi.model).toBe('kimi-for-coding');
    expect(WORKER_TYPES.kimi.effort).toBe('high');
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
    expect(WORKER_TYPES['openrouter-free'].model).toBe('google/gemma-4-31b-it:free');
    expect(WORKER_TYPES['openrouter-free'].effort).toBe('high');
    expect(WORKER_TYPES['openrouter-free'].disableExperimentalBetas).toBe(true);
  });

  it('every apiKeyEnvVar referenced by a worker type is a valid WorkerSecrets field', () => {
    const workerSecretsKeys: ReadonlySet<string> = new Set<keyof WorkerSecrets>([
      'ANTHROPIC_API_KEY',
      'LINEAR_API_KEY',
      'SENTRY_AUTH_TOKEN',
      'MINIMAX_API_KEY',
      'MIMO_API_KEY',
      'DASHSCOPE_API_KEY',
      'KIMI_API_KEY',
      'OPENROUTER_API_KEY',
    ]);

    for (const [workerType, config] of Object.entries(WORKER_TYPES)) {
      if (config.apiKeyEnvVar !== undefined) {
        expect(
          workerSecretsKeys.has(config.apiKeyEnvVar),
          `${workerType} references apiKeyEnvVar '${config.apiKeyEnvVar}' which is not in WorkerSecrets`
        ).toBe(true);
      }
    }
  });
});
