import { useSyncQueue } from '@/context';
import { Button, Card, Layout } from '@/components';
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
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        <CheckCircle2 className="h-3 w-3" />
        Synced
      </span>
    );
  }

  // Syncing state
  if (item.status === 'syncing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing
      </span>
    );
  }

  // Pending states
  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800">
        <Clock className="h-3 w-3" />
        Offline
      </span>
    );
  }

  if (authFailed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
        <AlertCircle className="h-3 w-3" />
        Auth Required
      </span>
    );
  }

  // Pending with retry time
  if (item.nextRetryAt !== undefined) {
    const timeUntil = getTimeUntilRetry(item.nextRetryAt);
    if (timeUntil > 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          <Clock className="h-3 w-3" />
          Retry {formatDuration(timeUntil)}
        </span>
      );
    }
  }

  // Default pending
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
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

  const getSubtitle = (): string => {
    if (!isOnline) return 'Offline - waiting for connection';
    if (authFailed) return 'Sign in to sync';
    return 'Content shared from your device';
  };

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Share History</h2>
          <p className={`text-slate-600 ${!isOnline ? 'text-amber-600' : authFailed ? 'text-red-600' : ''}`}>
            {getSubtitle()}
          </p>
        </div>
        {history.length > 0 && (
          <Button variant="secondary" onClick={handleClearHistory}>
            <Trash2 className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <Share2 className="mx-auto mb-4 h-10 w-10 text-slate-300" />
            <p className="mb-2 text-slate-600">No shared content yet</p>
            <p className="text-sm text-slate-500">
              Use your device&apos;s share menu to send content here
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <ShareHistoryCard key={item.id} item={item} isOnline={isOnline} authFailed={authFailed} />
          ))}
        </div>
      )}
    </Layout>
  );
}

interface ShareHistoryCardProps {
  item: ShareHistoryItem;
  isOnline: boolean;
  authFailed: boolean;
}

function ShareHistoryCard({ item, isOnline, authFailed }: ShareHistoryCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md">
      <p className="text-sm text-slate-900 break-all line-clamp-2">{item.contentPreview}</p>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">{formatRelative(item.createdAt)}</span>
        <StatusText item={item} isOnline={isOnline} authFailed={authFailed} />
      </div>
    </div>
  );
}
