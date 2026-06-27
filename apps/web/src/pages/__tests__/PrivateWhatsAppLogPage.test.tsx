/**
 * Tests for the private WhatsApp read-only log page.
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsePrivateWhatsAppLogResult } from '@/hooks/usePrivateWhatsAppLog';

const mockUsePrivateWhatsAppLog = vi.fn();

vi.mock('@/hooks/usePrivateWhatsAppLog', () => ({
  usePrivateWhatsAppLog: (): UsePrivateWhatsAppLogResult => mockUsePrivateWhatsAppLog(),
}));

vi.mock('@/components/whatsapp/PrivateWhatsAppImagePreview', () => ({
  PrivateWhatsAppImagePreview: ({ message }: { message: { id: string } }): React.JSX.Element => (
    <div data-testid="private-whatsapp-image-preview">{message.id}</div>
  ),
}));

vi.mock('@/components', async () => {
  const actual = await vi.importActual<typeof import('@/components')>('@/components');
  return {
    ...actual,
    Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <div>{children}</div>
    ),
  };
});

vi.mock('@/utils/dateFormat', () => ({
  formatDate: (value: string): string => `utc-helper:${value}`,
  formatDateTimeCompact: (): string => 'Jun 22, 2026, 09:00 AM',
  formatRelative: (): string => 'recent',
}));

import { PrivateWhatsAppLogPage } from '../PrivateWhatsAppLogPage.js';

function createHookResult(
  overrides: Partial<UsePrivateWhatsAppLogResult> = {}
): UsePrivateWhatsAppLogResult {
  return {
    chats: [
      {
        id: 'chat-group',
        displayName: 'Fishing Crew (WA)',
        chatType: 'group',
        firstEventAt: '2026-06-22T08:00:00.000Z',
        lastEventAt: '2026-06-22T09:00:00.000Z',
        messageCount: 3,
        participantCount: 2,
        updatedAt: '2026-06-22T09:01:00.000Z',
        schemaVersion: 2,
      },
    ],
    filteredChats: [
      {
        id: 'chat-group',
        displayName: 'Fishing Crew (WA)',
        chatType: 'group',
        firstEventAt: '2026-06-22T08:00:00.000Z',
        lastEventAt: '2026-06-22T09:00:00.000Z',
        messageCount: 3,
        participantCount: 2,
        updatedAt: '2026-06-22T09:01:00.000Z',
        schemaVersion: 2,
      },
    ],
    selectedChat: {
      id: 'chat-group',
      displayName: 'Fishing Crew (WA)',
      chatType: 'group',
      firstEventAt: '2026-06-22T08:00:00.000Z',
      lastEventAt: '2026-06-22T09:00:00.000Z',
      messageCount: 3,
      participantCount: 2,
      updatedAt: '2026-06-22T09:01:00.000Z',
      schemaVersion: 2,
    },
    selectedChatId: 'chat-group',
    selectedDay: undefined,
    chatSearch: '',
    messages: [
      {
        id: 'msg-incoming',
        chatId: 'chat-group',
        chatDisplayName: 'Fishing Crew (WA)',
        chatType: 'group',
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
      },
      {
        id: 'msg-outgoing',
        chatId: 'chat-group',
        chatDisplayName: 'Fishing Crew (WA)',
        chatType: 'group',
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
      },
    ],
    availableDays: ['2026-06-22'],
    chatCursor: undefined,
    messageCursor: undefined,
    loadingChats: false,
    loadingMessages: false,
    loadingMoreChats: false,
    loadingMoreMessages: false,
    refreshing: false,
    error: null,
    setChatSearch: vi.fn(),
    selectChat: vi.fn(),
    selectDay: vi.fn(),
    clearDay: vi.fn(),
    refresh: vi.fn(),
    loadMoreChats: vi.fn(),
    loadMoreMessages: vi.fn(),
    ...overrides,
  };
}

describe('PrivateWhatsAppLogPage', () => {
  beforeEach(() => {
    mockUsePrivateWhatsAppLog.mockReturnValue(createHookResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a read-only conversation-first log with group participants and outgoing messages', () => {
    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /private whatsapp/i })).toBeInTheDocument();
    expect(screen.getAllByText('Fishing Crew (WA)')).not.toHaveLength(0);
    expect(screen.getByText('Monika (WA)')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('hello from the group')).toBeInTheDocument();
    expect(screen.getByText('sent by me')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026-06-22/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Reply$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Delete$/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/send a message/i)).not.toBeInTheDocument();
  });

  it('uses the full work surface with a mobile-bounded chat rail', () => {
    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('private-whatsapp-log-shell')).toHaveClass('w-full', 'min-w-0');
    expect(screen.getByTestId('private-whatsapp-log-shell')).not.toHaveClass('max-w-7xl');
    expect(screen.getByTestId('private-whatsapp-chat-rail')).toHaveClass(
      'max-h-[45vh]',
      'xl:max-h-none'
    );
    expect(screen.getByTestId('private-whatsapp-message-timeline')).toHaveClass('min-w-0');
  });

  it('uses day chips to filter messages by exact eventDayKey', async () => {
    const user = userEvent.setup();
    const selectDay = vi.fn();
    mockUsePrivateWhatsAppLog.mockReturnValueOnce(createHookResult({ selectDay }));

    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /2026-06-22/ }));

    expect(selectDay).toHaveBeenCalledWith('2026-06-22');
  });

  it('formats event day headers from the logical day key without UTC timezone shifting', () => {
    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Jun 22, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/utc-helper:/)).not.toBeInTheDocument();
  });

  it('renders stored private images with captions while old images stay placeholders', () => {
    mockUsePrivateWhatsAppLog.mockReturnValueOnce(
      createHookResult({
        messages: [
          {
            id: 'stored-image',
            chatId: 'chat-group',
            direction: 'incoming',
            messageType: 'image',
            text: 'stored image',
            media: {
              mxcUri: 'mxc://home-dev/stored',
              mimeType: 'image/jpeg',
              fileName: 'stored.jpg',
              storageStatus: 'stored',
              hasMedia: true,
              hasThumbnail: true,
            },
            eventTimestamp: '2026-06-22T09:00:00.000Z',
            eventDayKey: '2026-06-22',
            receivedAt: '2026-06-22T09:00:02.000Z',
            ingestedAt: '2026-06-22T09:00:03.000Z',
            deliveryMode: 'live',
          },
          {
            id: 'old-placeholder-image',
            chatId: 'chat-group',
            direction: 'incoming',
            messageType: 'image',
            media: {
              mxcUri: 'mxc://home-dev/old',
              mimeType: 'image/jpeg',
              fileName: 'image.jpg',
            },
            eventTimestamp: '2026-06-22T09:01:00.000Z',
            eventDayKey: '2026-06-22',
            receivedAt: '2026-06-22T09:01:02.000Z',
            ingestedAt: '2026-06-22T09:01:03.000Z',
            deliveryMode: 'live',
          },
          {
            id: 'stored-original-without-thumbnail',
            chatId: 'chat-group',
            direction: 'incoming',
            messageType: 'image',
            media: {
              mxcUri: 'mxc://home-dev/original-only',
              mimeType: 'image/jpeg',
              fileName: 'original-only.jpg',
              storageStatus: 'stored',
              hasMedia: true,
              hasThumbnail: false,
            },
            eventTimestamp: '2026-06-22T09:02:00.000Z',
            eventDayKey: '2026-06-22',
            receivedAt: '2026-06-22T09:02:02.000Z',
            ingestedAt: '2026-06-22T09:02:03.000Z',
            deliveryMode: 'live',
          },
        ],
      })
    );

    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('private-whatsapp-image-preview')).toHaveTextContent('stored-image');
    expect(screen.getByText('stored image')).toBeInTheDocument();
    expect(screen.getByText('image.jpg')).toBeInTheDocument();
    expect(screen.getByText('original-only.jpg')).toBeInTheDocument();
  });
});
