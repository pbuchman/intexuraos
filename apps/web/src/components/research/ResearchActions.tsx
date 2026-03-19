import {
  AlertTriangle,
  CheckCircle,
  FileText,
  Link2Off,
  Play,
  Plus,
  RefreshCw,
  Share2,
  StickyNote,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button, Card, ErrorBanner } from '@/components';
import type {
  PartialFailure,
  PartialFailureDecision,
  Research,
} from '@/services/researchAgentApi.types';

interface ResearchActionsProps {
  research: Research;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  deleting: boolean;
  deleteError: string | null;
  showDeleteConfirm: boolean;
  onShowDeleteConfirm: (show: boolean) => void;
  onConfirmDelete: () => void;
  unsharing: boolean;
  unshareError: string | null;
  showUnshareConfirm: boolean;
  onShowUnshareConfirm: (show: boolean) => void;
  onConfirmUnshare: () => void;
  exporting: boolean;
  exportError: string | null;
  exportSuccess: { mainPageUrl: string } | null;
  onExportToNotion: () => void;
  onShowEnhanceModal: () => void;
  onShare: () => void;
  onEditDraft: () => void;
  confirming: boolean;
  confirmError: string | null;
  onConfirmPartialFailure: (action: PartialFailureDecision) => void;
}

export function ResearchActions({
  research,
  approving,
  approveError,
  onApprove,
  retrying,
  retryError,
  onRetry,
  deleting,
  deleteError,
  showDeleteConfirm,
  onShowDeleteConfirm,
  onConfirmDelete,
  unsharing,
  unshareError,
  showUnshareConfirm,
  onShowUnshareConfirm,
  onConfirmUnshare,
  exporting,
  exportError,
  exportSuccess,
  onExportToNotion,
  onShowEnhanceModal,
  onShare,
  onEditDraft,
  confirming,
  confirmError,
  onConfirmPartialFailure,
}: ResearchActionsProps): React.JSX.Element {
  return (
    <>
      <ErrorBanner message={unshareError} className="mt-2" />

      {research.status === 'draft' ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={onApprove}
              disabled={approving || deleting}
              isLoading={approving}
            >
              <Play className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Start Research</span>
            </Button>
            <Button
              variant="secondary"
              onClick={onEditDraft}
              disabled={deleting}
            >
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Edit Draft</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(): void => {
                onShowDeleteConfirm(!showDeleteConfirm);
              }}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Discard</span>
            </Button>
          </div>
          {showDeleteConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">
                Discard &quot;{research.title !== '' ? research.title : 'Untitled Research'}&quot;?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={onConfirmDelete}
                  disabled={deleting}
                  isLoading={deleting}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    onShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            {research.status === 'failed' ? (
              <Button
                onClick={onRetry}
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
                  onClick={onShowEnhanceModal}
                  disabled={deleting}
                >
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Enhance</span>
                </Button>
                {research.notionExportInfo === undefined &&
                research.synthesizedResult !== undefined &&
                research.synthesizedResult !== '' ? (
                  <Button
                    onClick={onExportToNotion}
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
                      onClick={onShare}
                    >
                      <Share2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Share</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(): void => {
                        onShowUnshareConfirm(!showUnshareConfirm);
                      }}
                    >
                      <Link2Off className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Unshare</span>
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={(): void => {
                onShowDeleteConfirm(!showDeleteConfirm);
              }}
              disabled={deleting || retrying}
            >
              <Trash2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
          {showUnshareConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">Unshare this research?</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={onConfirmUnshare}
                  disabled={unsharing}
                  isLoading={unsharing}
                >
                  Unshare
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    onShowUnshareConfirm(false);
                  }}
                  disabled={unsharing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {showDeleteConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">
                Delete &quot;{research.title !== '' ? research.title : 'Untitled Research'}&quot;?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={onConfirmDelete}
                  disabled={deleting}
                  isLoading={deleting}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    onShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <ErrorBanner message={approveError} className="mt-4" />
      <ErrorBanner message={deleteError} className="mt-4" />
      <ErrorBanner message={retryError} className="mt-4" />
      <ErrorBanner message={exportError} className="mt-4" />

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

      {/* Partial Failure Confirmation */}
      {research.status === 'awaiting_confirmation' && research.partialFailure !== undefined ? (
        <PartialFailureConfirmation
          partialFailure={research.partialFailure}
          onConfirm={onConfirmPartialFailure}
          confirming={confirming}
          error={confirmError}
        />
      ) : null}
    </>
  );
}

interface PartialFailureConfirmationProps {
  partialFailure: PartialFailure;
  onConfirm: (action: PartialFailureDecision) => void;
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
                onConfirm('proceed');
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
                  onConfirm('retry');
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
                onConfirm('cancel');
              }}
              disabled={confirming}
            >
              <XCircle className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Cancel Research</span>
            </Button>
          </div>

          <ErrorBanner message={error} className="mt-3" />
        </div>
      </div>
    </Card>
  );
}
