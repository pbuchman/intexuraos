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
    expect(result.labelIds).toEqual(['l1', 'l2']);
    expect(result.droppedLabels).toEqual([]);
  });

  it('adds new labels', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, ['feature', 'urgent'], [], availableLabels);
    expect(result.labelIds).toEqual(['l1', 'l2', 'l4']);
    expect(result.droppedLabels).toEqual([]);
  });

  it('removes labels', () => {
    const current = [{ name: 'bug' }, { name: 'feature' }];
    const result = resolveDesiredLabelIds(current, [], ['bug'], availableLabels);
    expect(result.labelIds).toEqual(['l2']);
    expect(result.droppedLabels).toEqual([]);
  });

  it('handles combined add and remove', () => {
    const current = [{ name: 'bug' }, { name: 'feature' }];
    const result = resolveDesiredLabelIds(current, ['urgent'], ['bug'], availableLabels);
    expect(result.labelIds).toEqual(['l2', 'l4']);
    expect(result.droppedLabels).toEqual([]);
  });

  it('returns empty when all removed', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, [], ['bug'], availableLabels);
    expect(result.labelIds).toEqual([]);
    expect(result.droppedLabels).toEqual([]);
  });

  it('handles empty inputs', () => {
    const result = resolveDesiredLabelIds([], [], [], availableLabels);
    expect(result.labelIds).toEqual([]);
    expect(result.droppedLabels).toEqual([]);
  });

  it('ignores labels not in available list and reports them as dropped', () => {
    const current = [{ name: 'nonexistent' }];
    const result = resolveDesiredLabelIds(current, ['also-nonexistent'], [], availableLabels);
    expect(result.labelIds).toEqual([]);
    expect(result.droppedLabels).toEqual(['also-nonexistent']);
  });

  it('deduplicates when adding already-present label', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, ['bug'], [], availableLabels);
    expect(result.labelIds).toEqual(['l1']);
    expect(result.droppedLabels).toEqual([]);
  });

  it('reports multiple dropped labels when none exist in available set', () => {
    const current = [{ name: 'bug' }];
    const result = resolveDesiredLabelIds(current, ['ready-to-merge', 'nonexistent'], [], availableLabels);
    expect(result.labelIds).toEqual(['l1']);
    expect(result.droppedLabels).toEqual(['ready-to-merge', 'nonexistent']);
  });

  it('reports only the dropped labels when some addLabels exist and some do not', () => {
    const current: { name: string }[] = [];
    const result = resolveDesiredLabelIds(current, ['bug', 'ready-to-merge'], [], availableLabels);
    expect(result.labelIds).toEqual(['l1']);
    expect(result.droppedLabels).toEqual(['ready-to-merge']);
  });
});
