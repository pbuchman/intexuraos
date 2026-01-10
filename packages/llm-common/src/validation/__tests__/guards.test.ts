import { describe, expect, it } from 'vitest';
import { isInputQualityResult } from '../guards.js';

describe('isInputQualityResult', () => {
  it('returns true for valid quality result', () => {
    expect(isInputQualityResult({ quality: 0, reason: 'test' })).toBe(true);
    expect(isInputQualityResult({ quality: 1, reason: 'test' })).toBe(true);
    expect(isInputQualityResult({ quality: 2, reason: 'test' })).toBe(true);
  });

  it('accepts quality_scale as alias for quality', () => {
    expect(isInputQualityResult({ quality_scale: 0, reason: 'test' })).toBe(true);
    expect(isInputQualityResult({ quality_scale: 1, reason: 'test' })).toBe(true);
    expect(isInputQualityResult({ quality_scale: 2, reason: 'test' })).toBe(true);
  });

  it('returns false for invalid quality values', () => {
    expect(isInputQualityResult({ quality: 3, reason: 'test' })).toBe(false);
    expect(isInputQualityResult({ quality: -1, reason: 'test' })).toBe(false);
    expect(isInputQualityResult({ quality: '0', reason: 'test' })).toBe(false);
  });

  it('returns false for missing fields', () => {
    expect(isInputQualityResult({ quality: 0 })).toBe(false);
    expect(isInputQualityResult({ reason: 'test' })).toBe(false);
    expect(isInputQualityResult({})).toBe(false);
  });

  it('returns false for invalid types', () => {
    expect(isInputQualityResult(null)).toBe(false);
    expect(isInputQualityResult(undefined)).toBe(false);
    expect(isInputQualityResult('string')).toBe(false);
    expect(isInputQualityResult(123)).toBe(false);
  });

  it('returns false for non-string reason', () => {
    expect(isInputQualityResult({ quality: 0, reason: 123 })).toBe(false);
    expect(isInputQualityResult({ quality: 1, reason: null })).toBe(false);
  });
});
