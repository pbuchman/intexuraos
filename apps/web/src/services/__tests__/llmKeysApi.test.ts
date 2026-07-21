/**
 * Tests for llmKeysApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLlmKeys,
  setLlmKey,
  deleteLlmKey,
  updateIntexAgentModel,
  updateLlmPreferences,
  testLlmKey,
} from '../llmKeysApi.js';
import type { LlmKeysResponse } from '../llmKeysApi.types.js';
import { IntexAgentModels, LlmProviders } from '@intexuraos/llm-contract';
import { ApiError } from '../apiClient.js';

vi.mock('../apiClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apiClient.js')>()),
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
  intexAgentModelSelector: {
    status: 'available',
    explicitModel: null,
    effectiveModel: IntexAgentModels.DeepSeekV4Flash,
    source: 'default_absent',
    revision: 0,
    options: [
      { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
      { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
      { id: IntexAgentModels.Gemini3FlashPreview, label: 'Gemini 3 Flash Preview' },
    ],
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
      expect(result).toEqual(sampleKeys);
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

  describe('updateIntexAgentModel', () => {
    it('PATCHes only the selector intent and expected revision to an encoded settings path', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({
        explicitModel: IntexAgentModels.MiniMaxM3,
        effectiveModel: IntexAgentModels.MiniMaxM3,
        source: 'explicit',
        revision: 8,
      });

      await updateIntexAgentModel(
        TOKEN,
        'auth0|user',
        IntexAgentModels.MiniMaxM3,
        7
      );

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/users/auth0%7Cuser/settings');
      expect(call?.[3]).toEqual({
        method: 'PATCH',
        body: {
          intexAgentModel: IntexAgentModels.MiniMaxM3,
          expectedRevision: 7,
        },
      });
    });

    it('includes only the caller signal in request options when supplied', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const signal = new AbortController().signal;
      vi.mocked(apiRequest).mockResolvedValue({
        explicitModel: null,
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'default_absent',
        revision: 8,
      });

      await updateIntexAgentModel(TOKEN, USER, null, 7, signal);

      expect(vi.mocked(apiRequest).mock.calls[0]?.[3]).toEqual({
        method: 'PATCH',
        body: { intexAgentModel: null, expectedRevision: 7 },
        signal,
      });
    });

    it.each([
      ['extra response key', { explicitModel: null, effectiveModel: IntexAgentModels.DeepSeekV4Flash, source: 'default_absent', revision: 1, extra: true }],
      ['noncanonical response model', { explicitModel: 'deepseek/deepseek-v4-flash', effectiveModel: 'deepseek/deepseek-v4-flash', source: 'explicit', revision: 1 }],
      ['unsafe response revision', { explicitModel: null, effectiveModel: IntexAgentModels.DeepSeekV4Flash, source: 'default_absent', revision: Number.MAX_SAFE_INTEGER + 1 }],
      ['impossible response source', { explicitModel: null, effectiveModel: IntexAgentModels.DeepSeekV4Flash, source: 'explicit', revision: 1 }],
    ])('rejects %s as a static malformed response', async (_label, payload) => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(payload);

      await expect(updateIntexAgentModel(TOKEN, USER, null, 0)).rejects.toMatchObject<ApiError>({
        code: 'MALFORMED_RESPONSE', status: 502,
      });
    });
  });

  describe('strict selector decoder', () => {
    it('accepts the exact unavailable arm', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({
        ...sampleKeys,
        intexAgentModelSelector: { status: 'unavailable' },
      });

      await expect(getLlmKeys(TOKEN, USER)).resolves.toMatchObject({
        intexAgentModelSelector: { status: 'unavailable' },
      });
    });

    it.each([
      ['missing selector key', ((): Record<string, unknown> => { const { options: _options, ...rest } = sampleKeys.intexAgentModelSelector as Extract<typeof sampleKeys.intexAgentModelSelector, { status: 'available' }>; return rest; })()],
      ['extra selector key', { ...sampleKeys.intexAgentModelSelector, extra: true }],
      ['raw selector model ID', { ...sampleKeys.intexAgentModelSelector, explicitModel: 'deepseek/deepseek-v4-flash', effectiveModel: 'deepseek/deepseek-v4-flash', source: 'explicit' }],
      ['unsafe selector revision', { ...sampleKeys.intexAgentModelSelector, revision: Number.MAX_SAFE_INTEGER + 1 }],
      ['wrong selector tuple order', { ...sampleKeys.intexAgentModelSelector, options: [...sampleKeys.intexAgentModelSelector.options].reverse() }],
      ['wrong selector label', { ...sampleKeys.intexAgentModelSelector, options: [{ ...sampleKeys.intexAgentModelSelector.options[0], label: 'Wrong' }, ...sampleKeys.intexAgentModelSelector.options.slice(1)] }],
      ['impossible absent source', { ...sampleKeys.intexAgentModelSelector, explicitModel: null, effectiveModel: IntexAgentModels.MiniMaxM3, source: 'default_absent' }],
    ])('rejects %s as a static malformed response', async (_label, selectorPayload) => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ ...sampleKeys, intexAgentModelSelector: selectorPayload });

      await expect(getLlmKeys(TOKEN, USER)).rejects.toMatchObject<ApiError>({
        code: 'MALFORMED_RESPONSE', status: 502,
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
