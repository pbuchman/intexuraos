import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import {
  DEFAULT_CONVERSATION_ASSISTANT_MODEL,
  isConversationAssistantModel,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { useAuth } from '@/context';
import {
  createConversationAssistantContextAttachment,
  createConversationAssistantSession,
  deleteConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantContext,
  getConversationAssistantSession,
  getConversationAssistantSessionByRequest,
  getConversationAssistantContextAttachment,
  getConversationAssistantContextAttachmentPreview,
  getConversationAssistantContextHistory,
  getConversationAssistantTurnRequest,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
  streamConversationAssistantTurn,
  retryConversationAssistantPreparation,
  removeConversationAssistantContextAttachment,
  retryConversationAssistantContextAttachment,
  retryConversationAssistantTurnAnswer,
  resumeConversationAssistantTurnRequest,
} from '@/services/conversationAssistantApi';
import { listPrivateWhatsAppChats } from '@/services/whatsappApi';
import { ApiError } from '@/services/apiClient.js';
import type {
  ConversationAssistantContextResponse,
  ConversationAssistantContextAttachmentPreviewResponse,
  ConversationAssistantContextHistoryResponse,
  ConversationAssistantStreamEvent,
  CreateConversationAssistantSessionRequest,
  ConversationAssistantSession,
  ConversationAssistantTurn,
  SendConversationAssistantTurnRequest,
  PrivateWhatsAppChat,
} from '@/types';
import {
  clearConversationAssistantDraft,
  decideConversationAssistantDraftOwnership,
  getConversationAssistantDraftStorageKey,
  loadConversationAssistantDraft,
  saveConversationAssistantDraft,
  type ConversationAssistantDraftIdentity,
  type ConversationAssistantDraftRecord,
} from '@/utils/conversationAssistantDraftStorage.js';
import {
  createConversationAssistantAttachmentState,
  reduceConversationAssistantAttachmentState,
  type ConversationAssistantAttachmentDto,
  type ConversationAssistantAttachmentState,
} from '@/utils/conversationAssistantAttachmentState.js';

const CHAT_PAGE_SIZE = 100;
const PENDING_CREATION_STORAGE_KEY = 'whatsapp-conversation-assistant-pending-creation';
const CREATION_RECOVERY_DELAYS_MS = [0, 250, 750, 1500] as const;
const PREPARATION_RECOVERY_DELAYS_MS = [0, 400, 1200, 3000, 5000] as const;
const DURABLE_TURN_POLL_DELAYS_MS = [0, 500, 1000, 2000, 4000, 5000] as const;
const BEST_EFFORT_RECONCILIATION_TIMEOUT_MS = 750;
const MESSAGE_NOT_SENT_ERROR = 'Message was not sent. Your draft was kept. Try again.';
const PLAIN_CONTEXT_WINDOW_ERROR =
  'The selected conversation context does not fit this model. Create a smaller analysis with a shorter date range. Your draft was kept.';
const ACKNOWLEDGED_TURN_RECOVERY_ERROR =
  'The live response was interrupted. Checking the saved answer.';
const REQUEST_BODY_CONFLICT_ERROR =
  'This message conflicted with another saved request. Your draft was kept. Try again.';

type DefinitivePreCommitAttachmentRejection =
  | 'ATTACHMENT_NOT_READY'
  | 'CONTEXT_STALE'
  | 'CONFIRMATION_REQUIRED';
type AttachmentReconciliationReason = DefinitivePreCommitAttachmentRejection | 'NOT_FOUND';

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as Record<string, unknown>)['code'] === code;
}

function getDefinitivePreCommitAttachmentRejection(
  error: unknown
): DefinitivePreCommitAttachmentRejection | null {
  if (hasErrorCode(error, 'ATTACHMENT_NOT_READY')) return 'ATTACHMENT_NOT_READY';
  if (hasErrorCode(error, 'CONTEXT_STALE')) return 'CONTEXT_STALE';
  if (hasErrorCode(error, 'CONFIRMATION_REQUIRED')) return 'CONFIRMATION_REQUIRED';
  return null;
}

