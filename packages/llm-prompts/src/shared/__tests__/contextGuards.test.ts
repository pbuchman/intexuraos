import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DOMAINS } from '../contextTypes.js';
import type { Logger } from 'pino';
import {
  isDomain,
  isMode,
  isDefaultApplied,
  isSafetyInfo,
  isStringArray,
  isObject,
  validateDomain,
  validateMode,
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

describe('validateDomain', () => {
  const logger = {
    warn: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for valid domains', () => {
    expect(validateDomain('travel', logger)).toBe(true);
    expect(validateDomain('product', logger)).toBe(true);
    expect(validateDomain('technical', logger)).toBe(true);
    expect(validateDomain('general', logger)).toBe(true);
    expect(validateDomain('unknown', logger)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns false and logs warning for invalid domain string', () => {
    const result = validateDomain('invalid-domain', logger);

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        received: 'invalid-domain',
        error: expect.anything(),
      }),
      expect.stringContaining('Domain validation failed - expected one of:')
    );
  });

  it('returns false and logs warning for non-string values', () => {
    expect(validateDomain(123, logger)).toBe(false);
    expect(validateDomain(null, logger)).toBe(false);
    expect(validateDomain(undefined, logger)).toBe(false);
    expect(validateDomain({}, logger)).toBe(false);

    expect(logger.warn).toHaveBeenCalledTimes(4);
  });
});

describe('validateMode', () => {
  const logger = {
    warn: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for valid modes', () => {
    expect(validateMode('compact', logger)).toBe(true);
    expect(validateMode('standard', logger)).toBe(true);
    expect(validateMode('audit', logger)).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns false and logs warning for invalid mode string', () => {
    const result = validateMode('invalid-mode', logger);

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        received: 'invalid-mode',
        error: expect.anything(),
      }),
      expect.stringContaining('Mode validation failed - expected one of:')
    );
  });

  it('returns false and logs warning for non-string values', () => {
    expect(validateMode(123, logger)).toBe(false);
    expect(validateMode(null, logger)).toBe(false);
    expect(validateMode(undefined, logger)).toBe(false);
    expect(validateMode({}, logger)).toBe(false);

    expect(logger.warn).toHaveBeenCalledTimes(4);
  });
});
