/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMessageDigestDeletionResult } from '@/hooks/useMessageDigests';

const mocks = vi.hoisted(() => ({
  useMessageDigestDeletion: vi.fn(),
  startDeletion: vi.fn(),
  retry: vi.fn(),
  onOpenChange: vi.fn(),
  onDeleted: vi.fn(),
}));

vi.mock('@/hooks/useMessageDigests', () => ({
  useMessageDigestDeletion: (): UseMessageDigestDeletionResult => mocks.useMessageDigestDeletion(),
}));

import { MessageDigestDeleteDialog } from '../MessageDigestDeleteDialog.js';

describe('MessageDigestDeleteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startDeletion.mockResolvedValue(null);
    mocks.retry.mockResolvedValue(null);
    mocks.useMessageDigestDeletion.mockReturnValue(deletionResult());
  });

  afterEach(() => {
    cleanup();
    document.documentElement.style.fontSize = '';
  });

  it('requires explicit confirmation and explains that the source chat is untouched', async () => {
    const user = userEvent.setup();
    renderDialog({ open: true });

    expect(screen.getByRole('dialog', { name: 'Delete Message Digest?' })).toBeInTheDocument();
    expect(screen.getByText('Daily fishing brief')).toBeInTheDocument();
    expect(
      screen.getByText(/original WhatsApp conversation is never changed or deleted/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete digest' }));
    expect(mocks.startDeletion).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmation actions reachable at 200% zoom and a short viewport', () => {
    document.documentElement.style.fontSize = '200%';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    renderDialog({ open: true });

    const dialog = screen.getByRole('dialog', { name: 'Delete Message Digest?' });
    expect(dialog).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'w-[calc(100%-2rem)]',
      'max-w-lg',
      'overflow-y-auto',
      'overscroll-contain'
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-11');
    expect(within(dialog).getByRole('button', { name: 'Delete digest' })).toHaveClass(
      'min-h-11'
    );
  });

  it('restores an interrupted erasure and cannot be dismissed while deletion is pending', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({
        isDeleting: true,
        isRecovering: true,
        erasure: {
          erasureRequestId: 'erasure-a',
          definitionId: 'digest-a',
          status: 'in_progress',
          stage: 'runs',
          deletedCounts: { runs: 8, outbox: 2, state: 0, definition: 0, legacy: 0 },
          updatedAt: '2026-07-27T12:00:00.000Z',
          completedAt: null,
          nextAction: null,
        },
      })
    );
    renderDialog({ open: false });

    expect(screen.getByRole('dialog', { name: 'Deleting Message Digest' })).toBeInTheDocument();
    expect(screen.getByText('Restoring deletion progress…')).toBeInTheDocument();
    expect(screen.getByText('Removing digest history')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Deleting Message Digest' })).toBeInTheDocument();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps the pending dialog open on error and offers an idempotent retry', async () => {
    const user = userEvent.setup();
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({ isDeleting: true, error: 'Cleanup temporarily unavailable' })
    );
    renderDialog({ open: false });

    expect(screen.getByRole('alert')).toHaveTextContent('Cleanup temporarily unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry deletion' }));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps pending deletion recovery reachable at 200% zoom and a short viewport', () => {
    document.documentElement.style.fontSize = '200%';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 });
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({ isDeleting: true, error: 'Cleanup temporarily unavailable' })
    );
    renderDialog({ open: false });

    const dialog = screen.getByRole('dialog', { name: 'Deleting Message Digest' });
    expect(dialog).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'w-[calc(100%-2rem)]',
      'max-w-lg',
      'overflow-y-auto',
      'overscroll-contain'
    );
    expect(within(dialog).getByRole('button', { name: 'Retry deletion' })).toHaveClass(
      'min-h-11'
    );
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toHaveClass('min-h-11');
  });

  it('reports terminal completion once so the page can redirect to the list', async () => {
    mocks.useMessageDigestDeletion.mockReturnValue(
      deletionResult({
        erasure: {
          erasureRequestId: 'erasure-a',
          definitionId: 'digest-a',
          status: 'completed',
          stage: 'completed',
          deletedCounts: { runs: 8, outbox: 2, state: 1, definition: 1, legacy: 0 },
          updatedAt: '2026-07-27T12:01:00.000Z',
          completedAt: '2026-07-27T12:01:00.000Z',
          nextAction: null,
        },
      })
    );
    renderDialog({ open: false });

    await waitFor(() => expect(mocks.onDeleted).toHaveBeenCalledTimes(1));
  });
});

function renderDialog({ open }: { open: boolean }): ReturnType<typeof render> {
  return render(
    <MessageDigestDeleteDialog
      definitionId="digest-a"
      definitionName="Daily fishing brief"
      erasureRequestId={null}
      open={open}
      returnFocusRef={{ current: null }}
      onOpenChange={mocks.onOpenChange}
      onDeleted={mocks.onDeleted}
    />
  );
}

function deletionResult(
  overrides: Partial<UseMessageDigestDeletionResult> = {}
): UseMessageDigestDeletionResult {
  return {
    erasure: null,
    isDeleting: false,
    isRecovering: false,
    error: null,
    startDeletion: mocks.startDeletion,
    retry: mocks.retry,
    ...overrides,
  };
}
