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
  id: 'status-at-capacity',
  component: 'code-task-dispatch',
  status: 'active',
  severity: 'warning',
  workerType: 'codex-xhigh',
  reason: 'workers_at_capacity',
  message: 'All capable workers for codex-xhigh are currently at capacity.',
  remediation: 'Wait for a running task to finish or add worker capacity.',
  affectedTaskCount: 2,
  exampleTaskIds: ['task-1', 'task-2'],
  workerNames: ['home-mac'],
  firstSeenAt: '2026-06-05T10:00:00Z',
  lastSeenAt: '2026-06-05T10:10:00Z',
};

describe('DispatchQueuePage — future dispatch metadata (INT-1468)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T10:20:00Z'));
    mockUseDispatchQueue.mockReturnValue({
      tasks: [
        { ...baseScheduledTask('user_scheduled', 'Scheduled by user'), id: 'task-1', workerType: 'codex-xhigh' },
        { ...baseScheduledTask('retry_cooloff', 'Waiting for Claude reset'), id: 'task-2', workerType: 'codex-xhigh', position: 2 },
      ],
      systemStatuses: [blockerStatus],
      totalQueued: 2,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.getByText('Dispatch blocked')).toBeDefined();
    expect(screen.getAllByText('codex-xhigh')).toHaveLength(3);
    expect(screen.getByText('workers at capacity')).toBeDefined();
    expect(screen.getByText('2 affected tasks')).toBeDefined();
    expect(screen.getByText('All capable workers for codex-xhigh are currently at capacity.')).toBeDefined();
    expect(screen.getByText('Wait for a running task to finish or add worker capacity.')).toBeDefined();
    expect(screen.getByText('home-mac')).toBeDefined();
    expect(screen.getByText(/^Blocked since /).textContent).toContain('Jun 5, 2026');
    expect(screen.getByText(/^Last checked 10m ago/).textContent).toContain('Jun 5, 2026');
    expect(screen.getByText(/^Last checked 10m ago/).closest('time')?.getAttribute('datetime')).toBe(
      '2026-06-05T10:10:00Z'
    );
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('link', { name: 'task-1' }).getAttribute('href')).toBe('/code-tasks/task-1');
    expect(screen.getByRole('link', { name: 'task-2' }).getAttribute('href')).toBe('/code-tasks/task-2');
    expect(screen.queryByText('No tasks in the dispatch queue')).toBeNull();
  });

  it('ignores a stale aggregate when none of its affected tasks remains queued', () => {
    mockUseDispatchQueue.mockReturnValue({
      tasks: [],
      systemStatuses: [blockerStatus],
      totalQueued: 0,
      maxQueueSize: 10,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<DispatchQueuePage />);

    expect(screen.queryByText('Dispatch blocked')).toBeNull();
    expect(screen.getByText('No tasks in the dispatch queue')).toBeDefined();
  });
});
