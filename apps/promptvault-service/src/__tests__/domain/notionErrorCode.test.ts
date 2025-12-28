/**
 * Tests for notionErrorCode.ts - isNotionErrorCode function.
 */
import { describe, it, expect } from 'vitest';
import { isNotionErrorCode, NOTION_ERROR_CODES } from '../../domain/promptvault/notionErrorCode.js';

describe('isNotionErrorCode', () => {
  it('returns true for valid error codes', () => {
    for (const code of NOTION_ERROR_CODES) {
      expect(isNotionErrorCode(code)).toBe(true);
    }
  });

  it('returns true for NOT_FOUND', () => {
    expect(isNotionErrorCode('NOT_FOUND')).toBe(true);
  });

  it('returns true for UNAUTHORIZED', () => {
    expect(isNotionErrorCode('UNAUTHORIZED')).toBe(true);
  });

  it('returns true for RATE_LIMITED', () => {
    expect(isNotionErrorCode('RATE_LIMITED')).toBe(true);
  });

  it('returns true for VALIDATION_ERROR', () => {
    expect(isNotionErrorCode('VALIDATION_ERROR')).toBe(true);
  });

  it('returns true for INTERNAL_ERROR', () => {
    expect(isNotionErrorCode('INTERNAL_ERROR')).toBe(true);
  });

  it('returns false for unknown error codes', () => {
    expect(isNotionErrorCode('UNKNOWN_CODE')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isNotionErrorCode('')).toBe(false);
  });

  it('returns false for lowercase version', () => {
    expect(isNotionErrorCode('not_found')).toBe(false);
  });

  it('returns false for similar but invalid codes', () => {
    expect(isNotionErrorCode('NOT_FOUND_ERROR')).toBe(false);
    expect(isNotionErrorCode('ERROR')).toBe(false);
  });
});
