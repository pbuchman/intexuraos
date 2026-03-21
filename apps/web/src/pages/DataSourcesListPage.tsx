import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, Plus, Trash2 } from 'lucide-react';
import { Button, Card, DataInsightsTabs, ErrorBanner, Layout } from '@/components';
import { useDataSources } from '@/hooks';
import { formatDate } from '@/utils/dateFormat';
import type { DataSource } from '@/types';

function truncateContent(content: string, maxLength = 120): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}

export function DataSourcesListPage(): React.JSX.Element {
  const { dataSources, loading, error, deleteDataSource } = useDataSources();

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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Data Sources</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {dataSources.length} data source{dataSources.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link to="/data-insights/static-sources/new">
          <Button type="button" variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add Data Source
          </Button>
        </Link>
      </div>

      <ErrorBanner message={error} className="mb-6" />

      {dataSources.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">No data sources yet</h3>
            <p className="mb-4 text-slate-500 dark:text-slate-400">
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
        <div className="space-y-1">
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
  const navigate = useNavigate();

  const handleDelete = async (): Promise<void> => {
    await onDelete();
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className="group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
      onClick={(): void => {
        void navigate(`/data-insights/static-sources/${dataSource.id}`);
      }}
    >
      <div className="grid grid-cols-[1fr_140px_60px] items-center gap-2">
        {/* Title + content preview */}
        <div className="min-w-0">
          <h3 className="font-medium text-slate-900 truncate dark:text-slate-100">
            {dataSource.title}
          </h3>
          <p className="text-xs text-slate-500 line-clamp-1 dark:text-slate-400">
            {truncateContent(dataSource.content)}
          </p>
        </div>
        {/* Updated time */}
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatDate(dataSource.updatedAt)}
        </span>
        {/* Actions — R8 hover-reveal trash */}
        <div className="flex items-center justify-end">
          <button
            onClick={(e): void => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* R5 overlay delete */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                void handleDelete();
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
