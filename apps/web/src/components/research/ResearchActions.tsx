import { useMemo } from 'react';
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
import { getModelDisplayName } from './shared.js';
import {
  isStoredResearchModelAvailable,
  isStoredResearchSynthesisModelExecutable,
} from '@/utils/researchModelAvailability.js';

export interface ActionState {
  loading: boolean;
  error: string | null;
}

export interface ConfirmableAction extends ActionState {
  showConfirm: boolean;
  onShowConfirm: (show: boolean) => void;
  onConfirm: () => void;
}

export interface ExportState extends ActionState {
  success: { mainPageUrl: string } | null;
  onExport: () => void;
}

export type ModelCatalogState = 'loading' | 'error' | 'access_unavailable' | 'ready';

interface ResearchActionsProps {
  research: Research;
  availableModelIds: string[];
  modelCatalogState: ModelCatalogState;
  onRetryModelCatalog: () => void;
  approve: ActionState & { onApprove: () => void };
  retry: ActionState & { onRetry: () => void };
  deleteAction: ConfirmableAction;
  unshare: ConfirmableAction;
  exportToNotion: ExportState;
  onShowEnhanceModal: () => void;
  onShare: () => void;
  onEditDraft: () => void;
  partialFailure: ActionState & { onConfirm: (action: PartialFailureDecision) => void };
}

