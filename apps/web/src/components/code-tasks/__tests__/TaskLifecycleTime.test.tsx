/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/scheduledDispatch', () => ({
  getBrowserTimezone: (): string => 'Europe/Warsaw',
}));

import { TaskLifecycleTime } from '../TaskLifecycleTime.js';

describe('TaskLifecycleTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T14:35:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows one exact, relative, semantic, timezone-aware lifecycle value', () => {
    render(
      <TaskLifecycleTime
        status="failed"
        at="2026-07-27T14:28:15.885Z"
      />,
    );

    const time = screen.getByText((_content, element) =>
      element?.tagName === 'TIME'
      && element.textContent?.includes('Failed Jul 27, 2026, 04:28 PM') === true,
    );
    expect(time).toHaveTextContent('6m ago');
    expect(time).toHaveAttribute('datetime', '2026-07-27T14:28:15.885Z');
    expect(time).toHaveAttribute('title', expect.stringContaining('Central European Summer Time'));
    expect(time).toHaveAttribute('title', expect.stringContaining('Europe/Warsaw'));
    expect(time).toHaveAttribute('aria-label', expect.stringContaining('Failed'));
    expect(time).toHaveAttribute('aria-label', expect.stringContaining('Central European Summer Time'));
    expect(time).toHaveAttribute('aria-label', expect.stringContaining('Europe/Warsaw'));
  });

  it('updates the always-relative value when the shared clock crosses a minute', () => {
    const { rerender } = render(
      <TaskLifecycleTime
        status="failed"
        at="2026-07-27T14:34:01.000Z"
        timeTick={0}
      />,
    );
    expect(screen.getByText(/just now/)).toBeInTheDocument();

    vi.setSystemTime(new Date('2026-07-27T14:36:01.000Z'));
    rerender(
      <TaskLifecycleTime
        status="failed"
        at="2026-07-27T14:34:01.000Z"
        timeTick={1}
      />,
    );

    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  });
});
