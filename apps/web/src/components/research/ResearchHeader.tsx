import { useState } from 'react';
import { CheckCircle, ChevronDown, Copy, Link2, Star } from 'lucide-react';
import { ErrorBanner } from '@/components';
import type { Research } from '@/services/researchAgentApi.types';
import { getProviderForModel } from '@/services/researchAgentApi.types';
import { formatRelative } from '@/utils/dateFormat';
import { stripMarkdown } from '@/utils';
import { ResearchStatusBadge, getModelDisplayName, isProcessingStatus } from './shared.js';

interface ResearchHeaderProps {
  research: Research;
  togglingFavourite: boolean;
  favouriteError: string | null;
  onToggleFavourite: () => void;
  copiedSection: string | null;
  onCopyToClipboard: (text: string, section: string) => void;
}

export function ResearchHeader({
  research,
  togglingFavourite,
  favouriteError,
  onToggleFavourite,
  copiedSection,
  onCopyToClipboard,
}: ResearchHeaderProps): React.JSX.Element {
  const [linksExpanded, setLinksExpanded] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  );

  const isProcessing = isProcessingStatus(research.status);

  const getDisplayTitle = (): string => {
    if (research.title !== '') {
      return stripMarkdown(research.title);
    }
    if (research.status === 'failed') {
      return 'Research Failed';
    }
    return 'Processing...';
  };

  const uniqueProviders = [...new Set(research.selectedModels.map(getProviderForModel))];

  return (
    <div className="mb-6">
      {/* Row 1: Title + Status + Favourite */}
      <div className="flex flex-wrap items-center gap-3 min-h-[2.5rem]">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{getDisplayTitle()}</h2>
        <ResearchStatusBadge status={research.status} />
        <button
          onClick={onToggleFavourite}
          disabled={togglingFavourite}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          aria-label={research.favourite === true ? 'Unfavourite' : 'Favourite'}
        >
          <Star
            className={`h-5 w-5 ${research.favourite === true ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`}
          />
        </button>
      </div>
      <ErrorBanner message={favouriteError} className="mt-2" />

      {/* Row 2: Time + Model chips */}
      <div className="flex flex-wrap items-center gap-2 mt-1 min-h-[1.75rem]">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {isProcessing || research.status === 'awaiting_confirmation'
            ? `Started ${formatRelative(research.startedAt)}`
            : research.completedAt !== undefined
              ? `Finished ${formatRelative(research.completedAt)}`
              : `Started ${formatRelative(research.startedAt)}`}
        </span>
        {uniqueProviders.map((provider) => (
          <span key={provider} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {provider}
          </span>
        ))}
        {research.selectedModels.length > 1 || (research.inputContexts !== undefined && research.inputContexts.length > 0) ? (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-600 dark:bg-purple-900/50 dark:text-purple-300">
            synthesis: {getModelDisplayName(research.synthesisModel)}
          </span>
        ) : null}
      </div>

      {/* Collapsible Links Section */}
      {(research.shareInfo !== undefined || research.notionExportInfo !== undefined) &&
      research.status === 'completed' ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={(): void => {
              setLinksExpanded(!linksExpanded);
            }}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors dark:border-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            <span className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Links
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${linksExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {linksExpanded ? (
            <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              {research.shareInfo !== undefined ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Share:</span>
                  <a
                    href={research.shareInfo.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {research.shareInfo.shareUrl}
                  </a>
                  <button
                    type="button"
                    onClick={(): void => {
                      onCopyToClipboard(research.shareInfo?.shareUrl ?? '', 'share-link');
                    }}
                    className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                    title={copiedSection === 'share-link' ? 'Copied!' : 'Copy link'}
                  >
                    {copiedSection === 'share-link' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ) : null}
              {research.notionExportInfo !== undefined ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Notion:</span>
                  <a
                    href={research.notionExportInfo.mainPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {research.notionExportInfo.mainPageUrl}
                  </a>
                  <button
                    type="button"
                    onClick={(): void => {
                      onCopyToClipboard(research.notionExportInfo?.mainPageUrl ?? '', 'notion-link');
                    }}
                    className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                    title={copiedSection === 'notion-link' ? 'Copied!' : 'Copy link'}
                  >
                    {copiedSection === 'notion-link' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
