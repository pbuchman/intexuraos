import { MessageSquare } from 'lucide-react';
import type { IntexAgentSession } from '@/types';
import {
  formatSessionDateTimeCompact,
  formatSessionRelative,
  formatSessionValue,
  getSessionStatusClass,
  getSessionTitle,
} from './sessionPresentation.js';

interface IntexSessionRailProps {
  sessions: IntexAgentSession[];
  selectedSessionId: string | undefined;
  loading: boolean;
  onSelect: (sessionId: string) => void;
}

export function IntexSessionRail({
  sessions,
  selectedSessionId,
  loading,
  onSelect,
}: IntexSessionRailProps): React.JSX.Element {
  const hasNoSessions = !loading && sessions.length === 0;

  return (
    <aside
      data-testid="intex-agent-session-rail"
      className="flex max-h-[45vh] min-h-0 flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:max-h-[28rem] xl:max-h-none"
    >
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Sessions</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {String(sessions.length)} visible
        </p>
      </div>

      <div className="min-h-[14rem] flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : null}

        {hasNoSessions ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <MessageSquare className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-700" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              No assistant sessions yet.
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          {sessions.map((session) => {
            const selected = session.id === selectedSessionId;
            const label = getSessionTitle(session);
            return (
              <button
                key={session.id}
                type="button"
                onClick={(): void => {
                  onSelect(session.id);
                }}
                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                  selected
                    ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
                    : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
                      {label}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {formatSessionDateTimeCompact(session.startedAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getSessionStatusClass(
                      session.status
                    )}`}
                  >
                    {formatSessionValue(session.status)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Last user message {formatSessionRelative(session.lastUserMessageAt)}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
