import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout, Button } from '@/components';
import { useAuth } from '@/context';
import { getResearch, ApiError } from '@/services';
import type { LLMResearch, LLMProvider } from '@/types';
import { ChevronDown, ChevronRight, Copy, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const PROVIDER_NAMES: Record<LLMProvider, string> = {
  'google-gemini': 'Google Gemini 3 Pro',
  'openai-gpt': 'OpenAI GPT 5.2 Thinking',
  'anthropic-opus': 'Anthropic Opus 4.5',
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

interface CopyButtonProps {
  content: string;
  label?: string;
}

function CopyButton({ content, label = 'Copy' }: CopyButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <Button
      variant="secondary"
      onClick={() => void handleCopy()}
      className={`text-sm transition-all ${copied ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
    >
      <Copy className="mr-1.5 h-4 w-4" />
      {copied ? 'Copied!' : label}
    </Button>
  );
}

export function ResearchDetailPage(): React.JSX.Element {
  const { researchId } = useParams<{ researchId: string }>();
  const { getAccessToken } = useAuth();
  const [research, setResearch] = useState<LLMResearch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<LLMProvider>>(new Set());

  const fetchResearch = useCallback(async (): Promise<void> => {
    if (researchId === undefined) return;
    try {
      setIsLoading(true);
      setError(null);
      const token = await getAccessToken();
      const data = await getResearch(token, researchId);
      setResearch(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to fetch research');
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, researchId]);

  useEffect(() => {
    void fetchResearch();
  }, [fetchResearch]);

  const toggleExpanded = (provider: LLMProvider): void => {
    setExpandedResults((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(provider)) {
        newSet.delete(provider);
      } else {
        newSet.add(provider);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error !== null || research === null) {
    return (
      <Layout>
        <div className="mb-6">
          <Link
            to="/llm-orchestrator/previous"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Previous Researches
          </Link>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error ?? 'Research not found'}
        </div>
      </Layout>
    );
  }

  const hasSynthesis =
    research.synthesizedResult !== undefined && research.synthesizedResult !== '';
  const hasSynthesisError = research.synthesisError !== undefined;
  const allFailed = research.llmResults.every((r) => r.status === 'failed');

  return (
    <Layout>
      <div className="mb-6">
        <Link
          to="/llm-orchestrator/previous"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Previous Researches
        </Link>
      </div>

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">{research.title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Started: {formatTimestamp(research.startTime)} · Total Duration:{' '}
          {formatDuration(research.totalDuration)}
        </p>
      </div>

      <div className="space-y-6">
        {/* Synthesized Result Section */}
        {allFailed ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <h3 className="text-lg font-bold text-red-900">RESEARCH FAILED</h3>
            <p className="mt-2 text-red-800">
              All selected LLM providers failed to complete this research. Synthesis was not
              possible.
            </p>
            <p className="mt-2 text-sm text-red-700">View individual failure details below.</p>
          </div>
        ) : hasSynthesis ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">SYNTHESIZED RESEARCH RESULT</h3>
              <CopyButton content={research.synthesizedResult ?? ''} label="Copy Result" />
            </div>
            <div className="prose prose-slate max-w-none">
              <ReactMarkdown>{research.synthesizedResult ?? ''}</ReactMarkdown>
            </div>
          </div>
        ) : hasSynthesisError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h3 className="text-lg font-bold text-amber-900">⚠ SYNTHESIS FAILED</h3>
            <p className="mt-2 text-amber-800">
              The individual LLM responses completed successfully, but the final synthesis step
              encountered an error.
            </p>
            <div className="mt-3 rounded-lg bg-amber-100 p-3">
              <p className="text-sm font-medium text-amber-900">Error:</p>
              <p className="mt-1 text-sm text-amber-800">{research.synthesisError}</p>
            </div>
            <p className="mt-3 text-sm text-amber-700">
              You can still view individual LLM results below.
            </p>
          </div>
        ) : null}

        {/* Individual LLM Results Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-slate-900">INDIVIDUAL LLM RESULTS</h3>
          <div className="space-y-3">
            {research.llmResults.map((result) => {
              const isExpanded = expandedResults.has(result.provider);
              const statusLabel =
                result.status === 'completed'
                  ? 'Completed'
                  : result.status === 'failed'
                    ? 'Failed'
                    : 'Pending';
              const preview =
                result.status === 'completed' && result.content !== undefined
                  ? result.content.slice(0, 100)
                  : result.status === 'failed' && result.error !== undefined
                    ? result.error
                    : 'Processing...';

              return (
                <div key={result.provider} className="rounded-lg border border-slate-200">
                  <button
                    onClick={(): void => {
                      toggleExpanded(result.provider);
                    }}
                    className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        )}
                        <span className="font-semibold text-slate-900">
                          {PROVIDER_NAMES[result.provider]}
                        </span>
                      </div>
                      <p className="ml-6 mt-1 text-sm text-slate-600">
                        {statusLabel} · {formatDuration(result.duration)}
                      </p>
                      {!isExpanded ? (
                        <p className="ml-6 mt-1 text-sm text-slate-500 line-clamp-1">{preview}</p>
                      ) : null}
                    </div>
                    {result.content !== undefined && result.content !== '' ? (
                      <div onClick={(e): void => { e.stopPropagation(); }}>
                        <CopyButton content={result.content} />
                      </div>
                    ) : null}
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-slate-200 p-4">
                      {result.status === 'completed' && result.content !== undefined ? (
                        <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-p:text-slate-700 prose-a:text-blue-600">
                          <ReactMarkdown>{result.content}</ReactMarkdown>
                        </div>
                      ) : result.status === 'failed' ? (
                        <div className="rounded-lg bg-red-50 p-4">
                          <p className="font-semibold text-red-900">ERROR DETAILS</p>
                          <p className="mt-2 text-sm text-red-800">
                            {result.error ?? 'Unknown error'}
                          </p>
                          <p className="mt-3 text-xs text-red-700">
                            Error Code:{' '}
                            {result.error?.includes('timeout') === true ? 'TIMEOUT' : 'ERROR'}
                          </p>
                          <p className="text-xs text-red-700">
                            Timestamp: {formatTimestamp(result.startTime)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">Processing...</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}
