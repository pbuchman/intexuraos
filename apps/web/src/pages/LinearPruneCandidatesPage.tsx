import { useState, useEffect, useCallback } from 'react';
import { Trash2, AlertCircle, Loader2, Scissors, ExternalLink, X } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context';
import {
  listPruneCandidates,
  deletePruneCandidates,
  type PruneCandidateResponse,
} from '@/services/linearApi';

const CATEGORY_STYLES: Record<PruneCandidateResponse['category'], string> = {
  cancelled: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  duplicate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  'sub-issue': 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  'simple-fix': 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  'review-only': 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  other: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
};

const CATEGORY_LABELS: Record<PruneCandidateResponse['category'], string> = {
  cancelled: 'Cancelled',
  duplicate: 'Duplicate',
  'sub-issue': 'Sub-issue',
  'simple-fix': 'Simple Fix',
  'review-only': 'Review Only',
  other: 'Other',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-red-600 dark:text-red-400';
  if (score >= 60) return 'text-orange-600 dark:text-orange-400';
  return 'text-yellow-600 dark:text-yellow-400';
}

export function LinearPruneCandidatesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [candidates, setCandidates] = useState<PruneCandidateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; failed: number } | null>(
    null
  );

  const fetchCandidates = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const token = await getAccessToken();
      const data = await listPruneCandidates(token);
      setCandidates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prune candidates');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  const handleDeleteAll = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      const token = await getAccessToken();
      const result = await deletePruneCandidates(token);
      setDeleteResult({ deleted: result.deleted, failed: result.failedDeletions.length });
      setShowConfirm(false);
      setCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete candidates');
      setShowConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/30">
              <Scissors className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                Issue Cleanup
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Issues classified for deletion by the pruning scheduler
              </p>
            </div>
            {!loading && candidates.length > 0 ? (
              <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {candidates.length}
              </span>
            ) : null}
          </div>
          {!loading && candidates.length > 0 ? (
            <Button
              variant="danger"
              onClick={(): void => {
                setShowConfirm(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete All Issues
            </Button>
          ) : null}
        </div>

        {/* Success banner */}
        {deleteResult !== null ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Successfully deleted {deleteResult.deleted} issue
              {deleteResult.deleted !== 1 ? 's' : ''} from Linear
              {deleteResult.failed > 0
                ? ` (${String(deleteResult.failed)} failed)`
                : ''}
            </p>
            <button
              onClick={(): void => {
                setDeleteResult(null);
              }}
              className="ml-auto rounded p-0.5 text-green-600 transition-colors hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/40"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {/* Error banner */}
        {error !== null ? (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
            <button
              onClick={(): void => {
                setError(null);
              }}
              className="ml-auto rounded p-0.5 text-red-600 transition-colors hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : candidates.length === 0 && deleteResult === null ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-24 dark:border-slate-700 dark:bg-slate-800">
            <div className="rounded-full bg-slate-100 p-4 dark:bg-slate-700">
              <Scissors className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-700 dark:text-slate-300">
              No issues scheduled for deletion
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The scheduler will classify issues for deletion on its next run.
            </p>
          </div>
        ) : candidates.length > 0 ? (
          /* Candidate list */
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                    {/* Identifier */}
                    <a
                      href={`https://linear.app/issue/${candidate.identifier}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex shrink-0 items-center gap-1 font-mono text-sm font-semibold text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {candidate.identifier}
                      <ExternalLink className="h-3 w-3" />
                    </a>

                    {/* Title and reason */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {candidate.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {candidate.reason}
                      </p>
                    </div>

                    {/* Score and category */}
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-sm font-bold tabular-nums ${scoreColor(candidate.score)}`}
                        title="Deletion score (higher = more likely to delete)"
                      >
                        {candidate.score}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[candidate.category]}`}
                      >
                        {CATEGORY_LABELS[candidate.category]}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Confirmation modal */}
      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
            {isDeleting ? (
              <div className="flex flex-col items-center justify-center p-12">
                <Loader2 className="h-12 w-12 animate-spin text-red-500" />
                <p className="mt-4 text-lg font-medium text-slate-700 dark:text-slate-200">
                  Deleting issues...
                </p>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-red-100 p-2 dark:bg-red-900/50">
                      <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Delete Issues from Linear
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Review before proceeding
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(): void => {
                      setShowConfirm(false);
                    }}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <p className="text-slate-700 dark:text-slate-200">
                    Are you sure you want to delete{' '}
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {candidates.length} issue{candidates.length !== 1 ? 's' : ''}
                    </span>{' '}
                    from Linear? This action is a soft-delete and can be recovered from Linear&apos;s
                    trash.
                  </p>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
                  <Button
                    variant="secondary"
                    onClick={(): void => {
                      setShowConfirm(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={(): void => {
                      void handleDeleteAll();
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete {candidates.length} Issue{candidates.length !== 1 ? 's' : ''}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
