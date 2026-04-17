import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FilterSheet } from '../FilterSheet.js';

afterEach(() => {
  cleanup();
});

const baseProps = {
  timeRange: { preset: 'last7days' as const },
  onTimeRangeChange: vi.fn(),
  activeProviders: [] as string[],
  onToggleProvider: vi.fn(),
  providersLocked: false,
  groupBy: 'none' as const,
  onGroupByChange: vi.fn(),
  sortBy: { field: 'occurredAt' as const, direction: 'desc' as const },
  onSortChange: vi.fn(),
  onClose: vi.fn(),
};

describe('FilterSheet', () => {
  it('does not render when isOpen is false', () => {
    render(<FilterSheet {...baseProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with title and sections when open', () => {
    render(<FilterSheet {...baseProps} isOpen />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Time range')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Group by')).toBeInTheDocument();
    expect(screen.getByText('Sort')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.click(screen.getByRole('button', { name: /close filters/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on overlay click', () => {
    const onClose = vi.fn();
    render(<FilterSheet {...baseProps} onClose={onClose} isOpen />);
    fireEvent.click(screen.getByTestId('filter-sheet-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not hide Sort section when groupBy is non-none (sort still useful later)', () => {
    render(<FilterSheet {...baseProps} groupBy="day" isOpen />);
    expect(screen.getByText('Sort')).toBeInTheDocument();
  });
});
