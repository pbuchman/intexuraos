import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, ErrorBanner, Layout } from '@/components';
import { IntexSessionRail } from '@/components/intex-agent/IntexSessionRail.js';
import { IntexSessionTimeline } from '@/components/intex-agent/IntexSessionTimeline.js';
import { IntexTestRunHeader } from '@/components/intex-agent/IntexTestRunHeader.js';
import { IntexTestRunSelector } from '@/components/intex-agent/IntexTestRunSelector.js';
import { IntexTestScenarioRail } from '@/components/intex-agent/IntexTestScenarioRail.js';
import { IntexTestScenarioTimeline } from '@/components/intex-agent/IntexTestScenarioTimeline.js';
import {
  formatSessionValue,
  projectSessionEventsForTimeline,
} from '@/components/intex-agent/sessionPresentation.js';
import { useAuth } from '@/context';
import {
  ApiError,
  getIntexAgentTestRun,
  getIntexAgentTestScenario,
  getUserSettings,
  listIntexAgentSessionEvents,
  listIntexAgentSessions,
  listIntexAgentTestRuns,
} from '@/services';
import type {
  IntexAgentSession,
  IntexAgentSessionEvent,
  PublicTestRunHeaderV1,
  PublicTestRunScenarioSummaryV1,
  TestRunDtoV1,
  TestScenarioDtoV1,
} from '@/types';

type SearchParamsSetter = ReturnType<typeof useSearchParams>[1];
type AccessTokenGetter = () => Promise<string>;
type PageView = 'regular' | 'test-runs';

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

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function isAuthorizationFailure(caught: unknown): boolean {
  return caught instanceof ApiError && (caught.status === 401 || caught.status === 403);
}

function isTerminalRun(run: PublicTestRunHeaderV1): boolean {
  return run.lifecycle === 'completed' || run.lifecycle === 'stopped';
}

function shouldPollRun(run: PublicTestRunHeaderV1): boolean {
  return (
    !isTerminalRun(run) ||
    run.artifactDelivery.status === 'pending' ||
    run.artifactDelivery.status === 'staged'
  );
}

function chooseNewerRun(
  current: PublicTestRunHeaderV1 | undefined,
  incoming: PublicTestRunHeaderV1
): PublicTestRunHeaderV1 {
  if (current === undefined || incoming.revision > current.revision) return incoming;
  return current;
}

function chooseNewerScenario(
  current: PublicTestRunScenarioSummaryV1 | undefined,
  incoming: PublicTestRunScenarioSummaryV1
): PublicTestRunScenarioSummaryV1 {
  if (current === undefined || incoming.scenarioRevision > current.scenarioRevision) return incoming;
  return current;
}

function chooseNewerScenarioDetail(
  current: TestScenarioDtoV1 | undefined,
  incoming: TestScenarioDtoV1
): TestScenarioDtoV1 {
  if (
    current?.runId !== incoming.runId ||
    current.scenario.scenarioId !== incoming.scenario.scenarioId
  )
    return incoming;
  if (
    incoming.runRevision < current.runRevision ||
    incoming.scenario.scenarioRevision < current.scenario.scenarioRevision ||
    incoming.eventWatermark < current.eventWatermark
  )
    return current;
  if (
    incoming.scenario.scenarioRevision === current.scenario.scenarioRevision &&
    incoming.eventWatermark === current.eventWatermark
  )
    return incoming.runRevision > current.runRevision
      ? { ...current, runRevision: incoming.runRevision }
      : current;
  const acceptedScenario = chooseNewerScenario(current.scenario, incoming.scenario);
  return { ...incoming, scenario: acceptedScenario };
}

interface ViewTabsProps {
  active: PageView;
  testRunsAvailable: boolean;
  onActivate: (view: PageView) => void;
}

