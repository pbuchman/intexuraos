import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar.js';

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
  showSort: true,
};

describe('FilterBar', () => {
  it('renders both desktop and mobile variants in the DOM (responsive via CSS)', () => {
    const { container } = render(<FilterBar {...baseProps} />);
    expect(container.querySelector('[data-variant="desktop"]')).not.toBeNull();
    expect(container.querySelector('[data-variant="mobile"]')).not.toBeNull();
  });

  it('mobile variant shows a Filters button with no badge when all defaults', () => {
    render(<FilterBar {...baseProps} />);
    const btn = screen.getByRole('button', { name: /open filters/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByTestId('filter-badge')).toBeNull();
  });

  it('mobile variant shows a badge with the active count', () => {
    render(
      <FilterBar
        {...baseProps}
        timeRange={{ preset: 'today' }}
        groupBy="day"
      />,
    );
    const badge = screen.getByTestId('filter-badge');
    expect(badge).toHaveTextContent('2');
  });

  it('opens the FilterSheet when the mobile Filters button is clicked', () => {
    render(<FilterBar {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /open filters/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('omits the Sort section on desktop when showSort is false', () => {
    const { container } = render(<FilterBar {...baseProps} showSort={false} />);
    const desktop = container.querySelector('[data-variant="desktop"]');
    expect(desktop?.textContent).not.toContain('Newest first');
  });
});
