import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Filter } from 'lucide-react';
import { Button, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  BackfillRangeModal,
  DigestRow,
  MonthPicker,
} from '@/components/notification-digests';
import {
  useDigestList,
  type DigestSortOption,
  type DigestStatusFilter,
} from '@/hooks/useDigestList';
import { currentMonthIso } from '@/utils/digestDates.js';
import { startBackfill } from '@/services/notificationDigestsApi';
import { getErrorMessage } from '@intexuraos/common-core/errors';

const DEFAULT_GROUP_KEY = 'grupa-wedkarska-skool';

const FILTER_OPTIONS: { key: DigestStatusFilter; label: string; dotClass: string; activeClass: string }[] = [
  {
    key: 'all',
    label: 'All',
    dotClass: 'bg-slate-400',
    activeClass: 'border-slate-400 bg-slate-50 text-slate-700 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300',
  },
  {
    key: 'single-generation',
    label: 'First version',
    dotClass: 'bg-blue-500',
    activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400',
  },
  {
    key: 'regenerated',
    label: 'Regenerated',
    dotClass: 'bg-amber-500',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-400',
  },
];

const INACTIVE_CHIP_CLASS =
  'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

const SORT_OPTIONS: { key: DigestSortOption; label: string }[] = [
  { key: 'date-desc', label: 'Newest' },
  { key: 'date-asc', label: 'Oldest' },
  { key: 'message-count-desc', label: 'Most messages' },
];

export function NotificationDigestsPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();

  const groupKey = DEFAULT_GROUP_KEY;
  const [month, setMonth] = useState<string>(() => currentMonthIso());

  const {
    items, loading, error, filter, sort,
    setFilter, setSort,
  } = useDigestList({ groupKey, month });

  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const handleStartBackfill = useCallback(async (from: string, to: string): Promise<void> => {
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const token = await getAccessToken();
      const resp = await startBackfill(token, { groupKey, fromDate: from, toDate: to });
      setBackfillOpen(false);
      void navigate(`/notifications/digests/backfill/${encodeURIComponent(resp.runId)}`);
    } catch (err: unknown) {
      setBackfillError(getErrorMessage(err, 'Failed to start backfill'));
    } finally {
      setBackfillBusy(false);
    }
  }, [getAccessToken, groupKey, navigate]);

  const regeneratedCount = useMemo(
    () => items.filter((d) => d.generation > 1).length,
    [items],
  );

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Daily digests
          </h2>
        </div>
        <Button
          variant="secondary"
          onClick={(): void => { setBackfillOpen(true); }}
        >
          <CalendarRange className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Backfill range</span>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={(): void => { setFilter(opt.key); }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive ? opt.activeClass : INACTIVE_CHIP_CLASS
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${opt.dotClass}`} />
              {opt.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={(): void => { setSort(opt.key); }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                sort === opt.key
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <MonthPicker month={month} onChange={setMonth} />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {String(items.length)} {items.length === 1 ? 'day' : 'days'} · {String(regeneratedCount)} regenerated
        </span>
      </div>

      {error !== null ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-slate-600 dark:text-slate-300">
            No digests in the selected range. Run a backfill to generate them.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((digest) => (
            <DigestRow key={digest.summary.date} digest={digest} />
          ))}
        </div>
      )}

      <BackfillRangeModal
        isOpen={backfillOpen}
        onCancel={(): void => { setBackfillOpen(false); setBackfillError(null); }}
        onConfirm={(from, to): void => { void handleStartBackfill(from, to); }}
        busy={backfillBusy}
        error={backfillError}
      />
    </Layout>
  );
}
