/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateWhatsAppChat } from '@/types';

const mocks = vi.hoisted(() => ({
  authSubject: 'account-a',
  getAccessToken: vi.fn(),
  listPrivateWhatsAppChats: vi.fn(),
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

vi.mock('@/services/whatsappApi', () => ({
  listPrivateWhatsAppChats: mocks.listPrivateWhatsAppChats,
}));

import {
  MessageDigestConversationPicker,
  type MessageDigestConversationSelection,
} from '../MessageDigestConversationPicker.js';

describe('MessageDigestConversationPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSubject = 'account-a';
    mocks.getAccessToken.mockResolvedValue('test-token');
    mocks.listPrivateWhatsAppChats.mockResolvedValue({
      chats: [groupChat(), directChat(), unknownChat()],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows group/direct metadata, disables unknown sources, and returns only the public selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MessageDigestConversationPicker
        open
        value={null}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    );

    expect(
      await screen.findByRole('dialog', { name: 'Choose a WhatsApp conversation' })
    ).toBeInTheDocument();
    expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledWith('test-token', { limit: 50 });
    expect(
      screen.getByRole('button', { name: /Fishing friends.*Group.*8 participants.*124 messages/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alex.*Direct.*42 messages/i })).toBeInTheDocument();
    const unsupported = screen.getByRole('button', {
      name: /Imported chat.*Unsupported conversation type/i,
    });
    expect(unsupported).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Alex.*Direct.*42 messages/i }));
    expect(screen.getByRole('button', { name: /Alex.*Direct.*42 messages/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'Use conversation' }));

    expect(onSelect).toHaveBeenCalledWith({
      chatId: 'chat-direct',
      chatType: 'direct',
      displayName: 'Alex',
      messageCount: 42,
      participantCount: 1,
      lastActivityAt: '2026-07-27T09:00:00.000Z',
    });
    expect(Object.keys(onSelect.mock.calls[0]?.[0] as object)).toEqual([
      'chatId',
      'chatType',
      'displayName',
      'messageCount',
      'participantCount',
      'lastActivityAt',
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('supports keyboard-only unique selection, enables Use only after selection, and restores focus', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PickerHarness onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Choose conversation' });
    await user.click(trigger);

    const group = await screen.findByRole('button', { name: /Fishing friends.*Group/i });
    const direct = screen.getByRole('button', { name: /Alex.*Direct/i });
    const useConversation = screen.getByRole('button', { name: 'Use conversation' });
    expect(useConversation).toBeDisabled();

    group.focus();
    await user.keyboard('{Enter}');
    expect(group).toHaveAttribute('aria-pressed', 'true');
    expect(direct).toHaveAttribute('aria-pressed', 'false');
    direct.focus();
    await user.keyboard('{Enter}');
    expect(group).toHaveAttribute('aria-pressed', 'false');
    expect(direct).toHaveAttribute('aria-pressed', 'true');
    expect(useConversation).toBeEnabled();

    useConversation.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({
      chatId: 'chat-direct',
      chatType: 'direct',
      displayName: 'Alex',
      messageCount: 42,
      participantCount: 1,
      lastActivityAt: '2026-07-27T09:00:00.000Z',
    });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('filters loaded conversations by search and All, Groups, or Direct tabs', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('button', { name: /Fishing friends/i });
    expect(screen.getByText('Search conversations')).not.toHaveClass('sr-only');

    await user.click(screen.getByRole('button', { name: 'Groups' }));
    expect(screen.getByRole('button', { name: /Fishing friends/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alex.*Direct/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Direct' }));
    expect(screen.getByRole('button', { name: /Alex.*Direct/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fishing friends/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'fish');
    expect(screen.getByRole('button', { name: /Fishing friends/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alex.*Direct/i })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search conversations' }));
    expect(screen.getByRole('button', { name: /Alex.*Direct/i })).toBeInTheDocument();
  });

  it('loads cursor pages once, deduplicates chats, and keeps long names wrapped', async () => {
    const user = userEvent.setup();
    mocks.listPrivateWhatsAppChats
      .mockResolvedValueOnce({ chats: [groupChat()], nextCursor: 'cursor-two' })
      .mockResolvedValueOnce({
        chats: [groupChat(), directChat('A very long conversation name that must wrap safely')],
      });
    renderPicker();
    await screen.findByRole('button', { name: /Fishing friends/i });

    await user.click(screen.getByRole('button', { name: 'Load more conversations' }));

    expect(mocks.listPrivateWhatsAppChats).toHaveBeenLastCalledWith('test-token', {
      limit: 50,
      cursor: 'cursor-two',
    });
    expect(screen.getAllByRole('button', { name: /Fishing friends/i })).toHaveLength(1);
    expect(screen.getByText('A very long conversation name that must wrap safely')).toHaveClass(
      'break-words'
    );
    expect(
      screen.queryByRole('button', { name: 'Load more conversations' })
    ).not.toBeInTheDocument();
  });

  it('keeps initial and pagination errors distinct and supports retry', async () => {
    const user = userEvent.setup();
    mocks.listPrivateWhatsAppChats
      .mockRejectedValueOnce(new Error('Chats unavailable'))
      .mockResolvedValueOnce({ chats: [groupChat()], nextCursor: 'cursor-two' })
      .mockRejectedValueOnce(new Error('More chats unavailable'));
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('Chats unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Fishing friends/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more conversations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('More chats unavailable');
    expect(screen.getByRole('button', { name: /Fishing friends/i })).toBeInTheDocument();
  });

  it('shows no-chat and no-match states without enabling confirmation', async () => {
    const user = userEvent.setup();
    mocks.listPrivateWhatsAppChats.mockResolvedValueOnce({ chats: [] });
    const first = renderPicker();
    expect(await screen.findByText('No mirrored conversations yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use conversation' })).toBeDisabled();
    first.unmount();

    mocks.listPrivateWhatsAppChats.mockResolvedValueOnce({ chats: [groupChat()] });
    renderPicker();
    await screen.findByRole('button', { name: /Fishing friends/i });
    await user.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'missing');
    expect(screen.getByText('No conversations match')).toBeInTheDocument();
  });

  it('closes on Cancel and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    const trigger = screen.getByRole('button', { name: 'Choose conversation' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Choose a WhatsApp conversation' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a selected row across close and reopen when supplied by the form', async () => {
    const user = userEvent.setup();
    const value: MessageDigestConversationSelection = {
      chatId: 'chat-group',
      chatType: 'group',
      displayName: 'Fishing friends',
      messageCount: 12,
      participantCount: 4,
      lastActivityAt: '2026-07-27T11:00:00.000Z',
    };
    const { rerender } = render(
      <MessageDigestConversationPicker
        open
        value={value}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    const selected = await screen.findByRole('button', { name: /Fishing friends/i });
    expect(selected).toHaveAttribute('aria-pressed', 'true');

    rerender(
      <MessageDigestConversationPicker
        open={false}
        value={value}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    rerender(
      <MessageDigestConversationPicker
        open
        value={value}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(await screen.findByRole('button', { name: /Fishing friends/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(user).toBeDefined();
  });

  it('discards stale conversations when the authenticated account changes', async () => {
    const priorAccount = deferred<{ chats: PrivateWhatsAppChat[] }>();
    mocks.listPrivateWhatsAppChats
      .mockReturnValueOnce(priorAccount.promise)
      .mockResolvedValueOnce({ chats: [directChat('Account B conversation')] });
    const view = renderPicker();
    expect(screen.getByRole('status')).toHaveTextContent('Loading conversations');
    await waitFor(() => expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledTimes(1));

    mocks.authSubject = 'account-b';
    view.rerender(
      <MessageDigestConversationPicker
        open
        value={null}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(
      await screen.findByRole('button', { name: /Account B conversation.*Direct/i })
    ).toBeInTheDocument();
    priorAccount.resolve({ chats: [groupChat()] });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Fishing friends.*Group/i })).not.toBeInTheDocument();
    });
  });
});

function renderPicker(): ReturnType<typeof render> {
  return render(
    <MessageDigestConversationPicker open value={null} onOpenChange={vi.fn()} onSelect={vi.fn()} />
  );
}

function PickerHarness({ onSelect = vi.fn() }: { onSelect?: ReturnType<typeof vi.fn> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={(): void => setOpen(true)}>
        Choose conversation
      </button>
      <MessageDigestConversationPicker
        open={open}
        value={null}
        returnFocusRef={triggerRef}
        onOpenChange={setOpen}
        onSelect={onSelect}
      />
    </>
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise?.(value);
    },
  };
}

function groupChat(): PrivateWhatsAppChat {
  return {
    id: 'chat-group',
    chatType: 'group',
    displayName: 'Fishing friends',
    messageCount: 124,
    participantCount: 8,
    firstSeenAt: '2026-07-20T08:00:00.000Z',
    lastEventAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
  };
}

function directChat(displayName = 'Alex'): PrivateWhatsAppChat {
  return {
    id: 'chat-direct',
    chatType: 'direct',
    displayName,
    messageCount: 42,
    participantCount: 1,
    firstSeenAt: '2026-07-21T08:00:00.000Z',
    lastEventAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
  };
}

function unknownChat(): PrivateWhatsAppChat {
  return {
    id: 'chat-unknown',
    chatType: 'unknown',
    displayName: 'Imported chat',
    messageCount: 3,
    participantCount: 0,
    firstSeenAt: '2026-07-22T08:00:00.000Z',
    lastEventAt: '2026-07-27T08:00:00.000Z',
    updatedAt: '2026-07-27T08:00:00.000Z',
  };
}
