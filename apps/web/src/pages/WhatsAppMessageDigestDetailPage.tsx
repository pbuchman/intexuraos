import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  Clipboard,
  Edit3,
  History,
  LoaderCircle,
  Newspaper,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { MessageDigestDeleteDialog } from '@/components/message-digests/MessageDigestDeleteDialog';
import { MessageDigestDeliveryPath } from '@/components/message-digests/MessageDigestDeliveryPath';
import {
  getMessageDigestDeleteDisabledReason,
  getMessageDigestLifecycleDisabledReason,
  getMessageDigestRunDisabledReasonWithRecoveryFence,
  isMessageDigestSourceAttentionBlocker,
} from '@/components/message-digests/messageDigestLifecycle';
import { MessageDigestPageLoading } from '@/components/message-digests/MessageDigestPageLoading';
import { MessageDigestRunStatus } from '@/components/message-digests/MessageDigestRunStatus';
import { Modal } from '@/components/ui/Modal';
import {
  useMessageDigestCommands,
  useMessageDigestDefinition,
  useMessageDigestDeliveryReadiness,
  useMessageDigestHistory,
  useMessageDigestRun,
  useMessageDigestSourceAvailability,
} from '@/hooks/useMessageDigests';
import type {
  MessageDigestDefinition,
  MessageDigestRun,
  MessageDigestRunPreparation,
} from '@/types/messageDigests';
import {
  formatMessageDigestDateTime,
  getMessageDigestScheduleLabel,
  getMessageDigestStatusLabel,
  maskMessageDigestPrimaryNumber,
} from '@/types/messageDigests';

