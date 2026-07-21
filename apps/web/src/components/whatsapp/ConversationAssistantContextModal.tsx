import { AlertCircle, LoaderCircle, MessageSquareText, X } from 'lucide-react';
import type { RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type {
  ConversationAssistantContextResponse,
  ConversationAssistantOmittedCounts,
} from '@/types';
import { formatDateTime, formatDateTimeAccessible } from '@/utils/dateFormat';

interface ConversationAssistantContextModalProps {
  context: ConversationAssistantContextResponse | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  expectedMessageCount: number;
  omitted: ConversationAssistantOmittedCounts;
  onRetry: () => void;
  onLoadMore: () => void;
  onClose: () => void;
  displayTimeZone?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

interface OmissionLabel {
  count: number;
  singular: string;
  plural: string;
}

function omissionLabels(omitted: ConversationAssistantOmittedCounts): OmissionLabel[] {
  return [
    { count: omitted.mediaOnly, singular: 'media-only message', plural: 'media-only messages' },
    {
      count: omitted.failedTranscriptions,
      singular: 'failed transcription',
      plural: 'failed transcriptions',
    },
    {
      count: omitted.pendingTranscriptions,
      singular: 'pending transcription',
      plural: 'pending transcriptions',
    },
    { count: omitted.nonText, singular: 'unsupported message', plural: 'unsupported messages' },
    {
      count: omitted.overLimit,
      singular: 'message over the context limit',
      plural: 'messages over the context limit',
    },
  ].filter((item) => item.count > 0);
}

function omissionReasonLabel(reason: string): string {
  switch (reason) {
    case 'media_only':
      return 'Media without usable text';
    case 'failed_transcription':
      return 'Transcription failed';
    case 'pending_transcription':
      return 'Transcription not ready';
    case 'over_limit':
      return 'Outside context limit';
    default:
      return 'Unsupported message type';
  }
}

export function ConversationAssistantContextModal({
  context,
  loading,
  loadingMore,
  error,
  expectedMessageCount,
  omitted,
  onRetry,
  onLoadMore,
  onClose,
  displayTimeZone = 'UTC',
  returnFocusRef,
}: ConversationAssistantContextModalProps): React.JSX.Element {
  const omittedLabels = omissionLabels(context?.omitted ?? omitted);

  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title="Frozen context"
      description="Messages captured when this analysis was prepared."
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <p aria-hidden="true" className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            Frozen context
          </p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Review what the model received and what was excluded.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close frozen context"
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              {expectedMessageCount.toLocaleString()} used
            </span>
            {omittedLabels.map((item) => (
              <span
                key={item.singular}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {item.count.toLocaleString()} {item.count === 1 ? item.singular : item.plural}
              </span>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-sm text-slate-500 dark:text-slate-400">
            <LoaderCircle className="mb-3 h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
            Loading frozen messages...
          </div>
        ) : null}

        {!loading && error !== null ? (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
            <Button type="button" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}

        {!loading && error === null && context?.snapshotAvailable === false ? (
          <div className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            The exact message list is unavailable for this older analysis. Its frozen transcript and
            omission counts are still unchanged.
          </div>
        ) : null}

        {!loading && error === null && context?.messages.length === 0 && context.snapshotAvailable ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center">
            <MessageSquareText className="h-6 w-6 text-slate-400" />
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              No messages were stored in this context.
            </p>
          </div>
        ) : null}

        {!loading && context !== null && context.messages.length > 0 ? (
          <section aria-labelledby="used-context-heading">
            <h2
              id="used-context-heading"
              className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:border-slate-800 dark:bg-slate-900 dark:text-emerald-300"
            >
              Used by the model
            </h2>
            <ol className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
              {context.messages.map((message) => (
                <li key={message.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {message.speakerLabel}
                    </span>
                    <time
                      className="shrink-0 text-xs text-slate-400 dark:text-slate-500"
                      dateTime={message.eventTimestamp}
                      aria-label={formatDateTimeAccessible(
                        message.eventTimestamp,
                        displayTimeZone
                      )}
                    >
                      {formatDateTime(message.eventTimestamp, displayTimeZone)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">
                    {message.content}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                    {message.contentKind === 'transcription' ? <span>Audio transcription</span> : null}
                    {message.reactions?.map((reaction) => (
                      <span key={reaction.id} title={reaction.senderDisplayName}>
                        {reaction.emoji}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!loading && context !== null && context.omittedMessages.length > 0 ? (
          <section aria-labelledby="omitted-context-heading">
            <h2
              id="omitted-context-heading"
              className="sticky top-0 z-10 border-y border-slate-100 bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
            >
              Excluded from the model
            </h2>
            <ol className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
              {context.omittedMessages.map((message) => (
                <li key={message.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {message.speakerLabel}
                    </span>
                    <time
                      className="shrink-0 text-xs text-slate-400 dark:text-slate-500"
                      dateTime={message.eventTimestamp}
                      aria-label={formatDateTimeAccessible(
                        message.eventTimestamp,
                        displayTimeZone
                      )}
                    >
                      {formatDateTime(message.eventTimestamp, displayTimeZone)}
                    </time>
                  </div>
                  <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {omissionReasonLabel(message.omissionReason)}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {message.content ??
                      (message.reaction === undefined
                        ? `${message.messageType} message`
                        : `Reaction ${message.reaction.emoji} to message ${message.reaction.targetReference ?? 'outside this snapshot'}`)}
                  </p>
                  {message.reactions !== undefined && message.reactions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {message.reactions.map((reaction) => (
                        <span
                          key={reaction.id}
                          className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800"
                          title={formatDateTime(reaction.eventTimestamp, displayTimeZone)}
                        >
                          {reaction.emoji}{' '}
                          {reaction.direction === 'outgoing'
                            ? 'You'
                            : (reaction.senderDisplayName ?? 'Unknown')}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!loading &&
        error === null &&
        context !== null &&
        (context.nextMessageCursor !== undefined || context.nextOmittedCursor !== undefined) ? (
          <div className="flex justify-center border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Load more messages
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
