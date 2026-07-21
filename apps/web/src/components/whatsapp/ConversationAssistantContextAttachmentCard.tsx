import {
  AlertTriangle,
  Check,
  Clock3,
  Eye,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  ConversationAssistantAttachmentDto,
  ConversationAssistantAttachmentState,
} from '@/utils/conversationAssistantAttachmentState';
import { omittedContextLabel } from '@/utils/conversationAssistantAttachmentPresentation';
import { formatDateTime, formatDateTimeAccessible } from '@/utils/dateFormat';

interface ConversationAssistantContextAttachmentCardProps {
  state: ConversationAssistantAttachmentState;
  warningAcknowledged: boolean;
  displayTimeZone?: string;
  recaptureAvailable?: boolean;
  disabled?: boolean;
  onViewMessages: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onKeepCurrent: () => void;
  onAcknowledgeWarning: () => void;
  onStartNewAnalysis: () => void;
}

const SECONDARY_ACTION_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900';
const PRIMARY_ACTION_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900';
const EMPTY_ATTACHMENT_COUNTS: NonNullable<ConversationAssistantAttachmentDto['counts']> = {
  included: 0,
  excluded: 0,
  completedTranscriptions: 0,
  edited: 0,
  redacted: 0,
  reactionsChanged: 0,
  lateIngested: 0,
};

