import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  isConversationAssistantModel,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { useAuth } from '@/context';
import {
  createConversationAssistantSession,
  deleteConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantContext,
  getConversationAssistantSession,
  getConversationAssistantSessionByRequest,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  streamConversationAssistantTurn,
  retryConversationAssistantPreparation,
} from '@/services/conversationAssistantApi';
import { listPrivateWhatsAppChats } from '@/services/whatsappApi';
import type {
  ConversationAssistantContextResponse,
  ConversationAssistantStreamEvent,
  CreateConversationAssistantSessionRequest,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  PrivateWhatsAppChat,
} from '@/types';

const CHAT_PAGE_SIZE = 100;
const PENDING_CREATION_STORAGE_KEY = 'whatsapp-conversation-assistant-pending-creation';
const CREATION_RECOVERY_DELAYS_MS = [0, 250, 750, 1500] as const;
const TURN_RECOVERY_DELAYS_MS = [0, 150, 400, 900] as const;
const BEST_EFFORT_RECONCILIATION_TIMEOUT_MS = 750;
const MESSAGE_NOT_SENT_ERROR = 'Message was not sent. Your draft was kept. Try again.';

async function withBestEffortReconciliationTimeout<T>(request: Promise<T>): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Best-effort reconciliation timed out'));
    }, BEST_EFFORT_RECONCILIATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

interface StoredPendingCreation {
  request: CreateConversationAssistantSessionRequest;
  savedAt: number;
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

function newCreationRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function rememberPendingCreation(request: CreateConversationAssistantSessionRequest): void {
  try {
    globalThis.sessionStorage.setItem(
      PENDING_CREATION_STORAGE_KEY,
      JSON.stringify({ request, savedAt: Date.now() })
    );
  } catch {
    // Recovery storage is best-effort; request idempotency still protects the active page.
  }
}

function clearPendingCreation(): void {
  try {
    globalThis.sessionStorage.removeItem(PENDING_CREATION_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

function readPendingCreation(): StoredPendingCreation | null {
  try {
    const raw = globalThis.sessionStorage.getItem(PENDING_CREATION_STORAGE_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as { request?: unknown; savedAt?: unknown };
    if (
      !isStoredCreationRequest(value.request) ||
      typeof value.savedAt !== 'number' ||
      Date.now() - value.savedAt > 10 * 60 * 1000
    ) {
      clearPendingCreation();
      return null;
    }
    return { request: value.request, savedAt: value.savedAt };
  } catch {
    clearPendingCreation();
    return null;
  }
}

function isStoredCreationRequest(value: unknown): value is CreateConversationAssistantSessionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request['requestId'] === 'string' &&
    typeof request['chatId'] === 'string' &&
    typeof request['from'] === 'string' &&
    Number.isFinite(Date.parse(request['from'])) &&
    typeof request['to'] === 'string' &&
    Number.isFinite(Date.parse(request['to'])) &&
    (request['model'] === undefined ||
      (typeof request['model'] === 'string' && isConversationAssistantModel(request['model'])))
  );
}

async function recoverPendingCreation(
  token: string,
  requestId: string
): Promise<ConversationAssistantSession> {
  let lastError: unknown;
  for (const delay of CREATION_RECOVERY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      });
    }
    try {
      return await getConversationAssistantSessionByRequest(token, requestId);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function recoverAcknowledgedTurn(
  token: string,
  sessionId: string,
  acknowledgedUserTurnId: string,
  isCurrentRequest: () => boolean
): Promise<ConversationAssistantTurn[] | null> {
  for (const delay of TURN_RECOVERY_DELAYS_MS) {
    if (!isCurrentRequest()) return null;
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      });
    }
    if (!isCurrentRequest()) return null;
    try {
      const response = await withBestEffortReconciliationTimeout(
        listConversationAssistantTurns(token, sessionId)
      );
      const acknowledgedIndex = response.turns.findIndex(
        (turn) => turn.id === acknowledgedUserTurnId
      );
      if (
        acknowledgedIndex >= 0 &&
        response.turns.slice(acknowledgedIndex + 1).some((turn) => turn.role === 'assistant')
      ) {
        return response.turns;
      }
    } catch {
      // Persistence can finish after the stream closes; retry within the bounded window.
    }
  }
  return null;
}

