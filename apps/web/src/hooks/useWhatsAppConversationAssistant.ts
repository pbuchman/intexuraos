import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { useAuth } from '@/context';
import {
  checkConversationAssistantContext,
  createConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  streamConversationAssistantTurn,
} from '@/services/conversationAssistantApi';
import { listPrivateWhatsAppChats } from '@/services/whatsappApi';
import type {
  ConversationAssistantContextCheckResponse,
  ConversationAssistantStreamEvent,
  CreateConversationAssistantSessionRequest,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  PrivateWhatsAppChat,
} from '@/types';

const CHAT_PAGE_SIZE = 100;

interface PendingLargeContextCreate {
  check: ConversationAssistantContextCheckResponse;
  request: CreateConversationAssistantSessionRequest;
  firstQuestion: string;
  originatingSessionId: string | undefined;
}

function toDateTimeLocalValue(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

function getDefaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return {
    from: toDateTimeLocalValue(from),
    to: toDateTimeLocalValue(to),
  };
}

export interface UseWhatsAppConversationAssistantResult {
  sessions: ConversationAssistantSession[];
  selectedSessionId: string | undefined;
  selectedSession: ConversationAssistantSession | undefined;
  turns: ConversationAssistantTurn[];
  directChats: PrivateWhatsAppChat[];
  selectedChatId: string | undefined;
  selectedModel: ConversationAssistantModel;
  fromDateTimeLocal: string;
  toDateTimeLocal: string;
  firstQuestion: string;
  followUpQuestion: string;
  loading: boolean;
  loadingTurns: boolean;
  creating: boolean;
  checkingContext: boolean;
  sending: boolean;
  exporting: boolean;
  error: string | null;
  largeContextWarning: ConversationAssistantContextCheckResponse | null;
  selectSession: (sessionId: string) => void;
  selectChat: (chatId: string) => void;
  selectModel: (model: ConversationAssistantModel) => void;
  setFromDateTimeLocal: (value: string) => void;
  setToDateTimeLocal: (value: string) => void;
  setFirstQuestion: (value: string) => void;
  setFollowUpQuestion: (value: string) => void;
  createSession: () => Promise<void>;
  confirmLargeContextCreate: () => Promise<void>;
  dismissLargeContextWarning: () => void;
  sendFollowUp: () => Promise<void>;
  exportSelectedSessionPdf: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function listAllPrivateWhatsAppChats(
  accessToken: string
): Promise<PrivateWhatsAppChat[]> {
  const chats: PrivateWhatsAppChat[] = [];
  let cursor: string | undefined;

  do {
    const response = await listPrivateWhatsAppChats(accessToken, {
      limit: CHAT_PAGE_SIZE,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    chats.push(...response.chats);
    cursor = response.nextCursor;
  } while (cursor !== undefined);

  return chats;
}

export function useWhatsAppConversationAssistant(): UseWhatsAppConversationAssistantResult {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSessionId = searchParams.get('session') ?? undefined;
  const createRequestIdRef = useRef(0);
  const createInFlightRef = useRef(false);
  const selectedSessionIdRef = useRef<string | undefined>(selectedSessionId);
  const chatListRequestIdRef = useRef(0);
  const sessionListRequestIdRef = useRef(0);
  const sendRequestIdRef = useRef(0);
  const sendInFlightRef = useRef(false);
  const exportInFlightRef = useRef(false);
  const turnsRequestIdRef = useRef(0);
  const skipNextSelectedSessionLoadRef = useRef<string | undefined>(undefined);

  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [sessions, setSessions] = useState<ConversationAssistantSession[]>([]);
  const [selectedSessionOverride, setSelectedSessionOverride] = useState<
    ConversationAssistantSession | undefined
  >(undefined);
  const [invalidSelectedSessionId, setInvalidSelectedSessionId] = useState<string | undefined>(
    undefined
  );
  const [turns, setTurns] = useState<ConversationAssistantTurn[]>([]);
  const [directChats, setDirectChats] = useState<PrivateWhatsAppChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<ConversationAssistantModel>(
    DEFAULT_CONVERSATION_ASSISTANT_MODEL
  );
  const [fromDateTimeLocal, setFromDateTimeLocalState] = useState(defaultRange.from);
  const [toDateTimeLocal, setToDateTimeLocalState] = useState(defaultRange.to);
  const [firstQuestion, setFirstQuestionState] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checkingContext, setCheckingContext] = useState(false);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLargeContext, setPendingLargeContext] =
    useState<PendingLargeContextCreate | null>(null);

  useEffect(() => {
    const skipSelectedSessionLoad =
      selectedSessionId !== undefined && skipNextSelectedSessionLoadRef.current === selectedSessionId;
    selectedSessionIdRef.current = selectedSessionId;
    if (!skipSelectedSessionLoad) {
      setSelectedSessionOverride(undefined);
      setTurns([]);
    }
    setFollowUpQuestion('');
    sendInFlightRef.current = false;
    setSending(false);
    setCheckingContext(false);
    setError(null);
    setPendingLargeContext(null);
    setInvalidSelectedSessionId(undefined);
    if (selectedSessionId === undefined) {
      setLoadingTurns(false);
    } else if (skipSelectedSessionLoad) {
      setLoadingTurns(false);
    }
  }, [selectedSessionId]);

  const setSessionParam = useCallback(
    (sessionId: string | undefined): void => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (sessionId === undefined || sessionId === '') {
          next.delete('session');
        } else {
          next.set('session', sessionId);
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const loadSessionsAndChats = useCallback(async (): Promise<void> => {
    setError(null);
    const chatRequestId = chatListRequestIdRef.current + 1;
    chatListRequestIdRef.current = chatRequestId;
    const sessionRequestId = sessionListRequestIdRef.current + 1;
    sessionListRequestIdRef.current = sessionRequestId;
    try {
      const token = await getAccessToken();
      const [chatResponse, sessionResponse] = await Promise.all([
        listAllPrivateWhatsAppChats(token),
        listConversationAssistantSessions(token),
      ]);
      const directOnly = chatResponse.filter((chat) => chat.chatType === 'direct');
      if (chatListRequestIdRef.current === chatRequestId) {
        setDirectChats(directOnly);
        setSelectedChatId((current) => {
          const next =
            current !== undefined && directOnly.some((chat) => chat.id === current)
              ? current
              : directOnly[0]?.id;
          if (next !== current) {
            setPendingLargeContext(null);
          }
          return next;
        });
      }
      if (sessionListRequestIdRef.current === sessionRequestId) {
        setSessions(sessionResponse.sessions);
      }
    } catch (err) {
      if (
        chatListRequestIdRef.current === chatRequestId ||
        sessionListRequestIdRef.current === sessionRequestId
      ) {
        setError(getErrorMessage(err, 'Failed to load WhatsApp Conversation Assistant'));
      }
    }
  }, [getAccessToken]);

  const loadSelectedSession = useCallback(async (): Promise<void> => {
    if (selectedSessionId === undefined) {
      turnsRequestIdRef.current += 1;
      setSelectedSessionOverride(undefined);
      setTurns([]);
      setLoadingTurns(false);
      return;
    }

    if (skipNextSelectedSessionLoadRef.current === selectedSessionId) {
      skipNextSelectedSessionLoadRef.current = undefined;
      turnsRequestIdRef.current += 1;
      setInvalidSelectedSessionId(undefined);
      setLoadingTurns(false);
      return;
    }

    const requestId = turnsRequestIdRef.current + 1;
    turnsRequestIdRef.current = requestId;
    setLoadingTurns(true);
    setInvalidSelectedSessionId(selectedSessionId);
    setError(null);
    try {
      const token = await getAccessToken();
      const [session, turnResponse] = await Promise.all([
        getConversationAssistantSession(token, selectedSessionId),
        listConversationAssistantTurns(token, selectedSessionId),
      ]);
      if (turnsRequestIdRef.current !== requestId) return;
      setInvalidSelectedSessionId(undefined);
      setSelectedSessionOverride(session);
      setTurns(turnResponse.turns);
    } catch (err) {
      if (turnsRequestIdRef.current === requestId) {
        setSelectedSessionOverride(undefined);
        setInvalidSelectedSessionId(selectedSessionId);
        setTurns([]);
        setError(getErrorMessage(err, 'Failed to load assistant session'));
      }
    } finally {
      if (turnsRequestIdRef.current === requestId) {
        setLoadingTurns(false);
      }
    }
  }, [getAccessToken, selectedSessionId]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await Promise.all([loadSessionsAndChats(), loadSelectedSession()]);
    } finally {
      setLoading(false);
    }
  }, [loadSelectedSession, loadSessionsAndChats]);

  useEffect(() => {
    setLoading(true);
    void loadSessionsAndChats().finally(() => {
      setLoading(false);
    });
  }, [loadSessionsAndChats]);

  useEffect(() => {
    void loadSelectedSession();
  }, [loadSelectedSession]);

  const selectedSession = useMemo(() => {
    if (selectedSessionId === invalidSelectedSessionId) {
      return undefined;
    }
    return selectedSessionOverride ?? sessions.find((session) => session.id === selectedSessionId);
  }, [invalidSelectedSessionId, selectedSessionId, selectedSessionOverride, sessions]);

  const selectSession = useCallback(
    (sessionId: string): void => {
      createRequestIdRef.current += 1;
      setSelectedSessionOverride(undefined);
      setSessionParam(sessionId);
    },
    [setSessionParam]
  );

  const selectChat = useCallback((chatId: string): void => {
    setPendingLargeContext(null);
    setSelectedChatId(chatId);
  }, []);

  const selectModel = useCallback((model: ConversationAssistantModel): void => {
    setPendingLargeContext(null);
    setSelectedModel(model);
  }, []);

  const setFromDateTimeLocal = useCallback((value: string): void => {
    setPendingLargeContext(null);
    setFromDateTimeLocalState(value);
  }, []);

  const setToDateTimeLocal = useCallback((value: string): void => {
    setPendingLargeContext(null);
    setToDateTimeLocalState(value);
  }, []);

  const setFirstQuestion = useCallback((value: string): void => {
    setPendingLargeContext(null);
    setFirstQuestionState(value);
  }, []);

  const dismissLargeContextWarning = useCallback((): void => {
    setPendingLargeContext(null);
  }, []);

  const streamQuestionIntoSession = useCallback(
    async (
      token: string,
      sessionId: string,
      question: string,
      clearQuestion: () => void,
      activeRequestId?: number,
      refreshSessionList = true
    ): Promise<void> => {
      const requestId = activeRequestId ?? sendRequestIdRef.current + 1;
      sendRequestIdRef.current = requestId;
      sendInFlightRef.current = true;
      setSending(true);
      let streamUserId = '';
      let streamedAssistantText = '';
      let streamedAssistantUsage: ConversationAssistantTurn['usage'];
      const streamingAssistantTurnId = `conversation-assistant-stream-${String(requestId)}`;
      const isCurrentRequest = (): boolean =>
        selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId;

      const applyStreamEvent = (event: ConversationAssistantStreamEvent): void => {
        if (!isCurrentRequest()) return;
        if (event.type === 'user_turn') {
          streamUserId = event.turn.userId;
          clearQuestion();
          setTurns((current) => [...current, event.turn]);
          return;
        }
        if (event.type === 'assistant_delta') {
          streamedAssistantText += event.text;
          setTurns((current) => {
            const existing = current.find((turn) => turn.id === streamingAssistantTurnId);
            if (existing !== undefined) {
              return current.map((turn) =>
                turn.id === streamingAssistantTurnId
                  ? {
                      ...turn,
                      text: streamedAssistantText,
                      ...(streamedAssistantUsage !== undefined
                        ? { usage: streamedAssistantUsage }
                        : {}),
                    }
                  : turn
              );
            }
            const placeholderTurn: ConversationAssistantTurn = {
              id: streamingAssistantTurnId,
              sessionId,
              userId: streamUserId,
              role: 'assistant',
              text: streamedAssistantText,
              createdAt: new Date().toISOString(),
            };
            if (streamedAssistantUsage !== undefined) {
              placeholderTurn.usage = streamedAssistantUsage;
            }
            return [...current, placeholderTurn];
          });
          return;
        }
        if (event.type === 'usage') {
          streamedAssistantUsage = event.usage;
          return;
        }
        if (event.type === 'error') {
          setError(event.error.message);
          return;
        }
        if (event.type === 'assistant_turn') {
          setTurns((current) => {
            const withoutPlaceholder = current.filter(
              (turn) => turn.id !== streamingAssistantTurnId
            );
            return [...withoutPlaceholder, event.turn];
          });
        }
      };

      try {
        await streamConversationAssistantTurn(token, sessionId, { question }, applyStreamEvent);
        if (refreshSessionList) {
          try {
            const sessionRequestId = sessionListRequestIdRef.current + 1;
            sessionListRequestIdRef.current = sessionRequestId;
            const sessionResponse = await listConversationAssistantSessions(token);
            if (sessionListRequestIdRef.current === sessionRequestId) {
              setSessions(sessionResponse.sessions);
            }
          } catch {
            // The turn was already saved; session-list refresh can recover on the next explicit refresh.
          }
        }
      } finally {
        if (sendRequestIdRef.current === requestId) {
          sendInFlightRef.current = false;
          setSending(false);
        }
      }
    },
    []
  );

  const createSessionFromRequest = useCallback(
    async (
      token: string,
      request: CreateConversationAssistantSessionRequest,
      firstQuestionToStream: string,
      requestId: number,
      originatingSessionId: string | undefined
    ): Promise<void> => {
      const session = await createConversationAssistantSession(token, request);
      if (
        createRequestIdRef.current !== requestId ||
        selectedSessionIdRef.current !== originatingSessionId
      ) {
        return;
      }
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setInvalidSelectedSessionId(undefined);
      setSelectedSessionOverride(session);
      setFirstQuestionState('');
      setFollowUpQuestion('');
      setSending(false);
      setError(null);
      turnsRequestIdRef.current += 1;
      selectedSessionIdRef.current = session.id;
      if (firstQuestionToStream !== '') {
        skipNextSelectedSessionLoadRef.current = session.id;
        setTurns([]);
      }
      setSessionParam(session.id);
      if (firstQuestionToStream !== '') {
        await streamQuestionIntoSession(token, session.id, firstQuestionToStream, () => {
          setFirstQuestionState('');
        }, undefined, false);
      }
    },
    [setSessionParam, streamQuestionIntoSession]
  );

  const createSession = useCallback(async (): Promise<void> => {
    if (createInFlightRef.current) return;
    if (selectedChatId === undefined) {
      setError('Choose a private direct chat before creating a session.');
      return;
    }

    createInFlightRef.current = true;
    setCreating(true);
    setCheckingContext(true);
    setError(null);
    setPendingLargeContext(null);
    const requestId = createRequestIdRef.current + 1;
    createRequestIdRef.current = requestId;
    const originatingSessionId = selectedSessionIdRef.current;
    try {
      const token = await getAccessToken();
      const question = firstQuestion.trim();
      const request: CreateConversationAssistantSessionRequest = {
        chatId: selectedChatId,
        from: fromDateTimeLocalValue(fromDateTimeLocal),
        to: fromDateTimeLocalValue(toDateTimeLocal),
        model: selectedModel,
      };
      const check = await checkConversationAssistantContext(token, {
        chatId: request.chatId,
        from: request.from,
        to: request.to,
      });
      if (
        createRequestIdRef.current !== requestId ||
        selectedSessionIdRef.current !== originatingSessionId
      ) {
        return;
      }
      if (check.requiresConfirmation) {
        setPendingLargeContext({ check, request, firstQuestion: question, originatingSessionId });
        return;
      }
      await createSessionFromRequest(token, request, question, requestId, originatingSessionId);
    } catch (err) {
      if (
        createRequestIdRef.current === requestId &&
        selectedSessionIdRef.current === originatingSessionId
      ) {
        setError(getErrorMessage(err, 'Failed to create assistant session'));
      }
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
      setCheckingContext(false);
    }
  }, [
    createSessionFromRequest,
    firstQuestion,
    fromDateTimeLocal,
    getAccessToken,
    selectedChatId,
    selectedModel,
    toDateTimeLocal,
  ]);

  const confirmLargeContextCreate = useCallback(async (): Promise<void> => {
    if (createInFlightRef.current || pendingLargeContext === null) return;

    createInFlightRef.current = true;
    setCreating(true);
    setCheckingContext(false);
    setError(null);
    setPendingLargeContext(null);
    const requestId = createRequestIdRef.current + 1;
    createRequestIdRef.current = requestId;
    try {
      const token = await getAccessToken();
      await createSessionFromRequest(
        token,
        pendingLargeContext.request,
        pendingLargeContext.firstQuestion,
        requestId,
        pendingLargeContext.originatingSessionId
      );
    } catch (err) {
      if (selectedSessionIdRef.current === pendingLargeContext.originatingSessionId) {
        setError(getErrorMessage(err, 'Failed to create assistant session'));
      }
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  }, [createSessionFromRequest, getAccessToken, pendingLargeContext]);

  const sendFollowUp = useCallback(async (): Promise<void> => {
    if (sendInFlightRef.current) return;
    const sessionId = selectedSessionIdRef.current;
    const question = followUpQuestion.trim();
    if (sessionId === undefined || question === '') return;

    const requestId = sendRequestIdRef.current + 1;
    sendInFlightRef.current = true;
    setSending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      await streamQuestionIntoSession(
        token,
        sessionId,
        question,
        () => {
          setFollowUpQuestion('');
        },
        requestId
      );
    } catch (err) {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        setError(getErrorMessage(err, 'Failed to send follow-up question'));
      }
    } finally {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        sendInFlightRef.current = false;
        setSending(false);
      }
    }
  }, [followUpQuestion, getAccessToken, streamQuestionIntoSession]);

  const exportSelectedSessionPdf = useCallback(async (): Promise<void> => {
    if (exportInFlightRef.current) return;

    const session = selectedSession;
    if (session === undefined) {
      setError('Select an assistant session before exporting.');
      return;
    }

    exportInFlightRef.current = true;
    setExporting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const download = await exportConversationAssistantSessionPdf(token, session.id);
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.filename;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to export assistant session'));
    } finally {
      exportInFlightRef.current = false;
      setExporting(false);
    }
  }, [getAccessToken, selectedSession]);

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    turns,
    directChats,
    selectedChatId,
    selectedModel,
    fromDateTimeLocal,
    toDateTimeLocal,
    firstQuestion,
    followUpQuestion,
    loading,
    loadingTurns,
    creating,
    checkingContext,
    sending,
    exporting,
    error,
    largeContextWarning: pendingLargeContext?.check ?? null,
    selectSession,
    selectChat,
    selectModel,
    setFromDateTimeLocal,
    setToDateTimeLocal,
    setFirstQuestion,
    setFollowUpQuestion,
    createSession,
    confirmLargeContextCreate,
    dismissLargeContextWarning,
    sendFollowUp,
    exportSelectedSessionPdf,
    refresh,
  };
}
