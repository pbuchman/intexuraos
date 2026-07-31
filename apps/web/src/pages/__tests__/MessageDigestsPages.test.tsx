/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  UseMessageDigestCommandsResult,
  UseMessageDigestDeliveryReadinessResult,
  UseMessageDigestListResult,
  UseMessageDigestSourceAvailabilityResult,
} from '@/hooks/useMessageDigests';
import type { MessageDigestListProps } from '@/components/message-digests/MessageDigestList';
import type { ListMessageDigestsOptions, MessageDigestDefinition } from '@/types/messageDigests';

const mocks = vi.hoisted(() => ({
  useMessageDigestList: vi.fn(),
  useMessageDigestDeliveryReadiness: vi.fn(),
  useMessageDigestSourceAvailability: vi.fn(),
  useMessageDigestCommands: vi.fn(),
  updateDigest: vi.fn(),
  clearError: vi.fn(),
  listRefresh: vi.fn(),
  listRefreshWithResult: vi.fn(),
  readinessRefresh: vi.fn(),
  sourceRefresh: vi.fn(),
  captureListProps: vi.fn(),
}));

vi.mock('@/hooks/useMessageDigests', () => ({
  useMessageDigestCommands: (): UseMessageDigestCommandsResult => mocks.useMessageDigestCommands(),
  useMessageDigestList: (options: ListMessageDigestsOptions): UseMessageDigestListResult =>
    mocks.useMessageDigestList(options),
  useMessageDigestDeliveryReadiness: (): UseMessageDigestDeliveryReadinessResult =>
    mocks.useMessageDigestDeliveryReadiness(),
  useMessageDigestSourceAvailability: (): UseMessageDigestSourceAvailabilityResult =>
    mocks.useMessageDigestSourceAvailability(),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

vi.mock('@/components/message-digests/MessageDigestList', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/message-digests/MessageDigestList')
  >();
  return {
    ...actual,
    MessageDigestList: (props: MessageDigestListProps): React.JSX.Element => {
      mocks.captureListProps(props);
      return <actual.MessageDigestList {...props} />;
    },
  };
});

import { WhatsAppMessageDigestsPage } from '../WhatsAppMessageDigestsPage.js';

describe('WhatsAppMessageDigestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRefresh.mockResolvedValue(undefined);
    mocks.listRefreshWithResult.mockResolvedValue(true);
    mocks.readinessRefresh.mockResolvedValue(undefined);
    mocks.sourceRefresh.mockResolvedValue(undefined);
    mocks.updateDigest.mockResolvedValue(definition('digest-a'));
    mocks.useMessageDigestCommands.mockReturnValue(commandsResult());
    mocks.useMessageDigestList.mockReturnValue(listResult());
    mocks.useMessageDigestDeliveryReadiness.mockReturnValue(readinessResult());
    mocks.useMessageDigestSourceAvailability.mockReturnValue(sourceResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('starts with recently-updated server ordering and canonical creation navigation', () => {
    renderPage();

    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(screen.getByRole('link', { name: 'New digest' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/new'
    );
  });

  it('uses name ordering for search and restores the user’s prior sort when search clears', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'nextRunAt');
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'nextRunAt',
      direction: 'asc',
    });

    await user.type(screen.getByRole('searchbox', { name: 'Search digests' }), 'fish');
    await waitFor(() =>
      expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
        query: 'fish',
        sort: 'name',
        direction: 'asc',
      })
    );
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?query=fish&sort=name&direction=asc'
    );

    await user.clear(screen.getByRole('searchbox', { name: 'Search digests' }));
    await waitFor(() =>
      expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
        sort: 'nextRunAt',
        direction: 'asc',
      })
    );
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?sort=nextRunAt&direction=asc'
    );
  });

  it('preserves raw typing and commits one normalized search only after 300 ms', async () => {
    vi.useFakeTimers();
    renderPage();
    const search = screen.getByRole('searchbox', { name: 'Search digests' });

    fireEvent.change(search, { target: { value: 'fishing  plans ' } });
    expect(search).toHaveValue('fishing  plans ');
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );

    await act(async () => vi.advanceTimersByTime(299));
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'updatedAt',
      direction: 'desc',
    });

    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      query: 'fishing plans',
      sort: 'name',
      direction: 'asc',
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?query=fishing+plans&sort=name&direction=asc'
    );
  });

  it('flushes pending search into discrete filter changes without a stale timer overwrite', async () => {
    vi.useFakeTimers();
    renderPage();
    const search = screen.getByRole('searchbox', { name: 'Search digests' });

    fireEvent.change(search, { target: { value: ' fishing  plans ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paused' }));

    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      query: 'fishing plans',
      status: 'paused',
      sort: 'name',
      direction: 'asc',
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?query=fishing+plans&status=paused&sort=name&direction=asc'
    );

    fireEvent.change(search, { target: { value: 'fishing plans today' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation type' }), {
      target: { value: 'direct' },
    });

    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      query: 'fishing plans today',
      status: 'paused',
      chatType: 'direct',
      sort: 'name',
      direction: 'asc',
    });
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?query=fishing+plans+today&status=paused&chatType=direct&sort=name&direction=asc'
    );
  });

  it('cancels a pending search when Back or Forward replaces the URL state', async () => {
    vi.useFakeTimers();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Paused' }));
    const search = screen.getByRole('searchbox', { name: 'Search digests' });
    fireEvent.change(search, { target: { value: 'fish' } });
    await act(async () => vi.advanceTimersByTime(300));
    expect(search).toHaveValue('fish');

    fireEvent.change(search, { target: { value: 'fish stale' } });
    expect(search).toHaveValue('fish stale');
    fireEvent.click(screen.getByRole('button', { name: 'Back in filter history' }));
    expect(search).toHaveValue('');
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Forward in filter history' }));
    expect(search).toHaveValue('fish');
    expect(screen.getByRole('button', { name: 'Paused' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('passes status and conversation filters to the server and resets all controls', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation type' }), 'direct');
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      chatType: 'direct',
      status: 'paused',
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?status=paused&chatType=direct'
    );

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
  });

  it('restores valid controls and API options from the canonical URL', () => {
    renderPage(
      false,
      undefined,
      '/whatsapp/message-digests?query=fish&status=paused&chatType=direct&sort=name&direction=asc'
    );

    expect(screen.getByRole('searchbox', { name: 'Search digests' })).toHaveValue('fish');
    expect(screen.getByRole('button', { name: 'Paused' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('combobox', { name: 'Conversation type' })).toHaveValue('direct');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name');
    expect(screen.getByRole('button', { name: 'Sort descending' })).toBeDisabled();
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      query: 'fish',
      status: 'paused',
      chatType: 'direct',
      sort: 'name',
      direction: 'asc',
    });
  });

  it('discards invalid and unknown URL parameters without leaking them into list options', async () => {
    renderPage(
      false,
      undefined,
      '/whatsapp/message-digests?query=%20&status=unknown&chatType=channel&sort=old&direction=sideways&extra=value'
    );

    await waitFor(() =>
      expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
        '/whatsapp/message-digests'
      )
    );
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(screen.getByRole('searchbox', { name: 'Search digests' })).toHaveValue('');
  });

  it('uses history entries for discrete filters and restores them through Back and Forward', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation type' }), 'direct');
    await user.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests?status=active&chatType=direct'
    );

    await user.click(screen.getByRole('button', { name: 'Back in filter history' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Paused' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
    expect(screen.getByRole('combobox', { name: 'Conversation type' })).toHaveValue('direct');
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      status: 'paused',
      chatType: 'direct',
      sort: 'updatedAt',
      direction: 'desc',
    });

    await user.click(screen.getByRole('button', { name: 'Forward in filter history' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      status: 'active',
      chatType: 'direct',
      sort: 'updatedAt',
      direction: 'desc',
    });
  });

  it('refreshes rows and both WhatsApp setup checks together', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Refresh Message Digests' }));
    await waitFor(() => {
      expect(mocks.listRefreshWithResult).toHaveBeenCalledTimes(1);
      expect(mocks.readinessRefresh).toHaveBeenCalledTimes(1);
      expect(mocks.sourceRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('routes a list deletion action to the owner-safe detail flow with explicit intent', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [definition('digest-a')] }));
    renderPage(true);

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete digest' }));

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-a'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('openDelete');
  });

  it('routes Run now to the canonical detail dialog instead of a non-existent route', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [definition('digest-a')] }));
    renderPage(true);

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-a'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('openRun');
  });

  it('repeats the current source guard in the list Run handler before navigation', () => {
    const item = definition('digest-source-blocked');
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [item] }));
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'unavailable', error: 'Synthetic source status failure' })
    );
    renderPage(true);

    act(() => {
      lastListProps().onRun(item);
    });

    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
    expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();
  });

  it('keeps a pending run for digest A ahead of every Run action for digest B', () => {
    const item = definition('digest-b');
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [item] }));
    renderPage(true);

    expect(lastListProps().pendingRunRecoveryDefinitionId).toBe('digest-a');
    expect(screen.getByRole('link', { name: 'Recover pending run' })).toHaveAttribute(
      'href',
      '/whatsapp/message-digests/digest-a'
    );

    act(() => {
      lastListProps().onRun(item);
    });

    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
    expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();
  });

  it('blocks deletion of pending digest A but keeps deletion of digest B available', () => {
    const pending = definition('digest-a');
    const other = definition('digest-b');
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ pendingRunRecoveryDefinitionId: 'digest-a' })
    );
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [pending, other] }));
    renderPage(true);

    act(() => {
      lastListProps().onDelete(pending);
    });
    expect(screen.getByTestId('list-location-probe')).toHaveTextContent(
      '/whatsapp/message-digests'
    );
    expect(screen.queryByTestId('location-probe')).not.toBeInTheDocument();

    act(() => {
      lastListProps().onDelete(other);
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/whatsapp/message-digests/digest-b'
    );
    expect(screen.getByTestId('location-probe')).toHaveTextContent('openDelete');
  });

  it('pauses with the row revision, locks only that row, and refreshes without optimistic state', async () => {
    const user = userEvent.setup();
    let resolveUpdate: ((value: MessageDigestDefinition | null) => void) | undefined;
    mocks.updateDigest.mockReturnValue(
      new Promise<MessageDigestDefinition | null>((resolve) => {
        resolveUpdate = resolve;
      })
    );
    mocks.useMessageDigestList.mockReturnValue(
      listResult({ items: [definition('digest-a'), definition('digest-b')] })
    );
    renderPage();

    const activeCard = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(activeCard).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));

    expect(mocks.updateDigest).toHaveBeenCalledWith('digest-a', {
      expectedRevision: 1,
      patch: { status: 'paused' },
    });
    expect(within(activeCard).getByText('Active')).toBeInTheDocument();
    expect(
      within(activeCard).getByRole('button', { name: 'Pausing Digest digest-a…' })
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('message-digest-mobile-digest-b')).getByRole('button', {
        name: 'Actions for Digest digest-b',
      })
    ).toBeEnabled();
    expect(mocks.listRefresh).not.toHaveBeenCalled();

    resolveUpdate?.({ ...definition('digest-a'), status: 'paused', listStatus: 'paused', revision: 2 });
    await waitFor(() => expect(mocks.listRefreshWithResult).toHaveBeenCalledTimes(1));
  });

  it('refreshes the latest filter after lifecycle completion and fences a later stale failure', async () => {
    const user = userEvent.setup();
    let resolveUpdate: ((value: MessageDigestDefinition | null) => void) | undefined;
    let resolvePausedRefresh:
      | ((value: 'succeeded' | 'failed' | 'stale') => void)
      | undefined;
    const activeRefresh = vi.fn().mockResolvedValue('failed' as const);
    const pausedRefresh = vi.fn(
      () =>
        new Promise<'succeeded' | 'failed' | 'stale'>((resolve) => {
          resolvePausedRefresh = resolve;
        })
    );
    const directRefresh = vi.fn().mockResolvedValue('succeeded' as const);
    mocks.updateDigest.mockReturnValue(
      new Promise<MessageDigestDefinition | null>((resolve) => {
        resolveUpdate = resolve;
      })
    );
    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        currentQueryRevision: 1,
        confirmedCurrentQueryRevision: 1,
        refreshWithOutcome: activeRefresh,
      })
    );
    renderPage();

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));

    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        currentQueryRevision: 2,
        confirmedCurrentQueryRevision: 2,
        refreshWithOutcome: pausedRefresh,
      })
    );
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    act(() => {
      resolveUpdate?.({
        ...definition('digest-a'),
        status: 'paused',
        listStatus: 'paused',
        revision: 2,
      });
    });

    await waitFor(() => expect(pausedRefresh).toHaveBeenCalledTimes(1));
    expect(activeRefresh).not.toHaveBeenCalled();

    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        currentQueryRevision: 3,
        confirmedCurrentQueryRevision: 3,
        refreshWithOutcome: directRefresh,
      })
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation type' }), 'direct');
    expect(screen.getByRole('combobox', { name: 'Conversation type' })).toHaveValue('direct');
    expect(mocks.useMessageDigestList).toHaveBeenLastCalledWith({
      status: 'paused',
      chatType: 'direct',
      sort: 'updatedAt',
      direction: 'desc',
    });
    act(() => {
      resolvePausedRefresh?.('stale');
    });

    await waitFor(() =>
      expect(
        within(screen.getByTestId('message-digest-mobile-digest-a')).getByRole('button', {
          name: 'Actions for Digest digest-a',
        })
      ).toBeEnabled()
    );
    expect(screen.queryByText(/refresh failed\. refresh the list/i)).not.toBeInTheDocument();
    expect(directRefresh).not.toHaveBeenCalled();
  });

  it('focuses the stable heading when a keyboard lifecycle action leaves the active filter', async () => {
    const user = userEvent.setup();
    let resolveLifecycleRefresh:
      | ((value: 'succeeded' | 'failed' | 'stale') => void)
      | undefined;
    const lifecycleRefresh = vi.fn(
      () =>
        new Promise<'succeeded' | 'failed' | 'stale'>((resolve) => {
          resolveLifecycleRefresh = resolve;
        })
    );
    mocks.updateDigest.mockResolvedValue({
      ...definition('digest-a'),
      status: 'paused',
      listStatus: 'paused',
      revision: 2,
    });
    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        refreshWithOutcome: lifecycleRefresh,
      })
    );
    const view = renderPage(
      false,
      undefined,
      '/whatsapp/message-digests?status=active'
    );

    await user.click(
      within(screen.getByTestId('message-digest-mobile-digest-a')).getByRole('button', {
        name: 'Actions for Digest digest-a',
      })
    );
    const pauseItem = screen.getByRole('menuitem', { name: 'Pause digest' });
    pauseItem.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lifecycleRefresh).toHaveBeenCalledTimes(1));

    mocks.useMessageDigestList.mockReturnValue(
      listResult({ items: [], refreshWithOutcome: lifecycleRefresh })
    );
    view.rerender(
      <ListTestRouter initialUrl="/whatsapp/message-digests?status=active" />
    );
    expect(screen.queryByTestId('message-digest-mobile-digest-a')).not.toBeInTheDocument();

    act(() => {
      resolveLifecycleRefresh?.('succeeded');
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Message Digests' })).toHaveFocus()
    );
  });

  it('does not move focus to the heading when a pointer lifecycle action leaves the active filter', async () => {
    const user = userEvent.setup();
    let resolveLifecycleRefresh:
      | ((value: 'succeeded' | 'failed' | 'stale') => void)
      | undefined;
    const lifecycleRefresh = vi.fn(
      () =>
        new Promise<'succeeded' | 'failed' | 'stale'>((resolve) => {
          resolveLifecycleRefresh = resolve;
        })
    );
    mocks.updateDigest.mockResolvedValue({
      ...definition('digest-a'),
      status: 'paused',
      listStatus: 'paused',
      revision: 2,
    });
    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        refreshWithOutcome: lifecycleRefresh,
      })
    );
    const view = renderPage(false, undefined, '/whatsapp/message-digests?status=active');

    await user.click(
      within(screen.getByTestId('message-digest-mobile-digest-a')).getByRole('button', {
        name: 'Actions for Digest digest-a',
      })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));
    await waitFor(() => expect(lifecycleRefresh).toHaveBeenCalledTimes(1));

    mocks.useMessageDigestList.mockReturnValue(
      listResult({ items: [], refreshWithOutcome: lifecycleRefresh })
    );
    view.rerender(<ListTestRouter initialUrl="/whatsapp/message-digests?status=active" />);
    await act(async () => {
      resolveLifecycleRefresh?.('succeeded');
    });

    expect(screen.getByRole('heading', { name: 'Message Digests' })).not.toHaveFocus();
  });

  it('locks an old row after a successful pause when authoritative refresh fails', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValue({
      ...definition('digest-a'),
      status: 'paused',
      listStatus: 'paused',
      revision: 2,
    });
    mocks.listRefreshWithResult.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [definition('digest-a')] }));
    renderPage();

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Digest digest-a was changed. Refresh failed. Refresh the list to load the new state.'
    );
    expect(
      within(card).getByRole('button', { name: 'Refresh required for Digest digest-a' })
    ).toBeDisabled();
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(mocks.updateDigest).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh Message Digests' }));

    await waitFor(() =>
      expect(
        within(card).getByRole('button', { name: 'Actions for Digest digest-a' })
      ).toBeEnabled()
    );
    expect(screen.queryByText(/refresh failed\. refresh the list/i)).not.toBeInTheDocument();
    expect(mocks.updateDigest).toHaveBeenCalledTimes(1);
  });

  it('clears a stale lifecycle lock only after the changed filter has confirmed rows', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValue({
      ...definition('digest-a'),
      status: 'paused',
      listStatus: 'paused',
      revision: 2,
    });
    mocks.listRefreshWithResult.mockResolvedValue(false);
    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        hasConfirmedCurrentQuery: true,
        confirmedCurrentQueryRevision: 1,
      })
    );
    const view = renderPage();

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));
    expect(
      within(card).getByRole('button', { name: 'Refresh required for Digest digest-a' })
    ).toBeDisabled();

    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        hasConfirmedCurrentQuery: false,
        confirmedCurrentQueryRevision: null,
      })
    );
    await user.click(screen.getByRole('button', { name: 'Paused' }));
    expect(
      within(card).getByRole('button', { name: 'Refresh required for Digest digest-a' })
    ).toBeDisabled();

    mocks.useMessageDigestList.mockReturnValue(
      listResult({
        items: [definition('digest-a')],
        hasConfirmedCurrentQuery: true,
        confirmedCurrentQueryRevision: 2,
      })
    );
    view.rerender(<ListTestRouter />);

    await waitFor(() =>
      expect(
        within(screen.getByTestId('message-digest-mobile-digest-a')).getByRole('button', {
          name: 'Actions for Digest digest-a',
        })
      ).toBeEnabled()
    );
    expect(screen.queryByText(/refresh failed\. refresh the list/i)).not.toBeInTheDocument();
  });

  it('keeps the authoritative row and refreshes after an in-progress pause conflict', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValue(null);
    mocks.useMessageDigestCommands.mockReturnValue(
      commandsResult({ error: 'A Message Digest run is already in progress.' })
    );
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [definition('digest-a')] }));
    renderPage();

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The latest state is loaded. Review it and try again.'
    );
    expect(card).toHaveTextContent('Active');
    expect(mocks.listRefreshWithResult).toHaveBeenCalledTimes(1);
    expect(mocks.listRefresh).not.toHaveBeenCalled();
  });

  it('keeps the confirmed row and never claims a reload when conflict refresh fails', async () => {
    const user = userEvent.setup();
    mocks.updateDigest.mockResolvedValue(null);
    mocks.listRefreshWithResult.mockResolvedValue(false);
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [definition('digest-a')] }));
    renderPage();

    const card = screen.getByTestId('message-digest-mobile-digest-a');
    await user.click(within(card).getByRole('button', { name: 'Actions for Digest digest-a' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pause digest' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Refresh the list to load the latest state, then try again.'
    );
    expect(screen.queryByText(/latest state (?:was reloaded|is loaded)/i)).not.toBeInTheDocument();
    expect(card).toHaveTextContent('Active');
    expect(mocks.listRefreshWithResult).toHaveBeenCalledTimes(1);
    expect(mocks.listRefresh).not.toHaveBeenCalled();
  });

  it('repeats the Resume guard in the page handler before any synthetic PATCH attempt', async () => {
    const paused = {
      ...definition('digest-paused'),
      status: 'paused' as const,
      listStatus: 'paused' as const,
    };
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [paused] }));
    mocks.useMessageDigestSourceAvailability.mockReturnValue(
      sourceResult({ availability: 'missing' })
    );
    renderPage();

    act(() => {
      lastListProps().onToggleLifecycle(paused);
    });

    expect(mocks.updateDigest).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connect Private WhatsApp before resuming this digest.'
    );
    expect(mocks.listRefresh).not.toHaveBeenCalled();
  });

  it('allows SOURCE_TOO_LARGE recovery through the page handler with exactly one PATCH', async () => {
    const paused = {
      ...definition('digest-too-large'),
      status: 'paused' as const,
      listStatus: 'paused' as const,
      attentionCode: 'SOURCE_TOO_LARGE',
      latestRun: {
        id: 'run-too-large',
        runType: 'scheduled' as const,
        windowStart: '2026-07-27T05:30:00.000Z',
        windowEnd: '2026-07-28T05:30:00.000Z',
        generationStatus: 'failed' as const,
        deliveryStatus: 'not_requested' as const,
        attemptCount: 1,
        failureCode: 'SOURCE_TOO_LARGE',
        createdAt: '2026-07-28T05:30:00.000Z',
        updatedAt: '2026-07-28T05:31:00.000Z',
      },
    };
    mocks.useMessageDigestList.mockReturnValue(listResult({ items: [paused] }));
    renderPage();

    await act(async () => lastListProps().onToggleLifecycle(paused));

    expect(mocks.updateDigest).toHaveBeenCalledTimes(1);
    expect(mocks.updateDigest).toHaveBeenCalledWith('digest-too-large', {
      expectedRevision: 1,
      patch: { status: 'active' },
    });
    expect(mocks.listRefreshWithResult).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the list heading after terminal deletion redirect', () => {
    renderPage(false, { deleted: true, focusHeading: true });

    expect(screen.getByRole('heading', { name: 'Message Digests' })).toHaveFocus();
    expect(screen.getByRole('status', { name: 'Message Digest update' })).toHaveTextContent(
      'Message Digest deleted'
    );
  });

  it('shows the owner-safe legacy alias notice and ignores arbitrary navigation text', () => {
    renderPage(false, {
      messageDigestNotice:
        'No matching WhatsApp Message Digest was found for this legacy link.',
    });
    expect(screen.getByRole('status', { name: 'Message Digest update' })).toHaveTextContent(
      'No matching WhatsApp Message Digest was found for this legacy link.'
    );

    cleanup();
    renderPage(false, { messageDigestNotice: 'Untrusted arbitrary navigation text' });
    expect(screen.queryByText('Untrusted arbitrary navigation text')).not.toBeInTheDocument();
  });
});

