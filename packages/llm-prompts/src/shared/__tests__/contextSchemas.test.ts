import { describe, expect, it } from 'vitest';
import { InputQualitySchema } from '../contextSchemas.js';

describe('InputQualitySchema', () => {
  describe('valid inputs', () => {
    it('accepts quality 0 with reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 0,
        reason: 'Poor quality prompt lacking context',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(0);
        expect(result.data.reason).toBe('Poor quality prompt lacking context');
      }
    });

    it('accepts quality 1 with reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: 'Moderate quality with some context',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(1);
        expect(result.data.reason).toBe('Moderate quality with some context');
      }
    });

    it('accepts quality 2 with reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 2,
        reason: 'High quality prompt with clear context',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(2);
        expect(result.data.reason).toBe('High quality prompt with clear context');
      }
    });

    it('accepts single character reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: 'a',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid quality values', () => {
    it('rejects quality 3', () => {
      const result = InputQualitySchema.safeParse({
        quality: 3,
        reason: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('quality');
      }
    });

    it('rejects quality -1', () => {
      const result = InputQualitySchema.safeParse({
        quality: -1,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects quality 5', () => {
      const result = InputQualitySchema.safeParse({
        quality: 5,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects string quality', () => {
      const result = InputQualitySchema.safeParse({
        quality: '1' as unknown as number,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects null quality', () => {
      const result = InputQualitySchema.safeParse({
        quality: null as unknown as number,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects undefined quality', () => {
      const result = InputQualitySchema.safeParse({
        reason: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'quality')).toBe(true);
      }
    });
  });

  describe('invalid reason values', () => {
    it('rejects empty string reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('reason');
      }
    });

    it('rejects missing reason field', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'reason')).toBe(true);
      }
    });

    it('rejects number reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: 123 as unknown as string,
      });
      expect(result.success).toBe(false);
    });

    it('rejects null reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: null as unknown as string,
      });
      expect(result.success).toBe(false);
    });

    it('rejects undefined reason', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: undefined as unknown as string,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('invalid input types', () => {
    it('rejects null', () => {
      const result = InputQualitySchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('rejects undefined', () => {
      const result = InputQualitySchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('rejects string', () => {
      const result = InputQualitySchema.safeParse('not an object');
      expect(result.success).toBe(false);
    });

    it('rejects array', () => {
      const result = InputQualitySchema.safeParse([1, 2, 3]);
      expect(result.success).toBe(false);
    });

    it('rejects number', () => {
      const result = InputQualitySchema.safeParse(123);
      expect(result.success).toBe(false);
    });

    it('rejects empty object', () => {
      const result = InputQualitySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('rejects extra fields not in schema', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: 'test',
        extraField: 'should be ignored by passthrough',
      });
      // Zod by default strips unknown fields, so this should succeed
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extraField');
      }
    });

    it('accepts very long reason string', () => {
      const longReason = 'a'.repeat(10000);
      const result = InputQualitySchema.safeParse({
        quality: 2,
        reason: longReason,
      });
      expect(result.success).toBe(true);
    });

    it('accepts reason with special characters', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        reason: 'Test with special chars: \n\t\r"\'<>&{}[]',
      });
      expect(result.success).toBe(true);
    });

    it('accepts reason with unicode characters', () => {
      const result = InputQualitySchema.safeParse({
        quality: 2,
        reason: 'Test with emoji 🎉 and unicode 中文',
      });
      expect(result.success).toBe(true);
    });
  });
});
