import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, BarChart2, Loader2, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import embed from 'vega-embed';
import { Button, Card, DataInsightsTabs, ErrorBanner, Layout } from '@/components';
import { useVisualizations } from '@/hooks';
import { formatDate } from '@/utils/dateFormat';
import type { Visualization } from '@/types';

type VizStatus = 'pending' | 'refreshing' | 'ready' | 'error';

const VIZ_STATUS_MAP: Record<VizStatus, { bg: string; text: string; label: string }> = {
  pending:    { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Computing...' },
  refreshing: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', label: 'Refreshing...' },
  ready:      { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', label: 'Ready' },
  error:      { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Error' },
};

type VizFilterStatus = 'computing' | 'ready' | 'error';

const VIZ_FILTER_CONFIG: Record<VizFilterStatus, { label: string; dotClass: string; activeClass: string }> = {
  computing: { label: 'Computing', dotClass: 'bg-blue-500', activeClass: 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400' },
  ready:    { label: 'Ready', dotClass: 'bg-green-500', activeClass: 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400' },
  error:    { label: 'Error', dotClass: 'bg-red-500', activeClass: 'border-red-500 bg-red-50 text-red-700 dark:border-red-400 dark:bg-red-900/30 dark:text-red-400' },
};

type VizSortOption = 'created' | 'name';
const VIZ_SORT_OPTIONS: { key: VizSortOption; label: string }[] = [
  { key: 'created', label: 'Created' },
  { key: 'name', label: 'Name' },
];

const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

function StatusBadge({ status }: { status: Visualization['status'] }): React.JSX.Element {
  const config = VIZ_STATUS_MAP[status as VizStatus];
  const isComputing = status === 'pending' || status === 'refreshing';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
      {isComputing && <Loader2 className="h-3 w-3 animate-spin" />}
      {config.label}
    </span>
  );
}

export function VisualizationsListPage(): React.JSX.Element {
  const { visualizations, loading, isRefreshing, error, refresh, deleteVisualization, refreshVisualization } =
    useVisualizations();

  // Filter state
  const [activeFilters, setActiveFilters] = useState<Set<VizFilterStatus>>(
    () => new Set(['computing', 'ready', 'error'])
  );

  // Sort state
  const [sort, setSort] = useState<VizSortOption>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('viz-sort');
      if (stored === 'created' || stored === 'name') {
        return stored;
      }
    }
    return 'created';
  });

  // Persist filter to localStorage
  useEffect(() => {
    localStorage.setItem('viz-status-filter', JSON.stringify([...activeFilters]));
  }, [activeFilters]);

  // Load filter from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('viz-status-filter');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as VizFilterStatus[];
        setActiveFilters(new Set(parsed));
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  // Persist sort to localStorage
  useEffect(() => {
    localStorage.setItem('viz-sort', sort);
  }, [sort]);

  const toggleFilter = (filter: VizFilterStatus): void => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  const filteredVisualizations = useMemo(() => {
    return visualizations.filter((viz) => {
      if (activeFilters.has('computing') && (viz.status === 'pending' || viz.status === 'refreshing')) {
        return true;
      }
      if (activeFilters.has('ready') && viz.status === 'ready') {
        return true;
      }
      if (activeFilters.has('error') && viz.status === 'error') {
        return true;
      }
      return false;
    });
  }, [visualizations, activeFilters]);

  // Filter counts for pills - computed first to avoid redundant filtering
  const filterCounts: Record<VizFilterStatus, number> = useMemo(() => ({
    computing: visualizations.filter((v) => v.status === 'pending' || v.status === 'refreshing').length,
    ready: visualizations.filter((v) => v.status === 'ready').length,
    error: visualizations.filter((v) => v.status === 'error').length,
  }), [visualizations]);

  const sortedVisualizations = useMemo(() => {
    return [...filteredVisualizations].sort((a, b) => {
      if (sort === 'name') {
        return a.insightTitle.localeCompare(b.insightTitle);
      }
      // created (desc) - default
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filteredVisualizations, sort]);

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

      {/* R1 Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Visualizations</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {visualizations.length} visualizations · {filterCounts.computing} computing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={(): void => { void refresh(); }} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* R6 ErrorBanner */}
      <ErrorBanner message={error} className="mb-6" />

      {/* R2 Filter Pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(VIZ_FILTER_CONFIG) as VizFilterStatus[]).map((filter) => {
          const config = VIZ_FILTER_CONFIG[filter];
          const isActive = activeFilters.has(filter);
          const count = filterCounts[filter];
          return (
            <button
              key={filter}
              onClick={(): void => { toggleFilter(filter); }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive ? config.activeClass : INACTIVE_CLASS
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
              {config.label}
              <span className="font-medium">{String(count)}</span>
            </button>
          );
        })}
      </div>

      {/* R3 Sort Selector */}
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
        <div className="flex gap-1.5">
          {VIZ_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => { setSort(key); }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                sort === key
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sortedVisualizations.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart2 className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">
              {visualizations.length === 0 ? 'No saved visualizations yet' : 'No visualizations match your filters'}
            </h3>
            <p className="max-w-md text-slate-500 dark:text-slate-400">
              {visualizations.length === 0
                ? 'Go to a composite feed, analyze your data, and click &quot;Save Visualization&quot; on a chart to save it here.'
                : 'Try adjusting your filters to see more visualizations.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedVisualizations.map((viz) => (
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
      <div className="relative group flex items-start justify-between gap-4">
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
          <button
            onClick={(e): void => { e.stopPropagation(); setShowDeleteConfirm(true); }}
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* R5 Overlay Delete */}
        {showDeleteConfirm ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
            onClick={(e): void => { e.stopPropagation(); }}
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
              <p className="text-sm text-slate-700 dark:text-slate-200">Delete this visualization?</p>
              <button
                onClick={(): void => { setShowDeleteConfirm(false); }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={(): void => { void handleDelete(); }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ) : null}
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
    </Card>
  );
}
