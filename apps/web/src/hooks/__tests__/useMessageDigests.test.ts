/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/apiClient.js';
import type {
  CreateMessageDigestInput,
  MessageDigestDefinition,
  MessageDigestErasure,
  MessageDigestRun,
  MessageDigestRunPreparation,
} from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  authSubject: 'account-a',
  getAccessToken: vi.fn(),
  listMessageDigests: vi.fn(),
  getMessageDigest: vi.fn(),
  createMessageDigest: vi.fn(),
  updateMessageDigest: vi.fn(),
  prepareMessageDigestRun: vi.fn(),
  confirmMessageDigestRun: vi.fn(),
  retryMessageDigestRun: vi.fn(),
  getMessageDigestRun: vi.fn(),
  listMessageDigestRuns: vi.fn(),
  deleteMessageDigest: vi.fn(),
  getMessageDigestErasure: vi.fn(),
  resumeMessageDigestErasure: vi.fn(),
  getMessageDigestDeliveryReadiness: vi.fn(),
  getPrivateWhatsAppAccount: vi.fn(),
  newRequestId: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    getAccessToken: typeof mocks.getAccessToken;
    user: { sub: string };
  } => ({
    getAccessToken: mocks.getAccessToken,
    user: { sub: mocks.authSubject },
  }),
}));

vi.mock('@/services/messageDigestsApi', () => ({
  listMessageDigests: mocks.listMessageDigests,
  getMessageDigest: mocks.getMessageDigest,
  createMessageDigest: mocks.createMessageDigest,
  updateMessageDigest: mocks.updateMessageDigest,
  prepareMessageDigestRun: mocks.prepareMessageDigestRun,
  confirmMessageDigestRun: mocks.confirmMessageDigestRun,
  retryMessageDigestRun: mocks.retryMessageDigestRun,
  getMessageDigestRun: mocks.getMessageDigestRun,
  listMessageDigestRuns: mocks.listMessageDigestRuns,
  deleteMessageDigest: mocks.deleteMessageDigest,
  getMessageDigestErasure: mocks.getMessageDigestErasure,
  resumeMessageDigestErasure: mocks.resumeMessageDigestErasure,
  getMessageDigestDeliveryReadiness: mocks.getMessageDigestDeliveryReadiness,
}));

vi.mock('@/services/requestId', () => ({
  newRequestId: mocks.newRequestId,
}));

vi.mock('@/services/whatsappApi', () => ({
  getPrivateWhatsAppAccount: mocks.getPrivateWhatsAppAccount,
}));

import {
  MESSAGE_DIGEST_CREATE_REQUEST_KEY,
  MESSAGE_DIGEST_ERASURE_REQUEST_KEY,
  MESSAGE_DIGEST_RUN_REQUEST_KEY,
  MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY,
  useMessageDigestCommands,
  useMessageDigestDefinition,
  useMessageDigestDeletion,
  useMessageDigestDeliveryReadiness,
  useMessageDigestHistory,
  useMessageDigestList,
  useMessageDigestRun,
  useMessageDigestSourceAvailability,
} from '../useMessageDigests.js';

