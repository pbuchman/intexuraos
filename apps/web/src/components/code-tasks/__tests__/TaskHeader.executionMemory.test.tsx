/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskHeader } from '../TaskHeader.js';
import type { CodeTask } from '@/types';

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    prompt: 'Test task',
    sanitizedPrompt: 'Test task',
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
    ...overrides,
  };
}

describe('TaskHeader execution memory chip', () => {
  it('renders matched, none, and error execution memory states', () => {
    const { rerender } = render(
      <TaskHeader
        task={createTask({
          executionMemoryContext: {
            status: 'matched',
            matchedMemories: [
              {
                memoryId: 'mem-1',
                title: 'Memory one',
                memoryType: 'verification_pattern',
                score: 0.91,
                appliesWhen: 'Route work',
                action: 'Add tests',
                avoid: 'Skip serialization',
                verification: 'app.inject',
              },
              {
                memoryId: 'mem-2',
                title: 'Memory two',
                memoryType: 'pitfall_pattern',
                score: 0.83,
                appliesWhen: 'Logging changes',
                action: 'Verify request logging',
                avoid: 'Silent route changes',
                verification: 'Inspect logs',
              },
            ],
          },
        })}
        workerStatusTag={null}
      />
    );

    const matchedChip = screen.getByText('Memory: 2 matches');
    expect(matchedChip).toBeInTheDocument();
    expect(matchedChip.className).toContain('bg-emerald-100');

    rerender(
      <TaskHeader
        task={createTask({
          executionMemoryContext: {
            status: 'none',
          },
        })}
        workerStatusTag={null}
      />
    );

    const noneChip = screen.getByText('Memory: none');
    expect(noneChip).toBeInTheDocument();
    expect(noneChip.className).toContain('bg-slate-100');

    rerender(
      <TaskHeader
        task={createTask({
          executionMemoryContext: {
            status: 'error',
            errorCode: 'embedding_failed',
            errorMessage: 'Embedding request failed',
          },
        })}
        workerStatusTag={null}
      />
    );

    const errorChip = screen.getByText('Memory: error');
    expect(errorChip).toBeInTheDocument();
    expect(errorChip.className).toContain('bg-red-100');
  });
});
