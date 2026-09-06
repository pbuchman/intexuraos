import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { ApiError } from '@/services/apiClient.js';
import {
  confirmMessageDigestRun,
  createMessageDigest,
  deleteMessageDigest,
  getMessageDigest,
  getMessageDigestDeliveryReadiness,
  getMessageDigestErasure,
  getMessageDigestRun,
  listMessageDigestRuns,
  listMessageDigests,
  prepareMessageDigestRun,
  resumeMessageDigestErasure,
  retryMessageDigestRun,
  updateMessageDigest,
} from '@/services/messageDigestsApi';
import { newRequestId } from '@/services/requestId';
import { getPrivateWhatsAppAccount } from '@/services/whatsappApi';
import type {
  ConfirmMessageDigestRunResponse,
  CreateMessageDigestInput,
  CreateMessageDigestResponse,
  ListMessageDigestRunsOptions,
  ListMessageDigestsOptions,
  MessageDigestDefinition,
  MessageDigestDeliveryReadiness,
  MessageDigestErasure,
  MessageDigestRun,
  MessageDigestRunPreparation,
  RetryMessageDigestRunResponse,
  UpdateMessageDigestCommand,
} from '@/types/messageDigests';

export const MESSAGE_DIGEST_CREATE_REQUEST_KEY = 'intexuraos.message-digests.create-request-id';
export const MESSAGE_DIGEST_RUN_REQUEST_KEY = 'intexuraos.message-digests.run-request-id';
export const MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY =
  'intexuraos.message-digests.run-retry-request-id';
export const MESSAGE_DIGEST_ERASURE_REQUEST_KEY = 'intexuraos.message-digests.erasure-request';

const AMBIGUOUS_CREATE_INPUT_CHANGED_ERROR =
  'A previous create request used different values and may already have succeeded. Check the Message Digests list, then submit again to start a new request.';
const PENDING_RUN_RECOVERY_ERROR =
  'Recover the pending Message Digest run before starting another.';
const SAME_DIGEST_PENDING_RUN_RECOVERY_ERROR =
  'Recover the pending Message Digest run before preparing or confirming it again.';

type PageRequestMode = 'initial' | 'refresh' | 'append';
export type MessageDigestListRequestOutcome = 'succeeded' | 'failed' | 'stale';

export interface UseMessageDigestDefinitionResult {
  definition: MessageDigestDefinition | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isNotFound: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshWithResult: () => Promise<boolean>;
  adoptDefinition: (definition: MessageDigestDefinition) => void;
}

export function useMessageDigestDefinition(definitionId: string): UseMessageDigestDefinitionResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [definition, setDefinition] = useState<MessageDigestDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async (initial: boolean, preserveCurrentOnFailure = false): Promise<boolean> => {
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (initial) {
        setDefinition(null);
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setIsNotFound(false);
      setError(null);

      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return false;
        const nextDefinition = await getMessageDigest(accessToken, definitionId, {
          signal: controller.signal,
          refreshToken: getAccessToken,
        });
        if (requestSequenceRef.current !== requestId) return false;
        setDefinition(nextDefinition);
        return true;
      } catch (loadError) {
        if (requestSequenceRef.current !== requestId || controller.signal.aborted) return false;
        if (loadError instanceof ApiError && loadError.status === 404) {
          if (!preserveCurrentOnFailure) {
            setDefinition(null);
            setIsNotFound(true);
          }
        } else {
          setError(getErrorMessage(loadError, 'Failed to load Message Digest'));
        }
        return false;
      } finally {
        if (requestSequenceRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [definitionId, getAccessToken]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    controllerRef.current?.abort();
    setDefinition(null);
    setIsLoading(true);
    setIsRefreshing(false);
    setIsNotFound(false);
    setError(null);
    void execute(true);
    return (): void => {
      requestSequenceRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [authSubject, execute]);

  const refresh = useCallback(async (): Promise<void> => {
    await execute(false);
  }, [execute]);

  const refreshWithResult = useCallback(async (): Promise<boolean> => {
    return await execute(false, true);
  }, [execute]);

  const adoptDefinition = useCallback(
    (nextDefinition: MessageDigestDefinition): void => {
      if (nextDefinition.id !== definitionId) return;
      requestSequenceRef.current += 1;
      controllerRef.current?.abort();
      setDefinition(nextDefinition);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsNotFound(false);
      setError(null);
    },
    [definitionId]
  );

  return {
    definition,
    isLoading,
    isRefreshing,
    isNotFound,
    error,
    refresh,
    refreshWithResult,
    adoptDefinition,
  };
}

interface MessageDigestListState {
  items: MessageDigestDefinition[];
  nextCursor: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refreshError: string | null;
  loadMoreError: string | null;
  activeRequestId: number | null;
}

type MessageDigestListAction =
  | { type: 'reset' }
  | { type: 'request_started'; requestId: number; mode: PageRequestMode }
  | {
      type: 'request_succeeded';
      requestId: number;
      mode: PageRequestMode;
      items: MessageDigestDefinition[];
      nextCursor: string | null;
    }
  | {
      type: 'request_failed';
      requestId: number;
      mode: PageRequestMode;
      error: string;
    };

const INITIAL_LIST_STATE: MessageDigestListState = {
  items: [],
  nextCursor: null,
  isInitialLoading: true,
  isRefreshing: false,
  isLoadingMore: false,
  error: null,
  refreshError: null,
  loadMoreError: null,
  activeRequestId: null,
};

export interface UseMessageDigestListResult {
  items: MessageDigestDefinition[];
  nextCursor: string | null;
  hasConfirmedCurrentQuery: boolean;
  currentQueryRevision: number;
  confirmedCurrentQueryRevision: number | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refreshError: string | null;
  loadMoreError: string | null;
  refresh: () => Promise<void>;
  refreshWithResult: () => Promise<boolean>;
  refreshWithOutcome: () => Promise<MessageDigestListRequestOutcome>;
  loadMore: () => Promise<void>;
}

export function useMessageDigestList(
  options: ListMessageDigestsOptions = {}
): UseMessageDigestListResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [state, dispatch] = useReducer(messageDigestListReducer, INITIAL_LIST_STATE);
  const requestSequenceRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const appendInFlightRef = useRef(false);
  const requestOptions = useMemo<ListMessageDigestsOptions>(
    () => ({
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit ?? 25,
      ...(options.query === undefined ? {} : { query: options.query }),
      ...(options.chatType === undefined ? {} : { chatType: options.chatType }),
      ...(options.status === undefined ? {} : { status: options.status }),
      sort:
        options.sort ??
        (options.query === undefined || options.query.trim() === '' ? 'updatedAt' : 'name'),
      direction:
        options.direction ??
        (options.sort === 'name' ||
        (options.sort === undefined && options.query !== undefined && options.query.trim() !== '')
          ? 'asc'
          : 'desc'),
    }),
    [
      options.chatType,
      options.cursor,
      options.direction,
      options.limit,
      options.query,
      options.sort,
      options.status,
    ]
  );
  const requestFingerprint = useMemo(
    () => JSON.stringify({ authSubject, requestOptions }),
    [authSubject, requestOptions]
  );
  const confirmedRequestFingerprintRef = useRef<string | null>(null);
  const currentQueryContextRef = useRef({ fingerprint: requestFingerprint, revision: 1 });
  const currentQueryRevision =
    currentQueryContextRef.current.fingerprint === requestFingerprint
      ? currentQueryContextRef.current.revision
      : currentQueryContextRef.current.revision + 1;
  useLayoutEffect(() => {
    if (currentQueryContextRef.current.fingerprint === requestFingerprint) return;
    currentQueryContextRef.current = {
      fingerprint: requestFingerprint,
      revision: currentQueryRevision,
    };
    confirmedRequestFingerprintRef.current = null;
  }, [currentQueryRevision, requestFingerprint]);

  const execute = useCallback(
    async (mode: PageRequestMode, cursor?: string): Promise<MessageDigestListRequestOutcome> => {
      if (currentQueryContextRef.current.fingerprint !== requestFingerprint) return 'stale';
      if (mode === 'append' && appendInFlightRef.current) return 'stale';
      if (mode === 'append') appendInFlightRef.current = true;

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      dispatch({ type: 'request_started', requestId, mode });

      try {
        const accessToken = await getAccessToken();
        if (
          requestSequenceRef.current !== requestId ||
          currentQueryContextRef.current.fingerprint !== requestFingerprint
        ) {
          return 'stale';
        }
        const response = await listMessageDigests(
          accessToken,
          {
            ...requestOptions,
            ...(mode === 'append' && cursor !== undefined ? { cursor } : {}),
          },
          { signal: controller.signal, refreshToken: getAccessToken }
        );
        if (
          requestSequenceRef.current !== requestId ||
          currentQueryContextRef.current.fingerprint !== requestFingerprint
        ) {
          return 'stale';
        }
        confirmedRequestFingerprintRef.current = requestFingerprint;
        dispatch({
          type: 'request_succeeded',
          requestId,
          mode,
          items: response.items,
          nextCursor: response.nextCursor,
        });
        return 'succeeded';
      } catch (error) {
        if (
          requestSequenceRef.current !== requestId ||
          currentQueryContextRef.current.fingerprint !== requestFingerprint ||
          controller.signal.aborted
        ) {
          return 'stale';
        }
        dispatch({
          type: 'request_failed',
          requestId,
          mode,
          error: getErrorMessage(error, 'Failed to load Message Digests'),
        });
        return 'failed';
      } finally {
        if (mode === 'append') appendInFlightRef.current = false;
      }
    },
    [getAccessToken, requestFingerprint, requestOptions]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    appendInFlightRef.current = false;
    dispatch({ type: 'reset' });
    void execute('initial');
    return (): void => {
      requestSequenceRef.current += 1;
      abortControllerRef.current?.abort();
      appendInFlightRef.current = false;
    };
  }, [authSubject, execute]);

  const refresh = useCallback(async (): Promise<void> => {
    await execute('refresh');
  }, [execute]);

  const refreshWithResult = useCallback(async (): Promise<boolean> => {
    return (await execute('refresh')) === 'succeeded';
  }, [execute]);

  const refreshWithOutcome = useCallback(async (): Promise<MessageDigestListRequestOutcome> => {
    return await execute('refresh');
  }, [execute]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      state.nextCursor === null ||
      state.isInitialLoading ||
      state.isRefreshing ||
      state.isLoadingMore
    ) {
      return;
    }
    await execute('append', state.nextCursor);
  }, [execute, state.isInitialLoading, state.isLoadingMore, state.isRefreshing, state.nextCursor]);

  return {
    items: state.items,
    nextCursor: state.nextCursor,
    hasConfirmedCurrentQuery:
      confirmedRequestFingerprintRef.current === requestFingerprint,
    currentQueryRevision,
    confirmedCurrentQueryRevision:
      confirmedRequestFingerprintRef.current === requestFingerprint
        ? currentQueryRevision
        : null,
    isInitialLoading: state.isInitialLoading,
    isRefreshing: state.isRefreshing,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    refreshError: state.refreshError,
    loadMoreError: state.loadMoreError,
    refresh,
    refreshWithResult,
    refreshWithOutcome,
    loadMore,
  };
}

