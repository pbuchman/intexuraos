/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeTaskViewPage } from '../pages/CodeTaskViewPage.js';
import type { CodeTask } from '@/types';

afterEach(() => {
  cleanup();
});

vi.mock('react-router-dom', () => ({
  useNavigate: (): ReturnType<typeof vi.fn> => vi.fn(),
  useParams: (): { id: string } => ({ id: 'task-1' }),
}));

const task: CodeTask = {
  id: 'task-1',
  userId: 'user-1',
  prompt: 'Fix callback logging',
  sanitizedPrompt: 'Fix callback logging',
  systemPromptHash: 'hash-1',
  workerType: 'auto',
  workerLocation: 'home-mac',
  repository: 'pbuchman/intexuraos',
  baseBranch: 'development',
  traceId: 'trace-1',
  status: 'implemented',
  dedupKey: 'dedup-1',
  callbackReceived: true,
  createdAt: '2026-03-25T12:00:00.000Z',
  updatedAt: '2026-03-25T12:05:00.000Z',
  result: {
    summary: 'Added request logging and route coverage.',
  },
  executionMemoryContext: {
    status: 'matched',
    applicationId: 'app-1',
    retrievalVersion: 'execution-memory-retrieval@1.0.0',
    querySummary: 'Callback route logging and verification work',
    matchedAt: '2026-03-25T12:02:00.000Z',
    totalSearchResults: 20,
    matchedMemories: [
      {
        memoryId: 'mem-1',
        title: 'Verify route serialization',
        memoryType: 'verification_pattern',
        score: 0.91,
        appliesWhen: 'Route schema changes',
        action: 'Add app.inject coverage',
        avoid: 'Do not skip serialization',
        verification: 'Check task detail response shape',
      },
      {
        memoryId: 'mem-2',
        title: 'Log request callback',
        memoryType: 'implementation_pattern',
        score: 0.88,
        appliesWhen: 'Callback handler development',
        action: 'Add req.log() before callback',
        avoid: 'Do not log sensitive data',
        verification: 'Verify logs appear in stream',
      },
    ],
    topCandidates: [
      {
        memoryId: 'mem-1',
        title: 'Verify route serialization',
        memoryType: 'verification_pattern',
        vectorScore: 0.85,
        rerankScore: 0.91,
        componentOverlap: 0.72,
        effectiveness: 0.65,
        passedThreshold: true,
      },
      {
        memoryId: 'mem-2',
        title: 'Log request callback',
        memoryType: 'implementation_pattern',
        vectorScore: 0.82,
        rerankScore: 0.88,
        componentOverlap: 0.68,
        effectiveness: 0.60,
        passedThreshold: true,
      },
      {
        memoryId: 'mem-3',
        title: 'Error handling pattern',
        memoryType: 'pitfall_pattern',
        vectorScore: 0.70,
        rerankScore: 0.75,
        componentOverlap: 0.55,
        effectiveness: 0.45,
        passedThreshold: false,
      },
      {
        memoryId: 'mem-4',
        title: 'Async test setup',
        memoryType: 'implementation_pattern',
        vectorScore: 0.65,
        rerankScore: 0.70,
        componentOverlap: 0.50,
        effectiveness: 0.40,
        passedThreshold: false,
      },
      {
        memoryId: 'mem-5',
        title: 'Mock service pattern',
        memoryType: 'verification_pattern',
        vectorScore: 0.60,
        rerankScore: 0.65,
        componentOverlap: 0.45,
        effectiveness: 0.35,
        passedThreshold: false,
      },
    ],
  },
  executionMemoryPostRun: {
    status: 'completed',
    attempts: 1,
    generatedMemoryIds: ['mem-new'],
    evaluationSummary: 'The prior verification memory helped.',
    completedAt: '2026-03-25T12:06:00.000Z',
  },
};

vi.mock('@/hooks', () => ({
  useTaskView: (): unknown => ({
    task,
    logs: [],
    loading: false,
    error: null,
    listenerHealthy: true,
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
    archiving: false,
    archiveError: null,
    cancelTask: vi.fn(),
    retryTask: vi.fn(),
    sendMessage: vi.fn(),
    startImplementation: vi.fn(),
    deleteTask: vi.fn(),
    clearDeleteError: vi.fn(),
    archiveTask: vi.fn(),
    clearArchiveError: vi.fn(),
  }),
  useWorkersStatus: (): unknown => ({
    status: null,
  }),
}));

