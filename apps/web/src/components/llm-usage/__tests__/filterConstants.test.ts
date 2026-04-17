import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_ACTIVE_CLASSES,
  PROVIDER_DOT_CLASSES,
  INACTIVE_SEGMENT_CLASS,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  PRESET_OPTIONS,
} from '../filterConstants.js';

describe('filterConstants', () => {
  it('exports one active-class entry per provider', () => {
    for (const p of PROVIDERS) {
      expect(PROVIDER_ACTIVE_CLASSES[p]).toBeTypeOf('string');
      expect(PROVIDER_DOT_CLASSES[p]).toBeTypeOf('string');
    }
  });

  it('inactive segment class is non-empty', () => {
    expect(INACTIVE_SEGMENT_CLASS.length).toBeGreaterThan(0);
  });

  it('group-by options are unique by key', () => {
    const keys = GROUP_BY_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sort options and preset options expose labels', () => {
    expect(SORT_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
    expect(PRESET_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