export interface UseMessageDigestCommandsResult {
  error: string | null;
  hasRevisionConflict: boolean;
  preparation: MessageDigestRunPreparation | null;
  requiresRunReconfirmation: boolean;
  isCreating: boolean;
  isUpdating: boolean;
  isPreparingRun: boolean;
  isConfirmingRun: boolean;
  isRecoveringRun: boolean;
  pendingRunRecoveryDefinitionId: string | null;
  createDigest: (input: CreateMessageDigestInput) => Promise<CreateMessageDigestResponse | null>;
  updateDigest: (
    definitionId: string,
    command: UpdateMessageDigestCommand
  ) => Promise<MessageDigestDefinition | null>;
  prepareRun: (definitionId: string) => Promise<MessageDigestRunPreparation | null>;
  confirmRun: (definitionId: string) => Promise<ConfirmMessageDigestRunResponse | null>;
  recoverPendingRun: (
    definitionId: string
  ) => Promise<ConfirmMessageDigestRunResponse | null>;
  finishRunRequest: () => void;
  clearError: () => void;
}

export function useMessageDigestCommands(): UseMessageDigestCommandsResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [error, setError] = useState<string | null>(null);
  const [hasRevisionConflict, setHasRevisionConflict] = useState(false);
  const [preparation, setPreparation] = useState<MessageDigestRunPreparation | null>(null);
  const [requiresRunReconfirmation, setRequiresRunReconfirmation] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPreparingRun, setIsPreparingRun] = useState(false);
  const [isConfirmingRun, setIsConfirmingRun] = useState(false);
  const [isRecoveringRun, setIsRecoveringRun] = useState(false);
  const [pendingRunRecoveryDefinitionId, setPendingRunRecoveryDefinitionId] = useState<
    string | null
  >(() => readStoredMessageDigestRunRequest(authSubject)?.definitionId ?? null);
  const mountedRef = useRef(true);
  const authEpochRef = useRef(0);
  const previousAuthSubjectRef = useRef(authSubject);
  const preparedDefinitionIdRef = useRef<string | null>(null);
  const createInFlightRef = useRef<Promise<CreateMessageDigestResponse | null> | null>(null);
  const updateInFlightRef = useRef(new Map<string, Promise<MessageDigestDefinition | null>>());
  const updateCountRef = useRef(0);
  const prepareInFlightRef = useRef<Promise<MessageDigestRunPreparation | null> | null>(null);
  const confirmInFlightRef = useRef<Promise<ConfirmMessageDigestRunResponse | null> | null>(null);

  const isCurrentEpoch = useCallback(
    (epoch: number): boolean => mountedRef.current && authEpochRef.current === epoch,
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      authEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (previousAuthSubjectRef.current === authSubject) return;

    previousAuthSubjectRef.current = authSubject;
    authEpochRef.current += 1;
    preparedDefinitionIdRef.current = null;
    createInFlightRef.current = null;
    updateInFlightRef.current.clear();
    updateCountRef.current = 0;
    prepareInFlightRef.current = null;
    confirmInFlightRef.current = null;
    removeSessionRequestId(MESSAGE_DIGEST_CREATE_REQUEST_KEY);
    removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
    setError(null);
    setHasRevisionConflict(false);
    setPreparation(null);
    setRequiresRunReconfirmation(false);
    setIsCreating(false);
    setIsUpdating(false);
    setIsPreparingRun(false);
    setIsConfirmingRun(false);
    setIsRecoveringRun(false);
    setPendingRunRecoveryDefinitionId(null);
  }, [authSubject]);

  const createDigest = useCallback(
    (input: CreateMessageDigestInput): Promise<CreateMessageDigestResponse | null> => {
      if (createInFlightRef.current !== null) return createInFlightRef.current;

      const epoch = authEpochRef.current;
      const request = (async (): Promise<CreateMessageDigestResponse | null> => {
        setError(null);
        setHasRevisionConflict(false);
        setIsCreating(true);
        try {
          const inputDigest = await fingerprintCreateMessageDigestInput(input);
          if (!isCurrentEpoch(epoch)) return null;
          const storedRequest = readStoredMessageDigestCreateRequest(authSubject);
          if (storedRequest !== null && storedRequest.inputDigest !== inputDigest) {
            removeSessionRequestId(MESSAGE_DIGEST_CREATE_REQUEST_KEY);
            setError(AMBIGUOUS_CREATE_INPUT_CHANGED_ERROR);
            return null;
          }
          const requestId = getOrCreateStoredMessageDigestCreateRequest(
            authSubject,
            inputDigest
          ).requestId;
          const accessToken = await getAccessToken();
          if (!isCurrentEpoch(epoch)) return null;
          const response = await createMessageDigest(accessToken, input, requestId, {
            refreshToken: getAccessToken,
          });
          if (!isCurrentEpoch(epoch)) return null;
          removeSessionRequestId(MESSAGE_DIGEST_CREATE_REQUEST_KEY);
          return response;
        } catch (createError) {
          if (isCurrentEpoch(epoch)) {
            setError(getErrorMessage(createError, 'Failed to create Message Digest'));
          }
          return null;
        } finally {
          if (isCurrentEpoch(epoch)) setIsCreating(false);
        }
      })();
      createInFlightRef.current = request;
      void request.finally(() => {
        if (createInFlightRef.current === request) createInFlightRef.current = null;
      });
      return request;
    },
    [authSubject, getAccessToken, isCurrentEpoch]
  );

  const updateDigest = useCallback(
    (
      definitionId: string,
      command: UpdateMessageDigestCommand
    ): Promise<MessageDigestDefinition | null> => {
      const existingRequest = updateInFlightRef.current.get(definitionId);
      if (existingRequest !== undefined) return existingRequest;

      const epoch = authEpochRef.current;
      updateCountRef.current += 1;
      setIsUpdating(true);
      const request = (async (): Promise<MessageDigestDefinition | null> => {
        setError(null);
        setHasRevisionConflict(false);
        try {
          const accessToken = await getAccessToken();
          if (!isCurrentEpoch(epoch)) return null;
          return await updateMessageDigest(accessToken, definitionId, command, {
            refreshToken: getAccessToken,
          });
        } catch (updateError) {
          if (isCurrentEpoch(epoch)) {
            setHasRevisionConflict(hasApiReason(updateError, 'REVISION_CONFLICT'));
            setError(getErrorMessage(updateError, 'Failed to update Message Digest'));
          }
          return null;
        } finally {
          if (isCurrentEpoch(epoch)) {
            updateCountRef.current = Math.max(0, updateCountRef.current - 1);
            setIsUpdating(updateCountRef.current > 0);
          }
        }
      })();
      updateInFlightRef.current.set(definitionId, request);
      void request.finally(() => {
        if (updateInFlightRef.current.get(definitionId) === request) {
          updateInFlightRef.current.delete(definitionId);
        }
      });
      return request;
    },
    [getAccessToken, isCurrentEpoch]
  );

  const requestPreparation = useCallback(
    async (
      definitionId: string,
      epoch: number,
      reconfirmationRequired: boolean
    ): Promise<MessageDigestRunPreparation | null> => {
      const accessToken = await getAccessToken();
      if (!isCurrentEpoch(epoch)) return null;
      const nextPreparation = await prepareMessageDigestRun(accessToken, definitionId, {
        refreshToken: getAccessToken,
      });
      if (!isCurrentEpoch(epoch)) return null;
      preparedDefinitionIdRef.current = definitionId;
      setPreparation(nextPreparation);
      setRequiresRunReconfirmation(reconfirmationRequired);
      return nextPreparation;
    },
    [getAccessToken, isCurrentEpoch]
  );

  const blockForPendingRunRecovery = useCallback(
    (definitionId: string, allowMatchingRecovery = false): boolean => {
      const storedRequest = readStoredMessageDigestRunRequest(authSubject);
      if (storedRequest === null) return false;
      const matchesDefinition = storedRequest.definitionId === definitionId;
      if (allowMatchingRecovery && matchesDefinition) return false;
      preparedDefinitionIdRef.current = null;
      setPreparation(null);
      setRequiresRunReconfirmation(false);
      setPendingRunRecoveryDefinitionId(storedRequest.definitionId);
      setError(
        matchesDefinition
          ? SAME_DIGEST_PENDING_RUN_RECOVERY_ERROR
          : PENDING_RUN_RECOVERY_ERROR
      );
      return true;
    },
    [authSubject]
  );

  const prepareRun = useCallback(
    (definitionId: string): Promise<MessageDigestRunPreparation | null> => {
      if (blockForPendingRunRecovery(definitionId)) return Promise.resolve(null);
      if (prepareInFlightRef.current !== null) return prepareInFlightRef.current;

      const epoch = authEpochRef.current;
      const request = (async (): Promise<MessageDigestRunPreparation | null> => {
        setError(null);
        setRequiresRunReconfirmation(false);
        setIsPreparingRun(true);
        try {
          return await requestPreparation(definitionId, epoch, false);
        } catch (prepareError) {
          if (isCurrentEpoch(epoch)) {
            preparedDefinitionIdRef.current = null;
            setPreparation(null);
            setError(getErrorMessage(prepareError, 'Failed to prepare Message Digest run'));
          }
          return null;
        } finally {
          if (isCurrentEpoch(epoch)) setIsPreparingRun(false);
        }
      })();
      prepareInFlightRef.current = request;
      void request.finally(() => {
        if (prepareInFlightRef.current === request) prepareInFlightRef.current = null;
      });
      return request;
    },
    [blockForPendingRunRecovery, isCurrentEpoch, requestPreparation]
  );

  const confirmRun = useCallback(
    (definitionId: string): Promise<ConfirmMessageDigestRunResponse | null> => {
      if (blockForPendingRunRecovery(definitionId)) return Promise.resolve(null);
      if (confirmInFlightRef.current !== null) return confirmInFlightRef.current;

      const currentPreparation = preparation;
      if (currentPreparation === null || preparedDefinitionIdRef.current !== definitionId) {
        setError('Prepare this run before confirming it.');
        return Promise.resolve(null);
      }

      const epoch = authEpochRef.current;
      const storedRequest = getOrCreateStoredMessageDigestRunRequest({
        authSubject,
        definitionId,
        preparationToken: currentPreparation.token,
      });
      if (storedRequest === null) {
        const pendingRequest = readStoredMessageDigestRunRequest(authSubject);
        setPendingRunRecoveryDefinitionId(pendingRequest?.definitionId ?? null);
        setError(PENDING_RUN_RECOVERY_ERROR);
        return Promise.resolve(null);
      }
      setPendingRunRecoveryDefinitionId(definitionId);
      const request = (async (): Promise<ConfirmMessageDigestRunResponse | null> => {
        setError(null);
        setRequiresRunReconfirmation(false);
        setIsConfirmingRun(true);
        try {
          const accessToken = await getAccessToken();
          if (!isCurrentEpoch(epoch)) return null;
          const response = await confirmMessageDigestRun(
            accessToken,
            definitionId,
            storedRequest.preparationToken,
            storedRequest.requestId,
            { refreshToken: getAccessToken }
          );
          if (!isCurrentEpoch(epoch)) return null;
          removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
          setPendingRunRecoveryDefinitionId(null);
          return response;
        } catch (confirmError) {
          if (!isCurrentEpoch(epoch)) return null;
          if (hasApiReason(confirmError, 'RUN_PREPARATION_STALE')) {
            removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
            setPendingRunRecoveryDefinitionId(null);
            try {
              await requestPreparation(definitionId, epoch, true);
              if (isCurrentEpoch(epoch)) {
                setError('The run window changed. Review the updated window and confirm again.');
              }
            } catch (refreshError) {
              if (isCurrentEpoch(epoch)) {
                preparedDefinitionIdRef.current = null;
                setPreparation(null);
                setError(
                  getErrorMessage(refreshError, 'Failed to refresh Message Digest run details')
                );
              }
            }
            return null;
          }
          setError(getErrorMessage(confirmError, 'Failed to start Message Digest run'));
          return null;
        } finally {
          if (isCurrentEpoch(epoch)) setIsConfirmingRun(false);
        }
      })();
      confirmInFlightRef.current = request;
      void request.finally(() => {
        if (confirmInFlightRef.current === request) confirmInFlightRef.current = null;
      });
      return request;
    },
    [
      authSubject,
      blockForPendingRunRecovery,
      getAccessToken,
      isCurrentEpoch,
      preparation,
      requestPreparation,
    ]
  );

  const recoverPendingRun = useCallback(
    (definitionId: string): Promise<ConfirmMessageDigestRunResponse | null> => {
      if (blockForPendingRunRecovery(definitionId, true)) return Promise.resolve(null);
      if (confirmInFlightRef.current !== null) return confirmInFlightRef.current;
      const storedRequest = readStoredMessageDigestRunRequest(authSubject);
      if (storedRequest?.definitionId !== definitionId) {
        setPendingRunRecoveryDefinitionId(null);
        return Promise.resolve(null);
      }

      const epoch = authEpochRef.current;
      const request = (async (): Promise<ConfirmMessageDigestRunResponse | null> => {
        setError(null);
        setRequiresRunReconfirmation(false);
        setIsConfirmingRun(true);
        setIsRecoveringRun(true);
        try {
          const accessToken = await getAccessToken();
          if (!isCurrentEpoch(epoch)) return null;
          const response = await confirmMessageDigestRun(
            accessToken,
            definitionId,
            storedRequest.preparationToken,
            storedRequest.requestId,
            { refreshToken: getAccessToken }
          );
          if (!isCurrentEpoch(epoch)) return null;
          removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
          setPendingRunRecoveryDefinitionId(null);
          return response;
        } catch (recoveryError) {
          if (!isCurrentEpoch(epoch)) return null;
          if (hasApiReason(recoveryError, 'RUN_PREPARATION_STALE')) {
            removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
            setPendingRunRecoveryDefinitionId(null);
            try {
              await requestPreparation(definitionId, epoch, true);
              if (isCurrentEpoch(epoch)) {
                setError(
                  'The saved run window expired. Review the refreshed window and confirm again.'
                );
              }
            } catch (refreshError) {
              if (isCurrentEpoch(epoch)) {
                preparedDefinitionIdRef.current = null;
                setPreparation(null);
                setError(
                  getErrorMessage(refreshError, 'Failed to refresh Message Digest run details')
                );
              }
            }
            return null;
          }
          setError(getErrorMessage(recoveryError, 'Failed to recover Message Digest run'));
          return null;
        } finally {
          if (isCurrentEpoch(epoch)) {
            setIsConfirmingRun(false);
            setIsRecoveringRun(false);
          }
        }
      })();
      confirmInFlightRef.current = request;
      void request.finally(() => {
        if (confirmInFlightRef.current === request) confirmInFlightRef.current = null;
      });
      return request;
    },
    [
      authSubject,
      blockForPendingRunRecovery,
      getAccessToken,
      isCurrentEpoch,
      requestPreparation,
    ]
  );

  const finishRunRequest = useCallback((): void => {
    removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
    setPendingRunRecoveryDefinitionId(null);
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
    setHasRevisionConflict(false);
  }, []);

  return {
    error,
    hasRevisionConflict,
    preparation,
    requiresRunReconfirmation,
    isCreating,
    isUpdating,
    isPreparingRun,
    isConfirmingRun,
    isRecoveringRun,
    pendingRunRecoveryDefinitionId,
    createDigest,
    updateDigest,
    prepareRun,
    confirmRun,
    recoverPendingRun,
    finishRunRequest,
    clearError,
  };
}

