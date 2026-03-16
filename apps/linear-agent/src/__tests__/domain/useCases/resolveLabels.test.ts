import { describe, it, expect } from 'vitest';
import { resolveDesiredLabelIds } from '../../../domain/useCases/resolveLabels.js';

describe('resolveDesiredLabelIds', () => {
  const availableLabels = [
    { id: 'l1', name: 'bug' },
    { id: 'l2', name: 'feature' },
    { id: 'l3', name: 'enhancement' },
    { id: 'l4', name: 'urgent' },
  ];

  it('returns current label IDs when no add/remove', () => {
    const current = [{ name: 'bug' }, { name: 'feature' }];
    const result = resolveDesiredLabelIds(current, [], [], availableLabels);
    expect(result).toEqual(['l1', 'l2']);
  });

  it('adds new labels', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, ['feature', 'urgent'], [], availableLabels);
    expect(result).toEqual(['l1', 'l2', 'l4']);
  });

  it('removes labels', () => {
    const current = [{ name: 'bug' }, { name: 'feature' }];
    const result = resolveDesiredLabelIds(current, [], ['bug'], availableLabels);
    expect(result).toEqual(['l2']);
  });

  it('handles combined add and remove', () => {
    const current = [{ name: 'bug' }, { name: 'feature' }];
    const result = resolveDesiredLabelIds(current, ['urgent'], ['bug'], availableLabels);
    expect(result).toEqual(['l2', 'l4']);
  });

  it('returns empty when all removed', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, [], ['bug'], availableLabels);
    expect(result).toEqual([]);
  });

  it('handles empty inputs', () => {
    const result = resolveDesiredLabelIds([], [], [], availableLabels);
    expect(result).toEqual([]);
  });

  it('ignores labels not in available list', () => {
    const current = [{ name: 'nonexistent' }];
    const result = resolveDesiredLabelIds(current, ['also-nonexistent'], [], availableLabels);
    expect(result).toEqual([]);
  });

  it('deduplicates when adding already-present label', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, ['bug'], [], availableLabels);
    expect(result).toEqual(['l1']);
  });
});
