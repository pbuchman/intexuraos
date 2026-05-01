/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TaskHeader } from '../TaskHeader.js';
import type { CodeTask } from '@/types';

function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-timeout',
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
    createdAt: '2026-05-01T12:00:00.000Z',
    updatedAt: '2026-05-01T12:05:00.000Z',
    ...overrides,
  };
}

describe('TaskHeader custom timeout badge (INT-1585)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the custom timeout badge when task.timeoutHours is set', () => {
    render(
      <TaskHeader task={createTask({ timeoutHours: 8 })} workerStatusTag={null} />,
    );
    expect(screen.getByText(/Custom timeout: 8h/)).toBeInTheDocument();
  });

  it('does not render the custom timeout badge when task.timeoutHours is undefined', () => {
    render(<TaskHeader task={createTask()} workerStatusTag={null} />);
    expect(screen.queryByText(/Custom timeout/)).not.toBeInTheDocument();
  });
});
