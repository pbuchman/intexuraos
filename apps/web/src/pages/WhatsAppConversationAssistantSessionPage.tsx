import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MessageSquareText,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { MarkdownContent } from '@/components/MarkdownContent';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { ConversationAssistantComposer } from '@/components/whatsapp/ConversationAssistantComposer';
import { ConversationAssistantActionsMenu } from '@/components/whatsapp/ConversationAssistantActionsMenu';
import { ConversationAssistantContextModal } from '@/components/whatsapp/ConversationAssistantContextModal';
import { ConversationAssistantDeleteDialog } from '@/components/whatsapp/ConversationAssistantDeleteDialog';
import { useWhatsAppConversationAssistant } from '@/hooks/useWhatsAppConversationAssistant';
import type { ConversationAssistantOmittedCounts, ConversationAssistantSession } from '@/types';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';

function sumOmitted(omitted: ConversationAssistantOmittedCounts): number {
  return (
    omitted.mediaOnly +
    omitted.failedTranscriptions +
    omitted.pendingTranscriptions +
    omitted.nonText +
    omitted.overLimit
  );
}

function getPreparationStageLabel(
  stage: 'queued' | 'loading_messages' | 'building_context' | 'ready' | 'failed' | undefined
): string {
  switch (stage) {
    case 'loading_messages':
      return 'Loading messages from the selected range...';
    case 'building_context':
      return 'Building the frozen context...';
    case 'queued':
    default:
      return 'Waiting to start...';
  }
}