interface StoredMessageDigestCreateRequest {
  version: 2;
  authSubject: string;
  requestId: string;
  inputDigest: string;
}

function getOrCreateStoredMessageDigestCreateRequest(
  authSubject: string,
  inputDigest: string
): StoredMessageDigestCreateRequest {
  const existing = readStoredMessageDigestCreateRequest(authSubject);
  if (existing !== null) return existing;
  const record: StoredMessageDigestCreateRequest = {
    version: 2,
    authSubject,
    requestId: newRequestId(),
    inputDigest,
  };
  sessionStorage.setItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY, JSON.stringify(record));
  return record;
}

function readStoredMessageDigestCreateRequest(
  authSubject: string
): StoredMessageDigestCreateRequest | null {
  const serialized = sessionStorage.getItem(MESSAGE_DIGEST_CREATE_REQUEST_KEY);
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 2 ||
      !('authSubject' in value) ||
      typeof value.authSubject !== 'string' ||
      value.authSubject === '' ||
      value.authSubject !== authSubject ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      value.requestId === '' ||
      !('inputDigest' in value) ||
      typeof value.inputDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.inputDigest)
    ) {
      throw new Error('Invalid create recovery request');
    }
    return {
      version: 2,
      authSubject: value.authSubject,
      requestId: value.requestId,
      inputDigest: value.inputDigest,
    };
  } catch {
    removeSessionRequestId(MESSAGE_DIGEST_CREATE_REQUEST_KEY);
    return null;
  }
}

