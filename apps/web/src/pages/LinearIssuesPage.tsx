import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Layout } from '@/components';
import { useAuth } from '@/context';
import { useFailedLinearIssues } from '@/hooks';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { deleteFailedIssue, listLinearIssues, retryFailedIssue, syncFromLinear } from '@/services';
import type { ListIssuesResponse } from '@/types';
import { IssueBoard, toColumnIssues } from './linear-issues/IssueBoard.js';
import { IssuesPageHeader } from './linear-issues/IssuesPageHeader.js';
import { NeedsAttentionSection } from './linear-issues/NeedsAttentionSection.js';
import { StatusBanners } from './linear-issues/StatusBanners.js';
import { POLLING_INTERVAL_MS } from './linear-issues/constants.js';

export function LinearIssuesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const {
    issues: failedIssues,
    loading: failedIssuesLoading,
    refresh: refreshFailedIssues,
  } = useFailedLinearIssues();
  const [data, setData] = useState<ListIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingFailedIssueId, setDeletingFailedIssueId] = useState<string | null>(null);
  const [retryingFailedIssueId, setRetryingFailedIssueId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadIssues = useCallback(
    async (showRefreshIndicator = false): Promise<void> => {
      try {
        if (showRefreshIndicator) {
          setRefreshing(true);
        }
        setError(null);
        const token = await getAccessToken();
        const response = await listLinearIssues(token, true);
        setData(response);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load issues. Make sure Linear is connected.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadIssues(false);
    }, POLLING_INTERVAL_MS);
    return (): void => {
      clearInterval(interval);
    };
  }, [loadIssues]);

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([loadIssues(true), refreshFailedIssues()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteFailedIssue = async (id: string): Promise<void> => {
    try {
      setDeletingFailedIssueId(id);
      setError(null);
      const token = await getAccessToken();
      await deleteFailedIssue(token, id);
      await refreshFailedIssues();
      setSuccessMessage('Failed issue deleted');
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to delete issue'));
    } finally {
      setDeletingFailedIssueId(null);
    }
  };

  const handleRetryFailedIssue = async (id: string): Promise<void> => {
    try {
      setRetryingFailedIssueId(id);
      setError(null);
      const token = await getAccessToken();
      const result = await retryFailedIssue(token, id);
      await Promise.all([refreshFailedIssues(), loadIssues(true)]);
      setSuccessMessage(`Issue created: ${result.issue.identifier}`);
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to retry issue creation'));
    } finally {
      setRetryingFailedIssueId(null);
    }
  };

  const handleSync = async (): Promise<void> => {
    try {
      setSyncing(true);
      setError(null);
      const token = await getAccessToken();
      const result = await syncFromLinear(token);
      await loadIssues(true);
      const syncedCount = result.created + result.updated;
      setSuccessMessage(
        `Synced ${String(syncedCount)} issue${syncedCount === 1 ? '' : 's'} from Linear` +
          (result.deleted > 0 ? ` (removed ${String(result.deleted)} deleted issue${result.deleted === 1 ? '' : 's'})` : '')
      );
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to sync from Linear'));
    } finally {
      setSyncing(false);
    }
  };

  if (loading || failedIssuesLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null && data === null) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-4 h-12 w-12 text-red-500 dark:text-red-400" />
          <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">Unable to load issues</h3>
          <p className="mb-4 text-slate-500 dark:text-slate-400">{error}</p>
          <Button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
          >
            Try again
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <IssuesPageHeader
        refreshing={refreshing}
        syncing={syncing}
        onRefresh={() => { void handleRefresh(); }}
        onSync={() => { void handleSync(); }}
      />
      <StatusBanners successMessage={successMessage} error={error} />
      <NeedsAttentionSection
        issues={failedIssues}
        onDelete={handleDeleteFailedIssue}
        onRetry={handleRetryFailedIssue}
        deletingId={deletingFailedIssueId}
        retryingId={retryingFailedIssueId}
      />
      <IssueBoard columnIssues={toColumnIssues(data)} />
    </Layout>
  );
}
