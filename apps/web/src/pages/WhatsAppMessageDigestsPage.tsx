import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import type { MessageDigestLifecycleActivation } from '@/components/message-digests/MessageDigestActionsMenu';
import { MessageDigestList } from '@/components/message-digests/MessageDigestList';
import {
  getMessageDigestDeleteDisabledReason,
  getMessageDigestLifecycleDisabledReason,
  getMessageDigestRunDisabledReasonWithRecoveryFence,
} from '@/components/message-digests/messageDigestLifecycle';
import {
  useMessageDigestCommands,
  useMessageDigestDeliveryReadiness,
  useMessageDigestList,
  useMessageDigestSourceAvailability,
} from '@/hooks/useMessageDigests';
import type {
  ListMessageDigestsOptions,
  MessageDigestChatType,
  MessageDigestDefinition,
} from '@/types/messageDigests';

type DigestStatusFilter = NonNullable<ListMessageDigestsOptions['status']>;
type DigestSort = NonNullable<ListMessageDigestsOptions['sort']>;
type SortDirection = NonNullable<ListMessageDigestsOptions['direction']>;

interface SortSelection {
  sort: DigestSort;
  direction: SortDirection;
}

interface DigestListUrlState extends SortSelection {
  query: string;
  status: DigestStatusFilter | undefined;
  chatType: MessageDigestChatType | undefined;
}

interface LifecycleFocusCandidate {
  definitionId: string;
  queryRevision: number;
}

const DEFAULT_SORT: SortSelection = { sort: 'updatedAt', direction: 'desc' };
const DEFAULT_LIST_STATE: DigestListUrlState = {
  query: '',
  status: undefined,
  chatType: undefined,
  ...DEFAULT_SORT,
};
const VALID_STATUSES = new Set<DigestStatusFilter>(['active', 'paused', 'needs_attention']);
const VALID_CHAT_TYPES = new Set<MessageDigestChatType>(['group', 'direct']);
const VALID_SORTS = new Set<DigestSort>(['name', 'updatedAt', 'nextRunAt']);
const VALID_DIRECTIONS = new Set<SortDirection>(['asc', 'desc']);

export function WhatsAppMessageDigestsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const intent = readListIntent(location.state);
  const listState = useMemo(() => parseDigestListUrl(searchParams), [searchParams]);
  const canonicalSearchParams = useMemo(
    () => serializeDigestListUrl(listState),
    [listState]
  );
  const { query, status, chatType, sort, direction } = listState;
  const sortBeforeSearchRef = useRef<SortSelection>(DEFAULT_SORT);
  const queryCommitTimerRef = useRef<number | null>(null);
  const [rawQuery, setRawQuery] = useState(query);

  useEffect(() => {
    if (searchParams.toString() === canonicalSearchParams.toString()) return;
    setSearchParams(canonicalSearchParams, { replace: true });
  }, [canonicalSearchParams, searchParams, setSearchParams]);

  useEffect(() => {
    if (queryCommitTimerRef.current !== null) {
      window.clearTimeout(queryCommitTimerRef.current);
      queryCommitTimerRef.current = null;
    }
    setRawQuery(query);
    if (query === '') sortBeforeSearchRef.current = { sort, direction };
  }, [direction, location.search, query, sort]);

  useEffect(() => {
    return (): void => {
      if (queryCommitTimerRef.current !== null) {
        window.clearTimeout(queryCommitTimerRef.current);
      }
    };
  }, []);

  const listOptions = useMemo<ListMessageDigestsOptions>(() => {
    return {
      ...(query === '' ? {} : { query }),
      ...(chatType === undefined ? {} : { chatType }),
      ...(status === undefined ? {} : { status }),
      sort,
      direction,
    };
  }, [chatType, direction, query, sort, status]);
  const list = useMessageDigestList(listOptions);
  const delivery = useMessageDigestDeliveryReadiness();
  const source = useMessageDigestSourceAvailability();
  const commands = useMessageDigestCommands();
  const [lifecyclePending, setLifecyclePending] = useState<
    Record<string, 'pause' | 'resume'>
  >({});
  const [lifecycleErrors, setLifecycleErrors] = useState<Record<string, string>>({});
  const [lifecycleRefreshRequired, setLifecycleRefreshRequired] = useState<
    Record<string, true>
  >({});
  const [lifecycleFocusCandidate, setLifecycleFocusCandidate] =
    useState<LifecycleFocusCandidate | null>(null);
  const [lifecycleHeadingFocusRevision, setLifecycleHeadingFocusRevision] = useState(0);
  const lastConfirmedQueryRevisionRef = useRef<number | null>(null);
  const latestListRefreshWithOutcomeRef = useRef(list.refreshWithOutcome);
  useLayoutEffect(() => {
    latestListRefreshWithOutcomeRef.current = list.refreshWithOutcome;
  }, [list.refreshWithOutcome]);

  useEffect(() => {
    const revision = list.confirmedCurrentQueryRevision;
    if (revision === null || lastConfirmedQueryRevisionRef.current === revision) return;
    if (lastConfirmedQueryRevisionRef.current === null) {
      lastConfirmedQueryRevisionRef.current = revision;
      return;
    }
    lastConfirmedQueryRevisionRef.current = revision;
    setLifecycleErrors({});
    setLifecycleRefreshRequired({});
  }, [list.confirmedCurrentQueryRevision]);

  useEffect(() => {
    if (lifecycleFocusCandidate === null) return;
    if (lifecycleFocusCandidate.queryRevision !== list.currentQueryRevision) {
      setLifecycleFocusCandidate(null);
      return;
    }
    if (list.isInitialLoading || list.isRefreshing) return;

    setLifecycleFocusCandidate(null);
    if (!list.items.some((item) => item.id === lifecycleFocusCandidate.definitionId)) {
      setLifecycleHeadingFocusRevision((current) => current + 1);
    }
  }, [
    lifecycleFocusCandidate,
    list.currentQueryRevision,
    list.isInitialLoading,
    list.isRefreshing,
    list.items,
  ]);

  const applyQueryTransition = (
    nextState: DigestListUrlState,
    nextQuery: string
  ): DigestListUrlState => {
    const normalizedQuery = normalizeDigestQuery(nextQuery);
    if (normalizedQuery === query) return { ...nextState, query: normalizedQuery };
    const wasSearching = query !== '';
    const willSearch = normalizedQuery !== '';
    let nextSort: SortSelection = { sort: nextState.sort, direction: nextState.direction };
    if (!wasSearching && willSearch) {
      sortBeforeSearchRef.current = {
        sort: nextState.sort,
        direction: nextState.direction,
      };
      nextSort = { sort: 'name', direction: 'asc' };
    } else if (wasSearching && !willSearch) {
      nextSort = sortBeforeSearchRef.current;
    }
    return { ...nextState, query: normalizedQuery, ...nextSort };
  };

  const handleQueryChange = (nextQuery: string): void => {
    setRawQuery(nextQuery);
    if (queryCommitTimerRef.current !== null) {
      window.clearTimeout(queryCommitTimerRef.current);
    }
    queryCommitTimerRef.current = window.setTimeout(() => {
      queryCommitTimerRef.current = null;
      const nextState = applyQueryTransition(listState, nextQuery);
      if (nextState.query === query) return;
      setSearchParams(
        serializeDigestListUrl(nextState),
        { replace: true }
      );
    }, 300);
  };

  const clearFilters = (): void => {
    if (queryCommitTimerRef.current !== null) {
      window.clearTimeout(queryCommitTimerRef.current);
      queryCommitTimerRef.current = null;
    }
    setRawQuery('');
    sortBeforeSearchRef.current = DEFAULT_SORT;
    setSearchParams(serializeDigestListUrl(DEFAULT_LIST_STATE));
  };

  const setDiscreteListState = (nextState: DigestListUrlState): void => {
    if (queryCommitTimerRef.current !== null) {
      window.clearTimeout(queryCommitTimerRef.current);
      queryCommitTimerRef.current = null;
    }
    const committedState = applyQueryTransition(nextState, rawQuery);
    setRawQuery(committedState.query);
    setSearchParams(serializeDigestListUrl(committedState));
  };

  const refreshAll = async (): Promise<void> => {
    const [listRefreshed] = await Promise.all([
      list.refreshWithResult(),
      delivery.refresh(),
      source.refresh(),
    ]);
    if (listRefreshed) {
      setLifecycleErrors({});
      setLifecycleRefreshRequired({});
    }
  };

  const retrySetup = async (): Promise<void> => {
    await Promise.all([delivery.refresh(), source.refresh()]);
  };

  const openDeleteFlow = (definition: MessageDigestDefinition): void => {
    if (
      getMessageDigestDeleteDisabledReason(
        definition.id,
        commands.pendingRunRecoveryDefinitionId
      ) !== null
    ) {
      return;
    }
    void navigate(`/whatsapp/message-digests/${definition.id}`, {
      state: {
        openDelete: true,
        returnTo: '/whatsapp/message-digests',
      },
    });
  };

  const openRunFlow = (definition: MessageDigestDefinition): void => {
    const disabledReason = getMessageDigestRunDisabledReasonWithRecoveryFence(
      definition,
      {
        sourceAvailability: source.availability,
        sourceIsRefreshing: source.isRefreshing,
        sourceAvailabilityError: source.error,
        deliveryReadiness: delivery.readiness,
        deliveryIsLoading: delivery.isLoading,
        deliveryIsRefreshing: delivery.isRefreshing,
        deliveryReadinessError: delivery.error,
      },
      commands.pendingRunRecoveryDefinitionId
    );
    if (disabledReason !== null) return;
    void navigate(`/whatsapp/message-digests/${definition.id}`, {
      state: {
        openRun: true,
        returnTo: '/whatsapp/message-digests',
      },
    });
  };

  const toggleLifecycle = async (
    definition: MessageDigestDefinition,
    activation: MessageDigestLifecycleActivation = 'pointer'
  ): Promise<void> => {
    if (
      lifecyclePending[definition.id] !== undefined ||
      lifecycleRefreshRequired[definition.id] === true ||
      definition.status === 'deleting'
    ) {
      return;
    }
    const action = definition.status === 'paused' ? 'resume' : 'pause';
    const lifecycleDisabledReason = getMessageDigestLifecycleDisabledReason(definition, {
      sourceAvailability: source.availability,
      sourceIsRefreshing: source.isRefreshing,
      sourceAvailabilityError: source.error,
      deliveryReadiness: delivery.readiness,
      deliveryIsLoading: delivery.isLoading,
      deliveryIsRefreshing: delivery.isRefreshing,
      deliveryReadinessError: delivery.error,
    });
    if (action === 'resume' && lifecycleDisabledReason !== null) {
      setLifecycleErrors((current) => ({
        ...current,
        [definition.id]: lifecycleDisabledReason,
      }));
      return;
    }
    const nextStatus = action === 'resume' ? 'active' : 'paused';
    commands.clearError();
    setLifecycleErrors((current) => {
      const next = { ...current };
      Reflect.deleteProperty(next, definition.id);
      return next;
    });
    setLifecyclePending((current) => ({ ...current, [definition.id]: action }));
    try {
      let updated: MessageDigestDefinition | null = null;
      try {
        updated = await commands.updateDigest(definition.id, {
          expectedRevision: definition.revision,
          patch: { status: nextStatus },
        });
      } catch {
        updated = null;
      }
      let refreshOutcome: 'succeeded' | 'failed' | 'stale' = 'failed';
      try {
        refreshOutcome = await latestListRefreshWithOutcomeRef.current();
      } catch {
        refreshOutcome = 'failed';
      }
      if (refreshOutcome === 'stale') return;
      const refreshed = refreshOutcome === 'succeeded';
      if (updated !== null && refreshed && activation === 'keyboard') {
        setLifecycleFocusCandidate({
          definitionId: definition.id,
          queryRevision: list.currentQueryRevision,
        });
      }
      if (updated === null) {
        setLifecycleErrors((current) => ({
          ...current,
          [definition.id]: refreshed
            ? 'The latest state is loaded. Review it and try again.'
            : 'Refresh the list to load the latest state, then try again.',
        }));
      } else if (!refreshed) {
        setLifecycleRefreshRequired((current) => ({
          ...current,
          [definition.id]: true,
        }));
        setLifecycleErrors((current) => ({
          ...current,
          [definition.id]: 'Refresh failed. Refresh the list to load the new state.',
        }));
      }
    } finally {
      setLifecyclePending((current) => {
        const next = { ...current };
        Reflect.deleteProperty(next, definition.id);
        return next;
      });
    }
  };

  return (
    <Layout>
      <MessageDigestList
        focusHeading={intent.focusHeading}
        focusHeadingRevision={lifecycleHeadingFocusRevision}
        notice={intent.notice ?? (intent.deleted ? 'Message Digest deleted' : null)}
        items={list.items}
        nextCursor={list.nextCursor}
        isInitialLoading={list.isInitialLoading}
        isRefreshing={list.isRefreshing || delivery.isRefreshing || source.isRefreshing}
        isLoadingMore={list.isLoadingMore}
        error={list.error}
        refreshError={list.refreshError}
        loadMoreError={list.loadMoreError}
        query={query}
        queryInput={rawQuery}
        status={status}
        chatType={chatType}
        sort={sort}
        direction={direction}
        sourceAvailability={source.availability}
        sourceIsRefreshing={source.isRefreshing}
        sourceAvailabilityError={source.error}
        deliveryReadiness={delivery.readiness}
        deliveryIsLoading={delivery.isLoading}
        deliveryIsRefreshing={delivery.isRefreshing}
        deliveryReadinessError={delivery.error}
        pendingRunRecoveryDefinitionId={commands.pendingRunRecoveryDefinitionId}
        lifecyclePending={lifecyclePending}
        lifecycleErrors={lifecycleErrors}
        lifecycleRefreshRequired={lifecycleRefreshRequired}
        onQueryChange={handleQueryChange}
        onStatusChange={(nextStatus): void => {
          setDiscreteListState({ ...listState, status: nextStatus });
        }}
        onChatTypeChange={(nextChatType): void => {
          setDiscreteListState({ ...listState, chatType: nextChatType });
        }}
        onSortChange={(nextSort): void => {
          setDiscreteListState({ ...listState, sort: nextSort });
        }}
        onDirectionChange={(nextDirection): void => {
          if (query !== '') return;
          setDiscreteListState({ ...listState, direction: nextDirection });
        }}
        onClearFilters={clearFilters}
        onRefresh={refreshAll}
        onRetrySetup={retrySetup}
        onLoadMore={list.loadMore}
        onToggleLifecycle={(definition, activation): void => {
          void toggleLifecycle(definition, activation);
        }}
        onRun={openRunFlow}
        onDelete={openDeleteFlow}
      />
    </Layout>
  );
}

