import { Bot, Clock, MessageSquare } from 'lucide-react';
import type { ConversationAssistantDateRange } from '@intexuraos/llm-contract';
import type { ConversationAssistantSession } from '@/types';
import { formatDateTime, formatDateTimeCompact } from '@/utils/dateFormat';

function formatRange(range: ConversationAssistantDateRange): string {
  return `${formatDateTime(range.from)} - ${formatDateTime(range.to)}`;
}

export function ConversationAssistantSessionRail({
  sessions,
  selectedSessionId,
  loading,
  onSelectSession,
}: {
  sessions: ConversationAssistantSession[];
  selectedSessionId: string | undefined;
  loading: boolean;
  onSelectSession: (sessionId: string) => void;
}): React.JSX.Element {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Sessions</h3>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? (
          <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">Loading sessions...</p>
        ) : null}
        {!loading && sessions.length === 0 ? (
          <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">
            No assistant sessions yet.
          </p>
        ) : null}
        {sessions.map((session) => {
          const selected = session.id === selectedSessionId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={(): void => {
                onSelectSession(session.id);
              }}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                selected
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
            >
              <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
                {session.title}
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{session.chatDisplayName ?? session.chatId}</span>
              </span>
              <span className="mt-1 flex min-w-0 items-start gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-600 dark:text-slate-300">
                    Information
                  </span>
                  <span className="block truncate">{formatRange(session.range)}</span>
                </span>
              </span>
              <span className="mt-1 flex min-w-0 items-start gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-600 dark:text-slate-300">
                    Effective
                  </span>
                  <span className="block truncate">{formatRange(session.effectiveRange)}</span>
                </span>
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{session.modelDisplayName}</span>
              </span>
              {session.lastTurnAt !== undefined ? (
                <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                  Last turn {formatDateTimeCompact(session.lastTurnAt)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
