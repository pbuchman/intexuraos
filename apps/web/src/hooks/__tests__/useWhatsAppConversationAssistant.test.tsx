/**
 * Tests for the WhatsApp Conversation Assistant hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
  PrivateWhatsAppChat,
} from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listPrivateWhatsAppChats: vi.fn(),
  listConversationAssistantSessions: vi.fn(),
  checkConversationAssistantContext: vi.fn(),
  createConversationAssistantSession: vi.fn(),
  getConversationAssistantSession: vi.fn(),
  listConversationAssistantTurns: vi.fn(),
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
  getConversationAssistantSession: mocks.getConversationAssistantSession,
  listConversationAssistantTurns: mocks.listConversationAssistantTurns,
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
  userId: 'user-1',
  chatId: directChat.id,
  chatDisplayName: directChat.displayName,
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

describe('useWhatsAppConversationAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('tok');
    mocks.listPrivateWhatsAppChats.mockResolvedValue({ chats: [groupChat, directChat] });
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session] });
    mocks.checkConversationAssistantContext.mockResolvedValue({
      messageCount: 42,
      warningThreshold: 5000,
      requiresConfirmation: false,
    });
    mocks.getConversationAssistantSession.mockResolvedValue(session);
    mocks.listConversationAssistantTurns.mockResolvedValue({ turns });
    mocks.createConversationAssistantSession.mockResolvedValue(session);
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

  it('creates a new session from selected chat, time range, and optional first question', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-created',
      title: 'Created context',
      createdAt: '2026-06-21T12:00:00.000Z',
      updatedAt: '2026-06-21T12:00:00.000Z',
    };
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === createdSession.id ? createdSession : session)
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
      result.current.setFirstQuestion('What changed?');
    });

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.checkConversationAssistantContext).toHaveBeenCalledWith('tok', {
      chatId: directChat.id,
      from: new Date('2026-06-20T09:00').toISOString(),
      to: new Date('2026-06-21T10:00').toISOString(),
    });
    expect(mocks.createConversationAssistantSession).toHaveBeenCalledWith('tok', {
      chatId: directChat.id,
      from: new Date('2026-06-20T09:00').toISOString(),
      to: new Date('2026-06-21T10:00').toISOString(),
      question: 'What changed?',
    });
    expect(result.current.sessions[0]).toEqual(createdSession);
    expect(result.current.selectedSession?.id).toBe(createdSession.id);
    expect(result.current.firstQuestion).toBe('');
  });

  it('requires confirmation before creating a session with a large context', async () => {
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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

    await act(async () => {
      await result.current.createSession();
    });

    expect(result.current.largeContextWarning).toEqual({
      messageCount: 5001,
      warningThreshold: 5000,
      requiresConfirmation: true,
    });
    expect(mocks.createConversationAssistantSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmLargeContextCreate();
    });

    expect(mocks.createConversationAssistantSession).toHaveBeenCalledTimes(1);
    expect(result.current.largeContextWarning).toBeNull();
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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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
    expect(result.current.selectedChatId).toBe(directChat.id);
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
    expect(result.current.sending).toBe(false);
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
    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

  it('revalidates selected chat when refreshed direct chats no longer include it', async () => {
    const secondChat: PrivateWhatsAppChat = {
      ...directChat,
      id: 'chat-direct-2',
      displayName: 'Bob',
    };
    mocks.checkConversationAssistantContext.mockResolvedValue({
      messageCount: 5001,
      warningThreshold: 5000,
      requiresConfirmation: true,
    });
    mocks.listPrivateWhatsAppChats
      .mockResolvedValueOnce({ chats: [directChat] })
      .mockResolvedValueOnce({ chats: [secondChat] });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

    await act(async () => {
      await result.current.createSession();
    });
    expect(result.current.largeContextWarning?.messageCount).toBe(5001);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.selectedChatId).toBe(secondChat.id);
    expect(result.current.largeContextWarning).toBeNull();
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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

    expect(result.current.selectedChatId).toBe(latestChat.id);
    expect(result.current.directChats).toEqual([latestChat]);
    expect(result.current.sessions).toEqual([latestSession]);

    await act(async () => {
      oldChatsRequest.resolve({ chats: [oldChat] });
      oldSessionsRequest.resolve({ sessions: [oldSession] });
      await oldRefreshPromise;
    });

    expect(result.current.selectedChatId).toBe(latestChat.id);
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

    await waitFor(() => {
      expect(result.current.selectedChatId).toBe(directChat.id);
    });

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

    expect(result.current.selectedChatId).toBe(latestChat.id);
    expect(result.current.directChats).toEqual([latestChat]);
    expect(result.current.sessions).toEqual([latestSession]);
    expect(result.current.error).toBeNull();
  });
});
