/**
 * Tests for TaskConflictModal component.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskConflictModal } from '../TaskConflictModal.js';
import type { ConflictReason } from '../TaskConflictModal.js';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertTriangle: (): React.JSX.Element => <div data-testid="alert-icon" />,
}));

// Mock Button component
vi.mock('../ui/Button.js', () => ({
  // @allow-missing-return-type -- Test mock, not production code
  Button: ({
    children,
    onClick,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }): React.JSX.Element => (
    <button
      onClick={onClick}
      data-variant={variant ?? 'primary'}
      type="button"
    >
      {children}
    </button>
  ),
}));

describe('TaskConflictModal', () => {
  const defaultProps = {
    isOpen: true,
    taskId: 'task_fa7666d5-bdf1-4498-b52b-1c12af89a578',
    reason: 'duplicate' as ConflictReason,
    onClose: vi.fn(),
    onNavigateToTask: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  describe('Rendering with different reasons', () => {
    it('renders modal with duplicate reason', () => {
      render(<TaskConflictModal {...defaultProps} reason="duplicate" />);

      // Title is rendered both as sr-only Dialog.Title and visible h2
      expect(screen.getAllByText('Similar task detected').length).toBeGreaterThan(0);
      expect(
        screen.getByText(/A similar task was submitted in the last 5 minutes/)
      ).toBeInTheDocument();
      expect(screen.getByText(/task_fa7666d5-bdf1-4498-b52b-1c12af89a578/)).toBeInTheDocument();
    });

    it('renders modal with active reason', () => {
      render(<TaskConflictModal {...defaultProps} reason="active" />);

      expect(screen.getAllByText('Active task exists').length).toBeGreaterThan(0);
      expect(
        screen.getByText(/An active task already exists for this Linear issue/)
      ).toBeInTheDocument();
    });

  });

  describe('User interactions', () => {
    it('navigates to task on View existing task button click', () => {
      const onNavigateToTask = vi.fn();
      render(<TaskConflictModal {...defaultProps} onNavigateToTask={onNavigateToTask} />);

      const viewButton = screen.getByRole('button', { name: 'View existing task' });
      fireEvent.click(viewButton);

      expect(onNavigateToTask).toHaveBeenCalledWith('task_fa7666d5-bdf1-4498-b52b-1c12af89a578');
      // onClose should also be called after navigation
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('closes modal on Close button click', () => {
      const onClose = vi.fn();
      render(<TaskConflictModal {...defaultProps} onClose={onClose} />);

      // Get the Close button by text (the action button in footer)
      const closeButton = screen.getAllByRole('button', { name: 'Close' })[1];
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(defaultProps.onNavigateToTask).not.toHaveBeenCalled();
    });

    it('closes modal on X button click', () => {
      const onClose = vi.fn();
      render(<TaskConflictModal {...defaultProps} onClose={onClose} />);

      // Get the X button by aria-label (the first Close button)
      const closeButton = screen.getAllByRole('button', { name: 'Close' })[0];
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal visibility', () => {
    it('does not render when isOpen is false', () => {
      render(<TaskConflictModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Similar task detected')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'View existing task' })).not.toBeInTheDocument();
    });

    it('renders when isOpen is true', () => {
      render(<TaskConflictModal {...defaultProps} isOpen={true} />);

      expect(screen.getAllByText('Similar task detected').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'View existing task' })).toBeInTheDocument();
    });
  });

  describe('Task ID display', () => {
    it('displays the full task ID in monospace font', () => {
      render(<TaskConflictModal {...defaultProps} />);

      const taskIdElement = screen.getByText(/task_fa7666d5-bdf1-4498-b52b-1c12af89a578/);
      expect(taskIdElement).toBeInTheDocument();
      expect(taskIdElement.className).toContain('font-mono');
    });

    it('displays different task ID correctly', () => {
      const differentTaskId = 'task_abc-123-def-456';
      render(<TaskConflictModal {...defaultProps} taskId={differentTaskId} />);

      expect(screen.getByText(new RegExp(differentTaskId))).toBeInTheDocument();
    });
  });
});