function ViewTabs({ active, testRunsAvailable, onActivate }: ViewTabsProps): React.JSX.Element {
  const regularRef = useRef<HTMLButtonElement>(null);
  const testRunsRef = useRef<HTMLButtonElement>(null);
  const views: PageView[] = testRunsAvailable ? ['regular', 'test-runs'] : ['regular'];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, view: PageView): void => {
    const currentIndex = views.indexOf(view);
    let targetIndex: number | undefined;
    if (event.key === 'ArrowRight') targetIndex = (currentIndex + 1) % views.length;
    if (event.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + views.length) % views.length;
    if (event.key === 'Home') targetIndex = 0;
    if (event.key === 'End') targetIndex = views.length - 1;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(view);
      return;
    }
    if (targetIndex === undefined) return;
    event.preventDefault();
    const target = views[targetIndex];
    (target === 'test-runs' ? testRunsRef : regularRef).current?.focus();
  };

  return (
    <div role="tablist" aria-label="Assistant session views" className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
      <button
        ref={regularRef}
        type="button"
        role="tab"
        aria-selected={active === 'regular'}
        aria-controls="regular-sessions-panel"
        tabIndex={active === 'regular' ? 0 : -1}
        onClick={(): void => { onActivate('regular'); }}
        onKeyDown={(event): void => { onKeyDown(event, 'regular'); }}
        className="border-b-2 border-transparent px-3 py-2 text-sm font-semibold aria-selected:border-blue-600 aria-selected:text-blue-700"
      >
        Regular
      </button>
      {testRunsAvailable ? (
        <button
          ref={testRunsRef}
          type="button"
          role="tab"
          aria-selected={active === 'test-runs'}
          aria-controls="test-runs-panel"
          tabIndex={active === 'test-runs' ? 0 : -1}
          onClick={(): void => { onActivate('test-runs'); }}
          onKeyDown={(event): void => { onKeyDown(event, 'test-runs'); }}
          className="border-b-2 border-transparent px-3 py-2 text-sm font-semibold aria-selected:border-blue-600 aria-selected:text-blue-700"
        >
          Test Runs
        </button>
      ) : null}
    </div>
  );
}

interface RegularSessionsViewProps {
  getAccessToken: AccessTokenGetter;
  searchParams: URLSearchParams;
  setSearchParams: SearchParamsSetter;
}

