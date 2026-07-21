import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  LoaderCircle,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { ConversationAssistantActionsMenu } from '@/components/whatsapp/ConversationAssistantActionsMenu';
import { ConversationAssistantDeleteDialog } from '@/components/whatsapp/ConversationAssistantDeleteDialog';
import { useWhatsAppConversationAssistant } from '@/hooks/useWhatsAppConversationAssistant';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';
import type { ConversationAssistantSession } from '@/types';

const SESSION_ROW_CLASS =
  'group grid min-w-0 flex-1 gap-2 rounded-l-lg px-4 py-3 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_auto] sm:items-center sm:gap-3 sm:py-4';

export function WhatsAppConversationAssistantListPage(): React.JSX.Element {
  const assistant = useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true });
  const location = useLocation();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<ConversationAssistantSession | null>(null);
  const [statusNotification, setStatusNotification] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const statusNotificationIdRef = useRef(0);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const deleteTargetPending =
    deleteTarget?.deletionPending === true ||
    assistant.sessions.some(
      (session) =>
        session.id === deleteTarget?.id &&
        session.deletionToken === deleteTarget.deletionToken &&
        session.deletionPending === true
    );
  const showDeletionStatus = useCallback((title?: string): void => {
    statusNotificationIdRef.current += 1;
    setStatusNotification({
      id: statusNotificationIdRef.current,
      message: title === undefined ? 'Analysis deleted.' : `Analysis deleted. ${title}`,
    });
  }, []);

  useEffect(() => {
    if (assistant.selectedSessionId !== undefined) {
      void navigate(`/whatsapp/conversation-assistant/${assistant.selectedSessionId}`, {
        replace: true,
      });
    }
  }, [assistant.selectedSessionId, navigate]);

  useEffect(() => {
    const locationState = location.state as { deletedAnalysisTitle?: unknown } | null;
    if (typeof locationState?.deletedAnalysisTitle !== 'string') return;
    showDeletionStatus(locationState.deletedAnalysisTitle);
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showDeletionStatus]);

  useEffect(() => {
    if (statusNotification === null) return;
    const focusTimeoutId = window.setTimeout(() => {
      pageHeadingRef.current?.focus();
    }, 0);
    const timeoutId = window.setTimeout(() => {
      setStatusNotification(null);
    }, 5000);
    return (): void => {
      window.clearTimeout(focusTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [statusNotification]);

  return (
    <Layout>
      <div className="flex w-full min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              ref={pageHeadingRef}
              tabIndex={-1}
              className="flex items-center gap-2 text-2xl font-bold text-slate-950 focus:outline-none dark:text-slate-50"
            >
              <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              Conversation Assistant
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Continue an existing analysis or prepare a new frozen conversation context.
            </p>
          </div>
          <Link
            to="/whatsapp/conversation-assistant/new"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
          >
            <Plus className="mr-2 h-4 w-4" />
            New analysis
          </Link>
        </header>

        <ErrorBanner message={assistant.error} />
        {statusNotification !== null ? (
          <div
            key={statusNotification.id}
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {statusNotification.message}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {assistant.loading ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading analyses...
            </p>
          ) : null}
          {!assistant.loading && assistant.sessions.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                No analyses yet
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Create an analysis to start asking questions about a frozen WhatsApp range.
              </p>
            </div>
          ) : null}
          {!assistant.loading && assistant.sessions.length > 0 ? (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {assistant.sessions.map((session) => (
                <li key={session.id} className="flex min-w-0 items-stretch">
                  {session.deletionPending === true ? (
                    <div
                      aria-label={`Deletion interrupted for ${session.title}`}
                      className={`${SESSION_ROW_CLASS} bg-amber-50/70 dark:bg-amber-950/20`}
                    >
                      <ConversationAssistantListSummary session={session} />
                    </div>
                  ) : (
                    <Link
                      to={`/whatsapp/conversation-assistant/${session.id}`}
                      className={`${SESSION_ROW_CLASS} hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:hover:bg-slate-800/70`}
                    >
                      <ConversationAssistantListSummary session={session} />
                    </Link>
                  )}
                  <div className="flex items-center pr-2">
                    <ConversationAssistantActionsMenu
                      title={session.title}
                      deleteLabel={
                        session.deletionPending === true ? 'Finish deletion' : 'Delete analysis'
                      }
                      onDelete={(trigger): void => {
                        deleteTriggerRef.current = trigger;
                        assistant.clearDeleteError();
                        setDeleteTarget({ ...session });
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {deleteTarget !== null ? (
          <ConversationAssistantDeleteDialog
            open
            title={deleteTarget.title}
            deleting={assistant.deletingSessionId === deleteTarget.id}
            error={assistant.deleteError}
            resumePending={deleteTargetPending}
            returnFocusTo={deleteTriggerRef.current}
            onOpenChange={(open): void => {
              if (!open) {
                assistant.clearDeleteError();
                setDeleteTarget(null);
              }
            }}
            onConfirm={async (): Promise<void> => {
              const deleted = await assistant.deleteSession(
                deleteTarget.id,
                deleteTarget.deletionToken
              );
              if (!deleted) return;
              showDeletionStatus(deleteTarget.title);
              setDeleteTarget(null);
            }}
          />
        ) : null}
      </div>
    </Layout>
  );
}

function ConversationAssistantListSummary({
  session,
}: {
  session: ConversationAssistantSession;
}): React.JSX.Element {
  const displayTimeZone = session.contextSummary.displayTimeZone;
  return (
    <>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
          {session.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{session.chatDisplayName ?? session.title}</span>
        </span>
      </span>
      <span className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate sm:hidden">
            {formatDateTimeCompact(session.range.from, displayTimeZone)} –{' '}
            {formatDateTimeCompact(session.range.to, displayTimeZone)}
          </span>
          <span className="hidden truncate sm:inline">
            {formatDateTime(session.range.from, displayTimeZone)} –{' '}
            {formatDateTime(session.range.to, displayTimeZone)}
          </span>
        </span>
        <span className="mt-1 block pl-5">
          <span className="sm:hidden">Updated </span>
          <span className="hidden sm:inline">Last activity </span>
          {formatDateTimeCompact(session.lastTurnAt ?? session.updatedAt, displayTimeZone)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 sm:justify-end">
        {session.deletionPending === true ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Deletion interrupted
          </span>
        ) : null}
        {session.deletionPending !== true && session.status === 'preparing' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            Preparing
          </span>
        ) : null}
        {session.deletionPending !== true && session.status === 'failed' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Needs attention
          </span>
        ) : null}
        {session.deletionPending !== true ? (
          <ArrowRight className="hidden h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 sm:block" />
        ) : null}
      </span>
    </>
  );
}
