import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Link2,
  Link2Off,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Star,
  StickyNote,
  Trash2,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { LlmModels } from '@intexuraos/llm-contract';
import {
  Button,
  Card,
  Layout,
  ModelSelector,
  PROVIDER_MODELS,
  getSelectedModelsList,
} from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys, useResearch } from '@/hooks';
import { stripMarkdown } from '@/utils';
import {
  approveResearch,
  confirmPartialFailure,
  deleteResearch,
  enhanceResearch,
  retryFromFailed,
  toggleResearchFavourite,
  unshareResearch,
  exportToNotion,
} from '@/services/researchAgentApi';
import {
  getProviderForModel,
  type InputContext,
  type LlmProvider,
  type LlmResult,
  type PartialFailure,
  type PartialFailureDecision,
  type ResearchStatus,
  type SupportedModel,
} from '@/services/researchAgentApi.types';

import { formatRelative } from '@/utils/dateFormat';

interface StatusBadgeProps {
  status: ResearchStatus;
}

function ResearchStatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  if (status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
        <FileText className="h-3.5 w-3.5" />
        Draft
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
        <Clock className="h-3.5 w-3.5" />
        Pending
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
        <Clock className="h-3.5 w-3.5" />
        Processing
      </span>
    );
  }
  if (status === 'awaiting_confirmation') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-1 text-sm font-medium text-orange-700 dark:bg-orange-900/50 dark:text-orange-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Action Required
      </span>
    );
  }
  if (status === 'retrying') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
        <RefreshCw className="h-3.5 w-3.5" />
        Retrying
      </span>
    );
  }
  if (status === 'synthesizing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-1 text-sm font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
        <Clock className="h-3.5 w-3.5" />
        Synthesizing
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-sm font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300">
        <CheckCircle className="h-3.5 w-3.5" />
        Completed
      </span>
    );
  }
  // failed
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-sm font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
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
    <div className="prose prose-slate dark:prose-invert max-w-none overflow-x-auto">
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
              className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
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

const SYNTHESIS_CAPABLE_MODELS: SupportedModel[] = [LlmModels.Gemini25Pro, LlmModels.GPT52];

function getModelDisplayName(modelId: SupportedModel): string {
  for (const provider of PROVIDER_MODELS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model !== undefined) {
      return model.name;
    }
  }
  return modelId;
}

