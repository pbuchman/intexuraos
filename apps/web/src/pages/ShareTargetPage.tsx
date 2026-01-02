import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { createCommand } from '@/services/commandsApi';

function combineSharedContent(params: {
  title: string | null;
  text: string | null;
  url: string | null;
}): string {
  const parts: string[] = [];

  if (params.title !== null && params.title.trim() !== '') {
    parts.push(params.title.trim());
  }

  if (params.text !== null && params.text.trim() !== '') {
    parts.push(params.text.trim());
  }

  if (params.url !== null && params.url.trim() !== '') {
    const urlAlreadyInText = params.text?.includes(params.url.trim()) ?? false;
    if (!urlAlreadyInText) {
      parts.push(params.url.trim());
    }
  }

  return parts.join('\n\n');
}

export function ShareTargetPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getAccessToken } = useAuth();

  const title = searchParams.get('title');
  const text = searchParams.get('text');
  const url = searchParams.get('url');

  const initialContent = combineSharedContent({ title, text, url });

  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialContent === '') {
      void navigate('/inbox', { replace: true });
    }
  }, [initialContent, navigate]);

  const handleSave = async (): Promise<void> => {
    if (content.trim() === '') {
      setError('Content cannot be empty');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const token = await getAccessToken();
      await createCommand(token, { text: content.trim(), source: 'pwa-shared' });
      void navigate('/inbox', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const handleCancel = (): void => {
    void navigate('/inbox', { replace: true });
  };

  if (initialContent === '') {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <div className="p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Share2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Shared Content</h1>
                <p className="text-sm text-slate-500">Review and save to your inbox</p>
              </div>
            </div>

            {error !== null && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <textarea
              value={content}
              onChange={(e): void => {
                setContent(e.target.value);
              }}
              className="mb-6 h-48 w-full resize-none rounded-lg border border-slate-300 p-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Shared content..."
              disabled={saving}
            />

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={handleCancel}
                disabled={saving}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving || content.trim() === ''}
                className="flex-1"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
