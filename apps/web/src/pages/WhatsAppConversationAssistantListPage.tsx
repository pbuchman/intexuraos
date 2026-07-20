import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock,
  LoaderCircle,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { useWhatsAppConversationAssistant } from '@/hooks/useWhatsAppConversationAssistant';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';

export function WhatsAppConversationAssistantListPage(): React.JSX.Element {
  const assistant = useWhatsAppConversationAssistant({ loadChats: false, loadSessions: true });
  const navigate = useNavigate();

  useEffect(() => {
    if (assistant.selectedSessionId !== undefined) {
      void navigate(`/whatsapp/conversation-assistant/${assistant.selectedSessionId}`, {
        replace: true,
      });
    }
  }, [assistant.selectedSessionId, navigate]);

  return (
    <Layout>
      <div className="flex w-full min-w-0 flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50">
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

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
                <li key={session.id}>
                  <Link
                    to={`/whatsapp/conversation-assistant/${session.id}`}
                    className="group grid gap-3 px-4 py-4 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:hover:bg-slate-800/70 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)_auto] sm:items-center"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
                        {session.title}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {session.chatDisplayName ?? session.chatId}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {formatDateTime(session.range.from)} – {formatDateTime(session.range.to)}
                        </span>
                      </span>
                      <span className="mt-1 block pl-5">
                        Last activity {formatDateTimeCompact(session.lastTurnAt ?? session.updatedAt)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      {session.status === 'preparing' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          Preparing
                        </span>
                      ) : null}
                      {session.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Needs attention
                        </span>
                      ) : null}
                      <ArrowRight className="hidden h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 sm:block" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Layout>
  );
}