export interface UseWhatsAppConversationAssistantResult {
  sessions: ConversationAssistantSession[];
  selectedSessionId: string | undefined;
  selectedSession: ConversationAssistantSession | undefined;
  turns: ConversationAssistantTurn[];
  context: ConversationAssistantContextResponse | null;
  directChats: PrivateWhatsAppChat[];
  selectedChatId: string | undefined;
  selectedModel: ConversationAssistantModel;
  fromDateTimeLocal: string;
  toDateTimeLocal: string;
  followUpQuestion: string;
  loading: boolean;
  loadingTurns: boolean;
  loadingContext: boolean;
  loadingMoreContext: boolean;
  creating: boolean;
  turnPhase: ConversationAssistantTurnPhase;
  retryingPreparation: boolean;
  exporting: boolean;
  deletingSessionId: string | undefined;
  error: string | null;
  contextError: string | null;
  deleteError: string | null;
  selectSession: (sessionId: string) => void;
  selectChat: (chatId: string) => void;
  selectModel: (model: ConversationAssistantModel) => void;
  setFromDateTimeLocal: (value: string) => void;
  setToDateTimeLocal: (value: string) => void;
  setFollowUpQuestion: (value: string) => void;
  createSession: () => Promise<void>;
  sendFollowUp: () => Promise<void>;
  loadContext: () => Promise<void>;
  loadMoreContext: () => Promise<void>;
  retryPreparation: () => Promise<void>;
  exportSelectedSessionPdf: () => Promise<void>;
  deleteSession: (sessionId: string, deletionToken: string | undefined) => Promise<boolean>;
  clearDeleteError: () => void;
  refresh: () => Promise<void>;
}

export type ConversationAssistantTurnPhase =
  | 'idle'
  | 'submitting'
  | 'waiting'
  | 'streaming';

export interface UseWhatsAppConversationAssistantOptions {
  sessionId?: string;
  loadChats?: boolean;
  loadSessions?: boolean;
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

export function useWhatsAppConversationAssistant(
  input?: string | UseWhatsAppConversationAssistantOptions
): UseWhatsAppConversationAssistantResult {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSessionId = typeof input === 'string' ? input : input?.sessionId;
  const loadChats = typeof input === 'string' ? true : (input?.loadChats ?? true);
  const loadSessions = typeof input === 'string' ? true : (input?.loadSessions ?? true);
  const selectedSessionId = routeSessionId ?? searchParams.get('session') ?? undefined;
  const createRequestIdRef = useRef(0);
  const createInFlightRef = useRef(false);
  const creationClientRequestIdRef = useRef<string | null>(null);
  const pendingCreationRequestRef = useRef<CreateConversationAssistantSessionRequest | null>(null);
  const selectedSessionIdRef = useRef<string | undefined>(selectedSessionId);
  const chatListRequestIdRef = useRef(0);
  const sessionListRequestIdRef = useRef(0);
  const sendRequestIdRef = useRef(0);
  const sendInFlightRef = useRef(false);
  const acknowledgedSendRequestIdRef = useRef<number | null>(null);
  const acknowledgedUserTurnIdRef = useRef<string | null>(null);
  const exportInFlightRef = useRef(false);
  const deleteInFlightSessionIdRef = useRef<string | null>(null);
  const retryPreparationInFlightRef = useRef(false);
  const creationRecoveryStartedRef = useRef(false);
  const turnsRequestIdRef = useRef(0);
  const contextRequestIdRef = useRef(0);
  const contextLoadedSessionIdRef = useRef<string | null>(null);
  const contextInFlightSessionIdRef = useRef<string | null>(null);

  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [sessions, setSessions] = useState<ConversationAssistantSession[]>([]);
  const [selectedSessionOverride, setSelectedSessionOverride] = useState<
    ConversationAssistantSession | undefined
  >(undefined);
  const [invalidSelectedSessionId, setInvalidSelectedSessionId] = useState<string | undefined>(
    undefined
  );
  const [turns, setTurns] = useState<ConversationAssistantTurn[]>([]);
  const [context, setContext] = useState<ConversationAssistantContextResponse | null>(null);
  const [directChats, setDirectChats] = useState<PrivateWhatsAppChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<ConversationAssistantModel>(
    DEFAULT_CONVERSATION_ASSISTANT_MODEL
  );
  const [fromDateTimeLocal, setFromDateTimeLocalState] = useState(defaultRange.from);
  const [toDateTimeLocal, setToDateTimeLocalState] = useState(defaultRange.to);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingMoreContext, setLoadingMoreContext] = useState(false);
  const [creating, setCreating] = useState(false);
  const [turnPhase, setTurnPhase] = useState<ConversationAssistantTurnPhase>('idle');
  const [retryingPreparation, setRetryingPreparation] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
    setSelectedSessionOverride(undefined);
    setTurns([]);
    contextRequestIdRef.current += 1;
    contextLoadedSessionIdRef.current = null;
    contextInFlightSessionIdRef.current = null;
    setContext(null);
    setContextError(null);
    setLoadingContext(false);
    setLoadingMoreContext(false);
    setFollowUpQuestion('');
    sendInFlightRef.current = false;
    acknowledgedSendRequestIdRef.current = null;
    setTurnPhase('idle');
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
    if (!loadChats && !loadSessions) return;

