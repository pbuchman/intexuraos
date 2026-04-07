/**
 * Tests for OpenRouterModelSelector pricing formatting.
 */

import { describe, expect, it } from 'vitest';
import { formatPrice } from '../OpenRouterModelSelector.js';

describe('formatPrice', () => {
  it('formats zero price as 0.00', () => {
    expect(formatPrice(0)).toBe('0.00');
  });

  it('formats small prices (< 0.01) with 4 decimal places', () => {
    expect(formatPrice(0.003)).toBe('0.0030');
    expect(formatPrice(0.0001)).toBe('0.0001');
  });

  it('formats normal prices with 2 decimal places', () => {
    expect(formatPrice(15.5)).toBe('15.50');
    expect(formatPrice(3.0)).toBe('3.00');
    expect(formatPrice(0.01)).toBe('0.01');
  });

  it('does not produce NaN for valid numeric inputs', () => {
    const prices = [0, 0.003, 15.5, 3.0, 0.01, 100, 0.0001];
    for (const price of prices) {
      expect(formatPrice(price)).not.toBe('NaN');
    }
  });
});
