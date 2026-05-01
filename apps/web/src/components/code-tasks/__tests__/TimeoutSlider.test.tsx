/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_TIMEOUT_HOURS,
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
} from '@intexuraos/code-task-domain/timeout';
import { TimeoutSlider } from '../TimeoutSlider.js';

afterEach(() => {
  cleanup();
});

describe('TimeoutSlider (INT-1585)', () => {
  it('renders default value (5 hours), correct min/max/step, and helper text', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} />);

    expect(screen.getByText('5 hours')).toBeDefined();
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('min')).toBe(String(MIN_TIMEOUT_HOURS));
    expect(slider.getAttribute('max')).toBe(String(MAX_TIMEOUT_HOURS));
    expect((slider as HTMLInputElement).value).toBe(String(DEFAULT_TIMEOUT_HOURS));
    // At the default, helper text should describe the default behaviour.
    expect(
      screen.getByText(/Default — orchestrator will apply 5 hours\./i),
    ).toBeDefined();
  });

  it('calls onChange with the new integer value when the slider moves', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it('renders the singular "1 hour" label at the minimum bound', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={1} onChange={onChange} />);
    expect(screen.getByText('1 hour')).toBeDefined();
  });

  it('shows the custom-override helper text when value differs from default', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={8} onChange={onChange} />);
    expect(
      screen.getByText(/Custom — overrides orchestrator default of 5 hours\./i),
    ).toBeDefined();
  });

  it('disables the slider when the disabled prop is true', () => {
    const onChange = vi.fn();
    render(
      <TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} disabled />,
    );
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  });

  it('treats disabled prop omitted as enabled (default false)', () => {
    const onChange = vi.fn();
    render(<TimeoutSlider value={DEFAULT_TIMEOUT_HOURS} onChange={onChange} />);
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false);
  });
});