describe('useMessageDigestDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('loads one owner-scoped definition and preserves it during refresh', async () => {
    const refreshed = deferred<MessageDigestDefinition>();
    mocks.getMessageDigest
      .mockResolvedValueOnce(definition('definition-a'))
      .mockReturnValueOnce(refreshed.promise);
    const { result } = renderHook(() => useMessageDigestDefinition('definition-a'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.definition?.id).toBe('definition-a');
    expect(mocks.getMessageDigest).toHaveBeenCalledWith(
      'test-token',
      'definition-a',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        refreshToken: mocks.getAccessToken,
      })
    );

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.definition?.id).toBe('definition-a');

    refreshed.resolve({ ...definition('definition-a'), revision: 2 });
    await act(async () => await refreshPromise);
    expect(result.current.definition?.revision).toBe(2);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('maps every 404 to an owner-safe not-found state', async () => {
    mocks.getMessageDigest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Secret foreign definition details', 404)
    );
    const { result } = renderHook(() => useMessageDigestDefinition('definition-private'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.definition).toBeNull();
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain('Secret foreign definition details');
  });

  it('rejects a stale response after the definition ID changes', async () => {
    const stale = deferred<MessageDigestDefinition>();
    mocks.getMessageDigest
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(definition('definition-b'));
    const { result, rerender } = renderHook(
      ({ definitionId }) => useMessageDigestDefinition(definitionId),
      { initialProps: { definitionId: 'definition-a' } }
    );

    await waitFor(() => expect(mocks.getMessageDigest).toHaveBeenCalledTimes(1));
    rerender({ definitionId: 'definition-b' });
    await waitFor(() => expect(result.current.definition?.id).toBe('definition-b'));
    stale.resolve(definition('definition-a'));
    await act(async () => await stale.promise);

    expect(result.current.definition?.id).toBe('definition-b');
    expect(mocks.getMessageDigest.mock.calls[0]?.[2]?.signal.aborted).toBe(true);
  });

  it('adopts an authoritative mutation response and rejects an older in-flight refresh', async () => {
    const staleRefresh = deferred<MessageDigestDefinition>();
    mocks.getMessageDigest
      .mockResolvedValueOnce(definition('definition-a'))
      .mockReturnValueOnce(staleRefresh.promise);
    const { result } = renderHook(() => useMessageDigestDefinition('definition-a'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    const authoritative = { ...definition('definition-a'), revision: 9 };
    act(() => {
      result.current.adoptDefinition(authoritative);
    });

    expect(result.current.definition).toEqual(authoritative);
    expect(result.current.isRefreshing).toBe(false);
    expect(mocks.getMessageDigest.mock.calls[1]?.[2]?.signal.aborted).toBe(true);
    staleRefresh.resolve({ ...definition('definition-a'), revision: 2 });
    await act(async () => await refreshPromise);
    expect(result.current.definition?.revision).toBe(9);
  });

  it('reports refresh success without discarding the current definition on failure', async () => {
    mocks.getMessageDigest
      .mockResolvedValueOnce(definition('definition-a'))
      .mockRejectedValueOnce(new Error('Synthetic latest-version failure'))
      .mockResolvedValueOnce({ ...definition('definition-a'), revision: 3 });
    const { result } = renderHook(() => useMessageDigestDefinition('definition-a'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let failed = true;
    await act(async () => {
      failed = await result.current.refreshWithResult();
    });
    expect(failed).toBe(false);
    expect(result.current.definition?.revision).toBe(1);
    expect(result.current.error).toBe('Synthetic latest-version failure');

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.refreshWithResult();
    });
    expect(succeeded).toBe(true);
    expect(result.current.definition?.revision).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('preserves the current definition and owner-safe state when conflict refresh returns 404', async () => {
    mocks.getMessageDigest
      .mockResolvedValueOnce(definition('definition-a'))
      .mockRejectedValueOnce(
        new ApiError('NOT_FOUND', 'Secret foreign definition details', 404)
      );
    const { result } = renderHook(() => useMessageDigestDefinition('definition-a'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let refreshed = true;
    await act(async () => {
      refreshed = await result.current.refreshWithResult();
    });

    expect(refreshed).toBe(false);
    expect(result.current.definition?.id).toBe('definition-a');
    expect(result.current.isNotFound).toBe(false);
    expect(JSON.stringify(result.current)).not.toContain('Secret foreign definition details');
  });
});

describe('useMessageDigestList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMessageDigests.mockReset();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('loads the first page and exposes the server cursor', async () => {
    mocks.listMessageDigests.mockResolvedValue({
      items: [definition('definition-a')],
      nextCursor: 'next-page',
    });

    const { result } = renderHook(() => useMessageDigestList());

    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-a']);
    expect(result.current.nextCursor).toBe('next-page');
    expect(result.current.hasConfirmedCurrentQuery).toBe(true);
    expect(result.current.currentQueryRevision).toBe(1);
    expect(result.current.confirmedCurrentQueryRevision).toBe(1);
    expect(mocks.listMessageDigests).toHaveBeenCalledWith(
      'test-token',
      { limit: 25, sort: 'updatedAt', direction: 'desc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('confirms rows only after the exact current query returns successfully', async () => {
    const nextQuery = deferred<{ items: MessageDigestDefinition[]; nextCursor: null }>();
    mocks.listMessageDigests
      .mockResolvedValueOnce({ items: [definition('definition-a')], nextCursor: null })
      .mockReturnValueOnce(nextQuery.promise);
    const { result, rerender } = renderHook(
      ({ query }) => useMessageDigestList({ query }),
      { initialProps: { query: 'first' } }
    );
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.hasConfirmedCurrentQuery).toBe(true);
    expect(result.current.currentQueryRevision).toBe(1);
    expect(result.current.confirmedCurrentQueryRevision).toBe(1);

    rerender({ query: 'second' });
    expect(result.current.hasConfirmedCurrentQuery).toBe(false);
    expect(result.current.currentQueryRevision).toBe(2);
    expect(result.current.confirmedCurrentQueryRevision).toBeNull();
    await waitFor(() => expect(result.current.isInitialLoading).toBe(true));

    nextQuery.resolve({ items: [definition('definition-b')], nextCursor: null });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-b']);
    expect(result.current.hasConfirmedCurrentQuery).toBe(true);
    expect(result.current.currentQueryRevision).toBe(2);
    expect(result.current.confirmedCurrentQueryRevision).toBe(2);
  });

  it('rejects a saved refresh callback after a different query becomes current', async () => {
    mocks.listMessageDigests
      .mockResolvedValueOnce({ items: [definition('definition-a')], nextCursor: null })
      .mockResolvedValueOnce({ items: [definition('definition-b')], nextCursor: null })
      .mockResolvedValueOnce({ items: [definition('stale-definition-a')], nextCursor: null });
    const { result, rerender } = renderHook(
      ({ query }) => useMessageDigestList({ query }),
      { initialProps: { query: 'first' } }
    );
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    const staleRefresh = result.current.refreshWithResult;

    rerender({ query: 'second' });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual(['definition-b'])
    );

    let staleResult: boolean | undefined;
    await act(async () => {
      staleResult = await staleRefresh();
    });

    expect(staleResult).toBe(false);
    expect(mocks.listMessageDigests).toHaveBeenCalledTimes(2);
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-b']);
    expect(result.current.hasConfirmedCurrentQuery).toBe(true);
    expect(result.current.confirmedCurrentQueryRevision).toBe(2);
  });

  it('reports an in-flight refresh as stale when the query changes before it settles', async () => {
    const staleRefresh = deferred<{ items: MessageDigestDefinition[]; nextCursor: null }>();
    mocks.listMessageDigests
      .mockResolvedValueOnce({ items: [definition('definition-a')], nextCursor: null })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ items: [definition('definition-b')], nextCursor: null });
    const { result, rerender } = renderHook(
      ({ query }) => useMessageDigestList({ query }),
      { initialProps: { query: 'first' } }
    );
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    let refreshOutcome: Promise<'succeeded' | 'failed' | 'stale'> | undefined;
    act(() => {
      refreshOutcome = result.current.refreshWithOutcome();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(true));

    rerender({ query: 'second' });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.id)).toEqual(['definition-b'])
    );
    staleRefresh.resolve({ items: [definition('stale-definition-a')], nextCursor: null });

    let settledOutcome: 'succeeded' | 'failed' | 'stale' | undefined;
    await act(async () => {
      settledOutcome = await refreshOutcome;
    });
    expect(settledOutcome).toBe('stale');
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-b']);
  });

  it('reports refresh success truthfully while preserving confirmed rows on failure', async () => {
    const refresh = deferred<never>();
    mocks.listMessageDigests
      .mockResolvedValueOnce({ items: [definition('definition-a')], nextCursor: null })
      .mockReturnValueOnce(refresh.promise);
    const { result } = renderHook(() => useMessageDigestList());
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    let refreshing: Promise<boolean> | undefined;
    act(() => {
      refreshing = result.current.refreshWithResult();
    });
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-a']);

    refresh.reject(new Error('Refresh unavailable'));
    let failedRefresh: boolean | undefined;
    await act(async () => {
      failedRefresh = await refreshing;
    });
    expect(failedRefresh).toBe(false);
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-a']);
    expect(result.current.refreshError).toBe('Refresh unavailable');
    expect(result.current.error).toBeNull();

    mocks.listMessageDigests.mockResolvedValueOnce({
      items: [definition('definition-b')],
      nextCursor: null,
    });
    let successfulRefresh: boolean | undefined;
    await act(async () => {
      successfulRefresh = await result.current.refreshWithResult();
    });
    expect(successfulRefresh).toBe(true);
    expect(result.current.items.map((item) => item.id)).toEqual(['definition-b']);
  });

  it('loads more once and deduplicates immutable definitions by ID', async () => {
    mocks.listMessageDigests
      .mockResolvedValueOnce({
        items: [definition('definition-a'), definition('definition-b')],
        nextCursor: 'cursor-two',
      })
      .mockResolvedValueOnce({
        items: [definition('definition-b'), definition('definition-c')],
        nextCursor: null,
      });
    const { result } = renderHook(() => useMessageDigestList());
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => await result.current.loadMore());

    expect(result.current.items.map((item) => item.id)).toEqual([
      'definition-a',
      'definition-b',
      'definition-c',
    ]);
    expect(mocks.listMessageDigests).toHaveBeenLastCalledWith(
      'test-token',
      { cursor: 'cursor-two', limit: 25, sort: 'updatedAt', direction: 'desc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('rejects a stale response after the query fingerprint changes', async () => {
    const stale = deferred<{ items: MessageDigestDefinition[]; nextCursor: null }>();
    mocks.listMessageDigests
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ items: [definition('fresh-definition')], nextCursor: null });
    const { result, rerender } = renderHook(({ query }) => useMessageDigestList({ query }), {
      initialProps: { query: 'old' },
    });

    await waitFor(() => expect(mocks.listMessageDigests).toHaveBeenCalledTimes(1));
    rerender({ query: 'new' });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('fresh-definition'));
    stale.resolve({ items: [definition('stale-definition')], nextCursor: null });
    await act(async () => await stale.promise);

    expect(result.current.items.map((item) => item.id)).toEqual(['fresh-definition']);
    expect(mocks.listMessageDigests.mock.calls[0]?.[2]?.signal.aborted).toBe(true);
  });

  it('clears prior-account rows before loading the next authenticated account', async () => {
    const nextAccount = deferred<{ items: MessageDigestDefinition[]; nextCursor: null }>();
    mocks.listMessageDigests
      .mockResolvedValueOnce({ items: [definition('account-a-definition')], nextCursor: null })
      .mockReturnValueOnce(nextAccount.promise);
    const { result, rerender } = renderHook(() => useMessageDigestList());
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    mocks.authSubject = 'account-b';
    rerender();
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(true);
      expect(result.current.items).toEqual([]);
    });

    nextAccount.resolve({ items: [definition('account-b-definition')], nextCursor: null });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.items.map((item) => item.id)).toEqual(['account-b-definition']);
  });
});

