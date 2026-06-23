/**
 * Tests for the private WhatsApp read-only log hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PrivateWhatsAppMessage,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderDay,
} from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listPrivateWhatsAppSenders: vi.fn(),
  listPrivateWhatsAppMessages: vi.fn(),
  listPrivateWhatsAppSenderDays: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/whatsappApi', () => ({
  listPrivateWhatsAppSenders: mocks.listPrivateWhatsAppSenders,
  listPrivateWhatsAppMessages: mocks.listPrivateWhatsAppMessages,
  listPrivateWhatsAppSenderDays: mocks.listPrivateWhatsAppSenderDays,
}));

import { usePrivateWhatsAppLog } from '../usePrivateWhatsAppLog.js';

const senderA: PrivateWhatsAppSender = {
  id: 'sender-a',
  senderKey: 'phone:+48123456789',
  senderDisplayName: 'Alice',
  senderPhoneNumber: '+48123456789',
  senderPhoneNumberNormalized: '48123456789',
  firstEventAt: '2026-06-22T08:00:00.000Z',
  lastEventAt: '2026-06-22T09:00:00.000Z',
  messageCount: 2,
  chatIds: ['chat-a'],
  updatedAt: '2026-06-22T09:01:00.000Z',
  schemaVersion: 2,
};

const senderB: PrivateWhatsAppSender = {
  id: 'sender-b',
  senderKey: 'matrix:@sender:home-dev',
  firstEventAt: '2026-06-21T08:00:00.000Z',
  lastEventAt: '2026-06-21T09:00:00.000Z',
  messageCount: 1,
  chatIds: ['chat-b'],
  updatedAt: '2026-06-21T09:01:00.000Z',
  schemaVersion: 2,
};

const messageA: PrivateWhatsAppMessage = {
  id: 'msg-a',
  chatId: 'chat-a',
  senderKey: senderA.senderKey,
  senderDisplayName: 'Alice',
  senderPhoneNumber: '+48123456789',
  direction: 'incoming',
  messageType: 'text',
  text: 'hello from Alice',
  eventTimestamp: '2026-06-22T09:00:00.000Z',
  eventDayKey: '2026-06-22',
  eventTimeZone: 'Europe/Warsaw',
  receivedAt: '2026-06-22T09:00:02.000Z',
  ingestedAt: '2026-06-22T09:00:03.000Z',
  deliveryMode: 'live',
  schemaVersion: 2,
};

const dayA: PrivateWhatsAppSenderDay = {
  id: 'day-a',
  senderKey: senderA.senderKey,
  eventDayKey: '2026-06-22',
  eventTimeZone: 'Europe/Warsaw',
  senderDisplayName: 'Alice',
  senderPhoneNumber: '+48123456789',
  firstEventAt: '2026-06-22T08:00:00.000Z',
  lastEventAt: '2026-06-22T09:00:00.000Z',
  messageCount: 2,
  messageTypeCounts: { text: 2 },
  summaryStatus: 'not_started',
  summarySourceMessageCount: 0,
  updatedAt: '2026-06-22T09:01:00.000Z',
  schemaVersion: 2,
};

function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <MemoryRouter initialEntries={['/whatsapp/private']}>{children}</MemoryRouter>;
}

describe('usePrivateWhatsAppLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('tok');
    mocks.listPrivateWhatsAppSenders.mockResolvedValue({
      senders: [senderA, senderB],
      nextCursor: 'senders-next',
    });
    mocks.listPrivateWhatsAppMessages.mockResolvedValue({
      messages: [messageA],
      nextCursor: 'messages-next',
    });
    mocks.listPrivateWhatsAppSenderDays.mockResolvedValue({
      senderDays: [dayA],
    });
  });

  it('loads senders, auto-selects the first sender, and loads messages plus day aggregates', async () => {
    const { result } = renderHook(() => usePrivateWhatsAppLog(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedSender?.senderKey).toBe(senderA.senderKey);
    });

    expect(result.current.senders).toEqual([senderA, senderB]);
    expect(result.current.messages).toEqual([messageA]);
    expect(result.current.senderDays).toEqual([dayA]);
    expect(mocks.listPrivateWhatsAppSenders).toHaveBeenCalledWith('tok', { limit: 50 });
    expect(mocks.listPrivateWhatsAppMessages).toHaveBeenCalledWith('tok', {
      senderKey: senderA.senderKey,
      limit: 50,
    });
    expect(mocks.listPrivateWhatsAppSenderDays).toHaveBeenCalledWith('tok', {
      senderKey: senderA.senderKey,
      limit: 60,
    });
  });

  it('selecting a day reloads messages with eventDayKey', async () => {
    const { result } = renderHook(() => usePrivateWhatsAppLog(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedSender?.senderKey).toBe(senderA.senderKey);
    });

    await act(async () => {
      result.current.selectDay('2026-06-22');
    });

    await waitFor(() => {
      expect(mocks.listPrivateWhatsAppMessages).toHaveBeenLastCalledWith('tok', {
        senderKey: senderA.senderKey,
        eventDayKey: '2026-06-22',
        limit: 50,
      });
    });
    expect(result.current.selectedDay).toBe('2026-06-22');
  });
});