function RegularSessionsView({
  getAccessToken,
  searchParams,
  setSearchParams,
}: RegularSessionsViewProps): React.JSX.Element {
  const selectedSessionId = searchParams.get('session') ?? undefined;
  const [sessions, setSessions] = useState<IntexAgentSession[]>([]);
  const [events, setEvents] = useState<IntexAgentSessionEvent[]>([]);
  const [search, setSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timelinePaneRef = useRef<HTMLDivElement>(null);
  const restoreTimelineAfterNavigationRef = useRef(false);

  const loadSessions = useCallback(
    async (showRefreshing?: boolean): Promise<void> => {
      try {
        if (showRefreshing === true) setRefreshing(true);
        else setLoadingSessions(true);
        setError(null);
        const token = await getAccessToken();
        setSessions(await listIntexAgentSessions(token));
      } catch (caught) {
        setError(errorMessage(caught, 'Failed to load sessions'));
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
        setEvents(await listIntexAgentSessionEvents(token, sessionId));
      } catch (caught) {
        setError(errorMessage(caught, 'Failed to load session events'));
      } finally {
        setLoadingEvents(false);
      }
    },
    [getAccessToken]
  );

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (loadingSessions || sessions.length === 0) return;
    if (selectedSessionId !== undefined && sessions.some((session) => session.id === selectedSessionId)) return;
    const firstSession = sessions[0];
    if (firstSession === undefined) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('session', firstSession.id);
      return next;
    }, { replace: true });
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
    [search, sessions]
  );
  const timelineEvents = useMemo(() => projectSessionEventsForTimeline(events), [events]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);

  useEffect(() => {
    if (!restoreTimelineAfterNavigationRef.current) return;
    restoreTimelineAfterNavigationRef.current = false;
    timelinePaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    timelinePaneRef.current?.focus({ preventScroll: true });
  }, [selectedSessionId]);

  const selectSession = (sessionId: string): void => {
    restoreTimelineAfterNavigationRef.current =
      sessionId !== selectedSessionId && !window.matchMedia('(min-width: 1280px)').matches;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('session', sessionId);
      return next;
    });
  };

  const refresh = (): void => {
    void (async (): Promise<void> => {
      await loadSessions(true);
      if (selectedSessionId !== undefined) await loadEvents(selectedSessionId);
    })();
  };

  return (
    <section id="regular-sessions-panel" role="tabpanel" aria-label="Regular assistant sessions" className="min-w-0 space-y-4">
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={refresh} isLoading={refreshing} loadingText="Refreshing"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
      <ErrorBanner message={error} />
      <div className="grid min-h-[calc(100vh-14rem)] min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,23rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
        <div ref={timelinePaneRef} data-testid="intex-agent-session-timeline-pane" role="region" aria-label="Selected session timeline" tabIndex={-1} className="order-1 min-w-0 xl:order-2"><IntexSessionTimeline session={selectedSession} events={timelineEvents} loading={loadingEvents} /></div>
        <div data-testid="intex-agent-session-rail-pane" className="order-2 flex min-w-0 flex-col gap-3 xl:order-1">
          <label className="sr-only" htmlFor="intex-agent-session-search">Search sessions</label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input id="intex-agent-session-search" type="search" value={search} onChange={(event): void => { setSearch(event.target.value); }} placeholder="Search sessions" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" /></div>
          {search.trim() !== '' && visibleSessions.length === 0 ? <p className="text-sm text-slate-500">No sessions match {formatSessionValue(search)}.</p> : null}
          <IntexSessionRail sessions={visibleSessions} selectedSessionId={selectedSessionId} loading={loadingSessions} onSelect={selectSession} />
        </div>
      </div>
    </section>
  );
}

interface TestRunsViewProps {
  ownerKey: string;
  getAccessToken: AccessTokenGetter;
  searchParams: URLSearchParams;
  setSearchParams: SearchParamsSetter;
  onAccessRevoked: (ownerKey: string) => void;
}

type ReadChannel = 'list' | 'run' | 'scenario';
type ReadErrors = Record<ReadChannel, string | null>;

const EMPTY_READ_ERRORS: ReadErrors = { list: null, run: null, scenario: null };

interface KeyedRequest {
  key: string;
  controller: AbortController;
}

function ownsRequest(request: KeyedRequest | undefined, controller: AbortController): boolean {
  return request?.controller === controller;
}

