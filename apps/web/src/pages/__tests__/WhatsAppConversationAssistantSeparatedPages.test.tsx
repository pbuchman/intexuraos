/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_CONVERSATION_ASSISTANT_MODEL } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseWhatsAppConversationAssistantResult } from '@/hooks/useWhatsAppConversationAssistant';

const mockUseAssistant = vi.fn();

vi.mock('@/hooks/useWhatsAppConversationAssistant', () => ({
  useWhatsAppConversationAssistant: (): UseWhatsAppConversationAssistantResult => mockUseAssistant(),
}));

vi.mock('@/components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <main>{children}</main>,
}));

import { WhatsAppConversationAssistantListPage } from '../WhatsAppConversationAssistantListPage.js';
import { WhatsAppConversationAssistantNewPage } from '../WhatsAppConversationAssistantNewPage.js';
import { WhatsAppConversationAssistantSessionPage } from '../WhatsAppConversationAssistantSessionPage.js';

function createHookResult(
  overrides: Partial<UseWhatsAppConversationAssistantResult> = {}
): UseWhatsAppConversationAssistantResult {
  const session: UseWhatsAppConversationAssistantResult['sessions'][number] = {
    id: 'session-1',
    userId: 'user-1',
    chatId: 'chat-direct',
    chatDisplayName: 'Alice',
    status: 'active',
    range: {
      from: '2026-06-20T09:00:00.000Z',
      to: '2026-06-21T10:00:00.000Z',
    },
    effectiveRange: {
      from: '2026-06-20T09:30:00.000Z',
      to: '2026-06-21T09:45:00.000Z',
    },
    model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    modelDisplayName: 'Gemini 3.5 Flash Thinking',
    assistantRoleLabel: 'Psychologist',
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
  };

  return {
    sessions: [session],
    selectedSessionId: undefined,
    selectedSession: undefined,
    turns: [],
    context: null,
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
    followUpQuestion: '',
    loading: false,
    loadingTurns: false,
    loadingContext: false,
    loadingMoreContext: false,
    creating: false,
    sending: false,
    retryingPreparation: false,
    exporting: false,
    error: null,
    contextError: null,
    selectSession: vi.fn(),
    selectChat: vi.fn(),
    selectModel: vi.fn(),
    setFromDateTimeLocal: vi.fn(),
    setToDateTimeLocal: vi.fn(),
    setFollowUpQuestion: vi.fn(),
    createSession: vi.fn(),
    sendFollowUp: vi.fn(),
    loadContext: vi.fn(),
    loadMoreContext: vi.fn(),
    retryPreparation: vi.fn(),
    exportSelectedSessionPdf: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function firstSession(
  result: UseWhatsAppConversationAssistantResult
): UseWhatsAppConversationAssistantResult['sessions'][number] {
  const session = result.sessions[0];
  if (session === undefined) {
    throw new Error('Expected a session fixture');
  }
  return session;
}

describe('separated Conversation Assistant pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssistant.mockReturnValue(createHookResult());
  });

  afterEach(() => {
    cleanup();
  });

  it('uses the list page only for navigation to analyses and creation', () => {
    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Conversation Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New analysis' })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant/new'
    );
    expect(screen.getByRole('link', { name: /Alice context/i })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant/session-1'
    );
    expect(screen.queryByLabelText('Private direct chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByText('Psychologist')).not.toBeInTheDocument();
    expect(screen.queryByText('Gemini 3.5 Flash Thinking')).not.toBeInTheDocument();
  });

  it('shows compact preparation states in the analysis list', () => {
    const result = createHookResult();
    const baseSession = firstSession(result);
    mockUseAssistant.mockReturnValue(
      createHookResult({
        sessions: [
          {
            ...baseSession,
            status: 'preparing',
            preparationStage: 'building_context',
          },
          {
            ...baseSession,
            id: 'session-failed',
            title: 'Failed analysis',
            status: 'failed',
            preparationStage: 'failed',
          },
        ],
      })
    );

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Preparing')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('redirects legacy session query links to the canonical conversation route', async () => {
    mockUseAssistant.mockReturnValue(createHookResult({ selectedSessionId: 'session-1' }));

    render(
      <MemoryRouter
        initialEntries={['/whatsapp/conversation-assistant?session=session-1']}
      >
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant"
            element={<WhatsAppConversationAssistantListPage />}
          />
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<p>Canonical conversation route</p>}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Canonical conversation route')).toBeInTheDocument();
    });
  });

  it('uses the creation page only for configuring a new analysis', () => {
    mockUseAssistant.mockReturnValue(createHookResult({ selectedChatId: undefined }));

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantNewPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'New analysis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to analyses' })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant'
    );
    expect(screen.getByLabelText('Private direct chat')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Choose a chat' })).toBeDisabled();
    expect(screen.getByLabelText('Model')).toHaveValue(DEFAULT_CONVERSATION_ASSISTANT_MODEL);
    expect(screen.getByLabelText('Selected model')).toHaveTextContent('MiniMax M3');
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-20T09:00');
    expect(screen.getByLabelText('To')).toHaveValue('2026-06-21T10:00');
    expect(screen.getByRole('button', { name: 'Create analysis' })).toBeDisabled();
    expect(screen.queryByPlaceholderText('Optional first question')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice context/i })).not.toBeInTheDocument();
  });

  it('uses the session page only for the selected conversation', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Alice context' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to analyses' })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant'
    );
    expect(screen.getByLabelText('Ask first question')).toBeEnabled();
    expect(screen.getByPlaceholderText('Ask your first question about this conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Model used')).toHaveTextContent('Gemini 3.5 Flash Thinking');
    expect(screen.queryByLabelText('Private direct chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create analysis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice context/i })).not.toBeInTheDocument();
  });

  it('opens the exact frozen messages and omission breakdown from the context summary', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const loadContext = vi.fn();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        context: {
          sessionId: 'session-1',
          messages: [
            {
              id: 'message-1',
              eventTimestamp: '2026-06-20T09:30:00.000Z',
              importedAt: '2026-06-20T09:31:00.000Z',
              direction: 'incoming',
              speakerLabel: 'Alice',
              messageType: 'text',
              contentKind: 'text',
              content: 'The exact message used by the model.',
            },
          ],
          omittedMessages: [
            {
              id: 'message-omitted-1',
              eventTimestamp: '2026-06-20T09:32:00.000Z',
              importedAt: '2026-06-20T09:33:00.000Z',
              direction: 'incoming',
              speakerLabel: 'Alice',
              messageType: 'reaction',
              omissionReason: 'non_text',
              reaction: {
                emoji: '👍',
                targetMessageId: 'message-outside-snapshot',
              },
            },
          ],
          messageCount: 9,
          omittedMessageCount: 6,
          snapshotAvailable: true,
          omitted: firstSession(result).omitted,
          transcriptSha256: 'abc123',
        },
        loadContext,
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    const contextButton = screen.getByRole('button', { name: /View frozen context/i });
    expect(contextButton).toHaveTextContent(/9 messages used · 6 omitted/i);

    await user.click(contextButton);

    expect(loadContext).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Frozen context' })).toBeInTheDocument();
    expect(screen.getByText('The exact message used by the model.')).toBeInTheDocument();
    expect(screen.getByText('Unsupported message type')).toBeInTheDocument();
    expect(
      screen.getByText('Reaction 👍 to message message-outside-snapshot')
    ).toBeInTheDocument();
    expect(screen.getByText('2 media-only messages')).toBeInTheDocument();
  });

  it('shows preparation progress without an irrelevant disabled composer', () => {
    const result = createHookResult();
    const preparingSession = {
      ...firstSession(result),
      status: 'preparing' as const,
      preparationStage: 'loading_messages' as const,
      transcriptMessageCount: 0,
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: preparingSession.id,
        selectedSession: preparingSession,
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Preparing conversation context')).toBeInTheDocument();
    expect(screen.getByText('Loading messages from the selected range...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ask first question')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ask follow-up')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Context: 0 messages used/i)).not.toBeInTheDocument();
  });

  it('shows a failed preparation with an explicit retry action', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const retryPreparation = vi.fn();
    const failedSession = {
      ...firstSession(result),
      status: 'failed' as const,
      preparationStage: 'failed' as const,
      preparationError: { code: 'PERSISTENCE_ERROR', message: 'Could not load messages' },
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: failedSession.id,
        selectedSession: failedSession,
        retryPreparation,
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Context preparation failed')).toBeInTheDocument();
    expect(screen.getByText('Could not load messages')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryPreparation).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Ask first question')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ask follow-up')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('labels the composer as a follow-up after the first user question', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        turns: [
          {
            id: 'turn-user',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'user',
            text: 'What happened?',
            createdAt: '2026-06-21T11:01:00.000Z',
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByLabelText('Ask follow-up')).toBeEnabled();
    expect(screen.getByPlaceholderText('Ask a follow-up question')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ask first question')).not.toBeInTheDocument();
  });

  it('renders persisted turn errors inline with the affected answer', () => {
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        turns: [
          {
            id: 'turn-error',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'assistant',
            text: '',
            createdAt: '2026-06-21T11:02:00.000Z',
            error: { code: 'LLM_ERROR', message: 'Model request failed' },
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('LLM_ERROR: Model request failed')).toBeInTheDocument();
  });

  it('restores bottom-follow mode while an answer is streaming', () => {
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
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        turns: [firstTurn],
      })
    );

    const sessionView = (): React.JSX.Element => (
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );
    const { getByTestId, rerender } = render(sessionView());
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
        selectedSessionId: 'session-1',
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
    rerender(sessionView());

    expect(turnsContainer.scrollTop).toBe(400);
  });
});
