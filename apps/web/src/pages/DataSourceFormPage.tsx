import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button, Card, Input, Layout, RefreshIndicator } from '@/components';
import { useAuth } from '@/context';
import { useDataSource } from '@/hooks';
import { createDataSource } from '@/services/dataSourceApi';

const MAX_CONTENT_LENGTH = 60000;
const MAX_TITLE_LENGTH = 200;

export function DataSourceFormPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();

  const isEditMode = id !== undefined && id !== '';
  const {
    dataSource,
    loading: fetchLoading,
    refreshing,
    error: fetchError,
    updateDataSource,
    generateTitle,
    generatingTitle,
  } = useDataSource(id ?? '');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && dataSource !== null) {
      setTitle(dataSource.title);
      setContent(dataSource.content);
    }
  }, [isEditMode, dataSource]);

  const handleGenerateTitle = async (): Promise<void> => {
    if (content.trim().length === 0) {
      setError('Enter content first to generate a title');
      return;
    }

    setError(null);

    try {
      const generatedTitle = await generateTitle(content);
      setTitle(generatedTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate title');
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (title.trim().length === 0) {
      setError('Title is required');
      return;
    }

    if (content.trim().length === 0) {
      setError('Content is required');
      return;
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      setError(`Content exceeds maximum length of ${String(MAX_CONTENT_LENGTH)} characters`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEditMode) {
        await updateDataSource({ title: title.trim(), content: content.trim() });
      } else {
        const token = await getAccessToken();
        await createDataSource(token, { title: title.trim(), content: content.trim() });
      }

      void navigate('/data-insights');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save data source');
    } finally {
      setSaving(false);
    }
  };

  const canGenerateTitle = content.trim().length > 0 && !generatingTitle && !saving;
  const canSubmit =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    content.length <= MAX_CONTENT_LENGTH &&
    !saving &&
    !generatingTitle;

  if (isEditMode && fetchLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (isEditMode && fetchError !== null) {
    return (
      <Layout>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {fetchError}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          {isEditMode ? 'Edit Data Source' : 'Add Data Source'}
        </h2>
        <p className="text-slate-600">
          {isEditMode ? 'Update your data source content.' : 'Add a new data source for analysis.'}
        </p>
      </div>

      <RefreshIndicator show={refreshing} />

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        <Card>
          <div className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  label="Title"
                  value={title}
                  onChange={(e): void => {
                    setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH));
                  }}
                  placeholder="Enter a descriptive title..."
                  disabled={saving || generatingTitle}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={(): void => {
                  void handleGenerateTitle();
                }}
                disabled={!canGenerateTitle}
                isLoading={generatingTitle}
                title={
                  content.trim().length === 0
                    ? 'Enter content first to generate a title'
                    : 'Generate title using AI'
                }
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate
              </Button>
            </div>
            <p className="text-sm text-slate-500">
              {String(title.length)}/{String(MAX_TITLE_LENGTH)} characters
            </p>
          </div>
        </Card>

        <Card title="Content">
          <div className="space-y-2">
            <textarea
              value={content}
              onChange={(e): void => {
                setContent(e.target.value);
              }}
              placeholder="Paste or type your content here..."
              className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[300px]"
              disabled={saving || generatingTitle}
            />
            <p
              className={`text-sm ${content.length > MAX_CONTENT_LENGTH ? 'text-red-600' : 'text-slate-500'}`}
            >
              {content.length.toLocaleString()}/{MAX_CONTENT_LENGTH.toLocaleString()} characters
            </p>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => {
              void navigate('/data-insights');
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={(): void => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            isLoading={saving}
          >
            {isEditMode ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
