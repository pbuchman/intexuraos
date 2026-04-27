import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createWorkerLogger,
  loadRequiredEnv,
  verifyInternalAuth,
} from '../__shims__/common-worker.js';

describe('shim: createWorkerLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a logger with default level "info" when LOG_LEVEL is unset', () => {
    delete process.env['LOG_LEVEL'];
    const logger = createWorkerLogger('test-worker');
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('respects LOG_LEVEL when set', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const logger = createWorkerLogger('test-worker');
    expect(logger.level).toBe('debug');
  });
});

describe('shim: loadRequiredEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns required vars when present', () => {
    process.env['SHIM_TEST_REQ'] = 'present';
    const out = loadRequiredEnv({ SHIM_TEST_REQ: { required: true } });
    expect(out.SHIM_TEST_REQ).toBe('present');
  });

  it('throws when a required var is missing', () => {
    delete process.env['SHIM_TEST_MISSING'];
    expect(() => loadRequiredEnv({ SHIM_TEST_MISSING: { required: true } })).toThrow(
      /SHIM_TEST_MISSING/
    );
  });

  it('throws when a required var is empty string', () => {
    process.env['SHIM_TEST_EMPTY'] = '';
    expect(() => loadRequiredEnv({ SHIM_TEST_EMPTY: { required: true } })).toThrow(
      /SHIM_TEST_EMPTY/
    );
  });

  it('uses provided default when optional var is missing', () => {
    delete process.env['SHIM_TEST_OPT'];
    const out = loadRequiredEnv({
      SHIM_TEST_OPT: { required: false, default: 'fallback' },
    });
    expect(out.SHIM_TEST_OPT).toBe('fallback');
  });

  it('uses empty string when optional var is missing and no default given', () => {
    delete process.env['SHIM_TEST_OPT_NODEF'];
    const out = loadRequiredEnv({ SHIM_TEST_OPT_NODEF: { required: false } });
    expect(out.SHIM_TEST_OPT_NODEF).toBe('');
  });

  it('aggregates multiple missing required vars in one error', () => {
    delete process.env['SHIM_MULTI_A'];
    delete process.env['SHIM_MULTI_B'];
    expect(() =>
      loadRequiredEnv({
        SHIM_MULTI_A: { required: true },
        SHIM_MULTI_B: { required: true },
      })
    ).toThrow(/SHIM_MULTI_A.*SHIM_MULTI_B/);
  });
});

describe('shim: verifyInternalAuth', () => {
  it('returns false when expected token is undefined', () => {
    expect(verifyInternalAuth('whatever', undefined)).toBe(false);
  });

  it('returns false when expected token is empty', () => {
    expect(verifyInternalAuth('whatever', '')).toBe(false);
  });

  it('returns false when header is undefined', () => {
    expect(verifyInternalAuth(undefined, 'expected')).toBe(false);
  });

  it('returns false when header is empty string', () => {
    expect(verifyInternalAuth('', 'expected')).toBe(false);
  });

  it('returns false when first array element is undefined', () => {
    // Buffer.from(undefined) would throw; fn must short-circuit before that.
    expect(verifyInternalAuth([] as unknown as string[], 'expected')).toBe(false);
  });

  it('returns false on length mismatch', () => {
    expect(verifyInternalAuth('short', 'much-longer-token')).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(verifyInternalAuth('exact-match', 'exact-match')).toBe(true);
  });

  it('returns false when tokens differ but lengths match', () => {
    expect(verifyInternalAuth('aaaaaaaa', 'bbbbbbbb')).toBe(false);
  });

  it('uses first element of an array header value', () => {
    expect(verifyInternalAuth(['exact-match', 'ignored'], 'exact-match')).toBe(true);
  });

  it('rejects legacy `Bearer <token>` format (regression for INT-1550)', () => {
    expect(verifyInternalAuth('Bearer test-token', 'test-token')).toBe(false);
  });
});
