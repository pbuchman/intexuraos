import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, Plus, Trash2, Database, FileText } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useCompositeFeeds, useDataSources } from '@/hooks';
import type { CompositeFeed } from '@/types';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncatePurpose(purpose: string, maxLength = 150): string {
  if (purpose.length <= maxLength) {
    return purpose;
  }
  return purpose.slice(0, maxLength).trim() + '...';
}

function DataInsightsTabs(): React.JSX.Element {
  return (
    <div className="mb-6 border-b border-slate-200">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        <Link
          to="/data-insights"
          className="border-b-2 border-blue-500 px-1 py-4 text-sm font-medium text-blue-600"
        >
          <Layers className="mr-2 inline h-4 w-4" />
          Composite Feeds
        </Link>
        <Link
          to="/data-insights/static-sources"
          className="border-b-2 border-transparent px-1 py-4 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
        >
          <Database className="mr-2 inline h-4 w-4" />
          Static Sources
        </Link>
      </nav>
    </div>
  );
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
          <h2 className="text-2xl font-bold text-slate-900">Composite Feeds</h2>
          <p className="text-slate-600">
            Aggregate data sources and notifications into unified feeds for LLM consumption.
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

      {dataSources.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">Add data sources first</h3>
            <p className="mb-4 max-w-md text-slate-500">
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
      ) : error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : compositeFeeds.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Layers className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No composite feeds yet</h3>
            <p className="mb-4 max-w-md text-slate-500">
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
        <div className="space-y-4">
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

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const sourceCount = feed.staticSourceIds.length;
  const filterCount = feed.notificationFilters.length;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <Link to={`/data-insights/${feed.id}`} className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-900 hover:text-blue-600 transition-colors">
            {feed.name}
          </h3>
          <p className="mt-1 text-sm text-slate-500 line-clamp-2">
            {truncatePurpose(feed.purpose)}
          </p>
          <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {sourceCount} source{sourceCount !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {filterCount} filter{filterCount !== 1 ? 's' : ''}
            </span>
            <span>Updated {formatDate(feed.updatedAt)}</span>
          </div>
        </Link>

        {!showDeleteConfirm ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              setShowDeleteConfirm(true);
            }}
            className="text-slate-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Delete "{feed.name}"?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleDelete();
              }}
              disabled={isDeleting}
              isLoading={isDeleting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
