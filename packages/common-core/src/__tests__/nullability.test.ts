import { describe, it, expect } from 'vitest';
import {
  ensureAllDefined,
  getFirstOrNull,
  toDateOrNull,
  toISOStringOrNull,
} from '../nullability.js';

describe('ensureAllDefined', () => {
  it('returns values when all are defined', () => {
    const result = ensureAllDefined(['a', 'b', 'c'], ['first', 'second', 'third']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('throws when a value is null', () => {
    expect(() => ensureAllDefined(['a', null, 'c'], ['first', 'second', 'third'])).toThrow(
      'Missing required values: second'
    );
  });

  it('throws when a value is undefined', () => {
    expect(() => ensureAllDefined(['a', undefined, 'c'], ['first', 'second', 'third'])).toThrow(
      'Missing required values: second'
    );
  });

  it('lists all missing values in error message', () => {
    expect(() => ensureAllDefined([null, 'b', null], ['first', 'second', 'third'])).toThrow(
      'Missing required values: first, third'
    );
  });

  it('works with empty arrays', () => {
    const result = ensureAllDefined([], []);
    expect(result).toEqual([]);
  });
});

describe('getFirstOrNull', () => {
  it('returns first element when array has elements', () => {
    expect(getFirstOrNull([1, 2, 3])).toBe(1);
  });

  it('returns null for empty array', () => {
    expect(getFirstOrNull([])).toBeNull();
  });

  it('works with objects', () => {
    const obj = { id: 1 };
    expect(getFirstOrNull([obj])).toBe(obj);
  });
});

describe('toDateOrNull', () => {
  it('converts ISO string to Date', () => {
    const result = toDateOrNull('2024-01-15T12:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2024-01-15T12:00:00.000Z');
  });

  it('returns null for null input', () => {
    expect(toDateOrNull(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toDateOrNull(undefined)).toBeNull();
  });
});

describe('toISOStringOrNull', () => {
  it('converts Date to ISO string', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    expect(toISOStringOrNull(date)).toBe('2024-01-15T12:00:00.000Z');
  });

  it('returns null for null input', () => {
    expect(toISOStringOrNull(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toISOStringOrNull(undefined)).toBeNull();
  });
});