describe('useMessageDigestCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('recovers create after reload with the same session-safe request ID', async () => {
    mocks.newRequestId.mockReturnValue('stable-create-request');
    mocks.createMessageDigest
      .mockRejectedValueOnce(new Error('Response timed out'))
      .mockResolvedValueOnce({
        disposition: 'existing',
        activationAdjusted: null,
        definition: definition('created-definition'),
      });
    const first = renderHook(() => useMessageDigestCommands());

    let firstResult: unknown;
    await act(async () => {
      firstResult = await first.result.current.createDigest(createInput());
    });
    expect(firstResult).toBeNull();
    expect(first.result.current.error).toBe('Response timed out');
    expect(
      JSON.parse(sessionStorage.getItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY) ?? '{}')
    ).toEqual({
      version: 2,
      authSubject: 'account-a',
      requestId: 'stable-create-request',
      inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    first.unmount();

    const recovered = renderHook(() => useMessageDigestCommands());
    let recoveredResult: unknown;
    await act(async () => {
      recoveredResult = await recovered.result.current.createDigest(createInput());
    });

    expect(recoveredResult).toMatchObject({ disposition: 'existing' });
    expect(mocks.createMessageDigest.mock.calls.map((call) => call[2])).toEqual([
      'stable-create-request',
      'stable-create-request',
    ]);
    expect(sessionStorage.getItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('stops ambiguous create recovery when the submitted values changed', async () => {
    mocks.newRequestId
      .mockReturnValueOnce('ambiguous-create-request')
      .mockReturnValueOnce('fresh-create-request');
    mocks.createMessageDigest.mockRejectedValue(new Error('Response timed out'));
    const first = renderHook(() => useMessageDigestCommands());

    await act(async () => await first.result.current.createDigest(createInput()));
    expect(mocks.createMessageDigest).toHaveBeenCalledTimes(1);
    first.unmount();

    const changedInput = { ...createInput(), name: 'Changed synthetic digest' };
    const recovered = renderHook(() => useMessageDigestCommands());
    await act(async () => await recovered.result.current.createDigest(changedInput));

    expect(mocks.createMessageDigest).toHaveBeenCalledTimes(1);
    expect(recovered.result.current.error).toBe(
      'A previous create request used different values and may already have succeeded. Check the Message Digests list, then submit again to start a new request.'
    );
    expect(sessionStorage.getItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY)).toBeNull();

    await act(async () => await recovered.result.current.createDigest(changedInput));
    expect(mocks.createMessageDigest).toHaveBeenCalledTimes(2);
    expect(mocks.createMessageDigest.mock.calls[1]?.[2]).toBe('fresh-create-request');
  });

  it.each([
    [
      'prior account',
      JSON.stringify({
        version: 2,
        authSubject: 'account-a',
        requestId: 'stale-request',
        inputDigest: 'a'.repeat(64),
      }),
    ],
    [
      'legacy structured value',
      JSON.stringify({ version: 1, authSubject: 'account-b', requestId: 'stale-request' }),
    ],
    ['legacy raw value', 'stale-legacy-request'],
    ['malformed JSON', '{not-json'],
  ])('never reuses a %s create request for the current account', async (_label, stored) => {
    mocks.authSubject = 'account-b';
    mocks.newRequestId.mockReturnValue('account-b-create-request');
    mocks.createMessageDigest.mockRejectedValueOnce(new Error('Keep recovery state'));
    sessionStorage.setItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY, stored);
    const { result } = renderHook(() => useMessageDigestCommands());

    expect(mocks.createMessageDigest).not.toHaveBeenCalled();
    await act(async () => await result.current.createDigest(createInput()));

    expect(mocks.createMessageDigest).toHaveBeenCalledWith(
      'test-token',
      createInput(),
      'account-b-create-request',
      expect.any(Object)
    );
    expect(
      JSON.parse(sessionStorage.getItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY) ?? '{}')
    ).toEqual({
      version: 2,
      authSubject: 'account-b',
      requestId: 'account-b-create-request',
      inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('exposes a revision conflict without optimistically replacing server state', async () => {
    mocks.updateMessageDigest.mockRejectedValue(
      new ApiError('CONFLICT', 'Refresh and retry', 409, {
        reason: 'REVISION_CONFLICT',
        refreshRequired: true,
      })
    );
    const { result } = renderHook(() => useMessageDigestCommands());

    let updated: unknown;
    await act(async () => {
      updated = await result.current.updateDigest('definition-a', {
        expectedRevision: 7,
        patch: { name: 'Changed' },
      });
    });

    expect(updated).toBeNull();
    expect(result.current.hasRevisionConflict).toBe(true);
    expect(result.current.error).toBe('Refresh and retry');
    expect(mocks.updateMessageDigest).toHaveBeenCalledWith(
      'test-token',
      'definition-a',
      { expectedRevision: 7, patch: { name: 'Changed' } },
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
  });

  it('deduplicates one definition but keeps concurrent definition updates independent', async () => {
    const first = deferred<MessageDigestDefinition>();
    const second = deferred<MessageDigestDefinition>();
    mocks.updateMessageDigest.mockImplementation(
      (_token: string, definitionId: string): Promise<MessageDigestDefinition> =>
        definitionId === 'definition-a' ? first.promise : second.promise
    );
    const { result } = renderHook(() => useMessageDigestCommands());
    const firstCommand = { expectedRevision: 1, patch: { status: 'paused' as const } };
    const secondCommand = { expectedRevision: 4, patch: { status: 'active' as const } };
    let firstRequest!: Promise<MessageDigestDefinition | null>;
    let duplicateRequest!: Promise<MessageDigestDefinition | null>;
    let secondRequest!: Promise<MessageDigestDefinition | null>;

    await act(async () => {
      firstRequest = result.current.updateDigest('definition-a', firstCommand);
      duplicateRequest = result.current.updateDigest('definition-a', firstCommand);
      secondRequest = result.current.updateDigest('definition-b', secondCommand);
      await Promise.resolve();
    });

    expect(duplicateRequest).toBe(firstRequest);
    expect(mocks.updateMessageDigest).toHaveBeenCalledTimes(2);
    expect(mocks.updateMessageDigest).toHaveBeenCalledWith(
      'test-token',
      'definition-a',
      firstCommand,
      expect.any(Object)
    );
    expect(mocks.updateMessageDigest).toHaveBeenCalledWith(
      'test-token',
      'definition-b',
      secondCommand,
      expect.any(Object)
    );
    expect(result.current.isUpdating).toBe(true);

    first.resolve({ ...definition('definition-a'), status: 'paused', listStatus: 'paused' });
    await act(async () => await firstRequest);
    expect(result.current.isUpdating).toBe(true);

    second.resolve(definition('definition-b'));
    await act(async () => await secondRequest);
    expect(result.current.isUpdating).toBe(false);
  });

  it('refreshes a stale run preparation and requires explicit confirmation again', async () => {
    mocks.newRequestId.mockReturnValue('stable-run-request');
    mocks.prepareMessageDigestRun
      .mockResolvedValueOnce(preparation('token-before', '2026-07-27T12:00:00.000Z'))
      .mockResolvedValueOnce(preparation('token-after', '2026-07-27T12:05:00.000Z'));
    mocks.confirmMessageDigestRun.mockRejectedValue(
      new ApiError('CONFLICT', 'Window changed', 409, {
        reason: 'RUN_PREPARATION_STALE',
        refreshRequired: true,
      })
    );
    const { result } = renderHook(() => useMessageDigestCommands());
    await act(async () => await result.current.prepareRun('definition-a'));

    let confirmed: unknown;
    await act(async () => {
      confirmed = await result.current.confirmRun('definition-a');
    });

    expect(confirmed).toBeNull();
    expect(mocks.confirmMessageDigestRun).toHaveBeenCalledTimes(1);
    expect(mocks.prepareMessageDigestRun).toHaveBeenCalledTimes(2);
    expect(result.current.preparation?.token).toBe('token-after');
    expect(result.current.requiresRunReconfirmation).toBe(true);
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBeNull();
  });

  it('replays a lost run response after reload without changing the logical request ID', async () => {
    mocks.newRequestId.mockReturnValue('stable-run-request');
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('fresh-token', '2026-07-27T12:00:00.000Z')
    );
    mocks.confirmMessageDigestRun
      .mockRejectedValueOnce(new Error('Response timed out'))
      .mockResolvedValueOnce({
        disposition: 'existing',
        dispatchDisposition: 'not_requested',
        run: run('run-existing', 'completed', 'sent'),
      });
    const first = renderHook(() => useMessageDigestCommands());
    await act(async () => await first.result.current.prepareRun('definition-a'));
    await act(async () => await first.result.current.confirmRun('definition-a'));
    expect(JSON.parse(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY) ?? '{}')).toMatchObject({
      version: 1,
      authSubject: 'account-a',
      definitionId: 'definition-a',
      requestId: 'stable-run-request',
      preparationToken: 'fresh-token',
    });
    first.unmount();

    const replay = renderHook(() => useMessageDigestCommands());
    let recovered: unknown;
    await act(async () => {
      recovered = await replay.result.current.recoverPendingRun('definition-a');
    });

    expect(recovered).toMatchObject({ disposition: 'existing', run: { id: 'run-existing' } });
    expect(mocks.prepareMessageDigestRun).toHaveBeenCalledTimes(1);
    expect(mocks.confirmMessageDigestRun.mock.calls.map((call) => call[3])).toEqual([
      'stable-run-request',
      'stable-run-request',
    ]);
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBeNull();
  });

  it('refuses to prepare another definition while a run recovery envelope is pending', async () => {
    const stored = storedRunRequest('definition-a');
    sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('definition-b-token', '2026-07-27T12:00:00.000Z')
    );
    const { result } = renderHook(() => useMessageDigestCommands());

    let prepared: unknown;
    await act(async () => {
      prepared = await result.current.prepareRun('definition-b');
    });

    expect(prepared).toBeNull();
    expect(result.current.pendingRunRecoveryDefinitionId).toBe('definition-a');
    expect(mocks.prepareMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBe(stored);
  });

  it('refuses to prepare the pending definition again instead of replacing its preview', async () => {
    const stored = storedRunRequest('definition-a');
    sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('replacement-token', '2026-07-27T12:05:00.000Z')
    );
    const { result } = renderHook(() => useMessageDigestCommands());

    let prepared: unknown;
    await act(async () => {
      prepared = await result.current.prepareRun('definition-a');
    });

    expect(prepared).toBeNull();
    expect(result.current.pendingRunRecoveryDefinitionId).toBe('definition-a');
    expect(mocks.prepareMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBe(stored);
  });

  it('refuses to confirm another definition if a recovery envelope appears after preparation', async () => {
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('definition-b-token', '2026-07-27T12:00:00.000Z')
    );
    const { result } = renderHook(() => useMessageDigestCommands());
    await act(async () => await result.current.prepareRun('definition-b'));
    const stored = storedRunRequest('definition-a');
    sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);

    let confirmed: unknown;
    await act(async () => {
      confirmed = await result.current.confirmRun('definition-b');
    });

    expect(confirmed).toBeNull();
    expect(result.current.pendingRunRecoveryDefinitionId).toBe('definition-a');
    expect(mocks.confirmMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBe(stored);
  });

  it('refuses a fresh confirm for the pending definition and preserves its original token', async () => {
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('replacement-token', '2026-07-27T12:05:00.000Z')
    );
    const { result } = renderHook(() => useMessageDigestCommands());
    await act(async () => await result.current.prepareRun('definition-a'));
    const stored = storedRunRequest('definition-a');
    sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);

    let confirmed: unknown;
    await act(async () => {
      confirmed = await result.current.confirmRun('definition-a');
    });

    expect(confirmed).toBeNull();
    expect(result.current.preparation).toBeNull();
    expect(result.current.pendingRunRecoveryDefinitionId).toBe('definition-a');
    expect(mocks.confirmMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBe(stored);
  });

  it('retains another definition’s recovery envelope when recovery is invoked with the wrong ID', async () => {
    const stored = storedRunRequest('definition-a');
    sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);
    const { result } = renderHook(() => useMessageDigestCommands());

    let recovered: unknown;
    await act(async () => {
      recovered = await result.current.recoverPendingRun('definition-b');
    });

    expect(recovered).toBeNull();
    expect(result.current.pendingRunRecoveryDefinitionId).toBe('definition-a');
    expect(mocks.confirmMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBe(stored);
  });

  it('discards malformed and prior-account run recovery envelopes', async () => {
    for (const stored of [
      '{not-json',
      JSON.stringify({
        version: 1,
        authSubject: 'account-b',
        definitionId: 'definition-a',
        requestId: 'stable-run-request',
        preparationToken: 'opaque-token',
      }),
    ]) {
      sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, stored);
      const hook = renderHook(() => useMessageDigestCommands());
      let recovered: unknown;
      await act(async () => {
        recovered = await hook.result.current.recoverPendingRun('definition-a');
      });
      expect(recovered).toBeNull();
      expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBeNull();
      hook.unmount();
    }
    expect(mocks.confirmMessageDigestRun).not.toHaveBeenCalled();
  });

  it('clears a pending run recovery envelope when the authenticated account changes', async () => {
    mocks.newRequestId.mockReturnValue('stable-run-request');
    mocks.prepareMessageDigestRun.mockResolvedValue(
      preparation('fresh-token', '2026-07-27T12:00:00.000Z')
    );
    mocks.confirmMessageDigestRun.mockRejectedValue(new Error('Response timed out'));
    const { result, rerender } = renderHook(() => useMessageDigestCommands());
    await act(async () => await result.current.prepareRun('definition-a'));
    await act(async () => await result.current.confirmRun('definition-a'));
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).not.toBeNull();

    mocks.authSubject = 'account-b';
    rerender();

    await waitFor(() =>
      expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY)).toBeNull()
    );
  });
});

