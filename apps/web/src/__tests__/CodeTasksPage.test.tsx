/**
 * Tests for CodeTasksPage rendering of live Linear issue data.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeTasksPage } from '../pages/CodeTasksPage.js';
import type { CodeTask } from '../types/index.js';

const mockNavigate = vi.fn();
const mockUseCodeTasks = vi.fn();
const mockUseWorkersStatus = vi.fn();
const localStorageState = new Map<string, string>();

const mockLocalStorage = {
  getItem: vi.fn((key: string): string | null => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string): void => {
    localStorageState.set(key, value);
  }),
  removeItem: vi.fn((key: string): void => {
    localStorageState.delete(key);
  }),
  clear: vi.fn((): void => {
    localStorageState.clear();
  }),
};

vi.stubGlobal('localStorage', mockLocalStorage);

vi.mock('react-router-dom', () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
  }): React.JSX.Element => <a href={to}>{children}</a>,
  useNavigate: (): typeof mockNavigate => mockNavigate,
}));

vi.mock('@/hooks', () => ({
  useCodeTasks: (): ReturnType<typeof mockUseCodeTasks> => mockUseCodeTasks(),
  useWorkersStatus: (): ReturnType<typeof mockUseWorkersStatus> => mockUseWorkersStatus(),
}));

vi.mock('@/components', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button';
    variant?: string;
    size?: string;
    className?: string;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <div>{children}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: (): React.JSX.Element => <span>ChevronDown</span>,
  ChevronUp: (): React.JSX.Element => <span>ChevronUp</span>,
  Filter: (): React.JSX.Element => <span>Filter</span>,
  Plus: (): React.JSX.Element => <span>Plus</span>,
  Trash2: (): React.JSX.Element => <span>Trash2</span>,
}));

function createTask(overrides?: Partial<CodeTask>): CodeTask {
  return {
    id: 'task-123',
    userId: 'user-123',
    prompt: 'Fallback prompt for code task',
    sanitizedPrompt: 'Fallback prompt for code task',
    systemPromptHash: 'hash-123',
    workerType: 'auto',
    workerLocation: 'mac',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    status: 'implemented',
    dedupKey: 'dedup-123',
    callbackReceived: false,
    createdAt: '2026-03-06T12:00:00.000Z',
    updatedAt: '2026-03-06T12:05:00.000Z',
    ...overrides,
  };
}

describe('CodeTasksPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorageState.clear();
    localStorage.clear();
  });

  it('renders live Linear issue data from task.linearIssue', () => {
    mockUseCodeTasks.mockReturnValue({
      tasks: [
        createTask({
          linearIssueId: 'INT-301',
          linearIssue: {
            identifier: 'INT-301',
            title: 'Hydrated Linear Issue',
            state: { name: 'In Progress', type: 'started' },
            priority: 1,
            assignee: { id: 'user-1', name: 'Test User' },
            labels: [{ id: 'label-1', name: 'backend' }],
            url: 'https://linear.app/intexuraos/issue/INT-301',
            commentCount: 2,
            lastCommentAt: '2026-03-06T12:01:00.000Z',
          },
        }),
      ],
      loading: false,
      loadingMore: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      deleteTask: vi.fn(),
    });
    mockUseWorkersStatus.mockReturnValue({
      status: { workers: [{ name: 'mac', status: 'healthy' }] },
    });

    render(<CodeTasksPage />);

    expect(screen.getByText('Hydrated Linear Issue')).toBeInTheDocument();
    expect(screen.getByText('backend')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'INT-301' })).toSatisfy((links) =>
      links.every((link) =>
        link.getAttribute('href') === 'https://linear.app/intexuraos/issue/INT-301'
      )
    );
  });

  it('falls back to the sanitized prompt when no linearIssue is available', () => {
    mockUseCodeTasks.mockReturnValue({
      tasks: [
        createTask({
          prompt: 'Prompt only task',
          sanitizedPrompt: 'Prompt only task',
        }),
      ],
      loading: false,
      loadingMore: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      deleteTask: vi.fn(),
    });
    mockUseWorkersStatus.mockReturnValue({
      status: { workers: [] },
    });

    render(<CodeTasksPage />);

    expect(screen.getAllByText('Prompt only task')).toHaveLength(2);
  });
});
