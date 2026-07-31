import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  Clock3,
  LoaderCircle,
  MessageCircleMore,
  Newspaper,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { MessageDigestMarkdown } from '@/components/message-digests/MessageDigestMarkdown';
import { MessageDigestPageLoading } from '@/components/message-digests/MessageDigestPageLoading';
import { MessageDigestRunStatus } from '@/components/message-digests/MessageDigestRunStatus';
import { Modal } from '@/components/ui/Modal';
import { useMessageDigestDefinition, useMessageDigestRun } from '@/hooks/useMessageDigests';
import type { MessageDigestRun } from '@/types/messageDigests';
import {
  formatMessageDigestDateTime,
  getMessageDigestScheduleLabel,
} from '@/types/messageDigests';

export function WhatsAppMessageDigestRunPage(): React.JSX.Element {
  const { definitionId = '', runId = '' } = useParams<{
    definitionId: string;
    runId: string;
  }>();
  const location = useLocation();
  const definition = useMessageDigestDefinition(definitionId);
  const runState = useMessageDigestRun(definitionId, runId);
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const [retryDialogStage, setRetryDialogStage] = useState<'generation' | 'delivery' | null>(null);
  const [retrySubmitting, setRetrySubmitting] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const retryTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (
      !hasHeadingFocusIntent(location.state) ||
      definition.definition === null ||
      runState.run === null
    ) {
      return;
    }
    headingRef.current?.focus();
  }, [definition.definition, location.state, runState.run]);

  if (definition.isLoading || runState.isInitialLoading) {
    return <MessageDigestPageLoading title="Message Digest Run" />;
  }
  if (definitionId === '' || runId === '' || definition.isNotFound || runState.isNotFound) {
    return <MessageDigestRunNotFound definitionId={definitionId} />;
  }
  if (definition.definition === null) {
    return (
      <MessageDigestRunLoadError
        title="Couldn’t load Message Digest"
        message={definition.error ?? 'Message Digest is temporarily unavailable.'}
        onRetry={definition.refresh}
      />
    );
  }
  if (runState.run === null) {
    return (
      <MessageDigestRunLoadError
        title="Couldn’t load Message Digest run"
        message={runState.error ?? 'Message Digest run is temporarily unavailable.'}
        onRetry={(): Promise<void> => {
          runState.refresh();
          return Promise.resolve();
        }}
      />
    );
  }

  const definitionValue = definition.definition;
  const run = runState.run;
  const retryPending = retrySubmitting || runState.isRetrying;
  const copyDigest = async (): Promise<void> => {
    if (run.content === null) return;
    const visibleSummary = summaryRef.current?.innerText ?? summaryRef.current?.textContent ?? '';
    const renderedText = `${run.content.headline}\n\n${visibleSummary}`.trim();
    try {
      await navigator.clipboard.writeText(renderedText);
      setCopyResult('Digest copied');
    } catch {
      setCopyResult('Couldn’t copy digest');
    }
  };
  const openRetryDialog = (): void => {
    if (runState.retryStage === null) return;
    runState.clearRetryError();
    setRetryResult(null);
    setRetryDialogStage(runState.retryStage);
  };
  const confirmRetry = async (): Promise<void> => {
    if (retryDialogStage === null || retryPending) return;
    setRetrySubmitting(true);
    setRetryResult(null);
    try {
      const response = await runState.retryRun();
      if (response === null) return;
      setRetryDialogStage(null);
      setRetryResult(
        response.stage === 'generation'
          ? 'Summary generation restarted for this run.'
          : 'WhatsApp delivery restarted for this run.'
      );
    } finally {
      setRetrySubmitting(false);
    }
  };

  return (
    <Layout>
      <article
        className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6"
        aria-labelledby="page-title"
      >
        <header className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <Link
            to={`/whatsapp/message-digests/${definitionId}/history`}
            state={{ focusHeading: true }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-slate-600 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:text-slate-50"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to history
          </Link>
          <div className="mt-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                <Newspaper aria-hidden="true" className="h-4 w-4" />
                Message Digest result
              </p>
              <h1
                ref={headingRef}
                id="page-title"
                tabIndex={-1}
                className="mt-1 break-words text-2xl font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-50"
              >
                {definitionValue.name}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {run.trigger === 'manual' ? 'Manual run' : 'Scheduled run'} ·{' '}
                {run.schedule.timeZone}
              </p>
            </div>
            {runState.isPolling ? (
              <p
                role="status"
                aria-label="Run updates"
                aria-live="polite"
                className="flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                />
                Status updates automatically
              </p>
            ) : null}
          </div>
        </header>

        <section
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          aria-labelledby="run-window-title"
        >
          <h2
            id="run-window-title"
            className="text-lg font-semibold text-slate-950 dark:text-slate-50"
          >
            Source window
          </h2>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-3">
            <SnapshotValue label="From">
              <time dateTime={run.window.start}>
                {formatMessageDigestDateTime(run.window.start, run.schedule.timeZone)}
              </time>
            </SnapshotValue>
            <SnapshotValue label="To">
              <time dateTime={run.window.end}>
                {formatMessageDigestDateTime(run.window.end, run.schedule.timeZone)}
              </time>
            </SnapshotValue>
            <SnapshotValue label="Source">
              <span className="flex items-center gap-1.5">
                <MessageCircleMore aria-hidden="true" className="h-4 w-4" />
                {run.source.displayName}
              </span>
            </SnapshotValue>
          </div>
          <div className="mt-5">
            <MessageDigestRunStatus run={run} />
          </div>
          {runState.pollError !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {runState.pollError}. The last confirmed state remains visible and refresh will retry.
            </p>
          ) : null}
          {runState.retryStage !== null ? (
            <button
              ref={retryTriggerRef}
              type="button"
              disabled={retryPending}
              onClick={openRetryDialog}
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:focus:ring-offset-slate-900"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${retryPending ? 'animate-spin motion-reduce:animate-none' : ''}`}
              />
              {runState.retryStage === 'generation' ? 'Retry run' : 'Retry delivery'}
            </button>
          ) : null}
        </section>

        {run.delivery.status === 'ambiguous' ? (
          <section
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <h2 className="flex items-center gap-2 font-semibold">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              Send status needs review
            </h2>
            <p className="mt-2 text-sm leading-6">
              WhatsApp may already have this digest. Automatic retry is disabled to prevent a
              duplicate message.
            </p>
          </section>
        ) : null}

        {retryResult !== null ? (
          <p
            role="status"
            aria-label="Retry run result"
            aria-live="polite"
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            {retryResult}
          </p>
        ) : null}

        {run.content !== null ? (
          <section
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
            aria-labelledby="digest-output-title"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  Generated summary
                </p>
                <h2
                  id="digest-output-title"
                  className="mt-1 break-words text-xl font-bold text-slate-950 dark:text-slate-50"
                >
                  {run.content.headline}
                </h2>
              </div>
              <button
                type="button"
                onClick={(): void => {
                  void copyDigest();
                }}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Clipboard aria-hidden="true" className="h-4 w-4" />
                Copy digest
              </button>
            </div>
            <MessageDigestMarkdown
              containerRef={summaryRef}
              markdown={run.content.summaryMarkdown}
              className="prose prose-slate mt-5 max-w-none break-words text-slate-700 dark:prose-invert dark:text-slate-300"
            />
            {copyResult !== null ? (
              <p
                role="status"
                aria-label="Copy digest result"
                className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
              >
                {copyResult}
              </p>
            ) : null}
          </section>
        ) : run.generationStatus === 'skipped_no_activity' ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
            <CheckCircle2
              aria-hidden="true"
              className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400"
            />
            <h2 className="mt-3 text-lg font-semibold text-emerald-950 dark:text-emerald-100">
              No new messages in this window
            </h2>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
              The run completed successfully and no WhatsApp summary was sent.
            </p>
          </section>
        ) : run.generationStatus === 'failed' ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/30">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-red-900 dark:text-red-100">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              Summary generation failed
            </h2>
            <p className="mt-2 text-sm text-red-800 dark:text-red-200">
              No summary content was produced. The immutable run remains in history for safe
              diagnosis.
            </p>
          </section>
        ) : (
          <section
            role="status"
            className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          >
            <LoaderCircle
              aria-hidden="true"
              className="h-5 w-5 animate-spin motion-reduce:animate-none"
            />
            Summary content is being generated…
          </section>
        )}

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <ConfigurationSnapshot run={run} />
          <DeliveryTimeline run={run} />
        </div>

        <TechnicalDetails run={run} />

        <MessageDigestRunRetryDialog
          run={run}
          stage={retryDialogStage}
          pending={retryPending}
          error={runState.retryError}
          returnFocusRef={retryTriggerRef}
          onCancel={(): void => {
            if (retryPending) return;
            runState.clearRetryError();
            setRetryDialogStage(null);
          }}
          onConfirm={confirmRetry}
        />
      </article>
    </Layout>
  );
}

