import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageCircleMore,
  Newspaper,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type {
  MessageDigestChatType,
  MessageDigestDefinition,
  MessageDigestDeliveryReadiness,
  MessageDigestEffectiveStatus,
} from '@/types/messageDigests';
import {
  formatMessageDigestDateTime,
  getMessageDigestGenerationStatusLabel,
  getMessageDigestScheduleLabel,
  getMessageDigestSourceTypeLabel,
  getMessageDigestStatusLabel,
  maskMessageDigestPrimaryNumber,
} from '@/types/messageDigests';
import {
  MessageDigestActionsMenu,
  type MessageDigestLifecycleActivation,
} from './MessageDigestActionsMenu.js';
import {
  getMessageDigestDeleteDisabledReason,
  getMessageDigestLifecycleDisabledReason,
  getMessageDigestRunDisabledReasonWithRecoveryFence,
  isMessageDigestSourceAttentionBlocker,
  type MessageDigestLifecycleContext,
  type MessageDigestSourceAvailability,
} from './messageDigestLifecycle.js';

type MessageDigestListStatusFilter = 'active' | 'paused' | 'needs_attention';
type MessageDigestListSort = 'name' | 'updatedAt' | 'nextRunAt';
type SortDirection = 'asc' | 'desc';

export interface MessageDigestListProps {
  focusHeading?: boolean;
  focusHeadingRevision?: number;
  notice?: string | null;
  items: MessageDigestDefinition[];
  nextCursor: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refreshError: string | null;
  loadMoreError: string | null;
  query: string;
  queryInput?: string;
  status: MessageDigestListStatusFilter | undefined;
  chatType: MessageDigestChatType | undefined;
  sort: MessageDigestListSort;
  direction: SortDirection;
  sourceAvailability: MessageDigestSourceAvailability;
  sourceIsRefreshing: boolean;
  sourceAvailabilityError: string | null;
  deliveryReadiness: MessageDigestDeliveryReadiness | null;
  deliveryIsLoading: boolean;
  deliveryIsRefreshing: boolean;
  deliveryReadinessError: string | null;
  pendingRunRecoveryDefinitionId: string | null;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: MessageDigestListStatusFilter | undefined) => void;
  onChatTypeChange: (chatType: MessageDigestChatType | undefined) => void;
  onSortChange: (sort: MessageDigestListSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  onClearFilters: () => void;
  onRefresh: () => Promise<void>;
  onRetrySetup: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  lifecyclePending: Readonly<Record<string, 'pause' | 'resume'>>;
  lifecycleErrors: Readonly<Record<string, string>>;
  lifecycleRefreshRequired: Readonly<Record<string, true>>;
  onToggleLifecycle: (
    definition: MessageDigestDefinition,
    activation?: MessageDigestLifecycleActivation
  ) => void;
  onRun: (definition: MessageDigestDefinition) => void;
  onDelete: (definition: MessageDigestDefinition) => void;
}

const STATUS_FILTERS: readonly {
  value: MessageDigestListStatusFilter | undefined;
  label: string;
}[] = [
  { value: undefined, label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'needs_attention', label: 'Needs attention' },
];