async function fingerprintCreateMessageDigestInput(
  input: CreateMessageDigestInput
): Promise<string> {
  const schedule =
    input.schedule.kind === 'weekly'
      ? {
          kind: input.schedule.kind,
          weekday: input.schedule.weekday,
          localTime: input.schedule.localTime,
          timeZone: input.schedule.timeZone,
        }
      : {
          kind: input.schedule.kind,
          localTime: input.schedule.localTime,
          timeZone: input.schedule.timeZone,
        };
  const normalizedInput = JSON.stringify({
    status: input.status,
    name: input.name.trim(),
    source: { chatId: input.source.chatId.trim() },
    instructions: {
      templateId: input.instructions.templateId,
      text: input.instructions.text.trim(),
    },
    schedule,
  });
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizedInput)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

interface StoredMessageDigestRunRequest {
  version: 1;
  authSubject: string;
  definitionId: string;
  requestId: string;
  preparationToken: string;
}

function getOrCreateStoredMessageDigestRunRequest(input: {
  authSubject: string;
  definitionId: string;
  preparationToken: string;
}): StoredMessageDigestRunRequest | null {
  const existing = readStoredMessageDigestRunRequest(input.authSubject);
  if (existing !== null) {
    return existing.definitionId === input.definitionId ? existing : null;
  }
  const record: StoredMessageDigestRunRequest = {
    version: 1,
    authSubject: input.authSubject,
    definitionId: input.definitionId,
    requestId: newRequestId(),
    preparationToken: input.preparationToken,
  };
  sessionStorage.setItem(MESSAGE_DIGEST_RUN_REQUEST_KEY, JSON.stringify(record));
  return record;
}

function readStoredMessageDigestRunRequest(
  authSubject: string
): StoredMessageDigestRunRequest | null {
  const serialized = sessionStorage.getItem(MESSAGE_DIGEST_RUN_REQUEST_KEY);
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('authSubject' in value) ||
      typeof value.authSubject !== 'string' ||
      value.authSubject === '' ||
      !('definitionId' in value) ||
      typeof value.definitionId !== 'string' ||
      value.definitionId === '' ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      value.requestId === '' ||
      !('preparationToken' in value) ||
      typeof value.preparationToken !== 'string' ||
      value.preparationToken === '' ||
      value.authSubject !== authSubject
    ) {
      throw new Error('Invalid run recovery request');
    }
    return {
      version: 1,
      authSubject: value.authSubject,
      definitionId: value.definitionId,
      requestId: value.requestId,
      preparationToken: value.preparationToken,
    };
  } catch {
    removeSessionRequestId(MESSAGE_DIGEST_RUN_REQUEST_KEY);
    return null;
  }
}

function removeSessionRequestId(key: string): void {
  sessionStorage.removeItem(key);
}

function hasApiReason(error: unknown, reason: string): boolean {
  return error instanceof ApiError && error.details?.['reason'] === reason;
}

