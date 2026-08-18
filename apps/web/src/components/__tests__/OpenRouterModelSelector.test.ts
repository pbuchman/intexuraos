/**
 * Tests for OpenRouterModelSelector pricing formatting.
 */

import { describe, expect, it } from 'vitest';
import type { OpenRouterModelInfo } from '@/services/researchAgentApi.types';
import { formatPrice, orderModelsForDisplay } from '../OpenRouterModelSelector.js';

function model(id: string): OpenRouterModelInfo {
  return {
    id,
    name: id,
    provider: id.split('/')[0] ?? id,
    contextLength: 100_000,
    pricing: { inputPricePerMillion: 1, outputPricePerMillion: 2 },
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
}

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

describe('orderModelsForDisplay', () => {
  it('shows selected models first and preserves recommended catalog order for the rest', () => {
    const available = [model('vendor/recommended'), model('vendor/other'), model('vendor/selected')];

    expect(orderModelsForDisplay(available, ['vendor/selected']).map((item) => item.id)).toEqual([
      'vendor/selected',
      'vendor/recommended',
      'vendor/other',
    ]);
    expect(available.map((item) => item.id)).toEqual([
      'vendor/recommended',
      'vendor/other',
      'vendor/selected',
    ]);
  });

  it('ignores selected IDs that are absent from the active catalog', () => {
    const available = [model('vendor/recommended'), model('vendor/other')];

    expect(orderModelsForDisplay(available, ['vendor/retired']).map((item) => item.id)).toEqual([
      'vendor/recommended',
      'vendor/other',
    ]);
  });
});
