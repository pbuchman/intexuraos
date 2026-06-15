/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmSubmitModal } from '../ConfirmSubmitModal.js';

vi.mock('../ui/Button.js', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }): React.JSX.Element => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  Send: (): React.JSX.Element => <span data-testid="icon-send" />,
  Loader2: (): React.JSX.Element => <span data-testid="icon-loader" />,
}));

describe('ConfirmSubmitModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders Codex with the user-facing worker label', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Implement feature"
        workerType="codex"
        taskMode="planning"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText((content) => content.includes('Codex'))).toBeInTheDocument();
  });

  it('invokes onConfirm when submit is clicked', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Implement feature"
        workerType="codex"
        taskMode="execution"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /submit task/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('displays task mode in confirmation text', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Test task"
        workerType="auto"
        taskMode="execution"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Execution')).toBeInTheDocument();
    expect(screen.getByText(/mode\?/)).toBeInTheDocument();
  });

  it('displays Planning mode label', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Design feature"
        workerType="auto"
        taskMode="planning"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ConfirmSubmitModal
        isOpen={false}
        taskTitle="Test task"
        workerType="auto"
        taskMode="execution"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders custom timeout row when timeoutHours differs from default (INT-1585)', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Long task"
        workerType="auto"
        taskMode="execution"
        timeoutHours={8}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Custom timeout:/i)).toBeInTheDocument();
    expect(screen.getByText('8 hours')).toBeInTheDocument();
  });

  it('omits custom timeout row when timeoutHours equals default (INT-1585)', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Default task"
        workerType="auto"
        taskMode="execution"
        timeoutHours={5}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/Custom timeout:/i)).toBeNull();
  });

  it('omits custom timeout row when timeoutHours is undefined (INT-1585)', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="No-timeout task"
        workerType="auto"
        taskMode="planning"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/Custom timeout:/i)).toBeNull();
  });

  it('renders the Dispatches preview when schedule prop is provided', () => {
    render(
      <ConfirmSubmitModal
        isOpen
        taskTitle="Scheduled task"
        workerType="auto"
        taskMode="execution"
        schedule={{
          localDateTime: '2026-04-24T22:00',
          timezone: 'UTC',
          notBeforeAt: '2026-04-24T22:00:00.000Z',
        }}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/^Dispatches /)).toBeInTheDocument();
    expect(screen.getByText(/Added to queue immediately/i)).toBeInTheDocument();
  });
});
