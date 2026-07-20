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
    deletionToken: 'deletion-token-session-1',
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
    turnPhase: 'idle',
    retryingPreparation: false,
    exporting: false,
    deletingSessionId: undefined,
    error: null,
    contextError: null,
    deleteError: null,
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
    deleteSession: vi.fn().mockResolvedValue(true),
    clearDeleteError: vi.fn(),
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
    const analysisLink = screen.getByRole('link', { name: /Alice context/i });
    expect(analysisLink).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant/session-1'
    );
    expect(analysisLink).toHaveTextContent('Jun 20, 11:00 AM – Jun 21, 12:00 PM');
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

  it('shows an interrupted deletion as a retryable state instead of an openable analysis', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const pendingSession = {
      ...firstSession(result),
      deletionPending: true,
    };
    mockUseAssistant.mockReturnValue(createHookResult({ sessions: [pendingSession] }));

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: /Alice context/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Deletion interrupted for Alice context')).toBeInTheDocument();
    expect(screen.getByText('Deletion interrupted')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Finish deletion' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finish deletion?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish deletion' })).toBeInTheDocument();
  });

  it('confirms deletion from the list without nesting the action inside navigation', async () => {
    const user = userEvent.setup();
    const deleteSession = vi.fn().mockResolvedValue(true);
    mockUseAssistant.mockReturnValue(createHookResult({ deleteSession }));

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    const actions = screen.getByRole('button', { name: 'Actions for Alice context' });
    expect(actions).toHaveClass('min-h-11', 'min-w-11');
    expect(actions.closest('a')).toBeNull();
    await user.click(actions);
    const deleteMenuItem = screen.getByRole('menuitem', { name: 'Delete analysis' });
    await waitFor(() => {
      expect(deleteMenuItem).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Delete analysis' })).not.toBeInTheDocument();
    expect(actions).toHaveFocus();

    await user.click(actions);
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete analysis' })).toHaveFocus();
    });
    await user.tab();
    expect(screen.queryByRole('menuitem', { name: 'Delete analysis' })).not.toBeInTheDocument();

    await user.click(actions);
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete analysis' })).toHaveFocus();
    });
    await user.tab({ shift: true });
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Delete analysis' })).not.toBeInTheDocument();
    });
    expect(actions).toHaveFocus();

    await user.click(actions);
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete analysis?' })).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'WhatsApp data safety' })).toHaveTextContent(
      'Original WhatsApp conversation stays untouched.'
    );
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Delete analysis' })).toHaveClass('min-h-11');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(actions).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));

    expect(deleteSession).toHaveBeenCalledWith('session-1', 'deletion-token-session-1');
    expect(await screen.findByRole('status')).toHaveTextContent('Analysis deleted.');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conversation Assistant' })).toHaveFocus();
    });
  });

  it('deletes the exact analysis generation that was shown when the dialog opened', async () => {
    const user = userEvent.setup();
    const deleteSession = vi.fn().mockResolvedValue(true);
    let hookResult = createHookResult({ deleteSession });
    mockUseAssistant.mockImplementation(() => hookResult);
    const view = render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    const replacementSession = {
      ...firstSession(hookResult),
      deletionToken: 'deletion-token-replacement',
      title: 'Replacement analysis',
    };
    hookResult = createHookResult({ sessions: [replacementSession], deleteSession });
    view.rerender(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/permanently removes “Alice context”/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));

    expect(deleteSession).toHaveBeenCalledWith('session-1', 'deletion-token-session-1');
  });

  it('confirms deletion after returning from an open analysis', async () => {
    mockUseAssistant.mockReturnValue(createHookResult({ sessions: [] }));

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/whatsapp/conversation-assistant',
            state: { deletedAnalysisTitle: 'Alice context' },
          },
        ]}
      >
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Analysis deleted.');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conversation Assistant' })).toHaveFocus();
    });
  });

  it('restarts deletion feedback when two analyses are deleted in quick succession', async () => {
    const user = userEvent.setup();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const result = createHookResult();
    const aliceSession = firstSession(result);
    const bobSession = {
      ...aliceSession,
      id: 'session-2',
      chatId: 'chat-bob',
      chatDisplayName: 'Bob',
      title: 'Bob context',
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({ sessions: [aliceSession, bobSession] })
    );

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));
    const firstStatus = screen.getByRole('status');
    expect(firstStatus).toHaveTextContent('Analysis deleted.');

    await user.click(screen.getByRole('button', { name: 'Actions for Bob context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));
    expect(screen.getByRole('status')).toHaveTextContent('Analysis deleted.');
    expect(screen.getByRole('status')).not.toBe(firstStatus);
    expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 5000)).toHaveLength(2);
  });

  it('keeps the deletion dialog open with a retryable error', async () => {
    const user = userEvent.setup();
    const deleteSession = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockUseAssistant.mockReturnValue(
      createHookResult({ deleteSession, deleteError: 'Delete failed' })
    );

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));
    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a non-dismissible deleting state with accessible touch targets', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    mockUseAssistant.mockReturnValue(
      createHookResult({ deletingSessionId: result.sessions[0]?.id })
    );

    render(
      <MemoryRouter>
        <WhatsAppConversationAssistantListPage />
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: 'Actions for Alice context' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));

    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
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

    expect(screen.getByRole('heading', { name: 'Alice context' })).toHaveClass(
      'line-clamp-2',
      'sm:truncate'
    );
    expect(screen.getByRole('link', { name: 'Back to analyses' })).toHaveAttribute(
      'href',
      '/whatsapp/conversation-assistant'
    );
    expect(screen.getByLabelText('Ask first question')).toBeEnabled();
    expect(screen.getByPlaceholderText('Ask your first question about this conversation')).toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveClass('h-12', 'w-12', 'sm:w-auto');
    expect(sendButton.closest('form')).toHaveClass('flex-row', 'items-end');
    expect(screen.getByLabelText('Model used')).toHaveTextContent('Gemini 3.5 Flash Thinking');
    expect(screen.queryByLabelText('Private direct chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create analysis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice context/i })).not.toBeInTheDocument();
  });

  it('deletes the open analysis and returns to the analysis list', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const deleteSession = vi.fn().mockResolvedValue(true);
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        deleteSession,
      })
    );

    render(
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
          <Route
            path="/whatsapp/conversation-assistant"
            element={<p>Analysis list destination</p>}
          />
        </Routes>
      </MemoryRouter>
    );

    const actions = screen.getByRole('button', { name: 'Actions for Alice context' });
    expect(actions).toHaveClass('min-h-11', 'min-w-11');
    await user.click(actions);
    await user.click(screen.getByRole('menuitem', { name: 'Delete analysis' }));
    await user.click(screen.getByRole('button', { name: 'Delete analysis' }));

    expect(deleteSession).toHaveBeenCalledWith('session-1', 'deletion-token-session-1');
    expect(await screen.findByText('Analysis list destination')).toBeInTheDocument();
  });

  it('shows an interrupted detail deletion as a dedicated finish-only state', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const pendingSession = {
      ...firstSession(result),
      deletionPending: true,
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: pendingSession.id,
        selectedSession: pendingSession,
        turns: result.turns,
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

    expect(screen.getByRole('status')).toHaveTextContent('Deletion interrupted');
    expect(screen.queryByLabelText('Ask first question')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ask follow-up question')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View frozen context' })).not.toBeInTheDocument();
    const finishDeletionButton = screen.getByRole('button', { name: 'Finish deletion' });
    await user.click(finishDeletionButton);
    expect(screen.getByRole('heading', { name: 'Finish deletion?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(finishDeletionButton).toHaveFocus();
    });
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

  it('moves progress from the send button into the conversation after acknowledgement', () => {
    const result = createHookResult();
    const userTurn = {
      id: 'phase-user',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'user' as const,
      text: 'What happened?',
      createdAt: '2026-06-21T11:01:00.000Z',
    };
    const view = (): React.JSX.Element => (
      <MemoryRouter initialEntries={['/whatsapp/conversation-assistant/session-1']}>
        <Routes>
          <Route
            path="/whatsapp/conversation-assistant/:sessionId"
            element={<WhatsAppConversationAssistantSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        followUpQuestion: 'What happened?',
        turnPhase: 'submitting',
      })
    );
    const { rerender } = render(view());
    const sendingButton = screen.getByRole('button', { name: 'Sending…' });
    expect(sendingButton).toBeDisabled();
    expect(sendingButton).toHaveClass('h-12', 'w-auto');
    expect(sendingButton).not.toHaveClass('w-12');
    expect(screen.getByLabelText('Ask first question')).toBeDisabled();

    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        turns: [userTurn],
        followUpQuestion: 'Draft next question',
        turnPhase: 'waiting',
      })
    );
    rerender(view());
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(screen.getByText('Assistant is thinking…')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask follow-up')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: result.sessions[0],
        turns: [
          userTurn,
          {
            id: 'phase-assistant',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'assistant',
            text: 'The answer is streaming.',
            createdAt: '2026-06-21T11:02:00.000Z',
          },
        ],
        followUpQuestion: 'Draft next question',
        turnPhase: 'streaming',
      })
    );
    rerender(view());
    expect(screen.getByText('Responding…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Assistant is responding.');
    expect(screen.getByLabelText('Ask follow-up')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
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
        turnPhase: 'streaming',
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
