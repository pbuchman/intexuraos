import { AlertCircle, RadioTower, RefreshCw } from 'lucide-react';
import { Button, Layout } from '@/components';
import { GitHubEventLogTableRow } from '@/components';
import { useGitHubEventLog } from '@/hooks';

// --- PageHeader ---

interface PageHeaderProps {
  totalCount: number;
  listenerHealthy: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function PageHeader({ totalCount, listenerHealthy, refreshing, onRefresh }: PageHeaderProps): React.JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            GitHub Event Log
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              listenerHealthy
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}
          >
            <RadioTower className="h-3 w-3" />
            {listenerHealthy ? 'Live' : 'Polling'}
          </span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {String(totalCount)} events
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        <span className="ml-2 hidden sm:inline">Refresh</span>
      </Button>
    </div>
  );
}

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[100px_1fr_160px_120px_36px] gap-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 lg:grid">
      <div>Time</div>
      <div>Event</div>
      <div>Decision</div>
      <div>User</div>
      <div />
    </div>
  );
}

// --- GitHubEventLogPage ---

export function GitHubEventLogPage(): React.JSX.Element {
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
      <PageHeader
        totalCount={rows.length}
        listenerHealthy={listenerHealthy}
        refreshing={refreshing}
        onRefresh={(): void => { void refresh(); }}
      />

      {error !== null && error !== '' ? (
        <div className="mb-6 flex items-center gap-2 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {rows.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <RadioTower className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No events yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              GitHub webhook events will appear here as they arrive.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <ColumnHeader />

          <div className="space-y-0.5">
            {rows.map((row) => (
              <GitHubEventLogTableRow key={row.id} row={row} />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={(): void => { void loadMore(); }}
                disabled={loadingMore}
                isLoading={loadingMore}
                loadingText="Loading…"
              >
                Load older events
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
