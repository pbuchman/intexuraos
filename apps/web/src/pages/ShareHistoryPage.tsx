import { useSyncQueue } from '@/context';
import { Layout, Card } from '@/components';
import { Share2, CheckCircle2, Clock, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { clearHistory, type ShareStatus } from '@/services/shareQueue';

function StatusBadge({ status }: { status: ShareStatus }): React.JSX.Element {
  switch (status) {
    case 'synced':
      return (
        <span className="flex items-center gap-1 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Synced
        </span>
      );
    case 'syncing':
      return (
        <span className="flex items-center gap-1 text-sm text-blue-600">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Syncing
        </span>
      );
    case 'pending':
      return (
        <span className="flex items-center gap-1 text-sm text-amber-600">
          <Clock className="h-4 w-4" />
          Pending
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          Failed
        </span>
      );
  }
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${String(diffMins)} min ago`;
  if (diffHours < 24) return `${String(diffHours)} hr ago`;
  if (diffDays < 7) return `${String(diffDays)} days ago`;

  return date.toLocaleDateString();
}

export function ShareHistoryPage(): React.JSX.Element {
  const { history, pendingCount, isSyncing, refreshHistory } = useSyncQueue();

  const handleClearHistory = (): void => {
    clearHistory();
    refreshHistory();
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <Share2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">Share History</h1>
                  <p className="text-sm text-slate-500">
                    {pendingCount > 0 ? (
                      <span className="text-amber-600">
                        {pendingCount} pending{isSyncing ? ', syncing...' : ''}
                      </span>
                    ) : (
                      'All shares synced'
                    )}
                  </p>
                </div>
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title="Clear history"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <Share2 className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <p>No shared content yet</p>
                <p className="mt-1 text-sm">
                  Use your device&apos;s share menu to send content here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {history.map((item) => (
                  <div key={item.id} className="py-4">
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <p className="flex-1 text-sm text-slate-900">{item.contentPreview}</p>
                      <StatusBadge status={item.status} />
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{formatDate(item.createdAt)}</span>
                      {item.syncedAt !== undefined && (
                        <span>Synced {formatDate(item.syncedAt)}</span>
                      )}
                      {item.lastError !== undefined && (
                        <span className="text-red-500" title={item.lastError}>
                          Error: {item.lastError.slice(0, 50)}
                          {item.lastError.length > 50 ? '...' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