export function WhatsAppMessageDigestDetailPage(): React.JSX.Element {
  const { definitionId = '' } = useParams<{ definitionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const digest = useMessageDigestDefinition(definitionId);
  const delivery = useMessageDigestDeliveryReadiness();
  const source = useMessageDigestSourceAvailability();
  const history = useMessageDigestHistory(definitionId, {
    limit: 5,
    sort: 'windowStart',
    direction: 'desc',
  });
  const commands = useMessageDigestCommands();
  const intent = readDetailIntent(location.state);
  const pendingRecoveryForCurrentDefinition =
    commands.pendingRunRecoveryDefinitionId === definitionId;
  const [runOpen, setRunOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(
    intent.openDelete && !pendingRecoveryForCurrentDefinition
  );
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState<'pause' | 'resume' | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const runTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const deleteOpenOriginRef = useRef<'local' | 'routed'>(
    intent.openDelete ? 'routed' : 'local'
  );
  const routedRunHandledRef = useRef(false);
  const recoveryHandledRef = useRef(false);
  const focusedLocationKeyRef = useRef<string | null>(null);
  const loadedDefinitionId = digest.definition?.id ?? null;
  const lifecycleContext = {
    sourceAvailability: source.availability,
    sourceIsRefreshing: source.isRefreshing,
    sourceAvailabilityError: source.error,
    deliveryReadiness: delivery.readiness,
    deliveryIsLoading: delivery.isLoading,
    deliveryIsRefreshing: delivery.isRefreshing,
    deliveryReadinessError: delivery.error,
  } as const;
  const currentRunDisabledReason =
    digest.definition === null
      ? 'Wait for this Message Digest to load before running it.'
      : getMessageDigestRunDisabledReasonWithRecoveryFence(
          digest.definition,
          lifecycleContext,
          commands.pendingRunRecoveryDefinitionId
        );
  const pendingRecoveryForAnotherDefinition =
    commands.pendingRunRecoveryDefinitionId !== null &&
    commands.pendingRunRecoveryDefinitionId !== definitionId;
  const deleteDisabledReason = getMessageDigestDeleteDisabledReason(
    definitionId,
    commands.pendingRunRecoveryDefinitionId
  );

  useEffect(() => {
    if (
      !intent.focusHeading ||
      loadedDefinitionId === null ||
      loadedDefinitionId !== definitionId ||
      focusedLocationKeyRef.current === location.key
    ) {
      return;
    }
    const heading = headingRef.current;
    if (heading === null) return;
    heading.focus();
    focusedLocationKeyRef.current = location.key;
  }, [definitionId, intent.focusHeading, loadedDefinitionId, location.key]);

  useEffect(() => {
    if (!deleteOpen || deleteOpenOriginRef.current !== 'routed') return;
    deleteReturnFocusRef.current = headingRef.current;
  }, [deleteOpen, digest.definition]);

  useEffect(() => {
    if (deleteDisabledReason !== null) setDeleteOpen(false);
  }, [deleteDisabledReason]);

  useEffect(() => {
    if (!intent.openRun || routedRunHandledRef.current) return;
    if (digest.definition === null || currentRunDisabledReason !== null) return;
    if (commands.pendingRunRecoveryDefinitionId === definitionId) return;
    routedRunHandledRef.current = true;
    commands.clearError();
    setRunOpen(true);
    void commands.prepareRun(definitionId);
  }, [
    commands,
    commands.pendingRunRecoveryDefinitionId,
    currentRunDisabledReason,
    definitionId,
    digest.definition,
    intent.openRun,
  ]);

  const navigateToRun = useCallback(
    (runId: string): void => {
      void navigate(`/whatsapp/message-digests/${definitionId}/history/${runId}`, {
        replace: true,
        state: { startedNow: true, focusHeading: true },
      });
    },
    [definitionId, navigate]
  );

  const recoverPendingRun = useCallback(async (): Promise<void> => {
    if (currentRunDisabledReason !== null) return;
    setRunOpen(true);
    const response = await commands.recoverPendingRun(definitionId);
    if (response !== null) navigateToRun(response.run.id);
  }, [commands, currentRunDisabledReason, definitionId, navigateToRun]);

  useEffect(() => {
    if (
      digest.definition === null ||
      commands.pendingRunRecoveryDefinitionId !== definitionId ||
      recoveryHandledRef.current ||
      currentRunDisabledReason !== null
    ) {
      return;
    }
    recoveryHandledRef.current = true;
    void recoverPendingRun();
  }, [
    commands.pendingRunRecoveryDefinitionId,
    currentRunDisabledReason,
    definitionId,
    digest.definition,
    recoverPendingRun,
  ]);

  const openRunDialog = async (): Promise<void> => {
    if (digest.definition === null || currentRunDisabledReason !== null) return;
    commands.clearError();
    if (commands.pendingRunRecoveryDefinitionId === definitionId) {
      await recoverPendingRun();
      return;
    }
    setRunOpen(true);
    await commands.prepareRun(definitionId);
  };

  const confirmRun = async (): Promise<void> => {
    const response = await commands.confirmRun(definitionId);
    if (response === null) return;
    commands.finishRunRequest();
    setRunOpen(false);
    navigateToRun(response.run.id);
  };

  const finishDeletion = useCallback((): void => {
    void navigate('/whatsapp/message-digests', {
      replace: true,
      state: { deleted: true, focusHeading: true },
    });
  }, [navigate]);

  const deletionRecovery =
    definitionId === '' ? null : (
      <MessageDigestDeleteDialog
        definitionId={definitionId}
        definitionName={digest.definition?.name ?? 'This Message Digest'}
        erasureRequestId={digest.definition?.erasureRequestId ?? null}
        open={digest.definition !== null && deleteOpen && deleteDisabledReason === null}
        returnFocusRef={deleteReturnFocusRef}
        onOpenChange={setDeleteOpen}
        onDeleted={finishDeletion}
      />
    );

  if (digest.isLoading) {
    return (
      <>
        <MessageDigestPageLoading title="Message Digest" />
        {deletionRecovery}
      </>
    );
  }
  if (digest.isNotFound || definitionId === '') {
    return (
      <>
        <MessageDigestNotFound />
        {deletionRecovery}
      </>
    );
  }
  if (digest.definition === null) {
    return (
      <>
        <MessageDigestLoadError
          message={digest.error ?? 'Message Digest is temporarily unavailable.'}
          onRetry={digest.refresh}
        />
        {deletionRecovery}
      </>
    );
  }

  const definition = digest.definition;
  const isDeleting = definition.status === 'deleting';
  const lifecycleAction = definition.status === 'paused' ? 'resume' : 'pause';
  const lifecycleDisabledReason = getMessageDigestLifecycleDisabledReason(
    definition,
    lifecycleContext
  );
  const runDisabledReason = currentRunDisabledReason;
  const toggleLifecycle = async (): Promise<void> => {
    const latestLifecycleDisabledReason = getMessageDigestLifecycleDisabledReason(
      definition,
      lifecycleContext
    );
    if (lifecyclePending !== null || latestLifecycleDisabledReason !== null || isDeleting) return;
    const action = lifecycleAction;
    setLifecycleError(null);
    commands.clearError();
    setLifecyclePending(action);
    try {
      const updated = await commands.updateDigest(definition.id, {
        expectedRevision: definition.revision,
        patch: { status: action === 'resume' ? 'active' : 'paused' },
      });
      if (updated === null) {
        const refreshed = await digest.refreshWithResult();
        setLifecycleError(
          refreshed
            ? 'The latest state is loaded. Review it and try again.'
            : 'Refresh this page to load the latest state, then try again.'
        );
      } else {
        digest.adoptDefinition(updated);
      }
    } catch {
      setLifecycleError('Review the current state and try again.');
    } finally {
      setLifecyclePending(null);
    }
  };
  const copyInstructions = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(definition.instructions.text);
      setCopyResult('Instructions copied');
    } catch {
      setCopyResult('Couldn’t copy instructions');
    }
  };

  return (
    <Layout>
      <section
        className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6"
        aria-labelledby="page-title"
      >
        <header className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <Link
            to="/whatsapp/message-digests"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-slate-600 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:text-slate-50"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to Message Digests
          </Link>
          <div className="mt-3 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1
                  ref={headingRef}
                  id="page-title"
                  tabIndex={-1}
                  className="min-w-0 break-words text-2xl font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-50"
                >
                  {definition.name}
                </h1>
                <DefinitionStatus definition={definition} />
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                Scheduled summary from one read-only WhatsApp conversation.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              {isDeleting || lifecyclePending !== null ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 text-sm font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                >
                  <Edit3 aria-hidden="true" className="h-4 w-4" />
                  Edit digest
                </button>
              ) : (
                <Link
                  to={`/whatsapp/message-digests/${definition.id}/edit`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Edit3 aria-hidden="true" className="h-4 w-4" />
                  Edit digest
                </Link>
              )}
              <button
                type="button"
                disabled={
                  isDeleting || lifecyclePending !== null || lifecycleDisabledReason !== null
                }
                onClick={(): void => {
                  void toggleLifecycle();
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {lifecyclePending !== null ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : lifecycleAction === 'pause' ? (
                  <PauseCircle aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <PlayCircle aria-hidden="true" className="h-4 w-4" />
                )}
                {lifecyclePending === 'pause'
                  ? 'Pausing digest…'
                  : lifecyclePending === 'resume'
                    ? 'Resuming digest…'
                    : lifecycleAction === 'pause'
                      ? 'Pause digest'
                      : 'Resume digest'}
              </button>
              <button
                ref={runTriggerRef}
                type="button"
                disabled={
                  runDisabledReason !== null ||
                  commands.isPreparingRun ||
                  lifecyclePending !== null
                }
                onClick={(): void => {
                  void openRunDialog();
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
              >
                {commands.isPreparingRun ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Play aria-hidden="true" className="h-4 w-4" />
                )}
                Run now
              </button>
              <button
                ref={deleteTriggerRef}
                type="button"
                disabled={
                  isDeleting || lifecyclePending !== null || deleteDisabledReason !== null
                }
                onClick={(): void => {
                  if (deleteDisabledReason !== null) return;
                  deleteOpenOriginRef.current = 'local';
                  deleteReturnFocusRef.current = deleteTriggerRef.current;
                  setDeleteOpen(true);
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>
          {runDisabledReason !== null ? (
            <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300">
              {runDisabledReason}
            </p>
          ) : null}
          {lifecycleDisabledReason !== null && lifecycleDisabledReason !== runDisabledReason ? (
            <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              {lifecycleDisabledReason}
            </p>
          ) : null}
          {deleteDisabledReason !== null ? (
            <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              {deleteDisabledReason}
            </p>
          ) : null}
          {lifecycleError !== null ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
            >
              Digest status was not changed. {lifecycleError}
            </p>
          ) : null}
        </header>

        {pendingRecoveryForAnotherDefinition ? (
          <div
            role="status"
            aria-label="Pending Message Digest run"
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">Another Message Digest run needs recovery.</p>
              <p className="mt-1 leading-6">
                Its delivery result must be reconciled before this digest can run.
              </p>
            </div>
            <Link
              to={`/whatsapp/message-digests/${commands.pendingRunRecoveryDefinitionId ?? ''}`}
              state={{ openRun: true, focusHeading: true }}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
            >
              Recover pending run
            </Link>
          </div>
        ) : null}

        {intent.activationAdjusted === 'delivery_setup_required' ? (
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            The digest was saved as paused because primary WhatsApp delivery is not ready yet.
          </div>
        ) : null}

        {definition.attentionCode === 'SOURCE_TOO_LARGE' ? (
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <p className="font-semibold">The previous run window was too large.</p>
            <p className="mt-1">
              {definition.status === 'paused'
                ? 'Resume this digest to retry the retained window.'
                : 'Run now to retry the retained window.'}
            </p>
          </div>
        ) : null}

        <MessageDigestSourceStatus
          availability={source.availability}
          error={source.error}
          isRefreshing={source.isRefreshing}
          onRefresh={source.refresh}
        />

        <MessageDigestDeliveryPath
          source={definition.source}
          readiness={delivery.readiness}
          isLoading={delivery.isLoading || delivery.isRefreshing}
          error={delivery.error}
          onRefresh={delivery.refresh}
        />

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <ScheduleCard definition={definition} />
          <InstructionsCard
            instructions={definition.instructions.text}
            copyResult={copyResult}
            onCopy={copyInstructions}
          />
        </div>

        <LatestRunSection definition={definition} history={history} />

        <div className="flex justify-end">
          <Link
            to={`/whatsapp/message-digests/${definition.id}/history`}
            state={{ focusHeading: true }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <History aria-hidden="true" className="h-4 w-4" />
            View full history
          </Link>
        </div>
      </section>

      <RunConfirmationDialog
        open={runOpen}
        returnFocusRef={runTriggerRef}
        preparation={commands.preparation}
        isPreparing={commands.isPreparingRun}
        isConfirming={commands.isConfirmingRun}
        isRecovering={commands.isRecoveringRun}
        hasPendingRecovery={commands.pendingRunRecoveryDefinitionId === definitionId}
        recoveryDisabledReason={
          commands.pendingRunRecoveryDefinitionId === definitionId
            ? currentRunDisabledReason
            : null
        }
        error={commands.error}
        requiresReconfirmation={commands.requiresRunReconfirmation}
        onClose={(): void => {
          if (commands.isConfirmingRun) return;
          commands.clearError();
          setRunOpen(false);
        }}
        onRetryPreparation={openRunDialog}
        onRetryRecovery={recoverPendingRun}
        onConfirm={confirmRun}
      />

      {deletionRecovery}
    </Layout>
  );
}

interface DetailIntent {
  openRun: boolean;
  openDelete: boolean;
  focusHeading: boolean;
  activationAdjusted: 'delivery_setup_required' | null;
}

function readDetailIntent(state: unknown): DetailIntent {
  if (typeof state !== 'object' || state === null) {
    return { openRun: false, openDelete: false, focusHeading: false, activationAdjusted: null };
  }
  const record = state as Record<string, unknown>;
  return {
    openRun: record['openRun'] === true,
    openDelete: record['openDelete'] === true,
    focusHeading: record['created'] === true || record['focusHeading'] === true,
    activationAdjusted:
      record['activationAdjusted'] === 'delivery_setup_required'
        ? 'delivery_setup_required'
        : null,
  };
}

function MessageDigestSourceStatus({
  availability,
  error,
  isRefreshing,
  onRefresh,
}: {
  availability: 'loading' | 'active' | 'missing' | 'unavailable';
  error: string | null;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
}): React.JSX.Element | null {
  if (availability === 'active' || availability === 'loading') return null;
  if (availability === 'missing') {
    return (
      <div
        role="status"
        aria-label="Private WhatsApp source status"
        className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            Private WhatsApp is not connected
          </p>
          <p className="mt-1">Reconnect the source account before resuming or running this digest.</p>
        </div>
        <Link
          to="/settings/whatsapp"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-amber-400 bg-white px-4 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 dark:bg-slate-900 dark:text-amber-100"
        >
          Open WhatsApp settings
        </Link>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-label="Private WhatsApp source status"
      className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          Private WhatsApp source status could not be confirmed
        </p>
        <p className="mt-1">
          {error === null
            ? 'Retry the status check before resuming or running this digest.'
            : 'The last status check failed. Retry before resuming or running this digest.'}
        </p>
      </div>
      <button
        type="button"
        disabled={isRefreshing}
        onClick={(): void => {
          void onRefresh();
        }}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 font-semibold text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-wait disabled:opacity-60 dark:border-red-800 dark:bg-slate-900 dark:text-red-200"
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-4 w-4 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        {isRefreshing ? 'Checking source…' : 'Retry source check'}
      </button>
    </div>
  );
}

function DefinitionStatus({
  definition,
}: {
  definition: MessageDigestDefinition;
}): React.JSX.Element {
  const status = definition.status === 'deleting' ? 'deleting' : definition.listStatus;
  const classes =
    status === 'active'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
      : status === 'needs_attention'
        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {status === 'active' ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {getMessageDigestStatusLabel(status)}
    </span>
  );
}

function ScheduleCard({ definition }: { definition: MessageDigestDefinition }): React.JSX.Element {
  return (
    <section
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="schedule-title"
    >
      <h2
        id="schedule-title"
        className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50"
      >
        <CalendarClock aria-hidden="true" className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        Schedule
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Cadence
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">
            {getMessageDigestScheduleLabel(definition.schedule)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Time zone
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
            {definition.schedule.timeZone}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Next scheduled run
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">
            {definition.status === 'paused' ? (
              'Paused — resume to schedule the next run'
            ) : definition.status === 'deleting' ? (
              'Deletion in progress'
            ) : definition.attentionCode === 'SOURCE_TOO_LARGE' ? (
              'Run now to retry retained window'
            ) : isMessageDigestSourceAttentionBlocker(definition.attentionCode) ? (
              'Source unavailable'
            ) : (
              <time dateTime={definition.nextRunAt}>
                {formatMessageDigestDateTime(definition.nextRunAt, definition.schedule.timeZone)}
              </time>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function InstructionsCard({
  instructions,
  copyResult,
  onCopy,
}: {
  instructions: string;
  copyResult: string | null;
  onCopy: () => Promise<void>;
}): React.JSX.Element {
  return (
    <section
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="instructions-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2
          id="instructions-title"
          className="text-lg font-semibold text-slate-950 dark:text-slate-50"
        >
          Summary instructions
        </h2>
        <button
          type="button"
          onClick={(): void => {
            void onCopy();
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          <Clipboard aria-hidden="true" className="h-4 w-4" />
          Copy instructions
        </button>
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
        {instructions}
      </p>
      {copyResult !== null ? (
        <p
          role="status"
          aria-label="Copy instructions result"
          className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"
        >
          {copyResult}
        </p>
      ) : null}
    </section>
  );
}

function LatestRunSection({
  definition,
  history,
}: {
  definition: MessageDigestDefinition;
  history: ReturnType<typeof useMessageDigestHistory>;
}): React.JSX.Element {
  if (history.isInitialLoading) {
    return (
      <div
        role="status"
        className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
      >
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
        Loading recent runs…
      </div>
    );
  }
  if (history.error !== null && history.items.length === 0) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
      >
        <p>{history.error}</p>
        <button
          type="button"
          onClick={(): void => {
            void history.refresh();
          }}
          className="mt-2 inline-flex min-h-11 items-center font-semibold underline"
        >
          Retry recent runs
        </button>
      </div>
    );
  }
  const latest = history.items[0];
  if (latest === undefined) {
    return (
      <section
        className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900"
        aria-labelledby="latest-run-title"
      >
        <Newspaper aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
        <h2
          id="latest-run-title"
          className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50"
        >
          No summaries yet
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Run this digest now or wait for its next scheduled boundary.
        </p>
      </section>
    );
  }
  return (
    <LatestRunContent
      definition={definition}
      initialRun={latest}
      recentRuns={history.items}
      pollError={history.refreshError}
    />
  );
}

function LatestRunContent({
  definition,
  initialRun,
  recentRuns,
  pollError,
}: {
  definition: MessageDigestDefinition;
  initialRun: MessageDigestRun;
  recentRuns: MessageDigestRun[];
  pollError: string | null;
}): React.JSX.Element {
  const live = useMessageDigestRun(definition.id, initialRun.id);
  const latest = live.run ?? initialRun;
  return (
    <section
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="latest-run-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="latest-run-title"
            className="text-lg font-semibold text-slate-950 dark:text-slate-50"
          >
            Latest summary
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Window ending{' '}
            <time dateTime={latest.window.end}>
              {formatMessageDigestDateTime(latest.window.end, latest.schedule.timeZone)}
            </time>
          </p>
        </div>
        <Link
          to={`/whatsapp/message-digests/${definition.id}/history/${latest.id}`}
          state={{ focusHeading: true }}
          className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          View latest result
        </Link>
      </div>
      <div className="mt-4">
        <MessageDigestRunStatus run={latest} />
      </div>
      {latest.content !== null ? (
        <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
          <p className="font-semibold text-slate-950 dark:text-slate-50">
            {latest.content.headline}
          </p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-400">
            {latest.content.summaryMarkdown}
          </p>
        </div>
      ) : null}
      {live.pollError !== null || pollError !== null ? (
        <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          Live status refresh is retrying. The last confirmed state remains visible.
        </p>
      ) : null}
      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Recent runs</h3>
        <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          {recentRuns.slice(0, 5).map((run) => (
            <li
              key={run.id}
              className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0 text-sm text-slate-600 dark:text-slate-400">
                <time dateTime={run.window.end}>
                  {formatMessageDigestDateTime(run.window.end, run.schedule.timeZone)}
                </time>
                {' · '}
                {run.effectiveMessageCount ?? '—'} messages
              </span>
              <Link
                to={`/whatsapp/message-digests/${definition.id}/history/${run.id}`}
                state={{ focusHeading: true }}
                className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300"
              >
                View result
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RunConfirmationDialog({
  open,
  returnFocusRef,
  preparation,
  isPreparing,
  isConfirming,
  isRecovering,
  hasPendingRecovery,
  recoveryDisabledReason,
  error,
  requiresReconfirmation,
  onClose,
  onRetryPreparation,
  onRetryRecovery,
  onConfirm,
}: {
  open: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  preparation: MessageDigestRunPreparation | null;
  isPreparing: boolean;
  isConfirming: boolean;
  isRecovering: boolean;
  hasPendingRecovery: boolean;
  recoveryDisabledReason: string | null;
  error: string | null;
  requiresReconfirmation: boolean;
  onClose: () => void;
  onRetryPreparation: () => Promise<void>;
  onRetryRecovery: () => Promise<void>;
  onConfirm: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen): void => {
        if (!nextOpen) onClose();
      }}
      title="Run and send this digest?"
      description="Review the exact server-calculated window before anything is generated."
      size="md"
      contentClassName="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800"
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-5">
        {(isPreparing || isRecovering) && preparation === null ? (
          <div
            role="status"
            className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />
            {isRecovering ? 'Recovering your existing run…' : 'Preparing the exact window…'}
          </div>
        ) : preparation !== null ? (
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-950">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Message window
              </p>
              <p className="mt-1 font-semibold text-slate-950 dark:text-slate-50">
                <time dateTime={preparation.window.start}>
                  {formatMessageDigestDateTime(
                    preparation.window.start,
                    preparation.window.timeZone
                  )}
                </time>
                {' — '}
                <time dateTime={preparation.window.end}>
                  {formatMessageDigestDateTime(preparation.window.end, preparation.window.timeZone)}
                </time>
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {preparation.window.timeZone}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Delivery
              </p>
              <p className="mt-1 font-semibold text-slate-950 dark:text-slate-50">
                {maskMessageDigestPrimaryNumber(preparation.deliveryReadiness.maskedPrimaryNumber)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Primary mapped WhatsApp number
              </p>
            </div>
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 leading-6 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
              This action generates, saves, and sends the digest. The source conversation remains
              unchanged.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            The run window could not be prepared.
          </div>
        )}

        {error !== null ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </p>
        ) : null}

        {hasPendingRecovery && recoveryDisabledReason !== null ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {recoveryDisabledReason}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isConfirming}
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          {preparation === null && !isPreparing && !isRecovering ? (
            <button
              type="button"
              disabled={hasPendingRecovery && recoveryDisabledReason !== null}
              onClick={(): void => {
                void (hasPendingRecovery ? onRetryRecovery() : onRetryPreparation());
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {hasPendingRecovery ? 'Retry run recovery' : 'Retry preparation'}
            </button>
          ) : (
            <button
              type="button"
              disabled={preparation === null || isPreparing || isConfirming}
              onClick={(): void => {
                void onConfirm();
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:focus:ring-offset-slate-800"
            >
              {isConfirming ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Play aria-hidden="true" className="h-4 w-4" />
              )}
              {isConfirming
                ? 'Starting…'
                : requiresReconfirmation
                  ? 'Confirm updated window'
                  : 'Run and send'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MessageDigestNotFound(): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Newspaper aria-hidden="true" className="h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
          Message Digest not found
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-400">
          This digest does not exist or is not available to this account.
        </p>
        <Link
          to="/whatsapp/message-digests"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Message Digests
        </Link>
      </section>
    </Layout>
  );
}

function MessageDigestLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-900 dark:bg-slate-900">
        <AlertTriangle aria-hidden="true" className="h-10 w-10 text-red-500" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
          Couldn’t load Message Digest
        </h1>
        <p
          role="alert"
          className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-400"
        >
          {message}
        </p>
        <button
          type="button"
          onClick={(): void => {
            void onRetry();
          }}
          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      </section>
    </Layout>
  );
}
