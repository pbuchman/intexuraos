/**
 * Tests for the WhatsApp Conversation Assistant page.
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ConversationAssistantModels,
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
} from '@intexuraos/llm-contract';
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
        modelDisplayName: 'Gemini 3.5 Flash Thinking',
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
    selectedModel: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    fromDateTimeLocal: '2026-06-20T09:00',
    toDateTimeLocal: '2026-06-21T10:00',
    firstQuestion: '',
    followUpQuestion: '',
    loading: false,
    loadingTurns: false,
    creating: false,
    checkingContext: false,
    sending: false,
    exporting: false,
    error: null,
    largeContextWarning: null,
    selectSession: vi.fn(),
    selectChat: vi.fn(),
    selectModel: vi.fn(),
    setFromDateTimeLocal: vi.fn(),
    setToDateTimeLocal: vi.fn(),
    setFirstQuestion: vi.fn(),
    setFollowUpQuestion: vi.fn(),
    createSession: vi.fn(),
    confirmLargeContextCreate: vi.fn(),
    dismissLargeContextWarning: vi.fn(),
    sendFollowUp: vi.fn(),
    exportSelectedSessionPdf: vi.fn(),
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
    expect(screen.getByLabelText('Model')).toHaveValue(DEFAULT_CONVERSATION_ASSISTANT_MODEL);
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-20T09:00');
    expect(screen.getByLabelText('To')).toHaveValue('2026-06-21T10:00');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('updates the selected model through the creation selector', async () => {
    const user = userEvent.setup();
    const selectModel = vi.fn();
    mockUseAssistant.mockReturnValue(createHookResult({ selectModel }));

    render(<WhatsAppConversationAssistantPage />);

    await user.selectOptions(screen.getByLabelText('Model'), ConversationAssistantModels.ClaudeSonnet5);

    expect(selectModel).toHaveBeenCalledWith(ConversationAssistantModels.ClaudeSonnet5);
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
            text: 'The selected context shows agreement on **Friday**.\n\n- Bring docs',
            createdAt: '2026-06-21T11:02:00.000Z',
          },
        ],
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByText('What did we agree?')).toBeInTheDocument();
    expect(screen.getByText('Friday').tagName).toBe('STRONG');
    expect(screen.getByText('Bring docs')).toBeInTheDocument();
    expect(screen.getByText('9 messages')).toBeInTheDocument();
    expect(screen.getAllByText('Gemini 3.5 Flash Thinking').length).toBeGreaterThan(0);
    expect(screen.getByText('6 omitted')).toBeInTheDocument();
    expect(screen.getByText(/non-text 3/i)).toBeInTheDocument();
    expect(screen.getByText(/over limit 0/i)).toBeInTheDocument();
    expect(screen.getByText(/abc123/i)).toBeInTheDocument();
  });

  it('forces bottom-follow mode back on while a send is in progress', () => {
    const result = createHookResult();
    const firstTurn = {
      id: 'turn-user',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user' as const,
      text: 'What did we agree?',
      createdAt: '2026-06-21T11:01:00.000Z',
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        turns: [firstTurn],
      })
    );

    const { getByTestId, rerender } = render(<WhatsAppConversationAssistantPage />);
    const turnsContainer = getByTestId('conversation-assistant-turns');
    Object.defineProperties(turnsContainer, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    turnsContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(turnsContainer.scrollTop).toBe(0);

    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        sending: true,
        turns: [
          firstTurn,
          {
            id: 'turn-assistant',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'assistant',
            text: 'Streaming answer.',
            createdAt: '2026-06-21T11:02:00.000Z',
          },
        ],
      })
    );
    rerender(<WhatsAppConversationAssistantPage />);

    expect(turnsContainer.scrollTop).toBe(400);
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

  it('disables Export PDF when no selected session is loaded', () => {
    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });

  it('disables Export PDF until the selected session has completed turns', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        turns: [],
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });

  it('disables Export PDF while a follow-up send is in progress', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        sending: true,
        turns: [
          {
            id: 'turn-user',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'user',
            text: 'What did we agree?',
            createdAt: '2026-06-21T11:01:00.000Z',
          },
        ],
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });

  it('exports selected session through the hook action', async () => {
    const user = userEvent.setup();
    const exportSelectedSessionPdf = vi.fn();
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
        ],
        exportSelectedSessionPdf,
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    const exportButton = screen.getByRole('button', { name: 'Export PDF' });
    expect(exportButton).toBeEnabled();

    await user.click(exportButton);

    expect(exportSelectedSessionPdf).toHaveBeenCalledTimes(1);
  });

  it('shows Exporting state while a PDF export is in flight', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSession: result.sessions[0],
        exporting: true,
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('button', { name: 'Exporting' })).toBeDisabled();
  });

  it('renders large-context confirmation actions', async () => {
    const user = userEvent.setup();
    const confirmLargeContextCreate = vi.fn();
    const dismissLargeContextWarning = vi.fn();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        largeContextWarning: {
          messageCount: 5001,
          warningThreshold: 5000,
          requiresConfirmation: true,
        },
        confirmLargeContextCreate,
        dismissLargeContextWarning,
      })
    );

    render(<WhatsAppConversationAssistantPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('5,001 messages');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmLargeContextCreate).toHaveBeenCalledTimes(1);
    expect(dismissLargeContextWarning).toHaveBeenCalledTimes(1);
  });
});