function hasHeadingFocusIntent(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)['focusHeading'] === true
  );
}

function SnapshotValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
        {children}
      </div>
    </div>
  );
}

function ConfigurationSnapshot({ run }: { run: MessageDigestRun }): React.JSX.Element {
  const [copyResult, setCopyResult] = useState<string | null>(null);
  const copyInstructions = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(run.instructions.text);
      setCopyResult('Instructions copied');
    } catch {
      setCopyResult('Couldn’t copy instructions');
    }
  };
  return (
    <section
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="configuration-title"
    >
      <h2
        id="configuration-title"
        className="text-lg font-semibold text-slate-950 dark:text-slate-50"
      >
        Configuration snapshot
      </h2>
      <dl className="mt-4 grid gap-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Source activity
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">
            {run.effectiveMessageCount === null
              ? 'Still counting messages'
              : `${String(run.effectiveMessageCount)} messages`}
          </dd>
        </div>
        <div>
          <dt className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Instructions used
            </span>
            <button
              type="button"
              onClick={(): void => {
                void copyInstructions();
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Clipboard aria-hidden="true" className="h-4 w-4" />
              Copy instructions
            </button>
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
            {run.instructions.text}
          </dd>
          {copyResult !== null ? (
            <dd
              role="status"
              aria-label="Copy instructions result"
              aria-live="polite"
              className={`mt-2 text-sm font-semibold ${copyResult === 'Instructions copied' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}
            >
              {copyResult}
            </dd>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Schedule
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">
              {getMessageDigestScheduleLabel(run.schedule)}
              <br />
              {run.schedule.timeZone}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Definition revision
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">
              {String(run.definitionRevision)}
            </dd>
          </div>
        </div>
        {run.model !== null || run.promptVersion !== null ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Model
              </dt>
              <dd className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
                {run.model ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Prompt version
              </dt>
              <dd className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
                {run.promptVersion ?? '—'}
              </dd>
            </div>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function MessageDigestRunRetryDialog({
  run,
  stage,
  pending,
  error,
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  run: MessageDigestRun;
  stage: 'generation' | 'delivery' | null;
  pending: boolean;
  error: string | null;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}): React.JSX.Element {
  const generation = stage === 'generation';
  const actionLabel = generation ? 'Retry run' : 'Retry delivery';
  return (
    <Modal
      open={stage !== null}
      onOpenChange={(open): void => {
        if (!open) onCancel();
      }}
      title={generation ? 'Retry summary generation?' : 'Retry WhatsApp delivery?'}
      description="No replacement run or source window will be created."
      contentClassName="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800"
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-5">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          {generation ? (
            <p>
              This retries the same run, message window, and configuration snapshot. It does not
              move the digest checkpoint.
            </p>
          ) : (
            <p>
              This resends the exact saved message and delivery identity after a definitive safe
              failure. It does not regenerate the summary.
            </p>
          )}
          <p className="mt-3 border-t border-blue-200 pt-3 text-xs font-semibold dark:border-blue-800">
            Source window: {formatMessageDigestDateTime(run.window.start, run.schedule.timeZone)} →{' '}
            {formatMessageDigestDateTime(run.window.end, run.schedule.timeZone)}
          </p>
        </div>
        {error !== null ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={(): void => {
              void onConfirm();
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:focus:ring-offset-slate-800"
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            )}
            {pending ? 'Retrying…' : actionLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeliveryTimeline({ run }: { run: MessageDigestRun }): React.JSX.Element {
  const skippedNoActivity = run.generationStatus === 'skipped_no_activity';
  const generated = run.generationStatus === 'completed';
  const queued = generated && run.delivery.status !== 'not_sent';
  const deliveryLabel =
    run.delivery.status === 'sent'
      ? 'Sent'
      : run.delivery.status === 'failed'
        ? 'Failed'
        : run.delivery.status === 'ambiguous'
          ? 'Send status needs review'
          : run.delivery.status === 'pending'
            ? 'Pending'
            : 'Not sent';
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-labelledby="delivery-timeline-title"
    >
      <h2
        id="delivery-timeline-title"
        className="text-lg font-semibold text-slate-950 dark:text-slate-50"
      >
        Delivery timeline
      </h2>
      <ol className="mt-4 grid gap-4">
        {skippedNoActivity ? (
          <>
            <TimelineItem
              complete
              icon={<Newspaper aria-hidden="true" className="h-4 w-4" />}
              title="No activity — generation not needed"
              detail={
                run.completedAt === null
                  ? 'Source window checked'
                  : formatMessageDigestDateTime(run.completedAt, run.schedule.timeZone)
              }
            />
            <TimelineItem
              complete
              icon={<Send aria-hidden="true" className="h-4 w-4" />}
              title="WhatsApp delivery was not needed"
              detail="No summary was queued or sent."
            />
          </>
        ) : (
          <>
            <TimelineItem
              complete={generated}
              icon={<Newspaper aria-hidden="true" className="h-4 w-4" />}
              title="Generated"
              detail={
                run.completedAt === null
                  ? 'Waiting for summary content'
                  : formatMessageDigestDateTime(run.completedAt, run.schedule.timeZone)
              }
            />
            <TimelineItem
              complete={queued}
              icon={<Send aria-hidden="true" className="h-4 w-4" />}
              title="Queued for WhatsApp"
              detail={queued ? 'Primary mapped number' : 'Not queued'}
            />
            <TimelineItem
              complete={run.delivery.status === 'sent'}
              warning={run.delivery.status === 'failed' || run.delivery.status === 'ambiguous'}
              icon={<Clock3 aria-hidden="true" className="h-4 w-4" />}
              title={deliveryLabel}
              detail={
                run.delivery.acceptedAt === null
                  ? run.delivery.failedAt === null
                    ? 'No confirmed provider receipt'
                    : formatMessageDigestDateTime(run.delivery.failedAt, run.schedule.timeZone)
                  : formatMessageDigestDateTime(run.delivery.acceptedAt, run.schedule.timeZone)
              }
            />
          </>
        )}
      </ol>
    </section>
  );
}

function TimelineItem({
  complete,
  warning = false,
  icon,
  title,
  detail,
}: {
  complete: boolean;
  warning?: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 gap-3">
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${warning ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : complete ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-slate-950 dark:text-slate-50">{title}</p>
        <p className="mt-0.5 break-words text-sm text-slate-600 dark:text-slate-400">{detail}</p>
      </div>
    </li>
  );
}

function TechnicalDetails({ run }: { run: MessageDigestRun }): React.JSX.Element {
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-200">
        Technical details
      </summary>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Run ID</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">
            {run.id}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Trigger</dt>
          <dd className="mt-1 text-slate-800 dark:text-slate-200">{run.trigger}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Attempts</dt>
          <dd className="mt-1 text-slate-800 dark:text-slate-200">{String(run.attempts)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Last updated</dt>
          <dd className="mt-1 text-slate-800 dark:text-slate-200">
            <time dateTime={run.updatedAt}>
              {formatMessageDigestDateTime(run.updatedAt, run.schedule.timeZone)}
            </time>
          </dd>
        </div>
        {run.safeFailureCode !== null ? (
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Safe failure code</dt>
            <dd className="mt-1 break-words text-slate-800 dark:text-slate-200">
              {run.safeFailureCode}
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function MessageDigestRunNotFound({ definitionId }: { definitionId: string }): React.JSX.Element {
  const historyPath =
    definitionId === ''
      ? '/whatsapp/message-digests'
      : `/whatsapp/message-digests/${definitionId}/history`;
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <Newspaper aria-hidden="true" className="h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">
          Message Digest run not found
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          This run does not exist or is not available to this account.
        </p>
        <Link
          to={historyPath}
          className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
        >
          Back to history
        </Link>
      </section>
    </Layout>
  );
}

function MessageDigestRunLoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Layout>
      <section className="mx-auto flex min-h-80 w-full max-w-3xl flex-col items-center justify-center rounded-xl border border-red-200 bg-white p-8 text-center dark:border-red-900 dark:bg-slate-900">
        <AlertTriangle aria-hidden="true" className="h-10 w-10 text-red-500" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950 dark:text-slate-50">{title}</h1>
        <p role="alert" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {message}
        </p>
        <button
          type="button"
          onClick={(): void => {
            void onRetry();
          }}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      </section>
    </Layout>
  );
}
