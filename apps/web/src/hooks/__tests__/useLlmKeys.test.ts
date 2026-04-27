/**
 * Tests for useLlmKeys hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { LlmKeysResponse } from '@/services/llmKeysApi.types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  user: { sub: 'auth0|user-1' } as { sub?: string } | undefined,
  getLlmKeys: vi.fn(),
  setLlmKey: vi.fn(),
  deleteLlmKey: vi.fn(),
  testLlmKey: vi.fn(),
  updateLlmPreferences: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    user: { sub?: string } | undefined;
    getAccessToken: typeof mocks.getAccessToken;
  } => ({
    user: mocks.user,
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/llmKeysApi', () => ({
  getLlmKeys: mocks.getLlmKeys,
  setLlmKey: mocks.setLlmKey,
  deleteLlmKey: mocks.deleteLlmKey,
  testLlmKey: mocks.testLlmKey,
  updateLlmPreferences: mocks.updateLlmPreferences,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

import { useLlmKeys } from '../useLlmKeys.js';

const baseKeys: LlmKeysResponse = {
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

describe('useLlmKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { sub: 'auth0|user-1' };
    mocks.getAccessToken.mockResolvedValue('tok');
  });

  it('happy path: loads keys on mount', async () => {
    mocks.getLlmKeys.mockResolvedValue(baseKeys);

    const { result } = renderHook(() => useLlmKeys());

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.keys).toBe(baseKeys);
    expect(result.current.defaultModel).toBe('gpt-4');
    expect(mocks.getLlmKeys).toHaveBeenCalledWith('tok', 'auth0|user-1');
  });

  it('error path: stores message in error state', async () => {
    mocks.getLlmKeys.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useLlmKeys());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe('boom');
    expect(result.current.keys).toBeNull();
  });

  it('refetches after setKey mutation', async () => {
    mocks.getLlmKeys.mockResolvedValue(baseKeys);
    mocks.setLlmKey.mockResolvedValue({ provider: LlmProviders.Anthropic, masked: 'sk-...' });

    const { result } = renderHook(() => useLlmKeys());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.setKey(LlmProviders.Anthropic, 'sk-secret');
    });

    expect(mocks.setLlmKey).toHaveBeenCalledWith('tok', 'auth0|user-1', {
      provider: LlmProviders.Anthropic,
      apiKey: 'sk-secret',
    });
    expect(mocks.getLlmKeys).toHaveBeenCalledTimes(2);
  });

  it('skips loading when user is not authenticated', async () => {
    mocks.user = undefined;

    const { result } = renderHook(() => useLlmKeys());

    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(mocks.getLlmKeys).not.toHaveBeenCalled();
  });

  it('setDefaultModel performs optimistic update and reverts on error', async () => {
    mocks.getLlmKeys.mockResolvedValue(baseKeys);
    mocks.updateLlmPreferences.mockRejectedValue(new Error('save failed'));

    const { result } = renderHook(() => useLlmKeys());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.setDefaultModel('claude-3-7');
    });

    // Should have reverted on error
    expect(result.current.defaultModel).toBe('gpt-4');
    expect(result.current.error).toBe('save failed');
  });
});
