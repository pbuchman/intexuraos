/**
 * Tests for the private WhatsApp read-only log hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateWhatsAppChat, PrivateWhatsAppMessage } from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listPrivateWhatsAppChats: vi.fn(),
  listPrivateWhatsAppChatMessages: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/whatsappApi', () => ({
  listPrivateWhatsAppChats: mocks.listPrivateWhatsAppChats,
  listPrivateWhatsAppChatMessages: mocks.listPrivateWhatsAppChatMessages,
}));

import { usePrivateWhatsAppLog } from '../usePrivateWhatsAppLog.js';

const groupChat: PrivateWhatsAppChat = {
  id: 'chat-group',
  displayName: 'Fishing Crew (WA)',
  chatType: 'group',
  firstEventAt: '2026-06-22T08:00:00.000Z',
  lastEventAt: '2026-06-22T09:00:00.000Z',
  messageCount: 3,
  participantCount: 2,
  updatedAt: '2026-06-22T09:01:00.000Z',
  schemaVersion: 2,
};

const directChat: PrivateWhatsAppChat = {
  id: 'chat-direct',
  displayName: 'Alice (WA)',
  chatType: 'direct',
  firstEventAt: '2026-06-21T08:00:00.000Z',
  lastEventAt: '2026-06-21T09:00:00.000Z',
  messageCount: 1,
  participantCount: 1,
  updatedAt: '2026-06-21T09:01:00.000Z',
  schemaVersion: 2,
};

const groupIncomingMessage: PrivateWhatsAppMessage = {
  id: 'msg-group-incoming',
  chatId: groupChat.id,
  chatDisplayName: groupChat.displayName,
  chatType: groupChat.chatType,
  senderKey: 'phone:+48123456789',
  senderDisplayName: 'Monika (WA)',
  senderPhoneNumber: '+48123456789',
  direction: 'incoming',
  messageType: 'text',
  text: 'hello from the group',
  eventTimestamp: '2026-06-22T09:00:00.000Z',
  eventDayKey: '2026-06-22',
  eventTimeZone: 'Europe/Warsaw',
  receivedAt: '2026-06-22T09:00:02.000Z',
  ingestedAt: '2026-06-22T09:00:03.000Z',
  deliveryMode: 'live',
  schemaVersion: 2,
};

const groupOutgoingMessage: PrivateWhatsAppMessage = {
  id: 'msg-group-outgoing',
  chatId: groupChat.id,
  chatDisplayName: groupChat.displayName,
  chatType: groupChat.chatType,
  senderKey: 'matrix:@pbuchman:home-dev',
  senderDisplayName: 'You',
  direction: 'outgoing',
  messageType: 'text',
  text: 'sent by me',
  eventTimestamp: '2026-06-22T09:01:00.000Z',
  eventDayKey: '2026-06-22',
  eventTimeZone: 'Europe/Warsaw',
  receivedAt: '2026-06-22T09:01:02.000Z',
  ingestedAt: '2026-06-22T09:01:03.000Z',
  deliveryMode: 'live',
  schemaVersion: 2,
};

const directMessage: PrivateWhatsAppMessage = {
  id: 'msg-direct',
  chatId: directChat.id,
  chatDisplayName: directChat.displayName,
  chatType: directChat.chatType,
  senderKey: 'matrix:@sender:home-dev',
  direction: 'incoming',
  messageType: 'text',
  text: 'hello from direct chat',
  eventTimestamp: '2026-06-21T09:00:00.000Z',
  eventDayKey: '2026-06-21',
  eventTimeZone: 'Europe/Warsaw',
  receivedAt: '2026-06-21T09:00:02.000Z',
  ingestedAt: '2026-06-21T09:00:03.000Z',
  deliveryMode: 'live',
  schemaVersion: 2,
};

function createWrapper(initialEntry = '/whatsapp/private') {
  return function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('usePrivateWhatsAppLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('tok');
    mocks.listPrivateWhatsAppChats.mockResolvedValue({
      chats: [groupChat, directChat],
      nextCursor: 'chats-next',
    });
    mocks.listPrivateWhatsAppChatMessages.mockResolvedValue({
      messages: [groupIncomingMessage, groupOutgoingMessage],
      nextCursor: 'messages-next',
    });
  });

  it('loads chats, auto-selects the first chat, and loads the whole conversation', async () => {
    const { result } = renderHook(() => usePrivateWhatsAppLog(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.selectedChat?.id).toBe(groupChat.id);
    });

    expect(result.current.chats).toEqual([groupChat, directChat]);
    expect(result.current.messages).toEqual([groupIncomingMessage, groupOutgoingMessage]);
    expect(result.current.availableDays).toEqual(['2026-06-22']);
    expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledWith('tok', { limit: 50 });
    expect(mocks.listPrivateWhatsAppChatMessages).toHaveBeenCalledWith('tok', {
      chatId: groupChat.id,
      limit: 50,
    });
  });

  it('selecting a day reloads messages with eventDayKey', async () => {
    const { result } = renderHook(() => usePrivateWhatsAppLog(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.selectedChat?.id).toBe(groupChat.id);
    });

    await act(async () => {
      result.current.selectDay('2026-06-22');
    });

    await waitFor(() => {
      expect(mocks.listPrivateWhatsAppChatMessages).toHaveBeenLastCalledWith('tok', {
        chatId: groupChat.id,
        eventDayKey: '2026-06-22',
        limit: 50,
      });
    });
    expect(result.current.selectedDay).toBe('2026-06-22');
  });

  it('ignores stale message responses after the selected chat changes', async () => {
    const groupRequest = createDeferred<{ messages: PrivateWhatsAppMessage[] }>();
    mocks.listPrivateWhatsAppChatMessages.mockImplementation(
      (_token: string, options: { chatId: string }) => {
        if (options.chatId === groupChat.id) {
          return groupRequest.promise;
        }
        return Promise.resolve({ messages: [directMessage] });
      }
    );

    const { result } = renderHook(() => usePrivateWhatsAppLog(), {
      wrapper: createWrapper('/whatsapp/private?chat=chat-group'),
    });

    await waitFor(() => {
      expect(result.current.selectedChat?.id).toBe(groupChat.id);
    });

    await act(async () => {
      result.current.selectChat(directChat.id);
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([directMessage]);
    });

    await act(async () => {
      groupRequest.resolve({ messages: [groupIncomingMessage] });
      await groupRequest.promise;
    });

    expect(result.current.selectedChatId).toBe(directChat.id);
    expect(result.current.messages).toEqual([directMessage]);
  });
});
