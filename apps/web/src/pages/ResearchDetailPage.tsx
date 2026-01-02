import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Clock, FileText, Loader2, Play, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useResearch } from '@/hooks';
import { approveResearch, deleteResearch } from '@/services/llmOrchestratorApi';
import type { LlmResult, ResearchStatus } from '@/services/llmOrchestratorApi.types';

/**
 * Format elapsed time in a human-readable format.
 */
function formatElapsedTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${String(diffDays)}d ago`;
  }
  if (diffHours > 0) {
    return `${String(diffHours)}h ago`;
  }
  if (diffMinutes > 0) {
    return `${String(diffMinutes)}m ago`;
  }
  return 'just now';
}

/**
 * Strip markdown formatting from text for clean display.
 * Handles bold, italic, headers, code markers, and surrounding quotes.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '') // Remove bold markers
    .replace(/__/g, '') // Remove bold (underscore)
    .replace(/(?<!\*)\*(?!\*)/g, '') // Remove italic markers (single asterisk)
    .replace(/(?<!_)_(?!_)/g, '') // Remove italic (single underscore)
    .replace(/^#+\s*/gm, '') // Remove headers
    .replace(/`/g, '') // Remove code markers
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .trim();
}

interface StatusBadgeProps {
  status: ResearchStatus;
}

function ResearchStatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  if (status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-700">
        <FileText className="h-3.5 w-3.5" />
        Draft
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700">
        <Clock className="h-3.5 w-3.5" />
        Pending
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Processing
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-sm font-medium text-green-700">
        <CheckCircle className="h-3.5 w-3.5" />
        Completed
      </span>
    );
  }
  // failed
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-sm font-medium text-red-700">
      <XCircle className="h-3.5 w-3.5" />
      Failed
    </span>
  );
}

interface MarkdownContentProps {
  content: string;
}