describe('useMessageDigestRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('maps an initial run 404 to an owner-safe not-found state', async () => {
    mocks.getMessageDigestRun.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Secret foreign run details', 404)
    );
    const { result } = renderHook(() => useMessageDigestRun('definition-a', 'run-private'));

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.run).toBeNull();
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain('Secret foreign run details');
  });

  it('polls generation and pending delivery with a bounded delay until Sent', async () => {
    mocks.getMessageDigestRun
      .mockResolvedValueOnce(run('run-a', 'queued', 'not_sent'))
      .mockResolvedValueOnce(run('run-a', 'processing', 'not_sent'))
      .mockResolvedValueOnce(run('run-a', 'completed', 'pending'))
      .mockResolvedValueOnce(run('run-a', 'completed', 'sent'));

    const { result } = renderHook(() =>
      useMessageDigestRun('definition-a', 'run-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );

    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));
    expect(result.current.isPolling).toBe(false);
    expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(4);

    await act(async () => await delay(30));
    expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(4);
  });

  it('retries SOURCE_CHANGED on the exact run with one stable request and no replacement reservation', async () => {
    mocks.newRequestId.mockReturnValue('stable-retry-request');
    const failed = {
      ...run('run-a', 'failed', 'not_sent'),
      safeFailureCode: 'SOURCE_CHANGED',
    };
    const queued = {
      ...run('run-a', 'queued', 'not_sent'),
      attempts: 2,
    };
    mocks.getMessageDigestRun
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(run('run-a', 'completed', 'sent'));
    mocks.retryMessageDigestRun.mockResolvedValue({
      disposition: 'retried',
      stage: 'generation',
      run: queued,
    });

    const { result } = renderHook(() =>
      useMessageDigestRun('definition-a', 'run-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );
    await waitFor(() => expect(result.current.retryStage).toBe('generation'));
    await act(async () => await result.current.retryRun());
    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));

    expect(mocks.retryMessageDigestRun).toHaveBeenCalledWith(
      'test-token',
      'definition-a',
      'run-a',
      'stable-retry-request',
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
    expect(mocks.getMessageDigestRun.mock.calls.every((call) => call[2] === 'run-a')).toBe(true);
    expect(mocks.prepareMessageDigestRun).not.toHaveBeenCalled();
    expect(mocks.confirmMessageDigestRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY)).toBeNull();
  });

  it('retries definitive delivery failure and keeps generation and run identity unchanged', async () => {
    mocks.newRequestId.mockReturnValue('stable-delivery-retry');
    const failed = run('run-a', 'completed', 'failed');
    failed.delivery.failureCode = 'MAPPING_MISSING';
    const pending = run('run-a', 'completed', 'pending');
    pending.attempts = failed.attempts;
    mocks.getMessageDigestRun
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(run('run-a', 'completed', 'sent'));
    mocks.retryMessageDigestRun.mockResolvedValue({
      disposition: 'retried',
      stage: 'delivery',
      run: pending,
    });

    const { result } = renderHook(() =>
      useMessageDigestRun('definition-a', 'run-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );
    await waitFor(() => expect(result.current.retryStage).toBe('delivery'));
    await act(async () => await result.current.retryRun());
    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));

    expect(result.current.run?.id).toBe('run-a');
    expect(result.current.run?.generationStatus).toBe('completed');
    expect(mocks.retryMessageDigestRun).toHaveBeenCalledOnce();
  });

  it('never offers or invokes retry for ambiguous delivery', async () => {
    mocks.getMessageDigestRun.mockResolvedValue(run('run-a', 'completed', 'ambiguous'));
    const { result } = renderHook(() => useMessageDigestRun('definition-a', 'run-a'));

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.retryStage).toBeNull();
    await act(async () => await result.current.retryRun());
    expect(mocks.retryMessageDigestRun).not.toHaveBeenCalled();
    expect(result.current.retryError).toBe('This run cannot be retried safely.');
  });

  it('suppresses a stale request after an explicit refresh', async () => {
    const stale = deferred<ReturnType<typeof run>>();
    mocks.getMessageDigestRun
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(run('run-a', 'completed', 'sent'));
    const { result } = renderHook(() => useMessageDigestRun('definition-a', 'run-a'));

    await waitFor(() => expect(mocks.getMessageDigestRun).toHaveBeenCalledOnce());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));
    stale.resolve(run('run-a', 'queued', 'not_sent'));
    await act(async () => await delay(20));

    expect(result.current.run?.delivery.status).toBe('sent');
    expect(mocks.getMessageDigestRun.mock.calls[0]?.[3]?.signal.aborted).toBe(true);
  });

  it('retains the latest run during a transient polling failure and recovers', async () => {
    const recovered = deferred<ReturnType<typeof run>>();
    mocks.getMessageDigestRun
      .mockResolvedValueOnce(run('run-a', 'queued', 'not_sent'))
      .mockRejectedValueOnce(new Error('Polling unavailable'))
      .mockReturnValueOnce(recovered.promise);

    const { result } = renderHook(() =>
      useMessageDigestRun('definition-a', 'run-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );

    await waitFor(() => expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(3));
    expect(result.current.run?.generationStatus).toBe('queued');
    expect(result.current.pollError).toBe('Polling unavailable');

    recovered.resolve(run('run-a', 'completed', 'sent'));
    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));
    expect(result.current.pollError).toBeNull();
  });

  it.each([
    ['failed', 'not_sent'],
    ['skipped_no_activity', 'not_sent'],
    ['completed', 'sent'],
    ['completed', 'failed'],
    ['completed', 'ambiguous'],
  ] as const)(
    'stops after terminal generation=%s delivery=%s',
    async (generationStatus, deliveryStatus) => {
      mocks.getMessageDigestRun.mockResolvedValue(
        run('run-terminal', generationStatus, deliveryStatus)
      );
      const { result } = renderHook(() =>
        useMessageDigestRun('definition-a', 'run-terminal', {
          pollBaseMs: 5,
          pollMaxMs: 10,
        })
      );

      await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
      await act(async () => await delay(25));
      expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(1);
      expect(result.current.isPolling).toBe(false);
    }
  );

  it('cancels the prior account request and timer before loading the new account', async () => {
    mocks.getMessageDigestRun
      .mockResolvedValueOnce(run('run-a', 'queued', 'not_sent'))
      .mockResolvedValueOnce(run('run-a', 'completed', 'sent'));
    const { result, rerender } = renderHook(() =>
      useMessageDigestRun('definition-a', 'run-a', { pollBaseMs: 1_000 })
    );
    await waitFor(() => expect(result.current.run?.generationStatus).toBe('queued'));

    mocks.authSubject = 'account-b';
    rerender();

    await waitFor(() => expect(result.current.run?.delivery.status).toBe('sent'));
    expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(2);
    expect(mocks.getMessageDigestRun.mock.calls[0]?.[3]?.signal.aborted).toBe(true);
    await act(async () => await delay(25));
    expect(mocks.getMessageDigestRun).toHaveBeenCalledTimes(2);
  });
});

