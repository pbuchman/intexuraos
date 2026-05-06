import { Link } from 'react-router-dom';
import { Card } from '@/components';
import { formatDate } from '@/utils/dateFormat';
import type { FishingDigestItem } from '@/types/fishingAssistant';

function digestExcerpt(markdown: string): string {
  return markdown
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

interface FishingDigestListProps {
  readonly digests: readonly FishingDigestItem[];
}

export function FishingDigestList({
  digests,
}: FishingDigestListProps): React.JSX.Element {
  if (digests.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No digests were found for the selected period.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {digests.map((digest) => (
        <Link
          key={`${digest.groupKey}-${digest.date}`}
          to={`/fishing-assistant/digests/${encodeURIComponent(digest.groupKey)}/${encodeURIComponent(digest.date)}`}
          className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{digest.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {formatDate(digest.date)} · {digest.groupKey}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {String(digest.messageCount)} messages
            </span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {digestExcerpt(digest.summaryMarkdown)}
          </div>
        </Link>
      ))}
    </div>
  );
}
