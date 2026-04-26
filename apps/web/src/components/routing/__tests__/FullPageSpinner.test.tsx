/**
 * Tests for FullPageSpinner component.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FullPageSpinner } from '../FullPageSpinner.js';

afterEach(() => {
  cleanup();
});

describe('FullPageSpinner', () => {
  it('renders a status element with aria-label "Loading"', () => {
    render(<FullPageSpinner />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading');
  });

  it('uses min-h-screen so it fills the viewport', () => {
    render(<FullPageSpinner />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('min-h-screen');
  });
});
