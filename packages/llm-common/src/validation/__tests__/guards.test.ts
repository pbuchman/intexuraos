import { describe, expect, it } from 'vitest';
import { getInputQualityGuardError, isInputQualityResult } from '../guards.js';

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

describe('getInputQualityGuardError', () => {
  it('returns null for valid result with quality', () => {
    expect(getInputQualityGuardError({ quality: 0, reason: 'test' })).toBe(null);
    expect(getInputQualityGuardError({ quality: 1, reason: 'test' })).toBe(null);
    expect(getInputQualityGuardError({ quality: 2, reason: 'test' })).toBe(null);
  });

  it('returns null for valid result with quality_scale', () => {
    expect(getInputQualityGuardError({ quality_scale: 0, reason: 'test' })).toBe(null);
    expect(getInputQualityGuardError({ quality_scale: 1, reason: 'test' })).toBe(null);
    expect(getInputQualityGuardError({ quality_scale: 2, reason: 'test' })).toBe(null);
  });

  it('returns error for non-object input', () => {
    expect(getInputQualityGuardError(null)).toBe('Response is not an object');
    expect(getInputQualityGuardError(undefined)).toBe('Response is not an object');
    expect(getInputQualityGuardError('string')).toBe('Response is not an object');
    expect(getInputQualityGuardError(123)).toBe('Response is not an object');
  });

  it('returns error for missing quality field', () => {
    expect(getInputQualityGuardError({ reason: 'test' })).toBe('Missing "quality" field');
    expect(getInputQualityGuardError({})).toBe('Missing "quality" field');
  });

  it('returns error for non-numeric quality', () => {
    expect(getInputQualityGuardError({ quality: 'WEAK_BUT_VALID', reason: 'test' }))
      .toBe('"quality" must be a number (0, 1, or 2), got string: "WEAK_BUT_VALID"');
    expect(getInputQualityGuardError({ quality: '1', reason: 'test' }))
      .toBe('"quality" must be a number (0, 1, or 2), got string: "1"');
  });

  it('returns error for out-of-range quality', () => {
    expect(getInputQualityGuardError({ quality: 3, reason: 'test' }))
      .toBe('"quality" must be 0, 1, or 2, got 3');
    expect(getInputQualityGuardError({ quality: -1, reason: 'test' }))
      .toBe('"quality" must be 0, 1, or 2, got -1');
  });

  it('returns error for missing or invalid reason', () => {
    expect(getInputQualityGuardError({ quality: 1, reason: '' }))
      .toBe('Missing or invalid "reason" field (must be a non-empty string)');
    expect(getInputQualityGuardError({ quality: 1 }))
      .toBe('Missing or invalid "reason" field (must be a non-empty string)');
    expect(getInputQualityGuardError({ quality: 1, reason: null }))
      .toBe('Missing or invalid "reason" field (must be a non-empty string)');
    expect(getInputQualityGuardError({ quality: 1, reason: 123 }))
      .toBe('Missing or invalid "reason" field (must be a non-empty string)');
  });

  it('prefers quality over quality_scale when both exist', () => {
    expect(getInputQualityGuardError({ quality: 1, quality_scale: 'WEAK_BUT_VALID', reason: 'test' }))
      .toBe(null);
  });
});
