/**
 * Tests for useBodyScrollLock hook.
 * @vitest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useBodyScrollLock } from '../useBodyScrollLock.js';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('useBodyScrollLock', () => {
  it('sets body overflow to "hidden" when active=true', () => {
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the previous overflow value on cleanup', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('does not change body overflow when active=false', () => {
    document.body.style.overflow = 'auto';
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('releases the lock when active flips from true to false', () => {
    document.body.style.overflow = 'visible';
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useBodyScrollLock(active),
      { initialProps: { active: true } },
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender({ active: false });
    expect(document.body.style.overflow).toBe('visible');
  });
});
