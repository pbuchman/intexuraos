import { describe, it, expect } from 'vitest';
import { resolveOpenRouterModelName } from '../openRouterModelNames.js';

describe('resolveOpenRouterModelName', () => {
  it('returns friendly name for known models', () => {
    expect(resolveOpenRouterModelName('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    expect(resolveOpenRouterModelName('openai/gpt-5.4')).toBe('GPT-5.4');
    expect(resolveOpenRouterModelName('qwen/qwen3.5-plus-02-15')).toBe('Qwen 3.5 Plus');
    expect(resolveOpenRouterModelName('xiaomi/mimo-v2-pro')).toBe('MiMo V2 Pro');
  });

  it('returns raw ID for unknown models', () => {
    expect(resolveOpenRouterModelName('some/unknown-model')).toBe('some/unknown-model');
  });

  it('handles empty string', () => {
    expect(resolveOpenRouterModelName('')).toBe('');
  });
});
