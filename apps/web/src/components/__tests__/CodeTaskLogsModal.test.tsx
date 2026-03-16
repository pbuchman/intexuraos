/**
 * Tests for CodeTaskLogsModal.
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeTaskLogsModal } from '../CodeTaskLogsModal.js';

const mockUseCodeTaskLogs = vi.fn();

vi.mock('@/hooks/useCodeTaskLogs.js', () => ({
  useCodeTaskLogs: (taskId: string): ReturnType<typeof mockUseCodeTaskLogs> => mockUseCodeTaskLogs(taskId),
}));

describe('CodeTaskLogsModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders logs in read-only mode with follow enabled by default', () => {
    mockUseCodeTaskLogs.mockReturnValue({
      task: {
        id: 'task-123',
        status: 'running',
      },
      logs: [{ sequence: 1, text: '[tool] hello' }],
      loading: false,
      error: null,
      listenerHealthy: true,
      refreshTask: vi.fn(),
    });

    render(<CodeTaskLogsModal taskId="task-123" onClose={vi.fn()} />);

    expect(screen.getByText('Execution Logs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('[tool] hello')).toBeInTheDocument();
  });

  it('closes on escape and backdrop click', () => {
    const onClose = vi.fn();
    mockUseCodeTaskLogs.mockReturnValue({
      task: {
        id: 'task-123',
        status: 'implemented',
      },
      logs: [],
      loading: false,
      error: null,
      listenerHealthy: false,
      refreshTask: vi.fn(),
    });

    render(<CodeTaskLogsModal taskId="task-123" onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
