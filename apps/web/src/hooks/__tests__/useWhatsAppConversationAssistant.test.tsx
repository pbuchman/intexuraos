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
  ConversationAssistantContextAttachment,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  ConversationAssistantTurn,
  ConversationAssistantTurnRequestResponse,
  PrivateWhatsAppChat,
} from '@/types';
import {
  getConversationAssistantDraftStorageKey,
  saveConversationAssistantDraft,
} from '@/utils/conversationAssistantDraftStorage.js';
import { ApiError } from '@/services/apiClient.js';

const mocks = vi.hoisted(() => ({
  user: { sub: 'user-1' } as { sub?: string } | undefined,
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
  sendConversationAssistantTurn: vi.fn(),
  streamConversationAssistantTurn: vi.fn(),
  createConversationAssistantContextAttachment: vi.fn(),
  getConversationAssistantContextAttachment: vi.fn(),
  getConversationAssistantContextAttachmentPreview: vi.fn(),
  getConversationAssistantContextHistory: vi.fn(),
  getConversationAssistantTurnRequest: vi.fn(),
  removeConversationAssistantContextAttachment: vi.fn(),
  retryConversationAssistantContextAttachment: vi.fn(),
  retryConversationAssistantTurnAnswer: vi.fn(),
  resumeConversationAssistantTurnRequest: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken; user: typeof mocks.user } => ({
    getAccessToken: mocks.getAccessToken,
    user: mocks.user,
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
  sendConversationAssistantTurn: mocks.sendConversationAssistantTurn,
  streamConversationAssistantTurn: mocks.streamConversationAssistantTurn,
  createConversationAssistantContextAttachment:
    mocks.createConversationAssistantContextAttachment,
  getConversationAssistantContextAttachment: mocks.getConversationAssistantContextAttachment,
  getConversationAssistantContextAttachmentPreview:
    mocks.getConversationAssistantContextAttachmentPreview,
  getConversationAssistantContextHistory: mocks.getConversationAssistantContextHistory,
  getConversationAssistantTurnRequest: mocks.getConversationAssistantTurnRequest,
  removeConversationAssistantContextAttachment:
    mocks.removeConversationAssistantContextAttachment,
  retryConversationAssistantContextAttachment:
    mocks.retryConversationAssistantContextAttachment,
  retryConversationAssistantTurnAnswer: mocks.retryConversationAssistantTurnAnswer,
  resumeConversationAssistantTurnRequest: mocks.resumeConversationAssistantTurnRequest,
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
    availability: { state: 'legacy_session' },
    contextVersion: 0,
    snapshotCount: 0,
    totalAttachedMessageCount: 0,
    totalAttachedOmittedCount: 0,
    completedConversationRevision: 0,
    activeTurn: null,
  },
};

const continuationSession: ConversationAssistantSession = {
  ...session,
  contextSummary: {
    availability: { state: 'available', displayTimeZone: 'Europe/Warsaw' },
    contextVersion: 0,
    snapshotCount: 1,
    totalAttachedMessageCount: 0,
    totalAttachedOmittedCount: 0,
    completedConversationRevision: 0,
    activeTurn: null,
  },
};

const readyAttachment: ConversationAssistantContextAttachment = {
  id: 'attachment-1',
  sessionId: continuationSession.id,
  status: 'ready',
  compatibility: 'current',
  capturedAt: '2026-07-21T10:00:00.000Z',
  expiresAt: '2026-07-21T11:00:00.000Z',
  captureRange: {
    from: '2026-07-20T10:00:00.000Z',
    to: '2026-07-21T10:00:00.000Z',
  },
  counts: {
    included: 2,
    excluded: 0,
    newlyAvailable: 2,
    edited: 0,
    redacted: 0,
    deleted: 0,
    reactionsChanged: 0,
    lateIngested: 0,
    completedTranscriptions: 0,
  },
  omitted: {
    mediaOnly: 0,
    failedTranscriptions: 0,
    pendingTranscriptions: 0,
    nonText: 0,
    overLimit: 0,
  },
  requiresConfirmation: false,
  newerAvailableCount: 0,
  newerAvailableCorrectionCount: 0,
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

interface BroadcastChannelTestDouble {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function installBroadcastChannelTestDouble(): BroadcastChannelTestDouble[] {
  const channels: BroadcastChannelTestDouble[] = [];

  class BroadcastChannelStub implements BroadcastChannelTestDouble {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly postMessage = vi.fn();
    readonly close = vi.fn();

    constructor(_name: string) {
      channels.push(this);
    }
  }

  vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
  return channels;
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
    vi.resetAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-21T10:00:00.000Z'));
    mocks.user = { sub: 'user-1' };
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
    mocks.sendConversationAssistantTurn.mockResolvedValue({ turns: [] });
    mocks.exportConversationAssistantSessionPdf.mockResolvedValue({
      blob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
      filename: 'alice-context.pdf',
    });
    mocks.createConversationAssistantContextAttachment.mockResolvedValue(readyAttachment);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(readyAttachment);
    mocks.getConversationAssistantContextAttachmentPreview.mockResolvedValue({ items: [] });
    mocks.getConversationAssistantContextHistory.mockResolvedValue({ snapshots: [] });
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(new Error('Not found'));
    mocks.removeConversationAssistantContextAttachment.mockResolvedValue(undefined);
    mocks.retryConversationAssistantContextAttachment.mockResolvedValue(readyAttachment);
    mocks.retryConversationAssistantTurnAnswer.mockResolvedValue({
      request: {
        id: 'turn-request-1',
        sessionId: session.id,
        status: 'in_progress',
        attempt: 2,
        stateVersion: 2,
        conversationRevision: 1,
      },
      turns: [],
      canRetryAnswer: false,
    });
    mocks.resumeConversationAssistantTurnRequest.mockResolvedValue({
      request: {
        id: 'turn-request-1',
        sessionId: session.id,
        status: 'in_progress',
        attempt: 1,
        stateVersion: 1,
        conversationRevision: 1,
      },
      turns: [],
      canRetryAnswer: false,
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
      displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(result.current.sessions[0]).toEqual(createdSession);
    expect(result.current.selectedSession?.id).toBe(createdSession.id);
    await waitFor(() => {
      expect(result.current.turns).toEqual(createdTurns);
    });
  });

  it('creates a smaller analysis from the same contact and transfers the saved draft', async () => {
    const createdSession: ConversationAssistantSession = {
      ...session,
      id: 'session-smaller',
      status: 'preparing',
      preparationStage: 'queued',
    };
    mocks.createConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.getConversationAssistantSession.mockResolvedValue(createdSession);
    mocks.listConversationAssistantTurns.mockResolvedValue({ turns: [] });
    const sourceIdentity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: session.id,
    };
    saveConversationAssistantDraft(window.sessionStorage, sourceIdentity, {
      question: 'Please compare the tone changes.',
      warningAcknowledged: false,
    });

    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          loadChats: false,
          loadSessions: false,
          sourceSessionId: session.id,
          initialFrom: '2026-06-21T00:00:00.000Z',
          initialTo: '2026-06-21T10:00:00.000Z',
          initialModel: ConversationAssistantModels.MiniMaxM3,
        }),
      { wrapper: createWrapper('/whatsapp/conversation-assistant/new') }
    );

    await act(async () => {
      await result.current.createSession();
    });

    expect(mocks.createConversationAssistantSession).toHaveBeenCalledWith('tok', {
      requestId: expect.any(String),
      sourceSessionId: session.id,
      from: '2026-06-21T00:00:00.000Z',
      to: '2026-06-21T10:00:00.000Z',
      model: ConversationAssistantModels.MiniMaxM3,
      displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await waitFor(() => {
      expect(result.current.followUpQuestion).toBe('Please compare the tone changes.');
    });
    expect(
      window.sessionStorage.getItem(
        getConversationAssistantDraftStorageKey({
          ...sourceIdentity,
          sessionId: createdSession.id,
        })
      )
    ).toContain('Please compare the tone changes.');
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
        displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      { question: 'Follow up?', requestId: expect.any(String) },
      expect.any(Function),
      expect.any(AbortSignal)
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

  it('returns to idle as soon as the completed stream closes without waiting for detail or list refresh', async () => {
    const detailRefresh = createDeferred<ConversationAssistantSession>();
    const summaryRefresh = createDeferred<{ sessions: ConversationAssistantSession[] }>();
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(session)
      .mockReturnValueOnce(detailRefresh.promise);
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
      expect(mocks.getConversationAssistantSession).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await sendPromise;
    });
    expect(result.current.turnPhase).toBe('idle');

    act(() => {
      result.current.setFollowUpQuestion('A second follow-up');
    });
    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(2);

    await act(async () => {
      detailRefresh.resolve({ ...session, title: 'Stale detail from the first request' });
      summaryRefresh.resolve({ sessions: [session] });
    });
    expect(result.current.selectedSession?.title).toBe(session.title);
  });

  it('returns to idle and preserves the draft when submission fails before acknowledgement', async () => {
    mocks.streamConversationAssistantTurn.mockRejectedValue(new Error('Network failed'));
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Session or attachment not found', 404)
    );
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

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
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
      .mockResolvedValue({ turns: [...turns, acknowledgedUserTurn, savedErrorTurn] });
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: { question: string; requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        acknowledgedUserTurn.requestId = request.requestId;
        savedErrorTurn.requestId = request.requestId;
        onEvent({
          type: 'user_turn',
          turn: acknowledgedUserTurn,
        });
        onEvent({ type: 'assistant_delta', text: 'Unpersisted partial answer' });
        throw new Error('Answer stream disconnected');
      }
    );
    mocks.getConversationAssistantTurnRequest.mockImplementation(
      (_token: string, _sessionId: string, requestId: string) =>
        Promise.resolve({
          request: {
            id: requestId,
            sessionId: session.id,
            status: 'completed',
            attempt: 1,
            stateVersion: 2,
            conversationRevision: 1,
          },
          turns: [acknowledgedUserTurn, savedErrorTurn],
          canRetryAnswer: true,
        })
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

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.turns).toEqual([...turns, acknowledgedUserTurn, savedErrorTurn]);
    expect(result.current.turns.some((turn) => turn.text === 'Unpersisted partial answer')).toBe(
      false
    );
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('keeps acknowledged recovery waiting and allows drafting the next question through 5xx', async () => {
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        streamSessionId: string,
        request: { requestId: string; question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'user_turn',
          requestId: request.requestId,
          streamSequence: 1,
          turn: {
            id: 'persisted-before-status-5xx',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:01:00.000Z',
            requestId: request.requestId,
          },
        });
        throw new Error('Live response disconnected');
      }
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('SERVICE_UNAVAILABLE', 'Status temporarily unavailable', 503)
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Persist this before the status outage');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalled();
    });

    expect(result.current.turnPhase).toBe('waiting');
    expect(result.current.error).toBe(
      'The live response was interrupted. Checking the saved answer.'
    );
    act(() => {
      result.current.setFollowUpQuestion('Draft the next question while the answer recovers');
    });
    expect(result.current.followUpQuestion).toBe(
      'Draft the next question while the answer recovers'
    );
  });

  it('settles the stream call while a durable acknowledged-turn status check is pending', async () => {
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
    const requestStatus = createDeferred<ConversationAssistantTurnRequestResponse>();
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockResolvedValue({ turns: [...turns, acknowledgedUserTurn, savedAssistantTurn] });
    mocks.getConversationAssistantTurnRequest.mockReturnValue(requestStatus.promise);
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: { question: string; requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        acknowledgedUserTurn.requestId = request.requestId;
        savedAssistantTurn.requestId = request.requestId;
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
    expect(completion).toBe('settled');
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('waiting');
    });

    await act(async () => {
      requestStatus.resolve({
        request: {
          id: acknowledgedUserTurn.requestId ?? '',
          sessionId: session.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 2,
          conversationRevision: 1,
        },
        turns: [acknowledgedUserTurn, savedAssistantTurn],
        canRetryAnswer: false,
      });
      await sendPromise;
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
  });

  it('removes an unpersisted partial answer while durable recovery continues', async () => {
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('SERVICE_UNAVAILABLE', 'Status unavailable', 503)
    );
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
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('waiting');
      expect(result.current.error).toBe(
        'The live response was interrupted. Checking the saved answer.'
      );
    });
  });

  it('does not show a stale recovery error after switching analyses', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
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
    const recoveryRequest = createDeferred<ConversationAssistantTurnRequestResponse>();
    let durableRequestId = '';
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [session, secondSession] });
    mocks.getConversationAssistantSession.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve(sessionId === secondSession.id ? secondSession : session)
    );
    mocks.listConversationAssistantTurns.mockImplementation((_token: string, sessionId: string) =>
      Promise.resolve({ turns: sessionId === secondSession.id ? [] : turns })
    );
    mocks.getConversationAssistantTurnRequest.mockReturnValue(recoveryRequest.promise);
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: { question: string; requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        durableRequestId = request.requestId;
        acknowledgedUserTurn.requestId = request.requestId;
        savedAssistantTurn.requestId = request.requestId;
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
      expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });

    await act(async () => {
      recoveryRequest.resolve({
        request: {
          id: durableRequestId,
          sessionId: session.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 2,
          conversationRevision: 1,
        },
        turns: [acknowledgedUserTurn, savedAssistantTurn],
        canRetryAnswer: false,
      });
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

  it('keeps the newer send abortable when an older stream settles after switching analyses', async () => {
    const secondSession: ConversationAssistantSession = {
      ...session,
      id: 'session-2',
      title: 'Second context',
    };
    const firstSend = createDeferred<undefined>();
    const secondSend = createDeferred<undefined>();
    const signals: AbortSignal[] = [];
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
        _onEvent: (event: unknown) => void,
        signal: AbortSignal
      ) => {
        signals.push(signal);
        return await (signals.length === 1 ? firstSend.promise : secondSend.promise);
      }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    act(() => {
      result.current.setFollowUpQuestion('First question');
    });
    act(() => {
      void result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.selectSession(secondSession.id);
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Second question');
    });
    act(() => {
      void result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(2);
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    await act(async () => {
      firstSend.resolve(undefined);
      await firstSend.promise;
    });
    act(() => {
      result.current.selectSession(session.id);
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    expect(signals[1]?.aborted).toBe(true);

    await act(async () => {
      secondSend.resolve(undefined);
      await secondSend.promise;
    });
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

  it('restores a per-session question and attachment before enabling the composer', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const attachmentStatus = createDeferred<ConversationAssistantContextAttachment>();
    mocks.getConversationAssistantContextAttachment.mockReturnValue(attachmentStatus.promise);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'How did the attitude change?',
        preparationRequestId: 'prepare-1',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('restoring');
    });
    expect(result.current.followUpQuestion).toBe('How did the attitude change?');

    await act(async () => {
      attachmentStatus.resolve(readyAttachment);
      await attachmentStatus.promise;
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'ready',
        attachment: { id: readyAttachment.id },
      });
    });
  });

  it('keeps a restored attachment blocking Send after a transient status failure and retries it', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockRejectedValueOnce(
      new ApiError('SERVICE_UNAVAILABLE', 'Status temporarily unavailable', 503)
    );
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Keep this question attached during a transient failure',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'restore_failed',
        attachmentId: readyAttachment.id,
      });
    });
    expect(result.current.followUpQuestion).toBe(
      'Keep this question attached during a transient failure'
    );

    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();

    mocks.getConversationAssistantContextAttachment.mockResolvedValueOnce(readyAttachment);
    await act(async () => {
      await result.current.retryContextAttachment();
    });
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'ready',
      attachment: { id: readyAttachment.id },
    });
  });

  it('locally discards a definitively missing restored attachment without a DELETE', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Attachment not found', 404)
    );
    mocks.removeConversationAssistantContextAttachment.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Attachment not found', 404)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Keep this missing attachment question',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: 'request-for-missing-attachment',
        warningAcknowledged: true,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('missing');
    });
    await act(async () => {
      await result.current.removeContextAttachment();
    });

    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Keep this missing attachment question');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      question: 'Keep this missing attachment question',
      warningAcknowledged: false,
    });
    expect(stored).not.toHaveProperty('attachmentId');
    expect(stored).not.toHaveProperty('startedTurnRequestId');

    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn.mock.calls.at(-1)?.[2]).toMatchObject({
      question: 'Keep this missing attachment question',
    });
    expect(mocks.streamConversationAssistantTurn.mock.calls.at(-1)?.[2]).not.toHaveProperty(
      'contextAttachmentId'
    );
  });

  it('keeps the restored question when the server reports that its attachment expired', async () => {
    const expiredAttachment = { ...readyAttachment, status: 'expired' as const };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(expiredAttachment);
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Keep this question after attachment expiry',
        attachmentId: expiredAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: expiredAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('expired');
    });
    expect(result.current.followUpQuestion).toBe('Keep this question after attachment expiry');
    expect(
      JSON.parse(
        window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
      )
    ).toMatchObject({
      question: 'Keep this question after attachment expiry',
      attachmentId: expiredAttachment.id,
    });
  });

  it('guards Send locally at the exact attachment expiry boundary', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(readyAttachment.expiresAt ?? ''));
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Do not send with an expired snapshot',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment.phase).toBe('expired');
    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Do not send with an expired snapshot');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it.each([
    {
      label: 'ATTACHMENT_NOT_READY with an expired status',
      code: 'ATTACHMENT_NOT_READY',
      authoritativeAttachment: { ...readyAttachment, status: 'expired' as const },
      expectedPhase: 'expired',
    },
    {
      label: 'ATTACHMENT_NOT_READY with metadata still ready',
      code: 'ATTACHMENT_NOT_READY',
      authoritativeAttachment: readyAttachment,
      expectedPhase: 'recapture_required',
    },
    {
      label: 'CONTEXT_STALE with a committed status',
      code: 'CONTEXT_STALE',
      authoritativeAttachment: {
        ...readyAttachment,
        status: 'committed' as const,
        committedAt: '2026-07-21T10:30:00.000Z',
      },
      expectedPhase: 'consumed_elsewhere',
    },
  ] as const)(
    'resolves $label once instead of entering durable recovery',
    async ({ code, authoritativeAttachment, expectedPhase }) => {
      mocks.listConversationAssistantSessions.mockResolvedValue({
        sessions: [continuationSession],
      });
      mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
      let attachmentStatusCall = 0;
      mocks.getConversationAssistantContextAttachment.mockImplementation(() =>
        Promise.resolve(
          attachmentStatusCall++ === 0 ? readyAttachment : authoritativeAttachment
        )
      );
      mocks.streamConversationAssistantTurn.mockRejectedValue(
        new ApiError(code, 'Attachment rejected before the user turn', 409)
      );
      mocks.getConversationAssistantTurnRequest.mockRejectedValue(
        new ApiError('NOT_FOUND', 'Turn request not found', 404)
      );
      mocks.sendConversationAssistantTurn.mockRejectedValue(
        new ApiError(code, 'Attachment rejected before the user turn', 409)
      );
      const identity = {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      };
      saveConversationAssistantDraft(
        window.sessionStorage,
        identity,
        {
          question: `Keep the question after ${code}`,
          attachmentId: readyAttachment.id,
          warningAcknowledged: false,
        },
        { attachmentExpiresAt: readyAttachment.expiresAt }
      );

      const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
        wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
      });
      await waitFor(() => {
        expect(result.current.pendingContextAttachment.phase).toBe('ready');
      });

      await act(async () => {
        await result.current.sendFollowUp();
      });

      await waitFor(() => {
        expect(result.current.pendingContextAttachment.phase).toBe(expectedPhase);
      });
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.followUpQuestion).toBe(`Keep the question after ${code}`);
      expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
      expect(mocks.getConversationAssistantTurnRequest).not.toHaveBeenCalled();
      expect(mocks.sendConversationAssistantTurn).not.toHaveBeenCalled();
      const stored = JSON.parse(
        window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
      ) as Record<string, unknown>;
      expect(stored).not.toHaveProperty('startedTurnRequestId');
    }
  );

  it('stops exact replay on ATTACHMENT_NOT_READY and reconciles the attachment once', async () => {
    const expiredAttachment = { ...readyAttachment, status: 'expired' as const };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    let attachmentStatusCall = 0;
    mocks.getConversationAssistantContextAttachment.mockImplementation(() =>
      Promise.resolve(attachmentStatusCall++ === 0 ? readyAttachment : expiredAttachment)
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('ATTACHMENT_NOT_READY', 'Attachment expired', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Recover this exact rejected request',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: 'request-rejected-before-user-turn',
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('expired');
      expect(result.current.turnPhase).toBe('idle');
    });
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
    expect(result.current.followUpQuestion).toBe('Recover this exact rejected request');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('requires recapture when exact replay reports ATTACHMENT_NOT_READY but metadata stays ready', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(readyAttachment);
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('ATTACHMENT_NOT_READY', 'Prepared chunks are unavailable', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Recapture this exact rejected update',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: 'request-with-missing-prepared-chunks',
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.pendingContextAttachment.phase).toBe('recapture_required');
    });
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledOnce();
    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
    expect(result.current.followUpQuestion).toBe('Recapture this exact rejected update');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('returns exact CONFIRMATION_REQUIRED replay to a refreshed confirmation flow', async () => {
    const oldConfirmationAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      requiresConfirmation: true,
      confirmationToken: 'old-confirmation-token',
    };
    const refreshedConfirmationAttachment: ConversationAssistantContextAttachment = {
      ...oldConfirmationAttachment,
      confirmationToken: 'refreshed-confirmation-token',
    };
    let attachmentStatusCall = 0;
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockImplementation(() =>
      Promise.resolve(
        attachmentStatusCall++ === 0
          ? oldConfirmationAttachment
          : refreshedConfirmationAttachment
      )
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('CONFIRMATION_REQUIRED', 'Confirm the refreshed attachment', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Confirm this exact replay again',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: 'confirmation-required-replay',
        warningAcknowledged: true,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
      expect(result.current.contextAttachmentWarningAcknowledged).toBe(false);
    });
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledWith(
      'tok',
      continuationSession.id,
      expect.objectContaining({
        requestId: 'confirmation-required-replay',
        confirmationToken: 'old-confirmation-token',
      }),
      expect.any(AbortSignal)
    );
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledOnce();
    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
    expect(result.current.followUpQuestion).toBe('Confirm this exact replay again');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    );
    expect(stored).toMatchObject({ warningAcknowledged: false });
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('marks an attachment missing when exact replay and authoritative status both return 404', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        request: { requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'error',
          requestId: request.requestId,
          streamSequence: 1,
          error: { code: 'NOT_FOUND', message: 'Attachment disappeared before commit' },
        });
        onEvent({ type: 'done', requestId: request.requestId, streamSequence: 2 });
        return Promise.resolve();
      }
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Attachment not found', 404)
    );
    mocks.getConversationAssistantContextAttachment.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Attachment not found', 404)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this question after the attachment disappears');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledOnce();
      expect(result.current.turnPhase).toBe('idle');
    });

    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'missing',
      attachmentId: readyAttachment.id,
    });
    expect(result.current.followUpQuestion).toBe(
      'Keep this question after the attachment disappears'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('startedTurnRequestId');
    await act(async () => {
      await result.current.removeContextAttachment();
    });
    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
  });

  it('atomically replaces an expired attachment without losing its question or surfacing a distant error', async () => {
    const expiredAttachment = { ...readyAttachment, status: 'expired' as const };
    const replacementAttachment = {
      ...readyAttachment,
      id: 'attachment-after-expiry',
      status: 'preparing' as const,
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(expiredAttachment);
    mocks.createConversationAssistantContextAttachment.mockResolvedValue(replacementAttachment);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Compare the messages after this expired snapshot',
        attachmentId: expiredAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: expiredAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('expired');
    });

    await act(async () => {
      await result.current.refreshContextAttachment();
    });

    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledWith(
      'tok',
      continuationSession.id,
      {
        requestId: expect.any(String),
        replacesAttachmentId: expiredAttachment.id,
      },
      expect.any(AbortSignal)
    );
    expect(result.current.followUpQuestion).toBe(
      'Compare the messages after this expired snapshot'
    );
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'preparing',
      attachment: { id: replacementAttachment.id },
    });
    expect(result.current.error).toBeNull();
  });

  it('does not restart draft restoration when only selected-session metadata refreshes', async () => {
    const refreshedSession = { ...continuationSession, title: 'Refreshed summary title' };
    mocks.listConversationAssistantSessions
      .mockResolvedValueOnce({ sessions: [continuationSession] })
      .mockResolvedValueOnce({ sessions: [refreshedSession] });
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(continuationSession)
      .mockResolvedValueOnce(refreshedSession);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Keep the ready composer stable',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });
    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.selectedSession?.title).toBe(refreshedSession.title);
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });
    expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();
  });

  it('exposes warning confirmation as renderable state and restores it from the safe draft', async () => {
    const warningAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      requiresConfirmation: true,
      confirmationToken: 'server-only-confirmation',
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment.mockResolvedValue(warningAttachment);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(warningAttachment);

    const { result, unmount } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });

    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.contextAttachmentWarningAcknowledged).toBe(false);

    act(() => {
      result.current.acknowledgeContextAttachmentWarning();
    });
    expect(result.current.contextAttachmentWarningAcknowledged).toBe(true);
    unmount();

    const restored = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(restored.result.current.pendingContextAttachment.phase).toBe('ready');
    });
    expect(restored.result.current.contextAttachmentWarningAcknowledged).toBe(true);
  });

  it('loads immutable history and a committed attachment preview by explicit selector', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextHistory.mockResolvedValue({
      snapshots: [
        {
          kind: 'initial',
          contextVersion: 0,
          capturedAt: '2026-07-20T10:00:00.000Z',
          messageCount: 9,
          excludedCount: 2,
        },
      ],
    });
    mocks.getConversationAssistantContextAttachmentPreview.mockResolvedValue({
      items: [],
      nextCursor: 'next-preview-page',
    });
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });

    let history;
    let preview;
    await act(async () => {
      history = await result.current.loadContextHistory();
      preview = await result.current.loadContextSnapshotPreview(
        'committed/attachment',
        'opaque/cursor'
      );
    });

    expect(history).toEqual({ snapshots: [expect.objectContaining({ kind: 'initial' })] });
    expect(preview).toEqual({ items: [], nextCursor: 'next-preview-page' });
    expect(mocks.getConversationAssistantContextHistory).toHaveBeenCalledWith(
      'tok',
      continuationSession.id
    );
    expect(mocks.getConversationAssistantContextAttachmentPreview).toHaveBeenCalledWith(
      'tok',
      continuationSession.id,
      'committed/attachment',
      { cursor: 'opaque/cursor' },
      expect.any(AbortSignal)
    );
  });

  it('keeps attachment preview failures scoped to the viewer instead of the page banner', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachmentPreview.mockRejectedValue(
      new ApiError('SERVICE_UNAVAILABLE', 'Preview unavailable', 503)
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });

    let preview;
    await act(async () => {
      preview = await result.current.loadContextSnapshotPreview('late-preview');
    });

    expect(preview).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('creates, refreshes, retries, and removes attachment drafts without losing the question', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment
      .mockResolvedValueOnce(readyAttachment)
      .mockResolvedValueOnce({ ...readyAttachment, id: 'attachment-2', status: 'preparing' });

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this exact question');
    });

    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.followUpQuestion).toBe('Keep this exact question');
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledWith(
      'tok',
      continuationSession.id,
      { requestId: expect.any(String) },
      expect.any(AbortSignal)
    );

    await act(async () => {
      await result.current.refreshContextAttachment();
    });
    expect(result.current.followUpQuestion).toBe('Keep this exact question');
    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenLastCalledWith(
      'tok',
      continuationSession.id,
      { requestId: expect.any(String), replacesAttachmentId: readyAttachment.id },
      expect.any(AbortSignal)
    );

    await act(async () => {
      await result.current.retryContextAttachment();
    });
    await act(async () => {
      await result.current.removeContextAttachment();
    });
    expect(result.current.followUpQuestion).toBe('Keep this exact question');
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
  });

  it('guards retry attachment against duplicate requests while the first retry is pending', async () => {
    const failedAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      status: 'failed',
      preparationError: {
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      },
    };
    const retry = createDeferred<ConversationAssistantContextAttachment>();
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment.mockResolvedValue(failedAttachment);
    mocks.retryConversationAssistantContextAttachment.mockReturnValue(retry.promise);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('failed');

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.retryContextAttachment();
      duplicate = result.current.retryContextAttachment();
    });
    await waitFor(() => {
      expect(mocks.retryConversationAssistantContextAttachment).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      retry.resolve(readyAttachment);
      await Promise.all([first, duplicate]);
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
  });

  it('guards Remove against duplicate requests while the first removal is pending', async () => {
    const removal = createDeferred<undefined>();
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.removeConversationAssistantContextAttachment.mockReturnValue(removal.promise);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.removeContextAttachment();
      duplicate = result.current.removeContextAttachment();
    });
    await waitFor(() => {
      expect(mocks.removeConversationAssistantContextAttachment).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      removal.resolve(undefined);
      await Promise.all([first, duplicate]);
    });
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
  });

  it('does not let a late attachment response overwrite text typed during preparation', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const preparation = createDeferred<ConversationAssistantContextAttachment>();
    mocks.createConversationAssistantContextAttachment.mockReturnValue(preparation.promise);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Question before click');
    });
    let include!: Promise<void>;
    act(() => {
      include = result.current.includeNewMessages();
    });
    act(() => {
      result.current.setFollowUpQuestion('Question typed while preparing');
    });

    await act(async () => {
      preparation.resolve(readyAttachment);
      await include;
    });

    const raw = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey({
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      })
    );
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      question: 'Question typed while preparing',
      attachmentId: readyAttachment.id,
    });
    expect(result.current.followUpQuestion).toBe('Question typed while preparing');
  });

  it('blocks send and duplicate Include immediately while the create request is in flight', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const preparation = createDeferred<ConversationAssistantContextAttachment>();
    mocks.createConversationAssistantContextAttachment.mockReturnValue(preparation.promise);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Do not send without the update');
    });

    let include!: Promise<void>;
    act(() => {
      include = result.current.includeNewMessages();
    });
    await waitFor(() => {
      expect(result.current.contextAttachmentRequestPhase).toBe('include');
    });

    await act(async () => {
      await result.current.sendFollowUp();
      await result.current.includeNewMessages();
    });
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(1);

    await act(async () => {
      preparation.resolve(readyAttachment);
      await include;
    });
    expect(result.current.contextAttachmentRequestPhase).toBe('idle');
  });

  it('hands an in-flight Include to a fresh request without deleting the shared attachment', async () => {
    const channels = installBroadcastChannelTestDouble();
    const sharedPreparation = createDeferred<ConversationAssistantContextAttachment>();
    const sharedAttachment = { ...readyAttachment, id: 'attachment-shared-by-tab' };
    const freshAttachment = { ...readyAttachment, id: 'attachment-owned-by-this-tab' };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment
      .mockReturnValueOnce(sharedPreparation.promise)
      .mockResolvedValueOnce(freshAttachment);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
      expect(channels).toHaveLength(1);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this question through tab ownership handoff');
    });

    let include!: Promise<void>;
    act(() => {
      include = result.current.includeNewMessages();
    });
    await waitFor(() => {
      expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(1);
      expect(result.current.pendingContextAttachment.phase).toBe('preparing_intent');
    });
    const firstRequest = mocks.createConversationAssistantContextAttachment.mock.calls[0]?.[2] as
      | { requestId: string }
      | undefined;
    const channel = channels[0];
    if (firstRequest === undefined || channel === undefined) {
      throw new Error('Expected the initial preparation and its ownership channel');
    }

    act(() => {
      channel.onmessage?.(
        new MessageEvent('message', { data: { ownerNonce: 'another-tab-owner' } })
      );
    });

    await waitFor(() => {
      expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'ready',
        attachment: { id: freshAttachment.id },
      });
      expect(result.current.contextAttachmentRequestPhase).toBe('idle');
    });
    const secondRequest = mocks.createConversationAssistantContextAttachment.mock.calls[1]?.[2] as
      | { requestId: string }
      | undefined;
    expect(secondRequest?.requestId).not.toBe(firstRequest.requestId);

    await act(async () => {
      sharedPreparation.resolve(sharedAttachment);
      await include;
    });

    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'ready',
      attachment: { id: freshAttachment.id },
    });
    expect(result.current.contextAttachmentRequestPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe(
      'Keep this question through tab ownership handoff'
    );
  });

  it('removes a late server draft after cancelling local preparation without restoring UI on cleanup failure', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.removeConversationAssistantContextAttachment.mockRejectedValue(
      new ApiError('SERVICE_UNAVAILABLE', 'Cleanup failed', 503)
    );
    const preparation = createDeferred<ConversationAssistantContextAttachment>();
    mocks.createConversationAssistantContextAttachment.mockReturnValue(preparation.promise);
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep typing while this is removable');
    });

    let include!: Promise<void>;
    act(() => {
      include = result.current.includeNewMessages();
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'preparing_intent',
        sessionId: continuationSession.id,
      });
    });

    await act(async () => {
      await result.current.removeContextAttachment();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Keep typing while this is removable');
    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();

    await act(async () => {
      preparation.resolve(readyAttachment);
      await include;
    });
    expect(mocks.removeConversationAssistantContextAttachment).toHaveBeenCalledWith(
      'tok',
      continuationSession.id,
      readyAttachment.id
    );
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Keep typing while this is removable');
    expect(result.current.error).toBeNull();
  });

  it('replays the exact Include preparation intent when the accepted response is lost', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    let createCalls = 0;
    mocks.createConversationAssistantContextAttachment.mockImplementation(() => {
      createCalls += 1;
      return createCalls === 1
        ? Promise.reject(new ApiError('TIMEOUT', 'Response was lost', 408))
        : Promise.resolve(readyAttachment);
    });
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this Include intent');
    });

    await act(async () => {
      await result.current.includeNewMessages();
    });

    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
    expect(mocks.createConversationAssistantContextAttachment.mock.calls[1]?.[2]).toEqual(
      mocks.createConversationAssistantContextAttachment.mock.calls[0]?.[2]
    );
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'ready',
      attachment: { id: readyAttachment.id },
    });
  });

  it('replays the exact Refresh preparation intent including its replacement cutoff', async () => {
    const refreshedAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      id: 'attachment-refreshed',
      capturedAt: '2026-07-21T10:15:00.000Z',
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    let createCalls = 0;
    mocks.createConversationAssistantContextAttachment.mockImplementation(() => {
      createCalls += 1;
      if (createCalls === 1) return Promise.resolve(readyAttachment);
      return createCalls === 2
        ? Promise.reject(new ApiError('TIMEOUT', 'Response was lost', 408))
        : Promise.resolve(refreshedAttachment);
    });
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this Refresh intent');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    await act(async () => {
      await result.current.refreshContextAttachment();
    });

    expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(3);
    const lostRequest = mocks.createConversationAssistantContextAttachment.mock.calls[1]?.[2];
    expect(lostRequest).toEqual({
      requestId: expect.any(String),
      replacesAttachmentId: readyAttachment.id,
    });
    expect(mocks.createConversationAssistantContextAttachment.mock.calls[2]?.[2]).toEqual(
      lostRequest
    );
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'ready',
      attachment: { id: refreshedAttachment.id },
    });
  });

  it('restores an unresolved preparation intent by replaying its exact durable request', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Question saved before the 202 response was lost',
        preparationRequestId: 'preparation-lost-202',
        replacesAttachmentId: 'attachment-before-refresh',
        warningAcknowledged: false,
      }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledWith(
        'tok',
        continuationSession.id,
        {
          requestId: 'preparation-lost-202',
          replacesAttachmentId: 'attachment-before-refresh',
        },
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });
    expect(result.current.followUpQuestion).toBe(
      'Question saved before the 202 response was lost'
    );
  });

  it('hands reload restoration to a fresh request without deleting the shared attachment', async () => {
    const channels = installBroadcastChannelTestDouble();
    const sharedPreparation = createDeferred<ConversationAssistantContextAttachment>();
    const sharedAttachment = { ...readyAttachment, id: 'attachment-shared-on-reload' };
    const freshAttachment = { ...readyAttachment, id: 'attachment-owned-after-reload' };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment
      .mockReturnValueOnce(sharedPreparation.promise)
      .mockResolvedValueOnce(freshAttachment);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Keep this reloaded question through ownership handoff',
        preparationRequestId: 'preparation-copied-to-another-tab',
        warningAcknowledged: false,
      }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(1);
      expect(result.current.pendingContextAttachment.phase).toBe('restoring');
      expect(channels).toHaveLength(1);
    });
    const channel = channels[0];
    if (channel === undefined) {
      throw new Error('Expected a draft ownership channel during restoration');
    }

    act(() => {
      channel.onmessage?.(
        new MessageEvent('message', { data: { ownerNonce: 'another-tab-owner' } })
      );
    });

    await waitFor(() => {
      expect(mocks.createConversationAssistantContextAttachment).toHaveBeenCalledTimes(2);
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'ready',
        attachment: { id: freshAttachment.id },
      });
      expect(result.current.contextAttachmentRequestPhase).toBe('idle');
    });
    const firstRequest = mocks.createConversationAssistantContextAttachment.mock.calls[0]?.[2] as
      | { requestId: string }
      | undefined;
    const secondRequest = mocks.createConversationAssistantContextAttachment.mock.calls[1]?.[2] as
      | { requestId: string }
      | undefined;
    expect(firstRequest?.requestId).toBe('preparation-copied-to-another-tab');
    expect(secondRequest?.requestId).not.toBe(firstRequest?.requestId);

    await act(async () => {
      sharedPreparation.resolve(sharedAttachment);
      await Promise.resolve();
    });

    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'ready',
      attachment: { id: freshAttachment.id },
    });
    expect(result.current.contextAttachmentRequestPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe(
      'Keep this reloaded question through ownership handoff'
    );
  });

  it('clears a definitively rejected preparation intent without clearing the question', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment.mockRejectedValue(
      new ApiError('CONFLICT', 'Preparation id conflicts with another body', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Preserve after definitive rejection');
    });

    await act(async () => {
      await result.current.includeNewMessages();
    });

    expect(result.current.pendingContextAttachment.phase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Preserve after definitive rejection');
    const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('preparationRequestId');
  });

  it('does not renew last-edit while replaying a preparation intent after reload', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Reload recovery is metadata, not an edit',
        preparationRequestId: 'preparation-reload-ttl',
        warningAcknowledged: false,
      },
      { nowMs: Date.parse('2026-07-21T10:00:00.000Z') }
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-21T10:20:00.000Z'));

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });

    const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}').savedAt).toBe('2026-07-21T10:00:00.000Z');
  });

  it('refreshes committed context summary while an attached answer is still pending', async () => {
    const committedSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        contextVersion: 1,
        snapshotCount: 2,
        totalAttachedMessageCount: 7,
        totalAttachedOmittedCount: 2,
        completedConversationRevision: 1,
      },
    };
    const summaryRefresh = createDeferred<ConversationAssistantSession>();
    const streamCompletion = createDeferred<undefined>();
    let sessionDetailCall = 0;
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockImplementation(() => {
      sessionDetailCall += 1;
      if (sessionDetailCall === 1) return Promise.resolve(continuationSession);
      if (sessionDetailCall === 2) return summaryRefresh.promise;
      return Promise.resolve(committedSession);
    });
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        streamSessionId: string,
        request: { requestId: string; question: string; contextAttachmentId?: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'context_attached',
          requestId: request.requestId,
          streamSequence: 1,
          attachmentId: request.contextAttachmentId ?? '',
        });
        onEvent({
          type: 'user_turn',
          requestId: request.requestId,
          streamSequence: 2,
          turn: {
            id: 'attached-user-turn',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:05:00.000Z',
            requestId: request.requestId,
          },
        });
        return streamCompletion.promise;
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Use the attached update');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.getConversationAssistantSession).toHaveBeenCalledTimes(2);
      expect(result.current.turnPhase).toBe('waiting');
    });
    expect(result.current.selectedSession?.contextSummary.snapshotCount).toBe(1);

    await act(async () => {
      summaryRefresh.resolve(committedSession);
      await summaryRefresh.promise;
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.contextSummary).toMatchObject({
        contextVersion: 1,
        snapshotCount: 2,
        totalAttachedMessageCount: 7,
        totalAttachedOmittedCount: 2,
      });
    });
    expect(result.current.turnPhase).toBe('waiting');

    await act(async () => {
      streamCompletion.resolve(undefined);
      await sendPromise;
    });
  });

  it('ignores a late committed context-summary refresh after switching analyses', async () => {
    const secondSession: ConversationAssistantSession = {
      ...continuationSession,
      id: 'session-2',
      title: 'Second analysis',
    };
    const lateCommittedSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        contextVersion: 1,
        snapshotCount: 2,
      },
    };
    const lateSummaryRefresh = createDeferred<ConversationAssistantSession>();
    const streamCompletion = createDeferred<undefined>();
    let firstSessionDetailCalls = 0;
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession, secondSession],
    });
    mocks.getConversationAssistantSession.mockImplementation(
      (_token: string, requestedSessionId: string) => {
        if (requestedSessionId === secondSession.id) return Promise.resolve(secondSession);
        firstSessionDetailCalls += 1;
        return firstSessionDetailCalls === 1
          ? Promise.resolve(continuationSession)
          : lateSummaryRefresh.promise;
      }
    );
    mocks.listConversationAssistantTurns.mockImplementation(
      (_token: string, requestedSessionId: string) =>
        Promise.resolve({ turns: requestedSessionId === secondSession.id ? [] : turns })
    );
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        request: { requestId: string; question: string; contextAttachmentId?: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'context_attached',
          requestId: request.requestId,
          streamSequence: 1,
          attachmentId: request.contextAttachmentId ?? '',
        });
        onEvent({
          type: 'user_turn',
          requestId: request.requestId,
          streamSequence: 2,
          turn: {
            id: 'attached-user-before-navigation',
            sessionId: continuationSession.id,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:05:00.000Z',
            requestId: request.requestId,
          },
        });
        return streamCompletion.promise;
      }
    );
    const { result } = renderHook(() => useAssistantWithLocationControls(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Attach before navigating');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(firstSessionDetailCalls).toBe(2);
    });

    act(() => {
      result.current.navigateToSession(secondSession.id);
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(secondSession.id);
    });
    await act(async () => {
      lateSummaryRefresh.resolve(lateCommittedSession);
      await lateSummaryRefresh.promise;
    });
    expect(result.current.selectedSession).toEqual(secondSession);

    await act(async () => {
      streamCompletion.resolve(undefined);
      await sendPromise;
    });
  });

  it('uses one durable request for the question and attachment and clears only on user_turn', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    const committedSession: ConversationAssistantSession = {
      ...continuationSession,
      attachmentCount: 1,
      totalAttachedMessageCount: readyAttachment.counts.included,
      totalAttachedOmittedCount: readyAttachment.counts.excluded,
      completedConversationRevision: 1,
    };
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(continuationSession)
      .mockResolvedValue(committedSession);
    let streamHandler: ((event: ConversationAssistantStreamEvent) => void) | undefined;
    const streamFinished = createDeferred<undefined>();
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        _request: unknown,
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        streamHandler = onEvent;
        return streamFinished.promise;
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Question with immutable update');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });

    let send!: Promise<void>;
    act(() => {
      send = result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(1);
    });
    const request = mocks.streamConversationAssistantTurn.mock.calls[0]?.[2] as {
      requestId: string;
      question: string;
      contextAttachmentId: string;
    };
    expect(request).toEqual({
      requestId: expect.any(String),
      question: 'Question with immutable update',
      contextAttachmentId: readyAttachment.id,
    });
    const storageKey = getConversationAssistantDraftStorageKey({
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    });
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();

    act(() => {
      streamHandler?.({
        type: 'user_turn',
        requestId: request.requestId,
        streamSequence: 1,
        turn: {
          id: 'persisted-user-turn',
          sessionId: continuationSession.id,
          userId: 'user-1',
          role: 'user',
          text: request.question,
          createdAt: '2026-07-21T10:01:00.000Z',
        },
      });
    });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(result.current.followUpQuestion).toBe('');
    expect(result.current.pendingContextAttachment.phase).toBe('idle');

    await act(async () => {
      streamHandler?.({
        type: 'assistant_turn',
        requestId: request.requestId,
        streamSequence: 2,
        turn: {
          id: 'persisted-assistant-turn',
          sessionId: continuationSession.id,
          userId: 'user-1',
          role: 'assistant',
          text: 'Answer',
          createdAt: '2026-07-21T10:02:00.000Z',
        },
      });
      streamHandler?.({ type: 'done', requestId: request.requestId, streamSequence: 3 });
      streamFinished.resolve(undefined);
      await send;
    });
    expect(result.current.selectedSession).toEqual(committedSession);
  });

  it('waits for definitive replay rejection before retrying an unacknowledged send with a fresh id', async () => {
    mocks.streamConversationAssistantTurn
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(undefined);
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Session or attachment not found', 404)
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Retry exactly this question');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
    await act(async () => {
      await result.current.sendFollowUp();
    });

    const firstRequest = mocks.streamConversationAssistantTurn.mock.calls[0]?.[2];
    const secondRequest = mocks.streamConversationAssistantTurn.mock.calls[1]?.[2];
    expect(firstRequest).toEqual({
      requestId: expect.any(String),
      question: 'Retry exactly this question',
    });
    expect(secondRequest).toEqual({
      requestId: expect.any(String),
      question: 'Retry exactly this question',
    });
    expect((secondRequest as { requestId: string }).requestId).not.toBe(
      (firstRequest as { requestId: string }).requestId
    );
    expect(result.current.followUpQuestion).toBe('Retry exactly this question');
  });

  it('releases a direct request-body conflict without merging or clearing the local attachment draft', async () => {
    let streamCall = 0;
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        streamSessionId: string,
        request: { requestId: string; question: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        streamCall += 1;
        if (streamCall === 1) {
          onEvent({
            type: 'error',
            requestId: request.requestId,
            streamSequence: 1,
            error: {
              code: 'REQUEST_BODY_CONFLICT',
              message: 'This identifier belongs to another request body.',
            },
          });
          onEvent({ type: 'done', requestId: request.requestId, streamSequence: 2 });
          return Promise.resolve();
        }
        onEvent({
          type: 'user_turn',
          requestId: request.requestId,
          streamSequence: 1,
          turn: {
            id: 'conscious-retry-user-turn',
            sessionId: streamSessionId,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:11:00.000Z',
            requestId: request.requestId,
          },
        });
        onEvent({ type: 'done', requestId: request.requestId, streamSequence: 2 });
        return Promise.resolve();
      }
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this local body and attachment');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.turnPhase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Keep this local body and attachment');
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    expect(result.current.error).toBe(
      'This message conflicted with another saved request. Your draft was kept. Try again.'
    );
    expect(mocks.getConversationAssistantTurnRequest).not.toHaveBeenCalled();
    expect(mocks.sendConversationAssistantTurn).not.toHaveBeenCalled();
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledOnce();
    const firstRequest = mocks.streamConversationAssistantTurn.mock.calls[0]?.[2] as {
      requestId: string;
    };
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    );
    expect(stored).toMatchObject({
      question: 'Keep this local body and attachment',
      attachmentId: readyAttachment.id,
    });
    expect(stored).not.toHaveProperty('startedTurnRequestId');

    await act(async () => {
      await result.current.sendFollowUp();
    });
    const retryRequest = mocks.streamConversationAssistantTurn.mock.calls[1]?.[2] as {
      requestId: string;
    };
    expect(retryRequest.requestId).not.toBe(firstRequest.requestId);
  });

  it('stops exact replay on a request-body conflict without consuming the local draft', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new Error('Initial transport disconnected')
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('REQUEST_BODY_CONFLICT', 'Identifier belongs to another body', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Preserve this body through exact conflict');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledOnce();
      expect(result.current.turnPhase).toBe('idle');
    });

    expect(result.current.followUpQuestion).toBe(
      'Preserve this body through exact conflict'
    );
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    expect(result.current.error).toBe(
      'This message conflicted with another saved request. Your draft was kept. Try again.'
    );
    expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledOnce();
    expect(mocks.listConversationAssistantTurns).toHaveBeenCalledOnce();
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    );
    expect(stored).toMatchObject({
      question: 'Preserve this body through exact conflict',
      attachmentId: readyAttachment.id,
    });
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('blocks the attachment after a pre-commit context-window rejection without retrying it', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new ApiError(
        'CONTEXT_WINDOW_EXCEEDED',
        'This update is too large to include in one question.',
        400
      )
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this question after the rejection');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment).toMatchObject({
        phase: 'failed',
        attachment: { id: readyAttachment.id },
        failure: { code: 'CONTEXT_WINDOW_EXCEEDED', blocking: true },
      });
    });

    await act(async () => {
      await result.current.sendFollowUp();
      await result.current.retryContextAttachment();
    });
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledTimes(1);
    expect(mocks.retryConversationAssistantContextAttachment).not.toHaveBeenCalled();
    const raw = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey({
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      })
    );
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      question: 'Keep this question after the rejection',
      attachmentId: readyAttachment.id,
    });
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('startedTurnRequestId');
  });

  it('maps a pre-commit context-window SSE error to the same blocking recovery', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        request: { requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'error',
          requestId: request.requestId,
          streamSequence: 1,
          error: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: 'This update is too large to include in one question.',
          },
        });
        onEvent({ type: 'done', requestId: request.requestId, streamSequence: 2 });
        return Promise.resolve();
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Preserve this SSE-rejected question');
    });

    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    await act(async () => {
      await result.current.sendFollowUp();
    });

    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'failed',
      failure: { code: 'CONTEXT_WINDOW_EXCEEDED', blocking: true },
    });
    expect(result.current.followUpQuestion).toBe('Preserve this SSE-rejected question');
  });

  it('stops a plain pre-commit context-window SSE rejection without replaying it', async () => {
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        request: { requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        onEvent({
          type: 'error',
          requestId: request.requestId,
          streamSequence: 1,
          error: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: 'The full prompt exceeds the model context window.',
          },
        });
        onEvent({ type: 'done', requestId: request.requestId, streamSequence: 2 });
        return Promise.resolve();
      }
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('CONTEXT_WINDOW_EXCEEDED', 'Prompt too large', 400)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: session.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('A very large plain question');
    });

    await act(async () => {
      await result.current.sendFollowUp();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 650));
    });

    expect.soft(result.current.turnPhase).toBe('idle');
    expect.soft(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(0);
    expect.soft(result.current.followUpQuestion).toBe('A very large plain question');
    expect.soft(result.current.error).toBe(
      'The selected conversation context does not fit this model. Create a smaller analysis with a shorter date range. Your draft was kept.'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect.soft(stored).not.toHaveProperty('startedTurnRequestId');
    act(() => {
      result.current.setFollowUpQuestion('A shorter plain question');
    });
    expect(result.current.followUpQuestion).toBe('A shorter plain question');
  });

  it('blocks an attachment when exact replay rejects it for the context window', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new Error('Initial transport disconnected')
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('CONTEXT_WINDOW_EXCEEDED', 'Prompt too large', 400)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this oversized attachment question');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(1);
      expect(result.current.turnPhase).toBe('idle');
    });

    expect.soft(result.current.pendingContextAttachment).toMatchObject({
      phase: 'failed',
      attachment: { id: readyAttachment.id },
      failure: { code: 'CONTEXT_WINDOW_EXCEEDED', blocking: true },
    });
    expect.soft(result.current.followUpQuestion).toBe(
      'Keep this oversized attachment question'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('does not renew the last-edit TTL while restoring attachment status', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Restore without retaining me forever',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { nowMs: Date.parse('2026-07-21T10:00:00.000Z') }
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-21T10:20:00.000Z'));

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('ready');
    });

    const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      savedAt: '2026-07-21T10:00:00.000Z',
      expiresAt: '2026-07-21T11:05:00.000Z',
    });
  });

  it('does not renew the last-edit TTL during background attachment polling', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-21T10:00:00.000Z'));
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    let pollStatus: (() => void) | undefined;
    const intervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((handler: TimerHandler): number => {
        if (typeof handler === 'function') pollStatus = handler;
        return 1;
      });
    act(() => {
      result.current.setFollowUpQuestion('Polling must not extend this draft');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(pollStatus).toBeTypeOf('function');

    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-07-21T10:20:00.000Z'));
    act(() => {
      pollStatus?.();
    });
    intervalSpy.mockRestore();
    await waitFor(() => {
      expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();
    });

    const raw = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey({
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      })
    );
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      savedAt: '2026-07-21T10:00:00.000Z',
      expiresAt: '2026-07-21T11:05:00.000Z',
    });
  });

  it('keeps an attachment owned by the pending send ready when polling observes its commit', async () => {
    const committedAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      status: 'committed',
      committedAt: '2026-07-21T10:10:00.000Z',
    };
    const streamCompletion = createDeferred<undefined>();
    let streamHandler: ((event: ConversationAssistantStreamEvent) => void) | undefined;
    let attachmentPoll: (() => void) | undefined;
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(committedAttachment);
    mocks.streamConversationAssistantTurn.mockImplementation(
      (
        _token: string,
        _sessionId: string,
        _request: unknown,
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        streamHandler = onEvent;
        return streamCompletion.promise;
      }
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    const intervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((handler: TimerHandler, timeout?: number): number => {
        if (timeout === 5000 && typeof handler === 'function') attachmentPoll = handler;
        return 1;
      });
    act(() => {
      result.current.setFollowUpQuestion('Keep my attachment while this send commits');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expect(attachmentPoll).toBeTypeOf('function');

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendFollowUp();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledOnce();
    const request = mocks.streamConversationAssistantTurn.mock.calls[0]?.[2] as {
      requestId: string;
      question: string;
      contextAttachmentId: string;
    };
    act(() => {
      attachmentPoll?.();
    });
    intervalSpy.mockRestore();
    await waitFor(() => {
      expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();
    });

    expect(result.current.pendingContextAttachment.phase).toBe('ready');
    expect(result.current.turnPhase).toBe('submitting');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    );
    expect(stored).toMatchObject({
      attachmentId: readyAttachment.id,
      startedTurnRequestId: request.requestId,
    });

    await act(async () => {
      streamHandler?.({
        type: 'user_turn',
        requestId: request.requestId,
        streamSequence: 1,
        turn: {
          id: 'pending-send-user-turn',
          sessionId: continuationSession.id,
          userId: 'user-1',
          role: 'user',
          text: request.question,
          createdAt: '2026-07-21T10:10:00.000Z',
          requestId: request.requestId,
        },
      });
      streamHandler?.({ type: 'done', requestId: request.requestId, streamSequence: 2 });
      streamCompletion.resolve(undefined);
      await sendPromise;
    });
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
  });

  it('renews last-edit only when the question text actually changes', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const now = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-21T10:00:00.000Z')
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Exact draft text');
    });

    now.mockReturnValue(Date.parse('2026-07-21T10:10:00.000Z'));
    act(() => {
      result.current.setFollowUpQuestion('Exact draft text');
    });
    let raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}').savedAt).toBe('2026-07-21T10:00:00.000Z');

    now.mockReturnValue(Date.parse('2026-07-21T10:20:00.000Z'));
    act(() => {
      result.current.setFollowUpQuestion('Actually edited draft text');
    });
    raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}').savedAt).toBe('2026-07-21T10:20:00.000Z');
  });

  it('preserves last-edit across Include, Refresh, and Remove attachment metadata changes', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    const refreshedAttachment = { ...readyAttachment, id: 'attachment-refreshed-for-ttl' };
    mocks.createConversationAssistantContextAttachment
      .mockResolvedValueOnce(readyAttachment)
      .mockResolvedValueOnce(refreshedAttachment);
    const now = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-21T10:00:00.000Z')
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Do not roll this timestamp');
    });
    const expectOriginalLastEdit = (): void => {
      const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
      expect(JSON.parse(raw ?? '{}').savedAt).toBe('2026-07-21T10:00:00.000Z');
    };

    now.mockReturnValue(Date.parse('2026-07-21T10:05:00.000Z'));
    await act(async () => {
      await result.current.includeNewMessages();
    });
    expectOriginalLastEdit();

    now.mockReturnValue(Date.parse('2026-07-21T10:10:00.000Z'));
    await act(async () => {
      await result.current.refreshContextAttachment();
    });
    expectOriginalLastEdit();

    now.mockReturnValue(Date.parse('2026-07-21T10:15:00.000Z'));
    await act(async () => {
      await result.current.removeContextAttachment();
    });
    expectOriginalLastEdit();
  });

  it('preserves last-edit when acknowledging the snapshot warning', async () => {
    const warningAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      requiresConfirmation: true,
      confirmationToken: 'warning-token',
    };
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.createConversationAssistantContextAttachment.mockResolvedValue(warningAttachment);
    const now = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-21T10:00:00.000Z')
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(continuationSession.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Warning acknowledgment is not an edit');
    });
    await act(async () => {
      await result.current.includeNewMessages();
    });
    now.mockReturnValue(Date.parse('2026-07-21T10:10:00.000Z'));
    act(() => {
      result.current.acknowledgeContextAttachmentWarning();
    });

    const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      savedAt: '2026-07-21T10:00:00.000Z',
      warningAcknowledged: true,
    });
  });

  it('preserves last-edit when persisting the durable request before Send', async () => {
    const stream = createDeferred<undefined>();
    mocks.streamConversationAssistantTurn.mockReturnValue(stream.promise);
    const now = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-21T10:00:00.000Z')
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: session.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Sending is not a text edit');
    });
    now.mockReturnValue(Date.parse('2026-07-21T10:10:00.000Z'));
    act(() => {
      void result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledOnce();
    });

    const raw = window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity));
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      savedAt: '2026-07-21T10:00:00.000Z',
      startedTurnRequestId: expect.any(String),
    });

    await act(async () => {
      stream.resolve(undefined);
      await stream.promise;
    });
  });

  it('keeps an own committed attachment restoring while its durable request is active', async () => {
    const activeRequestId = 'own-committed-turn-request';
    const resumeRequest = createDeferred<ConversationAssistantTurnRequestResponse>();
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue({
      ...readyAttachment,
      status: 'committed',
      committedAt: '2026-07-21T10:10:00.000Z',
    });
    mocks.getConversationAssistantTurnRequest.mockResolvedValue({
      request: {
        id: activeRequestId,
        sessionId: continuationSession.id,
        status: 'in_progress',
        attempt: 1,
        stateVersion: 1,
        conversationRevision: 1,
      },
      turns: [],
      canRetryAnswer: false,
    });
    mocks.resumeConversationAssistantTurnRequest.mockReturnValue(resumeRequest.promise);
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Recover the question committed by this request',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: activeRequestId,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(mocks.getConversationAssistantContextAttachment).toHaveBeenCalledOnce();
      expect(mocks.resumeConversationAssistantTurnRequest).toHaveBeenCalledOnce();
    });
    expect(result.current.pendingContextAttachment).toMatchObject({
      phase: 'restoring',
      attachmentId: readyAttachment.id,
    });
    expect(result.current.turnPhase).toBe('restoring');
    expect(result.current.followUpQuestion).toBe(
      'Recover the question committed by this request'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    );
    expect(stored).toMatchObject({
      attachmentId: readyAttachment.id,
      startedTurnRequestId: activeRequestId,
    });
  });

  it('hands TURN_IN_PROGRESS recovery to the authoritative active request without consuming the local draft', async () => {
    const localRequestId = 'blocked-local-turn-request';
    const authoritativeRequestId = 'authoritative-active-turn-request';
    const activeSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        activeTurn: { requestId: authoritativeRequestId, stateVersion: 2 },
      },
    };
    const completedSession: ConversationAssistantSession = {
      ...activeSession,
      contextSummary: {
        ...activeSession.contextSummary,
        contextVersion: activeSession.contextSummary.contextVersion + 1,
        activeTurn: null,
      },
    };
    const authoritativeUserTurn: ConversationAssistantTurn = {
      id: 'authoritative-user-turn',
      sessionId: continuationSession.id,
      userId: 'other-runtime-user',
      role: 'user',
      text: 'Question already running elsewhere',
      createdAt: '2026-07-21T10:02:00.000Z',
      requestId: authoritativeRequestId,
      sequence: 3,
    };
    const authoritativeAssistantTurn: ConversationAssistantTurn = {
      id: 'authoritative-assistant-turn',
      sessionId: continuationSession.id,
      userId: 'other-runtime-user',
      role: 'assistant',
      text: 'The other answer completed.',
      createdAt: '2026-07-21T10:03:00.000Z',
      requestId: authoritativeRequestId,
      sequence: 4,
    };
    const staleAttachment = { ...readyAttachment, compatibility: 'stale' as const };
    let attachmentStatusCall = 0;
    mocks.getConversationAssistantContextAttachment.mockImplementation(() =>
      Promise.resolve(attachmentStatusCall++ === 0 ? readyAttachment : staleAttachment)
    );
    let sessionDetailCall = 0;
    mocks.getConversationAssistantSession.mockImplementation(() => {
      sessionDetailCall += 1;
      if (sessionDetailCall === 1) return Promise.resolve(continuationSession);
      if (sessionDetailCall === 2) return Promise.resolve(activeSession);
      return Promise.resolve(completedSession);
    });
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.listConversationAssistantTurns.mockResolvedValue({
      turns: [...turns, authoritativeUserTurn, authoritativeAssistantTurn],
    });
    mocks.getConversationAssistantTurnRequest.mockImplementation(
      (_token: string, _sessionId: string, requestId: string) => {
        if (requestId === localRequestId) {
          return Promise.reject(new ApiError('NOT_FOUND', 'Turn request not found', 404));
        }
        return Promise.resolve({
          request: {
            id: authoritativeRequestId,
            sessionId: continuationSession.id,
            status: 'in_progress' as const,
            attempt: 1,
            stateVersion: 2,
            conversationRevision: 1,
          },
          turns: [authoritativeUserTurn],
          canRetryAnswer: false,
        });
      }
    );
    mocks.resumeConversationAssistantTurnRequest.mockResolvedValue({
      request: {
        id: authoritativeRequestId,
        sessionId: continuationSession.id,
        status: 'completed',
        attempt: 2,
        stateVersion: 3,
        conversationRevision: 1,
        completedAt: '2026-07-21T10:03:00.000Z',
      },
      turns: [authoritativeUserTurn, authoritativeAssistantTurn],
      canRetryAnswer: false,
    });
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('TURN_IN_PROGRESS', 'Another turn is already in progress', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Keep my blocked local attachment question',
        attachmentId: readyAttachment.id,
        startedTurnRequestId: localRequestId,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(
      () => {
        expect(result.current.turnPhase).toBe('idle');
        expect(mocks.resumeConversationAssistantTurnRequest).toHaveBeenCalledWith(
          'tok',
          continuationSession.id,
          authoritativeRequestId,
          expect.any(AbortSignal)
        );
        expect(result.current.pendingContextAttachment.phase).toBe('stale');
      },
      { timeout: 3000 }
    );
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(1);
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(result.current.followUpQuestion).toBe(
      'Keep my blocked local attachment question'
    );
    expect(result.current.turns).toEqual(
      expect.arrayContaining([authoritativeUserTurn, authoritativeAssistantTurn])
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      question: 'Keep my blocked local attachment question',
      attachmentId: readyAttachment.id,
    });
    expect(stored).not.toHaveProperty('startedTurnRequestId');
  });

  it('releases a TURN_IN_PROGRESS local request when fresh session state has no active turn', async () => {
    const completedRaceSession: ConversationAssistantSession = {
      ...session,
      contextSummary: { ...session.contextSummary, activeTurn: null },
    };
    let sessionDetailCall = 0;
    mocks.getConversationAssistantSession.mockImplementation(() => {
      sessionDetailCall += 1;
      return Promise.resolve(sessionDetailCall === 1 ? session : completedRaceSession);
    });
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new Error('Initial transport disconnected')
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Local request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('TURN_IN_PROGRESS', 'Another turn was in progress', 409)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: session.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Keep this local draft after the race');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(1);
      expect(result.current.turnPhase).toBe('idle');
    });

    expect.soft(result.current.followUpQuestion).toBe(
      'Keep this local draft after the race'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect.soft(stored).not.toHaveProperty('startedTurnRequestId');
    act(() => {
      result.current.setFollowUpQuestion('Retry consciously after refresh');
    });
    expect(result.current.followUpQuestion).toBe('Retry consciously after refresh');
  });

  it('locally dismisses a committed cloned-tab attachment and keeps the next send plain', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({ sessions: [continuationSession] });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue({
      ...readyAttachment,
      status: 'committed',
      committedAt: '2026-07-21T10:10:00.000Z',
    });
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question: 'Draft cloned before the other tab committed',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      },
      { attachmentExpiresAt: readyAttachment.expiresAt }
    );
    const clonedRecord = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey(identity)
    );
    expect(clonedRecord).not.toBeNull();
    window.sessionStorage.setItem(
      getConversationAssistantDraftStorageKey(identity),
      clonedRecord ?? ''
    );

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('consumed_elsewhere');
    });
    expect(result.current.followUpQuestion).toBe('Draft cloned before the other tab committed');
    await act(async () => {
      await result.current.removeContextAttachment();
    });
    expect(mocks.removeConversationAssistantContextAttachment).not.toHaveBeenCalled();
    expect(result.current.pendingContextAttachment.phase).toBe('idle');
    expect(result.current.followUpQuestion).toBe('Draft cloned before the other tab committed');
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('attachmentId');
    expect(stored).not.toHaveProperty('startedTurnRequestId');

    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn.mock.calls.at(-1)?.[2]).toMatchObject({
      question: 'Draft cloned before the other tab committed',
    });
    expect(mocks.streamConversationAssistantTurn.mock.calls.at(-1)?.[2]).not.toHaveProperty(
      'contextAttachmentId'
    );
  });

  it('merges an answer-only retry for an old failed pair without replacing later history', async () => {
    const threePairs: ConversationAssistantTurn[] = [
      {
        id: 'pair-1-user',
        sessionId: session.id,
        userId: 'user-1',
        role: 'user',
        text: 'First question',
        createdAt: '2026-07-21T09:00:00.000Z',
        sequence: 1,
        requestId: 'request-old-failed',
      },
      {
        id: 'pair-1-assistant',
        sessionId: session.id,
        userId: 'user-1',
        role: 'assistant',
        text: '',
        createdAt: '2026-07-21T09:01:00.000Z',
        sequence: 2,
        requestId: 'request-old-failed',
        error: { code: 'LLM_ERROR', message: 'Old answer failed' },
      },
      {
        id: 'pair-2-user',
        sessionId: session.id,
        userId: 'user-1',
        role: 'user',
        text: 'Second question',
        createdAt: '2026-07-21T09:02:00.000Z',
        sequence: 3,
        requestId: 'request-second',
      },
      {
        id: 'pair-2-assistant',
        sessionId: session.id,
        userId: 'user-1',
        role: 'assistant',
        text: 'Second answer',
        createdAt: '2026-07-21T09:03:00.000Z',
        sequence: 4,
        requestId: 'request-second',
      },
      {
        id: 'pair-3-user',
        sessionId: session.id,
        userId: 'user-1',
        role: 'user',
        text: 'Third question',
        createdAt: '2026-07-21T09:04:00.000Z',
        sequence: 5,
        requestId: 'request-third',
      },
      {
        id: 'pair-3-assistant',
        sessionId: session.id,
        userId: 'user-1',
        role: 'assistant',
        text: 'Third answer',
        createdAt: '2026-07-21T09:05:00.000Z',
        sequence: 6,
        requestId: 'request-third',
      },
    ];
    const [firstQuestion, failedAnswer] = threePairs;
    if (firstQuestion === undefined || failedAnswer === undefined) {
      throw new Error('Expected the first turn pair fixture');
    }
    const retriedAnswer: ConversationAssistantTurn = {
      ...failedAnswer,
      text: 'Recovered first answer',
      error: undefined,
    };
    mocks.listConversationAssistantTurns.mockResolvedValue({ turns: threePairs });
    mocks.retryConversationAssistantTurnAnswer.mockResolvedValue({
      request: {
        id: 'request-old-failed',
        sessionId: session.id,
        status: 'completed',
        attempt: 2,
        stateVersion: 3,
        conversationRevision: 1,
      },
      turns: [firstQuestion, retriedAnswer],
      canRetryAnswer: false,
    });
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.turns).toHaveLength(6);
    });

    await act(async () => {
      await result.current.retryTurnAnswer('request-old-failed');
    });

    expect(result.current.turns).toHaveLength(6);
    expect(result.current.turns.map((turn) => turn.id)).toEqual(
      threePairs.map((turn) => turn.id)
    );
    expect(result.current.turns[1]).toMatchObject({
      id: 'pair-1-assistant',
      text: 'Recovered first answer',
    });
    expect(result.current.turns[1]?.error).toBeUndefined();
  });

  it('recovers an active durable request after reload without replacing earlier history', async () => {
    const activeRequestId = 'request-active-after-reload';
    const activeUserTurn: ConversationAssistantTurn = {
      id: 'turn-active-user',
      sessionId: continuationSession.id,
      userId: 'user-1',
      role: 'user',
      text: 'Question acknowledged before reload',
      createdAt: '2026-07-21T10:01:00.000Z',
      sequence: 3,
      requestId: activeRequestId,
    };
    const activeAssistantTurn: ConversationAssistantTurn = {
      id: 'turn-active-assistant',
      sessionId: continuationSession.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Answer completed after reload',
      createdAt: '2026-07-21T10:02:00.000Z',
      sequence: 4,
      requestId: activeRequestId,
    };
    const activeSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        activeTurn: { requestId: activeRequestId, stateVersion: 1 },
      },
    };
    const completedSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        activeTurn: null,
        snapshotCount: 2,
        completedConversationRevision: 1,
      },
    };
    const requestStatus = createDeferred<ConversationAssistantTurnRequestResponse>();
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce(completedSession);
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns: [...turns, activeUserTurn] })
      .mockResolvedValueOnce({ turns: [...turns, activeUserTurn, activeAssistantTurn] });
    mocks.getConversationAssistantTurnRequest.mockReturnValue(requestStatus.promise);

    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          sessionId: continuationSession.id,
          loadChats: false,
          loadSessions: false,
        }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${continuationSession.id}`) }
    );

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('waiting');
      expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledWith(
        'tok',
        continuationSession.id,
        activeRequestId,
        expect.any(AbortSignal)
      );
    });

    await act(async () => {
      requestStatus.resolve({
        request: {
          id: activeRequestId,
          sessionId: continuationSession.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 2,
          conversationRevision: 1,
          completedAt: '2026-07-21T10:02:00.000Z',
        },
        turns: [activeUserTurn, activeAssistantTurn],
        canRetryAnswer: false,
      });
    });

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.selectedSession).toEqual(completedSession);
    });
    expect(result.current.turns.map((turn) => turn.id)).toEqual([
      'turn-user',
      'turn-assistant',
      activeUserTurn.id,
      activeAssistantTurn.id,
    ]);
  });

  it('asks the backend to resume an in-progress durable request after reload', async () => {
    const requestId = 'request-expired-after-reload';
    const userTurn: ConversationAssistantTurn = {
      id: 'turn-expired-user',
      sessionId: continuationSession.id,
      userId: 'user-1',
      role: 'user',
      text: 'Finish this after the worker disappeared',
      createdAt: '2026-07-21T10:01:00.000Z',
      sequence: 3,
      requestId,
    };
    const assistantTurn: ConversationAssistantTurn = {
      id: 'turn-expired-assistant',
      sessionId: continuationSession.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Recovered exactly once.',
      createdAt: '2026-07-21T10:07:00.000Z',
      sequence: 4,
      requestId,
    };
    const activeSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        activeTurn: { requestId, stateVersion: 1 },
      },
    };
    const completedSession: ConversationAssistantSession = {
      ...continuationSession,
      contextSummary: {
        ...continuationSession.contextSummary,
        activeTurn: null,
        completedConversationRevision: 1,
      },
    };
    mocks.getConversationAssistantSession
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce(completedSession);
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns: [...turns, userTurn] })
      .mockResolvedValueOnce({ turns: [...turns, userTurn, assistantTurn] });
    mocks.getConversationAssistantTurnRequest.mockResolvedValue({
      request: {
        id: requestId,
        sessionId: continuationSession.id,
        status: 'in_progress',
        attempt: 1,
        stateVersion: 1,
        conversationRevision: 1,
      },
      turns: [userTurn],
      canRetryAnswer: false,
    });
    mocks.resumeConversationAssistantTurnRequest.mockResolvedValue({
      request: {
        id: requestId,
        sessionId: continuationSession.id,
        status: 'completed',
        attempt: 2,
        stateVersion: 3,
        conversationRevision: 1,
        completedAt: '2026-07-21T10:07:00.000Z',
      },
      turns: [userTurn, assistantTurn],
      canRetryAnswer: false,
    });

    const { result } = renderHook(
      () =>
        useWhatsAppConversationAssistant({
          sessionId: continuationSession.id,
          loadChats: false,
          loadSessions: false,
        }),
      { wrapper: createWrapper(`/whatsapp/conversation-assistant/${continuationSession.id}`) }
    );

    await waitFor(() => {
      expect(mocks.resumeConversationAssistantTurnRequest).toHaveBeenCalledWith(
        'tok',
        continuationSession.id,
        requestId,
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.turns.map((turn) => turn.id)).toContain(assistantTurn.id);
    });
  });

  it('enters a dedicated turn-restoring phase for a stored request without an attachment', async () => {
    const requestStatus = createDeferred<ConversationAssistantTurnRequestResponse>();
    mocks.getConversationAssistantTurnRequest.mockReturnValue(requestStatus.promise);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: session.id,
      },
      {
        question: 'Plain question whose send outcome is unknown',
        startedTurnRequestId: 'plain-turn-request',
        warningAcknowledged: false,
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(result.current.turnPhase).toBe('restoring');
    });
    act(() => {
      result.current.setFollowUpQuestion('Edited body must not reuse the started id');
    });
    expect(result.current.followUpQuestion).toBe('Plain question whose send outcome is unknown');
    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn).not.toHaveBeenCalled();
    expect(result.current.followUpQuestion).toBe('Plain question whose send outcome is unknown');

    await act(async () => {
      requestStatus.resolve({
        request: {
          id: 'plain-turn-request',
          sessionId: session.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 2,
          conversationRevision: 1,
          completedAt: '2026-07-21T10:02:00.000Z',
        },
        turns: [],
        canRetryAnswer: false,
      });
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
  });

  it('keeps polling a durable turn after transient status errors until a terminal response', async () => {
    const recoveredUser: ConversationAssistantTurn = {
      id: 'turn-recovered-late-user',
      sessionId: session.id,
      userId: 'user-1',
      role: 'user',
      text: 'Recover me past a transient status failure',
      createdAt: '2026-07-21T10:01:00.000Z',
      sequence: 3,
      requestId: 'turn-transient-get',
    };
    const recoveredAssistant: ConversationAssistantTurn = {
      id: 'turn-recovered-late-assistant',
      sessionId: session.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Recovered after polling.',
      createdAt: '2026-07-21T10:02:00.000Z',
      sequence: 4,
      requestId: 'turn-transient-get',
    };
    mocks.getConversationAssistantTurnRequest
      .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', 'Try later', 503))
      .mockResolvedValueOnce({
        request: {
          id: 'turn-transient-get',
          sessionId: session.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 3,
          conversationRevision: 1,
          completedAt: '2026-07-21T10:02:00.000Z',
        },
        turns: [recoveredUser, recoveredAssistant],
        canRetryAnswer: false,
      });
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockResolvedValue({ turns: [...turns, recoveredUser, recoveredAssistant] });
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: session.id,
      },
      {
        question: recoveredUser.text,
        startedTurnRequestId: 'turn-transient-get',
        warningAcknowledged: false,
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(
      () => {
        expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 }
    );
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.turns.map((turn) => turn.id)).toContain(recoveredAssistant.id);
    });
  });

  it('replays the exact durable body after a recovery 404 and merges one late committed pair', async () => {
    const replay = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    const question = 'Was this accepted before the stream disconnected?';
    let replayedPair: ConversationAssistantTurn[] = [];
    let persistedTurns = turns;
    mocks.listConversationAssistantTurns.mockImplementation(async () => ({
      turns: persistedTurns,
    }));
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new Error('SSE disconnected before the commit event')
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not visible yet', 404)
    );
    mocks.sendConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: { requestId: string; question: string }
      ) => {
        replayedPair = [
          {
            id: 'late-commit-user',
            sessionId: session.id,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:01:00.000Z',
            sequence: 3,
            requestId: request.requestId,
          },
          {
            id: 'late-commit-assistant',
            sessionId: session.id,
            userId: 'user-1',
            role: 'assistant',
            text: 'The original request committed once.',
            createdAt: '2026-07-21T10:02:00.000Z',
            sequence: 4,
            requestId: request.requestId,
          },
        ];
        persistedTurns = [...turns, ...replayedPair];
        return await replay.promise;
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion(question);
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledOnce();
    });
    const streamedBody = mocks.streamConversationAssistantTurn.mock.calls[0]?.[2];
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledWith(
      'tok',
      session.id,
      streamedBody,
      expect.any(AbortSignal)
    );
    expect(result.current.turnPhase).toBe('restoring');
    act(() => {
      result.current.setFollowUpQuestion('Do not replace the accepted body');
      void result.current.sendFollowUp();
    });
    expect(result.current.followUpQuestion).toBe(question);
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledOnce();

    await act(async () => {
      replay.resolve({ turns: replayedPair });
      await replay.promise;
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
    });
    const durableRequestId = (streamedBody as { requestId: string }).requestId;
    expect(result.current.turns.filter((turn) => turn.requestId === durableRequestId)).toEqual(
      replayedPair
    );
    expect(mocks.sendConversationAssistantTurn.mock.calls[0]?.[2]).toMatchObject({
      requestId: durableRequestId,
      question,
    });
  });

  it('rehydrates an attachment confirmation only in memory before exact replay after reload', async () => {
    const replay = createDeferred<{ turns: ConversationAssistantTurn[] }>();
    const warningAttachment: ConversationAssistantContextAttachment = {
      ...readyAttachment,
      requiresConfirmation: true,
      confirmationToken: 'reload-only-confirmation',
    };
    const question = 'Compare the newly attached confirmed context';
    const durableRequestId = 'reload-confirmed-request';
    let replayedPair: ConversationAssistantTurn[] = [];
    let persistedTurns = turns;
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    mocks.getConversationAssistantContextAttachment.mockResolvedValue(warningAttachment);
    mocks.listConversationAssistantTurns.mockImplementation(async () => ({
      turns: persistedTurns,
    }));
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not visible yet', 404)
    );
    mocks.sendConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: {
          requestId: string;
          question: string;
          contextAttachmentId?: string;
          confirmationToken?: string;
        }
      ) => {
        replayedPair = [
          {
            id: 'reload-replay-user',
            sessionId: continuationSession.id,
            userId: 'user-1',
            role: 'user',
            text: request.question,
            createdAt: '2026-07-21T10:01:00.000Z',
            sequence: 3,
            requestId: request.requestId,
            contextAttachmentId: request.contextAttachmentId,
          },
          {
            id: 'reload-replay-assistant',
            sessionId: continuationSession.id,
            userId: 'user-1',
            role: 'assistant',
            text: 'Recovered with the confirmed attachment.',
            createdAt: '2026-07-21T10:02:00.000Z',
            sequence: 4,
            requestId: request.requestId,
          },
        ];
        persistedTurns = [...turns, ...replayedPair];
        return await replay.promise;
      }
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: continuationSession.id,
    };
    saveConversationAssistantDraft(
      window.sessionStorage,
      identity,
      {
        question,
        attachmentId: warningAttachment.id,
        startedTurnRequestId: durableRequestId,
        warningAcknowledged: true,
      },
      { attachmentExpiresAt: warningAttachment.expiresAt }
    );
    const storedBeforeReload = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey(identity)
    );
    expect(storedBeforeReload).not.toContain('reload-only-confirmation');

    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledWith(
        'tok',
        continuationSession.id,
        {
          requestId: durableRequestId,
          question,
          contextAttachmentId: warningAttachment.id,
          confirmationToken: 'reload-only-confirmation',
        },
        expect.any(AbortSignal)
      );
    });
    expect(result.current.turnPhase).toBe('restoring');
    expect(result.current.followUpQuestion).toBe(question);
    const storedDuringReplay = window.sessionStorage.getItem(
      getConversationAssistantDraftStorageKey(identity)
    );
    expect(storedDuringReplay).not.toContain('reload-only-confirmation');

    await act(async () => {
      replay.resolve({ turns: replayedPair });
      await replay.promise;
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.turns.filter((turn) => turn.requestId === durableRequestId)).toEqual(
        replayedPair
      );
    });
  });

  it('releases a missing durable id only after the exact replay is definitively not found', async () => {
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Session or attachment not found', 404)
    );
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: session.id,
      },
      {
        question: 'Safe to send after authoritative 404',
        startedTurnRequestId: 'missing-turn-request',
        warningAcknowledged: false,
      }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });

    await waitFor(() => {
      expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledWith(
        'tok',
        session.id,
        'missing-turn-request',
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.error).toBe(
        'Message was not sent. Your draft was kept. Try again.'
      );
    });
    expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledWith(
      'tok',
      session.id,
      {
        requestId: 'missing-turn-request',
        question: 'Safe to send after authoritative 404',
      },
      expect.any(AbortSignal)
    );
    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(mocks.streamConversationAssistantTurn).toHaveBeenCalledWith(
      'tok',
      session.id,
      expect.objectContaining({
        requestId: expect.not.stringMatching(/^missing-turn-request$/),
        question: 'Safe to send after authoritative 404',
      }),
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('stops exact replay after a plain context-window rejection', async () => {
    mocks.streamConversationAssistantTurn.mockRejectedValue(
      new Error('Initial transport disconnected')
    );
    mocks.getConversationAssistantTurnRequest.mockRejectedValue(
      new ApiError('NOT_FOUND', 'Turn request not found', 404)
    );
    mocks.sendConversationAssistantTurn.mockRejectedValue(
      new ApiError('CONTEXT_WINDOW_EXCEEDED', 'Prompt too large', 400)
    );
    const identity = {
      origin: window.location.origin,
      userId: 'user-1',
      sessionId: session.id,
    };
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion('Replay this oversized plain question once');
    });

    await act(async () => {
      await result.current.sendFollowUp();
    });
    await waitFor(() => {
      expect(mocks.sendConversationAssistantTurn).toHaveBeenCalledTimes(1);
      expect(result.current.turnPhase).toBe('idle');
    });

    expect.soft(result.current.followUpQuestion).toBe(
      'Replay this oversized plain question once'
    );
    expect.soft(result.current.error).toBe(
      'The selected conversation context does not fit this model. Create a smaller analysis with a shorter date range. Your draft was kept.'
    );
    const stored = JSON.parse(
      window.sessionStorage.getItem(getConversationAssistantDraftStorageKey(identity)) ?? '{}'
    ) as Record<string, unknown>;
    expect.soft(stored).not.toHaveProperty('startedTurnRequestId');
    act(() => {
      result.current.setFollowUpQuestion('Replay a shorter question');
    });
    expect(result.current.followUpQuestion).toBe('Replay a shorter question');
  });

  it('polls a broken SSE request to terminal beyond the old bounded recovery window', async () => {
    const recoveredUser: ConversationAssistantTurn = {
      id: 'broken-sse-user',
      sessionId: session.id,
      userId: 'user-1',
      role: 'user',
      text: 'Keep recovering this broken stream',
      createdAt: '2026-07-21T10:01:00.000Z',
      sequence: 3,
      requestId: 'broken-sse-request',
    };
    const recoveredAssistant: ConversationAssistantTurn = {
      id: 'broken-sse-assistant',
      sessionId: session.id,
      userId: 'user-1',
      role: 'assistant',
      text: 'Recovered after the old window.',
      createdAt: '2026-07-21T10:02:00.000Z',
      sequence: 4,
      requestId: 'broken-sse-request',
    };
    mocks.streamConversationAssistantTurn.mockImplementation(
      async (
        _token: string,
        _sessionId: string,
        request: { requestId: string },
        onEvent: (event: ConversationAssistantStreamEvent) => void
      ) => {
        recoveredUser.requestId = request.requestId;
        recoveredAssistant.requestId = request.requestId;
        onEvent({
          type: 'user_turn',
          requestId: request.requestId,
          streamSequence: 1,
          turn: recoveredUser,
        });
        onEvent({ type: 'assistant_delta', text: 'Partial answer' });
        throw new Error('SSE disconnected');
      }
    );
    mocks.getConversationAssistantTurnRequest
      .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', 'Try later', 503))
      .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', 'Try later', 503))
      .mockRejectedValueOnce(new ApiError('SERVICE_UNAVAILABLE', 'Try later', 503))
      .mockResolvedValueOnce({
        request: {
          id: 'broken-sse-request',
          sessionId: session.id,
          status: 'completed',
          attempt: 1,
          stateVersion: 4,
          conversationRevision: 1,
          completedAt: '2026-07-21T10:02:00.000Z',
        },
        turns: [recoveredUser, recoveredAssistant],
        canRetryAnswer: false,
      });
    mocks.listConversationAssistantTurns
      .mockResolvedValueOnce({ turns })
      .mockResolvedValue({ turns: [...turns, recoveredUser, recoveredAssistant] });
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });
    act(() => {
      result.current.setFollowUpQuestion(recoveredUser.text);
    });
    await act(async () => {
      await result.current.sendFollowUp();
    });
    expect(result.current.turnPhase).not.toBe('idle');

    await waitFor(
      () => {
        expect(mocks.getConversationAssistantTurnRequest).toHaveBeenCalledTimes(4);
      },
      { timeout: 5000 }
    );
    await waitFor(() => {
      expect(result.current.turnPhase).toBe('idle');
      expect(result.current.turns.map((turn) => turn.id)).toEqual([
        'turn-user',
        'turn-assistant',
        recoveredUser.id,
        recoveredAssistant.id,
      ]);
    });
  });

  it('aborts attachment restoration when the hook unmounts', async () => {
    mocks.listConversationAssistantSessions.mockResolvedValue({
      sessions: [continuationSession],
    });
    mocks.getConversationAssistantSession.mockResolvedValue(continuationSession);
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: continuationSession.id,
      },
      {
        question: 'Keep me',
        attachmentId: readyAttachment.id,
        warningAcknowledged: false,
      }
    );
    const never = createDeferred<ConversationAssistantContextAttachment>();
    mocks.getConversationAssistantContextAttachment.mockReturnValue(never.promise);
    const { result, unmount } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.pendingContextAttachment.phase).toBe('restoring');
    });
    const signal = mocks.getConversationAssistantContextAttachment.mock.calls[0]?.[3] as AbortSignal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('clears the selected session draft after confirmed session deletion', async () => {
    saveConversationAssistantDraft(
      window.sessionStorage,
      {
        origin: window.location.origin,
        userId: 'user-1',
        sessionId: session.id,
      },
      { question: 'Do not retain after deletion', warningAcknowledged: false }
    );
    const { result } = renderHook(() => useWhatsAppConversationAssistant(), {
      wrapper: createWrapper('/whatsapp/conversation-assistant?session=session-1'),
    });
    await waitFor(() => {
      expect(result.current.selectedSession?.id).toBe(session.id);
    });

    await act(async () => {
      await result.current.deleteSession(session.id, session.deletionToken);
    });

    expect(
      window.sessionStorage.getItem(
        getConversationAssistantDraftStorageKey({
          origin: window.location.origin,
          userId: 'user-1',
          sessionId: session.id,
        })
      )
    ).toBeNull();
  });
});
