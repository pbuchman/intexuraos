import { ArrowLeft, Clock3, Eye, LoaderCircle, MessageSquareText, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Modal } from '@/components/ui/Modal';
import type {
  ConversationAssistantContextAttachmentPreviewItem,
  ConversationAssistantContextAttachmentPreviewReaction,
  ConversationAssistantContextAttachmentPreviewResponse,
  ConversationAssistantContextCorrectionProjection,
  ConversationAssistantContextHistoryResponse,
} from '@/types';
import { omittedContextLabel } from '@/utils/conversationAssistantAttachmentPresentation';
import { formatDateTime, formatDateTimeAccessible } from '@/utils/dateFormat';

type ContextViewerMode =
  | { kind: 'history' }
  | { kind: 'attachment'; attachmentId: string };

interface ConversationAssistantContextViewerModalProps {
  mode: ContextViewerMode;
  loadHistory: () => Promise<ConversationAssistantContextHistoryResponse | null>;
  loadPreview: (
    attachmentId: string,
    cursor?: string
  ) => Promise<ConversationAssistantContextAttachmentPreviewResponse | null>;
  onViewInitial: () => void;
  onJumpToTurn: (turnId: string) => void;
  onClose: () => void;
  displayTimeZone?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ConversationAssistantContextViewerModal({
  mode,
  loadHistory,
  loadPreview,
  onViewInitial,
  onJumpToTurn,
  onClose,
  displayTimeZone = 'UTC',
  returnFocusRef,
}: ConversationAssistantContextViewerModalProps): React.JSX.Element {
  const [view, setView] = useState<ContextViewerMode>(mode);
  const [history, setHistory] = useState<ConversationAssistantContextHistoryResponse | null>(null);
  const [items, setItems] = useState<ConversationAssistantContextAttachmentPreviewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyReturnAttachmentIdRef = useRef<string | undefined>(undefined);

  const requestHistory = useCallback(async (): Promise<void> => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setLoading(true);
    setError(null);
    const response = await loadHistory();
    if (requestGenerationRef.current !== requestGeneration) return;
    if (response === null) {
      setError('Conversation context history could not be loaded.');
    } else {
      setHistory(response);
    }
    setLoading(false);
  }, [loadHistory]);