    const chatRequestId = chatListRequestIdRef.current + 1;
    chatListRequestIdRef.current = chatRequestId;
    const sessionRequestId = sessionListRequestIdRef.current + 1;
    sessionListRequestIdRef.current = sessionRequestId;
    try {
      const token = await getAccessToken();
      const [chatResponse, sessionResponse] = await Promise.all([
        loadChats ? listAllPrivateWhatsAppChats(token) : Promise.resolve(null),
        loadSessions ? listConversationAssistantSessions(token) : Promise.resolve(null),
      ]);
      const directOnly = chatResponse?.filter((chat) => chat.chatType === 'direct');
      if (directOnly !== undefined && chatListRequestIdRef.current === chatRequestId) {
        setDirectChats(directOnly);
        setSelectedChatId((current) => {
          return current !== undefined && directOnly.some((chat) => chat.id === current)
            ? current
            : undefined;
        });
      }
      if (sessionResponse !== null && sessionListRequestIdRef.current === sessionRequestId) {
        setSessions(sessionResponse.sessions);
      }
    } catch (err) {
      if (
        (loadChats && chatListRequestIdRef.current === chatRequestId) ||
        (loadSessions && sessionListRequestIdRef.current === sessionRequestId)
      ) {
        setError(getErrorMessage(err, 'Failed to load WhatsApp Conversation Assistant'));
      }
    }
  }, [getAccessToken, loadChats, loadSessions]);

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

  useEffect(() => {
    if (
      creationRecoveryStartedRef.current ||
      !loadChats ||
      loadSessions ||
      selectedSessionId !== undefined
    ) {
      return;
    }
    const pendingCreation = readPendingCreation();
    if (pendingCreation === null) return;
    const { request } = pendingCreation;
    creationRecoveryStartedRef.current = true;
    creationClientRequestIdRef.current = request.requestId;
    pendingCreationRequestRef.current = request;
    setSelectedChatId(request.chatId);
    setFromDateTimeLocalState(toDateTimeLocalValue(new Date(request.from)));
    setToDateTimeLocalState(toDateTimeLocalValue(new Date(request.to)));
    if (request.model !== undefined) setSelectedModel(request.model);
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const recovered = await recoverPendingCreation(token, request.requestId);
        setSessions([recovered]);
        setSelectedSessionOverride(recovered);
        selectedSessionIdRef.current = recovered.id;
        creationClientRequestIdRef.current = null;
        pendingCreationRequestRef.current = null;
        clearPendingCreation();
        setSessionParam(recovered.id);
      } catch {
        setError(
          'The pending analysis could not be confirmed yet. Retry to safely reuse the same request.'
        );
      }
    })();
  }, [getAccessToken, loadChats, loadSessions, selectedSessionId, setSessionParam]);

  useEffect(() => {
    if (
      selectedSessionId === undefined ||
      selectedSession?.status !== 'preparing' ||
      selectedSession.deletionPending === true
    ) {
      return;
    }
    let cancelled = false;
    let requestInFlight = false;
    const poll = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const token = await getAccessToken();
        const refreshed = await getConversationAssistantSession(token, selectedSessionId);
        if (!cancelled && selectedSessionIdRef.current === selectedSessionId) {
          setSelectedSessionOverride(refreshed);
        }
      } catch {
        // Polling is best-effort; explicit refresh remains available.
      } finally {
        requestInFlight = false;
      }
    };
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);
    return (): void => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getAccessToken, selectedSession?.deletionPending, selectedSession?.status, selectedSessionId]);

  useEffect(() => {
    if (
      !loadSessions ||
      !sessions.some(
        (item) => item.status === 'preparing' && item.deletionPending !== true
      )
    ) {
      return;
    }
    let refreshInFlight = false;
    const intervalId = window.setInterval(() => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      void loadSessionsAndChats().finally(() => {
        refreshInFlight = false;
      });
    }, 3000);
    return (): void => {
      window.clearInterval(intervalId);
    };
  }, [loadSessions, loadSessionsAndChats, sessions]);

  const selectSession = useCallback(
    (sessionId: string): void => {
      createRequestIdRef.current += 1;
      setSelectedSessionOverride(undefined);
      setSessionParam(sessionId);
    },
    [setSessionParam]
  );

  const selectChat = useCallback((chatId: string): void => {
    creationClientRequestIdRef.current = null;
    pendingCreationRequestRef.current = null;
    clearPendingCreation();
    setSelectedChatId(chatId);
  }, []);

  const selectModel = useCallback((model: ConversationAssistantModel): void => {
    creationClientRequestIdRef.current = null;
    pendingCreationRequestRef.current = null;
    clearPendingCreation();
    setSelectedModel(model);
  }, []);

  const setFromDateTimeLocal = useCallback((value: string): void => {
    creationClientRequestIdRef.current = null;
    pendingCreationRequestRef.current = null;
    clearPendingCreation();
    setFromDateTimeLocalState(value);
  }, []);

  const setToDateTimeLocal = useCallback((value: string): void => {
    creationClientRequestIdRef.current = null;
    pendingCreationRequestRef.current = null;
    clearPendingCreation();
    setToDateTimeLocalState(value);
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
      acknowledgedSendRequestIdRef.current = null;
      acknowledgedUserTurnIdRef.current = null;
      setTurnPhase('submitting');
      let streamUserId = '';
      let streamedAssistantText = '';
      let streamedAssistantUsage: ConversationAssistantTurn['usage'];
      const streamingAssistantTurnId = `conversation-assistant-stream-${String(requestId)}`;
      const isCurrentRequest = (): boolean =>
        selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId;

      const applyStreamEvent = (event: ConversationAssistantStreamEvent): void => {
        if (!isCurrentRequest()) return;
        if (event.type === 'user_turn') {
          acknowledgedSendRequestIdRef.current = requestId;
          acknowledgedUserTurnIdRef.current = event.turn.id;
          streamUserId = event.turn.userId;
          clearQuestion();
          setTurns((current) => [...current, event.turn]);
          setTurnPhase('waiting');
          return;
        }
        if (event.type === 'assistant_delta') {
          setTurnPhase('streaming');
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
          setError(
            acknowledgedSendRequestIdRef.current === requestId
              ? event.error.message
              : MESSAGE_NOT_SENT_ERROR
          );
          return;
        }
        if (event.type === 'assistant_turn') {
          setTurns((current) => {
            const withoutPlaceholder = current.filter(
              (turn) => turn.id !== streamingAssistantTurnId
            );
            return [...withoutPlaceholder, event.turn];
          });
          return;
        }
      };

      try {
        await streamConversationAssistantTurn(token, sessionId, { question }, applyStreamEvent);
        if (refreshSessionList) {
          const sessionRequestId = sessionListRequestIdRef.current + 1;
          sessionListRequestIdRef.current = sessionRequestId;
          void listConversationAssistantSessions(token)
            .then((sessionResponse) => {
              if (sessionListRequestIdRef.current === sessionRequestId) {
                setSessions(sessionResponse.sessions);
              }
            })
            .catch(() => {
              // The turn was already saved; an explicit refresh can recover the summary later.
            });
        }
      } catch (streamError) {
        if (isCurrentRequest() && streamUserId !== '') {
          setTurns((current) =>
            current.filter((turn) => turn.id !== streamingAssistantTurnId)
          );
        }
        throw streamError;
      }
    },
    []
  );

  const createSessionFromRequest = useCallback(
    async (
      token: string,
      request: CreateConversationAssistantSessionRequest,
      requestId: number,
      originatingSessionId: string | undefined
    ): Promise<void> => {
      pendingCreationRequestRef.current = request;
      rememberPendingCreation(request);
      let session: ConversationAssistantSession;
      try {
        session = await createConversationAssistantSession(token, request);
      } catch (creationError) {
        try {
          session = await recoverPendingCreation(token, request.requestId);
        } catch {
          throw creationError;
        }
      }
      if (
        createRequestIdRef.current !== requestId ||
        selectedSessionIdRef.current !== originatingSessionId
      ) {
        return;
      }
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setInvalidSelectedSessionId(undefined);
      setSelectedSessionOverride(session);
      setFollowUpQuestion('');
      setTurnPhase('idle');
      setError(null);
      creationClientRequestIdRef.current = null;
      pendingCreationRequestRef.current = null;
      clearPendingCreation();
      turnsRequestIdRef.current += 1;
      selectedSessionIdRef.current = session.id;
      setTurns([]);
      setSessionParam(session.id);
    },
    [setSessionParam]
  );

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
      const pendingRequest = pendingCreationRequestRef.current;
      const clientRequestId =
        pendingRequest?.requestId ?? creationClientRequestIdRef.current ?? newCreationRequestId();
      creationClientRequestIdRef.current = clientRequestId;
      const request: CreateConversationAssistantSessionRequest = pendingRequest ?? {
        requestId: clientRequestId,
        chatId: selectedChatId,
        from: fromDateTimeLocalValue(fromDateTimeLocal),
        to: fromDateTimeLocalValue(toDateTimeLocal),
        model: selectedModel,
      };
      await createSessionFromRequest(token, request, requestId, originatingSessionId);
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
    createSessionFromRequest,
    fromDateTimeLocal,
    getAccessToken,
    selectedChatId,
    selectedModel,
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
    setTurnPhase('submitting');
    setError(null);
    let token: string | undefined;
    try {
      token = await getAccessToken();
      if (
        selectedSessionIdRef.current !== sessionId ||
        sendRequestIdRef.current !== requestId
      ) {
        return;
      }
      await streamQuestionIntoSession(
        token,
        sessionId,
        question,
        () => {
          setFollowUpQuestion('');
        },
        requestId,
        loadSessions
      );
    } catch {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        if (acknowledgedSendRequestIdRef.current !== requestId) {
          setError(MESSAGE_NOT_SENT_ERROR);
        } else {
          let reconciled = false;
          let reconciliationRequestId: number | null = null;
          const acknowledgedUserTurnId = acknowledgedUserTurnIdRef.current;
          if (token !== undefined && acknowledgedUserTurnId !== null) {
            reconciliationRequestId = turnsRequestIdRef.current + 1;
            turnsRequestIdRef.current = reconciliationRequestId;
            const savedTurns = await recoverAcknowledgedTurn(
              token,
              sessionId,
              acknowledgedUserTurnId,
              () =>
                selectedSessionIdRef.current === sessionId &&
                sendRequestIdRef.current === requestId &&
                turnsRequestIdRef.current === reconciliationRequestId
            );
            if (savedTurns !== null) {
              if (
                selectedSessionIdRef.current === sessionId &&
                sendRequestIdRef.current === requestId &&
                turnsRequestIdRef.current === reconciliationRequestId
              ) {
                setTurns(savedTurns);
                reconciled = true;
              }
            }
          }
          if (
            selectedSessionIdRef.current !== sessionId ||
            sendRequestIdRef.current !== requestId ||
            (reconciliationRequestId !== null &&
              turnsRequestIdRef.current !== reconciliationRequestId)
          ) {
            return;
          }
          setError(
            reconciled
              ? 'The live response was interrupted. Saved messages were refreshed.'
              : 'The live response was interrupted. Refresh the page to check the saved response.'
          );
        }
      }
    } finally {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        sendInFlightRef.current = false;
        acknowledgedSendRequestIdRef.current = null;
        acknowledgedUserTurnIdRef.current = null;
        setTurnPhase('idle');
      }
    }
  }, [followUpQuestion, getAccessToken, loadSessions, streamQuestionIntoSession]);

  const loadContext = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current;
    if (
      sessionId === undefined ||
      contextLoadedSessionIdRef.current === sessionId ||
      contextInFlightSessionIdRef.current === sessionId
    ) {
      return;
    }
    const requestId = contextRequestIdRef.current + 1;
    contextRequestIdRef.current = requestId;
    contextInFlightSessionIdRef.current = sessionId;
    setLoadingContext(true);
    setContextError(null);
    try {
      const token = await getAccessToken();
      const loadedContext = await getConversationAssistantContext(token, sessionId);
      if (
        contextRequestIdRef.current === requestId &&
        selectedSessionIdRef.current === sessionId
      ) {
        setContext(loadedContext);
        contextLoadedSessionIdRef.current = sessionId;
      }
    } catch (err) {
      if (
        contextRequestIdRef.current === requestId &&
        selectedSessionIdRef.current === sessionId
      ) {
        setContextError(getErrorMessage(err, 'Failed to load frozen context'));
      }
    } finally {
      if (contextRequestIdRef.current === requestId) {
        contextInFlightSessionIdRef.current = null;
        setLoadingContext(false);
      }
    }
  }, [getAccessToken]);

  const loadMoreContext = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current;
    const currentContext = context;
    if (
      sessionId === undefined ||
      currentContext === null ||
      contextInFlightSessionIdRef.current === sessionId ||
      (currentContext.nextMessageCursor === undefined &&
        currentContext.nextOmittedCursor === undefined)
    ) {
      return;
    }
    const requestId = contextRequestIdRef.current + 1;
    contextRequestIdRef.current = requestId;
    contextInFlightSessionIdRef.current = sessionId;
    setLoadingMoreContext(true);
    setContextError(null);
    try {
      const token = await getAccessToken();
      const loadedContext = await getConversationAssistantContext(token, sessionId, {
        messageCursor: currentContext.nextMessageCursor ?? currentContext.messageCount,
        omittedCursor:
          currentContext.nextOmittedCursor ?? currentContext.omittedMessageCount,
      });
      if (
        contextRequestIdRef.current === requestId &&
        selectedSessionIdRef.current === sessionId
      ) {
        setContext((latest) =>
          latest === null
            ? loadedContext
            : {
                ...loadedContext,
                messages: [...latest.messages, ...loadedContext.messages],
                omittedMessages: [
                  ...latest.omittedMessages,
                  ...loadedContext.omittedMessages,
                ],
              }
        );
      }
    } catch (err) {
      if (
        contextRequestIdRef.current === requestId &&
        selectedSessionIdRef.current === sessionId
      ) {
        setContextError(getErrorMessage(err, 'Failed to load more frozen context'));
      }
    } finally {
      if (contextRequestIdRef.current === requestId) {
        contextInFlightSessionIdRef.current = null;
        setLoadingMoreContext(false);
      }
    }
  }, [context, getAccessToken]);

  const retryPreparation = useCallback(async (): Promise<void> => {
    if (retryPreparationInFlightRef.current) return;
    const sessionId = selectedSessionIdRef.current;
    if (sessionId === undefined) return;
    retryPreparationInFlightRef.current = true;
    setRetryingPreparation(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const retried = await retryConversationAssistantPreparation(token, sessionId);
      if (selectedSessionIdRef.current === sessionId) {
        setSelectedSessionOverride(retried);
        setSessions((current) =>
          current.map((item) => (item.id === retried.id ? retried : item))
        );
      }
    } catch (err) {
      if (selectedSessionIdRef.current === sessionId) {
        setError(getErrorMessage(err, 'Failed to retry context preparation'));
      }
    } finally {
      retryPreparationInFlightRef.current = false;
      setRetryingPreparation(false);
    }
  }, [getAccessToken]);

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

  const deleteSession = useCallback(
    async (sessionId: string, deletionToken: string | undefined): Promise<boolean> => {
      if (deleteInFlightSessionIdRef.current !== null) return false;
      deleteInFlightSessionIdRef.current = sessionId;
      setDeletingSessionId(sessionId);
      setDeleteError(null);
      let accessToken: string | undefined;
      try {
        if (deletionToken === undefined) {
          setDeleteError('Refresh analyses before deleting this item.');
          return false;
        }
        accessToken = await getAccessToken();
        sessionListRequestIdRef.current += 1;
        await deleteConversationAssistantSession(accessToken, sessionId, deletionToken);
        sessionListRequestIdRef.current += 1;
        setSessions((current) =>
          current.filter(
            (item) => item.id !== sessionId || item.deletionToken !== deletionToken
          )
        );
        if (
          selectedSessionIdRef.current === sessionId &&
          selectedSession?.deletionToken === deletionToken
        ) {
          setSelectedSessionOverride(undefined);
          setInvalidSelectedSessionId(sessionId);
          setTurns([]);
          setContext(null);
        }
        return true;
      } catch (err) {
        if (accessToken !== undefined) {
          const reconciliationRequestId = sessionListRequestIdRef.current + 1;
          sessionListRequestIdRef.current = reconciliationRequestId;
          try {
            const response = await withBestEffortReconciliationTimeout(
              listConversationAssistantSessions(accessToken)
            );
            if (sessionListRequestIdRef.current === reconciliationRequestId) {
              const reconciledSession = response.sessions.find((item) => item.id === sessionId);
              setSessions(response.sessions);
              if (reconciledSession === undefined) {
                if (selectedSessionIdRef.current === sessionId) {
                  setSelectedSessionOverride(undefined);
                  setInvalidSelectedSessionId(sessionId);
                  setTurns([]);
                  setContext(null);
                }
                return true;
              }
              if (
                reconciledSession.deletionToken === deletionToken &&
                reconciledSession.deletionPending === true
              ) {
                if (selectedSessionIdRef.current === sessionId) {
                  setSelectedSessionOverride(reconciledSession);
                  setTurns([]);
                  setContext(null);
                }
                setDeleteError(
                  'Deletion was interrupted. Finish deletion to remove the remaining analysis data.'
                );
                return false;
              }
            }
          } catch {
            // Keep the original deletion error when reconciliation is unavailable.
          }
        }
        setDeleteError(getErrorMessage(err, 'Failed to delete analysis'));
        return false;
      } finally {
        deleteInFlightSessionIdRef.current = null;
        setDeletingSessionId(undefined);
      }
    },
    [getAccessToken, selectedSession]
  );

  const clearDeleteError = useCallback((): void => {
    setDeleteError(null);
  }, []);

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    turns,
    context,
    directChats,
    selectedChatId,
    selectedModel,
    fromDateTimeLocal,
    toDateTimeLocal,
    followUpQuestion,
    loading,
    loadingTurns,
    loadingContext,
    loadingMoreContext,
    creating,
    turnPhase,
    retryingPreparation,
    exporting,
    deletingSessionId,
    error,
    contextError,
    deleteError,
    selectSession,
    selectChat,
    selectModel,
    setFromDateTimeLocal,
    setToDateTimeLocal,
    setFollowUpQuestion,
    createSession,
    sendFollowUp,
    loadContext,
    loadMoreContext,
    retryPreparation,
    exportSelectedSessionPdf,
    deleteSession,
    clearDeleteError,
    refresh,
  };
}