export function MessageDigestList(props: MessageDigestListProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const hasFilters =
    props.query.trim() !== '' ||
    props.status !== undefined ||
    props.chatType !== undefined ||
    props.sort !== 'updatedAt' ||
    props.direction !== 'desc';
  const hasRows = props.items.length > 0;
  const showInitialError = !props.isInitialLoading && !hasRows && props.error !== null;
  const lifecycleContext: MessageDigestLifecycleContext = {
    sourceAvailability: props.sourceAvailability,
    sourceIsRefreshing: props.sourceIsRefreshing,
    sourceAvailabilityError: props.sourceAvailabilityError,
    deliveryReadiness: props.deliveryReadiness,
    deliveryIsLoading: props.deliveryIsLoading,
    deliveryIsRefreshing: props.deliveryIsRefreshing,
    deliveryReadinessError: props.deliveryReadinessError,
  };

  useEffect(() => {
    if (props.focusHeading === true || (props.focusHeadingRevision ?? 0) > 0) {
      headingRef.current?.focus();
    }
  }, [props.focusHeading, props.focusHeadingRevision]);

  return (
    <section
      className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5"
      aria-labelledby="page-title"
    >
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1
            ref={headingRef}
            id="page-title"
            tabIndex={-1}
            className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50"
          >
            <Newspaper
              aria-hidden="true"
              className="h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400"
            />
            Message Digests
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Turn a WhatsApp group or direct conversation into a focused scheduled summary, delivered
            to your primary WhatsApp.
          </p>
        </div>
        <div className="flex flex-col gap-2 xs:flex-row sm:shrink-0">
          <button
            type="button"
            disabled={props.isRefreshing}
            aria-label={
              props.isRefreshing ? 'Refreshing Message Digests' : 'Refresh Message Digests'
            }
            onClick={(): void => void props.onRefresh()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${props.isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
            />
            {props.isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link
            to="/whatsapp/message-digests/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New digest
          </Link>
        </div>
      </header>

      {props.notice !== undefined && props.notice !== null ? (
        <p
          role="status"
          aria-label="Message Digest update"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {props.notice}
        </p>
      ) : null}

      <SetupState {...props} />

      {props.pendingRunRecoveryDefinitionId !== null ? (
        <div
          role="status"
          aria-label="Pending Message Digest run"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-semibold">One Message Digest run still needs recovery.</p>
            <p className="mt-1 leading-6">Finish it before starting another digest run.</p>
          </div>
          <Link
            to={`/whatsapp/message-digests/${props.pendingRunRecoveryDefinitionId}`}
            state={{ openRun: true, focusHeading: true }}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
          >
            Recover pending run
          </Link>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Search digests
              </span>
              <span className="relative block">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  aria-label="Search digests"
                  value={props.queryInput ?? props.query}
                  onChange={(event): void => {
                    props.onQueryChange(event.target.value);
                  }}
                  placeholder="Search by digest name"
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </span>
            </label>
            <label className="lg:w-52">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Conversation type
              </span>
              <select
                aria-label="Conversation type"
                value={props.chatType ?? ''}
                onChange={(event): void => {
                  props.onChatTypeChange(
                    event.target.value === ''
                      ? undefined
                      : (event.target.value as MessageDigestChatType)
                  );
                }}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">All conversations</option>
                <option value="group">Groups</option>
                <option value="direct">Direct</option>
              </select>
            </label>
            <div className="flex min-w-0 items-end gap-2 lg:w-64">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Sort by
                </span>
                <select
                  aria-label="Sort by"
                  disabled={props.query.trim() !== ''}
                  value={props.sort}
                  onChange={(event): void => {
                    props.onSortChange(event.target.value as MessageDigestListSort);
                  }}
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800"
                >
                  <option value="updatedAt">Recently updated</option>
                  <option value="nextRunAt">Next delivery</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <button
                type="button"
                disabled={props.query.trim() !== ''}
                aria-label={props.direction === 'asc' ? 'Sort descending' : 'Sort ascending'}
                onClick={(): void => {
                  props.onDirectionChange(props.direction === 'asc' ? 'desc' : 'asc');
                }}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                {props.direction === 'asc' ? (
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="Digest status" className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value ?? 'all'}
                  type="button"
                  aria-pressed={props.status === filter.value}
                  onClick={(): void => {
                    props.onStatusChange(filter.value);
                  }}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    props.status === filter.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {hasFilters ? (
              <button
                type="button"
                aria-label="Clear all filters"
                onClick={props.onClearFilters}
                className="inline-flex min-h-11 items-center justify-center self-start rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40 sm:self-auto"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <p
            role="status"
            aria-label="Current sort"
            className="text-xs text-slate-500 dark:text-slate-400"
          >
            {props.query.trim() !== ''
              ? 'Search results are sorted by name, ascending, for stable pagination.'
              : `Sorted by ${getSortLabel(props.sort)}, ${props.direction === 'asc' ? 'ascending' : 'descending'}.`}
          </p>
        </div>
      </div>

      {props.isInitialLoading ? <MessageDigestListSkeleton /> : null}

      {showInitialError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/30"
        >
          <p className="font-semibold text-red-900 dark:text-red-200">
            Couldn’t load Message Digests
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{props.error}</p>
          <button
            type="button"
            onClick={(): void => void props.onRefresh()}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            Try again
          </button>
        </div>
      ) : null}

      {!props.isInitialLoading && !showInitialError && !hasRows ? (
        hasFilters ? (
          <FilteredEmptyState onClearFilters={props.onClearFilters} />
        ) : (
          <FirstUseEmptyState />
        )
      ) : null}

      {!props.isInitialLoading && hasRows ? (
        <>
          {props.refreshError !== null || props.loadMoreError !== null ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {props.refreshError !== null ? <p>Refresh failed: {props.refreshError}</p> : null}
              {props.loadMoreError !== null ? (
                <p>More results failed: {props.loadMoreError}</p>
              ) : null}
            </div>
          ) : null}
          <div data-testid="message-digest-results" aria-busy={props.isRefreshing}>
            <LifecycleFeedback
              items={props.items}
              pending={props.lifecyclePending}
              errors={props.lifecycleErrors}
              refreshRequired={props.lifecycleRefreshRequired}
            />
            <DesktopDigestTable
              items={props.items}
              sort={props.sort}
              direction={props.direction}
              sortDisabled={props.query.trim() !== ''}
              lifecyclePending={props.lifecyclePending}
              lifecycleRefreshRequired={props.lifecycleRefreshRequired}
              lifecycleContext={lifecycleContext}
              pendingRunRecoveryDefinitionId={props.pendingRunRecoveryDefinitionId}
              onSortChange={props.onSortChange}
              onDirectionChange={props.onDirectionChange}
              onToggleLifecycle={props.onToggleLifecycle}
              onRun={props.onRun}
              onDelete={props.onDelete}
            />
            <MobileDigestCards
              items={props.items}
              lifecyclePending={props.lifecyclePending}
              lifecycleRefreshRequired={props.lifecycleRefreshRequired}
              lifecycleContext={lifecycleContext}
              pendingRunRecoveryDefinitionId={props.pendingRunRecoveryDefinitionId}
              onToggleLifecycle={props.onToggleLifecycle}
              onRun={props.onRun}
              onDelete={props.onDelete}
            />
          </div>
          {props.nextCursor !== null ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={props.isLoadingMore}
                onClick={(): void => void props.onLoadMore()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {props.isLoadingMore ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                {props.isLoadingMore ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SetupState(props: MessageDigestListProps): React.JSX.Element | null {
  if (props.sourceAvailability === 'missing') {
    return (
      <SetupBanner
        title="Connect Private WhatsApp Mirror"
        description="Message Digests read conversations from your private WhatsApp mirror. Connect it before creating a digest."
      />
    );
  }
  if (props.sourceAvailability === 'unavailable' || props.sourceAvailabilityError !== null) {
    return (
      <SetupBanner
        title="Private WhatsApp Mirror status unavailable"
        description="We couldn’t confirm that conversation history is available. Existing digests remain unchanged."
        retry={props.onRetrySetup}
      />
    );
  }
  if (props.deliveryReadinessError !== null) {
    return (
      <SetupBanner
        title="WhatsApp delivery status unavailable"
        description="We couldn’t confirm the destination for new summaries. Retry before creating or running a digest."
        retry={props.onRetrySetup}
      />
    );
  }
  if (props.deliveryReadiness === null || props.deliveryReadiness.status === 'ready') {
    if (props.deliveryReadiness?.status !== 'ready') return null;
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">
          Summaries deliver to{' '}
          {maskMessageDigestPrimaryNumber(props.deliveryReadiness.maskedPrimaryNumber)}.
        </span>
      </div>
    );
  }
  const copy = {
    mapping_missing: 'No primary WhatsApp number is mapped',
    disconnected: 'WhatsApp delivery is disconnected',
    delivery_disabled: 'WhatsApp delivery is disabled',
  }[props.deliveryReadiness.status];
  return (
    <SetupBanner
      title={copy}
      description="New digests will stay paused until WhatsApp delivery is ready. No separate recipient is configured here."
    />
  );
}

function SetupBanner({
  title,
  description,
  retry,
}: {
  title: string;
  description: string;
  retry?: () => Promise<void>;
}): React.JSX.Element {
  return (
    <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0">
          <h2 className="font-semibold text-amber-950 dark:text-amber-100">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
        {retry !== undefined ? (
          <button
            type="button"
            onClick={(): void => void retry()}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 dark:text-amber-100 dark:hover:bg-amber-900/50"
          >
            Retry setup checks
          </button>
        ) : null}
        <Link
          to="/settings/whatsapp"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-900 px-3 text-sm font-semibold text-white hover:bg-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100 dark:focus:ring-offset-slate-900"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
          Open WhatsApp settings
        </Link>
      </div>
    </aside>
  );
}

function MessageDigestListSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading Message Digests" className="grid gap-3 md:grid-cols-3">
      <span className="sr-only">Loading Message Digests…</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          data-testid="message-digest-skeleton"
          className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white p-5 motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-4 h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-4/5 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

function FirstUseEmptyState(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <Newspaper aria-hidden="true" className="mx-auto h-9 w-9 text-blue-500" />
      <h2 className="mt-4 text-lg font-semibold text-slate-950 dark:text-slate-50">
        No digests yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">
        Create a daily summary for a WhatsApp group or person, with instructions tailored to what
        matters to you.
      </p>
      <Link
        to="/whatsapp/message-digests/new"
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Create your first digest
      </Link>
    </div>
  );
}

function FilteredEmptyState({ onClearFilters }: { onClearFilters: () => void }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      <Search aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
      <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">
        No digests match these filters
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Try another name, status, or conversation type.
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        Clear filters
      </button>
    </div>
  );
}

function LifecycleFeedback({
  items,
  pending,
  errors,
  refreshRequired,
}: {
  items: MessageDigestDefinition[];
  pending: MessageDigestListProps['lifecyclePending'];
  errors: MessageDigestListProps['lifecycleErrors'];
  refreshRequired: MessageDigestListProps['lifecycleRefreshRequired'];
}): React.JSX.Element | null {
  const pendingEntries = Object.entries(pending);
  const errorEntries = Object.entries(errors);
  if (pendingEntries.length === 0 && errorEntries.length === 0) return null;
  return (
    <div className="mb-3 grid gap-2">
      {pendingEntries.map(([definitionId, action]) => (
        <p
          key={`pending:${definitionId}`}
          role="status"
          className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"
        >
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
          />
          {action === 'pause' ? 'Pausing' : 'Resuming'}{' '}
          {items.find((item) => item.id === definitionId)?.name ?? 'Message Digest'}…
        </p>
      ))}
      {errorEntries.map(([definitionId, message]) => (
        <p
          key={`error:${definitionId}`}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
        >
          <span className="font-semibold">
            {items.find((item) => item.id === definitionId)?.name ?? 'Message Digest'} was{' '}
            {refreshRequired[definitionId] === true ? 'changed.' : 'not changed.'}
          </span>{' '}
          {message}
        </p>
      ))}
    </div>
  );
}

function SortableColumnHeader({
  label,
  field,
  currentSort,
  direction,
  disabled,
  className,
  onSortChange,
  onDirectionChange,
}: {
  label: string;
  field: Extract<MessageDigestListSort, 'name' | 'nextRunAt'>;
  currentSort: MessageDigestListSort;
  direction: SortDirection;
  disabled: boolean;
  className: string;
  onSortChange: (sort: MessageDigestListSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
}): React.JSX.Element {
  const active = currentSort === field;
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={`${className} px-2 py-1 font-semibold`}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(): void => {
          if (active) {
            onDirectionChange(direction === 'asc' ? 'desc' : 'asc');
          } else {
            onSortChange(field);
          }
        }}
        className="inline-flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800"
      >
        {label}
        {active ? (
          direction === 'asc' ? (
            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          )
        ) : null}
      </button>
    </th>
  );
}

function DesktopDigestTable({
  items,
  sort,
  direction,
  sortDisabled,
  lifecyclePending,
  lifecycleRefreshRequired,
  lifecycleContext,
  pendingRunRecoveryDefinitionId,
  onSortChange,
  onDirectionChange,
  onToggleLifecycle,
  onRun,
  onDelete,
}: {
  items: MessageDigestDefinition[];
  sort: MessageDigestListSort;
  direction: SortDirection;
  sortDisabled: boolean;
  lifecyclePending: MessageDigestListProps['lifecyclePending'];
  lifecycleRefreshRequired: MessageDigestListProps['lifecycleRefreshRequired'];
  lifecycleContext: MessageDigestLifecycleContext;
  pendingRunRecoveryDefinitionId: string | null;
  onSortChange: (sort: MessageDigestListSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  onToggleLifecycle: MessageDigestListProps['onToggleLifecycle'];
  onRun: (definition: MessageDigestDefinition) => void;
  onDelete: (definition: MessageDigestDefinition) => void;
}): React.JSX.Element {
  return (
    <div
      data-testid="message-digest-desktop-list"
      className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block"
    >
      <table aria-label="Message Digests" className="min-w-[70rem] table-fixed text-left">
        <caption className="sr-only">Message Digest definitions</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
          <tr>
            <SortableColumnHeader
              label="Name"
              field="name"
              currentSort={sort}
              direction={direction}
              disabled={sortDisabled}
              className="w-[18%]"
              onSortChange={onSortChange}
              onDirectionChange={onDirectionChange}
            />
            <th scope="col" className="w-[17%] px-4 py-3 font-semibold">
              Conversation
            </th>
            <th scope="col" className="w-[13%] px-4 py-3 font-semibold">
              Schedule
            </th>
            <th scope="col" className="w-[14%] px-4 py-3 font-semibold">
              Status
            </th>
            <th scope="col" className="w-[15%] px-4 py-3 font-semibold">
              Last run
            </th>
            <SortableColumnHeader
              label="Next run"
              field="nextRunAt"
              currentSort={sort}
              direction={direction}
              disabled={sortDisabled}
              className="w-[17%]"
              onSortChange={onSortChange}
              onDirectionChange={onDirectionChange}
            />
            <th scope="col" className="w-16 px-2 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((definition) => (
            <tr
              key={definition.id}
              className="align-middle hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
            >
              <td className="min-w-0 px-4 py-4">
                <DigestName definition={definition} />
              </td>
              <td className="min-w-0 px-4 py-4">
                <DigestSource definition={definition} />
              </td>
              <td className="min-w-0 px-4 py-4">
                <DigestSchedule definition={definition} />
              </td>
              <td className="min-w-0 px-4 py-4">
                <DigestStatus definition={definition} />
              </td>
              <td className="min-w-0 px-4 py-4">
                <DigestLastRun definition={definition} />
              </td>
              <td className="min-w-0 px-4 py-4">
                <DigestNextRun definition={definition} />
              </td>
              <td className="px-2 py-2 text-right">
                <MessageDigestActionsMenu
                  definition={definition}
                  runDisabledReason={getMessageDigestRunDisabledReasonWithRecoveryFence(
                    definition,
                    lifecycleContext,
                    pendingRunRecoveryDefinitionId
                  )}
                  lifecycleDisabledReason={getMessageDigestLifecycleDisabledReason(
                    definition,
                    lifecycleContext
                  )}
                  deleteDisabledReason={getMessageDigestDeleteDisabledReason(
                    definition.id,
                    pendingRunRecoveryDefinitionId
                  )}
                  pendingLifecycle={getPendingLifecycle(lifecyclePending, definition.id)}
                  refreshRequired={lifecycleRefreshRequired[definition.id] === true}
                  onToggleLifecycle={onToggleLifecycle}
                  onRun={onRun}
                  onDelete={onDelete}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileDigestCards({
  items,
  lifecyclePending,
  lifecycleRefreshRequired,
  lifecycleContext,
  pendingRunRecoveryDefinitionId,
  onToggleLifecycle,
  onRun,
  onDelete,
}: {
  items: MessageDigestDefinition[];
  lifecyclePending: MessageDigestListProps['lifecyclePending'];
  lifecycleRefreshRequired: MessageDigestListProps['lifecycleRefreshRequired'];
  lifecycleContext: MessageDigestLifecycleContext;
  pendingRunRecoveryDefinitionId: string | null;
  onToggleLifecycle: MessageDigestListProps['onToggleLifecycle'];
  onRun: (definition: MessageDigestDefinition) => void;
  onDelete: (definition: MessageDigestDefinition) => void;
}): React.JSX.Element {
  return (
    <ul data-testid="message-digest-mobile-list" className="grid min-w-0 gap-3 lg:hidden">
      {items.map((definition) => (
        <li
          key={definition.id}
          data-testid={`message-digest-mobile-${definition.id}`}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <DigestName definition={definition} />
            <MessageDigestActionsMenu
              definition={definition}
              runDisabledReason={getMessageDigestRunDisabledReasonWithRecoveryFence(
                definition,
                lifecycleContext,
                pendingRunRecoveryDefinitionId
              )}
              lifecycleDisabledReason={getMessageDigestLifecycleDisabledReason(
                definition,
                lifecycleContext
              )}
              deleteDisabledReason={getMessageDigestDeleteDisabledReason(
                definition.id,
                pendingRunRecoveryDefinitionId
              )}
              pendingLifecycle={getPendingLifecycle(lifecyclePending, definition.id)}
              refreshRequired={lifecycleRefreshRequired[definition.id] === true}
              onToggleLifecycle={onToggleLifecycle}
              onRun={onRun}
              onDelete={onDelete}
            />
          </div>
          <div className="mt-4 grid min-w-0 gap-4 border-t border-slate-100 pt-4 dark:border-slate-800 xs:grid-cols-2">
            <MobileField label="Conversation">
              <DigestSource definition={definition} />
            </MobileField>
            <MobileField label="Schedule">
              <DigestSchedule definition={definition} />
            </MobileField>
            <MobileField label="Status">
              <DigestStatus definition={definition} />
            </MobileField>
            <MobileField label="Last run">
              <DigestLastRun definition={definition} />
            </MobileField>
            <MobileField label="Next run" className="xs:col-span-2">
              <DigestNextRun definition={definition} />
            </MobileField>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DigestName({ definition }: { definition: MessageDigestDefinition }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <Link
        to={`/whatsapp/message-digests/${definition.id}`}
        className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-slate-950 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-50 dark:hover:text-blue-300"
      >
        {definition.name}
      </Link>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {getInstructionTemplateLabel(definition.instructions.templateId)}
      </p>
    </div>
  );
}

function DigestSource({ definition }: { definition: MessageDigestDefinition }): React.JSX.Element {
  const SourceIcon = definition.source.chatType === 'group' ? Users : MessageCircleMore;
  return (
    <div className="min-w-0">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <SourceIcon aria-hidden="true" className="h-3.5 w-3.5" />
        {getMessageDigestSourceTypeLabel(definition.source.chatType)}
      </span>
      <p className="mt-1 break-words text-sm text-slate-800 dark:text-slate-200">
        {definition.source.displayName}
      </p>
    </div>
  );
}

function DigestSchedule({
  definition,
}: {
  definition: MessageDigestDefinition;
}): React.JSX.Element {
  return (
    <div className="min-w-0 text-sm text-slate-700 dark:text-slate-300">
      <p className="flex items-center gap-1.5 font-medium">
        <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        {getMessageDigestScheduleLabel(definition.schedule)}
      </p>
      <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
        {definition.schedule.timeZone}
      </p>
    </div>
  );
}

function DigestStatus({ definition }: { definition: MessageDigestDefinition }): React.JSX.Element {
  const effectiveStatus: MessageDigestEffectiveStatus =
    definition.status === 'deleting' ? 'deleting' : definition.listStatus;
  const badge = STATUS_BADGE_STYLES[effectiveStatus];
  const Icon = badge.icon;
  const attentionMessage = getAttentionMessage(definition);
  return (
    <div className="min-w-0">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
      >
        <Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${effectiveStatus === 'deleting' ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        {getMessageDigestStatusLabel(effectiveStatus)}
      </span>
      {attentionMessage !== null ? (
        <p className="mt-1.5 break-words text-xs leading-5 text-amber-700 dark:text-amber-300">
          {attentionMessage}
        </p>
      ) : null}
    </div>
  );
}

function DigestLastRun({
  definition,
}: {
  definition: MessageDigestDefinition;
}): React.JSX.Element {
  if (definition.latestRun === null) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">— No runs yet</p>;
  }

  return (
    <div className="min-w-0">
      <time
        dateTime={definition.latestRun.startedAt}
        className="block break-words text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {formatMessageDigestDateTime(
          definition.latestRun.startedAt,
          definition.schedule.timeZone
        )}
      </time>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {getMessageDigestGenerationStatusLabel(definition.latestRun.generationStatus)}
      </p>
    </div>
  );
}

function DigestNextRun({
  definition,
}: {
  definition: MessageDigestDefinition;
}): React.JSX.Element {
  const blockedState = getNextRunBlockedState(definition);
  if (blockedState !== null) {
    return <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{blockedState}</p>;
  }

  return (
    <time
      dateTime={definition.nextRunAt}
      className="block break-words text-sm font-medium text-slate-800 dark:text-slate-200"
    >
      {formatMessageDigestDateTime(definition.nextRunAt, definition.schedule.timeZone)}
    </time>
  );
}

function MobileField({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      {children}
    </div>
  );
}

const STATUS_BADGE_STYLES: Record<
  MessageDigestEffectiveStatus,
  { icon: typeof CheckCircle2; className: string }
> = {
  active: {
    icon: CheckCircle2,
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  paused: {
    icon: PauseCircle,
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  deleting: {
    icon: LoaderCircle,
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  },
  needs_attention: {
    icon: AlertTriangle,
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  },
};

function getAttentionMessage(definition: MessageDigestDefinition): string | null {
  const { attentionCode } = definition;
  if (attentionCode === null) return null;
  if (attentionCode === 'DELIVERY_SETUP_REQUIRED') return 'WhatsApp delivery setup required';
  if (attentionCode === 'SOURCE_TOO_LARGE') {
    return definition.status === 'paused'
      ? 'Run window is too large. Resume to retry it.'
      : 'Run window is too large. Run now to retry it.';
  }
  if (isMessageDigestSourceAttentionBlocker(attentionCode)) {
    return 'Source conversation needs attention';
  }
  return 'Review this digest before its next run';
}

function getPendingLifecycle(
  pending: MessageDigestListProps['lifecyclePending'],
  definitionId: string
): 'pause' | 'resume' | null {
  return pending[definitionId] ?? null;
}

function getSortLabel(sort: MessageDigestListSort): string {
  if (sort === 'name') return 'Name';
  if (sort === 'nextRunAt') return 'Next run';
  return 'Recently updated';
}

function getNextRunBlockedState(definition: MessageDigestDefinition): string | null {
  if (definition.status === 'deleting') return 'Deletion in progress';
  if (definition.attentionCode === 'SOURCE_TOO_LARGE') {
    return definition.status === 'paused' ? 'Resume to retry window' : 'Run now to retry window';
  }
  if (isMessageDigestSourceAttentionBlocker(definition.attentionCode)) {
    return 'Source unavailable';
  }
  if (definition.attentionCode === 'DELIVERY_SETUP_REQUIRED') return 'Needs WhatsApp setup';
  if (definition.status === 'paused') return 'Paused';
  if (definition.listStatus === 'needs_attention') return 'Needs attention';
  return null;
}

function getInstructionTemplateLabel(
  templateId: MessageDigestDefinition['instructions']['templateId']
): string {
  return {
    fishing_group: 'Fishing group summary',
    direct_sentiment: 'Sentiment and tone',
    custom: 'Custom instructions',
  }[templateId];
}
