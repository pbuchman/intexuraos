import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, BarChart3, ArrowLeft } from 'lucide-react';
import { Button, Card, Layout, VisualizationCard } from '@/components';
import { useCompositeFeed } from '@/hooks/useCompositeFeeds';
import { useVisualizations } from '@/hooks/useVisualizations';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { Visualization, CompositeFeedData } from '@/types';

const MAX_VISUALIZATIONS = 3;

export function CompositeFeedVisualizationsPage(): React.JSX.Element {
  const { id = '' } = useParams();
  const { compositeFeed, loading: feedLoading, error: feedError, getFeedData } = useCompositeFeed(id);
  const {
    visualizations,
    loading: visualizationsLoading,
    error: visualizationsError,
    createVisualization,
    deleteVisualization,
    regenerateVisualization,
  } = useVisualizations(id);

  const [feedData, setFeedData] = useState<CompositeFeedData | null>(null);
  const [feedDataLoading, setFeedDataLoading] = useState(false);
  const [feedDataError, setFeedDataError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingVisualization, setEditingVisualization] = useState<Visualization | null>(null);

  useEffect(() => {
    if (id === '') {
      return;
    }

    const loadFeedData = async (): Promise<void> => {
      setFeedDataLoading(true);
      setFeedDataError(null);
      try {
        const data = await getFeedData();
        setFeedData(data);
      } catch (err) {
        setFeedDataError(getErrorMessage(err, 'Failed to load feed data'));
      } finally {
        setFeedDataLoading(false);
      }
    };

    void loadFeedData();
  }, [id, getFeedData]);

  const handleCreateVisualization = async (): Promise<void> => {
    if (feedData === null) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await createVisualization({ dataSnapshot: feedData });
    } catch (err) {
      setCreateError(getErrorMessage(err, 'Failed to create visualization'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteVisualization = async (visualizationId: string): Promise<void> => {
    await deleteVisualization(visualizationId);
  };

  const handleRegenerateVisualization = async (visualizationId: string): Promise<void> => {
    await regenerateVisualization(visualizationId);
  };

  const handleEditVisualization = (visualization: Visualization): void => {
    setEditingVisualization(visualization);
  };

  const loading = feedLoading || visualizationsLoading || feedDataLoading;
  const error = feedError ?? visualizationsError ?? feedDataError;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null && error !== '') {
    return (
      <Layout>
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      </Layout>
    );
  }

  if (compositeFeed === null || feedData === null) {
    return (
      <Layout>
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-700">
          Composite feed not found
        </div>
      </Layout>
    );
  }

  const canAddVisualization = visualizations.length < MAX_VISUALIZATIONS;

  return (
    <Layout>
      <div className="mb-6">
        <Link
          to={`/data-insights/composite-feeds/${id}`}
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Feed
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Visualizations</h2>
          <p className="text-slate-600">{compositeFeed.name}</p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            void handleCreateVisualization();
          }}
          disabled={!canAddVisualization || isCreating}
          isLoading={isCreating}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Chart
        </Button>
      </div>

      {!canAddVisualization ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-700">
          Maximum of {MAX_VISUALIZATIONS} visualizations reached. Delete one to add another.
        </div>
      ) : null}

      {createError !== null && createError !== '' ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {createError}
        </div>
      ) : null}

      {visualizations.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No visualizations yet</h3>
            <p className="mb-4 max-w-md text-slate-500">
              Create a visualization to generate an AI-powered chart for this composite feed. You
              can add up to {MAX_VISUALIZATIONS} charts.
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                void handleCreateVisualization();
              }}
              disabled={isCreating}
              isLoading={isCreating}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Chart
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {visualizations.map((visualization) => (
            <VisualizationCard
              key={visualization.id}
              visualization={visualization}
              feedData={feedData}
              onEdit={handleEditVisualization}
              onDelete={handleDeleteVisualization}
              onRegenerate={handleRegenerateVisualization}
            />
          ))}
        </div>
      )}

      {editingVisualization !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="max-w-2xl w-full mx-4 bg-white rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Edit Visualization</h3>
            <p className="text-sm text-slate-600 mb-4">
              Editing visualization: {editingVisualization.title}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={(): void => {
                  setEditingVisualization(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

export default CompositeFeedVisualizationsPage;