export function ResearchActions({
  research,
  availableModelIds,
  modelCatalogState,
  onRetryModelCatalog,
  approve,
  retry,
  deleteAction,
  unshare,
  exportToNotion,
  onShowEnhanceModal,
  onShare,
  onEditDraft,
  partialFailure: partialFailureState,
}: ResearchActionsProps): React.JSX.Element {
  const draftBlockMessage = useMemo(() => {
    if (research.status !== 'draft') return null;
    if (modelCatalogState === 'loading') {
      return 'Start unavailable while the OpenRouter model catalog loads.';
    }
    if (modelCatalogState === 'error') {
      return 'Start unavailable because the OpenRouter model catalog could not be loaded.';
    }
    if (modelCatalogState === 'access_unavailable') {
      return 'Start unavailable because OpenRouter access is unavailable.';
    }
    const unsupportedModels = research.selectedModels.filter(
      (model) => !isStoredResearchModelAvailable(model, availableModelIds),
    );
    if (unsupportedModels.length > 0) {
      return `Start unavailable because these models are no longer supported: ${unsupportedModels.map((model) => getModelDisplayName(model)).join(', ')}. Edit the draft to select active OpenRouter models.`;
    }
    const hasInputContext =
      research.inputContexts?.some((context) => context.content.trim().length > 0) ?? false;
    if (research.selectedModels.length === 0 && !hasInputContext) {
      return 'Start unavailable until the draft has an active OpenRouter model or input context.';
    }
    if (!isStoredResearchSynthesisModelExecutable(research.synthesisModel, availableModelIds)) {
      return `Start unavailable because the synthesis model ${getModelDisplayName(research.synthesisModel)} is no longer supported. Edit the draft to select an active synthesis model.`;
    }
    return null;
  }, [availableModelIds, modelCatalogState, research]);

  const retryBlockMessage = useMemo(() => {
    if (modelCatalogState === 'loading') {
      return 'Retry unavailable while the OpenRouter model catalog loads.';
    }
    if (modelCatalogState === 'error') {
      return 'Retry unavailable because the OpenRouter model catalog could not be loaded.';
    }
    if (modelCatalogState === 'access_unavailable') {
      return 'Retry unavailable because OpenRouter access is unavailable.';
    }
    const failedRetryModels = research.llmResults
      .filter((result) => result.status === 'failed')
      .map((result) => result.model);
    const unsupportedRetryModels = failedRetryModels.filter(
      (model) => !isStoredResearchModelAvailable(model, availableModelIds),
    );
    const retryBlockedByUnsupportedSynthesis =
      failedRetryModels.length === 0 &&
      research.synthesisError !== undefined &&
      research.synthesisError !== '' &&
      research.llmResults.some((result) => result.status === 'completed') &&
      !isStoredResearchSynthesisModelExecutable(research.synthesisModel, availableModelIds);
    return unsupportedRetryModels.length > 0
      ? `Retry unavailable because these historical models are no longer supported: ${unsupportedRetryModels.map((model) => getModelDisplayName(model)).join(', ')}`
      : retryBlockedByUnsupportedSynthesis
        ? `Retry unavailable because the synthesis model ${getModelDisplayName(research.synthesisModel)} is no longer supported.`
        : null;
  }, [availableModelIds, modelCatalogState, research.llmResults, research.synthesisError, research.synthesisModel]);

  return (
    <>
      <ErrorBanner message={unshare.error} className="mt-2" />

      {modelCatalogState === 'error' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <span>The OpenRouter model catalog could not be loaded.</span>
          <Button type="button" variant="secondary" size="sm" onClick={onRetryModelCatalog}>
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            Retry model catalog
          </Button>
        </div>
      ) : modelCatalogState === 'access_unavailable' ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          OpenRouter access is unavailable. Configure access before starting, retrying, or
          enhancing research.
        </div>
      ) : null}

      {research.status === 'draft' ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={approve.onApprove}
              disabled={
                approve.loading || deleteAction.loading || draftBlockMessage !== null
              }
              isLoading={approve.loading}
            >
              <Play className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Start Research</span>
            </Button>
            <Button
              variant="secondary"
              onClick={onEditDraft}
              disabled={deleteAction.loading}
            >
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Edit Draft</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(): void => {
                deleteAction.onShowConfirm(!deleteAction.showConfirm);
              }}
              disabled={deleteAction.loading}
            >
              <Trash2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Discard</span>
            </Button>
          </div>
          {draftBlockMessage !== null &&
          (modelCatalogState === 'ready' || modelCatalogState === 'loading') ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {draftBlockMessage}
            </div>
          ) : null}
          {deleteAction.showConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">
                Discard &quot;{research.title !== '' ? research.title : 'Untitled Research'}&quot;?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={deleteAction.onConfirm}
                  disabled={deleteAction.loading}
                  isLoading={deleteAction.loading}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    deleteAction.onShowConfirm(false);
                  }}
                  disabled={deleteAction.loading}
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
                onClick={retry.onRetry}
                disabled={retry.loading || deleteAction.loading || retryBlockMessage !== null}
                isLoading={retry.loading}
              >
                <RefreshCw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Retry Research</span>
              </Button>
            ) : null}
            {research.status === 'completed' ? (
              <>
                <Button
                  onClick={onShowEnhanceModal}
                  disabled={deleteAction.loading}
                >
                  <Plus className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Enhance</span>
                </Button>
                {research.notionExportInfo === undefined &&
                research.synthesizedResult !== undefined &&
                research.synthesizedResult !== '' ? (
                  <Button
                    onClick={exportToNotion.onExport}
                    disabled={exportToNotion.loading || deleteAction.loading}
                    isLoading={exportToNotion.loading}
                    variant="secondary"
                  >
                    {exportToNotion.loading ? (
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
                        unshare.onShowConfirm(!unshare.showConfirm);
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
                deleteAction.onShowConfirm(!deleteAction.showConfirm);
              }}
              disabled={deleteAction.loading || retry.loading}
            >
              <Trash2 className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
          {research.status === 'failed' &&
          retryBlockMessage !== null &&
          (modelCatalogState === 'ready' || modelCatalogState === 'loading') ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {retryBlockMessage}
            </div>
          ) : null}
          {unshare.showConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">Unshare this research?</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={unshare.onConfirm}
                  disabled={unshare.loading}
                  isLoading={unshare.loading}
                >
                  Unshare
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    unshare.onShowConfirm(false);
                  }}
                  disabled={unshare.loading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {deleteAction.showConfirm ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-3 text-sm text-red-800 dark:text-red-300">
                Delete &quot;{research.title !== '' ? research.title : 'Untitled Research'}&quot;?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={deleteAction.onConfirm}
                  disabled={deleteAction.loading}
                  isLoading={deleteAction.loading}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    deleteAction.onShowConfirm(false);
                  }}
                  disabled={deleteAction.loading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <ErrorBanner message={approve.error} className="mt-4" />
      <ErrorBanner message={deleteAction.error} className="mt-4" />
      <ErrorBanner message={retry.error} className="mt-4" />
      <ErrorBanner message={exportToNotion.error} className="mt-4" />

      {exportToNotion.success !== null ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          Research exported to Notion!{' '}
          <a
            href={exportToNotion.success.mainPageUrl}
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
          synthesisModel={research.synthesisModel}
          availableModelIds={availableModelIds}
          modelCatalogState={modelCatalogState}
          onConfirm={partialFailureState.onConfirm}
          confirming={partialFailureState.loading}
          error={partialFailureState.error}
        />
      ) : null}
    </>
  );
}