vi.mock('@/components', () => ({
  Card: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock('@/components/MarkdownContent.js', () => ({
  MarkdownContent: ({ content }: { content: string }): React.JSX.Element => <div>{content}</div>,
}));

vi.mock('@/components/PREventsGroup.js', () => ({
  PREventsGroup: (): null => null,
}));

vi.mock('@/components/code-tasks/TaskHeader.js', () => ({
  TaskHeader: (): React.JSX.Element => <div>header</div>,
}));

vi.mock('@/components/code-tasks/LogStream.js', () => ({
  LogStream: (): React.JSX.Element => <div>logs</div>,
}));

vi.mock('@/components/code-tasks/TaskActions.js', () => ({
  TaskActions: (): React.JSX.Element => <div>actions</div>,
}));

vi.mock('@/components/code-tasks/NextSteps.js', () => ({
  NextSteps: (): React.JSX.Element => <div>next steps</div>,
}));

describe('CodeTaskViewPage execution memory card', () => {
  it('renders summary stats banner with search results count', () => {
    render(<CodeTaskViewPage />);

    expect(screen.getByText(/20 memories searched/)).toBeInTheDocument();
    expect(screen.getByText(/2 injected/)).toBeInTheDocument();
    expect(screen.getByText(/3 below threshold/)).toBeInTheDocument();
  });

  it('renders summary stats banner fallback when totalSearchResults undefined', () => {
    const original = task.executionMemoryContext;
    task.executionMemoryContext = {
      ...original,
      totalSearchResults: undefined,
    };

    try {
      render(<CodeTaskViewPage />);

      expect(screen.getByText(/5 candidates shown/)).toBeInTheDocument();
    } finally {
      task.executionMemoryContext = original;
    }
  });

  it('renders Injected badge for candidates above threshold', () => {
    render(<CodeTaskViewPage />);

    const badges = screen.getAllByText('Injected');
    expect(badges).toHaveLength(2);
    expect(badges[0]?.className).toContain('bg-emerald-100');
    expect(badges[0]?.className).toContain('text-emerald-700');
  });

  it('renders Candidate badge for candidates below threshold', () => {
    render(<CodeTaskViewPage />);

    const badges = screen.getAllByText('Candidate');
    expect(badges).toHaveLength(3);
    expect(badges[0]?.className).toContain('bg-slate-200');
    expect(badges[0]?.className).toContain('text-slate-600');
  });

  it('renders full detail for injected candidates', () => {
    render(<CodeTaskViewPage />);

    // Injected candidates show appliesWhen, action, avoid, verification
    expect(screen.getByText('Route schema changes')).toBeInTheDocument();
    expect(screen.getByText('Add app.inject coverage')).toBeInTheDocument();
    expect(screen.getByText('Do not skip serialization')).toBeInTheDocument();
    expect(screen.getByText('Check task detail response shape')).toBeInTheDocument();
    expect(screen.getByText('Callback handler development')).toBeInTheDocument();
    expect(screen.getByText('Add req.log() before callback')).toBeInTheDocument();
  });

  it('renders score breakdown for all candidates', () => {
    render(<CodeTaskViewPage />);

    // All candidates show rerankScore, vectorScore, componentOverlap, effectiveness
    expect(screen.getByText('0.910')).toBeInTheDocument(); // mem-1 rerankScore
    expect(screen.getByText('0.880')).toBeInTheDocument(); // mem-2 rerankScore
    expect(screen.getByText('0.750')).toBeInTheDocument(); // mem-3 rerankScore
    expect(screen.getByText('V:0.85')).toBeInTheDocument(); // mem-1 vectorScore
    expect(screen.getByText('C:0.72')).toBeInTheDocument(); // mem-1 componentOverlap
    expect(screen.getByText('E:0.65')).toBeInTheDocument(); // mem-1 effectiveness
  });

  it('renders emerald badge for matched status', () => {
    render(<CodeTaskViewPage />);

    const badges = screen.getAllByText('matched');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges[0]?.className).toContain('bg-emerald-100');
  });

  it('renders red badge for error status', () => {
    const original = task.executionMemoryContext;
    task.executionMemoryContext = {
      status: 'error',
      errorCode: 'vector_search_failed',
      errorMessage: 'Missing vector index',
    };

    try {
      render(<CodeTaskViewPage />);

      const badge = screen.getByText('error');
      expect(badge.className).toContain('bg-red-100');
    } finally {
      task.executionMemoryContext = original;
    }
  });

  it('renders post-run status and generated memory ids', () => {
    render(<CodeTaskViewPage />);

    expect(screen.getByText('Post-run status')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('mem-new')).toBeInTheDocument();
    expect(screen.getByText('The prior verification memory helped.')).toBeInTheDocument();
  });
});