export function WhatsAppConversationAssistantSessionPage(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const assistant = useWhatsAppConversationAssistant({
    ...(sessionId !== undefined ? { sessionId } : {}),
    loadChats: false,
    loadSessions: false,
  });
  const turnsScrollRef = useRef<HTMLDivElement | null>(null);
  const followTurnsRef = useRef(true);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationAssistantSession | undefined>(
    undefined
  );

  const updateTurnScrollFollow = useCallback((): void => {
    const element = turnsScrollRef.current;
    if (element === null) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    followTurnsRef.current = distanceFromBottom < 64;
  }, []);

  useEffect(() => {
    followTurnsRef.current = true;
    setContextOpen(false);
    const element = turnsScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [sessionId]);

  useEffect(() => {
    const element = turnsScrollRef.current;
    if (element !== null && followTurnsRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [assistant.loadingTurns, assistant.turns]);

  useEffect(() => {
    if (assistant.turnPhase === 'idle') return;
    followTurnsRef.current = true;
    const element = turnsScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [assistant.turnPhase]);

  const session = assistant.selectedSession;
  const deletionPending = session?.deletionPending === true;
  const contextReady =
    !deletionPending && (session?.status === 'ready' || session?.status === 'active');
  const contextPreparing = !deletionPending && session?.status === 'preparing';
  const contextFailed = !deletionPending && session?.status === 'failed';
  const hasUserQuestion = assistant.turns.some((turn) => turn.role === 'user');
  const canExport =
    contextReady &&
    assistant.turns.length > 0 &&
    assistant.turnPhase === 'idle' &&
    !assistant.exporting;

  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-8rem)] w-full min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link
              to="/whatsapp/conversation-assistant"
              className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-50"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to analyses
            </Link>
            <h2 className="mt-3 line-clamp-2 break-words text-xl font-bold leading-tight text-slate-950 dark:text-slate-50 sm:block sm:truncate sm:text-2xl">
              {session?.title ?? 'Loading analysis...'}
            </h2>
            {session !== undefined ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span>
                  {session.chatDisplayName ?? session.chatId} · {formatDateTime(session.range.from)}{' '}
                  – {formatDateTime(session.range.to)}
                </span>
                <span
                  aria-label="Model used"
                  className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                >
                  {session.modelDisplayName}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => {
                void assistant.exportSelectedSessionPdf();
              }}
              isLoading={assistant.exporting}
              loadingText="Exporting"
              disabled={!canExport}
            >
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
            {session !== undefined ? (
              <ConversationAssistantActionsMenu
                title={session.title}
                onDelete={(trigger): void => {
                  deleteTriggerRef.current = trigger;
                  assistant.clearDeleteError();
                  setDeleteTarget({ ...session });
                }}
                deleteLabel={session.deletionPending === true ? 'Finish deletion' : 'Delete analysis'}
              />
            ) : null}
          </div>
        </header>

        <ErrorBanner message={assistant.error} />

        {session !== undefined && deletionPending ? (
          <section
            role="status"
            className="flex flex-col items-start rounded-lg border border-amber-200 bg-amber-50 px-5 py-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
              Deletion interrupted
            </div>
            <p className="mt-2 text-sm">
              This analysis is no longer available. Finish deletion to remove its remaining data.
            </p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="mt-4 min-h-11"
              onClick={(event): void => {
                deleteTriggerRef.current = event.currentTarget;
                assistant.clearDeleteError();
                setDeleteTarget({ ...session });
              }}
            >
              Finish deletion
            </Button>
          </section>
        ) : null}

        {session !== undefined && contextReady ? (
          <button
            type="button"
            aria-label="View frozen context"
            onClick={(): void => {
              setContextOpen(true);
              void assistant.loadContext();
            }}
            className="group flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
          >
            <MessageSquareText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="min-w-0 flex-1">
              {session.transcriptMessageCount.toLocaleString()} messages used ·{' '}
              {sumOmitted(session.omitted).toLocaleString()} omitted
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">View context</span>
            <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : null}

        {!deletionPending ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div
            ref={turnsScrollRef}
            data-testid="conversation-assistant-turns"
            onScroll={updateTurnScrollFollow}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950 sm:p-5"
          >
            {assistant.loadingTurns ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading conversation...</p>
            ) : null}
            {!assistant.loadingTurns && contextPreparing ? (
              <div className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-lg border border-blue-200 bg-white px-6 py-8 text-center dark:border-blue-900 dark:bg-slate-900">
                <LoaderCircle className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                <h3 className="mt-3 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  Preparing conversation context
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {getPreparationStageLabel(session.preparationStage)}
                </p>
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                  You can leave this page. Preparation will continue in the background.
                </p>
              </div>
            ) : null}
            {!assistant.loadingTurns && contextFailed ? (
              <div className="mx-auto mt-12 max-w-md rounded-lg border border-red-200 bg-white px-6 py-8 text-center dark:border-red-900 dark:bg-slate-900">
                <AlertTriangle className="mx-auto h-6 w-6 text-red-600 dark:text-red-400" />
                <h3 className="mt-3 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  Context preparation failed
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {session.preparationError?.message ??
                    'The conversation context could not be prepared.'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-4"
                  onClick={(): void => {
                    void assistant.retryPreparation();
                  }}
                  isLoading={assistant.retryingPreparation}
                  loadingText="Retrying"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {!assistant.loadingTurns && contextReady && assistant.turns.length === 0 ? (
              <div className="mx-auto mt-12 max-w-md rounded-lg border border-dashed border-slate-300 bg-white px-5 py-8 text-center dark:border-slate-700 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  Context is ready
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Ask your first question about this conversation.
                </p>
              </div>
            ) : null}
            {assistant.turns.map((turn, index) => {
              const isUser = turn.role === 'user';
              const isStreamingAnswer =
                assistant.turnPhase === 'streaming' &&
                !isUser &&
                index === assistant.turns.length - 1;
              return (
                <article
                  key={turn.id}
                  className={`max-w-[min(46rem,100%)] rounded-lg border px-4 py-3 ${
                    isUser
                      ? 'ml-auto border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                      : 'mr-auto border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-3 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-2">
                      {isUser ? 'You' : (session?.assistantRoleLabel ?? 'Assistant')}
                      {isStreamingAnswer ? (
                        <span
                          aria-hidden="true"
                          className="normal-case text-blue-600 dark:text-blue-400"
                        >
                          Responding…
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">{formatDateTimeCompact(turn.createdAt)}</span>
                  </div>
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
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {turn.error.code}: {turn.error.message}
                    </p>
                  ) : null}
                </article>
              );
            })}
            {assistant.turnPhase === 'waiting' ? (
              <article
                role="status"
                aria-live="polite"
                className="mr-auto flex max-w-[min(46rem,100%)] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                Assistant is thinking…
              </article>
            ) : null}
            {assistant.turnPhase === 'streaming' ? (
              <span role="status" aria-live="polite" className="sr-only">
                Assistant is responding.
              </span>
            ) : null}
          </div>

          {contextReady ? (
            <ConversationAssistantComposer
              value={assistant.followUpQuestion}
              disabled={assistant.retryingPreparation}
              turnPhase={assistant.turnPhase}
              mode={hasUserQuestion ? 'follow-up' : 'first-question'}
              onChange={assistant.setFollowUpQuestion}
              onSend={assistant.sendFollowUp}
            />
          ) : null}
          </section>
        ) : null}

        {contextOpen && session !== undefined && !deletionPending ? (
          <ConversationAssistantContextModal
            context={assistant.context}
            loading={assistant.loadingContext}
            loadingMore={assistant.loadingMoreContext}
            error={assistant.contextError}
            expectedMessageCount={session.transcriptMessageCount}
            omitted={session.omitted}
            onRetry={(): void => {
              if (assistant.context === null) {
                void assistant.loadContext();
                return;
              }
              void assistant.loadMoreContext();
            }}
            onLoadMore={(): void => {
              void assistant.loadMoreContext();
            }}
            onClose={(): void => {
              setContextOpen(false);
            }}
          />
        ) : null}
        {deleteTarget !== undefined ? (
          <ConversationAssistantDeleteDialog
            open
            title={deleteTarget.title}
            deleting={assistant.deletingSessionId === deleteTarget.id}
            error={assistant.deleteError}
            resumePending={
              deleteTarget.deletionPending === true ||
              (session?.id === deleteTarget.id &&
                session.deletionToken === deleteTarget.deletionToken &&
                session.deletionPending === true)
            }
            returnFocusTo={deleteTriggerRef.current}
            onOpenChange={(open): void => {
              if (!open) {
                assistant.clearDeleteError();
                setDeleteTarget(undefined);
              }
            }}
            onConfirm={async (): Promise<void> => {
              const deleted = await assistant.deleteSession(
                deleteTarget.id,
                deleteTarget.deletionToken
              );
              if (!deleted) return;
              await navigate('/whatsapp/conversation-assistant', {
                replace: true,
                state: { deletedAnalysisTitle: deleteTarget.title },
              });
            }}
          />
        ) : null}
      </div>
    </Layout>
  );
}
