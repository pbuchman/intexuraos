import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createConversationAssistantSession,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
} from '@/services/conversationAssistantApi';
import { listPrivateWhatsAppChats } from '@/services/whatsappApi';
import type {
  ConversationAssistantSession,
  ConversationAssistantTurn,
  PrivateWhatsAppChat,
} from '@/types';

const CHAT_PAGE_SIZE = 100;

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
  fromDateTimeLocal: string;
  toDateTimeLocal: string;
  firstQuestion: string;
  followUpQuestion: string;
  loading: boolean;
  loadingTurns: boolean;
  creating: boolean;
  sending: boolean;
  error: string | null;
  selectSession: (sessionId: string) => void;
  selectChat: (chatId: string) => void;
  setFromDateTimeLocal: (value: string) => void;
  setToDateTimeLocal: (value: string) => void;
  setFirstQuestion: (value: string) => void;
  setFollowUpQuestion: (value: string) => void;
  createSession: () => Promise<void>;
  sendFollowUp: () => Promise<void>;
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
  const turnsRequestIdRef = useRef(0);

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
  const [fromDateTimeLocal, setFromDateTimeLocal] = useState(defaultRange.from);
  const [toDateTimeLocal, setToDateTimeLocal] = useState(defaultRange.to);
  const [firstQuestion, setFirstQuestion] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
    setSelectedSessionOverride(undefined);
    setTurns([]);
    setFollowUpQuestion('');
    sendInFlightRef.current = false;
    setSending(false);
    setError(null);
    setInvalidSelectedSessionId(undefined);
    if (selectedSessionId === undefined) {
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
        setSelectedChatId((current) =>
          current !== undefined && directOnly.some((chat) => chat.id === current)
            ? current
            : directOnly[0]?.id
        );
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
    setSelectedChatId(chatId);
  }, []);

  const createSession = useCallback(async (): Promise<void> => {
    if (createInFlightRef.current) return;
    if (selectedChatId === undefined) {
      setError('Choose a private direct chat before creating a session.');
      return;
    }

    createInFlightRef.current = true;
    setCreating(true);
    setError(null);
    const requestId = createRequestIdRef.current + 1;
    createRequestIdRef.current = requestId;
    const originatingSessionId = selectedSessionIdRef.current;
    try {
      const token = await getAccessToken();
      const question = firstQuestion.trim();
      const session = await createConversationAssistantSession(token, {
        chatId: selectedChatId,
        from: fromDateTimeLocalValue(fromDateTimeLocal),
        to: fromDateTimeLocalValue(toDateTimeLocal),
        ...(question !== '' ? { question } : {}),
      });
      if (
        createRequestIdRef.current !== requestId ||
        selectedSessionIdRef.current !== originatingSessionId
      ) {
        return;
      }
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setInvalidSelectedSessionId(undefined);
      setSelectedSessionOverride(session);
      setFirstQuestion('');
      setFollowUpQuestion('');
      setSending(false);
      setError(null);
      turnsRequestIdRef.current += 1;
      selectedSessionIdRef.current = session.id;
      setSessionParam(session.id);
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
    }
  }, [
    firstQuestion,
    fromDateTimeLocal,
    getAccessToken,
    selectedChatId,
    setSessionParam,
    toDateTimeLocal,
  ]);

  const sendFollowUp = useCallback(async (): Promise<void> => {
    if (sendInFlightRef.current) return;
    const sessionId = selectedSessionIdRef.current;
    const question = followUpQuestion.trim();
    if (sessionId === undefined || question === '') return;

    const requestId = sendRequestIdRef.current + 1;
    sendRequestIdRef.current = requestId;
    sendInFlightRef.current = true;
    setSending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await sendConversationAssistantTurn(token, sessionId, { question });
      const stillSelected =
        selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId;
      if (stillSelected) {
        setTurns((current) => [...current, ...response.turns]);
        setFollowUpQuestion('');
      }
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
  }, [followUpQuestion, getAccessToken]);

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    turns,
    directChats,
    selectedChatId,
    fromDateTimeLocal,
    toDateTimeLocal,
    firstQuestion,
    followUpQuestion,
    loading,
    loadingTurns,
    creating,
    sending,
    error,
    selectSession,
    selectChat,
    setFromDateTimeLocal,
    setToDateTimeLocal,
    setFirstQuestion,
    setFollowUpQuestion,
    createSession,
    sendFollowUp,
    refresh,
  };
}
