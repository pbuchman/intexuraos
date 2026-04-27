/**
 * Tests for unwrapEnvelope — converts a parsed `{ success, data?, error? }`
 * service response into a structural Result-like value.
 */

import { describe, expect, it } from 'vitest';
import { unwrapEnvelope } from '../envelope.js';

describe('unwrapEnvelope', () => {
  describe('success cases', () => {
    it('returns ok=true with the value when success=true and data is present', () => {
      const result = unwrapEnvelope<{ id: string }>({
        success: true,
        data: { id: 'abc' },
      });
      expect(result).toEqual({ ok: true, value: { id: 'abc' } });
    });

    it('preserves data of any shape (array, primitive, null)', () => {
      const arr = unwrapEnvelope<number[]>({ success: true, data: [1, 2, 3] });
      expect(arr).toEqual({ ok: true, value: [1, 2, 3] });

      const num = unwrapEnvelope<number>({ success: true, data: 42 });
      expect(num).toEqual({ ok: true, value: 42 });

      const nullData = unwrapEnvelope<null>({ success: true, data: null });
      expect(nullData).toEqual({ ok: true, value: null });
    });
  });

  describe('ENVELOPE_ERROR (success=false)', () => {
    it('formats the error from envelope.error.code and message', () => {
      const result = unwrapEnvelope({
        success: false,
        error: { code: 'NOT_FOUND', message: 'missing user' },
      });
      expect(result).toEqual({
        ok: false,
        error: { code: 'ENVELOPE_ERROR', message: 'NOT_FOUND: missing user' },
      });
    });

    it('returns ENVELOPE_ERROR with message="unknown" when error field is missing', () => {
      const result = unwrapEnvelope({ success: false });
      expect(result).toEqual({
        ok: false,
        error: { code: 'ENVELOPE_ERROR', message: 'unknown' },
      });
    });
  });

  describe('MALFORMED_ENVELOPE', () => {
    it('returns MALFORMED_ENVELOPE for null body', () => {
      const result = unwrapEnvelope(null);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MALFORMED_ENVELOPE');
        expect(result.error.message).toMatch(/contract/);
      }
    });

    it('returns MALFORMED_ENVELOPE for non-object bodies (string)', () => {
      const result = unwrapEnvelope('not an envelope');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MALFORMED_ENVELOPE');
      }
    });

    it('returns MALFORMED_ENVELOPE for non-object bodies (number)', () => {
      const result = unwrapEnvelope(123);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MALFORMED_ENVELOPE');
      }
    });

    it('returns MALFORMED_ENVELOPE for objects without a `success` field', () => {
      const result = unwrapEnvelope({ data: { id: 'x' } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MALFORMED_ENVELOPE');
        expect(result.error.message).toMatch(/contract/);
      }
    });

    it('returns MALFORMED_ENVELOPE when success=true but data is absent', () => {
      const result = unwrapEnvelope({ success: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MALFORMED_ENVELOPE');
        expect(result.error.message).toMatch(/no `data`/);
      }
    });
  });
});
