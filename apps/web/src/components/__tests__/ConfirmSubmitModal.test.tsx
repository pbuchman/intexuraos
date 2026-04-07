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
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /submit task/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
