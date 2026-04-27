/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LimitationsSection } from '../LimitationsSection.js';

afterEach(() => {
  cleanup();
});

describe('LimitationsSection', () => {
  it('renders without throwing', () => {
    render(<LimitationsSection />);
    expect(screen.getByText('What this system does not do.')).toBeTruthy();
  });
});
