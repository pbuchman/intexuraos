import { useState } from 'react';
import { Edit2, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { Button, Card } from '@/components';
import { VegaChart } from './VegaChart';
import type { Visualization, CompositeFeedData } from '@/types';

interface VisualizationCardProps {
  visualization: Visualization;
  feedData: CompositeFeedData;
  onEdit: (visualization: Visualization) => void;
  onDelete: (visualizationId: string) => Promise<void>;
  onRegenerate: (visualizationId: string) => Promise<void>;
}

export function VisualizationCard({
  visualization,
  feedData,
  onEdit,
  onDelete,
  onRegenerate,
}: VisualizationCardProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete(visualization.id);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleRegenerate = async (): Promise<void> => {
    setIsRegenerating(true);
    setRenderError(null);
    try {
      await onRegenerate(visualization.id);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRenderError = (error: Error): void => {
    setRenderError(error.message);
  };

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">{visualization.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{visualization.insights}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              void handleRegenerate();
            }}
            disabled={isRegenerating || isDeleting}
            isLoading={isRegenerating}
            className="text-slate-400 hover:text-blue-600"
            title="Regenerate chart"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              onEdit(visualization);
            }}
            disabled={isRegenerating || isDeleting}
            className="text-slate-400 hover:text-blue-600"
            title="Edit chart"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
          {!showDeleteConfirm ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(true);
              }}
              disabled={isRegenerating || isDeleting}
              className="text-slate-400 hover:text-red-600"
              title="Delete chart"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {renderError !== null ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Chart rendering failed</p>
            <p className="mt-1 text-sm text-red-700">{renderError}</p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleRegenerate();
              }}
              disabled={isRegenerating}
              isLoading={isRegenerating}
              className="mt-3"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <VegaChart spec={visualization.vegaSpec} data={feedData} onRenderError={handleRenderError} />
        </div>
      )}

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Delete "{visualization.title}"?</p>
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
