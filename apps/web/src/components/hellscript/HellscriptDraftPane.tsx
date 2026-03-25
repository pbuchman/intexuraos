import { MarkdownContent } from '@/components/MarkdownContent';
import type { HellscriptDraftVersion } from '@/types';

interface HellscriptDraftPaneProps {
  draft: HellscriptDraftVersion | null;
}

export function HellscriptDraftPane({ draft }: HellscriptDraftPaneProps): React.JSX.Element {
  if (draft === null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-slate-400 dark:text-slate-500">
          No draft yet. Add whispers and ask to forge a draft.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 border-b border-slate-200 pb-2 dark:border-slate-700">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Draft v{String(draft.versionNumber)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <MarkdownContent content={draft.markdown} />
      </div>
    </div>
  );
}
