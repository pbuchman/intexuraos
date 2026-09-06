import { ArrowLeft, ArrowUpDown, History, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import {
  hasMessageDigestHistoryFilters,
  MessageDigestHistoryFilters,
  type MessageDigestHistoryFilterValue,
} from '@/components/message-digests/MessageDigestHistoryFilters';
import { MessageDigestPageLoading } from '@/components/message-digests/MessageDigestPageLoading';
import { getMessageDigestProcessingStageLabel } from '@/components/message-digests/MessageDigestRunStatus';
import { useMessageDigestDefinition, useMessageDigestHistory } from '@/hooks/useMessageDigests';
import type {
  ListMessageDigestRunsOptions,
  MessageDigestDeliveryStatus,
  MessageDigestGenerationStatus,
  MessageDigestRun,
} from '@/types/messageDigests';
import {
  formatMessageDigestDateTime,
  getMessageDigestDeliveryStatusLabel,
} from '@/types/messageDigests';

export function WhatsAppMessageDigestHistoryPage(): React.JSX.Element {
  const { definitionId = '' } = useParams<{ definitionId: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const definition = useMessageDigestDefinition(definitionId);
  const filters = readHistoryFilters(searchParams);
  const options = useMemo<ListMessageDigestRunsOptions>(
    () => ({
      limit: 25,
      ...(filters.fromDate === '' ? {} : { fromDate: filters.fromDate }),
      ...(filters.toDate === '' ? {} : { toDate: filters.toDate }),
      ...(filters.generationStatus === undefined
        ? {}
        : { generationStatus: filters.generationStatus }),
      ...(filters.deliveryStatus === undefined ? {} : { deliveryStatus: filters.deliveryStatus }),
      sort: 'windowStart',
      direction: filters.direction,
    }),
    [
      filters.deliveryStatus,
      filters.direction,
      filters.fromDate,
      filters.generationStatus,
      filters.toDate,
    ]
  );
  const history = useMessageDigestHistory(definitionId, options);
  const hasActiveRun = history.items.some((run) => !isRunTerminal(run));

  useEffect(() => {
    if (!hasActiveRun || history.isRefreshing) return;
    let cancelled = false;
    let timer: number | null = null;
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        timer = null;
        void (async (): Promise<void> => {
          try {
            await history.refresh();
          } finally {
            if (!cancelled) schedule();
          }
        })();
      }, 2_000);
    };
    schedule();
    return (): void => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [definitionId, hasActiveRun, history.isRefreshing, history.refresh, location.search]);

  useEffect(() => {
    if (!hasHeadingFocusIntent(location.state) || definition.definition === null) return;
    headingRef.current?.focus();
  }, [definition.definition, location.state]);

  if (definition.isLoading) return <MessageDigestPageLoading title="Message Digest History" />;
  if (definition.isNotFound || definitionId === '') return <MessageDigestHistoryNotFound />;
  if (definition.definition === null) {
    return (
      <MessageDigestHistoryLoadError
        message={definition.error ?? 'Message Digest is temporarily unavailable.'}
        onRetry={definition.refresh}
      />
    );
  }

  const hasFilters = hasMessageDigestHistoryFilters(filters);

  return (
    <Layout>
      <section
        className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5"
        aria-labelledby="page-title"
      >
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link
              to={`/whatsapp/message-digests/${definitionId}`}
              state={{ focusHeading: true }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-slate-600 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:text-slate-50"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to digest
            </Link>
            <h1
              ref={headingRef}
              id="page-title"
              tabIndex={-1}
              className="mt-3 flex min-w-0 items-center gap-2 break-words text-2xl font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-50"
            >
              <History
                aria-hidden="true"
                className="h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400"
              />
              Run history
            </h1>
            <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-400">
              {definition.definition.name}
            </p>
          </div>
          <button
            type="button"
            disabled={history.isRefreshing}
            onClick={(): void => {
              void history.refresh();
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${history.isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
            />
            {history.isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        <MessageDigestHistoryFilters
          value={filters}
          onChange={(next): void => {
            setSearchParams(writeHistoryFilters(next));
          }}
          onClear={(): void => {
            setSearchParams(new URLSearchParams());
          }}
        />

        {hasActiveRun ? (
          <p
            role="status"
            aria-label="Active run updates"
            aria-live="polite"
            aria-atomic="true"
            className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />
            {history.refreshError === null
              ? history.isRefreshing
                ? 'Refreshing active runs…'
                : 'Active runs update automatically.'
              : `Automatic refresh failed: ${history.refreshError}. Retrying while the last confirmed state remains visible.`}
          </p>
        ) : null}

        {history.isInitialLoading ? <HistoryLoading /> : null}
        {!history.isInitialLoading && history.error !== null && history.items.length === 0 ? (
          <HistoryError message={history.error} onRetry={history.refresh} />
        ) : null}
        {!history.isInitialLoading && history.error === null && history.items.length === 0 ? (
          <HistoryEmpty
            filtered={hasFilters}
            onClear={(): void => {
              setSearchParams(new URLSearchParams());
            }}
          />
        ) : null}

        {history.items.length > 0 ? (
          <>
            {(!hasActiveRun && history.refreshError !== null) ||
            history.loadMoreError !== null ? (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              >
                {!hasActiveRun && history.refreshError !== null ? (
                  <p>Refresh failed: {history.refreshError}</p>
                ) : null}
                {history.loadMoreError !== null ? (
                  <p>More results failed: {history.loadMoreError}</p>
                ) : null}
              </div>
            ) : null}
            <HistoryTable
              runs={history.items}
              definitionId={definitionId}
            />
            <HistoryCards
              runs={history.items}
              definitionId={definitionId}
            />
            {history.nextCursor !== null ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={history.isLoadingMore}
                  onClick={(): void => {
                    void history.loadMore();
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {history.isLoadingMore ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : null}
                  {history.isLoadingMore ? 'Loading more…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </Layout>
  );
}

const GENERATION_STATUSES = new Set<MessageDigestGenerationStatus>([
  'queued',
  'processing',
  'completed',
  'failed',
  'skipped_no_activity',
]);
const DELIVERY_STATUSES = new Set<MessageDigestDeliveryStatus>([
  'not_sent',
  'pending',
  'sent',
  'ambiguous',
  'failed',
]);

function readHistoryFilters(params: URLSearchParams): MessageDigestHistoryFilterValue {
  const generation = params.get('generationStatus');
  const delivery = params.get('deliveryStatus');
  return {
    fromDate: params.get('from') ?? '',
    toDate: params.get('to') ?? '',
    generationStatus: GENERATION_STATUSES.has(generation as MessageDigestGenerationStatus)
      ? (generation as MessageDigestGenerationStatus)
      : undefined,
    deliveryStatus: DELIVERY_STATUSES.has(delivery as MessageDigestDeliveryStatus)
      ? (delivery as MessageDigestDeliveryStatus)
      : undefined,
    direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
  };
}

function writeHistoryFilters(filters: MessageDigestHistoryFilterValue): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.fromDate !== '') params.set('from', filters.fromDate);
  if (filters.toDate !== '') params.set('to', filters.toDate);
  if (filters.generationStatus !== undefined) {
    params.set('generationStatus', filters.generationStatus);
  }
  if (filters.deliveryStatus !== undefined) {
    params.set('deliveryStatus', filters.deliveryStatus);
  }
  if (filters.direction === 'asc') params.set('direction', 'asc');
  return params;
}

function HistoryTable({
  runs,
  definitionId,
}: {
  runs: MessageDigestRun[];
  definitionId: string;
}): React.JSX.Element {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 md:block">
      <table
        aria-label="Message Digest run history"
        className="w-full min-w-[980px] border-collapse text-left text-sm"
      >
        <caption className="sr-only">Message Digest run history</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            {[
              'Started',
              'Message window',
              'Messages',
              'Generation',
              'WhatsApp',
              'Duration',
              'Action',
            ].map((heading) => (
              <th key={heading} scope="col" className="px-4 py-3 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {runs.map((run) => (
            <tr key={run.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-4">
                <time dateTime={run.createdAt}>
                  {formatMessageDigestDateTime(run.createdAt, run.schedule.timeZone)}
                </time>
              </td>
              <td className="px-4 py-4">
                <WindowText run={run} />
              </td>
              <td className="px-4 py-4 tabular-nums">{run.effectiveMessageCount ?? '—'}</td>
              <td className="px-4 py-4">
                <HistoryStatus
                  value={getMessageDigestProcessingStageLabel(run.processingStage)}
                  active={!isRunTerminal(run)}
                />
              </td>
              <td className="px-4 py-4">
                <HistoryStatus
                  value={getMessageDigestDeliveryStatusLabel(run.delivery.status)}
                  active={run.delivery.status === 'pending'}
                />
              </td>
              <td className="px-4 py-4 tabular-nums">{formatDuration(run)}</td>
              <td className="px-4 py-4">
                <Link
                  to={`/whatsapp/message-digests/${definitionId}/history/${run.id}`}
                  state={{ focusHeading: true }}
                  className="inline-flex min-h-11 items-center font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300"
                >
                  View result
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryCards({
  runs,
  definitionId,
}: {
  runs: MessageDigestRun[];
  definitionId: string;
}): React.JSX.Element {
  return (
    <div className="grid gap-3 md:hidden">
      {runs.map((run) => (
        <article
          key={run.id}
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <time
            dateTime={run.createdAt}
            className="text-sm font-semibold text-slate-950 dark:text-slate-50"
          >
            {formatMessageDigestDateTime(run.createdAt, run.schedule.timeZone)}
          </time>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <HistoryStatus
              value={getMessageDigestProcessingStageLabel(run.processingStage)}
              active={!isRunTerminal(run)}
            />
            <HistoryStatus
              value={getMessageDigestDeliveryStatusLabel(run.delivery.status)}
              active={run.delivery.status === 'pending'}
            />
          </div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            <WindowText run={run} />
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {run.effectiveMessageCount ?? '—'} messages · {formatDuration(run)}
          </p>
          <Link
            to={`/whatsapp/message-digests/${definitionId}/history/${run.id}`}
            state={{ focusHeading: true }}
            className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300"
          >
            View result
          </Link>
        </article>
      ))}
    </div>
  );
}

function WindowText({ run }: { run: MessageDigestRun }): React.JSX.Element {
  return (
    <>
      <time dateTime={run.window.start}>
        {formatMessageDigestDateTime(run.window.start, run.schedule.timeZone)}
      </time>
      <span aria-hidden="true"> — </span>
      <time dateTime={run.window.end}>
        {formatMessageDigestDateTime(run.window.end, run.schedule.timeZone)}
      </time>
    </>
  );
}

function hasHeadingFocusIntent(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)['focusHeading'] === true
  );
}

function HistoryStatus({ value, active }: { value: string; active: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${active ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
    >
      {value}
    </span>
  );
}

function formatDuration(run: MessageDigestRun): string {
  if (run.completedAt === null) return '—';
  const durationMs = Date.parse(run.completedAt) - Date.parse(run.createdAt);
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}

function isRunTerminal(run: MessageDigestRun): boolean {
  if (run.generationStatus === 'queued' || run.generationStatus === 'processing') return false;
  if (run.generationStatus !== 'completed') return true;
  return run.delivery.status !== 'pending';
}

function HistoryLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
    >
      <LoaderCircle
        aria-hidden="true"
        className="h-5 w-5 animate-spin motion-reduce:animate-none"
      />
      Loading run history…
    </div>
  );
}

function HistoryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={(): void => {
          void onRetry();
        }}
        className="mt-3 inline-flex min-h-11 items-center font-semibold underline"
      >
        Try again
      </button>
    </div>
  );
}

function HistoryEmpty({
  filtered,
  onClear,
}: {
  filtered: boolean;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <ArrowUpDown aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
      <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">
        {filtered ? 'No runs match these filters' : 'No runs yet'}
      </h2>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:underline dark:text-blue-300"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function MessageDigestHistoryNotFound(): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-950 dark:text-slate-50">
          Message Digest not found
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          This digest does not exist or is not available to this account.
        </p>
        <Link
          to="/whatsapp/message-digests"
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
        >
          Back to Message Digests
        </Link>
      </section>
    </Layout>
  );
}

function MessageDigestHistoryLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-red-200 bg-white p-8 text-center dark:border-red-900 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-950 dark:text-slate-50">
          Couldn’t load Message Digest history
        </h1>
        <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {message}
        </p>
        <button
          type="button"
          onClick={(): void => {
            void onRetry();
          }}
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </section>
    </Layout>
  );
}
