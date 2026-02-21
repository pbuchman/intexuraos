import {
  AlertCircle,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Card, Layout } from '@/components';
import { PREventsGroup } from '@/components/PREventsGroup';
import { useGitHubPRSummaries } from '@/hooks';

/**
 * Main page for GitHub PR Events — last 30 days, loaded from summaries
 */
export function PREventsPage(): React.JSX.Element {
  const {
    prs,
    loading,
    refreshing,
    error,
    refresh,
  } = useGitHubPRSummaries();

  if (loading && prs.length === 0) {
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Github Pull Request Events (last 30 days)</h2>
          <p className="text-slate-600 dark:text-slate-300">View pull request activity</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            disabled={refreshing}
            className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-blue-400"
            title="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 break-words rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {prs.length === 0 && !loading ? (
        <Card>
          <div className="py-12 text-center">
            <GitPullRequest className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <p className="mb-2 text-slate-600 dark:text-slate-300">No PR events found</p>
            <p className="text-sm text-slate-500">
              No webhook events have been received in the last 30 days.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {prs.map((pr) => (
            <PREventsGroup
              key={`${pr.repository}#${String(pr.pullRequestNumber)}`}
              pullRequestNumber={pr.pullRequestNumber}
              title={pr.title}
              repository={pr.repository}
              status={pr.status}
            />
          ))}
        </div>
      )}

      {loading && prs.length > 0 ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : null}
    </Layout>
  );
}