function MarkdownContent({ content }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className="prose prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Render text with clickable links.
 * Detects URLs and wraps them in anchor tags that open in new tabs.
 */
function renderPromptWithLinks(text: string): React.JSX.Element {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);

  return (
    <>
      {parts.map((part, index) => {
        if (part.match(urlPattern) !== null) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              {part}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function ResearchDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { research, loading, error, refresh } = useResearch(id ?? '');
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const copyToClipboard = async (text: string, section: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => {
      setCopiedSection(null);
    }, 2000);
  };

  const handleApprove = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    setApproving(true);
    setApproveError(null);

    try {
      const token = await getAccessToken();
      await approveResearch(token, id);
      await refresh();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to start research');
    } finally {
      setApproving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const token = await getAccessToken();
      await deleteResearch(token, id);
      void navigate('/#/research');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete research');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error ?? 'Research not found'}
        </div>
        <Link to="/research" className="text-blue-600 underline">
          Back to list
        </Link>
      </Layout>
    );
  }

  const isProcessing = research.status === 'pending' || research.status === 'processing';
  const showLlmStatus = isProcessing || research.status === 'failed';

  const getDisplayTitle = (): string => {
    if (research.title !== '') {
      return stripMarkdown(research.title);
    }
    if (research.status === 'failed') {
      return 'Research Failed';
    }
    return 'Processing...';
  };

  return (
    <Layout>
      <div className="mb-4">
        <Link to="/research" className="text-sm text-blue-600 hover:underline">
          ← Back to list
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-900">{getDisplayTitle()}</h2>
          <ResearchStatusBadge status={research.status} />
          <span className="text-sm text-slate-500">
            {research.status === 'pending' || research.status === 'processing'
              ? `Started ${formatElapsedTime(research.startedAt)}`
              : research.completedAt !== undefined
                ? `Finished ${formatElapsedTime(research.completedAt)}`
                : `Started ${formatElapsedTime(research.startedAt)}`}
          </span>
        </div>

        {research.status === 'draft' ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={(): void => {
                void handleApprove();
              }}
              disabled={approving || deleting}
              isLoading={approving}
            >
              <Play className="mr-2 h-4 w-4" />
              Start Research
            </Button>
            <Button
              variant="secondary"
              onClick={(): void => {
                void navigate(`/#/research/new?draftId=${research.id}`);
              }}
              disabled={deleting}
            >
              Edit Draft
            </Button>
            {showDeleteConfirm ? (
              <>
                <Button
                  variant="danger"
                  onClick={(): void => {
                    void handleDelete();
                  }}
                  disabled={deleting}
                  isLoading={deleting}
                >
                  Confirm Discard
                </Button>
                <Button
                  variant="secondary"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={(): void => {
                  setShowDeleteConfirm(true);
                }}
                disabled={deleting}
              >
                Discard
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            {showDeleteConfirm ? (
              <>
                <Button
                  variant="danger"
                  onClick={(): void => {
                    void handleDelete();
                  }}
                  disabled={deleting}
                  isLoading={deleting}
                >
                  Confirm Delete
                </Button>
                <Button
                  variant="secondary"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={(): void => {
                  setShowDeleteConfirm(true);
                }}
                disabled={deleting}
              >
                Delete
              </Button>
            )}
          </div>
        )}

        {approveError !== null && approveError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {approveError}
          </div>
        ) : null}

        {deleteError !== null && deleteError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {deleteError}
          </div>
        ) : null}
      </div>

      <Card title="Original Prompt" className="mb-6">
        <p className="whitespace-pre-wrap text-slate-700">
          {renderPromptWithLinks(research.prompt)}
        </p>
      </Card>

      {showLlmStatus ? (
        <ProcessingStatus
          llmResults={research.llmResults}
          title={research.status === 'failed' ? 'LLM Status' : 'Processing Status'}
        />
      ) : null}

      {research.synthesizedResult !== undefined && research.synthesizedResult !== '' ? (
        <Card title="Synthesis Report" className="mb-6">
          <div className="mb-2 flex justify-end">
            <Button
              variant="secondary"
              onClick={(): void => {
                void copyToClipboard(research.synthesizedResult ?? '', 'synthesis');
              }}
            >
              {copiedSection === 'synthesis' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <MarkdownContent content={research.synthesizedResult} />
          </div>
        </Card>
      ) : null}

      {research.synthesisError !== undefined && research.synthesisError !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="font-medium text-red-800">Synthesis Failed</h3>
          <p className="mt-1 text-sm text-red-700">{research.synthesisError}</p>
        </div>
      ) : null}

      {/* Only show Individual LLM Results when at least one result has content */}
      {research.llmResults.some(
        (r) =>
          (r.result !== undefined && r.result !== '') ||
          (r.error !== undefined && r.error !== '')
      ) ? (
        <div>
          <h3 className="mb-4 text-xl font-bold text-slate-900">Individual LLM Results</h3>
          <div className="space-y-4">
            {/* Input Contexts */}
            {research.inputContexts !== undefined && research.inputContexts.length > 0
              ? research.inputContexts.map((ctx, idx) => (
                  <div
                    key={`ctx-${ctx.id}`}
                    className="rounded-lg border border-slate-200 bg-slate-50"
                  >
                    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <span className="font-medium text-slate-700">
                        Input Context {String(idx + 1)}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        Added {new Date(ctx.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="p-4">
                      <MarkdownContent content={ctx.content} />
                    </div>
                  </div>
                ))
              : null}

            {/* LLM Results - only show cards with content */}
            {research.llmResults
              .filter(
                (r) =>
                  (r.result !== undefined && r.result !== '') ||
                  (r.error !== undefined && r.error !== '')
              )
              .map((result) => (
                <LlmResultCard
                  key={result.provider}
                  result={result}
                  onCopy={(text): void => {
                    void copyToClipboard(text, result.provider);
                  }}
                  copied={copiedSection === result.provider}
                />
              ))}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

interface ProcessingStatusProps {
  llmResults: LlmResult[];
  title?: string;
}

function ProcessingStatus({
  llmResults,
  title = 'Processing Status',
}: ProcessingStatusProps): React.JSX.Element {
  const getStatusText = (result: LlmResult): string => {
    if (result.status === 'completed' && result.durationMs !== undefined) {
      return `(${(result.durationMs / 1000).toFixed(1)}s)`;
    }
    if (result.status === 'processing') {
      return 'Processing...';
    }
    if (result.status === 'pending') {
      return 'Waiting...';
    }
    return '';
  };

  return (
    <Card title={title} className="mb-6">
      <div className="space-y-3">
        {llmResults.map((result) => (
          <div key={result.provider} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <StatusDot status={result.status} />
              <span className="capitalize">{result.provider}</span>
              <span className="text-sm text-slate-500">{getStatusText(result)}</span>
            </div>
            {result.status === 'failed' && result.error !== undefined && result.error !== '' ? (
              <p className="ml-6 text-sm text-red-600">{result.error}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colors: Record<string, string> = {
    pending: 'bg-slate-300',
    processing: 'bg-blue-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  };

  return <div className={`h-3 w-3 rounded-full ${colors[status] ?? 'bg-slate-300'}`} />;
}

interface LlmResultCardProps {
  result: LlmResult;
  onCopy: (text: string) => void;
  copied: boolean;
}

function LlmResultCard({ result, onCopy, copied }: LlmResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full items-center justify-between p-4 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium capitalize">{result.provider}</span>
          <span className="text-sm text-slate-500">{result.model}</span>
        </div>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined && result.result !== '' ? (
        <div className="border-t border-slate-200 p-4">
          <div className="mb-2 flex justify-end">
            <Button
              variant="secondary"
              onClick={(): void => {
                onCopy(result.result ?? '');
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 text-sm">
            <MarkdownContent content={result.result} />
          </div>
          {result.sources !== undefined && result.sources.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h4 className="mb-2 text-sm font-medium">Sources</h4>
              <ul className="text-sm text-blue-600">
                {result.sources.map((source, i) => (
                  <li key={i}>
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {expanded && result.error !== undefined && result.error !== '' ? (
        <div className="border-t border-slate-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}
