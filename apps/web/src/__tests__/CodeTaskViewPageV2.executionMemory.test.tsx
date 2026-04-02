/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeTaskViewPageV2 } from '../pages/CodeTaskViewPageV2.js';
import type { CodeTask } from '@/types';

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

vi.mock('@/components/code-tasks/v2/V2TaskHeader.js', () => ({
  V2TaskHeader: (): React.JSX.Element => <div>header</div>,
}));

vi.mock('@/components/code-tasks/v2/V2LogStream.js', () => ({
  V2LogStream: (): React.JSX.Element => <div>logs</div>,
}));

vi.mock('@/components/code-tasks/v2/V2TaskActions.js', () => ({
  V2TaskActions: (): React.JSX.Element => <div>actions</div>,
}));

vi.mock('@/components/code-tasks/v2/V2NextSteps.js', () => ({
  V2NextSteps: (): React.JSX.Element => <div>next steps</div>,
}));

describe('CodeTaskViewPageV2 execution memory card', () => {
  it('renders matched memories, post-run status, and generated memory ids', () => {
    render(<CodeTaskViewPageV2 />);

    expect(screen.getByText('Execution Memory')).toBeInTheDocument();
    expect(screen.getByText('Verify route serialization')).toBeInTheDocument();
    expect(screen.getByText('verification_pattern')).toBeInTheDocument();
    expect(screen.getByText('0.91')).toBeInTheDocument();
    expect(screen.getByText('Post-run status')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('mem-new')).toBeInTheDocument();
    expect(screen.getByText('The prior verification memory helped.')).toBeInTheDocument();
  });
});
