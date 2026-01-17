import { describe, expect, it } from 'vitest';
import { DOMAINS } from '../contextTypes.js';
import {
  isDomain,
  isMode,
  isDefaultApplied,
  isSafetyInfo,
  isStringArray,
  isObject,
  isPrimitive,
} from '../contextGuards.js';

describe('DOMAINS constant', () => {
  it('exports all domain values', () => {
    expect(DOMAINS).toContain('travel');
    expect(DOMAINS).toContain('product');
    expect(DOMAINS).toContain('general');
    expect(DOMAINS).toContain('unknown');
    expect(DOMAINS.length).toBe(21);
  });
});

describe('isStringArray', () => {
  it('returns true for string arrays', () => {
    expect(isStringArray(['a', 'b'])).toBe(true);
    expect(isStringArray([])).toBe(true);
  });

  it('returns false for non-arrays', () => {
    expect(isStringArray('string')).toBe(false);
    expect(isStringArray(123)).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });

  it('returns false for mixed arrays', () => {
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isStringArray([1, 2, 3])).toBe(false);
  });
});

describe('isObject', () => {
  it('returns true for objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ key: 'value' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isObject(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isObject([])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isObject('string')).toBe(false);
    expect(isObject(123)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe('isDomain', () => {
  it('returns true for valid domains', () => {
    expect(isDomain('travel')).toBe(true);
    expect(isDomain('product')).toBe(true);
    expect(isDomain('technical')).toBe(true);
    expect(isDomain('general')).toBe(true);
    expect(isDomain('unknown')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDomain('invalid')).toBe(false);
    expect(isDomain(123)).toBe(false);
    expect(isDomain(null)).toBe(false);
    expect(isDomain(undefined)).toBe(false);
  });
});

describe('isMode', () => {
  it('returns true for valid modes', () => {
    expect(isMode('compact')).toBe(true);
    expect(isMode('standard')).toBe(true);
    expect(isMode('audit')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isMode('invalid')).toBe(false);
    expect(isMode(123)).toBe(false);
  });
});

describe('isPrimitive', () => {
  it('returns true for string values', () => {
    expect(isPrimitive('hello')).toBe(true);
    expect(isPrimitive('')).toBe(true);
  });

  it('returns true for number values', () => {
    expect(isPrimitive(42)).toBe(true);
    expect(isPrimitive(3.14)).toBe(true);
    expect(isPrimitive(0)).toBe(true);
    expect(isPrimitive(-1)).toBe(true);
  });

  it('returns true for boolean values', () => {
    expect(isPrimitive(true)).toBe(true);
    expect(isPrimitive(false)).toBe(true);
  });

  it('returns false for non-primitive values', () => {
    expect(isPrimitive(null)).toBe(false);
    expect(isPrimitive(undefined)).toBe(false);
    expect(isPrimitive({})).toBe(false);
    expect(isPrimitive([])).toBe(false);
    expect(isPrimitive(() => undefined)).toBe(false);
  });
});

describe('isDefaultApplied', () => {
  it('returns true for valid default applied with string value', () => {
    expect(isDefaultApplied({ key: 'test', value: 'val', reason: 'why' })).toBe(true);
  });

  it('returns true for valid default applied with number value', () => {
    expect(isDefaultApplied({ key: 'prefers_recent_years', value: 2, reason: 'recency' })).toBe(
      true
    );
    expect(isDefaultApplied({ key: 'max_items', value: 10, reason: 'limit' })).toBe(true);
  });

  it('returns true for valid default applied with boolean value', () => {
    expect(isDefaultApplied({ key: 'include_sources', value: true, reason: 'transparency' })).toBe(
      true
    );
    expect(isDefaultApplied({ key: 'skip_cache', value: false, reason: 'performance' })).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDefaultApplied(null)).toBe(false);
    expect(isDefaultApplied({})).toBe(false);
    expect(isDefaultApplied({ key: 'test' })).toBe(false);
    expect(isDefaultApplied('string')).toBe(false);
  });

  it('returns false when value is object or array', () => {
    expect(isDefaultApplied({ key: 'test', value: {}, reason: 'why' })).toBe(false);
    expect(isDefaultApplied({ key: 'test', value: [], reason: 'why' })).toBe(false);
    expect(isDefaultApplied({ key: 'test', value: null, reason: 'why' })).toBe(false);
  });
});

describe('isSafetyInfo', () => {
  it('returns true for valid safety info', () => {
    expect(isSafetyInfo({ high_stakes: true, required_disclaimers: ['test'] })).toBe(true);
    expect(isSafetyInfo({ high_stakes: false, required_disclaimers: [] })).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSafetyInfo(null)).toBe(false);
    expect(isSafetyInfo({ high_stakes: true })).toBe(false);
  });
});