function TestRunsView({
  ownerKey,
  getAccessToken,
  searchParams,
  setSearchParams,
  onAccessRevoked,
}: TestRunsViewProps): React.JSX.Element {
  const selectedRunId = searchParams.get('run') ?? undefined;
  const selectedScenarioId = searchParams.get('scenario') ?? undefined;
  const [runs, setRuns] = useState<PublicTestRunHeaderV1[]>([]);
  const [runDetail, setRunDetail] = useState<TestRunDtoV1 | undefined>();
  const [scenarioDetail, setScenarioDetail] = useState<TestScenarioDtoV1 | undefined>();
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pollDelayMs, setPollDelayMs] = useState(2_000);
  const [scenarioSyncDelayMs, setScenarioSyncDelayMs] = useState(2_000);
  const [readErrors, setReadErrors] = useState<ReadErrors>(EMPTY_READ_ERRORS);
  const generationRef = useRef(0);
  const listInFlightRef = useRef(false);
  const runInFlightRef = useRef<KeyedRequest | undefined>(undefined);
  const scenarioInFlightRef = useRef<KeyedRequest | undefined>(undefined);
  const controllersRef = useRef(new Set<AbortController>());
  const timelinePaneRef = useRef<HTMLDivElement>(null);
  const restoreTimelineAfterNavigationRef = useRef(false);
  const selectedRunIdRef = useRef(selectedRunId);
  const selectedScenarioIdRef = useRef(selectedScenarioId);
  const runsRef = useRef<PublicTestRunHeaderV1[]>(runs);
  selectedRunIdRef.current = selectedRunId;
  selectedScenarioIdRef.current = selectedScenarioId;
  runsRef.current = runs;

  const selectedRunHeader = runs.find((run) => run.runId === selectedRunId);
  const currentRunDetail =
    runDetail !== undefined &&
    runDetail.run.runId === selectedRunId &&
    (selectedRunHeader === undefined || runDetail.run.revision >= selectedRunHeader.revision)
      ? runDetail
      : undefined;
  const selectedScenarioSummary = currentRunDetail?.scenarios.find(
    (scenario) => scenario.scenarioId === selectedScenarioId
  );
  const currentScenarioDetail =
    scenarioDetail !== undefined &&
    scenarioDetail.runId === selectedRunId &&
    scenarioDetail.scenario.scenarioId === selectedScenarioId &&
    selectedScenarioSummary !== undefined &&
    scenarioDetail.scenario.scenarioRevision >= selectedScenarioSummary.scenarioRevision
      ? scenarioDetail
      : undefined;
  const selectedScenarioSummaryRef = useRef<PublicTestRunScenarioSummaryV1 | undefined>(
    selectedScenarioSummary
  );
  selectedScenarioSummaryRef.current = selectedScenarioSummary;

  const stale = Object.values(readErrors).some((message) => message !== null);
  const error = readErrors.scenario ?? readErrors.run ?? readErrors.list;

  const abortAll = useCallback((): void => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    listInFlightRef.current = false;
    runInFlightRef.current = undefined;
    scenarioInFlightRef.current = undefined;
  }, []);

  const clearOwnerData = useCallback((): void => {
    setRuns([]);
    setRunDetail(undefined);
    setScenarioDetail(undefined);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    abortAll();
    clearOwnerData();
    setReadErrors(EMPTY_READ_ERRORS);
    setPollDelayMs(2_000);
    setScenarioSyncDelayMs(2_000);
    return abortAll;
  }, [abortAll, clearOwnerData, ownerKey]);

  const createRequest = useCallback((): Readonly<{ controller: AbortController; generation: number }> => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return { controller, generation: generationRef.current };
  }, []);

  const finishRequest = useCallback((controller: AbortController): void => {
    controllersRef.current.delete(controller);
  }, []);

  const clearReadFailure = useCallback((channel: ReadChannel): void => {
    setReadErrors((current) =>
      current[channel] === null ? current : { ...current, [channel]: null }
    );
  }, []);

  const handleReadFailure = useCallback((channel: ReadChannel, caught: unknown): void => {
    if (caught instanceof ApiError && caught.code === 'ABORTED') return;
    if (isAuthorizationFailure(caught)) {
      generationRef.current += 1;
      abortAll();
      clearOwnerData();
      setReadErrors(EMPTY_READ_ERRORS);
      onAccessRevoked(ownerKey);
      return;
    }
    if (channel === 'run')
      setPollDelayMs((current) => Math.min(current * 2, 15_000));
    if (channel === 'scenario')
      setScenarioSyncDelayMs((current) => Math.min(current * 2, 15_000));
    const message =
      channel === 'list'
        ? 'Unable to refresh retained test runs.'
        : channel === 'run'
          ? 'Unable to refresh the selected test run.'
          : 'Unable to refresh the selected test scenario.';
    setReadErrors((current) => ({ ...current, [channel]: message }));
  }, [abortAll, clearOwnerData, onAccessRevoked, ownerKey]);

  const loadRuns = useCallback(async (initial = false): Promise<void> => {
    if (listInFlightRef.current || document.hidden) return;
    listInFlightRef.current = true;
    if (initial) setLoadingRuns(true);
    const request = createRequest();
    try {
      const token = await getAccessToken();
      const response = await listIntexAgentTestRuns(token, request.controller.signal);
      if (request.generation !== generationRef.current || request.controller.signal.aborted) return;
      setRuns((current) => response.runs.map((run) => chooseNewerRun(current.find((item) => item.runId === run.runId), run)));
      clearReadFailure('list');
    } catch (caught) {
      if (request.generation === generationRef.current && !request.controller.signal.aborted)
        handleReadFailure('list', caught);
    } finally {
      finishRequest(request.controller);
      listInFlightRef.current = false;
      setLoadingRuns(false);
    }
  }, [clearReadFailure, createRequest, finishRequest, getAccessToken, handleReadFailure]);

  const loadRun = useCallback(async (runId: string, initial = false): Promise<void> => {
    if (document.hidden) return;
    const inFlight = runInFlightRef.current;
    if (inFlight?.key === runId) return;
    inFlight?.controller.abort();
    if (initial) setLoadingRun(true);
    const request = createRequest();
    runInFlightRef.current = { key: runId, controller: request.controller };
    try {
      const token = await getAccessToken();
      const response = await getIntexAgentTestRun(token, runId, request.controller.signal);
      if (
        request.generation !== generationRef.current ||
        request.controller.signal.aborted ||
        selectedRunIdRef.current !== runId
      )
        return;
      const discoveredRun = runsRef.current.find((run) => run.runId === runId);
      if (discoveredRun !== undefined && response.run.revision < discoveredRun.revision) return;
      setRunDetail((current) => {
        if (current?.run.runId !== response.run.runId) return response;
        const acceptedRun = chooseNewerRun(current.run, response.run);
        const acceptedScenarios = response.scenarios.map((scenario) =>
          chooseNewerScenario(
            current.scenarios.find((item) => item.scenarioId === scenario.scenarioId),
            scenario
          )
        );
        const scenariosChanged = acceptedScenarios.some(
          (scenario, index) => scenario !== current.scenarios[index]
        );
        return acceptedRun === current.run && !scenariosChanged
          ? current
          : { ...response, run: acceptedRun, scenarios: acceptedScenarios };
      });
      setPollDelayMs(2_000);
      clearReadFailure('run');
    } catch (caught) {
      if (request.generation === generationRef.current && !request.controller.signal.aborted)
        handleReadFailure('run', caught);
    } finally {
      finishRequest(request.controller);
      if (ownsRequest(runInFlightRef.current, request.controller)) {
        runInFlightRef.current = undefined;
        setLoadingRun(false);
      }
    }
  }, [clearReadFailure, createRequest, finishRequest, getAccessToken, handleReadFailure]);

  const loadScenario = useCallback(async (runId: string, scenarioId: string, initial = false): Promise<void> => {
    if (document.hidden) return;
    const requestKey = `${runId}/${scenarioId}`;
    const inFlight = scenarioInFlightRef.current;
    if (inFlight?.key === requestKey) return;
    inFlight?.controller.abort();
    if (initial) setLoadingScenario(true);
    const request = createRequest();
    scenarioInFlightRef.current = { key: requestKey, controller: request.controller };
    try {
      const token = await getAccessToken();
      const response = await getIntexAgentTestScenario(token, runId, scenarioId, request.controller.signal);
      if (
        request.generation !== generationRef.current ||
        request.controller.signal.aborted ||
        selectedRunIdRef.current !== runId ||
        selectedScenarioIdRef.current !== scenarioId
      )
        return;
      const expectedScenario = selectedScenarioSummaryRef.current;
      const responseIsBehind =
        expectedScenario?.scenarioId === scenarioId &&
        response.scenario.scenarioRevision < expectedScenario.scenarioRevision;
      setScenarioDetail((current) => chooseNewerScenarioDetail(current, response));
      setScenarioSyncDelayMs((current) =>
        responseIsBehind ? Math.min(current * 2, 15_000) : 2_000
      );
      clearReadFailure('scenario');
    } catch (caught) {
      if (request.generation === generationRef.current && !request.controller.signal.aborted)
        handleReadFailure('scenario', caught);
    } finally {
      finishRequest(request.controller);
      if (ownsRequest(scenarioInFlightRef.current, request.controller)) {
        scenarioInFlightRef.current = undefined;
        setLoadingScenario(false);
      }
    }
  }, [clearReadFailure, createRequest, finishRequest, getAccessToken, handleReadFailure]);

  useEffect(() => { void loadRuns(true); }, [loadRuns, ownerKey]);

  useEffect(() => {
    if (loadingRuns) return;
    if (runs.length === 0) {
      setRunDetail(undefined);
      setScenarioDetail(undefined);
      if (selectedRunId !== undefined || selectedScenarioId !== undefined) {
        setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('run'); next.delete('scenario'); return next; }, { replace: true });
      }
      return;
    }
    const selected = selectedRunId === undefined ? undefined : runs.find((run) => run.runId === selectedRunId);
    const nextRunId = selected?.runId ?? runs[0]?.runId;
    if (nextRunId === undefined || nextRunId === selectedRunId) return;
    setRunDetail(undefined);
    setScenarioDetail(undefined);
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('run', nextRunId); next.delete('scenario'); return next; }, { replace: true });
  }, [loadingRuns, runs, selectedRunId, selectedScenarioId, setSearchParams]);

  useEffect(() => {
    if (selectedRunId === undefined || !runs.some((run) => run.runId === selectedRunId)) return;
    if (currentRunDetail !== undefined) return;
    void loadRun(selectedRunId, true);
  }, [currentRunDetail, loadRun, runs, selectedRunId]);

  useEffect(() => {
    if (currentRunDetail === undefined) return;
    const selected = selectedScenarioId === undefined ? undefined : currentRunDetail.scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId);
    const nextScenarioId = selected?.scenarioId ?? currentRunDetail.scenarios[0]?.scenarioId;
    if (nextScenarioId === undefined || nextScenarioId === selectedScenarioId) return;
    setScenarioDetail(undefined);
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('scenario', nextScenarioId); return next; }, { replace: true });
  }, [currentRunDetail, selectedScenarioId, setSearchParams]);

  useEffect(() => {
    if (currentRunDetail === undefined || selectedRunId === undefined || selectedScenarioId === undefined) return;
    const summary = currentRunDetail.scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId);
    if (summary === undefined) return;
    const detailIsCurrent =
      currentScenarioDetail !== undefined &&
      currentScenarioDetail.scenario.scenarioRevision >= summary.scenarioRevision;
    if (!detailIsCurrent) void loadScenario(selectedRunId, selectedScenarioId, currentScenarioDetail === undefined);
  }, [currentRunDetail, currentScenarioDetail, loadScenario, scenarioDetail, selectedRunId, selectedScenarioId]);

  useEffect(() => {
    if (
      selectedRunId === undefined ||
      selectedScenarioId === undefined ||
      selectedScenarioSummary === undefined ||
      currentScenarioDetail !== undefined
    )
      return;
    const interval = window.setInterval(() => {
      void loadScenario(selectedRunId, selectedScenarioId);
    }, scenarioSyncDelayMs);
    return (): void => { window.clearInterval(interval); };
  }, [
    currentScenarioDetail,
    loadScenario,
    scenarioSyncDelayMs,
    selectedRunId,
    selectedScenarioId,
    selectedScenarioSummary,
  ]);

  useEffect(() => {
    if (selectedRunId === undefined || selectedRunHeader === undefined) return;
    if (currentRunDetail !== undefined && !shouldPollRun(currentRunDetail.run)) return;
    const timeout = window.setTimeout(() => { void loadRun(selectedRunId); }, pollDelayMs);
    return (): void => { window.clearTimeout(timeout); };
  }, [currentRunDetail, loadRun, pollDelayMs, selectedRunHeader, selectedRunId]);

  useEffect(() => {
    const interval = window.setInterval(() => { void loadRuns(); }, 5_000);
    return (): void => { window.clearInterval(interval); };
  }, [loadRuns]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      void loadRuns();
      if (selectedRunId !== undefined) void loadRun(selectedRunId);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return (): void => { document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [loadRun, loadRuns, selectedRunId]);

  useEffect(() => {
    if (!restoreTimelineAfterNavigationRef.current || currentScenarioDetail?.scenario.scenarioId !== selectedScenarioId) return;
    restoreTimelineAfterNavigationRef.current = false;
    timelinePaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    timelinePaneRef.current?.focus({ preventScroll: true });
  }, [currentScenarioDetail, selectedScenarioId]);

  const selectRun = (runId: string): void => {
    runInFlightRef.current?.controller.abort();
    scenarioInFlightRef.current?.controller.abort();
    runInFlightRef.current = undefined;
    scenarioInFlightRef.current = undefined;
    selectedRunIdRef.current = runId;
    selectedScenarioIdRef.current = undefined;
    setScenarioSyncDelayMs(2_000);
    setReadErrors((current) => ({ ...current, run: null, scenario: null }));
    setRunDetail(undefined);
    setScenarioDetail(undefined);
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('run', runId); next.delete('scenario'); return next; });
  };

  const selectScenario = (scenarioId: string): void => {
    restoreTimelineAfterNavigationRef.current = scenarioId !== selectedScenarioId && !window.matchMedia('(min-width: 1280px)').matches;
    scenarioInFlightRef.current?.controller.abort();
    scenarioInFlightRef.current = undefined;
    selectedScenarioIdRef.current = scenarioId;
    setScenarioSyncDelayMs(2_000);
    clearReadFailure('scenario');
    setScenarioDetail(undefined);
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('scenario', scenarioId); return next; });
  };

  const refresh = (): void => {
    void (async (): Promise<void> => {
      setRefreshing(true);
      await loadRuns();
      if (selectedRunId !== undefined) await loadRun(selectedRunId);
      if (selectedRunId !== undefined && selectedScenarioId !== undefined) await loadScenario(selectedRunId, selectedScenarioId);
      setRefreshing(false);
    })();
  };

  const showRunShellLoading = currentRunDetail === undefined && (loadingRuns || loadingRun);

  return (
    <section id="test-runs-panel" role="tabpanel" aria-label="Test Runs" className="min-w-0 space-y-4">
      <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={refresh} isLoading={refreshing} loadingText="Refreshing"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
      <ErrorBanner message={error} />
      <IntexTestRunSelector runs={runs} selectedRunId={selectedRunId} loading={loadingRuns} loadFailed={readErrors.list !== null} onSelect={selectRun} />
      {currentRunDetail !== undefined ? <IntexTestRunHeader run={currentRunDetail.run} stale={stale} /> : showRunShellLoading ? <div aria-label="Loading test run" className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /> : null}
      {currentRunDetail !== undefined ? <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]"><div ref={timelinePaneRef} role="region" aria-label="Selected test scenario timeline" tabIndex={-1} className="order-1 min-w-0 xl:order-2"><IntexTestScenarioTimeline detail={currentScenarioDetail} loading={loadingScenario} /></div><div className="order-2 min-w-0 xl:order-1"><IntexTestScenarioRail scenarios={currentRunDetail.scenarios} selectedScenarioId={selectedScenarioId} loading={false} onSelect={selectScenario} /></div></div> : null}
      {showRunShellLoading ? <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]"><div className="order-1 min-w-0 xl:order-2"><IntexTestScenarioTimeline detail={undefined} loading /></div><div className="order-2 min-w-0 xl:order-1"><IntexTestScenarioRail scenarios={[]} selectedScenarioId={undefined} loading onSelect={selectScenario} /></div></div> : null}
      <div aria-live="polite" className="sr-only">{currentRunDetail === undefined ? '' : `${currentRunDetail.run.lifecycle} ${currentRunDetail.run.verdict}`}</div>
    </section>
  );
}

