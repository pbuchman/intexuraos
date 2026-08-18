import { describe, it, expect } from 'vitest';
import {
  resolveOpenRouterModelName,
  resolveStoredResearchModel,
} from '../openRouterModelNames.js';

describe('resolveOpenRouterModelName', () => {
  it('returns friendly name for curated allowlist models', () => {
    expect(resolveOpenRouterModelName('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    expect(resolveOpenRouterModelName('openai/gpt-5.4')).toBe('GPT-5.4');
    expect(resolveOpenRouterModelName('qwen/qwen3.5-plus-02-15')).toBe('Qwen 3.5 Plus');
    expect(resolveOpenRouterModelName('xiaomi/mimo-v2.5-pro')).toBe('MiMo V2.5 Pro');
    expect(resolveOpenRouterModelName('x-ai/grok-4.3')).toBe('Grok 4.3');
  });

  it('returns friendly name for default allowlist models', () => {
    expect(resolveOpenRouterModelName('google/gemma-4-31b-it')).toBe('Gemma 4 31B IT');
    expect(resolveOpenRouterModelName('qwen/qwen3.6-plus')).toBe('Qwen 3.6 Plus');
    expect(resolveOpenRouterModelName('nvidia/nemotron-3-super-120b-a12b')).toBe('Nemotron 3 Super 120B');
  });

  it('returns raw ID for unknown models', () => {
    expect(resolveOpenRouterModelName('some/unknown-model')).toBe('some/unknown-model');
  });

  it('strips :online suffix and resolves friendly name', () => {
    expect(resolveOpenRouterModelName('anthropic/claude-sonnet-4.6:online')).toBe('Claude Sonnet 4.6');
    expect(resolveOpenRouterModelName('qwen/qwen3.5-flash-02-23:online')).toBe('Qwen 3.5 Flash');
  });

  it('returns raw ID for unknown models with :online suffix', () => {
    expect(resolveOpenRouterModelName('some/unknown-model:online')).toBe('some/unknown-model:online');
  });

  it('strips :free suffix and resolves friendly name', () => {
    expect(resolveOpenRouterModelName('google/gemma-4-31b-it:free')).toBe('Gemma 4 31B IT');
    expect(resolveOpenRouterModelName('nvidia/nemotron-3-super-120b-a12b:free')).toBe('Nemotron 3 Super 120B');
  });

  it('returns raw ID for unknown models with :free suffix', () => {
    expect(resolveOpenRouterModelName('some/unknown-model:free')).toBe('some/unknown-model:free');
  });

  it('handles empty string', () => {
    expect(resolveOpenRouterModelName('')).toBe('');
  });
});

describe('resolveStoredResearchModel', () => {
  it('marks an active OpenRouter model as available while preserving its exact stored ID', () => {
    expect(
      resolveStoredResearchModel({
        modelId: 'or:anthropic/claude-sonnet-4.6',
        storedProvider: 'openrouter',
        availableModelIds: ['anthropic/claude-sonnet-4.6'],
      }),
    ).toEqual({
      id: 'or:anthropic/claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      provider: 'openrouter',
      author: 'Anthropic',
      available: true,
    });
  });

  it('keeps a retired OpenRouter model visible and unavailable', () => {
    expect(
      resolveStoredResearchModel({
        modelId: 'or:google/gemini-3-flash-preview',
        storedProvider: 'openrouter',
        availableModelIds: ['google/gemini-3.6-flash'],
      }),
    ).toEqual({
      id: 'or:google/gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      provider: 'openrouter',
      author: 'Google',
      available: false,
    });
  });

  it('keeps retired Grok 4.1 Fast exact while Grok 4.3 is active', () => {
    expect(
      resolveStoredResearchModel({
        modelId: 'or:x-ai/grok-4.1-fast',
        storedProvider: 'openrouter',
        availableModelIds: ['x-ai/grok-4.3'],
      }),
    ).toEqual({
      id: 'or:x-ai/grok-4.1-fast',
      name: 'Grok 4.1 Fast',
      provider: 'openrouter',
      author: 'xAI',
      available: false,
    });
  });

  it('preserves an unknown historical model and its stored provider', () => {
    expect(
      resolveStoredResearchModel({
        modelId: 'legacy/model-that-no-longer-exists',
        storedProvider: 'legacy-provider',
        availableModelIds: [],
      }),
    ).toEqual({
      id: 'legacy/model-that-no-longer-exists',
      name: 'Model That No Longer Exists',
      provider: 'legacy-provider',
      author: null,
      available: false,
    });
  });

  it('prefers exact live catalog metadata for an active OpenRouter model', () => {
    expect(
      resolveStoredResearchModel({
        modelId: 'or:deepseek/deepseek-v4-flash',
        availableModelIds: ['deepseek/deepseek-v4-flash'],
        availableModels: [
          {
            id: 'deepseek/deepseek-v4-flash',
            name: 'DeepSeek V4 Flash (live)',
            provider: 'DeepSeek Live',
          },
        ],
      }),
    ).toEqual({
      id: 'or:deepseek/deepseek-v4-flash',
      name: 'DeepSeek V4 Flash (live)',
      provider: 'DeepSeek Live',
      author: 'DeepSeek Live',
      available: true,
    });
  });
});
