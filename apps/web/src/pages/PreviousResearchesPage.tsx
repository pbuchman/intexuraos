import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layout, Button } from '@/components';
import { useAuth } from '@/context';
import { getResearchList, deleteResearch, ApiError } from '@/services';
import type { LLMResearch, LLMProvider } from '@/types';
import { Trash2 } from 'lucide-react';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  'google-gemini': 'Gemini',
  'openai-gpt': 'GPT',
  'anthropic-opus': 'Opus',
};

const PROVIDER_COLORS: Record<LLMProvider, string> = {
  'google-gemini': 'bg-blue-100 text-blue-700',
  'openai-gpt': 'bg-green-100 text-green-700',
  'anthropic-opus': 'bg-purple-100 text-purple-700',
};

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getResearchStatus(research: LLMResearch): string {
  const completedCount = research.llmResults.filter((r) => r.status === 'completed').length;
  const pendingCount = research.llmResults.filter((r) => r.status === 'pending').length;
  const failedCount = research.llmResults.filter((r) => r.status === 'failed').length;

  if (research.status === 'pending') {
    if (completedCount === 0 && pendingCount > 0) return 'Pending';
    if (completedCount > 0 && pendingCount > 0) {
      return `${String(completedCount)} completed, ${String(pendingCount)} pending`;
    }
  }

  if (research.status === 'failed') {
    if (failedCount === research.llmResults.length) return 'Failed (all providers)';
    if (failedCount > 0) {
      return `${String(completedCount)} completed, ${String(failedCount)} failed`;
    }
  }

  if (research.status === 'completed') {
    if (research.synthesisError !== undefined) {
      return 'Completed (synthesis failed)';
    }
    return 'Completed';
  }

  return research.status;
}

export function PreviousResearchesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [researches, setResearches] = useState<LLMResearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchResearches = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getAccessToken();
      const response = await getResearchList(token, page, 50, sort);
      setResearches(response.researches);
      setTotal(response.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch researches');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, page, sort]);

  useEffect(() => {
    void fetchResearches();
  }, [fetchResearches]);

  const handleDelete = async (researchId: string): Promise<void> => {
    try {
      const token = await getAccessToken();
      await deleteResearch(token, researchId);
      setDeleteConfirmId(null);
      await fetchResearches();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete research');
    }
  };

  const loadMore = (): void => {
    setPage((prev) => prev + 1);
  };

  const remaining = total - researches.length;
  const hasMore = remaining > 0;

  if (isLoading && researches.length === 0) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Previous Researches</h2>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-slate-600">
            Sort:
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e): void => {
              setSort(e.target.value as 'newest' | 'oldest');
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {researches.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
          <p className="text-slate-600">
            Here you'll see your researches.{' '}
            <Link to="/llm-orchestrator" className="text-blue-600 underline hover:text-blue-700">
              Start now
            </Link>{' '}
            by submitting your first prompt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {researches.map((research) => (
            <div
              key={research.id}
              className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  to={`/llm-orchestrator/researches/${research.id}`}
                  className="flex-1 hover:text-blue-600"
                >
                  <h3 className="text-lg font-semibold text-slate-900 line-clamp-1">
                    {research.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Started: {formatTimestamp(research.startTime)} · Duration:{' '}
                    {formatDuration(research.totalDuration)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {research.providers.map((provider) => (
                      <span
                        key={provider}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${PROVIDER_COLORS[provider]}`}
                      >
                        {PROVIDER_LABELS[provider]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    Status: {getResearchStatus(research)}
                  </p>
                </Link>

                <button
                  onClick={(): void => {
                    setDeleteConfirmId(research.id);
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete research"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>

              {deleteConfirmId === research.id ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">
                    Delete this research? This cannot be undone.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="danger"
                      onClick={() => void handleDelete(research.id)}
                      className="text-sm"
                    >
                      Delete
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={(): void => {
                        setDeleteConfirmId(null);
                      }}
                      className="text-sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {hasMore ? (
            <div className="flex justify-center pt-6">
              <Button onClick={loadMore} isLoading={isLoading}>
                Load More ({String(remaining)} remaining)
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
