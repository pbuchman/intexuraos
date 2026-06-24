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

describe('PrivateWhatsAppLogPage', () => {
  beforeEach(() => {
    mockUsePrivateWhatsAppLog.mockReturnValue({
      senders: [
        {
          id: 'sender-a',
          senderKey: 'phone:+48123456789',
          senderDisplayName: 'Alice',
          senderPhoneNumber: '+48123456789',
          firstEventAt: '2026-06-22T08:00:00.000Z',
          lastEventAt: '2026-06-22T09:00:00.000Z',
          messageCount: 2,
          chatIds: ['chat-a'],
          updatedAt: '2026-06-22T09:01:00.000Z',
          schemaVersion: 2,
        },
      ],
      filteredSenders: [
        {
          id: 'sender-a',
          senderKey: 'phone:+48123456789',
          senderDisplayName: 'Alice',
          senderPhoneNumber: '+48123456789',
          firstEventAt: '2026-06-22T08:00:00.000Z',
          lastEventAt: '2026-06-22T09:00:00.000Z',
          messageCount: 2,
          chatIds: ['chat-a'],
          updatedAt: '2026-06-22T09:01:00.000Z',
          schemaVersion: 2,
        },
      ],
      selectedSender: {
        id: 'sender-a',
        senderKey: 'phone:+48123456789',
        senderDisplayName: 'Alice',
        senderPhoneNumber: '+48123456789',
        firstEventAt: '2026-06-22T08:00:00.000Z',
        lastEventAt: '2026-06-22T09:00:00.000Z',
        messageCount: 2,
        chatIds: ['chat-a'],
        updatedAt: '2026-06-22T09:01:00.000Z',
        schemaVersion: 2,
      },
      selectedSenderKey: 'phone:+48123456789',
      selectedDay: undefined,
      senderSearch: '',
      messages: [
        {
          id: 'msg-a',
          chatId: 'chat-a',
          senderKey: 'phone:+48123456789',
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
        },
      ],
      senderDays: [
        {
          id: 'day-a',
          senderKey: 'phone:+48123456789',
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
        },
      ],
      senderCursor: undefined,
      messageCursor: undefined,
      loadingSenders: false,
      loadingMessages: false,
      loadingSenderDays: false,
      loadingMoreSenders: false,
      loadingMoreMessages: false,
      refreshing: false,
      error: null,
      setSenderSearch: vi.fn(),
      selectSender: vi.fn(),
      selectDay: vi.fn(),
      clearDay: vi.fn(),
      refresh: vi.fn(),
      loadMoreSenders: vi.fn(),
      loadMoreMessages: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a read-only sender-first message log', () => {
    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /private whatsapp/i })).toBeInTheDocument();
    expect(screen.getAllByText('Alice')).not.toHaveLength(0);
    expect(screen.getByText('hello from Alice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2026-06-22/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Reply$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Delete$/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/send a message/i)).not.toBeInTheDocument();
  });

  it('uses the full work surface with a mobile-bounded sender rail', () => {
    render(
      <MemoryRouter>
        <PrivateWhatsAppLogPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('private-whatsapp-log-shell')).toHaveClass('w-full', 'min-w-0');
    expect(screen.getByTestId('private-whatsapp-log-shell')).not.toHaveClass('max-w-7xl');
    expect(screen.getByTestId('private-whatsapp-sender-rail')).toHaveClass(
      'max-h-[45vh]',
      'xl:max-h-none'
    );
    expect(screen.getByTestId('private-whatsapp-message-timeline')).toHaveClass('min-w-0');
  });

  it('uses day chips to filter messages by exact eventDayKey', async () => {
    const user = userEvent.setup();
    const selectDay = vi.fn();
    mockUsePrivateWhatsAppLog.mockReturnValueOnce({
      ...mockUsePrivateWhatsAppLog(),
      selectDay,
    });

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
});
