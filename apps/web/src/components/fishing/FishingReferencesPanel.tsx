import { BookOpenText, FileText, MessageSquareQuote } from 'lucide-react';
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
    return <span className="font-medium text-slate-900 dark:text-slate-100">{citation.title}</span>;
  }

  if (citation.url.startsWith('/')) {
    return (
      <Link
        to={citation.url}
        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
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
      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
    >
      {citation.title}
    </a>
  );
}

interface FishingReferencesPanelProps {
  readonly citations: readonly FishingMessageCitation[];
}

export function FishingReferencesPanel({
  citations,
}: FishingReferencesPanelProps): React.JSX.Element {
  return (
    <Card title="References" className="h-full">
      {citations.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Select an assistant answer to inspect its evidence.
        </p>
      ) : (
        <div className="space-y-3">
          {citations.map((citation) => (
            <div
              key={`${citation.sourceId}-${citation.usedFor}`}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
            >
              <div className="mb-2 flex items-center gap-2">
                {sourceIcon(citation.sourceType)}
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {sourceLabel(citation.sourceType)}
                </span>
              </div>
              <div className="space-y-2">
                <CitationTitle citation={citation} />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Used for: {citation.usedFor}
                </p>
                {citation.date !== undefined ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Date: {citation.date}
                  </p>
                ) : null}
                <blockquote className="border-l-2 border-slate-300 pl-3 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300">
                  {citation.quote}
                </blockquote>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
