/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '@/types';
import type { IssueGroup } from '@/types/issueGroups';
import { CodeTasksPage } from '../pages/CodeTasksPage.js';

const mockUseIssueGroups = vi.fn();
const mockUseTimeTick = vi.fn();

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }): React.JSX.Element => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: () => Promise<string> } => ({
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }),
}));

vi.mock('@/hooks', () => ({
  useTimeTick: (...args: unknown[]): number => {
    mockUseTimeTick(...args);
    return 0;
  },
}));

vi.mock('@/hooks/useIssueGroups', () => ({
  useIssueGroups: (...args: unknown[]): unknown => mockUseIssueGroups(...args),
  useRapidPoll: (): { actioningTaskId: null; setActioningTaskId: ReturnType<typeof vi.fn> } => ({
    actioningTaskId: null,
    setActioningTaskId: vi.fn(),
  }),
}));

vi.mock('@/components', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => (
    <button type="button" {...props}>{children}</button>
  ),
  CodeTaskLogsModal: (): React.JSX.Element => <div>Logs modal</div>,
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
  TaskErrorModal: (): React.JSX.Element => <div />,
}));

vi.mock('@/components/code-tasks/IssueGroupRow', () => ({
  IssueGroupRow: ({ group }: { group: IssueGroup }): React.JSX.Element => (
    <div>{group.latestTask.id}</div>
  ),
}));

vi.mock('@/services/codeAgentApi', () => ({
  archiveCodeTask: vi.fn(),
  deleteCodeTask: vi.fn(),
  retryCodeTask: vi.fn(),
  startImplementation: vi.fn(),
}));

function terminalGroup(): IssueGroup {
  const task: CodeTask = {
    id: 'task-terminal',
    userId: 'user-1',
    prompt: 'Task',
    sanitizedPrompt: 'Task',
    systemPromptHash: 'hash-1',
    workerType: 'codex',
    workerLocation: 'home-dev',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: 'failed',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: '2026-07-27T12:20:00.000Z',
    statusChangedAt: '2026-07-27T12:28:15.885Z',
    completedAt: '2026-07-27T12:28:15.885Z',
    updatedAt: '2026-07-27T12:35:09.634Z',
  };
  return {
    linearIssueId: null,
    linearIssue: undefined,
    tasks: [task],
    pipeline: { steps: [], pr: null, failedAttempts: 1, archivedCount: 0 },
    latestTask: task,
    aggregateStatus: 'failed',
    lastActivityAt: task.statusChangedAt,
    lastActivityStatus: task.status,
    lastActivityTaskId: task.id,
    lastModifiedAt: task.updatedAt,
  };
}

describe('CodeTasksPage lifecycle controls', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseTimeTick.mockClear();
    mockUseIssueGroups.mockReturnValue({
      groups: [terminalGroup()],
      counts: { active: 0, 'needs-action': 0, done: 0, failed: 1, archived: 0 },
      totalGroups: 1,
      loading: false,
      loadingMore: false,
      refreshing: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      toggleImportant: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('labels lifecycle sorting Activity while retaining last-updated on the API boundary', () => {
    render(<CodeTasksPage />);

    expect(screen.getAllByText('Activity')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    expect(mockUseIssueGroups).toHaveBeenLastCalledWith(expect.objectContaining({
      sortBy: 'last-updated',
    }));
    expect(localStorage.getItem('code-tasks-sort')).toBe('last-updated');
  });

  it('keeps one shared relative-time tick alive for terminal-only groups', () => {
    render(<CodeTasksPage />);

    expect(mockUseTimeTick).toHaveBeenCalledWith(30000, true);
  });
});
