import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components';
import type { FailedLinearIssue } from '@/types';

interface FailedIssueCardProps {
  issue: FailedLinearIssue;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  isDeleting: boolean;
  isRetrying: boolean;
}

function FailedIssueCard({
  issue,
  onDelete,
  onRetry,
  isDeleting,
  isRetrying,
}: FailedIssueCardProps): React.JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="flex shrink-0 items-center justify-center rounded-lg bg-amber-100 p-2 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
        <AlertCircle className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h4 className="font-medium text-amber-900 dark:text-amber-200">
            {issue.extractedTitle ?? 'Untitled issue'}
          </h4>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => void onRetry(issue.id)}
              disabled={isRetrying || isDeleting}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-amber-900/50 dark:hover:text-blue-400"
              aria-label="Retry"
              title="Retry creating issue"
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void onDelete(issue.id)}
              disabled={isDeleting || isRetrying}
              className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-amber-900/50 dark:hover:text-red-400"
              aria-label="Delete"
              title="Delete failed issue"
            >
              {isDeleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        <p className="mb-2 line-clamp-2 text-sm text-amber-700 dark:text-amber-300">{issue.originalText}</p>

        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/50">{issue.error}</span>
        </div>
      </div>
    </div>
  );
}

interface NeedsAttentionSectionProps {
  issues: FailedLinearIssue[];
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  deletingId: string | null;
  retryingId: string | null;
}

export function NeedsAttentionSection({
  issues,
  onDelete,
  onRetry,
  deletingId,
  retryingId,
}: NeedsAttentionSectionProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = expanded ? issues.length : Math.min(issues.length, 3);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">
            Needs Attention ({issues.length})
          </h3>
        </div>
        {issues.length > 3 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/50 dark:hover:text-amber-200"
          >
            {expanded ? (
              <>
                <span>Show less</span>
                <ChevronUp className="ml-1 h-4 w-4" />
              </>
            ) : (
              <>
                <span>Show all ({issues.length})</span>
                <ChevronDown className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>

      <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
        These issues couldn't be created. Please edit them and try again.
      </p>

      <div className="space-y-2">
        {issues.slice(0, visibleCount).map((issue) => (
          <FailedIssueCard
            key={issue.id}
            issue={issue}
            onDelete={onDelete}
            onRetry={onRetry}
            isDeleting={deletingId === issue.id}
            isRetrying={retryingId === issue.id}
          />
        ))}
      </div>
    </div>
  );
}