export interface UseMessageDigestDeliveryReadinessResult {
  readiness: MessageDigestDeliveryReadiness | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMessageDigestDeliveryReadiness(): UseMessageDigestDeliveryReadinessResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [readiness, setReadiness] = useState<MessageDigestDeliveryReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async (initial: boolean): Promise<void> => {
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (initial) {
        setReadiness(null);
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return;
        const nextReadiness = await getMessageDigestDeliveryReadiness(accessToken, {
          signal: controller.signal,
          refreshToken: getAccessToken,
        });
        if (requestSequenceRef.current !== requestId) return;
        setReadiness(nextReadiness);
      } catch (readinessError) {
        if (requestSequenceRef.current !== requestId || controller.signal.aborted) return;
        setError(getErrorMessage(readinessError, 'Failed to load WhatsApp delivery readiness'));
      } finally {
        if (requestSequenceRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    controllerRef.current?.abort();
    setReadiness(null);
    setIsLoading(true);
    setIsRefreshing(false);
    setError(null);
    void execute(true);
    return (): void => {
      requestSequenceRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [authSubject, execute]);

  const refresh = useCallback(async (): Promise<void> => {
    await execute(false);
  }, [execute]);

  return { readiness, isLoading, isRefreshing, error, refresh };
}

type MessageDigestSourceAvailability = 'loading' | 'active' | 'missing' | 'unavailable';

export interface UseMessageDigestSourceAvailabilityResult {
  availability: MessageDigestSourceAvailability;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMessageDigestSourceAvailability(): UseMessageDigestSourceAvailabilityResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [availability, setAvailability] = useState<MessageDigestSourceAvailability>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const execute = useCallback(
    async (initial: boolean): Promise<void> => {
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      if (initial) setAvailability('loading');
      else setIsRefreshing(true);
      setError(null);
      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return;
        const account = await getPrivateWhatsAppAccount(accessToken);
        if (requestSequenceRef.current !== requestId) return;
        setAvailability(account?.status === 'active' ? 'active' : 'missing');
      } catch (sourceError) {
        if (requestSequenceRef.current !== requestId) return;
        setAvailability('unavailable');
        setError(getErrorMessage(sourceError, 'Failed to load Private WhatsApp Mirror status'));
      } finally {
        if (requestSequenceRef.current === requestId) setIsRefreshing(false);
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    setAvailability('loading');
    setIsRefreshing(false);
    setError(null);
    void execute(true);
    return (): void => {
      requestSequenceRef.current += 1;
    };
  }, [authSubject, execute]);

  const refresh = useCallback(async (): Promise<void> => {
    await execute(false);
  }, [execute]);

  return { availability, isRefreshing, error, refresh };
}

interface UseMessageDigestDeletionOptions {
  erasureRequestId?: string | null;
  pollBaseMs?: number;
  pollMaxMs?: number;
}

interface StoredMessageDigestErasureRequest {
  version: 1;
  authSubject: string;
  definitionId: string;
  requestId: string;
  erasureRequestId: string | null;
}

type MessageDigestErasureRequestMode = 'delete' | 'get' | 'resume';

export interface UseMessageDigestDeletionResult {
  erasure: MessageDigestErasure | null;
  isDeleting: boolean;
  isRecovering: boolean;
  error: string | null;
  startDeletion: () => Promise<MessageDigestErasure | null>;
  retry: () => Promise<MessageDigestErasure | null>;
}

export function useMessageDigestDeletion(
  definitionId: string,
  options: UseMessageDigestDeletionOptions = {}
): UseMessageDigestDeletionResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const serverErasureRequestId = options.erasureRequestId ?? null;
  const pollBaseMs = Math.max(1, options.pollBaseMs ?? 1_000);
  const pollMaxMs = Math.max(pollBaseMs, options.pollMaxMs ?? 10_000);
  const [erasure, setErasure] = useState<MessageDigestErasure | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const previousAuthSubjectRef = useRef(authSubject);
  const recordRef = useRef<StoredMessageDigestErasureRequest | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<MessageDigestErasure | null> | null>(null);
  const executeRawRef = useRef<
    (
      mode: MessageDigestErasureRequestMode,
      record: StoredMessageDigestErasureRequest,
      epoch: number
    ) => Promise<MessageDigestErasure | null>
  >(() => Promise.resolve(null));

  const isCurrentEpoch = useCallback(
    (epoch: number): boolean => mountedRef.current && epochRef.current === epoch,
    []
  );

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runExclusive = useCallback(
    (
      mode: MessageDigestErasureRequestMode,
      record: StoredMessageDigestErasureRequest,
      epoch: number
    ): Promise<MessageDigestErasure | null> => {
      if (inFlightRef.current !== null) return inFlightRef.current;
      const request = executeRawRef.current(mode, record, epoch);
      inFlightRef.current = request;
      void request.finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
      });
      return request;
    },
    []
  );

  const scheduleProgressCheck = useCallback(
    (record: StoredMessageDigestErasureRequest, epoch: number): void => {
      clearTimer();
      const delayMs = Math.min(pollBaseMs * 2 ** pollAttemptRef.current, pollMaxMs);
      pollAttemptRef.current += 1;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const mode = record.erasureRequestId === null ? 'delete' : 'get';
        void runExclusive(mode, record, epoch);
      }, delayMs);
    },
    [clearTimer, pollBaseMs, pollMaxMs, runExclusive]
  );

  executeRawRef.current = async (
    mode: MessageDigestErasureRequestMode,
    record: StoredMessageDigestErasureRequest,
    epoch: number
  ): Promise<MessageDigestErasure | null> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const accessToken = await getAccessToken();
      if (!isCurrentEpoch(epoch)) return null;
      const nextErasure =
        mode === 'delete'
          ? await deleteMessageDigest(accessToken, record.definitionId, record.requestId, {
              signal: controller.signal,
              refreshToken: getAccessToken,
            })
          : mode === 'get'
            ? await getMessageDigestErasure(accessToken, requireErasureRequestId(record), {
                signal: controller.signal,
                refreshToken: getAccessToken,
              })
            : await resumeMessageDigestErasure(accessToken, requireErasureRequestId(record), {
                signal: controller.signal,
                refreshToken: getAccessToken,
              });
      if (!isCurrentEpoch(epoch)) return null;

      setErasure(nextErasure);
      setError(null);
      setIsRecovering(false);
      if (nextErasure.status === 'completed') {
        clearTimer();
        pollAttemptRef.current = 0;
        recordRef.current = null;
        removeSessionRequestId(MESSAGE_DIGEST_ERASURE_REQUEST_KEY);
        setIsDeleting(false);
        return nextErasure;
      }

      const updatedRecord: StoredMessageDigestErasureRequest = {
        ...record,
        erasureRequestId: nextErasure.erasureRequestId,
      };
      recordRef.current = updatedRecord;
      writeStoredErasureRequest(updatedRecord);
      setIsDeleting(true);

      if (mode === 'get' && nextErasure.nextAction === 'resume_delete') {
        return await executeRawRef.current('resume', updatedRecord, epoch);
      }
      scheduleProgressCheck(updatedRecord, epoch);
      return nextErasure;
    } catch (requestError) {
      if (!isCurrentEpoch(epoch) || controller.signal.aborted) return null;
      setError(
        getErrorMessage(
          requestError,
          mode === 'delete'
            ? 'Failed to delete Message Digest'
            : mode === 'resume'
              ? 'Failed to resume Message Digest deletion'
              : 'Failed to load deletion progress'
        )
      );
      setIsRecovering(false);
      setIsDeleting(true);
      scheduleProgressCheck(record, epoch);
      return null;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      epochRef.current += 1;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [clearTimer]);

  useEffect(() => {
    epochRef.current += 1;
    const epoch = epochRef.current;
    clearTimer();
    controllerRef.current?.abort();
    inFlightRef.current = null;
    recordRef.current = null;
    setErasure(null);
    setIsDeleting(false);
    setIsRecovering(false);
    setError(null);

    if (previousAuthSubjectRef.current !== authSubject) {
      previousAuthSubjectRef.current = authSubject;
      removeSessionRequestId(MESSAGE_DIGEST_ERASURE_REQUEST_KEY);
      return;
    }

    let storedRequest = readStoredErasureRequest(authSubject);
    if (storedRequest !== null && storedRequest.definitionId !== definitionId) {
      removeSessionRequestId(MESSAGE_DIGEST_ERASURE_REQUEST_KEY);
      storedRequest = null;
    }
    const serverRecoveryRequest: StoredMessageDigestErasureRequest | null =
      serverErasureRequestId === null
        ? null
        : {
            version: 1,
            authSubject,
            definitionId,
            requestId:
              storedRequest?.erasureRequestId === serverErasureRequestId
                ? storedRequest.requestId
                : newRequestId(),
            erasureRequestId: serverErasureRequestId,
          };
    const recoveryRequest = serverRecoveryRequest ?? storedRequest;
    if (recoveryRequest === null) return;
    if (
      storedRequest?.requestId !== recoveryRequest.requestId ||
      storedRequest.erasureRequestId !== recoveryRequest.erasureRequestId
    ) {
      writeStoredErasureRequest(recoveryRequest);
    }
    recordRef.current = recoveryRequest;
    setIsDeleting(true);
    setIsRecovering(true);
    const mode = recoveryRequest.erasureRequestId === null ? 'delete' : 'get';
    void runExclusive(mode, recoveryRequest, epoch);

    return (): void => {
      epochRef.current += 1;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [authSubject, clearTimer, definitionId, runExclusive, serverErasureRequestId]);

  const startDeletion = useCallback(async (): Promise<MessageDigestErasure | null> => {
    const existing = recordRef.current;
    if (existing !== null) {
      const mode = existing.erasureRequestId === null ? 'delete' : 'get';
      return await runExclusive(mode, existing, epochRef.current);
    }

    const record: StoredMessageDigestErasureRequest = {
      version: 1,
      authSubject,
      definitionId,
      requestId: newRequestId(),
      erasureRequestId: null,
    };
    recordRef.current = record;
    writeStoredErasureRequest(record);
    pollAttemptRef.current = 0;
    setError(null);
    setIsDeleting(true);
    return await runExclusive('delete', record, epochRef.current);
  }, [authSubject, definitionId, runExclusive]);

  const retry = useCallback(async (): Promise<MessageDigestErasure | null> => {
    const record = recordRef.current;
    if (record === null) return null;
    clearTimer();
    setError(null);
    setIsRecovering(true);
    const mode = record.erasureRequestId === null ? 'delete' : 'get';
    return await runExclusive(mode, record, epochRef.current);
  }, [clearTimer, runExclusive]);

  return { erasure, isDeleting, isRecovering, error, startDeletion, retry };
}

function requireErasureRequestId(record: StoredMessageDigestErasureRequest): string {
  if (record.erasureRequestId === null) {
    throw new Error('Deletion progress is missing its erasure request ID');
  }
  return record.erasureRequestId;
}

function writeStoredErasureRequest(record: StoredMessageDigestErasureRequest): void {
  sessionStorage.setItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY, JSON.stringify(record));
}

