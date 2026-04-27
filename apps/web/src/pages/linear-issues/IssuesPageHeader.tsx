import { CloudDownload, Loader2, RefreshCw } from 'lucide-react';

interface IssuesPageHeaderProps {
  refreshing: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onSync: () => void;
}

export function IssuesPageHeader({
  refreshing,
  syncing,
  onRefresh,
  onSync,
}: IssuesPageHeaderProps): React.JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Linear Issues</h2>
        <p className="text-slate-600 dark:text-slate-300">Issues from your connected Linear workspace.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          disabled={refreshing || syncing}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
          title="Refresh"
        >
          {refreshing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RefreshCw className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={onSync}
          disabled={syncing || refreshing}
          className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
          title="Sync from Linear"
        >
          {syncing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CloudDownload className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
