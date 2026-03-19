import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Copy } from 'lucide-react';
import {
  Card,
  Layout,
  MarkdownContent,
  PROVIDER_MODELS,
} from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys, useResearch } from '@/hooks';
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
  type LlmProvider,
  type PartialFailureDecision,
  type SupportedModel,
} from '@/services/researchAgentApi.types';
import { ResearchHeader } from '@/components/research/ResearchHeader.js';
import { ResearchActions } from '@/components/research/ResearchActions.js';
import { ResearchResults } from '@/components/research/ResearchResults.js';
import { ProcessingStatus, CollapsibleInputContext } from '@/components/research/ProcessingStatus.js';
import { EnhanceModal } from '@/components/research/EnhanceModal.js';

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
  const [togglingFavourite, setTogglingFavourite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<{ mainPageUrl: string } | null>(null);

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

  const handleEnhance = async (params: {
    additionalModels?: SupportedModel[];
    additionalContexts?: { content: string }[];
    removeContextIds?: string[];
    synthesisModel?: SupportedModel;
  }): Promise<void> => {
    if (id === undefined || id === '') return;
    const token = await getAccessToken();
    const enhanced = await enhanceResearch(token, id, params);
    setShowEnhanceModal(false);
    void navigate(`/research/${enhanced.id}`);
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

  return (
    <Layout>
      <ResearchHeader
        research={research}
        togglingFavourite={togglingFavourite}
        onToggleFavourite={(): void => { void handleToggleFavourite(); }}
        copiedSection={copiedSection}
        onCopyToClipboard={(text, section): void => { void copyToClipboard(text, section); }}
      />

      <ResearchActions
        research={research}
        approving={approving}
        approveError={approveError}
        onApprove={(): void => { void handleApprove(); }}
        retrying={retrying}
        retryError={retryError}
        onRetry={(): void => { void handleRetry(); }}
        deleting={deleting}
        deleteError={deleteError}
        showDeleteConfirm={showDeleteConfirm}
        onShowDeleteConfirm={setShowDeleteConfirm}
        onConfirmDelete={(): void => { void handleDelete(); }}
        unsharing={unsharing}
        unshareError={unshareError}
        showUnshareConfirm={showUnshareConfirm}
        onShowUnshareConfirm={setShowUnshareConfirm}
        onConfirmUnshare={(): void => { void handleUnshare(); }}
        exporting={exporting}
        exportError={exportError}
        exportSuccess={exportSuccess}
        onExportToNotion={(): void => { void handleExportToNotion(); }}
        onShowEnhanceModal={(): void => { setShowEnhanceModal(true); }}
        onShare={(): void => { void handleShare(); }}
        onEditDraft={(): void => { void navigate(`/research/new?draftId=${research.id}`); }}
        confirming={confirming}
        confirmError={confirmError}
        onConfirmPartialFailure={(action): void => { void handleConfirm(action); }}
      />

      <Card className="mb-6 mt-6">
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
        <blockquote className="rounded border-l-4 border-blue-400 bg-slate-50 py-3 pl-4 pr-3 dark:bg-slate-700">
          <div className="text-slate-700 dark:text-slate-200">
            <MarkdownContent content={research.prompt} />
          </div>
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

      <ResearchResults
        research={research}
        copiedSection={copiedSection}
        onCopy={(text, section): void => { void copyToClipboard(text, section); }}
      />

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

      {showEnhanceModal ? (
        <EnhanceModal
          research={research}
          configuredProviders={configuredProviders}
          failedProviders={failedProviders}
          onEnhance={handleEnhance}
          onClose={(): void => { setShowEnhanceModal(false); }}
        />
      ) : null}

      {shareToast !== null ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {shareToast}
        </div>
      ) : null}
    </Layout>
  );
}