  const requestPreview = useCallback(
    async (attachmentId: string, cursor?: string): Promise<void> => {
      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      if (cursor === undefined) {
        setLoading(true);
        setItems([]);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      const response = await loadPreview(attachmentId, cursor);
      if (requestGenerationRef.current !== requestGeneration) return;
      if (response === null) {
        setError('This WhatsApp context update could not be loaded.');
      } else {
        setItems((current) => (cursor === undefined ? response.items : [...current, ...response.items]));
        setNextCursor(response.nextCursor);
      }
      setLoading(false);
      setLoadingMore(false);
    },
    [loadPreview]
  );

  useEffect(() => {
    setView(mode);
    setHistory(null);
    setItems([]);
    setNextCursor(undefined);
    if (mode.kind === 'history') {
      void requestHistory();
    } else {
      void requestPreview(mode.attachmentId);
    }
  }, [mode, requestHistory, requestPreview]);

  useEffect(() => {
    if (view.kind === 'attachment' && history !== null && !loading) {
      backButtonRef.current?.focus();
      return;
    }
    if (view.kind !== 'history') return;
    const attachmentId = historyReturnAttachmentIdRef.current;
    if (attachmentId === undefined) return;
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-context-attachment-id]')
    ).find((element) => element.dataset['contextAttachmentId'] === attachmentId);
    historyReturnAttachmentIdRef.current = undefined;
    trigger?.focus();
  }, [history, loading, view]);

  const title = view.kind === 'history' ? 'Conversation context' : 'WhatsApp context update';
  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={title}
      description="Review immutable context snapshots used in this analysis."
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
      hideTitle
      padded={false}
      contentClassName="fixed bottom-0 left-0 right-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top))] flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-slate-900 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-5">
        <div className="flex min-w-0 items-start gap-2">
          {view.kind === 'attachment' && history !== null ? (
            <button
              ref={backButtonRef}
              type="button"
              aria-label="Back to context history"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800"
              onClick={(): void => {
                requestGenerationRef.current += 1;
                setView({ kind: 'history' });
                setLoading(false);
                setLoadingMore(false);
                setNextCursor(undefined);
                setError(null);
              }}
            >
              <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {view.kind === 'history'
                ? 'Initial snapshot and every update stay linked to this analysis.'
                : 'This is the exact frozen update attached to the question.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
        {loading ? (
          <div role="status" aria-live="polite" className="flex min-h-52 items-center justify-center gap-2 text-sm text-slate-500">
            <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-blue-600" />
            Loading conversation context…
          </div>
        ) : null}
        {!loading && error !== null ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <p>{error}</p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-md bg-red-700 px-3 py-2 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              onClick={(): void => {
                if (view.kind === 'history') void requestHistory();
                else void requestPreview(view.attachmentId);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        {!loading && error === null && view.kind === 'history' && history !== null ? (
          <ContextHistory
            history={history}
            displayTimeZone={displayTimeZone}
            onViewInitial={onViewInitial}
            onViewAttachment={(attachmentId): void => {
              historyReturnAttachmentIdRef.current = attachmentId;
              setView({ kind: 'attachment', attachmentId });
              void requestPreview(attachmentId);
            }}
            onJumpToTurn={onJumpToTurn}
          />
        ) : null}
        {!loading && error === null && view.kind === 'attachment' ? (
          <ContextPreview items={items} displayTimeZone={displayTimeZone} />
        ) : null}
        {!loading && error === null && view.kind === 'attachment' && nextCursor !== undefined ? (
          <div className="mt-4 flex justify-center border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              disabled={loadingMore}
              className="inline-flex min-h-11 items-center rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100"
              onClick={(): void => {
                void requestPreview(view.attachmentId, nextCursor);
              }}
            >
              {loadingMore ? <LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null}
              Load more messages
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ContextHistory({
  history,
  onViewInitial,
  onViewAttachment,
  onJumpToTurn,
  displayTimeZone,
}: {
  history: ConversationAssistantContextHistoryResponse;
  onViewInitial: () => void;
  onViewAttachment: (attachmentId: string) => void;
  onJumpToTurn: (turnId: string) => void;
  displayTimeZone: string;
}): React.JSX.Element {
  return (
    <ol className="space-y-3">
      {history.snapshots.map((snapshot) => {
        const label = snapshot.kind === 'initial' ? 'Initial snapshot' : `Update ${String(snapshot.contextVersion)}`;
        const range = snapshot.eventRange ?? snapshot.captureRange;
        const omissionLabel = omittedContextLabel(snapshot.omitted);
        return (
          <li key={`${snapshot.kind}-${String(snapshot.contextVersion)}`} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                {snapshot.kind === 'initial' ? <Clock3 aria-hidden="true" className="h-4 w-4" /> : <MessageSquareText aria-hidden="true" className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-950 dark:text-slate-50">{label}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {snapshot.messageCount === 0 && snapshot.correctionCount > 0
                    ? `No new messages · ${formatCount(snapshot.correctionCount, 'update')} to earlier context`
                    : `${snapshot.messageCount.toLocaleString('en-US')} included · ${snapshot.excludedCount.toLocaleString('en-US')} excluded`}
                </p>
                {snapshot.messageCount > 0 && snapshot.correctionCount > 0 ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formatCount(snapshot.correctionCount, 'update')} to earlier context
                  </p>
                ) : null}
                {snapshot.messageCount === 0 &&
                snapshot.correctionCount > 0 &&
                snapshot.excludedCount > 0 ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {snapshot.excludedCount.toLocaleString('en-US')} excluded
                  </p>
                ) : null}
                {range === undefined ? null : (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {snapshot.eventRange === undefined ? 'Checked:' : 'Messages:'}
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
                  </div>
                )}
                <time
                  className="mt-1 block text-xs text-slate-500"
                  dateTime={snapshot.capturedAt}
                  aria-label={formatDateTimeAccessible(snapshot.capturedAt, displayTimeZone)}
                >
                  Captured {formatDateTime(snapshot.capturedAt, displayTimeZone)}
                </time>
                {omissionLabel === null ? null : (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {omissionLabel}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    {...(snapshot.attachmentId === undefined
                      ? {}
                      : { 'data-context-attachment-id': snapshot.attachmentId })}
                    className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700"
                    aria-label={snapshot.kind === 'initial' ? 'View initial snapshot messages' : `View messages from ${label.toLowerCase()}`}
                    onClick={(): void => {
                      if (snapshot.kind === 'initial') onViewInitial();
                      else if (snapshot.attachmentId !== undefined) onViewAttachment(snapshot.attachmentId);
                    }}
                  >
                    <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
                    View messages
                  </button>
                  {snapshot.kind === 'update' && snapshot.linkedTurnId !== undefined ? (
                    <button
                      type="button"
                      className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300"
                      aria-label={`Go to question for ${label.toLowerCase()}`}
                      onClick={(): void => {
                        onJumpToTurn(snapshot.linkedTurnId ?? '');
                      }}
                    >
                      Go to question
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ContextPreview({
  items,
  displayTimeZone,
}: {
  items: ConversationAssistantContextAttachmentPreviewItem[];
  displayTimeZone: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="py-12 text-center text-sm text-slate-500">No preview items in this update.</p>;
  }
  return (
    <ol className="divide-y divide-slate-200 dark:divide-slate-800">
      {items.map((item, index) => (
        <li key={previewKey(item, index)} className="py-4 first:pt-0 last:pb-0">
          <PreviewItem item={item} displayTimeZone={displayTimeZone} />
        </li>
      ))}
    </ol>
  );
}

function PreviewItem({
  item,
  displayTimeZone,
}: {
  item: ConversationAssistantContextAttachmentPreviewItem;
  displayTimeZone: string;
}): React.JSX.Element {
  if (item.kind === 'included' || item.kind === 'excluded') {
    const message = item.message;
    return (
      <article>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{message.speakerLabel}</span>
          <time
            className="text-xs text-slate-500"
            dateTime={message.eventTimestamp}
            aria-label={formatDateTimeAccessible(message.eventTimestamp, displayTimeZone)}
          >
            {formatDateTime(message.eventTimestamp, displayTimeZone)}
          </time>
        </div>
        {item.kind === 'excluded' ? (
          <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {omissionLabel(item.message.omissionReason)}
          </span>
        ) : null}
        {message.content !== undefined ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-300">{message.content}</p>
        ) : null}
        <ReactionList label="Message" reactions={message.reactions ?? []} />
      </article>
    );
  }
  return (
    <article aria-label={`${correctionLabel(item.changeKind)} earlier context`}>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{correctionLabel(item.changeKind)} earlier context</h3>
      <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
        <Projection label="Before" projection={item.before} />
        <Projection label="After" projection={item.after} />
      </div>
    </article>
  );
}

function formatCount(count: number, singular: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : `${singular}s`}`;
}

function Projection({ label, projection }: { label: string; projection: ConversationAssistantContextCorrectionProjection }): React.JSX.Element {
  const text = projection.state === 'included' ? projection.content : projectionStateLabel(projection);
  const reactions =
    projection.state === 'included' || projection.state === 'omitted'
      ? projection.reactions
      : [];
  return (
    <div className="min-w-0 rounded-md bg-slate-50 p-3 dark:bg-slate-950/60">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{text}</p>
      <ReactionList label={label} reactions={reactions} />
    </div>
  );
}

function ReactionList({
  label,
  reactions,
}: {
  label: string;
  reactions: ConversationAssistantContextAttachmentPreviewReaction[];
}): React.JSX.Element | null {
  if (reactions.length === 0) return null;
  return (
    <ul
      aria-label={`${label} reactions`}
      className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300"
    >
      {reactions.map((reaction, index) => (
        <li
          key={`${reaction.emoji}-${reaction.eventTimestamp}-${String(index)}`}
          className="rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        >
          {reaction.emoji}{' '}
          {reaction.direction === 'outgoing'
            ? 'You'
            : (reaction.senderDisplayName ?? 'Contact')}
        </li>
      ))}
    </ul>
  );
}

function projectionStateLabel(projection: ConversationAssistantContextCorrectionProjection): string {
  if (projection.state === 'missing') return 'No earlier content';
  if (projection.state === 'unavailable') return 'Earlier content unavailable';
  if (projection.state === 'omitted') return omissionLabel(projection.omissionReason);
  return 'Content redacted';
}

function omissionLabel(reason: string): string {
  if (reason === 'media_only') return 'Media without usable text';
  if (reason === 'failed_transcription') return 'Transcription failed';
  if (reason === 'pending_transcription') return 'Transcription not ready';
  if (reason === 'over_limit') return 'Outside context limit';
  return 'Unsupported message type';
}

function correctionLabel(kind: string): string {
  if (kind === 'transcription_changed') return 'Completed transcription';
  if (kind === 'edited') return 'Edited';
  if (kind === 'redacted' || kind === 'deleted') return 'Redacted';
  if (kind === 'reaction_changed') return 'Changed reactions in';
  return 'Added';
}

function previewKey(
  item: ConversationAssistantContextAttachmentPreviewItem,
  index: number
): string {
  return item.kind === 'correction'
    ? `correction-${item.targetReference}-${item.changeKind}-${String(index)}`
    : `${item.kind}-${item.message.id}`;
}
