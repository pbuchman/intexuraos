import { useEffect, useState } from 'react';
import { BookOpenText, ChevronDown, FileText, MessageSquareQuote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components';
import type { FishingMessageCitation } from '@/types/fishingAssistant';

function sourceLabel(sourceType: FishingMessageCitation['sourceType']): string {
  switch (sourceType) {
    case 'knowledge_page':
      return 'Knowledge Base';
    case 'digest':
      return 'Digest';
    case 'raw_message':
      return 'Raw message';
  }
}

function sourceIcon(sourceType: FishingMessageCitation['sourceType']): React.JSX.Element {
  switch (sourceType) {
    case 'knowledge_page':
      return <BookOpenText className="h-4 w-4 text-emerald-500" />;
    case 'digest':
      return <FileText className="h-4 w-4 text-blue-500" />;
    case 'raw_message':
      return <MessageSquareQuote className="h-4 w-4 text-amber-500" />;
  }
}

function CitationTitle({ citation }: { citation: FishingMessageCitation }): React.JSX.Element {
  if (citation.url === undefined || citation.url === '') {
    return (
      <span className="block min-w-0 break-words font-medium text-slate-900 dark:text-slate-100">
        {citation.title}
      </span>
    );
  }

  if (citation.url.startsWith('/')) {
    return (
      <Link
        to={citation.url}
        className="block min-w-0 break-words font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        {citation.title}
      </Link>
    );
  }

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noreferrer"
      className="block min-w-0 break-words font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      {citation.title}
    </a>
  );
}

interface FishingReferencesPanelProps {
  readonly citations: readonly FishingMessageCitation[];
  readonly selectionKey?: string | null;
}

export function FishingReferencesPanel({
  citations,
  selectionKey,
}: FishingReferencesPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded({});
  }, [selectionKey]);

  const toggleReference = (key: string): void => {
    setExpanded((current) => ({ ...current, [key]: current[key] !== true }));
  };

  return (
    <Card title="References" className="h-full">
      {citations.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select an assistant answer to inspect its evidence.
        </p>
      ) : (
        <div className="space-y-3">
          {citations.map((citation, index) => {
            const referenceKey = `${citation.sourceId}-${citation.usedFor}-${String(index)}`;
            const isExpanded = expanded[referenceKey] === true;

            return (
              <div
                key={referenceKey}
                className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={(): void => {
                    toggleReference(referenceKey);
                  }}
                  className="flex w-full min-w-0 items-center justify-between gap-3 p-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {sourceIcon(citation.sourceType)}
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {sourceLabel(citation.sourceType)}
                      </span>
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {citation.title}
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isExpanded ? (
                  <div className="space-y-2 border-t border-slate-200 px-3 pb-3 pt-3 dark:border-slate-700">
                    <CitationTitle citation={citation} />
                    <p className="break-words text-xs font-medium text-slate-500 dark:text-slate-400">
                      Used for: {citation.usedFor}
                    </p>
                    {citation.date !== undefined ? (
                      <p className="break-words text-xs text-slate-500 dark:text-slate-400">
                        Date: {citation.date}
                      </p>
                    ) : null}
                    <blockquote className="break-words border-l-2 border-slate-300 pl-3 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
                      {citation.quote}
                    </blockquote>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
