import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Layers, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Layout, RefreshIndicator } from '@/components';
import { useDataSources } from '@/hooks';
import type { DataSource } from '@/types';

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

function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}

function DataInsightsTabs(): React.JSX.Element {
  return (
    <div className="mb-6 border-b border-slate-200">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        <Link
          to="/data-insights"
          className="border-b-2 border-transparent px-1 py-4 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
        >
          <Layers className="mr-2 inline h-4 w-4" />
          Composite Feeds
        </Link>
        <Link
          to="/data-insights/static-sources"
          className="border-b-2 border-blue-500 px-1 py-4 text-sm font-medium text-blue-600"
        >
          <Database className="mr-2 inline h-4 w-4" />
          Static Sources
        </Link>
      </nav>
    </div>
  );
}

export function DataSourcesListPage(): React.JSX.Element {
  const { dataSources, loading, refreshing, error, deleteDataSource } = useDataSources();

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
          <h2 className="text-2xl font-bold text-slate-900">Data Sources</h2>
          <p className="text-slate-600">Manage your custom data sources for analysis.</p>
        </div>
        <Link to="/data-insights/static-sources/new">
          <Button type="button" variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add Data Source
          </Button>
        </Link>
      </div>

      <RefreshIndicator show={refreshing} />

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {dataSources.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No data sources yet</h3>
            <p className="mb-4 text-slate-500">
              Add your first data source to get started with analysis.
            </p>
            <Link to="/data-insights/static-sources/new">
              <Button type="button" variant="primary">
                <Plus className="mr-2 h-4 w-4" />
                Add Data Source
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {dataSources.map((dataSource) => (
            <DataSourceRow
              key={dataSource.id}
              dataSource={dataSource}
              onDelete={async (): Promise<void> => {
                await deleteDataSource(dataSource.id);
              }}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

interface DataSourceRowProps {
  dataSource: DataSource;
  onDelete: () => Promise<void>;
}

function DataSourceRow({ dataSource, onDelete }: DataSourceRowProps): React.JSX.Element {
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

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <Link to={`/data-insights/static-sources/${dataSource.id}`} className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-900 hover:text-blue-600 transition-colors">
            {dataSource.title}
          </h3>
          <p className="mt-1 text-sm text-slate-500 line-clamp-2">
            {truncateContent(dataSource.content)}
          </p>
          <p className="mt-2 text-xs text-slate-400">Updated {formatDate(dataSource.updatedAt)}</p>
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
          <p className="mb-3 text-sm text-red-800">Delete "{dataSource.title}"?</p>
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
