import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components';
import { FishingPageEditor } from '@/components/fishing';
import { useFishingKnowledge } from '@/hooks';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import type { FishingKnowledgePage } from '@/types/fishingAssistant';

export function FishingKnowledgePageEditor(): React.JSX.Element {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const {
    folders,
    error: knowledgeError,
    loadPage: loadKnowledgePage,
    updatePage,
    reindexPage,
    deletePage,
  } = useFishingKnowledge();
  const [page, setPage] = useState<FishingKnowledgePage | null>(null);
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (): Promise<void> => {
    if (pageId === undefined) {
      setError('Knowledge page route is missing the page id.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextPage = await loadKnowledgePage(pageId);
      setPage(nextPage);
      setRawText(nextPage.rawText);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load Fishing Assistant knowledge page'));
    } finally {
      setLoading(false);
    }
  }, [loadKnowledgePage, pageId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const folderName = useMemo(() => {
    if (page === null) {
      return 'Unknown folder';
    }
    return folders.find((folder) => folder.id === page.folderId)?.name ?? page.folderId;
  }, [folders, page]);

  return (
    <Layout>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      ) : page === null ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error ?? 'Knowledge page not found.'}
        </div>
      ) : (
        <FishingPageEditor
          page={page}
          folderName={folderName}
          rawText={rawText}
          saving={saving}
          reindexing={reindexing}
          deleting={deleting}
          error={error ?? knowledgeError}
          onRawTextChange={setRawText}
          onSave={async (): Promise<void> => {
            setSaving(true);
            setError(null);
            try {
              const updated = await updatePage(page.id, rawText);
              setPage(updated);
              setRawText(updated.rawText);
            } catch (err: unknown) {
              setError(getErrorMessage(err, 'Failed to save knowledge page'));
            } finally {
              setSaving(false);
            }
          }}
          onReindex={async (): Promise<void> => {
            setReindexing(true);
            setError(null);
            try {
              const updated = await reindexPage(page.id);
              setPage(updated);
            } catch (err: unknown) {
              setError(getErrorMessage(err, 'Failed to reindex knowledge page'));
            } finally {
              setReindexing(false);
            }
          }}
          onDelete={async (): Promise<void> => {
            if (!window.confirm(`Delete page "${page.title}"?`)) {
              return;
            }
            setDeleting(true);
            setError(null);
            try {
              await deletePage(page.id);
              void navigate('/fishing-assistant/knowledge');
            } catch (err: unknown) {
              setError(getErrorMessage(err, 'Failed to delete knowledge page'));
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </Layout>
  );
}
