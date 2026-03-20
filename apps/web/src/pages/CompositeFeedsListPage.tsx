import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, Layers, Plus, Trash2 } from 'lucide-react';
import { Button, Card, DataInsightsTabs, ErrorBanner, Layout } from '@/components';
import { useCompositeFeeds, useDataSources } from '@/hooks';
import { formatRelative } from '@/utils/dateFormat';
import type { CompositeFeed } from '@/types';

function truncatePurpose(purpose: string, maxLength = 80): string {
  if (purpose.length <= maxLength) {
    return purpose;
  }
  return purpose.slice(0, maxLength).trim() + '...';
}

export function CompositeFeedsListPage(): React.JSX.Element {
  const { compositeFeeds, loading, error, deleteCompositeFeed } = useCompositeFeeds();
  const { dataSources } = useDataSources();
  const navigate = useNavigate();

  if (loading) {
    return (
      <Layout>
        <DataInsightsTabs />
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <DataInsightsTabs />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Composite Feeds</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {compositeFeeds.length} feed{compositeFeeds.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => void navigate('/data-insights/new')}
          disabled={dataSources.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Feed
        </Button>
      </div>

      <ErrorBanner message={error} className="mb-6" />

      {dataSources.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">Add data sources first</h3>
            <p className="mb-4 max-w-md text-slate-500 dark:text-slate-400">
              Composite feeds aggregate data sources and notification filters. Create at least one
              static data source to get started.
            </p>
            <Link to="/data-insights/static-sources/new">
              <Button type="button" variant="primary">
                <Plus className="mr-2 h-4 w-4" />
                Add Data Source
              </Button>
            </Link>
          </div>
        </Card>
      ) : compositeFeeds.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Layers className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">No composite feeds yet</h3>
            <p className="mb-4 max-w-md text-slate-500 dark:text-slate-400">
              Create a composite feed to aggregate your data sources and mobile notification filters
              into a single LLM-consumable feed.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => void navigate('/data-insights/new')}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Feed
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-1">
          {compositeFeeds.map((feed) => (
            <CompositeFeedRow
              key={feed.id}
              feed={feed}
              onDelete={async (): Promise<void> => {
                await deleteCompositeFeed(feed.id);
              }}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

interface CompositeFeedRowProps {
  feed: CompositeFeed;
  onDelete: () => Promise<void>;
}

function CompositeFeedRow({ feed, onDelete }: CompositeFeedRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      setShowDeleteConfirm(false);
    } catch {
      setDeleteError('Failed to delete. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const sourceCount = feed.staticSourceIds.length;

  return (
    <div className="group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="grid grid-cols-[1fr_auto_140px_60px] items-center gap-2">
        <Link to={`/data-insights/${feed.id}`} className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{feed.name}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{truncatePurpose(feed.purpose)}</p>
        </Link>

        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {sourceCount} source{sourceCount !== 1 ? 's' : ''}
        </span>

        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelative(feed.updatedAt)}</span>

        <div className="flex items-center justify-end">
          <button
            onClick={(e): void => {
              e.stopPropagation();
              setDeleteError(null);
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            {deleteError !== null && (
              <p className="text-xs text-red-600 dark:text-red-400">{deleteError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={(): void => {
                  setShowDeleteConfirm(false);
                }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={(): void => {
                  void handleDelete();
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
