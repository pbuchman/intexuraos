import { useSyncQueue } from '@/context';
import { Layout, Card } from '@/components';
import { Share2, CheckCircle2, Clock, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { clearHistory, type ShareHistoryItem } from '@/services/shareQueue';
import { formatRelative } from '@/utils/dateFormat';

interface StatusTextProps {
  item: ShareHistoryItem;
  isOnline: boolean;
  authFailed: boolean;
}

function getTimeUntilRetry(nextRetryAt: string): number {
  return Math.max(0, new Date(nextRetryAt).getTime() - Date.now());
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h`;
}

function StatusText({ item, isOnline, authFailed }: StatusTextProps): React.JSX.Element {
  // Synced state
  if (item.status === 'synced' && item.syncedAt !== undefined) {
    return (
      <span className="flex items-center gap-1 text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        Synced {formatRelative(item.syncedAt)}
      </span>
    );
  }

  // Syncing state
  if (item.status === 'syncing') {
    return (
      <span className="flex items-center gap-1 text-blue-600">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing...
      </span>
    );
  }

  // Pending states
  if (!isOnline) {
    return (
      <span className="flex items-center gap-1 text-slate-500">
        <Clock className="h-3 w-3" />
        Waiting for connection
      </span>
    );
  }

  if (authFailed) {
    return (
      <span className="flex items-center gap-1 text-red-600">
        <AlertCircle className="h-3 w-3" />
        Sign in to sync
      </span>
    );
  }

  // Pending with retry time
  if (item.nextRetryAt !== undefined) {
    const timeUntil = getTimeUntilRetry(item.nextRetryAt);
    if (timeUntil > 0) {
      return (
        <span className="flex items-center gap-1 text-amber-600">
          <Clock className="h-3 w-3" />
          Retry in {formatDuration(timeUntil)}
        </span>
      );
    }
  }

  // Default pending
  return (
    <span className="flex items-center gap-1 text-amber-600">
      <Clock className="h-3 w-3" />
      Pending
    </span>
  );
}

export function ShareHistoryPage(): React.JSX.Element {
  const { history, refreshHistory, isOnline, authFailed } = useSyncQueue();

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
                    {!isOnline ? (
                      <span className="text-amber-600">Offline</span>
                    ) : authFailed ? (
                      <span className="text-red-600">Sign in to sync</span>
                    ) : null}
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
                    {/* Content preview with overflow fix */}
                    <p className="text-sm text-slate-900 break-all line-clamp-2">{item.contentPreview}</p>

                    {/* Unified footer with status */}
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-slate-500">{formatRelative(item.createdAt)}</span>
                      <span className="text-slate-400">·</span>
                      <StatusText item={item} isOnline={isOnline} authFailed={authFailed} />
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