function isAttachmentExpiredAt(
  attachment: ConversationAssistantAttachmentDto,
  nowMs: number
): boolean {
  if (attachment.expiresAt === undefined) return false;
  const expiresAtMs = Date.parse(attachment.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isAmbiguousRequestFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

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

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
  const hasChatId = typeof request['chatId'] === 'string';
  const hasSourceSessionId = typeof request['sourceSessionId'] === 'string';
  return (
    typeof request['requestId'] === 'string' &&
    hasChatId !== hasSourceSessionId &&
    typeof request['from'] === 'string' &&
    Number.isFinite(Date.parse(request['from'])) &&
    typeof request['to'] === 'string' &&
    Number.isFinite(Date.parse(request['to'])) &&
    (request['model'] === undefined ||
      (typeof request['model'] === 'string' && isConversationAssistantModel(request['model']))) &&
    (request['displayTimeZone'] === undefined || typeof request['displayTimeZone'] === 'string')
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

function mergeConversationAssistantTurns(
  current: ConversationAssistantTurn[],
  incoming: ConversationAssistantTurn[]
): ConversationAssistantTurn[] {
  const byId = new Map(current.map((turn) => [turn.id, turn]));
  for (const turn of incoming) byId.set(turn.id, turn);
  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== undefined && right.sequence !== undefined) {
      return left.sequence - right.sequence;
    }
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

interface DurableTurnReplayIntent {
  sessionId: string;
  requestId: string;
  question: string;
  contextAttachmentId?: string;
  exactRequest?: SendConversationAssistantTurnRequest;
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
  pendingContextAttachment: ConversationAssistantAttachmentState;
  contextAttachmentRequestPhase: ConversationAssistantContextAttachmentRequestPhase;
  contextAttachmentWarningAcknowledged: boolean;
  contextContinuationState: 'available' | 'legacy_session' | 'source_unavailable';
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
  includeNewMessages: () => Promise<void>;
  refreshContextAttachment: () => Promise<void>;
  retryContextAttachment: () => Promise<void>;
  removeContextAttachment: () => Promise<void>;
  keepCurrentContextAttachment: () => void;
  acknowledgeContextAttachmentWarning: () => void;
  loadContextAttachmentPreview: (
    cursor?: string
  ) => Promise<ConversationAssistantContextAttachmentPreviewResponse | null>;
  loadContextSnapshotPreview: (
    attachmentId: string,
    cursor?: string
  ) => Promise<ConversationAssistantContextAttachmentPreviewResponse | null>;
  loadContextHistory: () => Promise<ConversationAssistantContextHistoryResponse | null>;
  retryTurnAnswer: (requestId: string) => Promise<void>;
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
  | 'restoring'
  | 'submitting'
  | 'waiting'
  | 'streaming';

export type ConversationAssistantContextAttachmentRequestPhase =
  | 'idle'
  | 'include'
  | 'refresh'
  | 'retry'
  | 'remove';

export interface UseWhatsAppConversationAssistantOptions {
  sessionId?: string;
  loadChats?: boolean;
  loadSessions?: boolean;
  sourceSessionId?: string;
  initialFrom?: string;
  initialTo?: string;
  initialModel?: ConversationAssistantModel;
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
  const { getAccessToken, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSessionId = typeof input === 'string' ? input : input?.sessionId;
  const loadChats = typeof input === 'string' ? true : (input?.loadChats ?? true);
  const loadSessions = typeof input === 'string' ? true : (input?.loadSessions ?? true);
  const sourceSessionId = typeof input === 'string' ? undefined : input?.sourceSessionId;
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
  const attachmentAbortRef = useRef<AbortController | null>(null);
  const attachmentPreviewAbortRef = useRef<AbortController | null>(null);
  const attachmentPreviewRequestIdRef = useRef(0);
  const preparationRecoveryGenerationRef = useRef(0);
  const attachmentRequestPhaseRef =
    useRef<ConversationAssistantContextAttachmentRequestPhase>('idle');
  const sendAbortRef = useRef<AbortController | null>(null);
  const turnRecoveryRequestIdRef = useRef<string | undefined>(undefined);
  const turnRecoveryHasPersistedUserTurnRef = useRef(false);
  const turnRecoveryGenerationRef = useRef(0);
  const durableTurnReplayIntentRef = useRef<DurableTurnReplayIntent | null>(null);
  const draftIdentityRef = useRef<ConversationAssistantDraftIdentity | null>(null);
  const draftRecordRef = useRef<ConversationAssistantDraftRecord | null>(null);
  const preparationRequestIdRef = useRef<string | undefined>(undefined);
  const locallyCancelledPreparationRequestIdsRef = useRef(new Set<string>());
  const replacesAttachmentIdRef = useRef<string | undefined>(undefined);
  const attachmentIdRef = useRef<string | undefined>(undefined);
  const attachmentExpiresAtRef = useRef<string | undefined>(undefined);
  const startedTurnRequestIdRef = useRef<string | undefined>(undefined);
  const warningAcknowledgedRef = useRef(false);
  const runtimeOwnerNonceRef = useRef(newCreationRequestId());

  const [defaultRange] = useState(() => {
    const fallback = getDefaultRange();
    if (typeof input === 'string') return fallback;
    return {
      from:
        input?.initialFrom !== undefined && Number.isFinite(Date.parse(input.initialFrom))
          ? toDateTimeLocalValue(new Date(input.initialFrom))
          : fallback.from,
      to:
        input?.initialTo !== undefined && Number.isFinite(Date.parse(input.initialTo))
          ? toDateTimeLocalValue(new Date(input.initialTo))
          : fallback.to,
    };
  });
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
  const [selectedModel, setSelectedModel] = useState<ConversationAssistantModel>(() =>
    typeof input !== 'string' && input?.initialModel !== undefined
      ? input.initialModel
      : DEFAULT_CONVERSATION_ASSISTANT_MODEL
  );
  const [fromDateTimeLocal, setFromDateTimeLocalState] = useState(defaultRange.from);
  const [toDateTimeLocal, setToDateTimeLocalState] = useState(defaultRange.to);
  const [followUpQuestion, setFollowUpQuestionState] = useState('');
  const followUpQuestionRef = useRef('');
  followUpQuestionRef.current = followUpQuestion;
  const [pendingContextAttachment, dispatchContextAttachment] = useReducer(
    reduceConversationAssistantAttachmentState,
    selectedSessionId ?? '',
    createConversationAssistantAttachmentState
  );
  const pendingContextAttachmentRef = useRef(pendingContextAttachment);
  pendingContextAttachmentRef.current = pendingContextAttachment;
  const [contextAttachmentRequestPhase, setContextAttachmentRequestPhase] =
    useState<ConversationAssistantContextAttachmentRequestPhase>('idle');
  const [contextAttachmentWarningAcknowledged, setContextAttachmentWarningAcknowledged] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingMoreContext, setLoadingMoreContext] = useState(false);
  const [creating, setCreating] = useState(false);
  const [turnPhase, setTurnPhase] = useState<ConversationAssistantTurnPhase>('idle');
  const [recoveringTurnRequestId, setRecoveringTurnRequestId] = useState<string | undefined>(
    undefined
  );
  const [retryingPreparation, setRetryingPreparation] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    preparationRecoveryGenerationRef.current += 1;
    turnRecoveryGenerationRef.current += 1;
    turnRecoveryRequestIdRef.current = undefined;
    turnRecoveryHasPersistedUserTurnRef.current = false;
    durableTurnReplayIntentRef.current = null;
    setRecoveringTurnRequestId(undefined);
    attachmentAbortRef.current?.abort();
    attachmentAbortRef.current = null;
    attachmentPreviewRequestIdRef.current += 1;
    attachmentPreviewAbortRef.current?.abort();
    attachmentPreviewAbortRef.current = null;
    attachmentRequestPhaseRef.current = 'idle';
    setContextAttachmentRequestPhase('idle');
    sendAbortRef.current?.abort();
    sendAbortRef.current = null;
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
    followUpQuestionRef.current = '';
    setFollowUpQuestionState('');
    draftRecordRef.current = null;
    preparationRequestIdRef.current = undefined;
    replacesAttachmentIdRef.current = undefined;
    attachmentIdRef.current = undefined;
    attachmentExpiresAtRef.current = undefined;
    startedTurnRequestIdRef.current = undefined;
    warningAcknowledgedRef.current = false;
    setContextAttachmentWarningAcknowledged(false);
    dispatchContextAttachment({ type: 'reset', sessionId: selectedSessionId ?? '' });
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

  const contextContinuationState = useMemo<
    'available' | 'legacy_session' | 'source_unavailable'
  >(
    () => selectedSession?.contextSummary.availability.state ?? 'legacy_session',
    [selectedSession?.contextSummary.availability.state]
  );

  const persistCurrentDraft = useCallback(
    (
      question: string,
      attachmentExpiresAt?: string,
      preserveLastEdit = false
    ): void => {
      const identity = draftIdentityRef.current;
      if (identity === null) return;
      const lastEditedAt = preserveLastEdit ? draftRecordRef.current?.savedAt : undefined;
      draftRecordRef.current = saveConversationAssistantDraft(
        globalThis.sessionStorage,
        identity,
        {
          question,
          ...(preparationRequestIdRef.current === undefined
            ? {}
            : { preparationRequestId: preparationRequestIdRef.current }),
          ...(replacesAttachmentIdRef.current === undefined
            ? {}
            : { replacesAttachmentId: replacesAttachmentIdRef.current }),
          ...(attachmentIdRef.current === undefined
            ? {}
            : { attachmentId: attachmentIdRef.current }),
          ...(startedTurnRequestIdRef.current === undefined
            ? {}
            : { startedTurnRequestId: startedTurnRequestIdRef.current }),
          warningAcknowledged: warningAcknowledgedRef.current,
        },
        {
          ...(attachmentExpiresAt === undefined ? {} : { attachmentExpiresAt }),
          ...(lastEditedAt === undefined ? {} : { lastEditedAt }),
        }
      );
    },
    []
  );

  const resolvePreparationIntent = useCallback(
    async ({
      sessionId,
      requestId,
      replacesAttachmentId,
      requestPhase,
      fallbackAttachment,
    }: {
      sessionId: string;
      requestId: string;
      replacesAttachmentId?: string;
      requestPhase: 'include' | 'refresh';
      fallbackAttachment?: ConversationAssistantAttachmentDto;
    }): Promise<void> => {
      const generation = preparationRecoveryGenerationRef.current + 1;
      preparationRecoveryGenerationRef.current = generation;
      attachmentRequestPhaseRef.current = requestPhase;
      setContextAttachmentRequestPhase(requestPhase);
      let failureCount = 0;

      const isCurrentIntent = (): boolean =>
        selectedSessionIdRef.current === sessionId &&
        preparationRecoveryGenerationRef.current === generation &&
        preparationRequestIdRef.current === requestId;

      while (isCurrentIntent()) {
        const controller = new AbortController();
        attachmentAbortRef.current?.abort();
        attachmentAbortRef.current = controller;
        try {
          const token = await getAccessToken();
          const attachment = await createConversationAssistantContextAttachment(
            token,
            sessionId,
            {
              requestId,
              ...(replacesAttachmentId === undefined ? {} : { replacesAttachmentId }),
            },
            controller.signal
          );
          if (controller.signal.aborted || !isCurrentIntent()) {
            // Ownership handoff may supersede a resolver whose deterministic attachment is
            // still used by another tab. Only an explicit local Remove owns cleanup.
            if (locallyCancelledPreparationRequestIdsRef.current.delete(requestId)) {
              try {
                await removeConversationAssistantContextAttachment(
                  token,
                  sessionId,
                  attachment.id
                );
              } catch {
                // Best-effort cleanup must never restore a locally removed attachment.
              }
            }
            return;
          }

          preparationRequestIdRef.current = undefined;
          replacesAttachmentIdRef.current = undefined;
          attachmentIdRef.current = attachment.id;
          attachmentExpiresAtRef.current = attachment.expiresAt;
          dispatchContextAttachment({ type: 'track_attachment', sessionId, attachment });
          persistCurrentDraft(followUpQuestionRef.current, attachment.expiresAt, true);
          setError(null);
          attachmentRequestPhaseRef.current = 'idle';
          setContextAttachmentRequestPhase('idle');
          return;
        } catch (prepareError) {
          if (
            controller.signal.aborted ||
            !isCurrentIntent() ||
            (prepareError instanceof Error && prepareError.name === 'AbortError')
          ) {
            locallyCancelledPreparationRequestIdsRef.current.delete(requestId);
            return;
          }

          if (!isAmbiguousRequestFailure(prepareError)) {
            preparationRequestIdRef.current = undefined;
            replacesAttachmentIdRef.current = undefined;
            if (fallbackAttachment === undefined) {
              attachmentIdRef.current = undefined;
              attachmentExpiresAtRef.current = undefined;
              dispatchContextAttachment({ type: 'reset', sessionId });
              persistCurrentDraft(followUpQuestionRef.current, undefined, true);
            } else {
              attachmentIdRef.current = fallbackAttachment.id;
              attachmentExpiresAtRef.current = fallbackAttachment.expiresAt;
              dispatchContextAttachment({
                type: 'track_attachment',
                sessionId,
                attachment: fallbackAttachment,
              });
              persistCurrentDraft(
                followUpQuestionRef.current,
                fallbackAttachment.expiresAt,
                true
              );
            }
            attachmentRequestPhaseRef.current = 'idle';
            setContextAttachmentRequestPhase('idle');
            setError(getErrorMessage(prepareError, 'Failed to prepare WhatsApp context update'));
            return;
          }

          dispatchContextAttachment({ type: 'begin_restoring', sessionId });
          setError('Confirming the WhatsApp context update. Your question is safe.');
          const delay =
            PREPARATION_RECOVERY_DELAYS_MS[
              Math.min(failureCount, PREPARATION_RECOVERY_DELAYS_MS.length - 1)
            ] ?? 5000;
          failureCount += 1;
          if (delay > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, delay);
            });
          }
        } finally {
          if (attachmentAbortRef.current === controller) attachmentAbortRef.current = null;
        }
      }
    },
    [getAccessToken, persistCurrentDraft]
  );

  const beginTurnRecovery = useCallback(
    (sessionId: string, requestId: string, persistedUserTurn = false): void => {
      if (selectedSessionIdRef.current !== sessionId) return;
      turnRecoveryRequestIdRef.current = requestId;
      turnRecoveryHasPersistedUserTurnRef.current = persistedUserTurn;
      setRecoveringTurnRequestId(requestId);
      sendInFlightRef.current = true;
      setTurnPhase(persistedUserTurn ? 'waiting' : 'restoring');
    },
    []
  );

  const isCommittedAttachmentOwnedByActiveRequest = useCallback(
    (
      sessionId: string,
      attachment: ConversationAssistantAttachmentDto
    ): boolean => {
      if (attachment.status !== 'committed') return false;
      const startedRequestId = startedTurnRequestIdRef.current;
      const replayIntent = durableTurnReplayIntentRef.current;
      return (
        startedRequestId !== undefined &&
        replayIntent?.sessionId === sessionId &&
        replayIntent.requestId === startedRequestId &&
        replayIntent.contextAttachmentId === attachment.id
      );
    },
    []
  );

  const releaseConflictingTurnRequest = useCallback(
    (sessionId: string, requestId: string): void => {
      if (selectedSessionIdRef.current !== sessionId) return;
      if (startedTurnRequestIdRef.current === requestId) {
        startedTurnRequestIdRef.current = undefined;
      }
      if (
        durableTurnReplayIntentRef.current?.sessionId === sessionId &&
        durableTurnReplayIntentRef.current.requestId === requestId
      ) {
        durableTurnReplayIntentRef.current = null;
      }
      persistCurrentDraft(
        followUpQuestionRef.current,
        attachmentExpiresAtRef.current,
        true
      );
      setError(REQUEST_BODY_CONFLICT_ERROR);
    },
    [persistCurrentDraft]
  );

  const reconcileDefinitiveAttachmentRejection = useCallback(
    async ({
      sessionId,
      attachmentId,
      requestId,
      reason,
      signal,
    }: {
      sessionId: string;
      attachmentId: string;
      requestId: string;
      reason: AttachmentReconciliationReason;
      signal?: AbortSignal;
    }): Promise<void> => {
      if (selectedSessionIdRef.current !== sessionId || isAbortSignalAborted(signal)) return;
      if (startedTurnRequestIdRef.current === requestId) {
        startedTurnRequestIdRef.current = undefined;
      }
      if (
        durableTurnReplayIntentRef.current?.sessionId === sessionId &&
        durableTurnReplayIntentRef.current.requestId === requestId
      ) {
        durableTurnReplayIntentRef.current = null;
      }
      if (reason === 'CONFIRMATION_REQUIRED') {
        warningAcknowledgedRef.current = false;
        setContextAttachmentWarningAcknowledged(false);
      }

      try {
        const token = await getAccessToken();
        const attachment = await getConversationAssistantContextAttachment(
          token,
          sessionId,
          attachmentId,
          signal
        );
        if (selectedSessionIdRef.current !== sessionId || isAbortSignalAborted(signal)) return;
        attachmentExpiresAtRef.current = attachment.expiresAt;
        dispatchContextAttachment({
          type: 'attachment_status_received',
          sessionId,
          attachment,
        });
        if (
          attachment.status === 'ready' &&
          (reason === 'ATTACHMENT_NOT_READY' || reason === 'NOT_FOUND')
        ) {
          dispatchContextAttachment({
            type: 'recapture_required',
            sessionId,
            attachmentId,
          });
        }
        persistCurrentDraft(
          followUpQuestionRef.current,
          attachment.expiresAt,
          true
        );
      } catch (statusError) {
        if (
          selectedSessionIdRef.current !== sessionId ||
          isAbortSignalAborted(signal) ||
          (statusError instanceof Error && statusError.name === 'AbortError')
        ) {
          return;
        }
        attachmentExpiresAtRef.current = undefined;
        if (statusError instanceof ApiError && statusError.status === 404) {
          dispatchContextAttachment({
            type: 'restore_missing',
            sessionId,
            attachmentId,
          });
        } else {
          dispatchContextAttachment({
            type: 'restore_failed',
            sessionId,
            attachmentId,
            message:
              'The attachment status could not be confirmed yet. Your question is safe.',
          });
        }
        persistCurrentDraft(followUpQuestionRef.current, undefined, true);
      }
      setError(null);
    },
    [getAccessToken, persistCurrentDraft]
  );

  const handoffTurnInProgressRecovery = useCallback(
    async (sessionId: string, localRequestId: string): Promise<boolean> => {
      if (selectedSessionIdRef.current !== sessionId) return false;
      if (startedTurnRequestIdRef.current === localRequestId) {
        startedTurnRequestIdRef.current = undefined;
      }
      if (
        durableTurnReplayIntentRef.current?.sessionId === sessionId &&
        durableTurnReplayIntentRef.current.requestId === localRequestId
      ) {
        durableTurnReplayIntentRef.current = null;
      }
      persistCurrentDraft(
        followUpQuestionRef.current,
        attachmentExpiresAtRef.current,
        true
      );

      try {
        const token = await getAccessToken();
        const refreshedSession = await getConversationAssistantSession(token, sessionId);
        if (selectedSessionIdRef.current !== sessionId) return false;
        setSelectedSessionOverride(refreshedSession);
        setSessions((current) =>
          current.map((item) => (item.id === refreshedSession.id ? refreshedSession : item))
        );
        const authoritativeRequestId =
          refreshedSession.contextSummary.activeTurn?.requestId;
        if (authoritativeRequestId === undefined) {
          setError(MESSAGE_NOT_SENT_ERROR);
          return false;
        }
        beginTurnRecovery(sessionId, authoritativeRequestId, true);
        setError(ACKNOWLEDGED_TURN_RECOVERY_ERROR);
        return true;
      } catch (refreshError) {
        if (selectedSessionIdRef.current === sessionId) {
          setError(
            getErrorMessage(
              refreshError,
              'Could not refresh the active answer. Your draft is safe.'
            )
          );
        }
        return false;
      }
    },
    [beginTurnRecovery, getAccessToken, persistCurrentDraft]
  );

  const setFollowUpQuestion = useCallback(
    (value: string): void => {
      if (
        value === followUpQuestionRef.current ||
        startedTurnRequestIdRef.current !== undefined
      ) {
        return;
      }
      followUpQuestionRef.current = value;
      setFollowUpQuestionState(value);
      persistCurrentDraft(
        value,
        pendingContextAttachment.phase === 'idle' ||
          pendingContextAttachment.phase === 'preparing_intent' ||
          pendingContextAttachment.phase === 'restoring' ||
          pendingContextAttachment.phase === 'restore_failed' ||
          pendingContextAttachment.phase === 'missing'
          ? undefined
          : pendingContextAttachment.attachment.expiresAt
      );
    },
    [pendingContextAttachment, persistCurrentDraft]
  );

  useEffect(() => {
    if (selectedSessionId === undefined || selectedSession?.id !== selectedSessionId) return;
    const userId = user?.sub;
    const previousIdentity = draftIdentityRef.current;
    if (typeof userId !== 'string' || userId === '') {
      if (previousIdentity !== null) {
        clearConversationAssistantDraft(globalThis.sessionStorage, previousIdentity);
      }
      draftIdentityRef.current = null;
      return;
    }

    const identity: ConversationAssistantDraftIdentity = {
      origin: globalThis.location.origin,
      userId,
      sessionId: selectedSessionId,
    };
    if (
      previousIdentity !== null &&
      (previousIdentity.origin !== identity.origin ||
        previousIdentity.userId !== identity.userId ||
        previousIdentity.sessionId !== identity.sessionId)
    ) {
      clearConversationAssistantDraft(globalThis.sessionStorage, previousIdentity);
    }
    draftIdentityRef.current = identity;
    const stored = loadConversationAssistantDraft(globalThis.sessionStorage, identity);
    draftRecordRef.current = stored;
    dispatchContextAttachment({ type: 'reset', sessionId: selectedSessionId });
    if (stored === null) return;

    followUpQuestionRef.current = stored.question;
    setFollowUpQuestionState(stored.question);
    preparationRequestIdRef.current = stored.preparationRequestId;
    replacesAttachmentIdRef.current = stored.replacesAttachmentId;
    attachmentIdRef.current = stored.attachmentId;
    startedTurnRequestIdRef.current = stored.startedTurnRequestId;
    warningAcknowledgedRef.current = stored.warningAcknowledged;
    setContextAttachmentWarningAcknowledged(stored.warningAcknowledged);
    if (stored.startedTurnRequestId !== undefined) {
      const request: SendConversationAssistantTurnRequest = {
        requestId: stored.startedTurnRequestId,
        question: stored.question,
      };
      durableTurnReplayIntentRef.current = {
        sessionId: selectedSessionId,
        requestId: stored.startedTurnRequestId,
        question: stored.question,
        ...(stored.attachmentId === undefined
          ? { exactRequest: request }
          : { contextAttachmentId: stored.attachmentId }),
      };
      beginTurnRecovery(selectedSessionId, stored.startedTurnRequestId);
    }

    if (stored.preparationRequestId !== undefined && stored.attachmentId === undefined) {
      dispatchContextAttachment({ type: 'begin_restoring', sessionId: selectedSessionId });
      void resolvePreparationIntent({
        sessionId: selectedSessionId,
        requestId: stored.preparationRequestId,
        ...(stored.replacesAttachmentId === undefined
          ? {}
          : { replacesAttachmentId: stored.replacesAttachmentId }),
        requestPhase: stored.replacesAttachmentId === undefined ? 'include' : 'refresh',
      });
      return (): void => {
        preparationRecoveryGenerationRef.current += 1;
        attachmentAbortRef.current?.abort();
        attachmentAbortRef.current = null;
      };
    }

    const controller = new AbortController();
    attachmentAbortRef.current?.abort();
    attachmentAbortRef.current = controller;
    if (stored.attachmentId !== undefined) {
      dispatchContextAttachment({
        type: 'begin_restoring',
        sessionId: selectedSessionId,
        attachmentId: stored.attachmentId,
      });
    }

    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const attachment =
          stored.attachmentId === undefined
            ? null
            : await getConversationAssistantContextAttachment(
                token,
                selectedSessionId,
                stored.attachmentId,
                controller.signal
              );
        if (controller.signal.aborted || selectedSessionIdRef.current !== selectedSessionId) return;

        if (attachment !== null) {
          attachmentExpiresAtRef.current = attachment.expiresAt;
          const replayIntent = durableTurnReplayIntentRef.current;
          if (
            stored.startedTurnRequestId !== undefined &&
            replayIntent?.sessionId === selectedSessionId &&
            replayIntent.requestId === stored.startedTurnRequestId &&
            replayIntent.contextAttachmentId === attachment.id &&
            (!attachment.requiresConfirmation || attachment.confirmationToken !== undefined)
          ) {
            replayIntent.exactRequest = {
              requestId: replayIntent.requestId,
              question: replayIntent.question,
              contextAttachmentId: attachment.id,
              ...(attachment.requiresConfirmation && attachment.confirmationToken !== undefined
                ? { confirmationToken: attachment.confirmationToken }
                : {}),
            };
          }
          if (
            !isCommittedAttachmentOwnedByActiveRequest(
              selectedSessionId,
              attachment
            )
          ) {
            dispatchContextAttachment({
              type: 'attachment_status_received',
              sessionId: selectedSessionId,
              attachment,
            });
          }
          persistCurrentDraft(stored.question, attachment.expiresAt, true);
        }
      } catch (restoreError) {
        if (
          !controller.signal.aborted &&
          selectedSessionIdRef.current === selectedSessionId &&
          !(restoreError instanceof Error && restoreError.name === 'AbortError')
        ) {
          if (stored.attachmentId !== undefined) {
            if (restoreError instanceof ApiError && restoreError.status === 404) {
              dispatchContextAttachment({
                type: 'restore_missing',
                sessionId: selectedSessionId,
                attachmentId: stored.attachmentId,
              });
            } else {
              dispatchContextAttachment({
                type: 'restore_failed',
                sessionId: selectedSessionId,
                attachmentId: stored.attachmentId,
                message:
                  'This WhatsApp context update could not be restored yet. Your question is safe.',
              });
            }
          }
          setError(null);
        }
      }
    })();

    return (): void => {
      controller.abort();
      if (attachmentAbortRef.current === controller) attachmentAbortRef.current = null;
    };
  }, [
    beginTurnRecovery,
    getAccessToken,
    isCommittedAttachmentOwnedByActiveRequest,
    persistCurrentDraft,
    resolvePreparationIntent,
    selectedSession?.id,
    selectedSessionId,
    user?.sub,
  ]);

  useEffect(() => {
    const activeTurn = selectedSession?.contextSummary.activeTurn;
    if (
      activeTurn === null ||
      activeTurn === undefined ||
      selectedSessionId === undefined ||
      selectedSession?.id !== selectedSessionId ||
      turnRecoveryRequestIdRef.current === activeTurn.requestId
    ) {
      return;
    }
    beginTurnRecovery(selectedSessionId, activeTurn.requestId, true);
  }, [
    beginTurnRecovery,
    selectedSession?.contextSummary.activeTurn,
    selectedSession?.id,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (recoveringTurnRequestId === undefined || selectedSessionId === undefined) return;
    const sessionId = selectedSessionId;
    const requestId = recoveringTurnRequestId;
    const generation = turnRecoveryGenerationRef.current + 1;
    turnRecoveryGenerationRef.current = generation;
    let cancelled = false;
    let retryTimeoutId: number | undefined;
    let controller: AbortController | undefined;
    let pollAttempt = 0;

    const isCurrentRecovery = (): boolean =>
      !cancelled &&
      selectedSessionIdRef.current === sessionId &&
      turnRecoveryGenerationRef.current === generation &&
      turnRecoveryRequestIdRef.current === requestId;
    const scheduleRetry = (): void => {
      if (!isCurrentRecovery()) return;
      const delay =
        DURABLE_TURN_POLL_DELAYS_MS[
          Math.min(pollAttempt, DURABLE_TURN_POLL_DELAYS_MS.length - 1)
        ] ?? 5000;
      pollAttempt += 1;
      retryTimeoutId = window.setTimeout(() => void poll(), delay);
    };
    const clearSubmittedDraft = (persistedUserTurn: boolean): void => {
      if (persistedUserTurn) {
        turnRecoveryHasPersistedUserTurnRef.current = true;
      }
      if (
        !persistedUserTurn ||
        draftRecordRef.current?.startedTurnRequestId !== requestId
      ) {
        return;
      }
      const identity = draftIdentityRef.current;
      if (identity !== null) clearConversationAssistantDraft(globalThis.sessionStorage, identity);
      draftRecordRef.current = null;
      preparationRequestIdRef.current = undefined;
      replacesAttachmentIdRef.current = undefined;
      attachmentIdRef.current = undefined;
      attachmentExpiresAtRef.current = undefined;
      startedTurnRequestIdRef.current = undefined;
      warningAcknowledgedRef.current = false;
      setContextAttachmentWarningAcknowledged(false);
      followUpQuestionRef.current = '';
      setFollowUpQuestionState('');
      dispatchContextAttachment({ type: 'reset', sessionId });
    };
    const finishRecovery = (): void => {
      if (!isCurrentRecovery()) return;
      if (
        durableTurnReplayIntentRef.current?.sessionId === sessionId &&
        durableTurnReplayIntentRef.current.requestId === requestId
      ) {
        durableTurnReplayIntentRef.current = null;
      }
      turnRecoveryRequestIdRef.current = undefined;
      turnRecoveryHasPersistedUserTurnRef.current = false;
      setRecoveringTurnRequestId(undefined);
      sendInFlightRef.current = false;
      setTurnPhase('idle');
    };
    const releaseUnstartedRequest = (): void => {
      if (!isCurrentRecovery()) return;
      if (startedTurnRequestIdRef.current === requestId) {
        startedTurnRequestIdRef.current = undefined;
        persistCurrentDraft(
          followUpQuestionRef.current,
          attachmentExpiresAtRef.current,
          true
        );
      }
      finishRecovery();
      setError(MESSAGE_NOT_SENT_ERROR);
    };
    const finishContextWindowRejection = (rejectedAttachmentId?: string): void => {
      if (!isCurrentRecovery()) return;
      if (startedTurnRequestIdRef.current === requestId) {
        startedTurnRequestIdRef.current = undefined;
      }
      if (rejectedAttachmentId !== undefined) {
        dispatchContextAttachment({
          type: 'hard_limit_rejected',
          sessionId,
          attachmentId: rejectedAttachmentId,
        });
      }
      persistCurrentDraft(
        followUpQuestionRef.current,
        attachmentExpiresAtRef.current,
        true
      );
      finishRecovery();
      setError(rejectedAttachmentId === undefined ? PLAIN_CONTEXT_WINDOW_ERROR : null);
    };
    const resolveExactReplayRequest = async (
      token: string,
      signal: AbortSignal
    ): Promise<SendConversationAssistantTurnRequest | null> => {
      const intent = durableTurnReplayIntentRef.current;
      if (intent?.sessionId !== sessionId || intent.requestId !== requestId) {
        return null;
      }
      if (intent.exactRequest !== undefined) return intent.exactRequest;
      if (intent.contextAttachmentId === undefined) {
        const exactRequest = { requestId, question: intent.question };
        intent.exactRequest = exactRequest;
        return exactRequest;
      }

      const attachment = await getConversationAssistantContextAttachment(
        token,
        sessionId,
        intent.contextAttachmentId,
        signal
      );
      if (!isCurrentRecovery()) return null;
      if (attachment.requiresConfirmation && attachment.confirmationToken === undefined) {
        throw new Error('The attachment confirmation could not be restored safely');
      }
      const exactRequest: SendConversationAssistantTurnRequest = {
        requestId,
        question: intent.question,
        contextAttachmentId: intent.contextAttachmentId,
        ...(attachment.requiresConfirmation && attachment.confirmationToken !== undefined
          ? { confirmationToken: attachment.confirmationToken }
          : {}),
      };
      intent.exactRequest = exactRequest;
      return exactRequest;
    };
    const replayMissingRequest = async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        if (!isCurrentRecovery() || controller === undefined) return;
        const exactRequest = await resolveExactReplayRequest(token, controller.signal);
        if (!isCurrentRecovery()) return;
        if (exactRequest === null) {
          setTurnPhase('restoring');
          setError('Checking whether your message was saved. Your draft is safe.');
          scheduleRetry();
          return;
        }
        const replay = await sendConversationAssistantTurn(
          token,
          sessionId,
          exactRequest,
          controller.signal
        );
        if (!isCurrentRecovery()) return;
        setTurns((current) => mergeConversationAssistantTurns(current, replay.turns));
        const [refreshedSession, refreshedTurns] = await Promise.all([
          getConversationAssistantSession(token, sessionId),
          listConversationAssistantTurns(token, sessionId),
        ]);
        if (!isCurrentRecovery()) return;
        const replayHasUserTurn = replay.turns.some(
          (turn) => turn.requestId === requestId && turn.role === 'user'
        );
        const fullHistoryHasUserTurn = refreshedTurns.turns.some(
          (turn) => turn.requestId === requestId && turn.role === 'user'
        );
        setSelectedSessionOverride(refreshedSession);
        setSessions((current) =>
          current.map((item) => (item.id === refreshedSession.id ? refreshedSession : item))
        );
        setTurns((current) =>
          mergeConversationAssistantTurns(
            mergeConversationAssistantTurns(current, replay.turns),
            refreshedTurns.turns
          )
        );
        if (!replayHasUserTurn && !fullHistoryHasUserTurn) {
          setTurnPhase('restoring');
          setError('Checking whether your message was saved. Your draft is safe.');
          scheduleRetry();
          return;
        }
        clearSubmittedDraft(true);
        setError(null);
        finishRecovery();
      } catch (replayError) {
        if (!isCurrentRecovery()) return;
        if (replayError instanceof Error && replayError.name === 'AbortError') return;
        const rejectedAttachmentId =
          durableTurnReplayIntentRef.current?.contextAttachmentId;
        const definitiveAttachmentRejection =
          getDefinitivePreCommitAttachmentRejection(replayError);
        if (hasErrorCode(replayError, 'REQUEST_BODY_CONFLICT')) {
          releaseConflictingTurnRequest(sessionId, requestId);
          if (!isCurrentRecovery()) return;
          finishRecovery();
          return;
        }
        if (
          rejectedAttachmentId !== undefined &&
          controller !== undefined &&
          definitiveAttachmentRejection !== null
        ) {
          await reconcileDefinitiveAttachmentRejection({
            sessionId,
            attachmentId: rejectedAttachmentId,
            requestId,
            reason: definitiveAttachmentRejection,
            signal: controller.signal,
          });
          if (!isCurrentRecovery()) return;
          setError(null);
          finishRecovery();
          return;
        }
        if (hasErrorCode(replayError, 'CONTEXT_WINDOW_EXCEEDED')) {
          finishContextWindowRejection(rejectedAttachmentId);
          return;
        }
        if (hasErrorCode(replayError, 'TURN_IN_PROGRESS')) {
          const handedOff = await handoffTurnInProgressRecovery(sessionId, requestId);
          if (handedOff || !isCurrentRecovery()) return;
          finishRecovery();
          return;
        }
        if (replayError instanceof ApiError && replayError.status === 404) {
          if (rejectedAttachmentId !== undefined && controller !== undefined) {
            await reconcileDefinitiveAttachmentRejection({
              sessionId,
              attachmentId: rejectedAttachmentId,
              requestId,
              reason: 'NOT_FOUND',
              signal: controller.signal,
            });
            if (!isCurrentRecovery()) return;
            finishRecovery();
            return;
          }
          releaseUnstartedRequest();
          return;
        }
        setTurnPhase('restoring');
        setError('Checking whether your message was saved. Your draft is safe.');
        scheduleRetry();
      }
    };
    const refreshPreservedDraftAttachment = async (
      token: string,
      signal: AbortSignal
    ): Promise<void> => {
      const draft = draftRecordRef.current;
      if (
        draft?.startedTurnRequestId !== undefined ||
        draft?.attachmentId === undefined
      ) {
        return;
      }
      const preservedAttachmentId = draft.attachmentId;
      try {
        const attachment = await getConversationAssistantContextAttachment(
          token,
          sessionId,
          preservedAttachmentId,
          signal
        );
        if (!isCurrentRecovery()) return;
        attachmentExpiresAtRef.current = attachment.expiresAt;
        dispatchContextAttachment({
          type: 'attachment_status_received',
          sessionId,
          attachment,
        });
        persistCurrentDraft(
          followUpQuestionRef.current,
          attachment.expiresAt,
          true
        );
      } catch (attachmentStatusError) {
        if (!isCurrentRecovery()) return;
        if (
          attachmentStatusError instanceof Error &&
          attachmentStatusError.name === 'AbortError'
        ) {
          return;
        }
        if (
          attachmentStatusError instanceof ApiError &&
          attachmentStatusError.status === 404
        ) {
          attachmentExpiresAtRef.current = undefined;
          dispatchContextAttachment({
            type: 'restore_missing',
            sessionId,
            attachmentId: preservedAttachmentId,
          });
          persistCurrentDraft(followUpQuestionRef.current, undefined, true);
        }
      }
    };
    const poll = async (): Promise<void> => {
      controller = new AbortController();
      try {
        const token = await getAccessToken();
        let response = await getConversationAssistantTurnRequest(
          token,
          sessionId,
          requestId,
          controller.signal
        );
        if (!isCurrentRecovery()) return;
        setTurns((current) => mergeConversationAssistantTurns(current, response.turns));
        let persistedUserTurn = response.turns.some((turn) => turn.role === 'user');
        clearSubmittedDraft(persistedUserTurn);
        if (response.request.status === 'in_progress') {
          response = await resumeConversationAssistantTurnRequest(
            token,
            sessionId,
            requestId,
            controller.signal
          );
          if (!isCurrentRecovery()) return;
          setTurns((current) => mergeConversationAssistantTurns(current, response.turns));
          persistedUserTurn =
            persistedUserTurn || response.turns.some((turn) => turn.role === 'user');
          clearSubmittedDraft(persistedUserTurn);
          if (response.request.status === 'in_progress') {
            setError(null);
            setTurnPhase(
              persistedUserTurn || turnRecoveryHasPersistedUserTurnRef.current
                ? 'waiting'
                : 'restoring'
            );
            scheduleRetry();
            return;
          }
        }

        const [refreshedSession, refreshedTurns] = await Promise.all([
          getConversationAssistantSession(token, sessionId),
          listConversationAssistantTurns(token, sessionId),
        ]);
        if (!isCurrentRecovery()) return;
        setSelectedSessionOverride(refreshedSession);
        setSessions((current) =>
          current.map((item) => (item.id === refreshedSession.id ? refreshedSession : item))
        );
        setTurns(refreshedTurns.turns);
        const fullHistoryHasUserTurn = refreshedTurns.turns.some(
          (turn) => turn.requestId === requestId && turn.role === 'user'
        );
        clearSubmittedDraft(persistedUserTurn || fullHistoryHasUserTurn);
        await refreshPreservedDraftAttachment(token, controller.signal);
        if (!isCurrentRecovery()) return;
        let terminalRecoveryError: string | null = null;
        if (!persistedUserTurn && !fullHistoryHasUserTurn) {
          if (response.request.error?.code === 'CONTEXT_WINDOW_EXCEEDED') {
            if (attachmentIdRef.current !== undefined) {
              const rejectedAttachmentId = attachmentIdRef.current;
              startedTurnRequestIdRef.current = undefined;
              dispatchContextAttachment({
                type: 'hard_limit_rejected',
                sessionId,
                attachmentId: rejectedAttachmentId,
              });
              persistCurrentDraft(
                followUpQuestionRef.current,
                attachmentExpiresAtRef.current,
                true
              );
            } else {
              startedTurnRequestIdRef.current = undefined;
              persistCurrentDraft(followUpQuestionRef.current, undefined, true);
              terminalRecoveryError = PLAIN_CONTEXT_WINDOW_ERROR;
            }
          } else if (startedTurnRequestIdRef.current === requestId) {
            startedTurnRequestIdRef.current = undefined;
            persistCurrentDraft(
              followUpQuestionRef.current,
              attachmentExpiresAtRef.current,
              true
            );
          }
        }
        setError(terminalRecoveryError);
        finishRecovery();
      } catch (pollError) {
        if (!isCurrentRecovery()) return;
        if (pollError instanceof Error && pollError.name === 'AbortError') return;
        if (pollError instanceof ApiError && pollError.status === 404) {
          await replayMissingRequest();
          return;
        }
        const persistedUserTurn = turnRecoveryHasPersistedUserTurnRef.current;
        setTurnPhase(persistedUserTurn ? 'waiting' : 'restoring');
        setError(
          persistedUserTurn
            ? ACKNOWLEDGED_TURN_RECOVERY_ERROR
            : 'Checking whether your message was saved. Your draft is safe.'
        );
        scheduleRetry();
      }
    };

    scheduleRetry();
    return (): void => {
      cancelled = true;
      controller?.abort();
      if (retryTimeoutId !== undefined) window.clearTimeout(retryTimeoutId);
    };
  }, [
    getAccessToken,
    handoffTurnInProgressRecovery,
    persistCurrentDraft,
    reconcileDefinitiveAttachmentRejection,
    releaseConflictingTurnRequest,
    recoveringTurnRequestId,
    selectedSessionId,
  ]);

  useEffect(() => {
    const identity = draftIdentityRef.current;
    if (identity === null || typeof globalThis.BroadcastChannel !== 'function') return;
    const channel = new BroadcastChannel(
      `intexuraos:conversation-assistant:draft-owner:${getConversationAssistantDraftStorageKey(identity)}`
    );
    const ownerNonce = runtimeOwnerNonceRef.current;
    channel.onmessage = (message: MessageEvent<unknown>): void => {
      if (typeof message.data !== 'object' || message.data === null) return;
      const announcedOwnerNonce = (message.data as Record<string, unknown>)['ownerNonce'];
      if (typeof announcedOwnerNonce !== 'string') return;
      const decision = decideConversationAssistantDraftOwnership({
        runtimeOwnerNonce: ownerNonce,
        announcedOwnerNonce,
        ...(startedTurnRequestIdRef.current === undefined
          ? {}
          : { startedTurnRequestId: startedTurnRequestIdRef.current }),
      });
      if (
        decision === 'regenerate_unstarted_request_ids' &&
        preparationRequestIdRef.current !== undefined
      ) {
        const sessionId = selectedSessionIdRef.current;
        if (sessionId === undefined) return;
        const requestId = newCreationRequestId();
        const replacesAttachmentId = replacesAttachmentIdRef.current;
        const attachmentState = pendingContextAttachmentRef.current;
        const fallbackAttachment =
          replacesAttachmentId !== undefined &&
          attachmentState.phase !== 'idle' &&
          attachmentState.phase !== 'preparing_intent' &&
          attachmentState.phase !== 'restoring' &&
          attachmentState.phase !== 'restore_failed' &&
          attachmentState.phase !== 'missing' &&
          attachmentState.phase !== 'consumed_elsewhere'
            ? attachmentState.attachment
            : undefined;
        preparationRequestIdRef.current = requestId;
        persistCurrentDraft(followUpQuestionRef.current, undefined, true);
        if (attachmentState.phase === 'preparing_intent') {
          dispatchContextAttachment({
            type: 'begin_preparing_intent',
            sessionId,
            requestId,
            ...(replacesAttachmentId === undefined ? {} : { replacesAttachmentId }),
          });
        } else if (attachmentState.phase === 'restoring') {
          dispatchContextAttachment({ type: 'begin_restoring', sessionId });
        }
        void resolvePreparationIntent({
          sessionId,
          requestId,
          ...(replacesAttachmentId === undefined ? {} : { replacesAttachmentId }),
          requestPhase: replacesAttachmentId === undefined ? 'include' : 'refresh',
          ...(fallbackAttachment === undefined ? {} : { fallbackAttachment }),
        });
      }
    };
    channel.postMessage({ type: 'draft-owner', ownerNonce });
    return (): void => {
      channel.close();
    };
  }, [
    persistCurrentDraft,
    resolvePreparationIntent,
    selectedSession?.id,
    selectedSessionId,
    user?.sub,
  ]);

  useEffect(() => {
    if (
      creationRecoveryStartedRef.current ||
      loadSessions ||
      selectedSessionId !== undefined ||
      (!loadChats && sourceSessionId === undefined)
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
  }, [getAccessToken, loadChats, loadSessions, selectedSessionId, setSessionParam, sourceSessionId]);

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
      request: SendConversationAssistantTurnRequest,
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
      let streamedAssistantText = '';
      let streamedAssistantUsage: ConversationAssistantTurn['usage'];
      let preCommitStreamError: { code: string; message: string } | undefined;
      let committedContextRefreshStarted = false;
      const streamingAssistantTurnId = `conversation-assistant-stream-${String(requestId)}`;
      const isCurrentRequest = (): boolean =>
        selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId;
      const refreshCommittedContextSummary = (): void => {
        if (
          committedContextRefreshStarted ||
          request.contextAttachmentId === undefined
        ) {
          return;
        }
        committedContextRefreshStarted = true;
        void getConversationAssistantSession(token, sessionId)
          .then((refreshedSession) => {
            if (!isCurrentRequest()) return;
            setSelectedSessionOverride(refreshedSession);
            setSessions((current) =>
              current.map((item) =>
                item.id === refreshedSession.id ? refreshedSession : item
              )
            );
          })
          .catch(() => {
            // A later stream completion or explicit refresh can recover summary metadata.
          });
      };

      const applyStreamEvent = (event: ConversationAssistantStreamEvent): void => {
        if (!isCurrentRequest()) return;
        if (event.type === 'request_state') {
          setTurnPhase(event.request.status === 'in_progress' ? 'waiting' : 'idle');
          return;
        }
        if (event.type === 'context_attached') {
          refreshCommittedContextSummary();
          return;
        }
        if (event.type === 'user_turn') {
          refreshCommittedContextSummary();
          acknowledgedSendRequestIdRef.current = requestId;
          acknowledgedUserTurnIdRef.current = event.turn.id;
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
          if (acknowledgedUserTurnIdRef.current === null) preCommitStreamError = event.error;
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

      const controller = new AbortController();
      try {
        sendAbortRef.current?.abort();
        sendAbortRef.current = controller;
        await streamConversationAssistantTurn(
          token,
          sessionId,
          request,
          applyStreamEvent,
          controller.signal
        );
        if (preCommitStreamError !== undefined) {
          const streamError = new Error(preCommitStreamError.message) as Error & { code: string };
          streamError.code = preCommitStreamError.code;
          throw streamError;
        }
        void getConversationAssistantSession(token, sessionId)
          .then((refreshedSession) => {
            if (isCurrentRequest()) {
              setSelectedSessionOverride(refreshedSession);
              setSessions((current) =>
                current.map((item) =>
                  item.id === refreshedSession.id ? refreshedSession : item
                )
              );
            }
          })
          .catch(() => {
            // The persisted turns remain authoritative; a later refresh can recover summary metadata.
          });
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
        if (isCurrentRequest()) {
          setTurns((current) =>
            current.filter((turn) => turn.id !== streamingAssistantTurnId)
          );
        }
        throw streamError;
      } finally {
        if (sendAbortRef.current === controller) sendAbortRef.current = null;
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
      const userId = user?.sub;
      if (request.sourceSessionId !== undefined && typeof userId === 'string' && userId !== '') {
        const sourceIdentity: ConversationAssistantDraftIdentity = {
          origin: globalThis.location.origin,
          userId,
          sessionId: request.sourceSessionId,
        };
        const sourceDraft = loadConversationAssistantDraft(
          globalThis.sessionStorage,
          sourceIdentity
        );
        if (sourceDraft !== null) {
          saveConversationAssistantDraft(
            globalThis.sessionStorage,
            { ...sourceIdentity, sessionId: session.id },
            { question: sourceDraft.question, warningAcknowledged: false }
          );
        }
      }
      setInvalidSelectedSessionId(undefined);
      setSelectedSessionOverride(session);
      followUpQuestionRef.current = '';
      setFollowUpQuestionState('');
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
    [setSessionParam, user?.sub]
  );

  const createSession = useCallback(async (): Promise<void> => {
    if (createInFlightRef.current) return;
    if (selectedChatId === undefined && sourceSessionId === undefined) {
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
      let request = pendingRequest;
      if (request === null) {
        const commonRequest = {
          requestId: clientRequestId,
          from: fromDateTimeLocalValue(fromDateTimeLocal),
          to: fromDateTimeLocalValue(toDateTimeLocal),
          model: selectedModel,
          displayTimeZone: getBrowserTimeZone(),
        };
        request =
          sourceSessionId !== undefined
            ? { ...commonRequest, sourceSessionId }
            : { ...commonRequest, chatId: selectedChatId ?? '' };
      }
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
    sourceSessionId,
    toDateTimeLocal,
  ]);

  const prepareContextAttachment = useCallback(
    async (replacesAttachmentId?: string): Promise<void> => {
      const sessionId = selectedSessionIdRef.current;
      if (sessionId === undefined) return;
      if (attachmentRequestPhaseRef.current !== 'idle') return;
      if (contextContinuationState !== 'available') {
        setError(
          contextContinuationState === 'source_unavailable'
            ? 'The source conversation is unavailable. Start a new analysis.'
            : 'This analysis cannot include later WhatsApp context. Start a new analysis.'
        );
        return;
      }

      const requestPhase = replacesAttachmentId === undefined ? 'include' : 'refresh';
      const fallbackAttachment =
        replacesAttachmentId === undefined ||
        pendingContextAttachment.phase === 'idle' ||
        pendingContextAttachment.phase === 'preparing_intent' ||
        pendingContextAttachment.phase === 'restoring' ||
        pendingContextAttachment.phase === 'restore_failed' ||
        pendingContextAttachment.phase === 'missing' ||
        pendingContextAttachment.phase === 'consumed_elsewhere'
          ? undefined
          : pendingContextAttachment.attachment;
      const requestId = newCreationRequestId();
      preparationRequestIdRef.current = requestId;
      replacesAttachmentIdRef.current = replacesAttachmentId;
      attachmentIdRef.current = undefined;
      attachmentExpiresAtRef.current = undefined;
      startedTurnRequestIdRef.current = undefined;
      warningAcknowledgedRef.current = false;
      setContextAttachmentWarningAcknowledged(false);
      persistCurrentDraft(followUpQuestionRef.current, undefined, true);
      setError(null);
      if (replacesAttachmentId === undefined) {
        dispatchContextAttachment({
          type: 'begin_preparing_intent',
          sessionId,
          requestId,
        });
      }
      await resolvePreparationIntent({
        sessionId,
        requestId,
        ...(replacesAttachmentId === undefined ? {} : { replacesAttachmentId }),
        requestPhase,
        ...(fallbackAttachment === undefined ? {} : { fallbackAttachment }),
      });
    }, [
      contextContinuationState,
      followUpQuestion,
      pendingContextAttachment,
      persistCurrentDraft,
      resolvePreparationIntent,
    ]
  );

  const includeNewMessages = useCallback(async (): Promise<void> => {
    await prepareContextAttachment();
  }, [prepareContextAttachment]);

  const refreshContextAttachment = useCallback(async (): Promise<void> => {
    const attachmentId =
      pendingContextAttachment.phase === 'idle' ||
      pendingContextAttachment.phase === 'preparing_intent' ||
      pendingContextAttachment.phase === 'restoring' ||
      pendingContextAttachment.phase === 'restore_failed' ||
      pendingContextAttachment.phase === 'missing' ||
      pendingContextAttachment.phase === 'consumed_elsewhere'
        ? undefined
        : pendingContextAttachment.attachment.id;
    if (attachmentId === undefined) return;
    await prepareContextAttachment(attachmentId);
  }, [pendingContextAttachment, prepareContextAttachment]);

  const retryContextAttachment = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current;
    if (pendingContextAttachment.phase === 'restore_failed') {
      if (sessionId === undefined || attachmentRequestPhaseRef.current !== 'idle') return;
      const attachmentId = pendingContextAttachment.attachmentId;
      attachmentRequestPhaseRef.current = 'retry';
      setContextAttachmentRequestPhase('retry');
      dispatchContextAttachment({ type: 'begin_restoring', sessionId, attachmentId });
      const controller = new AbortController();
      attachmentAbortRef.current?.abort();
      attachmentAbortRef.current = controller;
      setError(null);
      try {
        const token = await getAccessToken();
        const attachment = await getConversationAssistantContextAttachment(
          token,
          sessionId,
          attachmentId,
          controller.signal
        );
        if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
          attachmentExpiresAtRef.current = attachment.expiresAt;
          dispatchContextAttachment({
            type: 'attachment_status_received',
            sessionId,
            attachment,
          });
          persistCurrentDraft(followUpQuestionRef.current, attachment.expiresAt, true);
        }
      } catch (restoreError) {
        if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
          if (restoreError instanceof ApiError && restoreError.status === 404) {
            dispatchContextAttachment({
              type: 'restore_missing',
              sessionId,
              attachmentId,
            });
          } else {
            dispatchContextAttachment({
              type: 'restore_failed',
              sessionId,
              attachmentId,
              message:
                'This WhatsApp context update could not be restored yet. Your question is safe.',
            });
          }
        }
      } finally {
        if (attachmentAbortRef.current === controller) {
          attachmentAbortRef.current = null;
          attachmentRequestPhaseRef.current = 'idle';
          setContextAttachmentRequestPhase('idle');
        }
      }
      return;
    }
    const attachmentId =
      pendingContextAttachment.phase === 'idle' ||
      pendingContextAttachment.phase === 'preparing_intent' ||
      pendingContextAttachment.phase === 'restoring' ||
      pendingContextAttachment.phase === 'missing' ||
      pendingContextAttachment.phase === 'consumed_elsewhere'
        ? undefined
        : pendingContextAttachment.attachment.id;
    if (
      sessionId === undefined ||
      attachmentId === undefined ||
      attachmentRequestPhaseRef.current !== 'idle' ||
      (pendingContextAttachment.phase === 'failed' &&
        pendingContextAttachment.failure.blocking)
    ) {
      return;
    }
    attachmentRequestPhaseRef.current = 'retry';
    setContextAttachmentRequestPhase('retry');
    const controller = new AbortController();
    attachmentAbortRef.current?.abort();
    attachmentAbortRef.current = controller;
    setError(null);
    try {
      const token = await getAccessToken();
      const attachment = await retryConversationAssistantContextAttachment(
        token,
        sessionId,
        attachmentId,
        controller.signal
      );
      if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
        attachmentExpiresAtRef.current = attachment.expiresAt;
        dispatchContextAttachment({ type: 'track_attachment', sessionId, attachment });
        persistCurrentDraft(followUpQuestionRef.current, attachment.expiresAt, true);
      }
    } catch (retryError) {
      if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
        setError(getErrorMessage(retryError, 'Failed to retry WhatsApp context update'));
      }
    } finally {
      if (attachmentAbortRef.current === controller) {
        attachmentAbortRef.current = null;
        attachmentRequestPhaseRef.current = 'idle';
        setContextAttachmentRequestPhase('idle');
      }
    }
  }, [followUpQuestion, getAccessToken, pendingContextAttachment, persistCurrentDraft]);

  const removeContextAttachment = useCallback(async (): Promise<void> => {
    const sessionId = selectedSessionIdRef.current;
    if (pendingContextAttachment.phase === 'preparing_intent') {
      if (sessionId === undefined) return;
      const requestId = preparationRequestIdRef.current;
      if (requestId !== undefined) {
        locallyCancelledPreparationRequestIdsRef.current.add(requestId);
      }
      preparationRecoveryGenerationRef.current += 1;
      preparationRequestIdRef.current = undefined;
      replacesAttachmentIdRef.current = undefined;
      // Let the accepted POST resolve so its server draft can be deleted by
      // resolvePreparationIntent instead of being abandoned until TTL cleanup.
      attachmentAbortRef.current = null;
      attachmentRequestPhaseRef.current = 'idle';
      setContextAttachmentRequestPhase('idle');
      dispatchContextAttachment({ type: 'reset', sessionId });
      persistCurrentDraft(followUpQuestionRef.current, undefined, true);
      setError(null);
      return;
    }
    if (
      pendingContextAttachment.phase === 'missing' ||
      pendingContextAttachment.phase === 'recapture_required' ||
      pendingContextAttachment.phase === 'consumed_elsewhere'
    ) {
      if (sessionId === undefined) return;
      const attachmentId =
        pendingContextAttachment.phase === 'missing'
          ? pendingContextAttachment.attachmentId
          : pendingContextAttachment.attachment.id;
      preparationRecoveryGenerationRef.current += 1;
      turnRecoveryGenerationRef.current += 1;
      turnRecoveryRequestIdRef.current = undefined;
      turnRecoveryHasPersistedUserTurnRef.current = false;
      durableTurnReplayIntentRef.current = null;
      setRecoveringTurnRequestId(undefined);
      sendRequestIdRef.current += 1;
      sendAbortRef.current?.abort();
      sendAbortRef.current = null;
      sendInFlightRef.current = false;
      setTurnPhase('idle');
      preparationRequestIdRef.current = undefined;
      replacesAttachmentIdRef.current = undefined;
      attachmentIdRef.current = undefined;
      attachmentExpiresAtRef.current = undefined;
      startedTurnRequestIdRef.current = undefined;
      warningAcknowledgedRef.current = false;
      setContextAttachmentWarningAcknowledged(false);
      attachmentRequestPhaseRef.current = 'idle';
      setContextAttachmentRequestPhase('idle');
      dispatchContextAttachment({ type: 'remove', sessionId, attachmentId });
      persistCurrentDraft(followUpQuestionRef.current, undefined, true);
      setError(null);
      return;
    }
    const attachmentId =
      pendingContextAttachment.phase === 'idle'
        ? undefined
        : pendingContextAttachment.phase === 'restoring' ||
            pendingContextAttachment.phase === 'restore_failed'
          ? pendingContextAttachment.attachmentId
          : pendingContextAttachment.attachment.id;
    if (
      sessionId === undefined ||
      attachmentId === undefined ||
      attachmentRequestPhaseRef.current !== 'idle'
    ) {
      return;
    }
    attachmentRequestPhaseRef.current = 'remove';
    setContextAttachmentRequestPhase('remove');
    const controller = new AbortController();
    attachmentAbortRef.current?.abort();
    attachmentAbortRef.current = controller;
    try {
      const token = await getAccessToken();
      await removeConversationAssistantContextAttachment(
        token,
        sessionId,
        attachmentId,
        controller.signal
      );
      if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
        preparationRequestIdRef.current = undefined;
        replacesAttachmentIdRef.current = undefined;
        attachmentIdRef.current = undefined;
        attachmentExpiresAtRef.current = undefined;
        warningAcknowledgedRef.current = false;
        setContextAttachmentWarningAcknowledged(false);
        dispatchContextAttachment({ type: 'remove', sessionId, attachmentId });
        persistCurrentDraft(followUpQuestionRef.current, undefined, true);
      }
    } catch (removeError) {
      if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
        setError(getErrorMessage(removeError, 'Failed to remove WhatsApp context update'));
      }
    } finally {
      if (attachmentAbortRef.current === controller) {
        attachmentAbortRef.current = null;
        attachmentRequestPhaseRef.current = 'idle';
        setContextAttachmentRequestPhase('idle');
      }
    }
  }, [followUpQuestion, getAccessToken, pendingContextAttachment, persistCurrentDraft]);

  const keepCurrentContextAttachment = useCallback((): void => {
    if (pendingContextAttachment.phase !== 'newer_available') return;
    dispatchContextAttachment({
      type: 'keep_current_snapshot',
      sessionId: pendingContextAttachment.sessionId,
      attachmentId: pendingContextAttachment.attachment.id,
    });
  }, [pendingContextAttachment]);

  const acknowledgeContextAttachmentWarning = useCallback((): void => {
    if (
      pendingContextAttachment.phase === 'idle' ||
      pendingContextAttachment.phase === 'preparing_intent' ||
      pendingContextAttachment.phase === 'restoring' ||
      pendingContextAttachment.phase === 'restore_failed' ||
      pendingContextAttachment.phase === 'missing' ||
      pendingContextAttachment.phase === 'recapture_required' ||
      pendingContextAttachment.phase === 'consumed_elsewhere'
    ) {
      return;
    }
    warningAcknowledgedRef.current = true;
    setContextAttachmentWarningAcknowledged(true);
    persistCurrentDraft(
      followUpQuestionRef.current,
      pendingContextAttachment.attachment.expiresAt,
      true
    );
  }, [followUpQuestion, pendingContextAttachment, persistCurrentDraft]);

  const loadContextSnapshotPreview = useCallback(
    async (
      attachmentId: string,
      cursor?: string
    ): Promise<ConversationAssistantContextAttachmentPreviewResponse | null> => {
      const sessionId = selectedSessionIdRef.current;
      if (sessionId === undefined) return null;
      const requestId = attachmentPreviewRequestIdRef.current + 1;
      attachmentPreviewRequestIdRef.current = requestId;
      const controller = new AbortController();
      attachmentPreviewAbortRef.current?.abort();
      attachmentPreviewAbortRef.current = controller;
      try {
        const token = await getAccessToken();
        const response = await getConversationAssistantContextAttachmentPreview(
          token,
          sessionId,
          attachmentId,
          cursor === undefined ? {} : { cursor },
          controller.signal
        );
        if (
          controller.signal.aborted ||
          selectedSessionIdRef.current !== sessionId ||
          attachmentPreviewRequestIdRef.current !== requestId
        ) {
          return null;
        }
        return response;
      } catch {
        // The viewer owns preview errors so closing or navigating back cannot leave a page banner.
        return null;
      } finally {
        if (attachmentPreviewAbortRef.current === controller) {
          attachmentPreviewAbortRef.current = null;
        }
      }
    },
    [getAccessToken]
  );

  const loadContextAttachmentPreview = useCallback(
    async (cursor?: string): Promise<ConversationAssistantContextAttachmentPreviewResponse | null> => {
      const attachmentId =
        pendingContextAttachment.phase === 'idle'
          ? undefined
          : pendingContextAttachment.phase === 'preparing_intent'
            ? undefined
          : pendingContextAttachment.phase === 'restoring' ||
                pendingContextAttachment.phase === 'restore_failed' ||
                pendingContextAttachment.phase === 'missing'
            ? pendingContextAttachment.attachmentId
            : pendingContextAttachment.attachment.id;
      if (attachmentId === undefined) return null;
      return await loadContextSnapshotPreview(attachmentId, cursor);
    },
    [loadContextSnapshotPreview, pendingContextAttachment]
  );

  const loadContextHistory = useCallback(async (): Promise<ConversationAssistantContextHistoryResponse | null> => {
    const sessionId = selectedSessionIdRef.current;
    if (sessionId === undefined) return null;
    try {
      const token = await getAccessToken();
      return await getConversationAssistantContextHistory(token, sessionId);
    } catch (historyError) {
      if (selectedSessionIdRef.current === sessionId) {
        setError(getErrorMessage(historyError, 'Failed to load conversation context history'));
      }
      return null;
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (
      pendingContextAttachment.phase !== 'preparing' &&
      pendingContextAttachment.phase !== 'ready' &&
      pendingContextAttachment.phase !== 'newer_available'
    ) {
      return;
    }
    const { sessionId, attachment } = pendingContextAttachment;
    let requestInFlight = false;
    let pollController: AbortController | null = null;
    const poll = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;
      pollController = new AbortController();
      try {
        const token = await getAccessToken();
        const refreshed = await getConversationAssistantContextAttachment(
          token,
          sessionId,
          attachment.id,
          pollController.signal
        );
        if (!pollController.signal.aborted && selectedSessionIdRef.current === sessionId) {
          attachmentExpiresAtRef.current = refreshed.expiresAt;
          if (!isCommittedAttachmentOwnedByActiveRequest(sessionId, refreshed)) {
            dispatchContextAttachment({
              type: 'attachment_status_received',
              sessionId,
              attachment: refreshed,
            });
          }
          persistCurrentDraft(followUpQuestionRef.current, refreshed.expiresAt, true);
        }
      } catch {
        // Polling is recoverable through the explicit refresh/status actions.
      } finally {
        requestInFlight = false;
      }
    };
    const intervalId = window.setInterval(
      () => void poll(),
      pendingContextAttachment.phase === 'preparing' ? 1500 : 5000
    );
    return (): void => {
      window.clearInterval(intervalId);
      pollController?.abort();
    };
  }, [
    followUpQuestion,
    getAccessToken,
    isCommittedAttachmentOwnedByActiveRequest,
    pendingContextAttachment,
    persistCurrentDraft,
  ]);

  const sendFollowUp = useCallback(async (): Promise<void> => {
    if (sendInFlightRef.current || attachmentRequestPhaseRef.current !== 'idle') return;
    const sessionId = selectedSessionIdRef.current;
    const question = followUpQuestion.trim();
    if (sessionId === undefined || question === '') return;

    if (
      pendingContextAttachment.phase === 'preparing_intent' ||
      pendingContextAttachment.phase === 'restoring' ||
      pendingContextAttachment.phase === 'restore_failed' ||
      pendingContextAttachment.phase === 'preparing' ||
      pendingContextAttachment.phase === 'expired' ||
      pendingContextAttachment.phase === 'stale' ||
      pendingContextAttachment.phase === 'missing' ||
      pendingContextAttachment.phase === 'recapture_required' ||
      pendingContextAttachment.phase === 'consumed_elsewhere' ||
      pendingContextAttachment.phase === 'failed'
    ) {
      setError('Resolve the WhatsApp context update before sending this question.');
      return;
    }
    const attachment =
      pendingContextAttachment.phase === 'ready' ||
      pendingContextAttachment.phase === 'newer_available'
        ? pendingContextAttachment.attachment
        : undefined;
    if (attachment?.requiresConfirmation === true && !warningAcknowledgedRef.current) {
      setError('Continue with this snapshot before sending.');
      return;
    }
    if (attachment !== undefined && isAttachmentExpiredAt(attachment, Date.now())) {
      const expiredAttachment: ConversationAssistantAttachmentDto = {
        ...attachment,
        status: 'expired',
      };
      attachmentExpiresAtRef.current = expiredAttachment.expiresAt;
      dispatchContextAttachment({
        type: 'attachment_status_received',
        sessionId,
        attachment: expiredAttachment,
      });
      persistCurrentDraft(question, expiredAttachment.expiresAt, true);
      setError(null);
      return;
    }

    const durableRequestId = startedTurnRequestIdRef.current ?? newCreationRequestId();
    startedTurnRequestIdRef.current = durableRequestId;
    const durableRequest: SendConversationAssistantTurnRequest = {
      requestId: durableRequestId,
      question,
      ...(attachment === undefined ? {} : { contextAttachmentId: attachment.id }),
      ...(attachment?.requiresConfirmation === true && attachment.confirmationToken !== undefined
        ? { confirmationToken: attachment.confirmationToken }
        : {}),
    };
    durableTurnReplayIntentRef.current = {
      sessionId,
      requestId: durableRequestId,
      question,
      ...(attachment === undefined ? {} : { contextAttachmentId: attachment.id }),
      exactRequest: durableRequest,
    };
    persistCurrentDraft(question, attachment?.expiresAt, true);

    const requestId = sendRequestIdRef.current + 1;
    sendRequestIdRef.current = requestId;
    sendInFlightRef.current = true;
    setTurnPhase('submitting');
    setError(null);
    try {
      const token = await getAccessToken();
      if (
        selectedSessionIdRef.current !== sessionId ||
        sendRequestIdRef.current !== requestId
      ) {
        return;
      }
      await streamQuestionIntoSession(
        token,
        sessionId,
        durableRequest,
        () => {
          followUpQuestionRef.current = '';
          setFollowUpQuestionState('');
          const identity = draftIdentityRef.current;
          if (identity !== null) {
            clearConversationAssistantDraft(globalThis.sessionStorage, identity);
          }
          draftRecordRef.current = null;
          preparationRequestIdRef.current = undefined;
          replacesAttachmentIdRef.current = undefined;
          attachmentIdRef.current = undefined;
          attachmentExpiresAtRef.current = undefined;
          startedTurnRequestIdRef.current = undefined;
          warningAcknowledgedRef.current = false;
          setContextAttachmentWarningAcknowledged(false);
          dispatchContextAttachment({ type: 'reset', sessionId });
        },
        requestId,
        loadSessions
      );
    } catch (sendError) {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        const isPreCommitFailure = acknowledgedSendRequestIdRef.current !== requestId;
        const definitiveAttachmentRejection =
          getDefinitivePreCommitAttachmentRejection(sendError);
        if (isPreCommitFailure && hasErrorCode(sendError, 'REQUEST_BODY_CONFLICT')) {
          releaseConflictingTurnRequest(sessionId, durableRequestId);
        } else if (
          isPreCommitFailure &&
          attachment !== undefined &&
          hasErrorCode(sendError, 'CONTEXT_WINDOW_EXCEEDED')
        ) {
          startedTurnRequestIdRef.current = undefined;
          durableTurnReplayIntentRef.current = null;
          dispatchContextAttachment({
            type: 'hard_limit_rejected',
            sessionId,
            attachmentId: attachment.id,
          });
          persistCurrentDraft(question, attachment.expiresAt, true);
          setError(null);
        } else if (
          isPreCommitFailure &&
          attachment !== undefined &&
          definitiveAttachmentRejection !== null
        ) {
          await reconcileDefinitiveAttachmentRejection({
            sessionId,
            attachmentId: attachment.id,
            requestId: durableRequestId,
            reason: definitiveAttachmentRejection,
          });
          setError(null);
        } else if (
          isPreCommitFailure &&
          attachment === undefined &&
          hasErrorCode(sendError, 'CONTEXT_WINDOW_EXCEEDED')
        ) {
          startedTurnRequestIdRef.current = undefined;
          durableTurnReplayIntentRef.current = null;
          persistCurrentDraft(question, undefined, true);
          setError(PLAIN_CONTEXT_WINDOW_ERROR);
        } else if (isPreCommitFailure && hasErrorCode(sendError, 'TURN_IN_PROGRESS')) {
          await handoffTurnInProgressRecovery(sessionId, durableRequestId);
        } else {
          const persistedUserTurn = acknowledgedSendRequestIdRef.current === requestId;
          beginTurnRecovery(sessionId, durableRequestId, persistedUserTurn);
          setError(
            persistedUserTurn
              ? ACKNOWLEDGED_TURN_RECOVERY_ERROR
              : 'Checking whether your message was saved. Your draft is safe.'
          );
        }
      }
    } finally {
      if (selectedSessionIdRef.current === sessionId && sendRequestIdRef.current === requestId) {
        if (turnRecoveryRequestIdRef.current === undefined) {
          sendInFlightRef.current = false;
          setTurnPhase('idle');
        }
        acknowledgedSendRequestIdRef.current = null;
        acknowledgedUserTurnIdRef.current = null;
      }
    }
  }, [
    beginTurnRecovery,
    followUpQuestion,
    getAccessToken,
    handoffTurnInProgressRecovery,
    loadSessions,
    pendingContextAttachment,
    persistCurrentDraft,
    reconcileDefinitiveAttachmentRejection,
    releaseConflictingTurnRequest,
    streamQuestionIntoSession,
  ]);

  const retryTurnAnswer = useCallback(
    async (requestId: string): Promise<void> => {
      const sessionId = selectedSessionIdRef.current;
      if (sessionId === undefined || sendInFlightRef.current) return;
      const controller = new AbortController();
      sendAbortRef.current?.abort();
      sendAbortRef.current = controller;
      sendInFlightRef.current = true;
      setTurnPhase('submitting');
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await retryConversationAssistantTurnAnswer(
          token,
          sessionId,
          requestId,
          controller.signal
        );
        if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
          setTurns((current) => mergeConversationAssistantTurns(current, response.turns));
          setTurnPhase(response.request.status === 'in_progress' ? 'waiting' : 'idle');
        }
      } catch (retryError) {
        if (!controller.signal.aborted && selectedSessionIdRef.current === sessionId) {
          setError(getErrorMessage(retryError, 'Failed to retry the answer'));
          setTurnPhase('idle');
        }
      } finally {
        if (sendAbortRef.current === controller) sendAbortRef.current = null;
        sendInFlightRef.current = false;
      }
    },
    [getAccessToken]
  );

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
      const clearDeletedSessionDraft = (): void => {
        const identity = draftIdentityRef.current;
        if (identity?.sessionId !== sessionId) return;
        clearConversationAssistantDraft(globalThis.sessionStorage, identity);
        draftRecordRef.current = null;
        preparationRequestIdRef.current = undefined;
        replacesAttachmentIdRef.current = undefined;
        attachmentIdRef.current = undefined;
        attachmentExpiresAtRef.current = undefined;
        startedTurnRequestIdRef.current = undefined;
        warningAcknowledgedRef.current = false;
        setContextAttachmentWarningAcknowledged(false);
        dispatchContextAttachment({ type: 'reset', sessionId });
      };
      try {
        if (deletionToken === undefined) {
          setDeleteError('Refresh analyses before deleting this item.');
          return false;
        }
        accessToken = await getAccessToken();
        sessionListRequestIdRef.current += 1;
        await deleteConversationAssistantSession(accessToken, sessionId, deletionToken);
        clearDeletedSessionDraft();
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
                clearDeletedSessionDraft();
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
    pendingContextAttachment,
    contextAttachmentRequestPhase,
    contextAttachmentWarningAcknowledged,
    contextContinuationState,
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
    includeNewMessages,
    refreshContextAttachment,
    retryContextAttachment,
    removeContextAttachment,
    keepCurrentContextAttachment,
    acknowledgeContextAttachmentWarning,
    loadContextAttachmentPreview,
    loadContextSnapshotPreview,
    loadContextHistory,
    retryTurnAnswer,
    loadContext,
    loadMoreContext,
    retryPreparation,
    exportSelectedSessionPdf,
    deleteSession,
    clearDeleteError,
    refresh,
  };
}
