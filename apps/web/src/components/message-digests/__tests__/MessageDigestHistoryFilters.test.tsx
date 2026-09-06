/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MessageDigestHistoryFilters,
  type MessageDigestHistoryFilterValue,
} from '../MessageDigestHistoryFilters.js';

describe('MessageDigestHistoryFilters', () => {
  afterEach(() => cleanup());

  it('renders a restored date, generation, delivery, and ordering query', () => {
    render(
      <MessageDigestHistoryFilters
        value={filteredValue()}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('To date')).toHaveValue('2026-07-27');
    expect(screen.getByLabelText('Generation status')).toHaveValue('failed');
    expect(screen.getByLabelText('WhatsApp status')).toHaveValue('ambiguous');
    expect(screen.getByLabelText('History order')).toHaveValue('asc');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('emits one complete immutable value for every control and clears in one action', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClear = vi.fn();
    const value: MessageDigestHistoryFilterValue = {
      fromDate: '',
      toDate: '',
      generationStatus: undefined,
      deliveryStatus: undefined,
      direction: 'desc',
    };
    const { rerender } = render(
      <MessageDigestHistoryFilters value={value} onChange={onChange} onClear={onClear} />
    );

    await user.type(screen.getByLabelText('From date'), '2026-07-01');
    expect(onChange).toHaveBeenLastCalledWith({ ...value, fromDate: '2026-07-01' });

    rerender(
      <MessageDigestHistoryFilters
        value={{ ...value, fromDate: '2026-07-01' }}
        onChange={onChange}
        onClear={onClear}
      />
    );
    await user.selectOptions(screen.getByLabelText('Generation status'), 'processing');
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fromDate: '2026-07-01',
      generationStatus: 'processing',
    });

    await user.selectOptions(screen.getByLabelText('WhatsApp status'), 'failed');
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fromDate: '2026-07-01',
      deliveryStatus: 'failed',
    });

    await user.selectOptions(screen.getByLabelText('History order'), 'asc');
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fromDate: '2026-07-01',
      direction: 'asc',
    });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('does not show a redundant clear action for the default query', () => {
    render(
      <MessageDigestHistoryFilters
        value={{
          fromDate: '',
          toDate: '',
          generationStatus: undefined,
          deliveryStatus: undefined,
          direction: 'desc',
        }}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('keeps an invalid date range local and commits both dates once corrected', () => {
    const onChange = vi.fn();
    render(
      <MessageDigestHistoryFilters
        value={filteredValue()}
        onChange={onChange}
        onClear={vi.fn()}
      />
    );

    const fromDate = screen.getByLabelText('From date');
    const toDate = screen.getByLabelText('To date');
    expect(fromDate).toHaveAttribute('max', '2026-07-27');
    expect(toDate).toHaveAttribute('min', '2026-07-01');

    fireEvent.change(fromDate, { target: { value: '2026-07-28' } });

    expect(fromDate).toHaveValue('2026-07-28');
    expect(fromDate).toHaveAttribute('aria-invalid', 'true');
    expect(toDate).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'From date must be on or before To date.'
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(toDate, { target: { value: '2026-07-29' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      ...filteredValue(),
      fromDate: '2026-07-28',
      toDate: '2026-07-29',
    });
  });

  it('synchronizes date drafts when navigation restores a different canonical query', () => {
    const { rerender } = render(
      <MessageDigestHistoryFilters
        value={filteredValue()}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-07-28' },
    });
    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-28');

    rerender(
      <MessageDigestHistoryFilters
        value={{ ...filteredValue(), fromDate: '2026-06-01', toDate: '2026-06-30' }}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByLabelText('From date')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('To date')).toHaveValue('2026-06-30');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

function filteredValue(): MessageDigestHistoryFilterValue {
  return {
    fromDate: '2026-07-01',
    toDate: '2026-07-27',
    generationStatus: 'failed',
    deliveryStatus: 'ambiguous',
    direction: 'asc',
  };
}
