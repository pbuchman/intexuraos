import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar.js';
import { PROVIDERS } from '../filterConstants.js';

// Referenced via the shared PROVIDERS constant so we don't hardcode provider
// strings in test code (enforced by scripts/verify-llm-architecture.ts RULE-5).
const FIRST_PROVIDER = PROVIDERS[0];

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

  it('toggles aria-expanded on the Filters button when the sheet opens', () => {
    render(<FilterBar {...baseProps} />);
    const btn = screen.getByRole('button', { name: /open filters/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    // After opening, the same trigger in the mobile variant reflects the new state.
    const openedBtn = screen.getByRole('button', { name: /open filters/i });
    expect(openedBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders chip strip content reflecting current filter selections', () => {
    const { container } = render(
      <FilterBar
        {...baseProps}
        timeRange={{ preset: 'today' }}
        activeProviders={[FIRST_PROVIDER]}
        groupBy="day"
        sortBy={{ field: 'occurredAt', direction: 'asc' }}
      />,
    );
    const mobile = container.querySelector('[data-variant="mobile"]');
    expect(mobile).not.toBeNull();
    const chipText = mobile?.textContent ?? '';
    expect(chipText).toContain('Today');
    expect(chipText).toContain(FIRST_PROVIDER);
    expect(chipText).toContain('Day');
    expect(chipText).toContain('Oldest first');
  });

  it('omits the Sort section on desktop when showSort is false', () => {
    const { container } = render(<FilterBar {...baseProps} showSort={false} />);
    const desktop = container.querySelector('[data-variant="desktop"]');
    expect(desktop?.textContent).not.toContain('Newest first');
  });

  it('mobile variant uses z-30 so it stays below the sidebar drawer (INT-1405)', () => {
    const { container } = render(<FilterBar {...baseProps} />);
    const mobile = container.querySelector('[data-variant="mobile"]');
    expect(mobile).not.toBeNull();
    expect(mobile?.classList.contains('z-30')).toBe(true);
    expect(mobile?.classList.contains('z-40')).toBe(false);
  });
});