function readStoredErasureRequest(authSubject: string): StoredMessageDigestErasureRequest | null {
  const serialized = sessionStorage.getItem(MESSAGE_DIGEST_ERASURE_REQUEST_KEY);
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('authSubject' in value) ||
      typeof value.authSubject !== 'string' ||
      value.authSubject === '' ||
      value.authSubject !== authSubject ||
      !('definitionId' in value) ||
      typeof value.definitionId !== 'string' ||
      value.definitionId === '' ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      value.requestId === '' ||
      !('erasureRequestId' in value) ||
      (value.erasureRequestId !== null &&
        (typeof value.erasureRequestId !== 'string' || value.erasureRequestId === ''))
    ) {
      throw new Error('Invalid erasure request');
    }
    return {
      version: 1,
      authSubject: value.authSubject,
      definitionId: value.definitionId,
      requestId: value.requestId,
      erasureRequestId: value.erasureRequestId,
    };
  } catch {
    removeSessionRequestId(MESSAGE_DIGEST_ERASURE_REQUEST_KEY);
    return null;
  }
}

interface MessageDigestHistoryState {
  items: MessageDigestRun[];
  nextCursor: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refreshError: string | null;
  loadMoreError: string | null;
  activeRequestId: number | null;
}

type MessageDigestHistoryAction =
  | { type: 'reset' }
  | { type: 'request_started'; requestId: number; mode: PageRequestMode }
  | {
      type: 'request_succeeded';
      requestId: number;
      mode: PageRequestMode;
      items: MessageDigestRun[];
      nextCursor: string | null;
    }
  | {
      type: 'request_failed';
      requestId: number;
      mode: PageRequestMode;
      error: string;
    };

const INITIAL_HISTORY_STATE: MessageDigestHistoryState = {
  items: [],
  nextCursor: null,
  isInitialLoading: true,
  isRefreshing: false,
  isLoadingMore: false,
  error: null,
  refreshError: null,
  loadMoreError: null,
  activeRequestId: null,
};

export interface UseMessageDigestHistoryResult {
  items: MessageDigestRun[];
  nextCursor: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refreshError: string | null;
  loadMoreError: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useMessageDigestHistory(
  definitionId: string,
  options: ListMessageDigestRunsOptions = {}
): UseMessageDigestHistoryResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const [state, dispatch] = useReducer(messageDigestHistoryReducer, INITIAL_HISTORY_STATE);
  const requestSequenceRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const appendInFlightRef = useRef(false);
  const requestOptions = useMemo<ListMessageDigestRunsOptions>(
    () => ({
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      limit: options.limit ?? 25,
      ...(options.fromDate === undefined ? {} : { fromDate: options.fromDate }),
      ...(options.toDate === undefined ? {} : { toDate: options.toDate }),
      ...(options.generationStatus === undefined
        ? {}
        : { generationStatus: options.generationStatus }),
      ...(options.deliveryStatus === undefined ? {} : { deliveryStatus: options.deliveryStatus }),
      sort: options.sort ?? 'windowStart',
      direction: options.direction ?? 'desc',
    }),
    [
      options.cursor,
      options.deliveryStatus,
      options.direction,
      options.fromDate,
      options.generationStatus,
      options.limit,
      options.sort,
      options.toDate,
    ]
  );

  const execute = useCallback(
    async (mode: PageRequestMode, cursor?: string): Promise<void> => {
      if (mode === 'append' && appendInFlightRef.current) return;
      if (mode === 'append') appendInFlightRef.current = true;

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      dispatch({ type: 'request_started', requestId, mode });

      try {
        const accessToken = await getAccessToken();
        if (requestSequenceRef.current !== requestId) return;
        const response = await listMessageDigestRuns(
          accessToken,
          definitionId,
          {
            ...requestOptions,
            ...(mode === 'append' && cursor !== undefined ? { cursor } : {}),
          },
          { signal: controller.signal, refreshToken: getAccessToken }
        );
        if (requestSequenceRef.current !== requestId) return;
        dispatch({
          type: 'request_succeeded',
          requestId,
          mode,
          items: response.items,
          nextCursor: response.nextCursor,
        });
      } catch (historyError) {
        if (requestSequenceRef.current !== requestId || controller.signal.aborted) return;
        dispatch({
          type: 'request_failed',
          requestId,
          mode,
          error: getErrorMessage(historyError, 'Failed to load Message Digest history'),
        });
      } finally {
        if (mode === 'append') appendInFlightRef.current = false;
      }
    },
    [definitionId, getAccessToken, requestOptions]
  );

  useEffect(() => {
    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    appendInFlightRef.current = false;
    dispatch({ type: 'reset' });
    void execute('initial');
    return (): void => {
      requestSequenceRef.current += 1;
      abortControllerRef.current?.abort();
      appendInFlightRef.current = false;
    };
  }, [authSubject, execute]);

