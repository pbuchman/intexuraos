/**
 * Tests for DispatchQueuePage rendering of future dispatch metadata (INT-1468).
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchQueuePage } from '../pages/DispatchQueuePage.js';
import type { QueuedTask } from '../services/codeAgentApi.js';

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

describe('DispatchQueuePage — future dispatch metadata (INT-1468)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Dispatches + Scheduled by user for a user_scheduled task', () => {
    mockUseDispatchQueue.mockReturnValue({
      tasks: [baseScheduledTask('user_scheduled', 'Scheduled by user')],
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
});
