/**
 * Tests for loadRequiredEnv.
 *
 * Contract: throw at module load when a required var is missing or empty,
 * surface ALL offenders in a single error, never silently fall back to a
 * default for a `required: true` var. Optional vars honour `default`,
 * otherwise return `''` (callers must handle).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRequiredEnv } from '../env.js';

describe('loadRequiredEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns value when required var is set', () => {
    process.env['LRE_FOO'] = 'bar';
    const env = loadRequiredEnv({ LRE_FOO: { required: true } });
    expect(env.LRE_FOO).toBe('bar');
  });

  it('throws when a required var is missing, listing the var name', () => {
    delete process.env['LRE_FOO'];
    expect(() => loadRequiredEnv({ LRE_FOO: { required: true } })).toThrow(/LRE_FOO/);
  });

  it('throws and lists every missing required var in a single error', () => {
    delete process.env['LRE_FOO'];
    delete process.env['LRE_BAZ'];
    expect(() =>
      loadRequiredEnv({
        LRE_FOO: { required: true },
        LRE_BAZ: { required: true },
      })
    ).toThrow(/LRE_FOO.*LRE_BAZ|LRE_BAZ.*LRE_FOO/);
  });

  it('throws when required var is empty string (empty counts as missing)', () => {
    process.env['LRE_FOO'] = '';
    expect(() => loadRequiredEnv({ LRE_FOO: { required: true } })).toThrow(/LRE_FOO/);
  });

  it('returns default when optional var is missing and default is provided', () => {
    delete process.env['LRE_FOO'];
    const env = loadRequiredEnv({ LRE_FOO: { required: false, default: 'd' } });
    expect(env.LRE_FOO).toBe('d');
  });

  it('returns default when optional var is empty and default is provided', () => {
    process.env['LRE_FOO'] = '';
    const env = loadRequiredEnv({ LRE_FOO: { required: false, default: 'd' } });
    expect(env.LRE_FOO).toBe('d');
  });

  it('returns empty string when optional var is missing and no default', () => {
    delete process.env['LRE_FOO'];
    const env = loadRequiredEnv({ LRE_FOO: { required: false } });
    expect(env.LRE_FOO).toBe('');
  });

  it('returns the actual value for an optional var that is set, ignoring default', () => {
    process.env['LRE_FOO'] = 'real';
    const env = loadRequiredEnv({ LRE_FOO: { required: false, default: 'd' } });
    expect(env.LRE_FOO).toBe('real');
  });

  it('processes multiple vars in one call without cross-talk', () => {
    process.env['LRE_A'] = 'A';
    process.env['LRE_B'] = 'B';
    const env = loadRequiredEnv({
      LRE_A: { required: true },
      LRE_B: { required: true },
    });
    expect(env.LRE_A).toBe('A');
    expect(env.LRE_B).toBe('B');
  });
});
