import { useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { PROVIDER_MODELS } from '@/components';
import { useAuth } from '@/context';
import { useLlmKeys } from '@/hooks';
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
import type {
  LlmProvider,
  PartialFailureDecision,
  Research,
  SupportedModel,
} from '@/services/researchAgentApi.types';
import type { ActionState, ConfirmableAction, ExportState } from '@/components/research/ResearchActions.js';

interface EnhanceParams {
  additionalModels?: SupportedModel[];
  additionalContexts?: { content: string }[];
  removeContextIds?: string[];
  synthesisModel?: SupportedModel;
}

export interface ResearchDetailActions {
  copiedSection: string | null;
  copyToClipboard: (text: string, section: string) => void;
  approve: ActionState & { onApprove: () => void };
  retry: ActionState & { onRetry: () => void };
  deleteAction: ConfirmableAction;
  unshare: ConfirmableAction;
  exportToNotion: ExportState;
  shareToast: string | null;
  onShare: () => void;
  togglingFavourite: boolean;
  onToggleFavourite: () => void;
  showEnhanceModal: boolean;
  onShowEnhanceModal: () => void;
  onCloseEnhanceModal: () => void;
  handleEnhance: (params: EnhanceParams) => Promise<void>;
  partialFailure: ActionState & { onConfirm: (action: PartialFailureDecision) => void };
  configuredProviders: LlmProvider[];
  failedProviders: Map<LlmProvider, string>;
}

export function useResearchDetailActions(
  id: string | undefined, // @allow-undefined-type -- function parameter union, not optional property
  research: Research | null,
  refresh: () => Promise<void>,
  navigate: NavigateFunction,
): ResearchDetailActions {
  const { getAccessToken } = useAuth();
  const { keys, loading: keysLoading } = useLlmKeys();

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

  const copyToClipboard = (text: string, section: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedSection(section);
      setTimeout(() => {
        setCopiedSection(null);
      }, 2000);
    });
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

  const handleEnhance = async (params: EnhanceParams): Promise<void> => {
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

  return {
    copiedSection,
    copyToClipboard,
    approve: {
      loading: approving,
      error: approveError,
      onApprove: (): void => { void handleApprove(); },
    },
    retry: {
      loading: retrying,
      error: retryError,
      onRetry: (): void => { void handleRetry(); },
    },
    deleteAction: {
      loading: deleting,
      error: deleteError,
      showConfirm: showDeleteConfirm,
      onShowConfirm: setShowDeleteConfirm,
      onConfirm: (): void => { void handleDelete(); },
    },
    unshare: {
      loading: unsharing,
      error: unshareError,
      showConfirm: showUnshareConfirm,
      onShowConfirm: setShowUnshareConfirm,
      onConfirm: (): void => { void handleUnshare(); },
    },
    exportToNotion: {
      loading: exporting,
      error: exportError,
      success: exportSuccess,
      onExport: (): void => { void handleExportToNotion(); },
    },
    shareToast,
    onShare: (): void => { void handleShare(); },
    togglingFavourite,
    onToggleFavourite: (): void => { void handleToggleFavourite(); },
    showEnhanceModal,
    onShowEnhanceModal: (): void => { setShowEnhanceModal(true); },
    onCloseEnhanceModal: (): void => { setShowEnhanceModal(false); },
    handleEnhance,
    partialFailure: {
      loading: confirming,
      error: confirmError,
      onConfirm: (action: PartialFailureDecision): void => { void handleConfirm(action); },
    },
    configuredProviders,
    failedProviders,
  };
}