export function ConversationAssistantContextAttachmentCard({
  state,
  warningAcknowledged,
  displayTimeZone = 'UTC',
  recaptureAvailable = true,
  disabled = false,
  onViewMessages,
  onRemove,
  onRetry,
  onRefresh,
  onKeepCurrent,
  onAcknowledgeWarning,
  onStartNewAnalysis,
}: ConversationAssistantContextAttachmentCardProps): React.JSX.Element | null {
  if (state.phase === 'idle') return null;

  if (state.phase === 'preparing_intent') {
    return (
      <section
        role="group"
        aria-label="WhatsApp context update"
        aria-busy="true"
        className="relative mx-3 mt-3 overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 shadow-sm dark:border-blue-900 dark:from-blue-950/35 dark:via-slate-900 dark:to-slate-900"
      >
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
        <div className="p-4 pl-5">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
            WhatsApp context update
          </h3>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-blue-600" />
            Freezing messages through a fixed point in time…
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            You can keep writing while messages are prepared.
          </p>
          <div className="mt-4 border-t border-blue-100 pt-3 dark:border-blue-900/70">
            <button
              type="button"
              className={SECONDARY_ACTION_CLASS}
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
              Remove
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === 'restoring') {
    return (
      <section
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="mx-3 mt-3 flex min-h-16 items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-slate-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-slate-200"
      >
        <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
        Restoring your question and attachment…
      </section>
    );
  }

  if (state.phase === 'restore_failed') {
    return (
      <section
        role="group"
        aria-label="WhatsApp context update"
        className="relative mx-3 mt-3 overflow-hidden rounded-lg border border-red-200 bg-white shadow-sm dark:border-red-900 dark:bg-slate-900"
      >
        <div className="p-4">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
            WhatsApp context update
          </h3>
          <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">
            {state.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-red-100 pt-3 dark:border-red-900/70">
            <button
              type="button"
              className={PRIMARY_ACTION_CLASS}
              disabled={disabled}
              onClick={onRetry}
            >
              <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              Try again
            </button>
            <button
              type="button"
              className={SECONDARY_ACTION_CLASS}
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
              Remove
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === 'missing') {
    return (
      <section
        role="group"
        aria-label="WhatsApp context update"
        className="relative mx-3 mt-3 overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm dark:border-amber-900 dark:bg-slate-900"
      >
        <div className="p-4">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
            WhatsApp context update
          </h3>
          <p role="alert" className="mt-2 text-sm text-amber-950 dark:text-amber-100">
            This saved WhatsApp context update is no longer available. Your question is safe.
          </p>
          <div className="mt-4 border-t border-amber-100 pt-3 dark:border-amber-900/70">
            <button
              type="button"
              className={SECONDARY_ACTION_CLASS}
              disabled={disabled}
              onClick={onRemove}
            >
              Discard missing update
            </button>
          </div>
        </div>
      </section>
    );
  }

  const { attachment } = state;
  const counts = attachment.counts;
  const correctionCount = countCorrections(attachment);
  const omissionLabel = omittedContextLabel(attachment.omitted);
  const hardLimit = state.phase === 'failed' && state.failure.blocking;
  const isPreparing = state.phase === 'preparing';

  return (
    <section
      role="group"
      aria-label="WhatsApp context update"
      aria-busy={isPreparing ? 'true' : undefined}
      className="relative mx-3 mt-3 overflow-hidden rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 shadow-sm dark:border-blue-900 dark:from-blue-950/35 dark:via-slate-900 dark:to-slate-900"
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
      <div className="p-4 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
              <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                WhatsApp context update
              </h3>
              {isPreparing || counts !== undefined ? (
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                  {summaryLabel(attachment, correctionCount, state.phase)}
                </p>
              ) : null}
              {counts !== undefined && counts.included > 0 && correctionCount > 0 ? (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {formatCount(correctionCount, 'update')} to earlier context
                </p>
              ) : null}
              {counts?.included === 0 &&
              correctionCount > 0 &&
              counts.excluded > 0 ? (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {counts.excluded.toLocaleString('en-US')} excluded
                </p>
              ) : null}
              {correctionCount > 0 ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {correctionBreakdownLabel(attachment)}
                </p>
              ) : null}
            </div>
          </div>
          {isPreparing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              Preparing
            </span>
          ) : null}
        </div>

        {isPreparing ? (
          <div className="mt-3 pl-12">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Preparing this update…
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              You can keep writing while messages are prepared.
            </p>
          </div>
        ) : (
          <SnapshotTiming attachment={attachment} displayTimeZone={displayTimeZone} />
        )}

        {!isPreparing && omissionLabel !== null ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{omissionLabel}</p>
        ) : null}

        {state.phase === 'ready' ? (
          <span role="status" aria-live="polite" className="sr-only">
            WhatsApp context update is ready.
          </span>
        ) : null}

        {state.phase === 'newer_available' ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100">
            <span role="status" aria-live="polite" className="sr-only">
              {newerContextLabel(attachment)}
            </span>
            <p>{newerContextLabel(attachment)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={PRIMARY_ACTION_CLASS}
                disabled={disabled || !recaptureAvailable}
                onClick={onRefresh}
              >
                <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
                Refresh attachment
              </button>
              <button
                type="button"
                className={SECONDARY_ACTION_CLASS}
                disabled={disabled}
                onClick={onKeepCurrent}
              >
                Keep current snapshot
              </button>
            </div>
          </div>
        ) : null}

        {attachment.requiresConfirmation && !warningAcknowledged && isReadyLike(state) ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {counts === undefined
                  ? 'This update is large. It may take longer and could fail.'
                  : `This update contains ${counts.included.toLocaleString('en-US')} messages. It may take longer and could fail.`}
              </p>
            </div>
            <button
              type="button"
              className={`${PRIMARY_ACTION_CLASS} mt-3`}
              disabled={disabled}
              onClick={onAcknowledgeWarning}
            >
              <Check aria-hidden="true" className="mr-2 h-4 w-4" />
              Continue with this snapshot
            </button>
          </div>
        ) : null}

        {state.phase === 'failed' ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/35 dark:text-red-100"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {hardLimit
                  ? 'This update is too large to include in one question. Your question remains here.'
                  : state.failure.message}
              </p>
            </div>
          </div>
        ) : null}

        {state.phase === 'expired' || state.phase === 'stale' ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {state.phase === 'expired'
                  ? 'This attachment expired before it was sent. Your question is safe.'
                  : 'This analysis was updated in another tab. Your question is safe.'}
              </p>
            </div>
          </div>
        ) : null}

        {state.phase === 'consumed_elsewhere' ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>This update was already used in another tab. Your question is safe.</p>
            </div>
          </div>
        ) : null}

        {state.phase === 'recapture_required' ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This update could not be attached. Capture it again before sending. Your question
                is safe.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-blue-100 pt-3 dark:border-blue-900/70">
          {state.phase === 'consumed_elsewhere' ? (
            <button
              type="button"
              className={SECONDARY_ACTION_CLASS}
              disabled={disabled}
              onClick={onRemove}
            >
              Continue without this update
            </button>
          ) : hardLimit ? (
            <>
              <button
                type="button"
                className={SECONDARY_ACTION_CLASS}
                disabled={disabled}
                onClick={onRemove}
              >
                <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
                Remove attachment
              </button>
              <button
                type="button"
                className={PRIMARY_ACTION_CLASS}
                aria-label="Start a new analysis (opens in a new tab)"
                disabled={disabled}
                onClick={onStartNewAnalysis}
              >
                Start a new analysis
              </button>
            </>
          ) : (
            <>
              {state.phase === 'ready' || state.phase === 'newer_available' ? (
                <button
                  type="button"
                  className={SECONDARY_ACTION_CLASS}
                  disabled={disabled}
                  onClick={onViewMessages}
                >
                  <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
                  View messages
                </button>
              ) : null}
              {state.phase === 'failed' ? (
                <button
                  type="button"
                  className={PRIMARY_ACTION_CLASS}
                  disabled={disabled || !recaptureAvailable}
                  onClick={onRetry}
                >
                  <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
                  Try again
                </button>
              ) : null}
              {state.phase === 'expired' ||
              state.phase === 'stale' ||
              state.phase === 'recapture_required' ? (
                <button
                  type="button"
                  className={PRIMARY_ACTION_CLASS}
                  disabled={disabled || !recaptureAvailable}
                  onClick={onRefresh}
                >
                  <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
                  Capture again
                </button>
              ) : null}
              <button
                type="button"
                className={SECONDARY_ACTION_CLASS}
                disabled={disabled}
                onClick={onRemove}
              >
                <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
                Remove
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SnapshotTiming({
  attachment,
  displayTimeZone,
}: {
  attachment: ConversationAssistantAttachmentDto;
  displayTimeZone: string;
}): React.JSX.Element {
  const range = attachment.eventRange ?? attachment.captureRange;
  return (
    <dl className="relative mt-4 grid gap-3 pl-5 text-xs text-slate-600 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-blue-200 dark:text-slate-300 dark:before:bg-blue-800 sm:grid-cols-2 sm:gap-4 sm:pl-0 sm:before:hidden">
      {range === undefined ? null : (
        <div className="relative before:absolute before:-left-5 before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-blue-500 before:bg-white dark:before:bg-slate-900 sm:before:hidden">
          <dt className="sr-only">
            {attachment.eventRange === undefined ? 'Checked range' : 'Message range'}
          </dt>
          <dd>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {attachment.eventRange === undefined ? 'Checked:' : 'Messages:'}
            </span>{' '}
            <time
              dateTime={range.from}
              aria-label={formatDateTimeAccessible(range.from, displayTimeZone)}
            >
              {formatDateTime(range.from, displayTimeZone)}
            </time>
            {' → '}
            <time
              dateTime={range.to}
              aria-label={formatDateTimeAccessible(range.to, displayTimeZone)}
            >
              {formatDateTime(range.to, displayTimeZone)}
            </time>
          </dd>
        </div>
      )}
      <div className="relative before:absolute before:-left-5 before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-blue-500 before:bg-white dark:before:bg-slate-900 sm:before:hidden">
        <dt className="sr-only">Snapshot capture cutoff</dt>
        <dd className="flex items-start gap-1.5 sm:justify-end">
          <Clock3 aria-hidden="true" className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 sm:block" />
          <span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Snapshot captured:
            </span>{' '}
            <time
              dateTime={attachment.capturedAt}
              aria-label={formatDateTimeAccessible(attachment.capturedAt, displayTimeZone)}
            >
              {formatDateTime(attachment.capturedAt, displayTimeZone)}
            </time>
          </span>
        </dd>
      </div>
    </dl>
  );
}

function countCorrections(attachment: ConversationAssistantAttachmentDto): number {
  const counts = attachment.counts ?? EMPTY_ATTACHMENT_COUNTS;
  return (
    counts.completedTranscriptions +
    counts.edited +
    normalizedRedactionCount(counts) +
    counts.reactionsChanged
  );
}

function correctionBreakdownLabel(
  attachment: ConversationAssistantAttachmentDto
): string {
  const counts = attachment.counts ?? EMPTY_ATTACHMENT_COUNTS;
  const items = [
    [counts.completedTranscriptions, 'completed transcription'],
    [counts.edited, 'edit'],
    [normalizedRedactionCount(counts), 'redaction'],
    [counts.reactionsChanged, 'reaction change'],
  ] as const;
  return items
    .filter(([count]) => count > 0)
    .map(([count, label]) => formatCount(count, label))
    .join(' · ');
}

function normalizedRedactionCount(counts: { redacted: number }): number {
  return counts.redacted;
}

function summaryLabel(
  attachment: ConversationAssistantAttachmentDto,
  correctionCount: number,
  phase: ConversationAssistantAttachmentState['phase']
): string {
  if (phase === 'preparing') return 'Capturing messages through a fixed point in time';
  const counts = attachment.counts ?? EMPTY_ATTACHMENT_COUNTS;
  if (counts.included === 0 && correctionCount > 0) {
    return `No new messages · ${formatCount(correctionCount, 'update')} to earlier context`;
  }
  return `${counts.included.toLocaleString('en-US')} included · ${counts.excluded.toLocaleString('en-US')} excluded`;
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`;
}

function newerContextLabel(attachment: ConversationAssistantAttachmentDto): string {
  const messages = attachment.newerAvailableCount;
  const corrections = attachment.newerAvailableCorrectionCount;
  if (messages > 0 && corrections > 0) {
    return `${formatCount(messages, 'newer message')} and ${formatCount(corrections, 'newer update')} arrived after this snapshot.`;
  }
  if (messages > 0) {
    return `${formatCount(messages, 'newer message')} arrived after this snapshot.`;
  }
  return `${formatCount(corrections, 'newer update')} arrived after this snapshot.`;
}

function isReadyLike(state: ConversationAssistantAttachmentState): boolean {
  return state.phase === 'ready' || state.phase === 'newer_available';
}