describe('useMessageDigestHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('loads cursor pages in window order and deduplicates immutable runs', async () => {
    mocks.listMessageDigestRuns
      .mockResolvedValueOnce({
        items: [run('run-a', 'completed', 'sent'), run('run-b', 'completed', 'sent')],
        nextCursor: 'cursor-two',
      })
      .mockResolvedValueOnce({
        items: [run('run-b', 'completed', 'sent'), run('run-c', 'skipped_no_activity', 'not_sent')],
        nextCursor: null,
      });

    const { result } = renderHook(() => useMessageDigestHistory('definition-a'));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    await act(async () => await result.current.loadMore());

    expect(result.current.items.map((item) => item.id)).toEqual(['run-a', 'run-b', 'run-c']);
    expect(mocks.listMessageDigestRuns).toHaveBeenNthCalledWith(
      1,
      'test-token',
      'definition-a',
      { limit: 25, sort: 'windowStart', direction: 'desc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.listMessageDigestRuns).toHaveBeenLastCalledWith(
      'test-token',
      'definition-a',
      { cursor: 'cursor-two', limit: 25, sort: 'windowStart', direction: 'desc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('retains runs and exposes a distinct load-more error', async () => {
    mocks.listMessageDigestRuns
      .mockResolvedValueOnce({
        items: [run('run-a', 'completed', 'sent')],
        nextCursor: 'cursor-two',
      })
      .mockRejectedValueOnce(new Error('More history unavailable'));
    const { result } = renderHook(() => useMessageDigestHistory('definition-a'));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => await result.current.loadMore());

    expect(result.current.items.map((item) => item.id)).toEqual(['run-a']);
    expect(result.current.loadMoreError).toBe('More history unavailable');
    expect(result.current.error).toBeNull();
  });

  it('cancels stale history when a server filter changes', async () => {
    const stale = deferred<{ items: ReturnType<typeof run>[]; nextCursor: null }>();
    mocks.listMessageDigestRuns.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({
      items: [run('run-filtered', 'completed', 'failed')],
      nextCursor: null,
    });
    const { result, rerender } = renderHook(
      ({ deliveryStatus }) => useMessageDigestHistory('definition-a', { deliveryStatus }),
      { initialProps: { deliveryStatus: 'sent' as 'sent' | 'failed' } }
    );
    await waitFor(() => expect(mocks.listMessageDigestRuns).toHaveBeenCalledTimes(1));

    rerender({ deliveryStatus: 'failed' });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('run-filtered'));
    stale.resolve({ items: [run('run-stale', 'completed', 'sent')], nextCursor: null });
    await act(async () => await stale.promise);

    expect(result.current.items.map((item) => item.id)).toEqual(['run-filtered']);
    expect(mocks.listMessageDigestRuns.mock.calls[0]?.[3]?.signal.aborted).toBe(true);
  });
});

describe('useMessageDigestDeliveryReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('loads the backend-authoritative delivery readiness and can retry', async () => {
    mocks.getMessageDigestDeliveryReadiness
      .mockRejectedValueOnce(new Error('Readiness unavailable'))
      .mockResolvedValueOnce({
        status: 'ready',
        maskedPrimaryNumber: '•••• 1234',
        observationVersion: 'mapping-v1',
        observedAt: '2026-07-27T12:00:00.000Z',
      });
    const { result } = renderHook(() => useMessageDigestDeliveryReadiness());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Readiness unavailable');

    await act(async () => await result.current.refresh());
    expect(result.current.readiness).toMatchObject({ status: 'ready' });
    expect(result.current.error).toBeNull();
    expect(mocks.getMessageDigestDeliveryReadiness).toHaveBeenLastCalledWith(
      'test-token',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        refreshToken: mocks.getAccessToken,
      })
    );
  });

  it('clears old readiness while the authenticated account changes', async () => {
    const nextAccount = deferred<{
      status: 'mapping_missing';
      observationVersion: string;
      observedAt: string;
    }>();
    mocks.getMessageDigestDeliveryReadiness
      .mockResolvedValueOnce({
        status: 'ready',
        observationVersion: 'mapping-a',
        observedAt: '2026-07-27T12:00:00.000Z',
      })
      .mockReturnValueOnce(nextAccount.promise);
    const { result, rerender } = renderHook(() => useMessageDigestDeliveryReadiness());
    await waitFor(() => expect(result.current.readiness?.status).toBe('ready'));

    mocks.authSubject = 'account-b';
    rerender();
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
      expect(result.current.readiness).toBeNull();
    });

    nextAccount.resolve({
      status: 'mapping_missing',
      observationVersion: 'mapping-b',
      observedAt: '2026-07-27T12:05:00.000Z',
    });
    await waitFor(() => expect(result.current.readiness?.status).toBe('mapping_missing'));
  });
});

