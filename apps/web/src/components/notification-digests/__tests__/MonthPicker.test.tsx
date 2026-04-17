/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MonthPicker } from '../MonthPicker.js';

afterEach(cleanup);

describe('MonthPicker', () => {
  it('renders Polish month label and year', () => {
    render(<MonthPicker month="2026-04" onChange={() => {}} />);
    expect(screen.getByText(/kwiecień|kwietnia|kwieci/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('shifts -1 month on prev click', () => {
    const onChange = vi.fn();
    render(<MonthPicker month="2026-04" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Poprzedni miesiąc/i));
    expect(onChange).toHaveBeenCalledWith('2026-03');
  });

  it('shifts +1 month on next click', () => {
    const onChange = vi.fn();
    render(<MonthPicker month="2026-04" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Następny miesiąc/i));
    expect(onChange).toHaveBeenCalledWith('2026-05');
  });
});