function renderPage(
  withProbe = false,
  state?: Record<string, unknown>,
  initialUrl = '/whatsapp/message-digests'
): ReturnType<typeof render> {
  return render(<ListTestRouter withProbe={withProbe} state={state} initialUrl={initialUrl} />);
}

function ListTestRouter({
  withProbe = false,
  state,
  initialUrl = '/whatsapp/message-digests',
}: {
  withProbe?: boolean;
  state?: Record<string, unknown>;
  initialUrl?: string;
}): React.JSX.Element {
  const [pathname = '/whatsapp/message-digests', query = ''] = initialUrl.split('?');
  return (
    <MemoryRouter
      initialEntries={[{ pathname, search: query === '' ? '' : `?${query}`, state }]}
    >
      <Routes>
        <Route
          path="/whatsapp/message-digests"
          element={
            <>
              <WhatsAppMessageDigestsPage />
              <ListLocationProbe />
            </>
          }
        />
        {withProbe ? (
          <Route path="/whatsapp/message-digests/:definitionId" element={<LocationProbe />} />
        ) : null}
      </Routes>
    </MemoryRouter>
  );
}

function ListLocationProbe(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <aside>
      <pre data-testid="list-location-probe">
        {location.pathname}
        {location.search}
      </pre>
      <button type="button" onClick={(): void => void navigate(-1)}>
        Back in filter history
      </button>
      <button type="button" onClick={(): void => void navigate(1)}>
        Forward in filter history
      </button>
    </aside>
  );
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <pre data-testid="location-probe">
      {location.pathname} {JSON.stringify(location.state)}
    </pre>
  );
}

