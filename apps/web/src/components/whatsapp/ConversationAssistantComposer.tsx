import { LoaderCircle, MessageSquarePlus, Send } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components';
import type {
  ConversationAssistantContextAttachmentRequestPhase,
  ConversationAssistantTurnPhase,
} from '@/hooks/useWhatsAppConversationAssistant';
import type { ConversationAssistantAttachmentState } from '@/utils/conversationAssistantAttachmentState';
import { ConversationAssistantContextAttachmentCard } from './ConversationAssistantContextAttachmentCard.js';

export interface ConversationAssistantComposerProps {
  value: string;
  disabled: boolean;
  turnPhase: ConversationAssistantTurnPhase;
  mode: 'first-question' | 'follow-up';
  attachmentState: ConversationAssistantAttachmentState;
  attachmentRequestPhase: ConversationAssistantContextAttachmentRequestPhase;
  warningAcknowledged: boolean;
  continuationState: 'available' | 'legacy_session' | 'source_unavailable';
  displayTimeZone: string;
  onChange: (value: string) => void;
  onSend: () => Promise<void>;
  onInclude: () => Promise<void>;
  onViewAttachment: () => void;
  onRemoveAttachment: () => Promise<void>;
  onRetryAttachment: () => Promise<void>;
  onRefreshAttachment: () => Promise<void>;
  onKeepCurrentAttachment: () => void;
  onAcknowledgeWarning: () => void;
  onStartNewAnalysis: () => void;
}

function blocksSend(
  state: ConversationAssistantAttachmentState,
  warningAcknowledged: boolean
): boolean {
  if (
    state.phase === 'preparing_intent' ||
    state.phase === 'restoring' ||
    state.phase === 'restore_failed' ||
    state.phase === 'preparing' ||
    state.phase === 'failed' ||
    state.phase === 'expired' ||
    state.phase === 'stale' ||
    state.phase === 'missing' ||
    state.phase === 'recapture_required' ||
    state.phase === 'consumed_elsewhere'
  ) {
    return true;
  }
  return (
    (state.phase === 'ready' || state.phase === 'newer_available') &&
    state.attachment.requiresConfirmation &&
    !warningAcknowledged
  );
}

function attachmentRequestStatus(
  phase: ConversationAssistantContextAttachmentRequestPhase
): string {
  if (phase === 'idle') return '';
  if (phase === 'include') return 'Freezing WhatsApp messages…';
  if (phase === 'refresh') return 'Refreshing WhatsApp context…';
  if (phase === 'retry') return 'Retrying WhatsApp context…';
  return 'Removing WhatsApp context…';
}

