/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { V2TaskHeader } from '../V2TaskHeader.js';
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

describe('V2TaskHeader execution memory chip', () => {
  it('renders matched, none, and error execution memory states', () => {
    const { rerender } = render(
      <V2TaskHeader
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

    expect(screen.getByText('Memory: 2 matches')).toBeInTheDocument();

    rerender(
      <V2TaskHeader
        task={createTask({
          executionMemoryContext: {
            status: 'none',
          },
        })}
        workerStatusTag={null}
      />
    );

    expect(screen.getByText('Memory: none')).toBeInTheDocument();

    rerender(
      <V2TaskHeader
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

    expect(screen.getByText('Memory: error')).toBeInTheDocument();
  });
});