export function ResearchDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { research, loading, error, refresh } = useResearch(id ?? '');
  const { getAccessToken } = useAuth();
  const { keys, loading: keysLoading } = useLlmKeys();
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
  const [togglingFavourite, setTogglingFavourite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<{ mainPageUrl: string } | null>(null);
  const [enhanceModelSelections, setEnhanceModelSelections] = useState<
    Map<LlmProvider, SupportedModel | null>
  >(() => new Map());
  const [enhanceContexts, setEnhanceContexts] = useState<string[]>([]);
  const [removeContextIds, setRemoveContextIds] = useState<Set<string>>(() => new Set());
  const [enhanceSynthesisModel, setEnhanceSynthesisModel] = useState<SupportedModel | null>(null);
  const [linksExpanded, setLinksExpanded] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
  );

  const configuredProviders: LlmProvider[] =
    keysLoading || keys === null
      ? []
      : PROVIDER_MODELS.filter((p) => keys[p.id] !== null).map((p) => p.id);

  const failedProviders: Map<LlmProvider, string> = ((): Map<LlmProvider, string> => {
    const map = new Map<LlmProvider, string>();
    if (keys !== null) {
      for (const provider of PROVIDER_MODELS) {
        const testResult = keys.testResults[provider.id];
        if (testResult?.status === 'failure') {
          map.set(provider.id, testResult.message);
        }
      }
    }
    return map;
  })();

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
    const additionalModels = getSelectedModelsList(enhanceModelSelections);
    const removeIds = Array.from(removeContextIds);
    const hasSynthesisChange =
      enhanceSynthesisModel !== null && enhanceSynthesisModel !== research?.synthesisModel;

    const hasChanges =
      additionalModels.length > 0 ||
      validContexts.length > 0 ||
      removeIds.length > 0 ||
      hasSynthesisChange;

    if (!hasChanges) return;

    setEnhancing(true);
    setEnhanceError(null);

    try {
      const token = await getAccessToken();
      const enhanced = await enhanceResearch(token, id, {
        ...(additionalModels.length > 0 && { additionalModels }),
        ...(validContexts.length > 0 && {
          additionalContexts: validContexts.map((content) => ({ content })),
        }),
        ...(removeIds.length > 0 && { removeContextIds: removeIds }),
        ...(hasSynthesisChange && { synthesisModel: enhanceSynthesisModel }),
      });
      resetEnhanceModal();
      void navigate(`/research/${enhanced.id}`);
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'Failed to enhance research');
    } finally {
      setEnhancing(false);
    }
  };

  const handleEnhanceModelChange = (provider: LlmProvider, model: SupportedModel | null): void => {
    setEnhanceModelSelections((prev) => {
      const next = new Map(prev);
      next.set(provider, model);
      return next;
    });
  };

  const toggleRemoveContext = (contextId: string): void => {
    setRemoveContextIds((prev) => {
      const next = new Set(prev);
      if (next.has(contextId)) {
        next.delete(contextId);
      } else {
        next.add(contextId);
      }
      return next;
    });
  };

  const resetEnhanceModal = (): void => {
    setShowEnhanceModal(false);
    setEnhanceModelSelections(new Map());
    setEnhanceContexts([]);
    setRemoveContextIds(new Set());
    setEnhanceSynthesisModel(null);
    setEnhanceError(null);
  };

  const handleToggleFavourite = async (): Promise<void> => {
    if (research === null) return;
    setTogglingFavourite(true);
    try {
      const token = await getAccessToken();
      await toggleResearchFavourite(token, research.id, !(research.favourite ?? false));
      await refresh();
    } catch {
      // Silently fail for now
    } finally {
      setTogglingFavourite(false);
    }
  };

  const handleExportToNotion = async (): Promise<void> => {
    if (id === undefined || id === '') return;

    setExporting(true);
    setExportError(null);
    setExportSuccess(null);

    try {
      const token = await getAccessToken();
      const updatedResearch = await exportToNotion(token, id);

      if (updatedResearch.notionExportInfo !== undefined) {
        setExportSuccess({ mainPageUrl: updatedResearch.notionExportInfo.mainPageUrl });
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export to Notion';
      if (message.includes('NOTION_NOT_CONNECTED')) {
        setExportError('Please connect Notion first in Settings');
      } else if (message.includes('PAGE_NOT_CONFIGURED')) {
        setExportError('Please configure Research Export Page ID in Settings');
      } else {
        setExportError(message);
      }
    } finally {
      setExporting(false);
    }
  };

  const getExistingProviders = (): Set<LlmProvider> => {
    if (research === null) return new Set();
    return new Set(research.selectedModels.map(getProviderForModel));
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
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error ?? 'Research not found'}
        </div>
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
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{getDisplayTitle()}</h2>
          <ResearchStatusBadge status={research.status} />
          <button
            onClick={(): void => {
              void handleToggleFavourite();
            }}
            disabled={togglingFavourite}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            aria-label={research.favourite === true ? 'Unfavourite' : 'Favourite'}
          >
            <Star
              className={`h-5 w-5 ${research.favourite === true ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`}
            />
          </button>
          <span className="text-sm text-slate-500 dark:text-slate-400 w-full sm:w-auto">
            {isProcessing || research.status === 'awaiting_confirmation'
              ? `Started ${formatRelative(research.startedAt)}`
              : research.completedAt !== undefined
                ? `Finished ${formatRelative(research.completedAt)}`
                : `Started ${formatRelative(research.startedAt)}`}
          </span>
        </div>

        {unshareError !== null && unshareError !== '' ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
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
              <Play className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Start Research</span>
            </Button>
            <Button
              variant="secondary"
              onClick={(): void => {
                void navigate(`/research/new?draftId=${research.id}`);
              }}
              disabled={deleting}
            >
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Edit Draft</span>
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
                  <CheckCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Confirm Discard</span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  <XCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Cancel</span>
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
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Discard</span>
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
                <RefreshCw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Retry Research</span>
              </Button>
            ) : null}
            {research.status === 'completed' ? (
              <>
                <Button
                  onClick={(): void => {
                    setShowEnhanceModal(true);
                  }}
                  disabled={deleting}
                >
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Enhance</span>
                </Button>
                {research.notionExportInfo === undefined &&
                research.synthesizedResult !== undefined &&
                research.synthesizedResult !== '' ? (
                  <Button
                    onClick={(): void => {
                      void handleExportToNotion();
                    }}
                    disabled={exporting || deleting}
                    isLoading={exporting}
                    variant="secondary"
                  >
                    {exporting ? (
                      <>
                        <RefreshCw className="h-4 w-4 sm:mr-2 animate-spin" />
                        <span className="hidden sm:inline">Exporting...</span>
                      </>
                    ) : (
                      <>
                        <StickyNote className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Export to Notion</span>
                      </>
                    )}
                  </Button>
                ) : null}
                {research.shareInfo !== undefined ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={(): void => {
                        void handleShare();
                      }}
                    >
                      <Share2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Share</span>
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
                          <span className="hidden sm:inline">Confirm Unshare</span>
                          <CheckCircle className="h-4 w-4 sm:hidden" />
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={(): void => {
                            setShowUnshareConfirm(false);
                          }}
                          disabled={unsharing}
                        >
                          <span className="hidden sm:inline">Cancel</span>
                          <XCircle className="h-4 w-4 sm:hidden" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={(): void => {
                          setShowUnshareConfirm(true);
                        }}
                      >
                        <Link2Off className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Unshare</span>
                      </Button>
                    )}
                  </>
                ) : null}
              </>
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
                  <CheckCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Confirm Delete</span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  <XCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Cancel</span>
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
                <Trash2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            )}
          </div>
        )}

        {approveError !== null && approveError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {approveError}
          </div>
        ) : null}

        {deleteError !== null && deleteError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {deleteError}
          </div>
        ) : null}

        {retryError !== null && retryError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {retryError}
          </div>
        ) : null}

        {exportError !== null && exportError !== '' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {exportError}
          </div>
        ) : null}

        {exportSuccess !== null ? (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
            Research exported to Notion!{' '}
            <a
              href={exportSuccess.mainPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-green-800 dark:hover:text-green-300"
            >
              View in Notion
            </a>
          </div>
        ) : null}

        {/* Collapsible Links Section */}
        {(research.shareInfo !== undefined || research.notionExportInfo !== undefined) &&
        research.status === 'completed' ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={(): void => {
                setLinksExpanded(!linksExpanded);
              }}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors dark:border-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Links
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${linksExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {linksExpanded ? (
              <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                {research.shareInfo !== undefined ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Share:</span>
                    <a
                      href={research.shareInfo.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {research.shareInfo.shareUrl}
                    </a>
                    <button
                      type="button"
                      onClick={(): void => {
                        void copyToClipboard(research.shareInfo?.shareUrl ?? '', 'share-link');
                      }}
                      className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                      title={copiedSection === 'share-link' ? 'Copied!' : 'Copy link'}
                    >
                      {copiedSection === 'share-link' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ) : null}
                {research.notionExportInfo !== undefined ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-16">Notion:</span>
                    <a
                      href={research.notionExportInfo.mainPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {research.notionExportInfo.mainPageUrl}
                    </a>
                    <button
                      type="button"
                      onClick={(): void => {
                        void copyToClipboard(research.notionExportInfo?.mainPageUrl ?? '', 'notion-link');
                      }}
                      className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                      title={copiedSection === 'notion-link' ? 'Copied!' : 'Copy link'}
                    >
                      {copiedSection === 'notion-link' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Card className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {research.originalPrompt !== undefined ? 'Enhanced Topic' : 'Research Topic'}
          </h3>
          <button
            type="button"
            onClick={() => {
              void copyToClipboard(research.prompt, 'research-topic');
            }}
            className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
            title={copiedSection === 'research-topic' ? 'Copied!' : 'Copy'}
          >
            {copiedSection === 'research-topic' ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
        <blockquote className="rounded border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 italic dark:bg-slate-700">
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">
            {renderPromptWithLinks(research.prompt)}
          </p>
        </blockquote>
        {research.originalPrompt !== undefined ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
              Show original topic
            </summary>
            <blockquote className="mt-2 rounded border-l-4 border-slate-300 bg-slate-100 py-2 pl-4 pr-3 text-sm italic text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
              <p className="whitespace-pre-wrap">{research.originalPrompt}</p>
            </blockquote>
          </details>
        ) : null}
      </Card>

      {/* Research Summary - show when we have usage data */}
      {research.totalInputTokens !== undefined ||
      research.llmResults.some((r) => r.inputTokens !== undefined) ? (
        <Card title="Research Summary" className="mb-6">
          <div className="flex flex-wrap gap-6">
            {research.totalDurationMs !== undefined ? (
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Duration</p>
                <p className="text-lg font-semibold dark:text-slate-100">
                  {(research.totalDurationMs / 1000).toFixed(1)}s
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Input Tokens</p>
              <p className="text-lg font-semibold dark:text-slate-100">
                {(
                  research.totalInputTokens ??
                  research.llmResults.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0)
                ).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Output Tokens</p>
              <p className="text-lg font-semibold dark:text-slate-100">
                {(
                  research.totalOutputTokens ??
                  research.llmResults.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0)
                ).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total Cost</p>
              <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                $
                {(
                  research.totalCostUsd ??
                  research.llmResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
                ).toFixed(4)}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {showLlmStatus ? (
        <ProcessingStatus
          llmResults={research.llmResults}
          selectedModels={research.selectedModels}
          synthesisModel={research.synthesisModel}
          researchStatus={research.status}
          hasInputContexts={
            research.inputContexts !== undefined && research.inputContexts.length > 0
          }
          title={research.status === 'failed' ? 'LLM Status' : 'Processing Status'}
        />
      ) : null}

      {/* Show input contexts during processing (before LLM results are available) */}
      {isProcessing && research.inputContexts !== undefined && research.inputContexts.length > 0 ? (
        <Card title="Input Contexts" className="mb-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {String(research.inputContexts.length)} context
            {research.inputContexts.length > 1 ? 's' : ''} will be included in synthesis
          </p>
          <div className="space-y-3">
            {research.inputContexts.map((ctx, idx) => (
              <CollapsibleInputContext key={ctx.id} ctx={ctx} index={idx} />
            ))}
          </div>
        </Card>
      ) : null}

      {research.status === 'awaiting_confirmation' && research.partialFailure !== undefined ? (
        <PartialFailureConfirmation
          partialFailure={research.partialFailure}
          onConfirm={handleConfirm}
          confirming={confirming}
          error={confirmError}
        />
      ) : null}

      {/* Main Report Section */}
      {((): React.JSX.Element | null => {
        const completedResults = research.llmResults.filter((r) => r.status === 'completed');
        const hasInputContexts =
          research.inputContexts !== undefined && research.inputContexts.length > 0;
        const isSingleModelResearch = completedResults.length === 1 && !hasInputContexts;
        const singleResult = isSingleModelResearch ? completedResults[0] : undefined;

        if (research.synthesizedResult !== undefined && research.synthesizedResult !== '') {
          return (
            <Card className="mb-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Synthesis Report</h3>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Synthesized by {getModelDisplayName(research.synthesisModel)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(): void => {
                    void copyToClipboard(research.synthesizedResult ?? '', 'synthesis');
                  }}
                  className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                  title={copiedSection === 'synthesis' ? 'Copied!' : 'Copy'}
                >
                  {copiedSection === 'synthesis' ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
                <MarkdownContent content={research.synthesizedResult} />
              </div>
            </Card>
          );
        }

        if (
          research.status === 'completed' &&
          singleResult?.result !== undefined &&
          singleResult.result !== ''
        ) {
          const hasTokenInfo =
            singleResult.inputTokens !== undefined && singleResult.outputTokens !== undefined;
          const hasCost = singleResult.costUsd !== undefined;

          return (
            <Card className="mb-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Research Report</h3>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                    <span>
                      Generated by {getModelDisplayName(singleResult.model as SupportedModel)}
                    </span>
                    {hasTokenInfo ? (
                      <span className="text-slate-400">
                        in: {formatTokenCount(singleResult.inputTokens ?? 0)} / out:{' '}
                        {formatTokenCount(singleResult.outputTokens ?? 0)}
                      </span>
                    ) : null}
                    {hasCost ? (
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {formatCost(singleResult.costUsd ?? 0)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(): void => {
                    void copyToClipboard(singleResult.result ?? '', 'main-report');
                  }}
                  className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
                  title={copiedSection === 'main-report' ? 'Copied!' : 'Copy'}
                >
                  {copiedSection === 'main-report' ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-700">
                <MarkdownContent content={singleResult.result} />
              </div>
              {singleResult.sources !== undefined && singleResult.sources.length > 0 ? (
                <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <h4 className="mb-2 text-sm font-medium dark:text-slate-200">Sources</h4>
                  <ul className="text-sm text-blue-600 dark:text-blue-400">
                    {singleResult.sources.map((source, i) => (
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
            </Card>
          );
        }

        return null;
      })()}

      {research.synthesisError !== undefined && research.synthesisError !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <h3 className="font-medium text-red-800 dark:text-red-300">Synthesis Failed</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{research.synthesisError}</p>
        </div>
      ) : null}

      {/* Individual LLM Results - only show when multiple results or synthesis exists */}
      {((): React.JSX.Element | null => {
        const completedResults = research.llmResults.filter((r) => r.status === 'completed');
        const hasInputContexts =
          research.inputContexts !== undefined && research.inputContexts.length > 0;
        const isSingleModelResearch = completedResults.length === 1 && !hasInputContexts;
        const hasResults = research.llmResults.some(
          (r) =>
            (r.result !== undefined && r.result !== '') || (r.error !== undefined && r.error !== '')
        );

        if (isSingleModelResearch || !hasResults) {
          return null;
        }

        return (
          <div>
            <h3 className="mb-4 text-xl font-bold text-slate-900 dark:text-slate-100">Individual LLM Results</h3>
            <div className="space-y-4">
              {/* Input Contexts */}
              {research.inputContexts !== undefined && research.inputContexts.length > 0
                ? research.inputContexts.map((ctx, idx) => (
                    <CollapsibleInputContext key={`ctx-${ctx.id}`} ctx={ctx} index={idx} showFull />
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
        );
      })()}

      {showEnhanceModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="mb-4 text-lg font-semibold dark:text-slate-100">Enhance Research</h3>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              Add more AI models, change synthesis model, or modify context.
            </p>

            {/* Additional Models */}
            <div className="mb-6">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
                Add models from new providers:
              </p>
              <ModelSelector
                selectedModels={enhanceModelSelections}
                onChange={handleEnhanceModelChange}
                configuredProviders={configuredProviders}
                disabledProviders={getExistingProviders()}
                failedProviders={failedProviders}
                disabled={enhancing}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                Providers already in research are disabled. Select models from other providers.
              </p>
            </div>

            {/* Synthesis Model */}
            <div className="mb-6">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
                Synthesis Model{' '}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  (current:{' '}
                  {PROVIDER_MODELS.flatMap((p) => p.models).find(
                    (m) => m.id === research.synthesisModel
                  )?.name ?? research.synthesisModel}
                  )
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {SYNTHESIS_CAPABLE_MODELS.map((model) => {
                  const isSelected = enhanceSynthesisModel === model;
                  const isCurrent = research.synthesisModel === model;
                  const modelConfig = PROVIDER_MODELS.flatMap((p) => p.models).find(
                    (m) => m.id === model
                  );
                  const provider = getProviderForModel(model);
                  const hasKey = configuredProviders.includes(provider);
                  const isDisabled = !hasKey || enhancing;

                  return (
                    <button
                      key={model}
                      type="button"
                      onClick={(): void => {
                        setEnhanceSynthesisModel(isSelected ? null : model);
                      }}
                      disabled={isDisabled}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        isSelected
                          ? 'bg-green-600 text-white'
                          : isCurrent
                            ? 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                            : hasKey
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                              : 'bg-slate-50 text-slate-400 cursor-not-allowed dark:bg-slate-700/50 dark:text-slate-500'
                      }`}
                      title={
                        !hasKey ? 'API key not configured' : isCurrent ? 'Current model' : undefined
                      }
                    >
                      {modelConfig?.name ?? model}
                      {!hasKey ? ' (no key)' : ''}
                      {isCurrent && !isSelected ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Existing Contexts */}
            {(research.inputContexts?.length ?? 0) > 0 ? (
              <div className="mb-4">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  Existing contexts{' '}
                  <span className="font-normal text-slate-500 dark:text-slate-400">
                    ({String((research.inputContexts?.length ?? 0) - removeContextIds.size)} will be
                    kept)
                  </span>
                </p>
                <div className="space-y-2">
                  {research.inputContexts?.map((ctx, idx) => {
                    const isRemoved = removeContextIds.has(ctx.id);
                    return (
                      <div
                        key={ctx.id}
                        className={`flex items-center gap-3 rounded-lg border p-3 ${
                          isRemoved ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30' : 'border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!isRemoved}
                          onChange={(): void => {
                            toggleRemoveContext(ctx.id);
                          }}
                          disabled={enhancing}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-500 dark:bg-slate-600"
                        />
                        <span
                          className={`flex-1 text-sm truncate ${
                            isRemoved ? 'text-red-600 line-through dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {ctx.label !== undefined && ctx.label !== ''
                            ? ctx.label
                            : `Context ${String(idx + 1)}: ${ctx.content.substring(0, 100)}${ctx.content.length > 100 ? '...' : ''}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* New Contexts */}
            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Add new context{' '}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  (
                  {String(
                    (research.inputContexts?.length ?? 0) -
                      removeContextIds.size +
                      enhanceContexts.length
                  )}
                  /5 total)
                </span>
              </p>

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
                    className="flex-1 rounded-lg border border-slate-200 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-400"
                    rows={2}
                    disabled={enhancing}
                  />
                  <button
                    type="button"
                    onClick={(): void => {
                      setEnhanceContexts((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    disabled={enhancing}
                    className="self-start rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              {(research.inputContexts?.length ?? 0) -
                removeContextIds.size +
                enhanceContexts.length <
              5 ? (
                <button
                  type="button"
                  onClick={(): void => {
                    setEnhanceContexts((prev) => [...prev, '']);
                  }}
                  disabled={enhancing}
                  className="w-full rounded-lg border-2 border-dashed border-slate-200 py-2 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
                >
                  + Add context
                </button>
              ) : null}
            </div>

            {enhanceError !== null ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                {enhanceError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={resetEnhanceModal} disabled={enhancing}>
                <XCircle className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
              <Button
                onClick={(): void => {
                  void handleEnhance();
                }}
                disabled={
                  enhancing ||
                  (getSelectedModelsList(enhanceModelSelections).length === 0 &&
                    enhanceContexts.filter((c) => c.trim().length > 0).length === 0 &&
                    removeContextIds.size === 0 &&
                    (enhanceSynthesisModel === null ||
                      enhanceSynthesisModel === research.synthesisModel))
                }
                isLoading={enhancing}
              >
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Enhance</span>
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
  selectedModels: SupportedModel[];
  synthesisModel: SupportedModel;
  researchStatus: ResearchStatus;
  hasInputContexts: boolean;
  title?: string;
}

function ProcessingStatus({
  llmResults,
  selectedModels,
  synthesisModel,
  researchStatus,
  hasInputContexts,
  title = 'Processing Status',
}: ProcessingStatusProps): React.JSX.Element {
  const willSynthesize = selectedModels.length > 1 || hasInputContexts;
  const getStatusText = (result: LlmResult): string => {
    if (result.status === 'completed' && result.durationMs !== undefined) {
      return `(${(result.durationMs / 1000).toFixed(1)}s)`;
    }
    if (result.status === 'processing') {
      if (result.startedAt !== undefined) {
        return `Started ${formatRelative(result.startedAt)}, processing...`;
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
        {selectedModels.map((model) => {
          const result = llmResults.find((r) => r.model === model);
          const modelName = getModelDisplayName(model);

          if (result === undefined) {
            return (
              <div key={model} className="flex items-center gap-3">
                <StatusDot status="pending" />
                <span className="dark:text-slate-200">{modelName}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">Waiting...</span>
              </div>
            );
          }

          return (
            <div key={model} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <StatusDot status={result.status} />
                <span className="dark:text-slate-200">{modelName}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{getStatusText(result)}</span>
              </div>
              {result.status === 'failed' && result.error !== undefined && result.error !== '' ? (
                <ErrorDisplay error={result.error} className="ml-6" />
              ) : null}
            </div>
          );
        })}

        {willSynthesize ? (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <StatusDot status={synthesisStatus.status} />
              <span className="font-medium dark:text-slate-200">Synthesis</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                ({getModelDisplayName(synthesisModel)})
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">{synthesisStatus.text}</span>
            </div>
          </div>
        ) : null}
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

function ErrorDisplay({
  error,
  className,
}: {
  error: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
    </div>
  );
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
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50"
      >
        <div className="flex items-center gap-3">
          <StatusDot status={result.status} />
          <span className="font-medium dark:text-slate-100">{getModelDisplayName(result.model as SupportedModel)}</span>
          {hasTokenInfo ? (
            <span className="text-sm text-slate-400">
              in: {formatTokenCount(result.inputTokens ?? 0)} / out:{' '}
              {formatTokenCount(result.outputTokens ?? 0)}
            </span>
          ) : null}
          {hasCost ? (
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              {formatCost(result.costUsd ?? 0)}
            </span>
          ) : null}
        </div>
        <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && result.result !== undefined && result.result !== '' ? (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          {hasTokenInfo ? (
            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
              <span>
                Input: <strong className="dark:text-slate-100">{formatNumber(result.inputTokens ?? 0)}</strong> tokens
              </span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span>
                Output: <strong className="dark:text-slate-100">{formatNumber(result.outputTokens ?? 0)}</strong> tokens
              </span>
              {hasCost ? (
                <>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>
                    Cost:{' '}
                    <strong className="text-green-600 dark:text-green-400">{formatCost(result.costUsd ?? 0)}</strong>
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={(): void => {
                onCopy(result.result ?? '');
              }}
              className="rounded p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-700">
            <MarkdownContent content={result.result} />
          </div>
          {result.sources !== undefined && result.sources.length > 0 ? (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="mb-2 text-sm font-medium dark:text-slate-200">Sources</h4>
              <ul className="text-sm text-blue-600 dark:text-blue-400">
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
        <div className="border-t border-slate-200 bg-red-50 p-4 dark:border-slate-700 dark:bg-red-900/30">
          <ErrorDisplay error={result.error} />
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
  // Defensive: API may return undefined failedProviders despite type definition
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const failedProvidersArr = partialFailure.failedProviders ?? [];
  const failedProvidersText = failedProvidersArr
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(', ');

  const canRetry = partialFailure.retryCount < 2;

  return (
    <Card className="mb-6 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
        <div className="flex-1">
          <h3 className="font-semibold text-orange-800 dark:text-orange-300">Partial Failure Detected</h3>
          <p className="mt-1 text-sm text-orange-700 dark:text-orange-300/90">
            {failedProvidersText !== ''
              ? `${failedProvidersText} failed during research.`
              : 'Some providers failed during research.'}{' '}
            You can proceed with available results, retry the failed providers, or cancel.
          </p>

          {partialFailure.retryCount > 0 ? (
            <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">
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
              <CheckCircle className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Proceed with Available</span>
            </Button>

            {canRetry ? (
              <Button
                variant="secondary"
                onClick={(): void => {
                  void onConfirm('retry');
                }}
                disabled={confirming}
              >
                <RefreshCw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {failedProvidersText !== ''
                    ? `Retry Failed (${failedProvidersText})`
                    : 'Retry Failed'}
                </span>
              </Button>
            ) : null}

            <Button
              variant="danger"
              onClick={(): void => {
                void onConfirm('cancel');
              }}
              disabled={confirming}
            >
              <XCircle className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Cancel Research</span>
            </Button>
          </div>

          {error !== null && error !== '' ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

interface CollapsibleInputContextProps {
  ctx: InputContext;
  index: number;
  showFull?: boolean;
}

function CollapsibleInputContext({
  ctx,
  index,
  showFull = false,
}: CollapsibleInputContextProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const title =
    ctx.label !== undefined && ctx.label !== '' ? ctx.label : `Context ${String(index + 1)}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700">
      <button
        type="button"
        onClick={(): void => {
          setExpanded(!expanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between p-3 hover:bg-slate-100 transition-colors dark:hover:bg-slate-600"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</span>
          <span className="text-xs text-slate-400">
            {ctx.content.length.toLocaleString()} chars
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 p-4 dark:border-slate-600">
          {showFull ? (
            <MarkdownContent content={ctx.content} />
          ) : (
            <p className="break-words text-sm text-slate-600 whitespace-pre-wrap dark:text-slate-300">{ctx.content}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
