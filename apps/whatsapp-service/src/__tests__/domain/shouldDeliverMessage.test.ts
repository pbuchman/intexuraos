/**
 * Tests for shouldDeliverMessage use case.
 */
import { describe, expect, it } from 'vitest';
import { shouldDeliverMessage } from '../../domain/whatsapp/usecases/shouldDeliverMessage.js';

describe('shouldDeliverMessage', () => {
  describe("level='all'", () => {
    it('delivers when important=true', () => {
      expect(shouldDeliverMessage({ level: 'all', important: true })).toBe(true);
    });

    it('delivers when important=false', () => {
      expect(shouldDeliverMessage({ level: 'all', important: false })).toBe(true);
    });

    it('delivers when important=undefined', () => {
      expect(shouldDeliverMessage({ level: 'all', important: undefined })).toBe(true);
    });
  });

  describe("level='important'", () => {
    it('delivers when important=true', () => {
      expect(shouldDeliverMessage({ level: 'important', important: true })).toBe(true);
    });

    it('drops when important=false', () => {
      expect(shouldDeliverMessage({ level: 'important', important: false })).toBe(false);
    });

    it('drops when important=undefined', () => {
      expect(shouldDeliverMessage({ level: 'important', important: undefined })).toBe(false);
    });
  });
});
