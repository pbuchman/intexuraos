import { Link } from 'react-router-dom';
import { FileText, MessageSquare } from 'lucide-react';
import type { HellscriptBufferSummary } from '@/types';
import { formatDateTime } from '@/utils/dateFormat';

interface HellscriptBufferRowProps {
  buffer: HellscriptBufferSummary;
}

export function HellscriptBufferRow({ buffer }: HellscriptBufferRowProps): React.JSX.Element {
  return (
    <Link
      to={`/hellscript/${buffer.id}`}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-750"
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {buffer.title}
        </h3>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {String(buffer.eventCount)} event{buffer.eventCount !== 1 ? 's' : ''}
          </span>
          {buffer.latestDraftVersionNumber !== null ? (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              Draft v{String(buffer.latestDraftVersionNumber)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="ml-4 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">
        <div>{formatDateTime(buffer.updatedAt)}</div>
      </div>
    </Link>
  );
}