  const refresh = useCallback(async (): Promise<void> => {
    await execute('refresh');
  }, [execute]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      state.nextCursor === null ||
      state.isInitialLoading ||
      state.isRefreshing ||
      state.isLoadingMore
    ) {
      return;
    }
    await execute('append', state.nextCursor);
  }, [execute, state.isInitialLoading, state.isLoadingMore, state.isRefreshing, state.nextCursor]);

  return {
    items: state.items,
    nextCursor: state.nextCursor,
    isInitialLoading: state.isInitialLoading,
    isRefreshing: state.isRefreshing,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    refreshError: state.refreshError,
    loadMoreError: state.loadMoreError,
    refresh,
    loadMore,
  };
}

function messageDigestHistoryReducer(
  state: MessageDigestHistoryState,
  action: MessageDigestHistoryAction
): MessageDigestHistoryState {
  if (action.type === 'reset') return INITIAL_HISTORY_STATE;
  if (action.type === 'request_started') {
    return {
      ...state,
      activeRequestId: action.requestId,
      isInitialLoading: action.mode === 'initial',
      isRefreshing: action.mode === 'refresh',
      isLoadingMore: action.mode === 'append',
      ...(action.mode === 'initial' ? { items: [], nextCursor: null, error: null } : {}),
      ...(action.mode === 'refresh' ? { refreshError: null } : {}),
      ...(action.mode === 'append' ? { loadMoreError: null } : {}),
    };
  }
  if (state.activeRequestId !== action.requestId) return state;
  if (action.type === 'request_succeeded') {
    return {
      ...state,
      items: action.mode === 'append' ? appendUniqueRuns(state.items, action.items) : action.items,
      nextCursor: action.nextCursor,
      isInitialLoading: false,
      isRefreshing: false,
      isLoadingMore: false,
      error: null,
      refreshError: null,
      loadMoreError: null,
      activeRequestId: null,
    };
  }
  return {
    ...state,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    ...(action.mode === 'initial' ? { error: action.error } : {}),
    ...(action.mode === 'refresh' ? { refreshError: action.error } : {}),
    ...(action.mode === 'append' ? { loadMoreError: action.error } : {}),
    activeRequestId: null,
  };
}

function appendUniqueRuns(
  current: MessageDigestRun[],
  incoming: MessageDigestRun[]
): MessageDigestRun[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

interface UseMessageDigestRunOptions {
  pollBaseMs?: number;
  pollMaxMs?: number;
}

interface MessageDigestRunState {
  run: MessageDigestRun | null;
  isInitialLoading: boolean;
  isPolling: boolean;
  isNotFound: boolean;
  error: string | null;
  pollError: string | null;
}

type MessageDigestRunAction =
  | { type: 'reset' }
  | { type: 'request_succeeded'; run: MessageDigestRun; willPoll: boolean }
  | { type: 'not_found' }
  | { type: 'initial_request_failed'; error: string }
  | { type: 'poll_request_failed'; error: string };

const INITIAL_RUN_STATE: MessageDigestRunState = {
  run: null,
  isInitialLoading: true,
  isPolling: false,
  isNotFound: false,
  error: null,
  pollError: null,
};

export interface UseMessageDigestRunResult extends MessageDigestRunState {
  refresh: () => void;
  retryStage: 'generation' | 'delivery' | null;
  isRetrying: boolean;
  retryError: string | null;
  retryRun: () => Promise<RetryMessageDigestRunResponse | null>;
  clearRetryError: () => void;
}

export function useMessageDigestRun(
  definitionId: string,
  runId: string,
  options: UseMessageDigestRunOptions = {}
): UseMessageDigestRunResult {
  const { getAccessToken, user } = useAuth();
  const authSubject = user?.sub ?? '';
  const pollBaseMs = Math.max(1, options.pollBaseMs ?? 1_000);
  const pollMaxMs = Math.max(pollBaseMs, options.pollMaxMs ?? 10_000);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, dispatch] = useReducer(messageDigestRunReducer, INITIAL_RUN_STATE);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const lifecycleSequenceRef = useRef(0);
  const cancelPollingRef = useRef<() => void>(() => undefined);
  const retrySeedRef = useRef<MessageDigestRun | null>(null);
  const retryLifecycleRef = useRef(0);
  const retryInFlightRef = useRef<Promise<RetryMessageDigestRunResponse | null> | null>(null);

  useEffect(() => {
    retryLifecycleRef.current += 1;
    retryInFlightRef.current = null;
    setIsRetrying(false);
    setRetryError(null);
    const stored = readStoredMessageDigestRunRetryRequest(authSubject);
    if (
      stored !== null &&
      (stored.definitionId !== definitionId || stored.runId !== runId)
    ) {
      removeSessionRequestId(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY);
    }
    return (): void => {
      retryLifecycleRef.current += 1;
      retryInFlightRef.current = null;
    };
  }, [authSubject, definitionId, runId]);

  useEffect(() => {
    const lifecycleId = lifecycleSequenceRef.current + 1;
    lifecycleSequenceRef.current = lifecycleId;
    const seededRun = retrySeedRef.current;
    retrySeedRef.current = null;
    let currentRun: MessageDigestRun | null = seededRun;
    let pollAttempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const cancel = (): void => {
      if (lifecycleSequenceRef.current === lifecycleId) {
        lifecycleSequenceRef.current += 1;
      }
      if (timer !== null) clearTimeout(timer);
      timer = null;
      controller?.abort();
    };
    cancelPollingRef.current = cancel;
    if (seededRun === null) {
      dispatch({ type: 'reset' });
    } else {
      const willPoll = !isMessageDigestRunTerminal(seededRun);
      dispatch({ type: 'request_succeeded', run: seededRun, willPoll });
      if (willPoll) schedulePoll();
    }

    function schedulePoll(): void {
      const delayMs = Math.min(pollBaseMs * 2 ** pollAttempt, pollMaxMs);
      pollAttempt += 1;
      timer = setTimeout(() => {
        timer = null;
        void load(false);
      }, delayMs);
    }

    async function load(initial: boolean): Promise<void> {
      controller = new AbortController();
      try {
        const accessToken = await getAccessToken();
        if (lifecycleSequenceRef.current !== lifecycleId) return;
        const nextRun = await getMessageDigestRun(accessToken, definitionId, runId, {
          signal: controller.signal,
          refreshToken: getAccessToken,
        });
        if (lifecycleSequenceRef.current !== lifecycleId) return;
        currentRun = nextRun;
        const willPoll = !isMessageDigestRunTerminal(nextRun);
        dispatch({ type: 'request_succeeded', run: nextRun, willPoll });
        if (willPoll) schedulePoll();
      } catch (loadError) {
        if (lifecycleSequenceRef.current !== lifecycleId) return;
        if (
          loadError instanceof ApiError &&
          loadError.status === 404 &&
          (initial || currentRun === null)
        ) {
          dispatch({ type: 'not_found' });
          return;
        }
        const message = getErrorMessage(loadError, 'Failed to load Message Digest run');
        if (initial || currentRun === null) {
          dispatch({ type: 'initial_request_failed', error: message });
          return;
        }
        dispatch({ type: 'poll_request_failed', error: message });
        if (!isMessageDigestRunTerminal(currentRun)) schedulePoll();
      }
    }

    if (seededRun === null) void load(true);
    return (): void => {
      cancel();
      if (cancelPollingRef.current === cancel) {
        cancelPollingRef.current = (): void => undefined;
      }
    };
  }, [authSubject, definitionId, getAccessToken, pollBaseMs, pollMaxMs, reloadVersion, runId]);

  const refresh = useCallback((): void => {
    cancelPollingRef.current();
    setReloadVersion((version) => version + 1);
  }, []);

  const retryStage = getMessageDigestRunRetryStage(state.run);
  const retryRun = useCallback((): Promise<RetryMessageDigestRunResponse | null> => {
    if (retryInFlightRef.current !== null) return retryInFlightRef.current;
    const currentRun = state.run;
    const expectedStage = getMessageDigestRunRetryStage(currentRun);
    if (currentRun === null || expectedStage === null) {
      setRetryError('This run cannot be retried safely.');
      return Promise.resolve(null);
    }

    const retryLifecycleId = retryLifecycleRef.current;
    const storedRequest = getOrCreateStoredMessageDigestRunRetryRequest({
      authSubject,
      definitionId,
      runId,
    });
    const request = (async (): Promise<RetryMessageDigestRunResponse | null> => {
      setIsRetrying(true);
      setRetryError(null);
      try {
        const accessToken = await getAccessToken();
        if (retryLifecycleRef.current !== retryLifecycleId) return null;
        const response = await retryMessageDigestRun(
          accessToken,
          definitionId,
          runId,
          storedRequest.requestId,
          { refreshToken: getAccessToken }
        );
        if (retryLifecycleRef.current !== retryLifecycleId) return null;
        if (
          response.stage !== expectedStage ||
          response.run.id !== runId ||
          response.run.definitionId !== definitionId
        ) {
          throw new Error('Invalid Message Digest retry response');
        }
        removeSessionRequestId(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY);
        cancelPollingRef.current();
        retrySeedRef.current = response.run;
        setReloadVersion((version) => version + 1);
        return response;
      } catch (error) {
        if (retryLifecycleRef.current === retryLifecycleId) {
          setRetryError(getErrorMessage(error, 'Failed to retry Message Digest run'));
        }
        return null;
      } finally {
        if (retryLifecycleRef.current === retryLifecycleId) setIsRetrying(false);
      }
    })();
    retryInFlightRef.current = request;
    void request.finally(() => {
      if (retryInFlightRef.current === request) retryInFlightRef.current = null;
    });
    return request;
  }, [authSubject, definitionId, getAccessToken, runId, state.run]);

  const clearRetryError = useCallback((): void => {
    setRetryError(null);
  }, []);

  return {
    ...state,
    refresh,
    retryStage,
    isRetrying,
    retryError,
    retryRun,
    clearRetryError,
  };
}

