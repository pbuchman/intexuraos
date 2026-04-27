/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatBlock } from '../StatBlock.js';

afterEach(() => {
  cleanup();
});

describe('StatBlock', () => {
  it('renders value and label', () => {
    render(<StatBlock value="42" label="Things" />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Things')).toBeTruthy();
  });
});
