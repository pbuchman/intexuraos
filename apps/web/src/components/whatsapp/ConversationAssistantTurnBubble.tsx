import { Eye, LoaderCircle, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { MarkdownContent } from '@/components/MarkdownContent';
import type {
  ConversationAssistantTurn,
  ConversationAssistantTurnContextAttachmentSummary,
} from '@/types';
import { omittedContextLabel } from '@/utils/conversationAssistantAttachmentPresentation';
import {
  formatDateTime,
  formatDateTimeAccessible,
  formatDateTimeCompact,
} from '@/utils/dateFormat';

interface ConversationAssistantTurnBubbleProps {
  turn: ConversationAssistantTurn;
  assistantRoleLabel: string;
  displayTimeZone?: string;
  isStreaming: boolean;
  onViewContextAttachment: (attachmentId: string) => void;
  onRetryAnswer: (requestId: string) => void;
}

function correctionCount(attachment: ConversationAssistantTurnContextAttachmentSummary): number {
  return (
    attachment.counts.completedTranscriptions +
    attachment.counts.edited +
    attachment.counts.redacted +
    attachment.counts.reactionsChanged
  );
}

function ContextAttachmentSummary({
  attachment,
  onView,
  displayTimeZone,
}: {
  attachment: ConversationAssistantTurnContextAttachmentSummary;
  onView: () => void;
  displayTimeZone: string;
}): React.JSX.Element {
  const range = attachment.eventRange ?? attachment.captureRange;
  const corrections = correctionCount(attachment);
  const omissionLabel = omittedContextLabel(attachment.omitted);
  return (
    <section
      role="group"
      aria-label="WhatsApp context update attached to this question"
      className="mb-3 min-w-0 rounded-md border border-blue-200 bg-white/80 p-3 text-left shadow-sm dark:border-blue-800 dark:bg-slate-900/70"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
          <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
            WhatsApp context update
          </h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            {attachment.counts.included === 0 && corrections > 0
              ? `No new messages · ${formatCount(corrections, 'update')} to earlier context`
              : `${attachment.counts.included.toLocaleString('en-US')} included · ${attachment.counts.excluded.toLocaleString('en-US')} excluded`}
          </p>
          {attachment.counts.included > 0 && corrections > 0 ? (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatCount(corrections, 'update')} to earlier context
            </p>
          ) : null}
          {attachment.counts.included === 0 &&
          corrections > 0 &&
          attachment.counts.excluded > 0 ? (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {attachment.counts.excluded.toLocaleString('en-US')} excluded
            </p>
          ) : null}
          {corrections > 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {correctionBreakdownLabel(attachment)}
            </p>
          ) : null}
        </div>
      </div>
      <dl className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
        <div>
          <dt className="inline font-medium text-slate-700 dark:text-slate-200">
            {attachment.eventRange === undefined ? 'Checked: ' : 'Messages: '}
          </dt>
          <dd className="inline">
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
        <div>
          <dt className="inline font-medium text-slate-700 dark:text-slate-200">Captured: </dt>
          <dd className="inline">
            <time
              dateTime={attachment.capturedAt}
              aria-label={formatDateTimeAccessible(attachment.capturedAt, displayTimeZone)}
            >
              {formatDateTime(attachment.capturedAt, displayTimeZone)}
            </time>
          </dd>
        </div>
      </dl>
      {omissionLabel === null ? null : (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{omissionLabel}</p>
      )}
      <button
        type="button"
        onClick={onView}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
      >
        <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
        View messages
      </button>
    </section>
  );
}

function correctionBreakdownLabel(
  attachment: ConversationAssistantTurnContextAttachmentSummary
): string {
  const items = [
    [attachment.counts.completedTranscriptions, 'completed transcription'],
    [attachment.counts.edited, 'edit'],
    [attachment.counts.redacted, 'redaction'],
    [attachment.counts.reactionsChanged, 'reaction change'],
  ] as const;
  return items
    .filter(([count]) => count > 0)
    .map(([count, label]) => formatCount(count, label))
    .join(' · ');
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`;
}

export function ConversationAssistantTurnBubble({
  turn,
  assistantRoleLabel,
  displayTimeZone = 'UTC',
  isStreaming,
  onViewContextAttachment,
  onRetryAnswer,
}: ConversationAssistantTurnBubbleProps): React.JSX.Element {
  const isUser = turn.role === 'user';
  return (
    <article
      id={`conversation-assistant-turn-${turn.id}`}
      tabIndex={-1}
      className={`min-w-0 max-w-[min(46rem,100%)] rounded-lg border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        isUser
          ? 'ml-auto border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
          : 'mr-auto border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-2">
          {isUser ? 'You' : assistantRoleLabel}
          {isStreaming ? (
            <span aria-hidden="true" className="normal-case text-blue-600 dark:text-blue-400">
              Responding…
            </span>
          ) : null}
        </span>
        <time
          className="shrink-0"
          dateTime={turn.createdAt}
          aria-label={formatDateTimeAccessible(turn.createdAt, displayTimeZone)}
        >
          {formatDateTimeCompact(turn.createdAt, displayTimeZone)}
        </time>
      </div>
      {isUser && turn.contextAttachment !== undefined ? (
        <ContextAttachmentSummary
          attachment={turn.contextAttachment}
          displayTimeZone={displayTimeZone}
          onView={(): void => {
            onViewContextAttachment(turn.contextAttachment?.id ?? turn.contextAttachmentId ?? '');
          }}
        />
      ) : null}
      {turn.acknowledgment !== undefined ? (
        <p className="mb-3 rounded-md border-l-2 border-blue-500 bg-blue-50 px-3 py-2 text-sm leading-6 text-slate-800 dark:bg-blue-950/40 dark:text-slate-200">
          {turn.acknowledgment}
        </p>
      ) : null}
      {isUser ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
          {turn.text}
        </p>
      ) : (
        <div className="break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
          <MarkdownContent content={turn.text} />
        </div>
      )}
      {turn.error !== undefined ? (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">
          <p>{turnErrorLabel(turn.error.code)}</p>
          {turn.error.code === 'CONTEXT_WINDOW_EXCEEDED' ? (
            <p className="mt-2 text-sm">
              Start a new analysis with a smaller range to ask this question.
            </p>
          ) : null}
          {turn.requestId !== undefined && turn.canRetryAnswer === true ? (
            <button
              type="button"
              className="mt-2 inline-flex min-h-11 items-center rounded-md border border-red-300 px-3 py-2 text-sm font-semibold hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:hover:bg-red-950/40"
              onClick={(): void => {
                onRetryAnswer(turn.requestId ?? '');
              }}
            >
              <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              Try answer again
            </button>
          ) : null}
        </div>
      ) : null}
      {isStreaming ? (
        <LoaderCircle aria-hidden="true" className="mt-2 h-4 w-4 animate-spin text-blue-600" />
      ) : null}
    </article>
  );
}

function turnErrorLabel(code: string): string {
  if (code === 'CONTEXT_WINDOW_EXCEEDED') {
    return 'This question could not be answered because its context was too large.';
  }
  return 'The assistant could not complete this answer.';
}
