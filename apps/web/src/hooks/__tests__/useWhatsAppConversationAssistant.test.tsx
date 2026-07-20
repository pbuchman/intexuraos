/**
 * Tests for the WhatsApp Conversation Assistant hook.
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  ConversationAssistantModels,
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
} from '@intexuraos/llm-contract';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  PrivateWhatsAppChat,
} from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listPrivateWhatsAppChats: vi.fn(),
  listConversationAssistantSessions: vi.fn(),
  checkConversationAssistantContext: vi.fn(),
  createConversationAssistantSession: vi.fn(),
  deleteConversationAssistantSession: vi.fn(),
  exportConversationAssistantSessionPdf: vi.fn(),
  getConversationAssistantContext: vi.fn(),
  getConversationAssistantSession: vi.fn(),
  getConversationAssistantSessionByRequest: vi.fn(),
  listConversationAssistantTurns: vi.fn(),
  retryConversationAssistantPreparation: vi.fn(),
  streamConversationAssistantTurn: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/whatsappApi', () => ({
  listPrivateWhatsAppChats: mocks.listPrivateWhatsAppChats,
}));

vi.mock('@/services/conversationAssistantApi', () => ({
  listConversationAssistantSessions: mocks.listConversationAssistantSessions,
  checkConversationAssistantContext: mocks.checkConversationAssistantContext,
  createConversationAssistantSession: mocks.createConversationAssistantSession,
  deleteConversationAssistantSession: mocks.deleteConversationAssistantSession,
  exportConversationAssistantSessionPdf: mocks.exportConversationAssistantSessionPdf,
  getConversationAssistantContext: mocks.getConversationAssistantContext,
  getConversationAssistantSession: mocks.getConversationAssistantSession,
  getConversationAssistantSessionByRequest: mocks.getConversationAssistantSessionByRequest,
  listConversationAssistantTurns: mocks.listConversationAssistantTurns,
  retryConversationAssistantPreparation: mocks.retryConversationAssistantPreparation,
  streamConversationAssistantTurn: mocks.streamConversationAssistantTurn,
}));

import { useWhatsAppConversationAssistant } from '../useWhatsAppConversationAssistant.js';

const directChat: PrivateWhatsAppChat = {
  id: 'chat-direct',
  chatType: 'direct',
  displayName: 'Alice',
  messageCount: 12,
  participantCount: 1,
  firstSeenAt: '2026-06-20T09:00:00.000Z',
  lastEventAt: '2026-06-21T10:00:00.000Z',
  updatedAt: '2026-06-21T10:00:00.000Z',
};

const groupChat: PrivateWhatsAppChat = {
  id: 'chat-group',
  chatType: 'group',
  displayName: 'Group',
  messageCount: 30,
  participantCount: 5,
  firstSeenAt: '2026-06-20T09:00:00.000Z',
  lastEventAt: '2026-06-21T10:00:00.000Z',
  updatedAt: '2026-06-21T10:00:00.000Z',
};

const session: ConversationAssistantSession = {
  id: 'session-1',
  deletionToken: 'deletion-token-session-1',
  userId: 'user-1',
  chatId: directChat.id,
  chatDisplayName: directChat.displayName,
  status: 'active',
  range: {
    from: '2026-06-20T09:00:00.000Z',
    to: '2026-06-21T10:00:00.000Z',
  },
  effectiveRange: {
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
};

const turns: ConversationAssistantTurn[] = [
  {
    id: 'turn-user',
    sessionId: session.id,
    userId: 'user-1',
    role: 'user',
    text: 'What did we agree?',
    createdAt: '2026-06-21T11:01:00.000Z',
  },
  {
    id: 'turn-assistant',
    sessionId: session.id,
    userId: 'user-1',
    role: 'assistant',
    text: 'The selected context shows agreement on Friday.',
    createdAt: '2026-06-21T11:02:00.000Z',
  },
];

function createWrapper(initialEntry = '/whatsapp/conversation-assistant') {
  return function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

async function chooseDirectChat(result: {
  current: ReturnType<typeof useWhatsAppConversationAssistant>;
}): Promise<void> {
  await waitFor(() => {
    expect(result.current.directChats).toContainEqual(directChat);
  });
  act(() => {
    result.current.selectChat(directChat.id);
  });
}

function useAssistantWithLocationControls(): ReturnType<typeof useWhatsAppConversationAssistant> & {
  clearSession: () => void;
  navigateToSession: (sessionId: string) => void;
  search: string;
} {
  const assistant = useWhatsAppConversationAssistant();
  const navigate = useNavigate();
  const location = useLocation();
  return {
    ...assistant,
    clearSession: (): void => {
      navigate('/whatsapp/conversation-assistant');
    },
    navigateToSession: (sessionId: string): void => {
      navigate(`/whatsapp/conversation-assistant?session=${sessionId}`);
    },
    search: location.search,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockBrowserDownloadApis(): {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  anchorClickSpy: ReturnType<typeof vi.spyOn>;
} {
  const createObjectURL = vi.fn(() => 'blob:session-1');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
  const anchorClickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation((): void => undefined);

  return { createObjectURL, revokeObjectURL, anchorClickSpy };
}

describe('useWhatsAppConversationAssistant', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.getAccessToken.mockResolvedValue('tok');
    mocks.listPrivateWhatsAppChats.mockResolvedValue({ chats: [groupChat, directChat] });
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session] });
    mocks.checkConversationAssistantContext.mockResolvedValue({
      messageCount: 42,
      warningThreshold: 5000,
      requiresConfirmation: false,
    });
    mocks.getConversationAssistantSession.mockResolvedValue(session);
    mocks.getConversationAssistantSessionByRequest.mockRejectedValue(new Error('Not found'));
    mocks.listConversationAssistantTurns.mockResolvedValue({ turns });
    mocks.createConversationAssistantSession.mockResolvedValue(session);
    mocks.deleteConversationAssistantSession.mockResolvedValue(undefined);
    mocks.retryConversationAssistantPreparation.mockResolvedValue(session);
    mocks.exportConversationAssistantSessionPdf.mockResolvedValue({
      blob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
      filename: 'alice-context.pdf',
    });
    mocks.getConversationAssistantContext.mockResolvedValue({
      sessionId: session.id,
      messages: [
        {
          id: 'context-message-1',
          eventTimestamp: '2026-06-20T09:30:00.000Z',
          importedAt: '2026-06-20T09:31:00.000Z',
          direction: 'incoming',
          speakerLabel: 'Alice',
          messageType: 'text',
          contentKind: 'text',
          content: 'Frozen message.',
        },
      ],
      omittedMessages: [],
      messageCount: 1,
      omittedMessageCount: 0,
      snapshotAvailable: true,
      omitted: session.omitted,
      transcriptSha256: session.transcriptSha256,
    });
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        streamSessionId: string,
        request: { question: string },
        onEvent: (event: unknown) => void
      ) => {
        onEvent({
          type: 'user_turn',
          turn: {
            id: 'turn-follow-user',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-06-21T11:06:00.000Z',
          },
        });
        onEvent({ type: 'assistant_delta', text: 'Follow-up ' });
        onEvent({ type: 'assistant_delta', text: 'answer.' });
        onEvent({
          type: 'assistant_turn',
          turn: {
            id: 'turn-follow-assistant',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'assistant',
            text: 'Follow-up answer.',
            createdAt: '2026-06-21T11:07:00.000Z',
          },
        });
        onEvent({ type: 'done' });
      }
    );
  });

  it('loads direct chats, sessions, and selected session turns from the query string', async () => {
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    expect(result.current.directChats).toEqual([directChat]);
    expect(result.current.sessions).toEqual([session]);
    expect(result.current.turns).toEqual(turns);
    expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledWith('tok', { limit: 100 });
    expect(mocks.getConversationAssistantSession).toHaveBeenCalledWith('tok', session.id);
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledWith('tok', session.id);
  });

  it('deletes one session, blocks duplicate deletion, and removes it from local state', async () => {
    const deletion = createDeferred<undefined>();
    mocks.deleteConversationAssistantSession.mockReturnValue(deletion.promise);
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.deleteSession(session.id, session.deletionToken);
      second = result.current.deleteSession(session.id, session.deletionToken);
    });
    await waitFor(() => {
      expect(result.current.deletingSessionId).toBe(session.id);
    });
    expect(mocks.deleteConversationAssistantSession).toHaveBeenCalledTimes(1);
    expect(mocks.deleteConversationAssistantSession).toHaveBeenCalledWith(
      'tok',
      session.id,
      session.deletionToken
    );

    await act(async () => {
      deletion.resolve(undefined);
      await deletion.promise;
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.deletingSessionId).toBeUndefined();
    expect(result.current.deleteError).toBeNull();
  });

  it('keeps a session visible and exposes a retryable error when deletion fails', async () => {
    mocks.deleteConversationAssistantSession.mockRejectedValue(new Error('Delete failed'));
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    await act(async () => {
      await expect(
        result.current.deleteSession(session.id, session.deletionToken)
      ).resolves.toBe(false);
    });

    expect(result.current.sessions).toEqual([session]);
    expect(result.current.deleteError).toBe('Delete failed');
    act(() => {
      result.current.clearDeleteError();
    });
    expect(result.current.deleteError).toBeNull();
  });

  it('bounds best-effort deletion reconciliation when the refresh never answers', async () => {
    const hangingRefresh = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    mocks.listConversationAssistantSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockReturnValueOnce(hangingRefresh.promise);
    mocks.deleteConversationAssistantSession.mockRejectedValue(new Error('Delete timed out'));
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    let deletePromise!: Promise<boolean>;
    act(() => {
      deletePromise = result.current.deleteSession(session.id, session.deletionToken);
    });
    const completion = await Promise.race([
      deletePromise.then(() => 'settled' as const),
      new Promise<'timed-out'>((resolve) => {
        window.setTimeout(() => resolve('timed-out'), 1500);
      }),
    ]);
    await act(async () => {
      hangingRefresh.resolve({ sessions: [session] });
      await deletePromise;
    });

    expect(completion).toBe('settled');
    expect(result.current.deletingSessionId).toBeUndefined();
    expect(result.current.deleteError).toBe('Delete timed out');
  });

  it('reconciles an interrupted deletion into a non-openable pending session', async () => {
    const pendingDeletion: ConversationAssistantSession = {
      ...session,
      status: 'preparing',
      preparationStage: 'queued',
      deletionPending: true,
    };
    let sessionListCall = 0;
    mocks.listConversationAssistantSessions.mockImplementation(() => {
      sessionListCall += 1;
      return Promise.resolve({
        sessions: sessionListCall === 1 ? [session] : [pendingDeletion],
      });
    });
    mocks.deleteConversationAssistantSession.mockRejectedValue(new Error('Connection lost'));
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    await act(async () => {
      await expect(
        result.current.deleteSession(session.id, session.deletionToken)
      ).resolves.toBe(false);
    });

    expect(result.current.sessions).toEqual([pendingDeletion]);
    expect(result.current.deleteError).toBe(
      'Deletion was interrupted. Finish deletion to remove the remaining analysis data.'
    );
    expect(intervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  it('does not let an in-flight list refresh restore a successfully deleted session', async () => {
    const staleSessionList = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });
    mocks.listConversationAssistantSessions.mockReturnValueOnce(staleSessionList.promise);
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => {
      expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await expect(
        result.current.deleteSession(session.id, session.deletionToken)
      ).resolves.toBe(true);
    });
    expect(result.current.sessions).toEqual([]);

    await act(async () => {
      staleSessionList.resolve({ sessions: [session] });
      await refreshPromise;
    });
    expect(result.current.sessions).toEqual([]);
  });

  it('does not let a list refresh started during deletion restore the deleted session', async () => {
    const deletion = createDeferred<undefined>();
    const staleSessionList = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    mocks.deleteConversationAssistantSession.mockReturnValue(deletion.promise);
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    let deletePromise!: Promise<boolean>;
    act(() => {
      deletePromise = result.current.deleteSession(session.id, session.deletionToken);
    });
    await waitFor(() => {
      expect(mocks.deleteConversationAssistantSession).toHaveBeenCalledTimes(1);
    });

    mocks.listConversationAssistantSessions.mockReturnValueOnce(staleSessionList.promise);
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => {
      expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      deletion.resolve(undefined);
      await deletePromise;
    });
    expect(result.current.sessions).toEqual([]);

    await act(async () => {
      staleSessionList.resolve({ sessions: [session] });
      await refreshPromise;
    });
    expect(result.current.sessions).toEqual([]);
  });

  it('keeps a replacement generation when an older deletion token completes as a no-op', async () => {
    const replacementSession: ConversationAssistantSession = {
      ...session,
      deletionToken: 'deletion-token-replacement',
      title: 'Replacement analysis',
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [replacementSession],
    });
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true }),
      { wrapper: createWrapper() }
    );
    await waitFor(() => {
      expect(result.current.sessions).toEqual([replacementSession]);
    });

    await act(async () => {
      await expect(
        result.current.deleteSession(session.id, session.deletionToken)
      ).resolves.toBe(true);
    });

    expect(mocks.deleteConversationAssistantSession).toHaveBeenCalledWith(
      'tok',
      session.id,
      session.deletionToken
    );
    expect(result.current.sessions).toEqual([replacementSession]);
  });

  it('loads the selected conversation from an explicit route session id', async () => {
    const { result } = renderHook(() => useWhatsAppConversationAssistant(session.id), {
      wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    expect(result.current.selectedSessionId).toBe(session.id);
    expect(result.current.turns).toEqual(turns);
    expect(mocks.getConversationAssistantSession).toHaveBeenCalledWith('tok', session.id);
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledWith('tok', session.id);
  });

  it('loads only session summaries for the analysis list', async () => {
    const options = { loadChats: false, loadSessions: true };
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant(options),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.sessions).toEqual([session]);
    });

    expect(mocks.listConversationAssistantSessions).toHaveBeenCalledWith('tok');
    expect(mocks.listPrivateWhatsAppChats).not.toHaveBeenCalled();
  });

  it('loads only direct chats for the new-analysis form', async () => {
    const options = { loadChats: true, loadSessions: false };
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant(options),
      { wrapper: createWrapper('/whatsapp/conversation-assistant/new') }
    );

    await waitFor(() => {
      expect(result.current.directChats).toEqual([directChat]);
    });

    expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledWith('tok', { limit: 100 });
    expect(mocks.listConversationAssistantSessions).not.toHaveBeenCalled();
    expect(result.current.selectedChatId).toBeUndefined();
  });

  it('loads only the selected session and turns for a conversation route', async () => {
    const options = {
      sessionId: session.id,
      loadChats: false,
      loadSessions: false,
    };
    const { result } = renderHook(
      () => useWhatsAppConversationAssistant(options),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    expect(result.current.turns).toEqual(turns);
    expect(mocks.getConversationAssistantSession).toHaveBeenCalledWith('tok', session.id);
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledWith('tok', session.id);
    expect(mocks.listPrivateWhatsAppChats).not.toHaveBeenCalled();
    expect(mocks.listConversationAssistantSessions).not.toHaveBeenCalled();
  });

  it('loads and caches the frozen context only when requested', async () => {
    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          sessionId: session.id,
          loadChats: false,
          loadSessions: false,
        }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    expect(mocks.getConversationAssistantContext).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadContext();
      await result.current.loadContext();
    });

    expect(mocks.getConversationAssistantContext).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationAssistantContext).toHaveBeenCalledWith('tok', session.id);
    expect(result.current.context?.messages[0]?.content).toBe('Frozen message.');
    expect(result.current.loadingContext).toBe(false);
    expect(result.current.contextError).toBeNull();
  });

  it('loads frozen context progressively without repeating completed pages', async () => {
    mocks.getConversationAssistantContext
      .mockResolvedValueOnce({
        sessionId: session.id,
        messages: [
          {
            id: 'context-message-1',
            eventTimestamp: '2026-06-20T09:30:00.000Z',
            importedAt: '2026-06-20T09:31:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'First page.',
          },
        ],
        omittedMessages: [],
        messageCount: 2,
        omittedMessageCount: 0,
        snapshotAvailable: true,
        omitted: session.omitted,
        transcriptSha256: session.transcriptSha256,
        nextMessageCursor: 1,
      })
      .mockResolvedValueOnce({
        sessionId: session.id,
        messages: [
          {
            id: 'context-message-2',
            eventTimestamp: '2026-06-20T09:32:00.000Z',
            importedAt: '2026-06-20T09:33:00.000Z',
            direction: 'incoming',
            speakerLabel: 'Alice',
            messageType: 'text',
            contentKind: 'text',
            content: 'Second page.',
          },
        ],
        omittedMessages: [],
        messageCount: 2,
        omittedMessageCount: 0,
        snapshotAvailable: true,
        omitted: session.omitted,
        transcriptSha256: session.transcriptSha256,
      });
    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          sessionId: session.id,
          loadChats: false,
          loadSessions: false,
        }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    await act(async () => {
      await result.current.loadContext();
    });
    await act(async () => {
      await result.current.loadMoreContext();
    });

    expect(mocks.getConversationAssistantContext).toHaveBeenNthCalledWith(
      2,
      'tok',
      session.id,
      { messageCursor: 1, omittedCursor: 0 }
    );
    expect(result.current.context?.messages.map((message) => message.content)).toEqual([
      'First page.',
      'Second page.',
    ]);
  });

  it('retries a failed next context page without discarding the loaded page', async () => {
    const firstPage = {
      sessionId: session.id,
      messages: [
        {
          id: 'context-message-1',
          eventTimestamp: '2026-06-20T09:30:00.000Z',
          importedAt: '2026-06-20T09:31:00.000Z',
          direction: 'incoming' as const,
          speakerLabel: 'Alice',
          messageType: 'text' as const,
          contentKind: 'text' as const,
          content: 'First page.',
        },
      ],
      omittedMessages: [],
      messageCount: 2,
      omittedMessageCount: 0,
      snapshotAvailable: true,
      omitted: session.omitted,
      transcriptSha256: session.transcriptSha256,
      nextMessageCursor: 1,
    };
    mocks.getConversationAssistantContext
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('Page request failed'))
      .mockResolvedValueOnce({
        ...firstPage,
        messages: [{ ...firstPage.messages[0], id: 'context-message-2', content: 'Second page.' }],
        nextMessageCursor: undefined,
      });
    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          sessionId: session.id,
          loadChats: false,
          loadSessions: false,
        }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    await act(async () => {
      await result.current.loadContext();
    });
    await act(async () => {
      await result.current.loadMoreContext();
    });
    expect(result.current.contextError).toBe('Page request failed');
    expect(result.current.context?.messages.map((item) => item.content)).toEqual(['First page.']);

    await act(async () => {
      await result.current.loadMoreContext();
    });
    expect(result.current.contextError).toBeNull();
    expect(result.current.context?.messages.map((item) => item.content)).toEqual([
      'First page.',
      'Second page.',
    ]);
    expect(mocks.getConversationAssistantContext).toHaveBeenCalledTimes(3);
  });

  it('does not expose first-message state while creating an analysis', async () => {
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.directChats).toEqual([directChat]);
    });

    expect(result.current).not.toHaveProperty('firstQuestion');
    expect(result.current).not.toHaveProperty('setFirstQuestion');
  });

  it('creates a new analysis without sending a first message', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-created',
      title: 'Created context',
      createdAt: '2026-06-21T12:00:00.000Z',
      updatedAt: '2026-06-21T12:00:00.000Z',
    };
    const createdTurns: ConversationAssistantTurn[] = [
      {
        id: 'turn-created-user',
        sessionId: createdSession.id,
        userId: 'user-1',
        role: 'user',
        text: 'What changed?',
        createdAt: '2026-06-21T12:01:00.000Z',
      },
      {
        id: 'turn-created-assistant',
        sessionId: createdSession.id,
        userId: 'user-1',
        role: 'assistant',
        text: 'Created answer.',
        createdAt: '2026-06-21T12:02:00.000Z',
      },
    ];
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === createdSession.id ? createdTurns : turns })
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.directChats).toEqual([directChat]);
    });

    act(() => {
      result.current.selectChat(directChat.id);
      result.current.setFromDateTimeLocal('2026-06-20T09:00');
      result.current.setToDateTimeLocal('2026-06-21T10:00');
    });

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.checkConversationAssistantContext).not.toHaveBeenCalled();
    expect(mocks.createConversationAssistantSession).toHaveBeenCalledWith('tok', {
      requestId: expect.any(String),
      chatId: directChat.id,
      from: new Date('2026-06-20T09:00').toISOString(),
      to: new Date('2026-06-21T10:00').toISOString(),
      model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    });
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(result.current.sessions[0]).toEqual(createdSession);
    expect(result.current.selectedSession?.id).toBe(createdSession.id);
    await waitFor(() => {
      expect(result.current.turns).toEqual(createdTurns);
    });
  });

  it('recovers the created analysis when the create response times out', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-recovered',
      status: 'preparing',
      preparationStage: 'queued',
    };
    mocks.createConversationAssistantSession.mockRejectedValue(new Error('Request timed out'));
    mocks.getConversationAssistantSessionByRequest
      .mockRejectedValueOnce(new Error('Not found yet'))
      .mockResolvedValue(createdSession);

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });
    await chooseDirectChat(result);

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.getConversationAssistantSessionByRequest).toHaveBeenCalledTimes(2);
    expect(mocks.getConversationAssistantSessionByRequest).toHaveBeenLastCalledWith(
      'tok',
      expect.any(String)
    );
    expect(result.current.selectedSessionId).toBe(createdSession.id);
    expect(result.current.error).toBeNull();
  });

  it(
    'keeps the idempotency key when timeout recovery is still unavailable',
    async () => {
      mocks.createConversationAssistantSession.mockRejectedValue(new Error('Request timed out'));
      mocks.getConversationAssistantSessionByRequest.mockRejectedValue(new Error('Not found yet'));

      const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
        wrapper: createWrapper(),
      });
      await chooseDirectChat(result);

      await act(async () => {
        await result.current.createSession();
      });

      expect(mocks.getConversationAssistantSessionByRequest).toHaveBeenCalledTimes(4);
      expect(window.sessionStorage.length).toBe(1);
      const stored = JSON.parse(
        window.sessionStorage.getItem('whatsapp-conversation-assistant-pending-creation') ?? '{}'
      ) as { request?: unknown };
      expect(stored.request).toEqual({
        requestId: expect.any(String),
        chatId: directChat.id,
        from: new Date(result.current.fromDateTimeLocal).toISOString(),
        to: new Date(result.current.toDateTimeLocal).toISOString(),
        model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
      });
      expect(result.current.error).toBe('Request timed out');
    },
    10_000
  );

  it('restores the exact pending creation request after a page reload', async () => {
    const pendingRequest = {
      requestId: 'request-persisted-across-reload',
      chatId: directChat.id,
      from: '2026-06-20T09:00:00.000Z',
      to: '2026-06-21T10:00:00.000Z',
      model: ConversationAssistantModels.MiniMaxM3,
    };
    const recoveredSession: ConversationAssistantSession = {
      ...session,
      id: 'session-recovered-after-reload',
      status: 'preparing',
      preparationStage: 'queued',
      model: pendingRequest.model,
      modelDisplayName: 'MiniMax M3',
    };
    window.sessionStorage.setItem(
      'whatsapp-conversation-assistant-pending-creation',
      JSON.stringify({ request: pendingRequest, savedAt: Date.now() })
    );
    mocks.getConversationAssistantSessionByRequest.mockResolvedValue(recoveredSession);
    mocks.getConversationAssistantSession.mockResolvedValue(recoveredSession);

    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ loadChats: true, loadSessions: false }),
      { wrapper: createWrapper('/whatsapp/conversation-assistant/new') }
    );

    await waitFor(() => {
      expect(result.current.selectedSessionId).toBe(recoveredSession.id);
    });
    expect(mocks.getConversationAssistantSessionByRequest).toHaveBeenCalledWith(
      'tok',
      pendingRequest.requestId
    );
    expect(result.current.selectedChatId).toBe(pendingRequest.chatId);
    expect(new Date(result.current.fromDateTimeLocal).toISOString()).toBe(pendingRequest.from);
    expect(new Date(result.current.toDateTimeLocal).toISOString()).toBe(pendingRequest.to);
    expect(result.current.selectedModel).toBe(pendingRequest.model);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('requeues a failed context preparation in the selected analysis', async () => {
    const failedSession: ConversationAssistantSession = {
      ...session,
      status: 'failed',
      preparationStage: 'failed',
      preparationError: { code: 'PERSISTENCE_ERROR', message: 'Temporary failure' },
    };
    const { preparationError: _preparationError, ...failedWithoutError } = failedSession;
    const retriedSession: ConversationAssistantSession = {
      ...failedWithoutError,
      status: 'preparing',
      preparationStage: 'queued',
    };
    mocks.getConversationAssistantSession.mockResolvedValue(failedSession);
    mocks.retryConversationAssistantPreparation.mockResolvedValue(retriedSession);

    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ sessionId: session.id, loadChats: false, loadSessions: false }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );
    await waitFor(() => {
      expect(result.current.selectedSession?.status).toBe('failed');
    });

    await act(async () => {
      await result.current.retryPreparation();
    });

    expect(mocks.retryConversationAssistantPreparation).toHaveBeenCalledWith('tok', session.id);
    expect(result.current.selectedSession?.status).toBe('preparing');
    expect(result.current.retryingPreparation).toBe(false);
  });

  it('polls a preparing analysis until its context becomes ready', async () => {
    const preparingSession: ConversationAssistantSession = {
      ...session,
      status: 'preparing',
      preparationStage: 'loading_messages',
    };
    const readySession: ConversationAssistantSession = {
      ...session,
      status: 'ready',
      preparationStage: 'ready',
    };
    const buildingSession: ConversationAssistantSession = {
      ...preparingSession,
      preparationStage: 'building_context',
      updatedAt: '2026-06-21T11:06:00.000Z',
    };
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(preparingSession)
      .mockResolvedValueOnce(buildingSession)
      .mockResolvedValue(readySession);

    const { result } = renderHook(
      () => useWhatsAppConversationAssistant({ sessionId: session.id, loadChats: false, loadSessions: false }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${session.id}`) }
    );

    await waitFor(() => {
      expect(result.current.selectedSession?.status).toBe('preparing');
    });
    await waitFor(
      () => {
        expect(result.current.selectedSession?.status).toBe('ready');
      },
      { timeout: 5000 }
    );
    expect(mocks.getConversationAssistantSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('sends the selected model when creating a session', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-claude',
      model: ConversationAssistantModels.ClaudeSonnet5,
      modelDisplayName: 'Claude Sonnet 5',
    };
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    expect(result.current.selectedModel).toBe(DEFAULT_CONVERSATION_ASSISTANT_MODEL);

    act(() => {
      result.current.selectModel(ConversationAssistantModels.ClaudeSonnet5);
    });

    expect(result.current.selectedModel).toBe(ConversationAssistantModels.ClaudeSonnet5);

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.createConversationAssistantSession).toHaveBeenCalledWith('tok', {
      requestId: expect.any(String),
      chatId: directChat.id,
      from: expect.any(String),
      to: expect.any(String),
      model: ConversationAssistantModels.ClaudeSonnet5,
    });
  });

  it('starts preparation immediately without a synchronous context check', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-large',
      title: 'Large context',
    };
    mocks.checkConversationAssistantContext.mockResolvedValue({
      messageCount: 5001,
      warningThreshold: 5000,
      requiresConfirmation: true,
    });
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.checkConversationAssistantContext).not.toHaveBeenCalled();
    expect(mocks.createConversationAssistantSession).toHaveBeenCalledTimes(1);
    expect(mocks.createConversationAssistantSession).toHaveBeenCalledWith('tok', {
      requestId: expect.any(String),
      chatId: directChat.id,
      from: expect.any(String),
      to: expect.any(String),
      model: DEFAULT_CONVERSATION_ASSISTANT_MODEL,
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(createdSession.id);
    });
  });

  it('ignores duplicate create requests while creation is in flight', async () => {
    const createRequest = createDeferred<ConversationAssistantSession>();
    mocks.createConversationAssistantSession.mockReturnValue(createRequest.promise);

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    act(() => {
      void result.current.createSession();
      void result.current.createSession();
    });

    await waitFor(() => {
      expect(mocks.createConversationAssistantSession).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      createRequest.resolve(session);
      await createRequest.promise;
    });
  });

  it('sends a follow-up question and refreshes the selected session list entry', async () => {
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledWith(
      'tok',
      session.id,
      { question: 'Follow up?' },
      expect.any(Function)
    );
    expect(result.current.turns.at(-1)?.text).toBe('Follow-up answer.');
    expect(result.current.followUpQuestion).toBe('');
    expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(2);
  });

  it('reports submitting, waiting, streaming, and idle phases from stream events', async () => {
    const sendRequest = createDeferred<undefined>();
    let streamEventHandler: ((event: ConversationAssistantStreamEvent) => void) | undefined;
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        streamEventHandler = onEvent;
        return await sendRequest.promise;
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });
    act(() => {
      void result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('submitting');
    });
    expect(result.current.followUpQuestion).toBe('Follow up?');

    act(() => {
      streamEventHandler?.({
        type: 'user_turn',
        turn: {
          id: 'phase-user',
          sessionId: session.id,
          userId: 'user-1',
          role: 'user',
          text: 'Follow up?',
          createdAt: '2026-06-21T11:06:00.000Z',
        },
      });
    });
    expect(result.current.turnPhase).toBe('waiting');
    expect(result.current.followUpQuestion).toBe('');

    act(() => {
      result.current.setFollowUpQuestion('Draft the next question');
      streamEventHandler?.({ type: 'assistant_delta', text: 'Answer starts' });
    });
    expect(result.current.turnPhase).toBe('streaming');
    expect(result.current.followUpQuestion).toBe('Draft the next question');

    act(() => {
      streamEventHandler?.({
        type: 'assistant_turn',
        turn: {
          id: 'phase-assistant',
          sessionId: session.id,
          userId: 'user-1',
          role: 'assistant',
          text: 'Answer starts and finishes.',
          createdAt: '2026-06-21T11:07:00.000Z',
        },
      });
    });
    expect(result.current.turnPhase).toBe('streaming');

    await act(async () => {
      sendRequest.resolve(undefined);
      await sendRequest.promise;
    });
    expect(result.current.turnPhase).toBe('idle');
  });

  it('returns to idle as soon as the completed stream closes without waiting for summary refresh', async () => {
    const summaryRefresh = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    mocks.listConversationAssistantSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockReturnValueOnce(summaryRefresh.promise);
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        streamSessionId: string,
        request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'user_turn',
          turn: {
            id: 'completed-user',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-06-21T11:06:00.000Z',
          },
        });
        onEvent({ type: 'assistant_delta', text: 'Complete answer.' });
        onEvent({
          type: 'assistant_turn',
          turn: {
            id: 'completed-assistant',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'assistant',
            text: 'Complete answer.',
            createdAt: '2026-06-21T11:07:00.000Z',
          },
        });
        onEvent({ type: 'done' });
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const phaseBeforeSummaryRefresh = result.current.turnPhase;

    await act(async () => {
      summaryRefresh.resolve({ sessions: [session] });
      await sendPromise;
    });
    expect(phaseBeforeSummaryRefresh).toBe('idle');
  });

  it('returns to idle and preserves the draft when submission fails before acknowledgement', async () => {
    mocks.streamConversationAssistantTurn.mockRejectedValue(new Error('Network failed'));
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this draft');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Keep this draft');
    expect(result.current.error).toBe(
      'Message was not sent. Your draft was kept. Try again.'
    );
  });

  it('reports an acknowledged stream failure without restoring the already-sent draft', async () => {
    const acknowledgedUserTurn: ConversationAssistantTurn = {
      id: 'acknowledged-user',
      sessionId: session.id,
      userId: 'user-1',
      role: 'user',
      text: 'Already sent',
      createdAt: '2026-06-21T11:06:00.000Z',
    };
    const savedErrorTurn: ConversationAssistantTurn = {
      id: 'saved-error-answer',
      sessionId: session.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'The assistant could not finish this answer.',
      createdAt: '2026-06-21T11:07:00.000Z',
      error: { code: 'LLM_ERROR', message: 'Answer stream disconnected' },
    };
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockResolvedValueOnce({ turns: [...turns, acknowledgedUserTurn] })
      .mockResolvedValueOnce({ turns: [...turns, acknowledgedUserTurn, savedErrorTurn] });
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'user_turn',
          turn: acknowledgedUserTurn,
        });
        onEvent({ type: 'assistant_delta', text: 'Unpersisted partial answer' });
        throw new Error('Answer stream disconnected');
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Already sent');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.turns).toEqual([...turns, acknowledgedUserTurn, savedErrorTurn]);
    expect(result.current.turns.some((turn) => turn.text === 'Unpersisted partial answer')).toBe(
      false
    );
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe(
      'The live response was interrupted. Saved messages were refreshed.'
    );
  });

  it('bounds acknowledged-turn recovery when one refresh attempt never answers', async () => {
    const acknowledgedUserTurn: ConversationAssistantTurn = {
      id: 'bounded-recovery-user',
      sessionId: session.id,
      userId: 'user-1',
      role: 'user',
      text: 'Already sent',
      createdAt: '2026-06-21T11:06:00.000Z',
    };
    const savedAssistantTurn: ConversationAssistantTurn = {
      id: 'bounded-recovery-assistant',
      sessionId: session.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Saved after disconnect.',
      createdAt: '2026-06-21T11:07:00.000Z',
    };
    const hangingRefresh = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockReturnValueOnce(hangingRefresh.promise)
      .mockResolvedValue({ turns: [...turns, acknowledgedUserTurn, savedAssistantTurn] });
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({ type: 'user_turn', turn: acknowledgedUserTurn });
        onEvent({ type: 'assistant_delta', text: 'Partial' });
        throw new Error('Disconnected');
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Already sent');
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    const completion = await Promise.race([
      sendPromise.then(() => 'settled' as const),
      new Promise<'timed-out'>((resolve) => {
        window.setTimeout(() => resolve('timed-out'), 1500);
      }),
    ]);
    await act(async () => {
      hangingRefresh.resolve({ turns: [...turns, acknowledgedUserTurn, savedAssistantTurn] });
      await sendPromise;
    });

    expect(completion).toBe('settled');
    expect(result.current.turnPhase).toBe('idle');
  });

  it('removes an unpersisted partial answer and asks for refresh when reconciliation fails', async () => {
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockRejectedValue(new Error('Refresh failed'));
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'user_turn',
          turn: {
            id: 'acknowledged-user',
            sessionId: session.id,
            userId: 'user-1',
            role: 'user',
            text: 'Already sent',
            createdAt: '2026-06-21T11:06:00.000Z',
          },
        });
        onEvent({ type: 'assistant_delta', text: 'Misleading partial answer' });
        throw new Error('Connection ended');
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Already sent');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.turns.some((turn) => turn.text === 'Misleading partial answer')).toBe(
      false
    );
    expect(result.current.error).toBe(
      'The live response was interrupted. Refresh the page to check the saved response.'
    );
  });

  it('does not show a stale recovery error after switching analyses', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
      transcriptSha256: 'def456',
    };
    const acknowledgedUserTurn: ConversationAssistantTurn = {
      id: 'acknowledged-user',
      sessionId: session.id,
      userId: 'user-1',
      role: 'user',
      text: 'Already sent',
      createdAt: '2026-06-21T11:06:00.000Z',
    };
    const savedAssistantTurn: ConversationAssistantTurn = {
      id: 'saved-assistant',
      sessionId: session.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Saved after the stream closed.',
      createdAt: '2026-06-21T11:07:00.000Z',
    };
    const recoveryRequest = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    let firstSessionTurnsCalls = 0;
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) => {
      if (sessionId === secondSession.id) return Promise.resolve({ turns: [] });
      firstSessionTurnsCalls += 1;
      return firstSessionTurnsCalls === 1
        ? Promise.resolve({ turns })
        : recoveryRequest.promise;
    });
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({ type: 'user_turn', turn: acknowledgedUserTurn });
        throw new Error('Connection ended');
      }
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Already sent');
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(firstSessionTurnsCalls).toBe(2);
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });

    await act(async () => {
      recoveryRequest.resolve({ turns: [...turns, acknowledgedUserTurn, savedAssistantTurn] });
      await sendPromise;
    });

    expect(result.current.selectedSession?.id).toBe(secondSession.id);
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('ignores duplicate follow-up sends while a send is in flight', async () => {
    const sendRequest = createDeferred<undefined>();
    mocks.streamConversationAssistantTurn.mockReturnValue(sendRequest.promise);

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });

    act(() => {
      void result.current.sendFollowUp();
      void result.current.sendFollowUp();
    });

    await waitFor(() => {
      expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      sendRequest.resolve(undefined);
      await sendRequest.promise;
    });
  });

  it('loads direct chats across paginated private chat responses', async () => {
    mocks.listPrivateWhatsAppChats
      .mockResolvedValueOnce({ chats: [groupChat], nextCursor: 'next-page' })
      .mockResolvedValueOnce({ chats: [directChat] });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.directChats).toEqual([directChat]);
    });

    expect(mocks.listPrivateWhatsAppChats).toHaveBeenNthCalledWith(1, 'tok', { limit: 100 });
    expect(mocks.listPrivateWhatsAppChats).toHaveBeenNthCalledWith(2, 'tok', {
      limit: 100,
      cursor: 'next-page',
    });
    expect(result.current.selectedChatId).toBeUndefined();
  });

  it('does not append follow-up turns when the selected session changes before send resolves', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
      transcriptSha256: 'def456',
    };
    const sendRequest = createDeferred<undefined>();
    let streamEventHandler: ((event: unknown) => void) | undefined;
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === secondSession.id ? [] : turns })
    );
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        _request: { question: string },
        onEvent: (event: unknown) => void
      ) => {
        streamEventHandler = onEvent;
        return await sendRequest.promise;
      }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });

    act(() => {
      result.current.selectSession(secondSession.id);
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });

    await act(async () => {
      streamEventHandler?.({
        type: 'assistant_turn',
        turn: {
          id: 'turn-session-1-late',
          sessionId: session.id,
          userId: 'user-1',
          role: 'assistant',
          text: 'Late answer for session one.',
          createdAt: '2026-06-21T11:08:00.000Z',
        },
      });
      sendRequest.resolve(undefined);
      await sendRequest.promise;
      await sendPromise;
    });

    expect(result.current.selectedSession?.id).toBe(secondSession.id);
    expect(result.current.turns).toEqual([]);
    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('refresh reloads the selected session turns', async () => {
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockResolvedValueOnce({
        turns: [
          ...turns,
          {
            id: 'turn-refreshed',
            sessionId: session.id,
            userId: 'user-1',
            role: 'assistant',
            text: 'Refreshed answer.',
            createdAt: '2026-06-21T11:09:00.000Z',
          },
        ],
      });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.turns).toEqual(turns);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.turns.at(-1)?.text).toBe('Refreshed answer.');
  });

  it('clears stale selected session content when reloading the selected session fails', async () => {
    mocks.listConversationAssistantSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockResolvedValueOnce({ sessions: [session] });
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(new Error('session missing'));

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.selectedSession).toBeUndefined();
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBe('session missing');
  });

  it('clears follow-up state when the URL-selected session changes outside selectSession', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === secondSession.id ? [] : turns })
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('Session one draft');
      result.current.navigateToSession(secondSession.id);
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });

    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('clears stale session content immediately when the URL-selected session changes', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
    };
    const secondTurnsRequest = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      sessionId === secondSession.id
        ? secondTurnsRequest.promise
        : Promise.resolve({ turns })
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.turns).toEqual(turns);
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });

    await waitFor(() => {
      expect(result.current.turns).toEqual([]);
    });
    expect(result.current.selectedSession).toBeUndefined();
    expect(result.current.loadingTurns).toBe(true);

    await act(async () => {
      secondTurnsRequest.resolve({ turns: [] });
      await secondTurnsRequest.promise;
    });

    expect(result.current.selectedSession?.id).toBe(secondSession.id);
  });

  it('clears existing follow-up state when creating a new session switches selection', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-created',
      title: 'Created context',
    };
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
    );
    mocks.listConversationAssistantTurns.mockResolvedValue({ turns: [] });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    await chooseDirectChat(result);

    act(() => {
      result.current.setFollowUpQuestion('Old follow-up draft');
    });

    await act(async () => {
      await result.current.createSession();
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(createdSession.id);
    });
    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('does not apply created session turns after the user switches sessions before they load', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-created',
      title: 'Created context',
    };
    const createdTurnsRequest = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      sessionId === createdSession.id ? createdTurnsRequest.promise : Promise.resolve({ turns })
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await chooseDirectChat(result);

    await act(async () => {
      await result.current.createSession();
    });

    await waitFor(() => {
      expect(result.current.search).toBe('?session=session-created');
    });

    act(() => {
      result.current.navigateToSession(session.id);
    });

    await act(async () => {
      createdTurnsRequest.resolve({
        turns: [
          {
            id: 'created-turn',
            sessionId: createdSession.id,
            userId: 'user-1',
            role: 'assistant',
            text: 'Created session answer.',
            createdAt: '2026-06-21T11:10:00.000Z',
          },
        ],
      });
      await createdTurnsRequest.promise;
    });

    expect(result.current.selectedSession?.id).toBe(session.id);
    expect(result.current.turns).toEqual(turns);
  });

  it('does not switch to a created session when the user selects another session before create resolves', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-created',
      title: 'Created context',
    };
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
    };
    const createRequest = createDeferred<ConversationAssistantSession>();
    createRequest.promise.catch(() => undefined);
    mocks.createConversationAssistantSession.mockReturnValue(createRequest.promise);
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === secondSession.id ? [] : turns })
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await chooseDirectChat(result);

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.createSession();
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });

    await act(async () => {
      createRequest.resolve(createdSession);
      await createRequest.promise;
      await createPromise;
    });

    expect(result.current.selectedSessionId).toBe(secondSession.id);
    expect(result.current.selectedSession?.id).toBe(secondSession.id);
  });

  it('does not show a create failure after the user selects another session', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
    };
    const createRequest = createDeferred<ConversationAssistantSession>();
    createRequest.promise.catch(() => undefined);
    mocks.createConversationAssistantSession.mockReturnValue(createRequest.promise);
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === secondSession.id ? [] : turns })
    );

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await chooseDirectChat(result);

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.createSession();
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });

    await act(async () => {
      createRequest.reject(new Error('create failed'));
      await createPromise;
    });

    expect(result.current.selectedSessionId).toBe(secondSession.id);
    expect(result.current.selectedSession?.id).toBe(secondSession.id);
    expect(result.current.error).toBeNull();
  });

  it('keeps successful follow-up turns when refreshing session summaries fails', async () => {
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        streamSessionId: string,
        request: { question: string },
        onEvent: (event: unknown) => void
      ) => {
        onEvent({
          type: 'user_turn',
          turn: {
            id: 'turn-follow-user',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-06-21T11:06:00.000Z',
          },
        });
        onEvent({ type: 'done' });
      }
    );
    mocks.listConversationAssistantSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockRejectedValueOnce(new Error('summary refresh failed'));

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('Follow up?');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.turns.at(-1)?.id).toBe('turn-follow-user');
    expect(result.current.error).toBeNull();
    expect(result.current.followUpQuestion).toBe('');
  });

  it('clears loadingTurns when the session query param is removed during an in-flight load', async () => {
    const sessionRequest = createDeferred<ConversationAssistantSession>();
    const turnsRequest = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    mocks.getConversationAssistantSession.mockReturnValue(sessionRequest.promise);
    mocks.listConversationAssistantTurns.mockReturnValue(turnsRequest.promise);

    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.loadingTurns).toBe(true);
    });

    act(() => {
      result.current.clearSession();
    });

    await waitFor(() => {
      expect(result.current.search).toBe('');
    });
    expect(result.current.loadingTurns).toBe(false);
    expect(result.current.turns).toEqual([]);
  });

  it('clears the selected chat when refreshed direct chats no longer include it', async () => {
    const secondChat: PrivateWhatsAppChat = {
      ...directChat,
      id: 'chat-direct-2',
      displayName: 'Bob',
    };
    mocks.listPrivateWhatsAppChats
      .mockResolvedValueOnce({ chats: [directChat] })
      .mockResolvedValueOnce({ chats: [secondChat] });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.selectedChatId).toBeUndefined();
  });

  it('does not let older session and chat refresh responses overwrite newer state', async () => {
    const oldChat: PrivateWhatsAppChat = {
      ...directChat,
      id: 'chat-old',
      displayName: 'Old chat',
    };
    const latestChat: PrivateWhatsAppChat = {
      ...directChat,
      id: 'chat-latest',
      displayName: 'Latest chat',
    };
    const oldSession: ConversationAssistantSession = {
      ...session,
      id: 'session-old',
      title: 'Old session',
    };
    const latestSession: ConversationAssistantSession = {
      ...session,
      id: 'session-latest',
      title: 'Latest session',
    };
    const oldChatsRequest = createDeferred<{ chats: PrivateWhatsAppChat[] }>();
    const latestChatsRequest = createDeferred<{ chats: PrivateWhatsAppChat[] }>();
    const oldSessionsRequest = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    const latestSessionsRequest = createDeferred<{ sessions: ConversationAssistantSession[] }>();

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    mocks.listPrivateWhatsAppChats
      .mockReturnValueOnce(oldChatsRequest.promise)
      .mockReturnValueOnce(latestChatsRequest.promise);
    mocks.listConversationAssistantSessions
      .mockReturnValueOnce(oldSessionsRequest.promise)
      .mockReturnValueOnce(latestSessionsRequest.promise);

    let oldRefreshPromise!: Promise<void>;
    let latestRefreshPromise!: Promise<void>;
    act(() => {
      oldRefreshPromise = result.current.refresh();
      latestRefreshPromise = result.current.refresh();
    });

    await waitFor(() => {
      expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledTimes(3);
      expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      latestChatsRequest.resolve({ chats: [latestChat] });
      latestSessionsRequest.resolve({ sessions: [latestSession] });
      await latestRefreshPromise;
    });

    expect(result.current.selectedChatId).toBeUndefined();
    expect(result.current.directChats).toEqual([latestChat]);
    expect(result.current.sessions).toEqual([latestSession]);

    await act(async () => {
      oldChatsRequest.resolve({ chats: [oldChat] });
      oldSessionsRequest.resolve({ sessions: [oldSession] });
      await oldRefreshPromise;
    });

    expect(result.current.selectedChatId).toBeUndefined();
    expect(result.current.directChats).toEqual([latestChat]);
    expect(result.current.sessions).toEqual([latestSession]);
  });

  it('does not let an older refresh failure set an error after newer data loads', async () => {
    const latestChat: PrivateWhatsAppChat = {
      ...directChat,
      id: 'chat-latest',
      displayName: 'Latest chat',
    };
    const latestSession: ConversationAssistantSession = {
      ...session,
      id: 'session-latest',
      title: 'Latest session',
    };
    const oldChatsRequest = createDeferred<{ chats: PrivateWhatsAppChat[] }>();
    const latestChatsRequest = createDeferred<{ chats: PrivateWhatsAppChat[] }>();
    const oldSessionsRequest = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    const latestSessionsRequest = createDeferred<{ sessions: ConversationAssistantSession[] }>();

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await chooseDirectChat(result);

    mocks.listPrivateWhatsAppChats
      .mockReturnValueOnce(oldChatsRequest.promise)
      .mockReturnValueOnce(latestChatsRequest.promise);
    mocks.listConversationAssistantSessions
      .mockReturnValueOnce(oldSessionsRequest.promise)
      .mockReturnValueOnce(latestSessionsRequest.promise);

    let oldRefreshPromise!: Promise<void>;
    let latestRefreshPromise!: Promise<void>;
    act(() => {
      oldRefreshPromise = result.current.refresh();
      latestRefreshPromise = result.current.refresh();
    });

    await waitFor(() => {
      expect(mocks.listPrivateWhatsAppChats).toHaveBeenCalledTimes(3);
      expect(mocks.listConversationAssistantSessions).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      latestChatsRequest.resolve({ chats: [latestChat] });
      latestSessionsRequest.resolve({ sessions: [latestSession] });
      await latestRefreshPromise;
    });

    await act(async () => {
      oldChatsRequest.resolve({ chats: [directChat] });
      oldSessionsRequest.resolve(Promise.reject(new Error('old refresh failed')) as never);
      await oldRefreshPromise;
    });

    expect(result.current.selectedChatId).toBeUndefined();
    expect(result.current.directChats).toEqual([latestChat]);
    expect(result.current.sessions).toEqual([latestSession]);
    expect(result.current.error).toBeNull();
  });

  it('exports selected session PDF through the service helper and browser download flow', async () => {
    const { createObjectURL, revokeObjectURL, anchorClickSpy } = mockBrowserDownloadApis();
    const createElementSpy = vi.spyOn(document, 'createElement');

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    expect(result.current.exporting).toBe(false);

    await act(async () => {
      await result.current.exportSelectedSessionPdf();
    });

    expect(mocks.exportConversationAssistantSessionPdf).toHaveBeenCalledWith('tok', session.id);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:session-1');

    const anchor = createElementSpy.mock.results.find(
      (entry) => entry.type === 'return' && entry.value instanceof HTMLAnchorElement
    )?.value as HTMLAnchorElement | undefined;
    expect(anchor).toBeDefined();
    expect(anchor?.download).toBe('alice-context.pdf');
    expect(anchor?.href).toBe('blob:session-1');
    expect(document.body.contains(anchor ?? null)).toBe(false);
    expect(result.current.exporting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not export without a selected session and reports a helpful error', async () => {
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.directChats).toEqual([directChat]);
    });

    await act(async () => {
      await result.current.exportSelectedSessionPdf();
    });

    expect(mocks.exportConversationAssistantSessionPdf).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Select an assistant session before exporting.');
    expect(result.current.exporting).toBe(false);
  });

  it('prevents duplicate exports while an export is already in flight', async () => {
    mockBrowserDownloadApis();
    const exportRequest = createDeferred<{ blob: Blob; filename: string }>();
    mocks.exportConversationAssistantSessionPdf.mockReturnValue(exportRequest.promise);

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    let firstExport!: Promise<void>;
    let secondExport!: Promise<void>;
    act(() => {
      firstExport = result.current.exportSelectedSessionPdf();
      secondExport = result.current.exportSelectedSessionPdf();
    });

    await waitFor(() => {
      expect(result.current.exporting).toBe(true);
    });
    expect(mocks.exportConversationAssistantSessionPdf).toHaveBeenCalledTimes(1);

    await act(async () => {
      exportRequest.resolve({
        blob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
        filename: 'alice-context.pdf',
      });
      await Promise.all([firstExport, secondExport]);
    });

    expect(result.current.exporting).toBe(false);
  });

  it('clears exporting and surfaces API failures when PDF export fails', async () => {
    mocks.exportConversationAssistantSessionPdf.mockRejectedValue(new Error('export failed'));

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    await act(async () => {
      await result.current.exportSelectedSessionPdf();
    });

    expect(result.current.exporting).toBe(false);
    expect(result.current.error).toBe('export failed');
  });
});
