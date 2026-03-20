import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '@/components';
import {
  HellscriptTimeline,
  HellscriptComposer,
  HellscriptDraftPane,
  HellscriptVersionSelector,
} from '@/components/hellscript/index.js';
import { useHellscriptWorkspace } from '@/hooks';
import type { HellscriptDraftVersion } from '@/types';

export function HellscriptConversationPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { workspace, loading, error, impose, imposing } = useHellscriptWorkspace(id);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

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

  const isNewConversation = id === undefined;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {isNewConversation
              ? 'New Conversation'
              : workspace?.buffer.title ?? 'Loading...'}
          </h2>
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
              <HellscriptComposer onSubmit={impose} disabled={imposing} />
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
