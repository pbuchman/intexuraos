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
    contextSummary: {
      displayTimeZone: 'UTC',
      availability: { state: 'available', displayTimeZone: 'UTC' },
      contextVersion: 0,
      snapshotCount: 1,
      totalAttachedMessageCount: 0,
      totalAttachedOmittedCount: 0,
      completedConversationRevision: 0,
      activeTurn: null,
    },
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
    pendingContextAttachment: { phase: 'idle', sessionId: 'session-1' },
    contextAttachmentRequestPhase: 'idle',
    contextAttachmentWarningAcknowledged: false,
    contextContinuationState: 'available',
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
    includeNewMessages: vi.fn(),
    refreshContextAttachment: vi.fn(),
    retryContextAttachment: vi.fn(),
    removeContextAttachment: vi.fn(),
    keepCurrentContextAttachment: vi.fn(),
    acknowledgeContextAttachmentWarning: vi.fn(),
    loadContextAttachmentPreview: vi.fn(),
    loadContextSnapshotPreview: vi.fn(),
    loadContextHistory: vi.fn(),
    retryTurnAnswer: vi.fn(),
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
    expect(analysisLink).toHaveTextContent('Jun 20, 9:00 AM – Jun 21, 10:00 AM');
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
            preparationError: {
              code: 'CONTEXT_WINDOW_EXCEEDED',
              message: 'Selected context is too large',
            },
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
    expect(screen.getByText('Context too large')).toBeInTheDocument();
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

  it('keeps the source contact and enables a prefilled smaller analysis', () => {
    mockUseAssistant.mockReturnValue(createHookResult({ selectedChatId: undefined }));

    render(
      <MemoryRouter
        initialEntries={[
          '/whatsapp/conversation-assistant/new?sourceSession=session-1&contact=Maria+Maj+%28WA%29&from=2026-06-21T00%3A00%3A00.000Z&to=2026-06-21T10%3A00%3A00.000Z',
        ]}
      >
        <WhatsAppConversationAssistantNewPage />
      </MemoryRouter>
    );

    expect(screen.queryByLabelText('Private direct chat')).not.toBeInTheDocument();
    expect(screen.getByText('Maria Maj (WA)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create analysis' })).toBeEnabled();
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
    expect(sendButton).toHaveClass('h-12', 'min-w-11');
    expect(sendButton.closest('form')).toHaveClass('min-w-0', 'overflow-x-hidden');
    expect(screen.getByLabelText('Model used')).toHaveTextContent('Gemini 3.5 Flash Thinking');
    expect(screen.queryByLabelText('Private direct chat')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create analysis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice context/i })).not.toBeInTheDocument();
  });

  it('keeps the session timezone after the WhatsApp source becomes unavailable', () => {
    const result = createHookResult();
    const session = {
      ...firstSession(result),
      contextSummary: {
        ...firstSession(result).contextSummary,
        displayTimeZone: 'Europe/Warsaw',
        availability: { state: 'source_unavailable' as const },
      },
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        sessions: [session],
        selectedSessionId: session.id,
        selectedSession: session,
        contextContinuationState: 'source_unavailable',
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

    expect(screen.getByText(/Alice · Jun 20, 2026, 11:00 AM/)).toBeInTheDocument();
    expect(
      screen.getByText('The source WhatsApp conversation is no longer available.')
    ).toBeInTheDocument();
  });

  it('exports the last completed revision while a newer answer is active', () => {
    const result = createHookResult();
    const session = {
      ...firstSession(result),
      contextSummary: {
        ...firstSession(result).contextSummary,
        completedConversationRevision: 1,
        activeTurn: { requestId: 'request-active', stateVersion: 1 },
      },
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        sessions: [session],
        selectedSessionId: session.id,
        selectedSession: session,
        turnPhase: 'streaming',
        turns: [
          {
            id: 'turn-user',
            sessionId: session.id,
            userId: 'user-1',
            role: 'user',
            text: 'What changed?',
            createdAt: '2026-06-21T11:01:00.000Z',
          },
          {
            id: 'turn-assistant',
            sessionId: session.id,
            userId: 'user-1',
            role: 'assistant',
            text: 'The completed answer.',
            createdAt: '2026-06-21T11:02:00.000Z',
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

    const exportButton = screen.getByRole('button', {
      name: 'Export last completed PDF, revision 1',
    });
    expect(exportButton).toBeEnabled();
    expect(exportButton).toHaveTextContent('Export last completed PDF');
  });

  it('integrates the explicit Include action without replacing the typed question', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const includeNewMessages = vi.fn().mockResolvedValue(undefined);
    const setFollowUpQuestion = vi.fn();
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: { ...firstSession(result), contextContinuationAvailable: true },
        followUpQuestion: 'How did the attitude change?',
        includeNewMessages,
        setFollowUpQuestion,
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

    expect(screen.getByLabelText('Ask first question')).toHaveValue(
      'How did the attitude change?'
    );
    await user.click(screen.getByRole('button', { name: 'Include new messages' }));
    expect(includeNewMessages).toHaveBeenCalledTimes(1);
    expect(setFollowUpQuestion).not.toHaveBeenCalled();
  });

  it('renders a committed context update permanently above its exact question', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const loadContextSnapshotPreview = vi.fn().mockResolvedValue({ items: [] });
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: { ...firstSession(result), contextContinuationAvailable: true },
        loadContextSnapshotPreview,
        turns: [
          {
            id: 'turn-with-context',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'user',
            text: 'How did the attitude change?',
            createdAt: '2026-07-21T10:02:00.000Z',
            kind: 'context_attachment_question',
            contextAttachmentId: 'attachment-1',
            contextAttachment: {
              id: 'attachment-1',
              capturedAt: '2026-07-21T10:00:00.000Z',
              captureRange: {
                from: '2026-07-20T10:00:00.000Z',
                to: '2026-07-21T10:00:00.000Z',
              },
              counts: {
                included: 18,
                excluded: 2,
                newlyAvailable: 18,
                edited: 0,
                redacted: 0,
                deleted: 0,
                reactionsChanged: 0,
                lateIngested: 0,
                completedTranscriptions: 0,
              },
              omitted: {
                mediaOnly: 2,
                failedTranscriptions: 0,
                pendingTranscriptions: 0,
                nonText: 0,
                overLimit: 0,
              },
            },
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

    const card = screen.getByRole('group', {
      name: 'WhatsApp context update attached to this question',
    });
    const question = screen.getByText('How did the attitude change?');
    expect(card.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View messages' }));
    await waitFor(() => {
      expect(loadContextSnapshotPreview).toHaveBeenCalledWith('attachment-1', undefined);
    });
  });

  it('opens Conversation context history when committed updates exist', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const loadContextHistory = vi.fn().mockResolvedValue({
      snapshots: [
        {
          kind: 'initial',
          contextVersion: 0,
          capturedAt: '2026-07-20T10:00:00.000Z',
          messageCount: 9,
          excludedCount: 6,
        },
        {
          kind: 'update',
          contextVersion: 1,
          capturedAt: '2026-07-21T10:00:00.000Z',
          messageCount: 18,
          excludedCount: 2,
          attachmentId: 'attachment-1',
          linkedTurnId: 'turn-with-context',
        },
      ],
    });
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: 'session-1',
        selectedSession: {
          ...firstSession(result),
          contextSummary: {
            ...firstSession(result).contextSummary,
            snapshotCount: 2,
            totalAttachedMessageCount: 18,
            totalAttachedOmittedCount: 2,
          },
        },
        loadContextHistory,
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

    const contextButton = screen.getByRole('button', { name: 'View conversation context' });
    expect(contextButton).toHaveTextContent('9 initial · 18 added · 8 excluded');
    await user.click(contextButton);
    expect(await screen.findByText('Initial snapshot')).toBeInTheDocument();
    expect(screen.getByText('Update 1')).toBeInTheDocument();
    expect(loadContextHistory).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(contextButton).toHaveFocus();
    });
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
                targetReference: 'context-item-outside-snapshot',
              },
            },
          ],
          messageCount: 9,
          omittedMessageCount: 6,
          snapshotAvailable: true,
          omitted: firstSession(result).omitted,
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
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Frozen context' })).toBeInTheDocument();
    expect(screen.getByText('The exact message used by the model.')).toBeInTheDocument();
    expect(screen.getByText('Unsupported message type')).toBeInTheDocument();
    expect(
      screen.getByText('Reaction 👍 to message context-item-outside-snapshot')
    ).toBeInTheDocument();
    expect(screen.getByText('2 media-only messages')).toBeInTheDocument();
    expect(
      dialog.querySelector('time[datetime="2026-06-20T09:30:00.000Z"]')
    ).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/June 20, 2026.*UTC/)
    );
    await user.click(screen.getByRole('button', { name: 'Close frozen context' }));
    await waitFor(() => {
      expect(contextButton).toHaveFocus();
    });
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

  it('offers a smaller prefilled analysis for a context-window preparation failure', async () => {
    const user = userEvent.setup();
    const result = createHookResult();
    const failedSession = {
      ...firstSession(result),
      status: 'failed' as const,
      preparationStage: 'failed' as const,
      preparationError: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message:
          'The selected conversation context is too large for MiniMax M3. Create a smaller analysis with a shorter date range.',
        recommendedRange: {
          from: '2026-06-21T00:00:00.000Z',
          to: '2026-06-21T10:00:00.000Z',
        },
      },
    };
    mockUseAssistant.mockReturnValue(
      createHookResult({
        selectedSessionId: failedSession.id,
        selectedSession: failedSession,
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
            path="/whatsapp/conversation-assistant/new"
            element={<p>Smaller analysis form</p>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Selected context is too large')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create smaller analysis' }));
    expect(screen.getByText('Smaller analysis form')).toBeInTheDocument();
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
    expect(sendingButton).toHaveClass('h-12', 'min-w-11');
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

  it('renders a superseded persisted turn error without offering a stale history retry', () => {
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
            requestId: 'request-a',
            canRetryAnswer: false,
            createdAt: '2026-06-21T11:02:00.000Z',
            error: { code: 'LLM_ERROR', message: 'Model request failed' },
          },
          {
            id: 'turn-b-user',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'user',
            text: 'Question B',
            requestId: 'request-b',
            createdAt: '2026-06-21T11:03:00.000Z',
          },
          {
            id: 'turn-b-assistant',
            sessionId: 'session-1',
            userId: 'user-1',
            role: 'assistant',
            text: 'Answer B',
            requestId: 'request-b',
            createdAt: '2026-06-21T11:04:00.000Z',
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

    expect(
      screen.getByText('The assistant could not complete this answer.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try answer again' })).not.toBeInTheDocument();
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