function listResult(
  overrides: Partial<UseMessageDigestListResult> = {}
): UseMessageDigestListResult {
  return {
    items: [],
    nextCursor: null,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    refreshError: null,
    loadMoreError: null,
    hasConfirmedCurrentQuery: true,
    currentQueryRevision: 1,
    confirmedCurrentQueryRevision: 1,
    refresh: mocks.listRefresh,
    refreshWithResult: mocks.listRefreshWithResult,
    refreshWithOutcome: async () =>
      (await mocks.listRefreshWithResult()) ? 'succeeded' : 'failed',
    loadMore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function commandsResult(
  overrides: Partial<UseMessageDigestCommandsResult> = {}
): UseMessageDigestCommandsResult {
  return {
    error: null,
    hasRevisionConflict: false,
    preparation: null,
    requiresRunReconfirmation: false,
    isCreating: false,
    isUpdating: false,
    isPreparingRun: false,
    isConfirmingRun: false,
    isRecoveringRun: false,
    pendingRunRecoveryDefinitionId: null,
    createDigest: vi.fn(),
    updateDigest: mocks.updateDigest,
    prepareRun: vi.fn(),
    confirmRun: vi.fn(),
    recoverPendingRun: vi.fn(),
    finishRunRequest: vi.fn(),
    clearError: mocks.clearError,
    ...overrides,
  };
}

function readinessResult(): UseMessageDigestDeliveryReadinessResult {
  return {
    readiness: {
      status: 'ready',
      maskedPrimaryNumber: '•••• 1234',
      observationVersion: 'mapping-v1',
      observedAt: '2026-07-27T12:00:00.000Z',
    },
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: mocks.readinessRefresh,
  };
}

function sourceResult(
  overrides: Partial<UseMessageDigestSourceAvailabilityResult> = {}
): UseMessageDigestSourceAvailabilityResult {
  return {
    availability: 'active',
    isRefreshing: false,
    error: null,
    refresh: mocks.sourceRefresh,
    ...overrides,
  };
}

function lastListProps(): MessageDigestListProps {
  const props = mocks.captureListProps.mock.lastCall?.[0];
  if (props === undefined) throw new Error('MessageDigestList was not rendered');
  return props as MessageDigestListProps;
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
    source: { chatId: `chat-${id}`, chatType: 'group', displayName: 'Fishing group' },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize the conversation using only relevant and supported facts.',
    },
    schedule: { kind: 'daily', localTime: '07:30', timeZone: 'Europe/Warsaw' },
    delivery: { type: 'whatsapp_primary' },
    checkpointAt: '2026-07-27T05:30:00.000Z',
    nextRunAt: '2026-07-28T05:30:00.000Z',
    lastRunAt: null,
    latestRun: null,
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}
