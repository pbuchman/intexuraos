import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import {
  TimeRangePicker,
  ProviderFilters,
  GroupBySelector,
  SortSelector,
} from '../filterSections.js';

afterEach(() => {
  cleanup();
});

describe('TimeRangePicker', () => {
  it('renders all preset labels and highlights the selected preset', () => {
    const onChange = vi.fn();
    render(<TimeRangePicker timeRange={{ preset: 'last7days' }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    const selected = screen.getByRole('button', { name: 'Last 7d' });
    expect(selected.className).toContain('border-blue-500');
  });

  it('calls onChange with new preset when a preset button is clicked', () => {
    const onChange = vi.fn();
    render(<TimeRangePicker timeRange={{ preset: 'last7days' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'today' });
  });

  it('shows custom date inputs when preset is custom', () => {
    render(
      <TimeRangePicker timeRange={{ preset: 'custom' }} onChange={vi.fn()} />,
    );
    expect(screen.getAllByDisplayValue('').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ProviderFilters', () => {
  it('renders one button per provider when not locked', () => {
    render(<ProviderFilters activeProviders={[]} onToggle={vi.fn()} locked={false} />);
    expect(screen.getByRole('button', { name: /anthropic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /openrouter/i })).toBeInTheDocument();
  });

  it('shows locked indicator when locked', () => {
    render(<ProviderFilters activeProviders={['openrouter']} onToggle={vi.fn()} locked />);
    expect(screen.getByText(/locked by group-by/i)).toBeInTheDocument();
  });

  it('fires onToggle with provider name', () => {
    const onToggle = vi.fn();
    render(<ProviderFilters activeProviders={[]} onToggle={onToggle} locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: /openai/i }));
    expect(onToggle).toHaveBeenCalledWith('openai');
  });
});

describe('GroupBySelector', () => {
  it('highlights current groupBy and fires onChange', () => {
    const onChange = vi.fn();
    render(<GroupBySelector groupBy="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });
});

describe('SortSelector', () => {
  it('fires onChange with new sort state', () => {
    const onChange = vi.fn();
    render(
      <SortSelector sortBy={{ field: 'occurredAt', direction: 'desc' }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }));
    expect(onChange).toHaveBeenCalledWith({ field: 'occurredAt', direction: 'asc' });
  });
});
