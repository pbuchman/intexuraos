/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';

const { mockGetAccessToken, mockListSessions, mockListEvents } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListSessions: vi.fn(),
  mockListEvents: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services', () => ({
  ApiError: class MockApiError extends Error {},
  listIntexAgentSessions: mockListSessions,
  listIntexAgentSessionEvents: mockListEvents,
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
    mockListSessions.mockResolvedValue([
      session('session-1', 'First selected session'),
      session('session-2', 'Second searchable session'),
    ]);
    mockListEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
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
});
