import { useEffect, useRef, useState } from 'react';
import { BarChart2, Loader2, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import embed from 'vega-embed';
import { Button, Card, DataInsightsTabs, Layout } from '@/components';
import { useVisualizations } from '@/hooks';
import { formatDate } from '@/utils/dateFormat';
import type { Visualization } from '@/types';

function StatusBadge({ status }: { status: Visualization['status'] }): React.JSX.Element {
  switch (status) {
    case 'pending':
    case 'refreshing':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {status === 'pending' ? 'Computing...' : 'Refreshing...'}
        </span>
      );
    case 'ready':
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          Ready
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
          Error
        </span>
      );
  }
}

export function VisualizationsListPage(): React.JSX.Element {
  const { visualizations, loading, isRefreshing, error, refresh, deleteVisualization, refreshVisualization } =
    useVisualizations();

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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Visualizations</h2>
          <p className="text-slate-600 dark:text-slate-300">
            Saved chart visualizations from your data insights.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={(): void => { void refresh(); }} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error !== null && error !== '' && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {visualizations.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart2 className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">
              No saved visualizations yet
            </h3>
            <p className="max-w-md text-slate-500 dark:text-slate-400">
              Go to a composite feed, analyze your data, and click &quot;Save Visualization&quot; on a chart
              to save it here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {visualizations.map((viz) => (
            <VisualizationCard
              key={viz.id}
              visualization={viz}
              onDelete={async (): Promise<void> => {
                await deleteVisualization(viz.id);
              }}
              onRefresh={async (): Promise<void> => {
                await refreshVisualization(viz.id);
              }}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

function InlineVegaChart({ spec, data }: { spec: Record<string, unknown>; data: object[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;

    const container = containerRef.current;
    const fullSpec = { ...spec, data: { values: data } };

    void embed(container, fullSpec as Parameters<typeof embed>[1], { actions: false, renderer: 'canvas' })
      .catch((err: unknown) => {
        setRenderError(err instanceof Error ? err.message : 'Chart render failed');
      });

    return (): void => {
      container.innerHTML = '';
    };
  }, [spec, data]);

  if (renderError !== null) {
    return (
      <div className="p-3 text-sm text-red-600 bg-red-50 rounded dark:bg-red-900/30 dark:text-red-400">
        Chart render failed: {renderError}
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}

interface VisualizationCardProps {
  visualization: Visualization;
  onDelete: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

function VisualizationCard({
  visualization,
  onDelete,
  onRefresh,
}: VisualizationCardProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">
              {visualization.insightTitle}
            </h3>
            <StatusBadge status={visualization.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {visualization.trackableMetric}
          </p>
          <div className="mt-1 flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
            <span>Feed: {visualization.feedName}</span>
            {visualization.lastRefreshedAt !== undefined && (
              <span>Refreshed {formatDate(visualization.lastRefreshedAt)}</span>
            )}
          </div>
        </div>

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              void handleRefresh();
            }}
            disabled={isRefreshing}
            className="text-slate-400 hover:text-blue-600"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
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
      </div>

      {visualization.status === 'error' && visualization.lastError !== undefined && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{visualization.lastError}</p>
        </div>
      )}

      {visualization.status === 'ready' && visualization.chartData !== null && (
        <div className="mt-4">
          <InlineVegaChart
            spec={visualization.chartConfig}
            data={visualization.chartData as object[]}
          />
        </div>
      )}

      {showDeleteConfirm && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <p className="mb-3 text-sm text-red-800 dark:text-red-300">
            Delete this visualization?
          </p>
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
      )}
    </Card>
  );
}

