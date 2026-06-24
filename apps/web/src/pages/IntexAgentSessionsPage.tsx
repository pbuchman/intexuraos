import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, ErrorBanner, Layout } from '@/components';
import { IntexSessionRail } from '@/components/intex-agent/IntexSessionRail.js';
import { IntexSessionTimeline } from '@/components/intex-agent/IntexSessionTimeline.js';
import { formatSessionValue } from '@/components/intex-agent/sessionPresentation.js';
import { useAuth } from '@/context';
import { ApiError, listIntexAgentSessionEvents, listIntexAgentSessions } from '@/services';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';

function sessionMatchesSearch(session: IntexAgentSession, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === '') return true;
  return [
    session.id,
    session.summary,
    session.status,
    session.startReason,
    session.endReason,
    session.activeTool,
  ].some((value) => value?.toLowerCase().includes(query) === true);
}

export function IntexAgentSessionsPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSessionId = searchParams.get('session') ?? undefined;
  const [sessions, setSessions] = useState<IntexAgentSession[]>([]);
  const [events, setEvents] = useState<IntexAgentSessionEvent[]>([]);
  const [search, setSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(
    async (showRefreshing?: boolean): Promise<void> => {
      try {
        if (showRefreshing === true) {
          setRefreshing(true);
        } else {
          setLoadingSessions(true);
        }
        setError(null);
        const token = await getAccessToken();
        const response = await listIntexAgentSessions(token);
        setSessions(response);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Failed to load sessions');
      } finally {
        setLoadingSessions(false);
        setRefreshing(false);
      }
    },
    [getAccessToken]
  );

  const loadEvents = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        setLoadingEvents(true);
        setError(null);
        const token = await getAccessToken();
        const response = await listIntexAgentSessionEvents(token, sessionId);
        setEvents(response);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Failed to load session events');
      } finally {
        setLoadingEvents(false);
      }
    },
    [getAccessToken]
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (loadingSessions || sessions.length === 0) return;
    const hasSelected = selectedSessionId !== undefined && sessions.some((s) => s.id === selectedSessionId);
    if (hasSelected) return;
    const firstSession = sessions[0];
    if (firstSession === undefined) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('session', firstSession.id);
        return next;
      },
      { replace: true }
    );
  }, [loadingSessions, selectedSessionId, sessions, setSearchParams]);

  useEffect(() => {
    if (selectedSessionId === undefined) {
      setEvents([]);
      return;
    }
    void loadEvents(selectedSessionId);
  }, [loadEvents, selectedSessionId]);

  const visibleSessions = useMemo(
    () => sessions.filter((session) => sessionMatchesSearch(session, search)),
    [sessions, search]
  );
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  const selectSession = (sessionId: string): void => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('session', sessionId);
      return next;
    });
  };

  const refresh = (): void => {
    void (async (): Promise<void> => {
      await loadSessions(true);
      if (selectedSessionId !== undefined) {
        await loadEvents(selectedSessionId);
      }
    })();
  };

  return (
    <Layout>
      <div data-testid="intex-agent-session-shell" className="flex w-full min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">
              Assistant Sessions
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              WhatsApp Assistant sessions with tool calls and closure state.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            isLoading={refreshing}
            loadingText="Refreshing"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </header>

        <ErrorBanner message={error} />

        <div className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <label className="sr-only" htmlFor="intex-agent-session-search">
              Search sessions
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                id="intex-agent-session-search"
                type="search"
                value={search}
                onChange={(event): void => {
                  setSearch(event.target.value);
                }}
                placeholder="Search sessions"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:bg-slate-900 dark:focus:ring-blue-900/40"
              />
            </div>
            {search.trim() !== '' && visibleSessions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No sessions match {formatSessionValue(search)}.
              </p>
            ) : null}
            <IntexSessionRail
              sessions={visibleSessions}
              selectedSessionId={selectedSessionId}
              loading={loadingSessions}
              onSelect={selectSession}
            />
          </div>

          <IntexSessionTimeline
            session={selectedSession}
            events={events}
            loading={loadingEvents}
          />
        </div>
      </div>
    </Layout>
  );
}
