/**
 * Smoke tests for MobileToggle components.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MobileCloseButton, MobileOpenButton, MobileOverlay } from '../MobileToggle.js';

describe('MobileToggle', () => {
  afterEach(() => {
    cleanup();
  });

  it('MobileOpenButton calls onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(<MobileOpenButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('MobileCloseButton calls onClose when clicked', () => {
    const onClose = vi.fn();
    render(<MobileCloseButton onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close menu/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('MobileOverlay calls onClose when clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<MobileOverlay onClose={onClose} />);
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
