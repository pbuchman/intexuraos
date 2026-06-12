/**
 * Tests for DispatchQueuePage rendering of future dispatch metadata (INT-1468).
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchQueuePage } from '../pages/DispatchQueuePage.js';
import type { CodeTaskSystemStatus, QueuedTask } from '../services/codeAgentApi.js';

vi.mock('react-router-dom', () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }): React.JSX.Element => <a href={to}>{children}</a>,
}));

const mockUseDispatchQueue = vi.fn();
const mockUseTimeTick = vi.fn();

vi.mock('@/hooks', () => ({
  useDispatchQueue: (): unknown => mockUseDispatchQueue(),
  useTimeTick: (interval: number): unknown => mockUseTimeTick(interval),
}));

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
}));

const baseScheduledTask = (
  source: 'user_scheduled' | 'retry_cooloff',
  text: string,
): QueuedTask => ({
  id: `task-${source}`,
  prompt: 'Do the thing',
  workerType: 'opus',
  queuedAt: '2026-04-24T09:00:00Z',
  createdAt: '2026-04-24T09:00:00Z',
  position: 1,
  dispatchEligibleAt: '2026-04-24T22:00:00Z',
  dispatchScheduleSource: source,
  dispatchScheduleText: text,
});

const blockerStatus: CodeTaskSystemStatus = {
  id: 'status-codex-auth',
  component: 'code-task-dispatch',
  status: 'active',
  severity: 'critical',
  workerType: 'codex-xhigh',
  reason: 'codex_auth_unavailable',
  message: 'No reachable worker has active Codex auth for codex-xhigh.',
  remediation: 'Refresh Codex/ChatGPT authentication on a worker that can run this task.',
  affectedTaskCount: 2,
  exampleTaskIds: ['task-1'],
  workerNames: ['home-mac'],
  firstSeenAt: '2026-06-05T10:00:00Z',
  lastSeenAt: '2026-06-05T10:10:00Z',
};

describe('DispatchQueuePage — future dispatch metadata (INT-1468)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Dispatches + Scheduled by user for a user_scheduled task', () => {
    mockUseDispatchQueue.mockReturnValue({
      tasks: [baseScheduledTask('user_scheduled', 'Scheduled by user')],
      systemStatuses: [],
      totalQueued: 1,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.getByText(/^Dispatches /)).toBeDefined();
    expect(screen.getByText('Scheduled by user')).toBeDefined();
    // Queue-entry time must stay visible
    expect(screen.getByText(/^Queued /)).toBeDefined();
  });

  it('renders Waiting for Claude reset label for a retry_cooloff task', () => {
    mockUseDispatchQueue.mockReturnValue({
      tasks: [baseScheduledTask('retry_cooloff', 'Waiting for Claude reset')],
      systemStatuses: [],
      totalQueued: 1,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.getByText(/^Dispatches /)).toBeDefined();
    expect(screen.getByText('Waiting for Claude reset')).toBeDefined();
  });

  it('does not render dispatch metadata rows when a task has no schedule', () => {
    const unscheduled: QueuedTask = {
      id: 'task-plain',
      prompt: 'Do the thing',
      workerType: 'opus',
      queuedAt: '2026-04-24T09:00:00Z',
      createdAt: '2026-04-24T09:00:00Z',
      position: 1,
    };
    mockUseDispatchQueue.mockReturnValue({
      tasks: [unscheduled],
      systemStatuses: [],
      totalQueued: 1,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.queryByText(/^Dispatches /)).toBeNull();
    expect(screen.queryByText('Scheduled by user')).toBeNull();
    expect(screen.queryByText('Waiting for Claude reset')).toBeNull();
  });

  it('renders active dispatch blocker system status details', () => {
    mockUseDispatchQueue.mockReturnValue({
      tasks: [],
      systemStatuses: [blockerStatus],
      totalQueued: 2,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.getByText('Dispatch blocked')).toBeDefined();
    expect(screen.getByText('codex-xhigh')).toBeDefined();
    expect(screen.getByText('codex auth unavailable')).toBeDefined();
    expect(screen.getByText('2 affected tasks')).toBeDefined();
    expect(screen.getByText('No reachable worker has active Codex auth for codex-xhigh.')).toBeDefined();
    expect(screen.getByText('Refresh Codex/ChatGPT authentication on a worker that can run this task.')).toBeDefined();
    expect(screen.getByText('home-mac')).toBeDefined();
  });
});