function parseDigestListUrl(searchParams: URLSearchParams): DigestListUrlState {
  const query = (searchParams.get('query') ?? '').trim();
  const rawStatus = searchParams.get('status');
  const rawChatType = searchParams.get('chatType');
  const rawSort = searchParams.get('sort');
  const rawDirection = searchParams.get('direction');
  const status = isSetMember(VALID_STATUSES, rawStatus) ? rawStatus : undefined;
  const chatType = isSetMember(VALID_CHAT_TYPES, rawChatType) ? rawChatType : undefined;

  if (query !== '') {
    return { query, status, chatType, sort: 'name', direction: 'asc' };
  }

  return {
    query,
    status,
    chatType,
    sort: isSetMember(VALID_SORTS, rawSort) ? rawSort : DEFAULT_SORT.sort,
    direction: isSetMember(VALID_DIRECTIONS, rawDirection)
      ? rawDirection
      : DEFAULT_SORT.direction,
  };
}

function serializeDigestListUrl(state: DigestListUrlState): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (state.query !== '') searchParams.set('query', state.query);
  if (state.status !== undefined) searchParams.set('status', state.status);
  if (state.chatType !== undefined) searchParams.set('chatType', state.chatType);
  if (state.sort !== DEFAULT_SORT.sort) searchParams.set('sort', state.sort);
  if (state.direction !== DEFAULT_SORT.direction) {
    searchParams.set('direction', state.direction);
  }
  return searchParams;
}

function normalizeDigestQuery(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function isSetMember<T extends string>(values: ReadonlySet<T>, value: string | null): value is T {
  return value !== null && values.has(value as T);
}

function readListIntent(state: unknown): {
  deleted: boolean;
  focusHeading: boolean;
  notice: string | null;
} {
  if (typeof state !== 'object' || state === null) {
    return { deleted: false, focusHeading: false, notice: null };
  }
  const record = state as Record<string, unknown>;
  const legacyNotice =
    record['messageDigestNotice'] ===
    'No matching WhatsApp Message Digest was found for this legacy link.'
      ? record['messageDigestNotice']
      : null;
  return {
    deleted: record['deleted'] === true,
    focusHeading: record['focusHeading'] === true,
    notice: legacyNotice,
  };
}
