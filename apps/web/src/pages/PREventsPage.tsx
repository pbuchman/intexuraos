import {
  AlertCircle,
  Loader2,
  RefreshCw,
  RadioTower,
  Search,
} from 'lucide-react';
import { Card, Layout } from '@/components';
import { GitHubEventLogRow } from '@/components/GitHubEventLogRow';
import { useGitHubEventLog } from '@/hooks';
import { useState } from 'react';

/**
 * Live GitHub event decision log.
 */
export function PREventsPage(): React.JSX.Element {
  const {
    rows,
    loading,
    refreshing,
    loadingMore,
    error,
    listenerHealthy,
    hasMore,
    refresh,
    loadMore,
  } = useGitHubEventLog();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const filteredRows = rows.filter((row) => {
    if (stateFilter !== 'all' && row.decisionState !== stateFilter) {
      return false;
    }

    if (query.trim() === '') {
      return true;
    }

    const needle = query.trim().toLowerCase();
    return [
      row.repository,
      row.senderLogin,
      row.reason,
      row.githubEventName,
      row.eventType,
      row.action,
      row.pullRequestNumber !== null ? `#${String(row.pullRequestNumber)}` : null,
    ].some((value) => value?.toLowerCase().includes(needle) === true);
  });

  const pendingCount = rows.filter((row) => row.decisionState === 'pending').length;
  const reviewCount = rows.filter((row) => row.decisionOutcome === 'request_review').length;

  if (loading && rows.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.18),_transparent_38%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(241,245,249,0.92))] p-5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 ring-1 ring-slate-200">
              <RadioTower className={`h-3.5 w-3.5 ${listenerHealthy ? 'text-emerald-600' : 'text-slate-400'}`} />
              {listenerHealthy ? 'Live feed connected' : 'Polling only'}
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">GitHub Event Decision Log</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every auth-passed GitHub webhook appears here first as a lightweight live row, then hydrates into the full decision trail.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              disabled={refreshing}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Visible rows</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{String(filteredRows.length)}</div>
          </div>
          <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Pending decisions</div>
            <div className="mt-1 text-2xl font-semibold text-amber-700">{String(pendingCount)}</div>
          </div>
          <div className="rounded-2xl bg-white/85 px-4 py-3 ring-1 ring-slate-200">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Review requests</div>
            <div className="mt-1 text-2xl font-semibold text-sky-700">{String(reviewCount)}</div>
          </div>
        </div>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <Card>
        <div className="grid gap-3 p-1 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search repo, sender, PR, reason"
              className="w-full border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>

          <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
            {(['all', 'pending', 'completed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStateFilter(value);
                }}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  stateFilter === value
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filteredRows.length === 0 && !loading ? (
        <Card>
          <div className="py-12 text-center">
            <RadioTower className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600">No matching events</p>
            <p className="text-sm text-slate-500">
              No auth-passed GitHub events match the current filters.
            </p>
          </div>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {filteredRows.map((row) => (
            <GitHubEventLogRow
              key={row.id}
              row={row}
              expanded={expandedRowId === row.id}
              onToggle={(rowId) => {
                setExpandedRowId((currentId) => currentId === rowId ? null : rowId);
              }}
            />
          ))}
        </div>
      )}

      {loading && rows.length > 0 ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : null}

      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => {
              void loadMore();
            }}
            disabled={loadingMore}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older events'}
          </button>
        </div>
      ) : null}
    </Layout>
  );
}
