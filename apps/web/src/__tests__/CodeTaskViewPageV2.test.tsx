/**
 * Tests for CodeTaskViewPageV2 PR link fallback behavior.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeTaskViewPageV2 } from '../pages/CodeTaskViewPageV2.js';
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

vi.mock('@/components/code-tasks/v2/V2LogStream.js', () => ({
  V2LogStream: (): React.JSX.Element => <div>Log stream</div>,
}));

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

describe('CodeTaskViewPageV2', () => {
  beforeEach(() => {
    mockUseWorkersStatus.mockReturnValue({ status: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the GitHub action button for a running review task when prNumber exists but result.prUrl is missing', () => {
    mockUseTaskView.mockReturnValue(createTaskViewState(
      createTask({ prNumber: 1504 })
    ));

    render(<CodeTaskViewPageV2 />);

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

    render(<CodeTaskViewPageV2 />);

    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/pbuchman/intexuraos/pull/1600'
    );
  });

  it('does not show the GitHub action button when neither prNumber nor result.prUrl exists', () => {
    mockUseTaskView.mockReturnValue(createTaskViewState(
      createTask()
    ));

    render(<CodeTaskViewPageV2 />);

    expect(screen.queryByRole('link', { name: 'GitHub' })).not.toBeInTheDocument();
  });
});
