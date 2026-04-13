import { describe, it, expect } from 'vitest';
import { resolveOpenRouterModelName } from '../openRouterModelNames.js';

describe('resolveOpenRouterModelName', () => {
  it('returns friendly name for curated allowlist models', () => {
    expect(resolveOpenRouterModelName('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    expect(resolveOpenRouterModelName('openai/gpt-5.4')).toBe('GPT-5.4');
    expect(resolveOpenRouterModelName('qwen/qwen3.5-plus-02-15')).toBe('Qwen 3.5 Plus');
    expect(resolveOpenRouterModelName('xiaomi/mimo-v2-pro')).toBe('MiMo V2 Pro');
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
