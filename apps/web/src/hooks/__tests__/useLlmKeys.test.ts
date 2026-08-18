/**
 * Tests for useLlmKeys hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { IntexAgentModels, LlmProviders } from '@intexuraos/llm-contract';
import { ApiError } from '@/services/apiClient';
import type { LlmKeysResponse } from '@/services/llmKeysApi.types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  user: { sub: 'auth0|user-1' } as { sub?: string } | undefined,
  getLlmKeys: vi.fn(),
  setLlmKey: vi.fn(),
  deleteLlmKey: vi.fn(),
  testLlmKey: vi.fn(),
  updateLlmPreferences: vi.fn(),
  updateIntexAgentModel: vi.fn(),
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
  updateIntexAgentModel: mocks.updateIntexAgentModel,
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
  intexAgentModelSelector: {
    status: 'available',
    explicitModel: null,
    effectiveModel: IntexAgentModels.DeepSeekV4Flash,
    source: 'default_absent',
    revision: 0,
    options: [
      { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
      { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
      { id: IntexAgentModels.Gemini36Flash, label: 'Gemini 3.6 Flash' },
    ],
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

  it('exposes the independent available selector without changing legacy key state', async () => {
    mocks.getLlmKeys.mockResolvedValue(baseKeys);

    const { result } = renderHook(() => useLlmKeys());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.intexAgentModel).toMatchObject({
      availability: 'available',
      writable: true,
      explicitModel: null,
      effectiveModel: IntexAgentModels.DeepSeekV4Flash,
      revision: 0,
    });
    expect(result.current.error).toBeNull();
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

  it('does not publish or start a stale read after unmount while token acquisition is pending', async () => {
    let resolveToken!: (token: string) => void;
    mocks.getAccessToken.mockImplementation(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
    mocks.getLlmKeys.mockResolvedValue(baseKeys);

    const { unmount } = renderHook(() => useLlmKeys());
    unmount();
    await act(async () => { resolveToken('tok'); });

    expect(mocks.getLlmKeys).not.toHaveBeenCalled();
  });

  it('revokes the selector and clears owner-derived keys after a current 404 refresh', async () => {
    mocks.getLlmKeys
      .mockResolvedValueOnce(baseKeys)
      .mockRejectedValueOnce(new ApiError('NOT_FOUND', 'ignored', 404));

    const { result } = renderHook(() => useLlmKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.intexAgentModel.availability).toBe('available');

    await act(async () => { await result.current.refresh(false); });

    expect(result.current.keys).toBeNull();
    expect(result.current.intexAgentModel).toEqual({ availability: 'unavailable', writable: false });
  });

  it('never exposes prior-subject keys or selector during an immediate subject switch or logout', async () => {
    let resolveOldRead!: (value: LlmKeysResponse) => void;
    let resolveNewRead!: (value: LlmKeysResponse) => void;
    mocks.getLlmKeys
      .mockResolvedValueOnce(baseKeys)
      .mockImplementationOnce(() => new Promise<LlmKeysResponse>((resolve) => { resolveOldRead = resolve; }))
      .mockImplementationOnce(() => new Promise<LlmKeysResponse>((resolve) => { resolveNewRead = resolve; }));
    const { result, rerender } = renderHook(() => useLlmKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keys).toEqual(baseKeys);

    void result.current.refresh(false);
    await waitFor(() => expect(mocks.getLlmKeys).toHaveBeenCalledTimes(2));
    mocks.user = { sub: 'auth0|user-2' };
    rerender();

    expect(result.current.keys).toBeNull();
    expect(result.current.defaultModel).toBeNull();
    expect(result.current.fallbackModel).toBeNull();
    expect(result.current.intexAgentModel).toEqual({ availability: 'unavailable', writable: false });
    await act(async () => { resolveOldRead(baseKeys); });
    expect(result.current.keys).toBeNull();

    mocks.user = undefined;
    rerender();
    expect(result.current.keys).toBeNull();
    expect(result.current.defaultModel).toBeNull();
    expect(result.current.fallbackModel).toBeNull();
    expect(result.current.intexAgentModel).toEqual({ availability: 'unavailable', writable: false });
    await act(async () => { resolveNewRead(baseKeys); });
  });

  it('does not let a late default-model rollback or error alter the newly loaded subject', async () => {
    let rejectMutation!: (error: unknown) => void;
    const subjectBKeys: LlmKeysResponse = { ...baseKeys, defaultModel: 'subject-b-default' };
    mocks.getLlmKeys
      .mockResolvedValueOnce(baseKeys)
      .mockResolvedValueOnce(subjectBKeys);
    mocks.updateLlmPreferences.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectMutation = reject; }));
    const { result, rerender } = renderHook(() => useLlmKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let mutation!: Promise<void>;
    await act(async () => { mutation = result.current.setDefaultModel('subject-a-new'); });
    expect(result.current.defaultModel).toBe('subject-a-new');
    mocks.user = { sub: 'auth0|user-2' };
    rerender();
    await waitFor(() => expect(result.current.defaultModel).toBe('subject-b-default'));
    await act(async () => { rejectMutation(new Error('ignored')); });
    await mutation;

    expect(result.current.defaultModel).toBe('subject-b-default');
    expect(result.current.error).toBeNull();
    expect(result.current.savingDefaultModel).toBe(false);
  });

  it('does not write a late API-key test result into the newly loaded subject', async () => {
    let resolveTest!: (value: { status: 'success'; message: string; testedAt: string }) => void;
    const subjectBKeys: LlmKeysResponse = { ...baseKeys, testResults: { ...baseKeys.testResults } };
    mocks.getLlmKeys
      .mockResolvedValueOnce(baseKeys)
      .mockResolvedValueOnce(subjectBKeys);
    mocks.testLlmKey.mockImplementation(() => new Promise((resolve) => { resolveTest = resolve; }));
    const { result, rerender } = renderHook(() => useLlmKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pending = result.current.testKey(LlmProviders.Anthropic);
    await waitFor(() => expect(mocks.testLlmKey).toHaveBeenCalledTimes(1));
    mocks.user = { sub: 'auth0|user-2' };
    rerender();
    await waitFor(() => expect(result.current.keys).toEqual(subjectBKeys));
    await act(async () => { resolveTest({ status: 'success', message: 'ignored', testedAt: '2026-01-01T00:00:00Z' }); });
    await pending;

    expect(result.current.keys?.testResults.anthropic).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('does not publish late setKey or deleteKey failures into the newly loaded subject', async () => {
    let rejectSet!: (error: unknown) => void;
    let rejectDelete!: (error: unknown) => void;
    const subjectBKeys: LlmKeysResponse = { ...baseKeys, defaultModel: 'subject-b-default' };
    mocks.getLlmKeys
      .mockResolvedValueOnce(baseKeys)
      .mockResolvedValueOnce(subjectBKeys);
    mocks.setLlmKey.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectSet = reject; }));
    mocks.deleteLlmKey.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectDelete = reject; }));
    const { result, rerender } = renderHook(() => useLlmKeys());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const setPending = result.current.setKey(LlmProviders.Anthropic, 'key-a');
    const deletePending = result.current.deleteKey(LlmProviders.Google);
    const setHandled = setPending.catch((error: unknown) => error);
    const deleteHandled = deletePending.catch((error: unknown) => error);
    await waitFor(() => expect(mocks.setLlmKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.deleteLlmKey).toHaveBeenCalledTimes(1));
    mocks.user = { sub: 'auth0|user-2' };
    rerender();
    await waitFor(() => expect(result.current.keys).toEqual(subjectBKeys));
    await act(async () => {
      rejectSet(new Error('ignored'));
      rejectDelete(new Error('ignored'));
    });
    await expect(setHandled).resolves.toBeInstanceOf(Error);
    await expect(deleteHandled).resolves.toBeInstanceOf(Error);

    expect(result.current.keys).toEqual(subjectBKeys);
    expect(result.current.error).toBeNull();
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
