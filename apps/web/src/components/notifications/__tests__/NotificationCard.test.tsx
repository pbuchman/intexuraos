/**
 * Tests for NotificationCard responsive behavior.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationCard } from '../NotificationCard.js';
import type { MobileNotification } from '@/types/index.js';

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react');
  return {
    ...actual,
    Trash2: (): React.JSX.Element => <span data-testid="trash-icon" />,
  };
});

vi.mock('@/utils/dateFormat', () => ({
  formatRelative: (): string => '2m ago',
}));

function createNotification(overrides?: Partial<MobileNotification>): MobileNotification {
  return {
    id: 'notification-123',
    source: 'Tasker',
    device: 'Pixel 8',
    app: 'com.example.messages',
    title: 'Build finished',
    text: 'Deployment completed successfully.',
    timestamp: 0,
    postTime: '2026-03-25T16:00:00.000Z',
    receivedAt: '2026-03-25T16:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses a stacked mobile layout while preserving the desktop row grid', () => {
    const { container } = render(
      <NotificationCard
        notification={createNotification()}
        onDelete={vi.fn()}
        isDeleting={false}
      />
    );

    const layout = container.querySelector('.grid');

    expect(layout).not.toBeNull();
    expect(layout).toHaveClass('grid-cols-1');
    expect(layout).toHaveClass('md:grid-cols-[auto_auto_1fr_auto_140px_60px]');
  });

  it('shows the delete button on mobile without hover and still confirms before deleting', () => {
    const handleDelete = vi.fn();

    render(
      <NotificationCard
        notification={createNotification()}
        onDelete={handleDelete}
        isDeleting={false}
      />
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete notification' });

    expect(deleteButton).toHaveClass('opacity-100');
    expect(deleteButton).toHaveClass('md:opacity-0');

    fireEvent.click(deleteButton);

    expect(screen.getByText('Delete this notification?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(handleDelete).toHaveBeenCalledWith('notification-123');
  });

  it('applies scale and opacity classes when isDeleting is true and disables the delete button', () => {
    const { container } = render(
      <NotificationCard
        notification={createNotification()}
        onDelete={vi.fn()}
        isDeleting={true}
      />
    );

    const card = container.firstElementChild;

    expect(card).toBeTruthy();
    expect(card).toHaveClass('scale-95');
    expect(card).toHaveClass('opacity-50');

    const deleteButton = screen.getByRole('button', { name: 'Delete notification' });

    expect(deleteButton).toBeDisabled();
  });

  it('does not render the text paragraph when notification text is empty', () => {
    render(
      <NotificationCard
        notification={createNotification({ text: '' })}
        onDelete={vi.fn()}
        isDeleting={false}
      />
    );

    expect(screen.getByText('Build finished')).toBeInTheDocument();
    expect(screen.queryByText('Deployment completed successfully.')).not.toBeInTheDocument();
  });

  it('dismisses the confirmation overlay without calling onDelete when Cancel is clicked', () => {
    const handleDelete = vi.fn();

    render(
      <NotificationCard
        notification={createNotification()}
        onDelete={handleDelete}
        isDeleting={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete notification' }));

    expect(screen.getByText('Delete this notification?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete this notification?')).not.toBeInTheDocument();
    expect(handleDelete).not.toHaveBeenCalled();
  });

  it('truncates long app badges and exposes the full package name via title', () => {
    const longAppName = 'com.google.android.projection.gearhead';

    render(
      <NotificationCard
        notification={createNotification({ app: longAppName })}
        onDelete={vi.fn()}
        isDeleting={false}
      />
    );

    const appBadge = screen.getByText(longAppName);

    expect(appBadge).toHaveAttribute('title', longAppName);
    expect(appBadge).toHaveClass('max-w-full');
    expect(appBadge).toHaveClass('truncate');
  });
});
