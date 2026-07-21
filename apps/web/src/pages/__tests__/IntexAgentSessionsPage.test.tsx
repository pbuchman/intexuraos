/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';
import { testRunHeader, testRunDto, testScenarioDto } from '@/testFixtures/intexAgentTestRuns.js';

const {
  mockGetAccessToken,
  mockGetUserSettings,
  mockListSessions,
  mockListEvents,
  mockListTestRuns,
  mockGetTestRun,
  mockGetTestScenario,
  mockAuth,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetUserSettings: vi.fn(),
  mockListSessions: vi.fn(),
  mockListEvents: vi.fn(),
  mockListTestRuns: vi.fn(),
  mockGetTestRun: vi.fn(),
  mockGetTestScenario: vi.fn(),
  mockAuth: { userId: 'auth0:user_1' },
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    isAuthenticated: true;
    user: { sub: string };
    getAccessToken: typeof mockGetAccessToken;
  } => ({
    isAuthenticated: true,
    user: { sub: mockAuth.userId },
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services', () => ({
  ApiError: class MockApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  getUserSettings: mockGetUserSettings,
  listIntexAgentSessions: mockListSessions,
  listIntexAgentSessionEvents: mockListEvents,
  listIntexAgentTestRuns: mockListTestRuns,
  getIntexAgentTestRun: mockGetTestRun,
  getIntexAgentTestScenario: mockGetTestScenario,
}));

vi.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ErrorBanner: ({ message }: { message: string | null }): React.JSX.Element | null =>
    message === null ? null : <div>{message}</div>,
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
}));

import { IntexAgentSessionsPage } from '../IntexAgentSessionsPage.js';
import { ApiError } from '@/services';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <output aria-label="Current query">{location.search}</output>;
}

function HistoryBack(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={(): void => { navigate(-1); }}>
      Back in history
    </button>
  );
}

function session(id: string, summary: string): IntexAgentSession {
  return {
    id,
    userId: 'user-1',
    channel: 'whatsapp',
    status: 'active',
    startedAt: '2026-06-24T16:10:19.341Z',
    lastUserMessageAt: '2026-06-24T16:10:19.341Z',
    startReason: 'no_active_session',
    summary,
  };
}

function event(
  id: string,
  type: IntexAgentSessionEvent['type'],
  payload: Record<string, unknown>,
  createdAt: string
): IntexAgentSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    type,
    payload,
    createdAt,
  };
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: query === '(min-width: 1280px)' && width >= 1280,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

