/**
 * Tests for llmKeysApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLlmKeys,
  setLlmKey,
  deleteLlmKey,
  updateLlmPreferences,
  testLlmKey,
} from '../llmKeysApi.js';
import type { LlmKeysResponse } from '../llmKeysApi.types.js';
import { LlmProviders } from '@intexuraos/llm-contract';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    authServiceUrl: 'https://auth.test',
  },
}));

const TOKEN = 'tok';
const USER = 'user-1';

const sampleKeys: LlmKeysResponse = {
  defaultModel: 'gpt-4',
  fallbackModel: null,
  google: null,
  openai: 'sk-...abcd',
  anthropic: null,
  perplexity: null,
  openrouter: null,
  testResults: {
    google: null,
    openai: null,
    anthropic: null,
    perplexity: null,
    openrouter: null,
  },
};

describe('llmKeysApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLlmKeys (happy path)', () => {
    it('GETs /users/:uid/settings/llm-keys', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleKeys);

      const result = await getLlmKeys(TOKEN, USER);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://auth.test');
      expect(call?.[1]).toBe(`/users/${USER}/settings/llm-keys`);
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toBe(sampleKeys);
    });
  });

  describe('setLlmKey', () => {
    it('PATCHes the key body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ provider: LlmProviders.OpenAI, masked: 'sk-...x' });

      await setLlmKey(TOKEN, USER, { provider: LlmProviders.OpenAI, apiKey: 'sk-real' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(`/users/${USER}/settings/llm-keys`);
      expect(call?.[3]).toEqual({
        method: 'PATCH',
        body: { provider: LlmProviders.OpenAI, apiKey: 'sk-real' },
      });
    });
  });

  describe('deleteLlmKey', () => {
    it('DELETEs /users/:uid/settings/llm-keys/:provider', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ deleted: true });

      await deleteLlmKey(TOKEN, USER, LlmProviders.Anthropic);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(`/users/${USER}/settings/llm-keys/${LlmProviders.Anthropic}`);
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('updateLlmPreferences', () => {
    it('PATCHes /users/:uid/settings with defaultModel only when fallback is undefined', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ defaultModel: 'gpt-4', fallbackModel: null });

      await updateLlmPreferences(TOKEN, USER, 'gpt-4');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(`/users/${USER}/settings`);
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { defaultModel: 'gpt-4' } });
    });

    it('includes fallbackModel when explicitly provided (including null)', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ defaultModel: 'gpt-4', fallbackModel: null });

      await updateLlmPreferences(TOKEN, USER, 'gpt-4', null);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[3]).toEqual({
        method: 'PATCH',
        body: { defaultModel: 'gpt-4', fallbackModel: null },
      });
    });
  });

  describe('testLlmKey', () => {
    it('POSTs to /users/:uid/settings/llm-keys/:provider/test', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({
        status: 'success', message: 'ok', testedAt: '2026-04-26T00:00:00Z',
      });

      await testLlmKey(TOKEN, USER, LlmProviders.Google);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(`/users/${USER}/settings/llm-keys/${LlmProviders.Google}/test`);
      expect(call?.[3]).toEqual({ method: 'POST' });
    });
  });

  describe('error path', () => {
    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('unauthorized'));

      await expect(getLlmKeys(TOKEN, USER)).rejects.toThrow('unauthorized');
    });
  });
});
