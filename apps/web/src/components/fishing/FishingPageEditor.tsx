import { Link } from 'react-router-dom';
import { AlertTriangle, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button, Card } from '@/components';
import type { FishingKnowledgePage } from '@/types/fishingAssistant';

interface FishingPageEditorProps {
  readonly page: FishingKnowledgePage;
  readonly folderName: string;
  readonly rawText: string;
  readonly saving: boolean;
  readonly reindexing: boolean;
  readonly deleting: boolean;
  readonly error: string | null;
  readonly onRawTextChange: (value: string) => void;
  readonly onSave: () => Promise<void>;
  readonly onReindex: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
}

export function FishingPageEditor({
  page,
  folderName,
  rawText,
  saving,
  reindexing,
  deleting,
  error,
  onRawTextChange,
  onSave,
  onReindex,
  onDelete,
}: FishingPageEditorProps): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/fishing-assistant/knowledge"
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Back to Knowledge Base
          </Link>
          <h2 className="mt-1 break-words text-2xl font-bold text-slate-900 dark:text-slate-100">
            {page.title}
          </h2>
        </div>
        <div
          data-testid="fishing-page-editor-actions"
          className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap"
        >
          <Button
            variant="secondary"
            onClick={(): void => { void onReindex(); }}
            isLoading={reindexing}
            loadingText="Reindexing..."
            className="w-full sm:w-auto"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reindex
          </Button>
          <Button
            onClick={(): void => { void onSave(); }}
            isLoading={saving}
            loadingText="Saving..."
            className="w-full sm:w-auto"
          >
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          <Button
            variant="danger"
            onClick={(): void => { void onDelete(); }}
            isLoading={deleting}
            loadingText="Deleting..."
            className="w-full sm:w-auto"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {error !== null ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {page.indexingStatus === 'failed' && page.indexingError !== undefined ? (
        <Card variant="warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="font-medium text-slate-900 dark:text-slate-100">
                Indexing failed
              </p>
              <p className="break-words text-sm text-slate-700 dark:text-slate-300">
                {page.indexingError}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div
        data-testid="fishing-page-editor-grid"
        className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"
      >
        <Card title="Raw Content">
          <textarea
            value={rawText}
            onChange={(event): void => { onRawTextChange(event.target.value); }}
            rows={26}
            className="min-h-[420px] w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </Card>

        <div className="min-w-0 space-y-4">
          <Card title="Metadata">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Folder</dt>
                <dd className="break-words font-medium text-slate-900 dark:text-slate-100">
                  {folderName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Content type</dt>
                <dd className="break-words font-medium text-slate-900 capitalize dark:text-slate-100">
                  {page.contentType}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Indexing status</dt>
                <dd className="break-words font-medium text-slate-900 capitalize dark:text-slate-100">
                  {page.indexingStatus}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Chunk count</dt>
                <dd className="break-words font-medium text-slate-900 dark:text-slate-100">
                  {String(page.chunkCount)}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Normalized Preview">
            <pre
              data-testid="fishing-page-preview"
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300"
            >
              {page.normalizedText}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