describe('IntexAgentSessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockAuth.userId = 'auth0:user_1';
    mockGetUserSettings.mockResolvedValue({
      userId: 'auth0:user_1',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
      intexAgentCapabilities: {
        testRuns: { status: 'available', runtimeAudience: 'home-dev' },
      },
    });
    mockListSessions.mockResolvedValue([
      session('session-1', 'First selected session'),
      session('session-2', 'Second searchable session'),
    ]);
    mockListEvents.mockResolvedValue([]);
    mockListTestRuns.mockResolvedValue({ runs: [testRunHeader()] });
    mockGetTestRun.mockResolvedValue(testRunDto());
    mockGetTestScenario.mockResolvedValue(testScenarioDto());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('puts the selected timeline before the rail below xl and preserves accessible search', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?session=session-1']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await screen.findByText('2 visible');

    const timelinePane = screen.getByTestId('intex-agent-session-timeline-pane');
    const railPane = screen.getByTestId('intex-agent-session-rail-pane');
    expect(
      timelinePane.compareDocumentPosition(railPane) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
    expect(timelinePane).toHaveClass('order-1', 'min-w-0', 'xl:order-2');
    expect(railPane).toHaveClass('order-2', 'min-w-0', 'xl:order-1');
    expect(screen.getByTestId('intex-agent-session-shell')).toHaveClass('w-full', 'min-w-0');

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    expect(railPane).toContainElement(search);
    await user.type(search, 'Second searchable');

    await waitFor(() => {
      expect(screen.getByText('1 visible')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Second searchable session/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /First selected session/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First selected session' })).toBeInTheDocument();
  });

  it('returns focus and scrolls to the selected timeline after mobile rail navigation', async () => {
    setViewportWidth(1279);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?session=session-1']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'First selected session' });
    const timelinePane = screen.getByTestId('intex-agent-session-timeline-pane');

    await user.click(screen.getByRole('button', { name: /Second searchable session/i }));

    await screen.findByRole('heading', { name: 'Second searchable session' });
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1280px)');
    expect(timelinePane.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(timelinePane).toHaveFocus();
    expect(timelinePane).toHaveAttribute('tabindex', '-1');
  });

  it('keeps focus and scroll position on the rail at the xl breakpoint', async () => {
    setViewportWidth(1280);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?session=session-1']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'First selected session' });
    const timelinePane = screen.getByTestId('intex-agent-session-timeline-pane');
    const secondSessionButton = screen.getByRole('button', {
      name: /Second searchable session/i,
    });

    await user.click(secondSessionButton);

    await screen.findByRole('heading', { name: 'Second searchable session' });
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1280px)');
    expect(timelinePane.scrollIntoView).not.toHaveBeenCalled();
    expect(secondSessionButton).toHaveFocus();
  });

  it('projects an immediately repeated clarification reply before rendering the timeline', async () => {
    const persistedEvents = [
      event(
        'clarification',
        'clarification_requested',
        { message: '  Which day\nshould I use?  ' },
        '2026-06-24T16:10:20.000Z'
      ),
      event(
        'duplicate-assistant',
        'assistant_message',
        { text: 'Which day should I use?' },
        '2026-06-24T16:10:21.000Z'
      ),
    ];
    mockListSessions.mockResolvedValue([session('session-1', 'First selected session')]);
    mockListEvents.mockResolvedValue(persistedEvents);

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?session=session-1']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await screen.findByText('Clarification requested');

    expect(screen.getAllByText('Which day should I use?')).toHaveLength(1);
    expect(screen.queryByText('IntexuraOS')).not.toBeInTheDocument();
    expect(persistedEvents.map((item) => item.id)).toEqual([
      'clarification',
      'duplicate-assistant',
    ]);
  });

  it('constructs no Test Runs tab, request, or deep-link state when capability is unavailable', async () => {
    mockGetUserSettings.mockResolvedValue({
      userId: 'auth0:user_1',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
      intexAgentCapabilities: { testRuns: { status: 'unavailable' } },
    });
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=private&scenario=private']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await screen.findByText('2 visible');
    expect(screen.queryByRole('tab', { name: 'Test Runs' })).not.toBeInTheDocument();
    expect(mockListTestRuns).not.toHaveBeenCalled();
    expect(mockGetTestRun).not.toHaveBeenCalled();
    expect(mockGetTestScenario).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText('Current query')).not.toHaveTextContent(/run=|scenario=|test-runs/);
    });
  });

  it('loads an available owner deep link through strict list, run, and scenario reads', async () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Selected test run')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Test Runs' })).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByRole('heading', { name: /Scenario 001.*Catalog label 1/i })
    ).toBeInTheDocument();
    expect(mockGetUserSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockListTestRuns.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(mockGetTestRun).toHaveBeenCalledWith('test-token', 'run_1', expect.any(AbortSignal));
    expect(mockGetTestScenario).toHaveBeenCalledWith(
      'test-token',
      'run_1',
      'scenario_001',
      expect.any(AbortSignal)
    );
  });

  it('keeps selector, header, rail, and timeline structure stable during initial Test Runs loading', async () => {
    const listRequest = createDeferred<{ runs: ReturnType<typeof testRunHeader>[] }>();
    mockListTestRuns.mockReturnValue(listRequest.promise);

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByLabelText('Loading test runs')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading test run')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading test scenarios')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading scenario timeline')).toBeInTheDocument();

    await act(async () => {
      listRequest.resolve({ runs: [testRunHeader()] });
      await listRequest.promise;
    });
  });

  it('does not present a failed initial discovery request as an empty retained collection', async () => {
    mockListTestRuns.mockRejectedValueOnce(new Error('private list failure'));

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Unable to refresh retained test runs.')).toBeInTheDocument();
    expect(screen.queryByText('No test runs yet')).not.toBeInTheDocument();
    expect(screen.queryByText('private list failure')).not.toBeInTheDocument();
  });

  it('replaces stale run and scenario IDs with the first retained owner projection', async () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=stale&scenario=stale']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await screen.findByText('Selected test run');
    await waitFor(() => {
      expect(screen.getByLabelText('Current query')).toHaveTextContent(
        'view=test-runs&run=run_1&scenario=scenario_001'
      );
    });
    expect(mockGetTestRun).not.toHaveBeenCalledWith(
      'test-token',
      'stale',
      expect.anything()
    );
  });

  it('uses manual keyboard tab activation and creates Test Runs requests only on activation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    const regular = await screen.findByRole('tab', { name: 'Regular' });
    const testRuns = screen.getByRole('tab', { name: 'Test Runs' });
    regular.focus();
    await user.keyboard('{ArrowRight}');
    expect(testRuns).toHaveFocus();
    expect(regular).toHaveAttribute('aria-selected', 'true');
    expect(mockListTestRuns).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    await screen.findByText('Selected test run');
    expect(testRuns).toHaveAttribute('aria-selected', 'true');
  });

  it('follows browser history between regular sessions and Test Runs', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions']}>
        <IntexAgentSessionsPage />
        <HistoryBack />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('tab', { name: 'Test Runs' }));
    await screen.findByText('Selected test run');
    await user.click(screen.getByRole('button', { name: 'Back in history' }));

    expect(await screen.findByRole('tab', { name: 'Regular' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.queryByText('Selected test run')).not.toBeInTheDocument();
  });

  it('aborts owner work and clears Test Runs when the authenticated user loses capability', async () => {
    let selectedRunSignal: AbortSignal | undefined;
    mockGetTestRun.mockImplementationOnce(
      (_token: string, _runId: string, signal: AbortSignal) => {
        selectedRunSignal = signal;
        return new Promise(() => undefined);
      }
    );
    const rendered = render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => { expect(mockGetTestRun).toHaveBeenCalledTimes(1); });
    mockAuth.userId = 'auth0:user_2';
    mockGetUserSettings.mockResolvedValue({
      userId: 'auth0:user_2',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
      intexAgentCapabilities: { testRuns: { status: 'unavailable' } },
    });
    rendered.rerender(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.queryByRole('tab', { name: 'Test Runs' })).not.toBeInTheDocument();
    await screen.findByText('2 visible');
    expect(selectedRunSignal?.aborted).toBe(true);
    expect(screen.queryByRole('tab', { name: 'Test Runs' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Current query')).not.toHaveTextContent(/run=|scenario=|test-runs/);
    });
  });

  it('rejects a capability response whose userId does not match the authenticated owner', async () => {
    mockGetUserSettings.mockResolvedValue({
      userId: 'auth0:someone_else',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
      intexAgentCapabilities: {
        testRuns: { status: 'available', runtimeAudience: 'home-dev' },
      },
    });

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=private']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await screen.findByText('Test Runs availability could not be verified.');
    expect(screen.queryByRole('tab', { name: 'Test Runs' })).not.toBeInTheDocument();
    expect(mockListTestRuns).not.toHaveBeenCalled();
    expect(screen.queryByText('auth0:someone_else')).not.toBeInTheDocument();
  });

  it('revokes Test Runs after an authorization failure without exposing backend text', async () => {
    mockGetTestScenario.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', 'private backend payload for user-1', 403)
    );
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Test Runs' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/private backend payload/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Current query')).not.toHaveTextContent(/run=|scenario=|test-runs/);
    });
  });

  it('aborts stale scenario work and shows only the current mobile selection', async () => {
    setViewportWidth(1279);
    const firstScenario = createDeferred<ReturnType<typeof testScenarioDto>>();
    const secondScenario = createDeferred<ReturnType<typeof testScenarioDto>>();
    let firstSignal: AbortSignal | undefined;
    mockGetTestScenario.mockImplementation(
      (_token: string, _runId: string, scenarioId: string, signal: AbortSignal) => {
        if (scenarioId === 'scenario_001') {
          firstSignal = signal;
          return firstScenario.promise;
        }
        return secondScenario.promise;
      }
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    const secondButton = await screen.findByRole('button', { name: /Scenario 002/i });
    await waitFor(() => { expect(mockGetTestScenario).toHaveBeenCalledTimes(1); });
    await user.click(secondButton);
    await waitFor(() => { expect(mockGetTestScenario).toHaveBeenCalledTimes(2); });
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      secondScenario.resolve(testScenarioDto({ scenario: testRunDto().scenarios[1] }));
      await secondScenario.promise;
    });
    expect(await screen.findByRole('heading', { name: /Scenario 002.*Catalog label 2/i })).toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Selected test scenario timeline' });
    expect(timeline.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(timeline).toHaveFocus();

    await act(async () => {
      firstScenario.resolve(testScenarioDto());
      await firstScenario.promise;
    });
    expect(screen.getByRole('heading', { name: /Scenario 002.*Catalog label 2/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Scenario 001.*Catalog label 1/i })).not.toBeInTheDocument();
  });

  it('does not render scenario detail older than the selected run summary', async () => {
    const currentScenario = {
      ...testRunDto().scenarios[0],
      scenarioRevision: 2,
      scenarioLabel: 'Current catalog label',
      lifecycle: 'completed' as const,
      verdict: 'passed' as const,
    };
    mockGetTestRun.mockResolvedValue(
      testRunDto({
        scenarios: testRunDto().scenarios.map((scenario, index) =>
          index === 0 ? currentScenario : scenario
        ),
      })
    );
    mockGetTestScenario
      .mockResolvedValueOnce(
        testScenarioDto({
          scenario: {
            ...testRunDto().scenarios[0],
            scenarioLabel: 'Stale private label',
          },
        })
      )
      .mockResolvedValue(
        testScenarioDto({
          scenario: currentScenario,
        })
      );

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: /Scenario 001.*Current catalog label/i })
    ).toBeInTheDocument();
    expect(mockGetTestScenario).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Stale private label/i)).not.toBeInTheDocument();
  });

  it('retries a repeatedly stale terminal scenario with bounded backoff', async () => {
    vi.useFakeTimers();
    const terminalHeader = testRunHeader({
      lifecycle: 'completed',
      verdict: 'passed',
      artifactDelivery: {
        status: 'ready',
        failureCode: null,
        updatedAt: '2026-07-20T10:05:00.000Z',
      },
      finishedAt: '2026-07-20T10:05:00.000Z',
    });
    const currentScenario = {
      ...testRunDto().scenarios[0],
      scenarioRevision: 2,
      scenarioLabel: 'Current terminal label',
      lifecycle: 'completed' as const,
      verdict: 'passed' as const,
    };
    const currentRun = testRunDto({
      run: terminalHeader,
      scenarios: testRunDto().scenarios.map((scenario, index) =>
        index === 0 ? currentScenario : scenario
      ),
    });
    const staleDetail = testScenarioDto({
      scenario: {
        ...testRunDto().scenarios[0],
        scenarioLabel: 'Repeated stale private label',
      },
    });
    mockListTestRuns.mockResolvedValue({ runs: [terminalHeader] });
    mockGetTestRun.mockResolvedValue(currentRun);
    mockGetTestScenario
      .mockResolvedValueOnce(staleDetail)
      .mockResolvedValueOnce(staleDetail)
      .mockResolvedValue(testScenarioDto({ scenario: currentScenario }));

    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    expect(screen.queryByText(/Repeated stale private label/i)).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(
      screen.getByRole('heading', { name: /Scenario 001.*Current terminal label/i })
    ).toBeInTheDocument();
    expect(mockGetTestScenario.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('backs off repeated scenario endpoint failures independently', async () => {
    vi.useFakeTimers();
    mockGetTestScenario.mockRejectedValue(new Error('private scenario endpoint failure'));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Unable to refresh the selected test scenario.')).toBeInTheDocument();
    expect(screen.queryByText(/private scenario endpoint failure/i)).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(7_999); });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(3);
  });

  it('does not let a delayed older revision regress a completed run', async () => {
    const user = userEvent.setup();
    const completed = testRunHeader({
      revision: 5,
      lifecycle: 'completed',
      verdict: 'passed',
      artifactDelivery: {
        status: 'ready',
        failureCode: null,
        updatedAt: '2026-07-20T10:05:00.000Z',
      },
      finishedAt: '2026-07-20T10:05:00.000Z',
    });
    mockListTestRuns.mockResolvedValue({ runs: [completed] });
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto({ run: completed }))
      .mockResolvedValue(
        testRunDto({ run: testRunHeader({ revision: 4, lifecycle: 'running' }) })
      );
    mockGetTestScenario.mockResolvedValue(testScenarioDto({ runRevision: 5 }));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Completed · Passed' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => { expect(mockGetTestRun).toHaveBeenCalledTimes(2); });
    expect(screen.getByRole('heading', { name: 'Completed · Passed' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Running · Pending' })).not.toBeInTheDocument();
  });

  it('does not regress artifact delivery when the run revision is unchanged', async () => {
    const user = userEvent.setup();
    const ready = testRunHeader({
      revision: 5,
      lifecycle: 'completed',
      verdict: 'passed',
      artifactDelivery: {
        status: 'ready',
        failureCode: null,
        updatedAt: '2026-07-20T10:05:00.000Z',
      },
      finishedAt: '2026-07-20T10:05:00.000Z',
    });
    const regressed = testRunHeader({
      ...ready,
      artifactDelivery: {
        status: 'failed',
        failureCode: 'REPORT_PUBLICATION_FAILED',
        updatedAt: '2026-07-20T10:04:00.000Z',
      },
    });
    mockListTestRuns.mockResolvedValue({ runs: [ready] });
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto({ run: ready }))
      .mockResolvedValue(testRunDto({ run: regressed }));
    mockGetTestScenario.mockResolvedValue(testScenarioDto({ runRevision: 5 }));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Report ready')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => { expect(mockGetTestRun).toHaveBeenCalledTimes(2); });
    expect(screen.getByText('Report ready')).toBeInTheDocument();
    expect(screen.queryByText('Report publication failed')).not.toBeInTheDocument();
  });

  it('continues a terminal staged report poll and stops once delivery is ready', async () => {
    vi.useFakeTimers();
    const staged = testRunHeader({
      revision: 3,
      lifecycle: 'completed',
      verdict: 'passed',
      artifactDelivery: {
        status: 'staged',
        failureCode: null,
        updatedAt: '2026-07-20T10:03:00.000Z',
      },
      finishedAt: '2026-07-20T10:03:00.000Z',
    });
    const ready = testRunHeader({
      ...staged,
      revision: 4,
      artifactDelivery: {
        status: 'ready',
        failureCode: null,
        updatedAt: '2026-07-20T10:04:00.000Z',
      },
    });
    mockListTestRuns.mockResolvedValue({ runs: [ready] });
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto({ run: staged }))
      .mockResolvedValue(testRunDto({ run: ready }));
    mockGetTestScenario.mockResolvedValue(testScenarioDto({ runRevision: 4 }));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(mockGetTestRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Report staged')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
  });

  it('retains the last complete projection and backs off after a transient polling failure', async () => {
    vi.useFakeTimers();
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto())
      .mockRejectedValueOnce(new Error('temporary upstream detail'))
      .mockResolvedValue(testRunDto());
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(mockGetTestRun).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Running · Pending' })).toBeInTheDocument();
    expect(screen.getByText('Live updates paused')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(3);
  });

  it('keeps a static run error visible when discovery polling succeeds', async () => {
    vi.useFakeTimers();
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto())
      .mockRejectedValue(new Error('private upstream detail for user-1'));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(mockGetTestRun).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Unable to refresh the selected test run.')).toBeInTheDocument();
    expect(screen.queryByText(/private upstream detail/i)).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mockListTestRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Unable to refresh the selected test run.')).toBeInTheDocument();
  });

  it('refreshes run discovery and selected state immediately when the page becomes visible', async () => {
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );
    await screen.findByRole('heading', { name: /Scenario 001.*Catalog label 1/i });
    const initialListCalls = mockListTestRuns.mock.calls.length;
    const initialRunCalls = mockGetTestRun.mock.calls.length;

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(mockListTestRuns.mock.calls.length).toBeGreaterThan(initialListCalls);
      expect(mockGetTestRun.mock.calls.length).toBeGreaterThan(initialRunCalls);
    });
    Reflect.deleteProperty(document, 'hidden');
  });

  it('polls active run state at two seconds, discovery at five, and refreshes scenario only after revision advances', async () => {
    vi.useFakeTimers();
    const advancedRun = testRunDto({
      run: testRunHeader({ revision: 4 }),
      scenarios: testRunDto().scenarios.map((scenario, index) =>
        index === 0 ? { ...scenario, scenarioRevision: 2 } : scenario
      ),
    });
    mockGetTestRun.mockResolvedValueOnce(testRunDto()).mockResolvedValue(advancedRun);
    mockGetTestScenario
      .mockResolvedValueOnce(testScenarioDto())
      .mockResolvedValue(testScenarioDto({
        runRevision: 4,
        scenario: { ...testScenarioDto().scenario, scenarioRevision: 2 },
      }));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mockGetTestRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockGetTestScenario).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(mockListTestRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not reload scenario detail when only the run revision advances', async () => {
    vi.useFakeTimers();
    mockGetTestRun
      .mockResolvedValueOnce(testRunDto())
      .mockResolvedValue(testRunDto({ run: testRunHeader({ revision: 4 }) }));
    render(
      <MemoryRouter initialEntries={['/intex-agent/sessions?view=test-runs&run=run_1&scenario=scenario_001']}>
        <IntexAgentSessionsPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
    expect(mockGetTestScenario).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mockGetTestRun).toHaveBeenCalledTimes(2);
    expect(mockGetTestScenario).toHaveBeenCalledTimes(1);
  });
});