export function IntexAgentSessionsPage(): React.JSX.Element {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerKey = isAuthenticated ? user?.sub : undefined;
  const [capabilityResolution, setCapabilityResolution] = useState<{
    ownerKey: string | undefined;
    status: 'loading' | 'available' | 'unavailable';
    error: string | null;
  }>({ ownerKey: undefined, status: 'loading', error: null });
  const capability =
    capabilityResolution.ownerKey === ownerKey
      ? capabilityResolution.status
      : ownerKey === undefined
        ? 'unavailable'
        : 'loading';
  const capabilityError =
    capabilityResolution.ownerKey === ownerKey ? capabilityResolution.error : null;
  const requestedView = searchParams.get('view');
  const activeView: PageView = capability === 'available' && requestedView === 'test-runs' ? 'test-runs' : 'regular';

  useEffect(() => {
    const controller = new AbortController();
    setCapabilityResolution({ ownerKey, status: 'loading', error: null });
    if (ownerKey === undefined) {
      setCapabilityResolution({ ownerKey, status: 'unavailable', error: null });
      return (): void => { controller.abort(); };
    }
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const settings = await getUserSettings(token, ownerKey, controller.signal);
        if (controller.signal.aborted) return;
        if (settings.userId !== ownerKey) {
          setCapabilityResolution({
            ownerKey,
            status: 'unavailable',
            error: 'Test Runs availability could not be verified.',
          });
          return;
        }
        setCapabilityResolution({
          ownerKey,
          status:
            settings.intexAgentCapabilities.testRuns.status === 'available'
              ? 'available'
              : 'unavailable',
          error: null,
        });
      } catch {
        if (controller.signal.aborted) return;
        setCapabilityResolution({
          ownerKey,
          status: 'unavailable',
          error: 'Test Runs availability could not be verified.',
        });
      }
    })();
    return (): void => { controller.abort(); };
  }, [getAccessToken, ownerKey]);

  const revokeTestRuns = useCallback((revokedOwnerKey: string): void => {
    setCapabilityResolution((current) =>
      current.ownerKey === revokedOwnerKey
        ? { ownerKey: revokedOwnerKey, status: 'unavailable', error: null }
        : current
    );
  }, []);

  useEffect(() => {
    if (capability === 'loading') return;
    const testViewAllowed = capability === 'available' && requestedView === 'test-runs';
    const regularRequested = requestedView === null || requestedView === 'regular';
    if (testViewAllowed || (regularRequested && searchParams.get('run') === null && searchParams.get('scenario') === null)) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (requestedView !== null) next.set('view', 'regular');
      next.delete('run');
      next.delete('scenario');
      return next;
    }, { replace: true });
  }, [capability, requestedView, searchParams, setSearchParams]);

  const activateView = (view: PageView): void => {
    if (view === 'test-runs' && capability !== 'available') return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', view);
      if (view === 'regular') { next.delete('run'); next.delete('scenario'); }
      else next.delete('session');
      return next;
    });
  };

  return (
    <Layout>
      <div data-testid="intex-agent-session-shell" className="flex w-full min-w-0 flex-col gap-4">
        <header className="border-b border-slate-200 pb-4 dark:border-slate-800"><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Assistant Sessions</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">WhatsApp Assistant sessions and protected Matrix corpus Test Runs.</p></header>
        <ErrorBanner message={capabilityError} />
        {capability === 'loading' ? <div aria-label="Loading Assistant Sessions" className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /> : <><ViewTabs active={activeView} testRunsAvailable={capability === 'available'} onActivate={activateView} />{activeView === 'regular' ? <RegularSessionsView getAccessToken={getAccessToken} searchParams={searchParams} setSearchParams={setSearchParams} /> : ownerKey === undefined ? null : <TestRunsView key={ownerKey} ownerKey={ownerKey} getAccessToken={getAccessToken} searchParams={searchParams} setSearchParams={setSearchParams} onAccessRevoked={revokeTestRuns} />}</>}
      </div>
    </Layout>
  );
}
