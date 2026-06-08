/**
 * Tests for CodeTaskViewPage behavioral rendering.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeTaskViewPage } from '../pages/CodeTaskViewPage.js';
import type { TaskViewState } from '../hooks/useTaskView.js';
import type { CodeTask } from '../types/index.js';

const mockNavigate = vi.fn();
const mockUseTaskView = vi.fn();
const mockUseWorkersStatus = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: (): typeof mockNavigate => mockNavigate,
  useParams: (): { id: string } => ({ id: 'task-123' }),
}));

vi.mock('@/hooks', () => ({
  useTaskView: (...args: unknown[]): ReturnType<typeof mockUseTaskView> => mockUseTaskView(...args),
  useWorkersStatus: (): ReturnType<typeof mockUseWorkersStatus> => mockUseWorkersStatus(),
}));

vi.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    isLoading,
    loadingText,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    loadingText?: string;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {isLoading === true ? loadingText : children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/MarkdownContent.js', () => ({
  MarkdownContent: ({ content }: { content: string }): React.JSX.Element => <div>{content}</div>,
}));

vi.mock('@/components/PREventsGroup.js', () => ({
  PREventsGroup: ({
    pullRequestNumber,
    repository,
  }: {
    pullRequestNumber: number;
    repository: string;
  }): React.JSX.Element => (
    <div>{`PR events: ${repository}#${String(pullRequestNumber)}`}</div>
  ),
}));

vi.mock('@/components/code-tasks/TaskHeader.js', () => ({
  TaskHeader: (): React.JSX.Element => <div>header</div>,
}));

vi.mock('@/components/code-tasks/LogStream.js', () => ({
  LogStream: (): React.JSX.Element => <div>Log stream</div>,
}));

// TaskActions is NOT mocked — these tests assert on the real GitHub link
// rendered by TaskActions via the `linkButtons` block when `prUrl` is set.

function createTask(overrides?: Partial<CodeTask>): CodeTask {
  return {
    id: 'task-123',
    userId: 'user-123',
    prompt: 'Review the PR',
    sanitizedPrompt: 'Review the PR',
    systemPromptHash: 'hash-123',
    workerType: 'codex',
    workerLocation: 'home-dev',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'main',
    traceId: 'trace-123',
    status: 'running',
    dedupKey: 'dedup-123',
    callbackReceived: false,
    createdAt: '2026-03-28T18:58:40.428Z',
    updatedAt: '2026-03-28T18:59:08.181Z',
    agentType: 'review',
    ...overrides,
  };
}

function createTaskViewState(task: CodeTask | null): TaskViewState {
  return {
    task,
    logs: [],
    loading: false,
    error: null,
    listenerHealthy: false,
    cancelling: false,
    cancelError: null,
    retrying: false,
    retryError: null,
    sending: false,
    sendError: null,
    messageStatus: 'idle',
    implementing: false,
    implementError: null,
    deleting: false,
    deleteError: null,
    cancelTask: vi.fn().mockResolvedValue(undefined),
    retryTask: vi.fn().mockResolvedValue('task-retry-123'),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    startImplementation: vi.fn().mockResolvedValue('task-impl-123'),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    clearDeleteError: vi.fn(),
    archiving: false,
    archiveError: null,
    archiveTask: vi.fn().mockResolvedValue(undefined),
    clearArchiveError: vi.fn(),
  };
}

describe('CodeTaskViewPage', () => {
  beforeEach(() => {
    mockUseWorkersStatus.mockReturnValue({ status: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('PR link fallback', () => {
    it('shows the GitHub action button for a running review task when prNumber exists but result.prUrl is missing', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask({ prNumber: 1504 })
      ));

      render(<CodeTaskViewPage />);

      expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
        'href',
        'https://github.com/pbuchman/intexuraos/pull/1504'
      );
    });

    it('still prefers result.prUrl when it is available', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask({
          status: 'implemented',
          prNumber: 1504,
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/1600' },
        })
      ));

      render(<CodeTaskViewPage />);

      expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
        'href',
        'https://github.com/pbuchman/intexuraos/pull/1600'
      );
    });

    it('does not show the GitHub action button when neither prNumber nor result.prUrl exists', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask()
      ));

      render(<CodeTaskViewPage />);

      expect(screen.queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
    });
  });

  describe('Implement button (isImplementable)', () => {
    it('shows Implement button for a planned task with linearIssueId and no implementation yet', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask({
          status: 'planned',
          agentType: 'planning',
          linearIssueId: 'INT-100',
        })
      ));

      render(<CodeTaskViewPage />);

      expect(screen.getByRole('button', { name: /Implement/ })).toBeInTheDocument();
    });
  });

  describe('dispatch status', () => {
    it('shows retry prognosis and remediation for a queued dispatch blocker', () => {
      const task = {
        ...createTask({ status: 'queued' }),
        dispatchStatus: {
          state: 'waiting',
          reason: 'workers_at_capacity',
          terminal: false,
          severity: 'warning',
          message: 'All capable workers for codex are currently at capacity.',
          remediation: 'Wait for a running task to finish or add worker capacity.',
          workerNames: ['home-dev'],
          firstSeenAt: '2026-06-05T12:00:00.000Z',
          lastSeenAt: '2026-06-05T12:05:00.000Z',
          nextAction: 'will_retry_automatically',
        },
      } as CodeTask;
      mockUseTaskView.mockReturnValue(createTaskViewState(task));

      render(<CodeTaskViewPage />);

      expect(screen.getByText('Dispatch Waiting')).toBeInTheDocument();
      expect(screen.getByText('All capable workers for codex are currently at capacity.')).toBeInTheDocument();
      expect(screen.getByText(/This task will retry automatically/)).toBeInTheDocument();
      expect(screen.getByText(/Wait for a running task to finish/)).toBeInTheDocument();
      expect(screen.getByText(/home-dev/)).toBeInTheDocument();
    });

    it('shows terminal dispatch remediation on failed tasks', () => {
      const task = {
        ...createTask({
          status: 'failed',
          error: {
            code: 'dispatch_blocked_no_enabled_workers',
            message: 'No enabled code-task workers are configured for codex.',
          },
        }),
        dispatchStatus: {
          state: 'terminal',
          reason: 'no_enabled_workers',
          terminal: true,
          severity: 'critical',
          message: 'No enabled code-task workers are configured for codex.',
          remediation: 'Enable or add a worker in worker settings, then retry dispatch.',
          workerNames: [],
          firstSeenAt: '2026-06-05T12:00:00.000Z',
          lastSeenAt: '2026-06-05T12:00:00.000Z',
          nextAction: 'retry_after_fix',
        },
      } as CodeTask;
      mockUseTaskView.mockReturnValue(createTaskViewState(task));

      render(<CodeTaskViewPage />);

      expect(screen.getByText('Dispatch Failed')).toBeInTheDocument();
      expect(screen.getAllByText('No enabled code-task workers are configured for codex.').length).toBeGreaterThan(0);
      expect(screen.getByText(/Fix the blocker, then retry this task/)).toBeInTheDocument();
      expect(screen.getByText(/Enable or add a worker/)).toBeInTheDocument();
    });
  });

  describe('Merge button (isMergeable)', () => {
    it('does NOT show Merge button for a planning-origin reviewed task without ready-to-merge label', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask({
          status: 'reviewed',
          agentType: 'review',
          prNumber: 42,
          result: { needs_remediation: '0' },
          linearIssue: {
            identifier: 'INT-100',
            title: 'Test',
            state: { name: 'In Progress', type: 'started' },
            priority: 1,
            assignee: null,
            labels: [{ name: 'code-task' }],
            url: 'https://linear.app/INT-100',
            commentCount: 0,
            lastCommentAt: null,
          },
        })
      ));

      render(<CodeTaskViewPage />);

      expect(screen.queryByRole('link', { name: /Merge/ })).not.toBeInTheDocument();
    });

    it('shows Merge button for an execution-origin reviewed task with ready-to-merge label', () => {
      mockUseTaskView.mockReturnValue(createTaskViewState(
        createTask({
          status: 'reviewed',
          agentType: 'review',
          prNumber: 42,
          result: { needs_remediation: '0', prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
          linearIssue: {
            identifier: 'INT-100',
            title: 'Test',
            state: { name: 'In Progress', type: 'started' },
            priority: 1,
            assignee: null,
            labels: [{ name: 'code-task' }, { name: 'ready-to-merge' }],
            url: 'https://linear.app/INT-100',
            commentCount: 0,
            lastCommentAt: null,
          },
        })
      ));

      render(<CodeTaskViewPage />);

      expect(screen.getByRole('link', { name: /Merge/ })).toBeInTheDocument();
    });
  });
});