function messageDigestRunReducer(
  state: MessageDigestRunState,
  action: MessageDigestRunAction
): MessageDigestRunState {
  if (action.type === 'reset') return INITIAL_RUN_STATE;
  if (action.type === 'request_succeeded') {
    return {
      run: action.run,
      isInitialLoading: false,
      isPolling: action.willPoll,
      isNotFound: false,
      error: null,
      pollError: null,
    };
  }
  if (action.type === 'not_found') {
    return {
      run: null,
      isInitialLoading: false,
      isPolling: false,
      isNotFound: true,
      error: null,
      pollError: null,
    };
  }
  if (action.type === 'initial_request_failed') {
    return {
      ...state,
      isInitialLoading: false,
      isPolling: false,
      isNotFound: false,
      error: action.error,
    };
  }
  return {
    ...state,
    isInitialLoading: false,
    isPolling: true,
    pollError: action.error,
  };
}

function isMessageDigestRunTerminal(run: MessageDigestRun): boolean {
  if (run.generationStatus === 'queued' || run.generationStatus === 'processing') return false;
  if (run.generationStatus !== 'completed') return true;
  return run.delivery.status !== 'pending';
}

const RETRYABLE_MESSAGE_DIGEST_GENERATION_FAILURES = new Set([
  'SOURCE_NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_CHANGED',
  'READINESS_UNAVAILABLE',
  'DELIVERY_NOT_READY',
  'READINESS_CHANGED',
  'LLM_UNAVAILABLE',
]);

const RETRYABLE_MESSAGE_DIGEST_DELIVERY_FAILURES = new Set([
  'MAPPING_MISSING',
  'DISCONNECTED',
  'DELIVERY_DISABLED',
  'PROVIDER_REJECTED',
]);

function getMessageDigestRunRetryStage(
  run: MessageDigestRun | null
): 'generation' | 'delivery' | null {
  if (
    run?.generationStatus === 'failed' &&
    run.safeFailureCode !== null &&
    RETRYABLE_MESSAGE_DIGEST_GENERATION_FAILURES.has(run.safeFailureCode)
  ) {
    return 'generation';
  }
  if (
    run?.generationStatus === 'completed' &&
    run.delivery.status === 'failed' &&
    run.delivery.failureCode !== null &&
    RETRYABLE_MESSAGE_DIGEST_DELIVERY_FAILURES.has(run.delivery.failureCode)
  ) {
    return 'delivery';
  }
  return null;
}

interface StoredMessageDigestRunRetryRequest {
  version: 1;
  authSubject: string;
  definitionId: string;
  runId: string;
  requestId: string;
}

function getOrCreateStoredMessageDigestRunRetryRequest(input: {
  authSubject: string;
  definitionId: string;
  runId: string;
}): StoredMessageDigestRunRetryRequest {
  const existing = readStoredMessageDigestRunRetryRequest(input.authSubject);
  if (
    existing !== null &&
    existing.definitionId === input.definitionId &&
    existing.runId === input.runId
  ) {
    return existing;
  }
  const record: StoredMessageDigestRunRetryRequest = {
    version: 1,
    authSubject: input.authSubject,
    definitionId: input.definitionId,
    runId: input.runId,
    requestId: newRequestId(),
  };
  sessionStorage.setItem(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY, JSON.stringify(record));
  return record;
}

function readStoredMessageDigestRunRetryRequest(
  authSubject: string
): StoredMessageDigestRunRetryRequest | null {
  const serialized = sessionStorage.getItem(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY);
  if (serialized === null) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('authSubject' in value) ||
      typeof value.authSubject !== 'string' ||
      value.authSubject !== authSubject ||
      !('definitionId' in value) ||
      typeof value.definitionId !== 'string' ||
      value.definitionId === '' ||
      !('runId' in value) ||
      typeof value.runId !== 'string' ||
      value.runId === '' ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string' ||
      value.requestId === ''
    ) {
      throw new Error('Invalid run retry request');
    }
    return {
      version: 1,
      authSubject: value.authSubject,
      definitionId: value.definitionId,
      runId: value.runId,
      requestId: value.requestId,
    };
  } catch {
    removeSessionRequestId(MESSAGE_DIGEST_RUN_RETRY_REQUEST_KEY);
    return null;
  }
}

function messageDigestListReducer(
  state: MessageDigestListState,
  action: MessageDigestListAction
): MessageDigestListState {
  if (action.type === 'reset') return INITIAL_LIST_STATE;
  if (action.type === 'request_started') {
    return {
      ...state,
      activeRequestId: action.requestId,
      isInitialLoading: action.mode === 'initial',
      isRefreshing: action.mode === 'refresh',
      isLoadingMore: action.mode === 'append',
      ...(action.mode === 'initial' ? { items: [], nextCursor: null, error: null } : {}),
      ...(action.mode === 'refresh' ? { refreshError: null } : {}),
      ...(action.mode === 'append' ? { loadMoreError: null } : {}),
    };
  }
  if (state.activeRequestId !== action.requestId) return state;
  if (action.type === 'request_succeeded') {
    return {
      ...state,
      items:
        action.mode === 'append'
          ? appendUniqueDefinitions(state.items, action.items)
          : action.items,
      nextCursor: action.nextCursor,
      isInitialLoading: false,
      isRefreshing: false,
      isLoadingMore: false,
      error: null,
      refreshError: null,
      loadMoreError: null,
      activeRequestId: null,
    };
  }
  return {
    ...state,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    ...(action.mode === 'initial' ? { error: action.error } : {}),
    ...(action.mode === 'refresh' ? { refreshError: action.error } : {}),
    ...(action.mode === 'append' ? { loadMoreError: action.error } : {}),
    activeRequestId: null,
  };
}

function appendUniqueDefinitions(
  current: MessageDigestDefinition[],
  incoming: MessageDigestDefinition[]
): MessageDigestDefinition[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
