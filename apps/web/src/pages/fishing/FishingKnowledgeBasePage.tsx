import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Layout } from '@/components';
import { FishingKnowledgeTree } from '@/components/fishing';
import { useFishingKnowledge } from '@/hooks';
import { formatRelative } from '@/utils/dateFormat';
import type { FishingKnowledgePage } from '@/types/fishingAssistant';

function sortPages(pages: readonly FishingKnowledgePage[]): FishingKnowledgePage[] {
  return [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function FishingKnowledgeBasePage(): React.JSX.Element {
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const navigate = useNavigate();
  const knowledge = useFishingKnowledge(selectedFolderId);

  useEffect(() => {
    if (knowledge.folders.length === 0) {
      if (selectedFolderId !== undefined) {
        setSelectedFolderId(undefined);
      }
      return;
    }

    if (selectedFolderId === undefined) {
      setSelectedFolderId(knowledge.folders[0]?.id);
      return;
    }

    if (!knowledge.folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(knowledge.folders[0]?.id);
    }
  }, [knowledge.folders, selectedFolderId]);

  const selectedFolder = useMemo(
    () => knowledge.folders.find((folder) => folder.id === selectedFolderId),
    [knowledge.folders, selectedFolderId]
  );
  const sortedPages = useMemo(() => sortPages(knowledge.pages), [knowledge.pages]);

  const handleCreatePage = useCallback(async (): Promise<void> => {
    if (selectedFolderId === undefined) {
      return;
    }
    const page = await knowledge.createPage(
      selectedFolderId,
      'Untitled knowledge page\n\nAdd your notes here.'
    );
    void navigate(`/fishing-assistant/knowledge/pages/${encodeURIComponent(page.id)}`);
  }, [knowledge, navigate, selectedFolderId]);

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Knowledge Base
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Store bait recipes, session notes, theory, and reusable fishing guidance.
          </p>
        </div>
        <Button onClick={(): void => { void handleCreatePage(); }} disabled={selectedFolderId === undefined}>
          New Page
        </Button>
      </div>

      {knowledge.error !== null ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {knowledge.error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FishingKnowledgeTree
          folders={knowledge.folders}
          selectedFolderId={selectedFolderId}
          busy={knowledge.mutating}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={async (name): Promise<void> => {
            await knowledge.createFolder(name);
          }}
          onRenameFolder={async (folderId, name, parentId, sortOrder): Promise<void> => {
            await knowledge.renameFolder(folderId, name, parentId, sortOrder);
          }}
          onDeleteFolder={async (folderId): Promise<void> => {
            await knowledge.deleteFolder(folderId);
          }}
        />

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {selectedFolder?.name ?? 'Select a folder'}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {selectedFolder !== undefined
                  ? `${String(selectedFolder.pageCount)} page${selectedFolder.pageCount === 1 ? '' : 's'}`
                  : 'Choose a folder to browse and edit pages.'}
              </p>
            </div>
          </div>

          {knowledge.loading && sortedPages.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            </div>
          ) : selectedFolderId === undefined ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
              Create a folder and select it to start writing knowledge pages.
            </div>
          ) : sortedPages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
              No pages in this folder yet.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedPages.map((page) => (
                <div
                  key={page.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-medium text-slate-900 dark:text-slate-100">
                        {page.title}
                      </h4>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {page.contentType} · {page.indexingStatus} · {String(page.chunkCount)} chunk{page.chunkCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/fishing-assistant/knowledge/pages/${encodeURIComponent(page.id)}`}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={(): void => {
                          if (window.confirm(`Delete page "${page.title}"?`)) {
                            void knowledge.deletePage(page.id);
                          }
                        }}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    {page.rawText.slice(0, 180)}
                    {page.rawText.length > 180 ? '...' : ''}
                  </p>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Updated {formatRelative(page.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
