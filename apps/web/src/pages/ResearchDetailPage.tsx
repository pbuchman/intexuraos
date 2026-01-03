import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Copy,
  FileText,
  Link2,
  Link2Off,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useResearch } from '@/hooks';
import {
  approveResearch,
  confirmPartialFailure,
  deleteResearch,
  enhanceResearch,
  retryFromFailed,
  unshareResearch,
} from '@/services/llmOrchestratorApi';
import type {
  LlmProvider,
  LlmResult,
  PartialFailure,
  PartialFailureDecision,
  ResearchStatus,
} from '@/services/llmOrchestratorApi.types';

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
  if (status === 'awaiting_confirmation') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-1 text-sm font-medium text-orange-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        Action Required
      </span>
    );
  }
  if (status === 'retrying') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-700">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Retrying
      </span>
    );
  }
  if (status === 'synthesizing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-1 text-sm font-medium text-purple-700">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Synthesizing
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
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [unsharing, setUnsharing] = useState(false);
  const [unshareError, setUnshareError] = useState<string | null>(null);
  const [showUnshareConfirm, setShowUnshareConfirm] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [showEnhanceModal, setShowEnhanceModal] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [selectedEnhanceLlms, setSelectedEnhanceLlms] = useState<LlmProvider[]>([]);
  const [enhanceContexts, setEnhanceContexts] = useState<string[]>([]);

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
      void navigate('/research');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete research');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirm = async (action: PartialFailureDecision): Promise<void> => {
    if (id === undefined || id === '') return;

    setConfirming(true);
    setConfirmError(null);

    try {
      const token = await getAccessToken();
      await confirmPartialFailure(token, id, action);
      await refresh();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to confirm action');
    } finally {
      setConfirming(false);
    }
  };

  const handleRetry = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    setRetrying(true);
    setRetryError(null);

    try {
      const token = await getAccessToken();
      await retryFromFailed(token, id);
      await refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Failed to retry research');
    } finally {
      setRetrying(false);
    }
  };

  const handleCopyShareUrl = async (): Promise<void> => {
    if (research?.shareInfo?.shareUrl === undefined) return;
    await navigator.clipboard.writeText(research.shareInfo.shareUrl);
    setShareToast('Link copied to clipboard');
    setTimeout(() => {
      setShareToast(null);
    }, 2000);
  };

  const handleShare = async (): Promise<void> => {
    if (research?.shareInfo?.shareUrl === undefined) return;

    const shareUrl = research.shareInfo.shareUrl;
    const shareData = {
      title: research.title !== '' ? research.title : 'Research',
      text: `Check out this research: ${research.title}`,
      url: shareUrl,
    };

    const canShare =
      typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    if (canShare) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          await handleCopyShareUrl();
        }
      }
    } else {
      await handleCopyShareUrl();
    }
  };

  const handleUnshare = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    setUnsharing(true);
    setUnshareError(null);

    try {
      const token = await getAccessToken();
      await unshareResearch(token, id);
      setShowUnshareConfirm(false);
      await refresh();
    } catch (err) {
      setUnshareError(err instanceof Error ? err.message : 'Failed to remove share');
    } finally {
      setUnsharing(false);
    }
  };

  const handleEnhance = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    const validContexts = enhanceContexts.filter((ctx) => ctx.trim().length > 0);
    const hasChanges = selectedEnhanceLlms.length > 0 || validContexts.length > 0;
    if (!hasChanges) return;

    setEnhancing(true);
    setEnhanceError(null);

    try {
      const token = await getAccessToken();
      const enhanced = await enhanceResearch(token, id, {
        ...(selectedEnhanceLlms.length > 0 && { additionalLlms: selectedEnhanceLlms }),
        ...(validContexts.length > 0 && {
          additionalContexts: validContexts.map((content) => ({ content })),
        }),
      });
      setShowEnhanceModal(false);
      setSelectedEnhanceLlms([]);
      setEnhanceContexts([]);
      void navigate(`/research/${enhanced.id}`);
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'Failed to enhance research');
    } finally {
      setEnhancing(false);
    }
  };

  const toggleEnhanceLlm = (provider: LlmProvider): void => {
    setSelectedEnhanceLlms((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  const getAvailableEnhanceLlms = (): LlmProvider[] => {
    if (research === null) return [];
    const existingProviders = new Set(research.selectedLlms);
    return ALL_PROVIDERS.filter((p) => !existingProviders.has(p));
  };

  useEffect(() => {
    if (research !== null && research.status === 'draft') {
      void navigate(`/research/new?draftId=${research.id}`, { replace: true });
    }
  }, [research, navigate]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (research !== null && research.status === 'draft') {
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

  const isProcessing =
    research.status === 'pending' ||
    research.status === 'processing' ||
    research.status === 'retrying' ||
    research.status === 'synthesizing';
  const showLlmStatus =
    isProcessing || research.status === 'failed' || research.status === 'awaiting_confirmation';

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
            {isProcessing || research.status === 'awaiting_confirmation'
              ? `Started ${formatElapsedTime(research.startedAt)}`
              : research.completedAt !== undefined
                ? `Finished ${formatElapsedTime(research.completedAt)}`
                : `Started ${formatElapsedTime(research.startedAt)}`}
          </span>
        </div>

        {research.shareInfo !== undefined ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Link2 className="h-4 w-4 text-slate-500" />
            <span className="flex-1 truncate text-sm text-slate-600">
              {research.shareInfo.shareUrl}
            </span>
            <Button
              variant="secondary"
              onClick={(): void => {
                void handleCopyShareUrl();
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
            <Button
              variant="secondary"
              onClick={(): void => {
                void handleShare();
              }}
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            {showUnshareConfirm ? (
              <>
                <Button
                  variant="danger"
                  onClick={(): void => {
                    void handleUnshare();
                  }}
                  disabled={unsharing}
                  isLoading={unsharing}
                >
                  Confirm
                </Button>
                <Button
                  variant="secondary"
                  onClick={(): void => {
                    setShowUnshareConfirm(false);
                  }}
                  disabled={unsharing}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={(): void => {
                  setShowUnshareConfirm(true);
                }}
              >
                <Link2Off className="mr-2 h-4 w-4" />
                Unshare
              </Button>
            )}
          </div>
        ) : null}

        {unshareError !== null && unshareError !== '' ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {unshareError}
          </div>
        ) : null}

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
                void navigate(`/research/new?draftId=${research.id}`);
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
            {research.status === 'failed' ? (
              <Button
                onClick={(): void => {
                  void handleRetry();
                }}
                disabled={retrying || deleting}
                isLoading={retrying}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Research
              </Button>
            ) : null}
            {research.status === 'completed' &&
            (getAvailableEnhanceLlms().length > 0 || (research.inputContexts?.length ?? 0) < 5) ? (
              <Button
                onClick={(): void => {
                  setShowEnhanceModal(true);
                }}
                disabled={deleting}
              >
                <Plus className="mr-2 h-4 w-4" />
                Enhance
              </Button>
            ) : null}
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
                disabled={deleting || retrying}
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

        {retryError !== null && retryError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {retryError}
          </div>
        ) : null}
      </div>

      <Card title="Original Prompt" className="mb-6">
        <blockquote className="border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 italic">
          <p className="whitespace-pre-wrap text-slate-700">
            {renderPromptWithLinks(research.prompt)}
          </p>
        </blockquote>
      </Card>

      {/* Research Summary - show when we have usage data */}
      {research.llmResults.some((r) => r.inputTokens !== undefined) ? (
        <Card title="Research Summary" className="mb-6">
          <div className="flex flex-wrap gap-6">
            {research.totalDurationMs !== undefined ? (
              <div>
                <p className="text-sm text-slate-500">Duration</p>
                <p className="text-lg font-semibold">
                  {(research.totalDurationMs / 1000).toFixed(1)}s
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-sm text-slate-500">Total Tokens</p>
              <p className="text-lg font-semibold">
                {research.llmResults
                  .reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0)
                  .toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Cost</p>
              <p className="text-lg font-semibold text-green-600">
                ${research.llmResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0).toFixed(4)}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {showLlmStatus ? (
        <ProcessingStatus
          llmResults={research.llmResults}
          selectedLlms={research.selectedLlms}
          synthesisLlm={research.synthesisLlm}
          researchStatus={research.status}
          title={research.status === 'failed' ? 'LLM Status' : 'Processing Status'}
        />
      ) : null}

      {research.status === 'awaiting_confirmation' && research.partialFailure !== undefined ? (
        <PartialFailureConfirmation
          partialFailure={research.partialFailure}
          onConfirm={handleConfirm}
          confirming={confirming}
          error={confirmError}
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
      ) : research.status === 'completed' &&
        research.llmResults.filter((r) => r.status === 'completed').length <= 1 &&
        (research.inputContexts === undefined || research.inputContexts.length === 0) ? (
        <Card title="Synthesis Report" className="mb-6">
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
            <p className="text-amber-800">
              Synthesis not available — only one individual report was generated.
            </p>
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
          (r.result !== undefined && r.result !== '') || (r.error !== undefined && r.error !== '')
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

      {showEnhanceModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">Enhance Research</h3>
            <p className="mb-4 text-sm text-slate-600">
              Add more AI models or additional context to get new perspectives.
            </p>

            {getAvailableEnhanceLlms().length > 0 ? (
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-slate-700">Select additional models:</p>
                {getAvailableEnhanceLlms().map((provider) => (
                  <label
                    key={provider}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEnhanceLlms.includes(provider)}
                      onChange={(): void => {
                        toggleEnhanceLlm(provider);
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>{PROVIDER_DISPLAY_NAMES[provider]}</span>
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium text-slate-700">
                Additional context{' '}
                <span className="font-normal text-slate-500">
                  ({String((research.inputContexts?.length ?? 0) + enhanceContexts.length)}/5)
                </span>
              </p>

              {(research.inputContexts?.length ?? 0) > 0 ? (
                <p className="text-xs text-slate-500">
                  {String(research.inputContexts?.length ?? 0)} existing context
                  {(research.inputContexts?.length ?? 0) > 1 ? 's' : ''} will be included
                </p>
              ) : null}

              {enhanceContexts.map((ctx, idx) => (
                <div key={idx} className="flex gap-2">
                  <textarea
                    value={ctx}
                    onChange={(e): void => {
                      setEnhanceContexts((prev) =>
                        prev.map((c, i) => (i === idx ? e.target.value : c))
                      );
                    }}
                    placeholder="Paste additional reference content..."
                    className="flex-1 rounded-lg border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={2}
                    disabled={enhancing}
                  />
                  <button
                    type="button"
                    onClick={(): void => {
                      setEnhanceContexts((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    disabled={enhancing}
                    className="self-start rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {(research.inputContexts?.length ?? 0) + enhanceContexts.length < 5 ? (
                <button
                  type="button"
                  onClick={(): void => {
                    setEnhanceContexts((prev) => [...prev, '']);
                  }}
                  disabled={enhancing}
                  className="w-full rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-600"
                >
                  + Add context
                </button>
              ) : null}
            </div>

            {enhanceError !== null ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {enhanceError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={(): void => {
                  setShowEnhanceModal(false);
                  setSelectedEnhanceLlms([]);
                  setEnhanceContexts([]);
                  setEnhanceError(null);
                }}
                disabled={enhancing}
              >
                Cancel
              </Button>
              <Button
                onClick={(): void => {
                  void handleEnhance();
                }}
                disabled={
                  enhancing ||
                  (selectedEnhanceLlms.length === 0 &&
                    enhanceContexts.filter((c) => c.trim().length > 0).length === 0)
                }
                isLoading={enhancing}
              >
                <Plus className="mr-2 h-4 w-4" />
                Enhance
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {shareToast !== null ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {shareToast}
        </div>
      ) : null}
    </Layout>
  );
}

interface ProcessingStatusProps {
  llmResults: LlmResult[];
  selectedLlms: LlmProvider[];
  synthesisLlm: LlmProvider;
  researchStatus: ResearchStatus;
  title?: string;
}

const ALL_PROVIDERS: LlmProvider[] = ['google', 'openai', 'anthropic'];

const PROVIDER_DISPLAY_NAMES: Record<LlmProvider, string> = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

function ProcessingStatus({
  llmResults,
  selectedLlms,
  synthesisLlm,
  researchStatus,
  title = 'Processing Status',
}: ProcessingStatusProps): React.JSX.Element {
  const getStatusText = (result: LlmResult): string => {
    if (result.status === 'completed' && result.durationMs !== undefined) {
      return `(${(result.durationMs / 1000).toFixed(1)}s)`;
    }
    if (result.status === 'processing') {
      if (result.startedAt !== undefined) {
        return `Started ${formatElapsedTime(result.startedAt)}, processing...`;
      }
      return 'Processing...';
    }
    if (result.status === 'pending') {
      return 'Waiting...';
    }
    return '';
  };

  const getSynthesisStatus = (): { status: string; text: string } => {
    if (researchStatus === 'synthesizing') {
      return { status: 'processing', text: 'Synthesizing...' };
    }
    if (researchStatus === 'completed') {
      return { status: 'completed', text: 'Complete' };
    }
    if (researchStatus === 'failed') {
      const allLlmsFailed = llmResults.every((r) => r.status === 'failed');
      if (allLlmsFailed) {
        return { status: 'skipped', text: 'Skipped (all LLMs failed)' };
      }
      return { status: 'failed', text: 'Failed' };
    }
    return { status: 'pending', text: 'Pending' };
  };

  const synthesisStatus = getSynthesisStatus();

  return (
    <Card title={title} className="mb-6">
      <div className="space-y-3">
        {ALL_PROVIDERS.map((provider) => {
          const isSelected = selectedLlms.includes(provider);
          const result = llmResults.find((r) => r.provider === provider);

          if (!isSelected) {
            return (
              <div key={provider} className="flex items-center gap-3">
                <StatusDot status="skipped" />
                <span className="text-slate-400">{PROVIDER_DISPLAY_NAMES[provider]}</span>
                <span className="text-sm text-slate-400">Skipped</span>
              </div>
            );
          }

          if (result === undefined) {
            return (
              <div key={provider} className="flex items-center gap-3">
                <StatusDot status="pending" />
                <span>{PROVIDER_DISPLAY_NAMES[provider]}</span>
                <span className="text-sm text-slate-500">Waiting...</span>
              </div>
            );
          }

          return (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <StatusDot status={result.status} />
                <span>{PROVIDER_DISPLAY_NAMES[provider]}</span>
                <span className="text-sm text-slate-500">{getStatusText(result)}</span>
              </div>
              {result.status === 'failed' && result.error !== undefined && result.error !== '' ? (
                <p className="ml-6 text-sm text-red-600">{result.error}</p>
              ) : null}
            </div>
          );
        })}

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-3">
            <StatusDot status={synthesisStatus.status} />
            <span className="font-medium">Synthesis</span>
            <span className="text-sm text-slate-500">({synthesisLlm})</span>
            <span className="text-sm text-slate-500">{synthesisStatus.text}</span>
          </div>
        </div>
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
    skipped: 'bg-slate-200',
  };

  return <div className={`h-3 w-3 rounded-full ${colors[status] ?? 'bg-slate-300'}`} />;
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

interface LlmResultCardProps {
  result: LlmResult;
  onCopy: (text: string) => void;
  copied: boolean;
}

function LlmResultCard({ result, onCopy, copied }: LlmResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const hasTokenInfo = result.inputTokens !== undefined && result.outputTokens !== undefined;
  const hasCost = result.costUsd !== undefined;

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between p-4 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium">{PROVIDER_DISPLAY_NAMES[result.provider]}</span>
          <span className="text-sm text-slate-500">{result.model}</span>
          {hasTokenInfo ? (
            <span className="text-sm text-slate-400">
              {formatTokenCount(result.inputTokens ?? 0)} /{' '}
              {formatTokenCount(result.outputTokens ?? 0)} tokens
            </span>
          ) : null}
          {hasCost ? (
            <span className="text-sm font-medium text-green-600">
              {formatCost(result.costUsd ?? 0)}
            </span>
          ) : null}
        </div>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined && result.result !== '' ? (
        <div className="border-t border-slate-200 p-4">
          {hasTokenInfo ? (
            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span>
                Input: <strong>{formatNumber(result.inputTokens ?? 0)}</strong> tokens
              </span>
              <span className="text-slate-300">|</span>
              <span>
                Output: <strong>{formatNumber(result.outputTokens ?? 0)}</strong> tokens
              </span>
              {hasCost ? (
                <>
                  <span className="text-slate-300">|</span>
                  <span>
                    Cost:{' '}
                    <strong className="text-green-600">{formatCost(result.costUsd ?? 0)}</strong>
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
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

interface PartialFailureConfirmationProps {
  partialFailure: PartialFailure;
  onConfirm: (action: PartialFailureDecision) => Promise<void>;
  confirming: boolean;
  error: string | null;
}

function PartialFailureConfirmation({
  partialFailure,
  onConfirm,
  confirming,
  error,
}: PartialFailureConfirmationProps): React.JSX.Element {
  const failedProviders = partialFailure.failedProviders
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(', ');

  const canRetry = partialFailure.retryCount < 2;

  return (
    <Card className="mb-6 border-orange-200 bg-orange-50">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1">
          <h3 className="font-semibold text-orange-800">Partial Failure Detected</h3>
          <p className="mt-1 text-sm text-orange-700">
            {failedProviders} failed during research. You can proceed with available results, retry
            the failed providers, or cancel.
          </p>

          {partialFailure.retryCount > 0 ? (
            <p className="mt-2 text-sm text-orange-600">
              Retry attempts: {String(partialFailure.retryCount)}/2
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={(): void => {
                void onConfirm('proceed');
              }}
              disabled={confirming}
              isLoading={confirming}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Proceed with Available
            </Button>

            {canRetry ? (
              <Button
                variant="secondary"
                onClick={(): void => {
                  void onConfirm('retry');
                }}
                disabled={confirming}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Failed ({failedProviders})
              </Button>
            ) : null}

            <Button
              variant="danger"
              onClick={(): void => {
                void onConfirm('cancel');
              }}
              disabled={confirming}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancel Research
            </Button>
          </div>

          {error !== null && error !== '' ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
