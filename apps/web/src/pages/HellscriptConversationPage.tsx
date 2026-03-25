import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PenTool, X } from 'lucide-react';
import { Layout } from '@/components';
import {
  HellscriptTimeline,
  HellscriptComposer,
  HellscriptDraftPane,
  HellscriptVersionSelector,
} from '@/components/hellscript/index.js';
import { useHellscriptWorkspace } from '@/hooks';
import type { HellscriptDraftVersion, WritingCategory } from '@/types';
import { WRITING_CATEGORIES } from '@/types';

export function HellscriptConversationPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { workspace, loading, error, impose, imposing, lastAction, clearLastAction } = useHellscriptWorkspace(id);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [pendingUtterance, setPendingUtterance] = useState<string | null>(null);

  const versions = useMemo<HellscriptDraftVersion[]>(
    () => workspace?.draftVersions ?? [],
    [workspace?.draftVersions]
  );

  const selectedDraft = useMemo<HellscriptDraftVersion | null>(() => {
    if (versions.length === 0) return null;

    if (selectedVersionId !== null) {
      const found = versions.find((v) => v.id === selectedVersionId);
      if (found !== undefined) return found;
    }

    // Default to latest version
    const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
    return sorted[0] ?? null;
  }, [versions, selectedVersionId]);

  const handleCategorySelect = useCallback(
    (selectedCategory: WritingCategory) => {
      const utterance = pendingUtterance ?? `Generate a ${selectedCategory} draft`;
      setPendingUtterance(null);
      void impose(utterance, selectedCategory);
    },
    [impose, pendingUtterance]
  );

  const isNewConversation = id === undefined;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {isNewConversation
              ? 'New Summoning'
              : workspace?.buffer.title ?? 'Loading...'}
          </h2>
          <Link
            to="/hellscript/voice"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <PenTool className="h-3.5 w-3.5" />
            Writing voice
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : error !== null && workspace === null && !isNewConversation ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* Left pane: Timeline + Composer */}
            <div className="flex min-h-[500px] flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Timeline
              </div>
              <div className="flex-1 overflow-y-auto">
                <HellscriptTimeline events={workspace?.events ?? []} />
              </div>
              <HellscriptComposer onSubmit={(utterance: string) => {
                setPendingUtterance(utterance);
                return impose(utterance);
              }} disabled={imposing} />
              {lastAction === 'category_required' ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-amber-800 dark:text-amber-300">
                      Which platform is this draft for?
                    </span>
                    <button
                      type="button"
                      onClick={clearLastAction}
                      className="rounded p-0.5 text-amber-400 transition-colors hover:text-amber-600 dark:hover:text-amber-200"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {WRITING_CATEGORIES.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        disabled={imposing}
                        onClick={() => { handleCategorySelect(key); }}
                        className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {error !== null ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
              ) : null}
            </div>

            {/* Right pane: Draft + Version Selector */}
            <div className="flex min-h-[500px] flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Draft
                </span>
                <HellscriptVersionSelector
                  versions={versions}
                  selectedVersionId={selectedDraft?.id ?? null}
                  onSelect={setSelectedVersionId}
                />
              </div>
              <div className="flex-1">
                <HellscriptDraftPane draft={selectedDraft} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