interface PartialFailureConfirmationProps {
  partialFailure: PartialFailure;
  synthesisModel: string;
  availableModelIds: string[];
  modelCatalogState: ModelCatalogState;
  onConfirm: (action: PartialFailureDecision) => void;
  confirming: boolean;
  error: string | null;
}

function PartialFailureConfirmation({
  partialFailure,
  synthesisModel,
  availableModelIds,
  modelCatalogState,
  onConfirm,
  confirming,
  error,
}: PartialFailureConfirmationProps): React.JSX.Element {
  // Defensive: API may return undefined failedModels despite type definition
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const failedModelsArr = partialFailure.failedModels ?? [];
  const failedModelsText = failedModelsArr
    .map((model) => getModelDisplayName(model))
    .join(', ');
  const unsupportedFailedModels = failedModelsArr.filter(
    (model) => !isStoredResearchModelAvailable(model, availableModelIds),
  );
  const unsupportedFailedModelsText = unsupportedFailedModels
    .map((model) => getModelDisplayName(model))
    .join(', ');

  const canRetry =
    modelCatalogState === 'ready' &&
    partialFailure.retryCount < 2 &&
    unsupportedFailedModels.length === 0;
  const canProceed =
    modelCatalogState === 'ready' &&
    isStoredResearchSynthesisModelExecutable(synthesisModel, availableModelIds);

  return (
    <Card className="mb-6 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
        <div className="flex-1">
          <h3 className="font-semibold text-orange-800 dark:text-orange-300">Partial Failure Detected</h3>
          <p className="mt-1 text-sm text-orange-700 dark:text-orange-300/90">
            {failedModelsText !== ''
              ? `${failedModelsText} failed during research.`
              : 'Some models failed during research.'}{' '}
            You can proceed with available results, retry the failed models, or cancel.
          </p>

          {partialFailure.retryCount > 0 ? (
            <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">
              Retry attempts: {String(partialFailure.retryCount)}/2
            </p>
          ) : null}

          {modelCatalogState === 'ready' && unsupportedFailedModels.length > 0 ? (
            <p className="mt-2 text-sm text-orange-700 dark:text-orange-300">
              Retry unavailable because these historical models are no longer supported:{' '}
              {unsupportedFailedModelsText}
            </p>
          ) : null}

          {modelCatalogState === 'ready' && !canProceed ? (
            <p className="mt-2 text-sm text-orange-700 dark:text-orange-300">
              Proceed unavailable because the synthesis model{' '}
              {getModelDisplayName(synthesisModel)} is no longer supported.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              onClick={(): void => {
                onConfirm('proceed');
              }}
              disabled={confirming || !canProceed}
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
                disabled={confirming || !canRetry}
              >
                <RefreshCw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {failedModelsText !== ''
                    ? `Retry Failed (${failedModelsText})`
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