describe('useMessageDigestSourceAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
  });

  it('distinguishes a missing mirror from an unavailable status check and can retry', async () => {
    mocks.getPrivateWhatsAppAccount
      .mockRejectedValueOnce(new Error('Mirror unavailable'))
      .mockResolvedValueOnce(null);
    const { result } = renderHook(() => useMessageDigestSourceAvailability());
    await waitFor(() => expect(result.current.availability).toBe('unavailable'));
    expect(result.current.error).toBe('Mirror unavailable');

    await act(async () => await result.current.refresh());
    expect(result.current.availability).toBe('missing');
    expect(result.current.error).toBeNull();
    expect(mocks.getPrivateWhatsAppAccount).toHaveBeenLastCalledWith('test-token');
  });

  it('reports only an active mirror as a usable source', async () => {
    mocks.getPrivateWhatsAppAccount.mockResolvedValue({ status: 'disabled' });
    const { result, rerender } = renderHook(() => useMessageDigestSourceAvailability());
    await waitFor(() => expect(result.current.availability).toBe('missing'));

    mocks.authSubject = 'account-b';
    mocks.getPrivateWhatsAppAccount.mockResolvedValue({ status: 'active' });
    rerender();
    await waitFor(() => expect(result.current.availability).toBe('active'));
  });
});