export function ConversationAssistantComposer({
  value,
  disabled,
  turnPhase,
  mode,
  attachmentState,
  attachmentRequestPhase,
  warningAcknowledged,
  continuationState,
  displayTimeZone,
  onChange,
  onSend,
  onInclude,
  onViewAttachment,
  onRemoveAttachment,
  onRetryAttachment,
  onRefreshAttachment,
  onKeepCurrentAttachment,
  onAcknowledgeWarning,
  onStartNewAnalysis,
}: ConversationAssistantComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const includeRef = useRef<HTMLButtonElement | null>(null);
  const focusIncludeAfterRemoveRef = useRef(false);
  const pointerActivationRef = useRef(false);
  const isRestoring = attachmentState.phase === 'restoring';
  const attachmentPresent = attachmentState.phase !== 'idle';
  const activeTurn = turnPhase !== 'idle';
  const terminalLocalDismiss =
    attachmentState.phase === 'missing' ||
    attachmentState.phase === 'recapture_required' ||
    attachmentState.phase === 'consumed_elsewhere';
  const attachmentRequestInFlight = attachmentRequestPhase !== 'idle';
  const canInclude =
    !disabled &&
    !activeTurn &&
    !attachmentRequestInFlight &&
    !attachmentPresent &&
    continuationState === 'available';
  const canSend =
    !disabled &&
    turnPhase === 'idle' &&
    !attachmentRequestInFlight &&
    value.trim() !== '' &&
    !blocksSend(attachmentState, warningAcknowledged);
  const label = mode === 'first-question' ? 'Ask first question' : 'Ask follow-up';
  const placeholder =
    mode === 'first-question'
      ? 'Ask your first question about this conversation'
      : 'Ask a follow-up question';

  useEffect(() => {
    if (!attachmentPresent && focusIncludeAfterRemoveRef.current) {
      focusIncludeAfterRemoveRef.current = false;
      includeRef.current?.focus();
    }
  }, [attachmentPresent]);

  const restoreTextareaAfterPointer = (): void => {
    const wasPointer = pointerActivationRef.current;
    pointerActivationRef.current = false;
    if (wasPointer) textareaRef.current?.focus();
  };
  const runInlineAction = (action: () => void | Promise<void>): void => {
    void action();
    restoreTextareaAfterPointer();
  };

  return (
    <form
      data-testid="conversation-assistant-composer"
      className="min-w-0 overflow-x-hidden border-t border-slate-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event): void => {
        event.preventDefault();
        if (canSend) void onSend();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pt-3">
        <button
          ref={includeRef}
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 dark:focus:ring-offset-slate-900"
          disabled={!canInclude}
          onPointerDown={(): void => {
            pointerActivationRef.current = true;
          }}
          onKeyDown={(): void => {
            pointerActivationRef.current = false;
          }}
          onClick={(): void => {
            runInlineAction(onInclude);
          }}
        >
          {attachmentRequestPhase === 'include' ? (
            <LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <MessageSquarePlus aria-hidden="true" className="mr-2 h-4 w-4" />
          )}
          {attachmentRequestPhase === 'include' ? 'Freezing messages…' : 'Include new messages'}
        </button>
        {activeTurn ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {turnPhase === 'restoring'
              ? 'Checking the previous send before allowing another change.'
              : 'Available after the current answer finishes.'}
          </span>
        ) : null}
        {attachmentRequestInFlight ? (
          <span role="status" aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
            {attachmentRequestStatus(attachmentRequestPhase)}
          </span>
        ) : null}
      </div>

      {continuationState !== 'available' ? (
        <div
          role="status"
          className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <p>
            {continuationState === 'legacy_session'
              ? 'This older analysis cannot reliably include later WhatsApp context.'
              : 'The source WhatsApp conversation is no longer available.'}
          </p>
          {continuationState === 'legacy_session' ? (
            <Button
              type="button"
              size="sm"
              className="mt-3 min-h-11"
              aria-label="Start a new analysis (opens in a new tab)"
              onClick={onStartNewAnalysis}
            >
              Start a new analysis
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        onPointerDownCapture={(): void => {
          pointerActivationRef.current = true;
        }}
        onKeyDownCapture={(): void => {
          pointerActivationRef.current = false;
        }}
      >
        <ConversationAssistantContextAttachmentCard
          state={attachmentState}
          warningAcknowledged={warningAcknowledged}
          displayTimeZone={displayTimeZone}
          recaptureAvailable={continuationState === 'available'}
          disabled={
            disabled ||
            (activeTurn && !terminalLocalDismiss) ||
            (attachmentRequestInFlight &&
              attachmentState.phase !== 'preparing_intent' &&
              !terminalLocalDismiss)
          }
          onViewMessages={onViewAttachment}
          onRemove={(): void => {
            pointerActivationRef.current = false;
            focusIncludeAfterRemoveRef.current = true;
            void onRemoveAttachment();
          }}
          onRetry={(): void => {
            runInlineAction(onRetryAttachment);
          }}
          onRefresh={(): void => {
            runInlineAction(onRefreshAttachment);
          }}
          onKeepCurrent={(): void => {
            runInlineAction(onKeepCurrentAttachment);
          }}
          onAcknowledgeWarning={(): void => {
            runInlineAction(onAcknowledgeWarning);
          }}
          onStartNewAnalysis={onStartNewAnalysis}
        />
      </div>

      <div className="flex min-w-0 items-end gap-2 px-3 pt-3">
        <label className="sr-only" htmlFor="conversation-assistant-question">
          {label}
        </label>
        <textarea
          ref={textareaRef}
          id="conversation-assistant-question"
          value={value}
          onChange={(event): void => {
            onChange(event.target.value);
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSend) {
              event.preventDefault();
              void onSend();
            }
          }}
          disabled={
            disabled ||
            turnPhase === 'submitting' ||
            turnPhase === 'restoring' ||
            isRestoring
          }
          rows={2}
          className="min-h-12 min-w-0 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:disabled:bg-slate-800"
          placeholder={placeholder}
        />
        <Button
          type="submit"
          size="sm"
          isLoading={turnPhase === 'submitting'}
          loadingText="Sending…"
          disabled={!canSend}
          className="h-12 min-w-11 shrink-0 px-3"
        >
          <Send aria-hidden="true" className="mr-2 h-4 w-4" />
          <span>Send</span>
        </Button>
      </div>
      <p className="sr-only">Enter starts a new line. Control or Command plus Enter sends.</p>
    </form>
  );
}
