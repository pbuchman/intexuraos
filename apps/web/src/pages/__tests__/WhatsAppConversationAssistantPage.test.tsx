/**
 * Tests for the WhatsApp Conversation Assistant page.
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseWhatsAppConversationAssistantResult } from '@/hooks/useWhatsAppConversationAssistant';

const mockUseAssistant = vi.fn();

vi.mock('@/hooks/useWhatsAppConversationAssistant', () => ({
  useWhatsAppConversationAssistant: (): UseWhatsAppConversationAssistantResult => mockUseAssistant(),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <main>{children}</main>
  ),
}));

import { WhatsAppConversationAssistantPage } from '../WhatsAppConversationAssistantPage.js';

function createHookResult(
  overrides: Partial<UseWhatsAppConversationAssistantResult> = {}
): UseWhatsAppConversationAssistantResult {
  return {
    sessions: [
      {
        id: 'session-1',
        userId: 'user-1',
        chatId: 'chat-direct',
        chatDisplayName: 'Alice',
        status: 'active',
        range: {
          from: '2026-06-20T09:00:00.000Z',
          to: '2026-06-21T10:00:00.000Z',
        },
        model: 'or:google/gemini-3.5-flash',
        transcriptSha256: 'abc123',
        transcriptMessageCount: 9,
        omitted: {
          mediaOnly: 2,
          failedTranscriptions: 1,
          pendingTranscriptions: 0,
          nonText: 3,
          overLimit: 0,
        },
        title: 'Alice context',
        createdAt: '2026-06-21T11:00:00.000Z',
        updatedAt: '2026-06-21T11:05:00.000Z',
        lastTurnAt: '2026-06-21T11:05:00.000Z',
      },
    ],
    selectedSessionId: undefined,
    selectedSession: undefined,
    turns: [],
    directChats: [
      {
        id: 'chat-direct',
        chatType: 'direct',
        displayName: 'Alice',
        messageCount: 12,
        participantCount: 1,
        firstSeenAt: '2026-06-20T09:00:00.000Z',
        lastEventAt: '2026-06-21T10:00:00.000Z',
        updatedAt: '2026-06-21T10:00:00.000Z',
      },
    ],
    selectedChatId: 'chat-direct',
    fromDateTimeLocal: '2026-06-20T09:00',
    toDateTimeLocal: '2026-06-21T10:00',
    firstQuestion: '',
    followUpQuestion: '',
    loading: false,
    loadingTurns: false,
    creating: false,
    sending: false,
    error: null,
    selectSession: vi.fn(),
    selectChat: vi.fn(),
    setFromDateTimeLocal: vi.fn(),
    setToDateTimeLocal: vi.fn(),
    setFirstQuestion: vi.fn(),
    setFollowUpQuestion: vi.fn(),
    createSession: vi.fn(),
    sendFollowUp: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe('WhatsAppConversationAssistantPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssistant.mockReturnValue(createHookResult());
  });

  it('renders session rail, setup controls, metadata, and disabled composer without a selected session', () => {
    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('heading', { name: 'Conversation Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice context/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Private direct chat')).toHaveValue('chat-direct');
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-20T09:00');
    expect(screen.getByLabelText('To')).toHaveValue('2026-06-21T10:00');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('renders selected session timeline and source metadata', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        turns: [
          {
            id: 'turn-user',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'user',
            text: 'What did we agree?',
            createdAt: '2026-06-21T11:01:00.000Z',
          },
          {
            id: 'turn-assistant',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'assistant',
            text: 'The selected context shows agreement on Friday.',
            createdAt: '2026-06-21T11:02:00.000Z',
          },
        ],
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByText('What did we agree?')).toBeInTheDocument();
    expect(screen.getByText('The selected context shows agreement on Friday.')).toBeInTheDocument();
    expect(screen.getByText('9 messages')).toBeInTheDocument();
    expect(screen.getByText('6 omitted')).toBeInTheDocument();
    expect(screen.getByText(/non-text 3/i)).toBeInTheDocument();
    expect(screen.getByText(/over limit 0/i)).toBeInTheDocument();
    expect(screen.getByText(/abc123/i)).toBeInTheDocument();
  });

  it('submits create and follow-up actions through the hook', async () => {
    const user = userEvent.setup();
    const createSession = vi.fn();
    const sendFollowUp = vi.fn();
    const setFollowUpQuestion = vi.fn();
    const result = createHookResult({
      createSession,
      sendFollowUp,
      setFollowUpQuestion,
      firstQuestion: 'First question',
      followUpQuestion: 'Next question',
    });
    mockUseAssistant.mockReturnValue(createHookResult({ ...result, selectedSession: result.sessions[0] }));

    const { container } = render(<WhatsAppConversationAssistantPage />);
    const view = within(container);

    await user.click(view.getByRole('button', { name: 'Create session' }));
    await user.click(view.getByRole('button', { name: 'Send' }));

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
  });
});