describe('useMessageDigestDeletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
    mocks.newRequestId.mockReturnValue('stable-delete-request');
  });

  it('uses initial DELETE once, then GET and owner-safe resume for subsequent batches', async () => {
    mocks.deleteMessageDigest.mockResolvedValueOnce(
      erasure('in_progress', 'runs', 'resume_delete')
    );
    mocks.getMessageDigestErasure.mockResolvedValueOnce(
      erasure('in_progress', 'outbox', 'resume_delete')
    );
    mocks.resumeMessageDigestErasure.mockResolvedValueOnce(
      erasure('completed', 'completed', null)
    );
    const { result } = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );

    await act(async () => await result.current.startDeletion());
    await waitFor(() => expect(result.current.erasure?.status).toBe('completed'));

    expect(mocks.getMessageDigestErasure).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMessageDigest.mock.calls.map((call) => call[2])).toEqual([
      'stable-delete-request',
    ]);
    expect(mocks.getMessageDigestErasure.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resumeMessageDigestErasure.mock.invocationCallOrder[0] ?? 0
    );
    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('recovers a known erasure with GET before deciding whether resume must advance it', async () => {
    sessionStorage.setItem(
      MESSAGE_DIGEST_ERASURE_REQUEST_KEY,
      JSON.stringify({
        version: 1,
        authSubject: 'account-a',
        definitionId: 'definition-a',
        requestId: 'persisted-delete-request',
        erasureRequestId: 'erasure-a',
      })
    );
    mocks.getMessageDigestErasure.mockResolvedValueOnce(
      erasure('in_progress', 'definition', 'resume_delete')
    );
    mocks.resumeMessageDigestErasure.mockResolvedValueOnce(
      erasure('completed', 'completed', null)
    );

    const { result } = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );
    await waitFor(() => expect(result.current.erasure?.status).toBe('completed'));

    expect(mocks.getMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-a',
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
    expect(mocks.resumeMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-a',
      expect.objectContaining({ refreshToken: mocks.getAccessToken })
    );
    expect(mocks.getMessageDigestErasure.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resumeMessageDigestErasure.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('bootstraps a fresh session from the server erasure ID and never starts a second deletion', async () => {
    mocks.getMessageDigestErasure.mockResolvedValueOnce(
      erasure('in_progress', 'definition', 'resume_delete')
    );
    mocks.resumeMessageDigestErasure.mockResolvedValueOnce(
      erasure('completed', 'completed', null)
    );
    const { result } = renderHook(() =>
      useMessageDigestDeletion('definition-a', {
        erasureRequestId: 'erasure-a',
        pollBaseMs: 5,
        pollMaxMs: 10,
      })
    );

    await waitFor(() => expect(result.current.erasure?.status).toBe('completed'));
    expect(mocks.getMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-a',
      expect.any(Object)
    );
    expect(mocks.resumeMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-a',
      expect.any(Object)
    );
    expect(mocks.deleteMessageDigest).not.toHaveBeenCalled();
  });

  it('recovers the current server erasure when session storage belongs to another digest', async () => {
    sessionStorage.setItem(
      MESSAGE_DIGEST_ERASURE_REQUEST_KEY,
      JSON.stringify({
        version: 1,
        authSubject: 'account-a',
        definitionId: 'definition-a',
        requestId: 'definition-a-delete-request',
        erasureRequestId: 'erasure-a',
      })
    );
    mocks.getMessageDigestErasure.mockResolvedValueOnce({
      ...erasure('in_progress', 'definition', 'resume_delete'),
      definitionId: 'definition-b',
      erasureRequestId: 'erasure-b',
    });
    mocks.resumeMessageDigestErasure.mockResolvedValueOnce({
      ...erasure('completed', 'completed', null),
      definitionId: 'definition-b',
      erasureRequestId: 'erasure-b',
    });

    const { result } = renderHook(() =>
      useMessageDigestDeletion('definition-b', {
        erasureRequestId: 'erasure-b',
        pollBaseMs: 5,
        pollMaxMs: 10,
      })
    );

    await waitFor(() => expect(result.current.erasure?.status).toBe('completed'));
    expect(mocks.getMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-b',
      expect.any(Object)
    );
    expect(mocks.resumeMessageDigestErasure).toHaveBeenCalledWith(
      'test-token',
      'erasure-b',
      expect.any(Object)
    );
    expect(mocks.deleteMessageDigest).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).toBeNull();
  });

  it('replays a lost initial DELETE response after reload and then stops at terminal', async () => {
    mocks.deleteMessageDigest
      .mockRejectedValueOnce(new Error('Response timed out'))
      .mockResolvedValueOnce(erasure('completed', 'completed', null));
    const first = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );

    await act(async () => await first.result.current.startDeletion());
    expect(first.result.current.error).toBe('Response timed out');
    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).toContain(
      'stable-delete-request'
    );
    first.unmount();

    const replay = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 5, pollMaxMs: 10 })
    );
    await waitFor(() => expect(replay.result.current.erasure?.status).toBe('completed'));
    expect(mocks.deleteMessageDigest.mock.calls.map((call) => call[2])).toEqual([
      'stable-delete-request',
      'stable-delete-request',
    ]);

    await act(async () => await delay(30));
    expect(mocks.deleteMessageDigest).toHaveBeenCalledTimes(2);
    expect(mocks.getMessageDigestErasure).not.toHaveBeenCalled();
  });

  it('retains resumable state after a poll error and retries on demand', async () => {
    mocks.deleteMessageDigest.mockResolvedValueOnce(erasure('in_progress', 'runs', null));
    mocks.getMessageDigestErasure
      .mockRejectedValueOnce(new Error('Progress unavailable'))
      .mockResolvedValueOnce(erasure('in_progress', 'definition', 'resume_delete'));
    mocks.resumeMessageDigestErasure.mockResolvedValueOnce(
      erasure('completed', 'completed', null)
    );
    const { result } = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 1_000 })
    );
    await act(async () => await result.current.startDeletion());

    await act(async () => await result.current.retry());
    expect(result.current.error).toBe('Progress unavailable');
    expect(result.current.erasure?.status).toBe('in_progress');

    await act(async () => await result.current.retry());
    await waitFor(() => expect(result.current.erasure?.status).toBe('completed'));
    expect(mocks.resumeMessageDigestErasure).toHaveBeenLastCalledWith(
      'test-token',
      'erasure-a',
      expect.any(Object)
    );
  });

  it('cancels pending recovery and clears session state when the auth subject changes', async () => {
    mocks.deleteMessageDigest.mockResolvedValueOnce(erasure('in_progress', 'runs', null));
    const { result, rerender } = renderHook(() =>
      useMessageDigestDeletion('definition-a', { pollBaseMs: 1_000 })
    );
    await act(async () => await result.current.startDeletion());
    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).not.toBeNull();

    mocks.authSubject = 'account-b';
    rerender();

    await waitFor(() => expect(result.current.erasure).toBeNull());
    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).toBeNull();
    await act(async () => await delay(25));
    expect(mocks.getMessageDigestErasure).not.toHaveBeenCalled();
  });

  it('discards a prior-account erasure record on initial mount without any API call', async () => {
    mocks.authSubject = 'account-b';
    sessionStorage.setItem(
      MESSAGE_DIGEST_ERASURE_REQUEST_KEY,
      JSON.stringify({
        version: 1,
        authSubject: 'account-a',
        definitionId: 'definition-a',
        requestId: 'account-a-delete-request',
        erasureRequestId: 'erasure-a',
      })
    );

    renderHook(() => useMessageDigestDeletion('definition-a', { pollBaseMs: 5 }));
    await act(async () => await delay(20));

    expect(sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY)).toBeNull();
    expect(mocks.getMessageDigestErasure).not.toHaveBeenCalled();
    expect(mocks.resumeMessageDigestErasure).not.toHaveBeenCalled();
    expect(mocks.deleteMessageDigest).not.toHaveBeenCalled();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function storedRunRequest(definitionId: string): string {
  return JSON.stringify({
    version: 1,
    authSubject: 'account-a',
    definitionId,
    requestId: 'stable-run-request',
    preparationToken: 'opaque-token',
  });
}

function definition(id: string): MessageDigestDefinition {
  return {
    id,
    name: `Digest ${id}`,
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    sourceLocked: false,
    source: { chatId: `chat-${id}`, chatType: 'group', displayName: 'Synthetic group' },
    instructions: {
      templateId: 'custom',
      text: 'Summarize the conversation using only relevant and supported facts.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-27T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

function createInput(): CreateMessageDigestInput {
  return {
    status: 'active',
    name: 'Synthetic digest',
    source: { chatId: 'synthetic-chat' },
    instructions: {
      templateId: 'custom',
      text: 'Summarize the conversation using only relevant and supported facts.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
  };
}

function preparation(token: string, end: string): MessageDigestRunPreparation {
  return {
    token,
    preparedAt: end,
    window: {
      start: '2026-07-27T05:30:00.000Z',
      end,
      timeZone: 'Europe/Warsaw',
    },
    source: { chatType: 'group', displayName: 'Synthetic group' },
    deliveryReadiness: { status: 'ready', maskedPrimaryNumber: '•••• 1234' },
  };
}

function erasure(
  status: 'in_progress' | 'completed',
  stage: 'runs' | 'outbox' | 'definition' | 'completed',
  nextAction: 'resume_delete' | null
): MessageDigestErasure {
  return {
    erasureRequestId: 'erasure-a',
    definitionId: 'definition-a',
    status,
    stage,
    deletedCounts: {
      runs: stage === 'runs' ? 1 : 0,
      outbox: stage === 'outbox' ? 1 : 0,
      state: 0,
      definition: stage === 'definition' || stage === 'completed' ? 1 : 0,
      legacy: 0,
    },
    updatedAt: '2026-07-27T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-07-27T12:01:00.000Z' : null,
    nextAction,
  };
}

function run(
  id: string,
  generationStatus: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped_no_activity',
  deliveryStatus: 'not_sent' | 'pending' | 'sent' | 'ambiguous' | 'failed'
): MessageDigestRun {
  return {
    id,
    definitionId: 'definition-a',
    trigger: 'manual' as const,
    window: {
      start: '2026-07-27T05:30:00.000Z',
      end: '2026-07-27T12:00:00.000Z',
      scheduledBoundary: '2026-07-27T12:00:00.000Z',
    },
    generationStatus,
    processingStage: generationStatus === 'processing' ? 'aggregating' : generationStatus,
    attempts: 1,
    source: { chatType: 'group' as const, displayName: 'Synthetic group' },
    instructions: {
      templateId: 'custom' as const,
      text: 'Summarize the conversation using only relevant and supported facts.',
      revision: '1',
    },
    schedule: { kind: 'daily' as const, localTime: '07:30', timeZone: 'Europe/Warsaw' },
    content: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary' as const,
      status: deliveryStatus,
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
    completedAt: generationStatus === 'completed' ? '2026-07-27T12:01:00.000Z' : null,
  };
}
