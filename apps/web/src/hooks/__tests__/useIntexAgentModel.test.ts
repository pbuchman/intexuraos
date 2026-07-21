/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  IntexAgentModels,
} from '@intexuraos/llm-contract';
import type { IntexAgentModel } from '@intexuraos/llm-contract';
import type {
  IntexAgentModelPatchResponse,
  IntexAgentModelSelectorV1,
} from '@/services/llmKeysApi.types';
import { useIntexAgentModel } from '../useIntexAgentModel.js';
import { ApiError } from '@/services/apiClient.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(model: IntexAgentModel | null, revision: number): IntexAgentModelPatchResponse {
  return {
    explicitModel: model,
    effectiveModel: model ?? DEFAULT_INTEX_AGENT_MODEL,
    source: model === null ? 'default_absent' : 'explicit',
    revision,
  };
}

function selector(
  explicitModel: IntexAgentModel | null = null,
  revision = 0
): Extract<IntexAgentModelSelectorV1, { status: 'available' }> {
  const model = explicitModel ?? DEFAULT_INTEX_AGENT_MODEL;
  return {
    status: 'available',
    explicitModel,
    effectiveModel: model,
    source: explicitModel === null ? 'default_absent' : 'explicit',
    revision,
    options: [
      { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
      { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
      { id: IntexAgentModels.Gemini3FlashPreview, label: 'Gemini 3 Flash Preview' },
    ],
  };
}

describe('useIntexAgentModel', () => {
  it('keeps reset distinct from explicit DeepSeek and PATCHes DeepSeek at the confirmed revision', async () => {
    const update = vi.fn<
      (token: string, userId: string, model: typeof IntexAgentModels.DeepSeekV4Flash | null, revision: number, signal?: AbortSignal) => Promise<IntexAgentModelPatchResponse>
    >().mockResolvedValue({
      explicitModel: IntexAgentModels.DeepSeekV4Flash,
      effectiveModel: IntexAgentModels.DeepSeekV4Flash,
      source: 'explicit',
      revision: 1,
    });
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject',
      selector: selector(),
      getAccessToken: async () => 'token',
      getLlmKeys: async () => {
        throw new Error('not used');
      },
      updateIntexAgentModel: update,
    }));

    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    expect(result.current.explicitModel).toBeNull();
    expect(result.current.effectiveModel).toBe(IntexAgentModels.DeepSeekV4Flash);

    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation: Promise<string> = Promise.resolve('disposed');
    await act(async () => {
      mutation = result.current.setIntexAgentModel(IntexAgentModels.DeepSeekV4Flash);
    });
    const outcome = await mutation;

    expect(outcome).toBe('applied');
    expect(update).toHaveBeenCalledWith(
      'token',
      'auth0|subject',
      IntexAgentModels.DeepSeekV4Flash,
      0,
      expect.any(AbortSignal)
    );
  });

  it('serializes rapid A then B, keeps B visible, and settles A superseded', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const second = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    expect(result.current.availability === 'available' && result.current.explicitModel).toBe(IntexAgentModels.Gemini3FlashPreview);
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[3]).toBe(1);
    await act(async () => { second.resolve(response(IntexAgentModels.Gemini3FlashPreview, 2)); });

    await expect(a).resolves.toBe('superseded');
    await expect(b).resolves.toBe('applied');
    await waitFor(() => expect(result.current.availability === 'available' && result.current.revision).toBe(2));
  });

  it('coalesces A then B then A without a duplicate A PATCH', async () => {
    const pending = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let firstA!: Promise<string>;
    let b!: Promise<string>;
    let secondA!: Promise<string>;
    await act(async () => { firstA = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { secondA = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(b).resolves.toBe('superseded');
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
    await expect(firstA).resolves.toBe('applied');
    await expect(secondA).resolves.toBe('applied');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('settles every duplicate active and queued waiter exactly once', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const second = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let firstA!: Promise<string>;
    let secondA!: Promise<string>;
    let firstB!: Promise<string>;
    let secondB!: Promise<string>;
    await act(async () => { firstA = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { secondA = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await act(async () => { firstB = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { secondB = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { first.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(response(IntexAgentModels.Gemini3FlashPreview, 2)); });
    await expect(firstA).resolves.toBe('superseded');
    await expect(secondA).resolves.toBe('superseded');
    await expect(firstB).resolves.toBe('applied');
    await expect(secondB).resolves.toBe('applied');
  });

  it('collapses A then B then C to A and C only', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const second = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    let c!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { c = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.DeepSeekV4Flash) : Promise.resolve('disposed'); });
    await expect(b).resolves.toBe('superseded');
    await act(async () => { first.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[2]).toBe(IntexAgentModels.DeepSeekV4Flash);
    await act(async () => { second.resolve(response(IntexAgentModels.DeepSeekV4Flash, 2)); });
    await expect(a).resolves.toBe('superseded');
    await expect(c).resolves.toBe('applied');
  });

  it('uses a higher same-subject GET revision for the next queued dispatch', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const second = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: async () => 'token',
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
      }),
      { initialProps: { currentSelector: selector() as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    rerender({ currentSelector: selector(null, 5) });
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { first.reject(new Error('failure')); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[3]).toBe(5);
    await act(async () => { second.resolve(response(IntexAgentModels.Gemini3FlashPreview, 6)); });
    await expect(a).resolves.toBe('superseded');
    await expect(b).resolves.toBe('applied');
  });

  it('ignores equal-conflicting and lower same-subject GET confirmations', async () => {
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: async () => 'token',
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: vi.fn(),
      }),
      { initialProps: { currentSelector: selector(null, 5) as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    rerender({ currentSelector: selector(IntexAgentModels.Gemini3FlashPreview, 5) });
    rerender({ currentSelector: selector(IntexAgentModels.MiniMaxM3, 4) });
    await waitFor(() => expect(result.current.availability === 'available' && result.current.revision).toBe(5));
    expect(result.current.availability === 'available' && result.current.explicitModel).toBeNull();
  });

  it('rolls back only selector state after an ordinary mutation failure', async () => {
    const update = vi.fn().mockRejectedValue(new Error('private failure'));
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    await waitFor(() => expect(result.current.availability === 'available' && result.current.explicitModel).toBeNull());
    expect(result.current.availability === 'available' && result.current.intexAgentModelError).toBe('Failed to save Intex Agent model');
  });

  it.each([
    ['mismatched persisted intent', selector(null, 5), response(IntexAgentModels.Gemini3FlashPreview, 6)],
    ['lower revision', selector(null, 5), response(IntexAgentModels.MiniMaxM3, 4)],
    ['equal revision with another confirmed intent', selector(null, 5), response(IntexAgentModels.MiniMaxM3, 5)],
  ])('rejects a %s PATCH response without advancing confirmation', async (_label, initial, patchResponse) => {
    const update = vi.fn().mockResolvedValue(patchResponse);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: initial, getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    expect(result.current.availability === 'available' && result.current.revision).toBe(5);
    expect(result.current.availability === 'available' && result.current.explicitModel).toBeNull();
  });

  it('performs one 409 refetch and retries the current intent at the refetched revision', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 5 }))
      .mockResolvedValueOnce(response(IntexAgentModels.MiniMaxM3, 6));
    const getLlmKeys = vi.fn().mockResolvedValue({
      intexAgentModelSelector: selector(null, 5),
    } as LlmKeysResponse);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('applied');
    expect(getLlmKeys).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[3]).toBe(5);
  });

  it.each([
    ['missing', undefined],
    ['string', '1'],
    ['fractional', 1.5],
    ['negative', -1],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ])('rolls back the recovery owner without a refetch when conflict revision is %s', async (_label, revision) => {
    const update = vi.fn().mockRejectedValue(
      new ApiError('CONFLICT', 'ignored', 409, { currentRevision: revision })
    );
    const getLlmKeys = vi.fn();
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    expect(getLlmKeys).not.toHaveBeenCalled();
  });

  it('settles the recovery owner rolled_back before unavailable recovery revokes capability', async () => {
    const update = vi.fn().mockRejectedValue(
      new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 1 })
    );
    const getLlmKeys = vi.fn().mockResolvedValue({
      intexAgentModelSelector: { status: 'unavailable' },
    } as LlmKeysResponse);
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    await waitFor(() => expect(result.current).toEqual({ availability: 'unavailable', writable: false }));
  });

  it.each([
    ['below-floor refetch', async (): Promise<LlmKeysResponse> => ({ intexAgentModelSelector: selector(null, 0) } as LlmKeysResponse)],
    ['failed refetch', async (): Promise<LlmKeysResponse> => { throw new Error('ignored'); }],
  ])('rolls back without retry after a %s', async (_label, getLlmKeys) => {
    const update = vi.fn().mockRejectedValue(
      new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 1 })
    );
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rolls back after the one permitted retry fails without another recovery', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 1 }))
      .mockRejectedValueOnce(new Error('ignored'));
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => ({ intexAgentModelSelector: selector(null, 1) } as LlmKeysResponse), updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('rolled_back');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('retries a recovery owner from the highest confirmed revision, not a stale refetch', async () => {
    const refetch = deferred<LlmKeysResponse>();
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 5 }))
      .mockResolvedValueOnce(response(IntexAgentModels.MiniMaxM3, 11));
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: async () => 'token',
        getLlmKeys: async () => refetch.promise, updateIntexAgentModel: update,
      }),
      { initialProps: { currentSelector: selector() as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    rerender({ currentSelector: selector(IntexAgentModels.Gemini3FlashPreview, 10) });
    await act(async () => { refetch.resolve({ intexAgentModelSelector: selector(IntexAgentModels.MiniMaxM3, 7) } as LlmKeysResponse); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[3]).toBe(10);
    await expect(mutation).resolves.toBe('applied');
  });

  it('supersedes token-pending A when a higher GET confirms A and B is queued', async () => {
    const token = deferred<string>();
    const update = vi.fn().mockResolvedValue(response(IntexAgentModels.Gemini3FlashPreview, 6));
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: () => token.promise,
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
      }),
      { initialProps: { currentSelector: selector() as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    rerender({ currentSelector: selector(IntexAgentModels.MiniMaxM3, 5) });
    await act(async () => { token.resolve('token'); });
    await expect(a).resolves.toBe('superseded');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toBe(IntexAgentModels.Gemini3FlashPreview);
    await expect(b).resolves.toBe('applied');
  });

  it('does not send token-pending A when a higher GET already confirms queued B', async () => {
    const token = deferred<string>();
    const update = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: () => token.promise,
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
      }),
      { initialProps: { currentSelector: selector() as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    rerender({ currentSelector: selector(IntexAgentModels.Gemini3FlashPreview, 5) });
    await act(async () => { token.resolve('token'); });
    await expect(a).resolves.toBe('superseded');
    await expect(b).resolves.toBe('applied');
    expect(update).not.toHaveBeenCalled();
  });

  it('reassigns 409 recovery from B to C while the refetch is pending', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const refetch = deferred<LlmKeysResponse>();
    const update = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(response(IntexAgentModels.DeepSeekV4Flash, 2));
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => refetch.promise, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    let c!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { first.reject(new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 1 })); });
    await act(async () => { c = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.DeepSeekV4Flash) : Promise.resolve('disposed'); });
    await expect(a).resolves.toBe('superseded');
    await expect(b).resolves.toBe('superseded');
    await act(async () => { refetch.resolve({ intexAgentModelSelector: selector(null, 1) } as LlmKeysResponse); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[2]).toBe(IntexAgentModels.DeepSeekV4Flash);
    await expect(c).resolves.toBe('applied');
  });

  it('does not let a retry success publish over a newer queued C intent', async () => {
    const first = deferred<IntexAgentModelPatchResponse>();
    const retry = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce(response(IntexAgentModels.DeepSeekV4Flash, 3));
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => ({ intexAgentModelSelector: selector(null, 1) } as LlmKeysResponse), updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let a!: Promise<string>;
    let b!: Promise<string>;
    let c!: Promise<string>;
    await act(async () => { a = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { b = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.Gemini3FlashPreview) : Promise.resolve('disposed'); });
    await act(async () => { first.reject(new ApiError('CONFLICT', 'ignored', 409, { currentRevision: 1 })); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await act(async () => { c = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.DeepSeekV4Flash) : Promise.resolve('disposed'); });
    await act(async () => { retry.resolve(response(IntexAgentModels.Gemini3FlashPreview, 2)); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update.mock.calls[2]?.[2]).toBe(IntexAgentModels.DeepSeekV4Flash);
    await expect(a).resolves.toBe('superseded');
    await expect(b).resolves.toBe('superseded');
    await expect(c).resolves.toBe('applied');
  });

  it('disposes before token acquisition completes without sending a PATCH', async () => {
    const token = deferred<string>();
    const update = vi.fn();
    const { result, unmount } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: () => token.promise,
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    unmount();
    await expect(mutation).resolves.toBe('disposed');
    await act(async () => { token.resolve('token'); });
    expect(update).not.toHaveBeenCalled();
  });

  it('disposes on a mutation 404 without rolling stale selector state back into view', async () => {
    const update = vi.fn().mockRejectedValue(new ApiError('NOT_FOUND', 'ignored', 404));
    const { result } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await expect(mutation).resolves.toBe('disposed');
    await waitFor(() => expect(result.current).toEqual({ availability: 'unavailable', writable: false }));
  });

  it('aborts a pending PATCH and settles its caller disposed on unmount', async () => {
    const pending = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useIntexAgentModel({
      subject: 'auth0|subject', selector: selector(), getAccessToken: async () => 'token',
      getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
    }));
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const signal = update.mock.calls[0]?.[4] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await expect(mutation).resolves.toBe('disposed');
    await act(async () => { pending.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
  });

  it('disposes the old pump on subject switch before a late mutation can publish', async () => {
    const pending = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ subject }) => useIntexAgentModel({
        subject, selector: selector(), getAccessToken: async () => 'token',
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
      }),
      { initialProps: { subject: 'auth0|first' } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const oldSignal = update.mock.calls[0]?.[4] as AbortSignal;

    rerender({ subject: 'auth0|second' });
    await waitFor(() => expect(result.current.availability).toBe('available'));
    expect(oldSignal.aborted).toBe(true);
    await expect(mutation).resolves.toBe('disposed');
    await act(async () => { pending.resolve(response(IntexAgentModels.MiniMaxM3, 1)); });
    expect(result.current.availability === 'available' && result.current.explicitModel).toBeNull();
  });

  it('revokes capability and disposes a pending mutation on available-to-unavailable reconciliation', async () => {
    const pending = deferred<IntexAgentModelPatchResponse>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ currentSelector }) => useIntexAgentModel({
        subject: 'auth0|subject', selector: currentSelector, getAccessToken: async () => 'token',
        getLlmKeys: async () => { throw new Error('not used'); }, updateIntexAgentModel: update,
      }),
      { initialProps: { currentSelector: selector() as IntexAgentModelSelectorV1 } }
    );
    await waitFor(() => expect(result.current.availability).toBe('available'));
    if (result.current.availability !== 'available') throw new Error('selector unavailable');
    let mutation!: Promise<string>;
    await act(async () => { mutation = result.current.availability === 'available'
      ? result.current.setIntexAgentModel(IntexAgentModels.MiniMaxM3) : Promise.resolve('disposed'); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const signal = update.mock.calls[0]?.[4] as AbortSignal;

    rerender({ currentSelector: { status: 'unavailable' } });
    await waitFor(() => expect(result.current).toEqual({ availability: 'unavailable', writable: false }));
    expect(signal.aborted).toBe(true);
    await expect(mutation).resolves.toBe('disposed');
  });
});
