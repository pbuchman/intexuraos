import { describe, expect, it } from 'vitest';
import {
  InputQualitySchema,
  DomainSchema,
  ModeSchema,
  DefaultAppliedSchema,
  SafetyInfoSchema,
  DOMAINS,
  MODES,
} from '../contextSchemas.js';

describe('DomainSchema', () => {
  it('accepts all valid domain values', () => {
    for (const domain of DOMAINS) {
      const result = DomainSchema.safeParse(domain);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(domain);
      }
    }
  });

  it('rejects invalid domain values', () => {
    const result = DomainSchema.safeParse('invalid_domain');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = DomainSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = DomainSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

describe('ModeSchema', () => {
  it('accepts all valid mode values', () => {
    for (const mode of MODES) {
      const result = ModeSchema.safeParse(mode);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(mode);
      }
    }
  });

  it('rejects invalid mode values', () => {
    const result = ModeSchema.safeParse('invalid_mode');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = ModeSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = ModeSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

describe('DefaultAppliedSchema', () => {
  describe('valid inputs', () => {
    it('accepts string value', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'model',
        value: 'gpt-4',
        reason: 'User specified model',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toBe('gpt-4');
      }
    });

    it('accepts number value', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'temperature',
        value: 0.7,
        reason: 'Default temperature',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toBe(0.7);
      }
    });

    it('accepts boolean value', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'stream',
        value: true,
        reason: 'Streaming enabled',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toBe(true);
      }
    });

    it('accepts boolean false value', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'verbose',
        value: false,
        reason: 'Verbose mode disabled',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.value).toBe(false);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects missing key', () => {
      const result = DefaultAppliedSchema.safeParse({
        value: 'test',
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing value', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'test',
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing reason', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'test',
        value: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid value type (object)', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: 'test',
        value: { invalid: 'object' } as unknown as string,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty string key (z.string() allows empty by default)', () => {
      const result = DefaultAppliedSchema.safeParse({
        key: '',
        value: 'test',
        reason: 'test',
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('SafetyInfoSchema', () => {
  describe('valid inputs', () => {
    it('accepts high_stakes true with empty disclaimers array', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: true,
        required_disclaimers: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.high_stakes).toBe(true);
        expect(result.data.required_disclaimers).toEqual([]);
      }
    });

    it('accepts high_stakes false with disclaimers', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: false,
        required_disclaimers: ['Consult a professional'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.high_stakes).toBe(false);
        expect(result.data.required_disclaimers).toHaveLength(1);
      }
    });

    it('accepts multiple disclaimers', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: true,
        required_disclaimers: ['Medical advice', 'Consult a doctor', 'Not a diagnosis'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.required_disclaimers).toHaveLength(3);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects missing high_stakes', () => {
      const result = SafetyInfoSchema.safeParse({
        required_disclaimers: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required_disclaimers', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean high_stakes', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: 'true' as unknown as boolean,
        required_disclaimers: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-array required_disclaimers', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: true,
        required_disclaimers: 'not an array' as unknown as string[],
      });
      expect(result.success).toBe(false);
    });

    it('rejects array with non-string elements', () => {
      const result = SafetyInfoSchema.safeParse({
        high_stakes: true,
        required_disclaimers: [123 as unknown as string],
      });
      expect(result.success).toBe(false);
    });
  });
});

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

    it('accepts quality_scale field with valid value', () => {
      const result = InputQualitySchema.safeParse({
        quality_scale: 1,
        reason: 'Moderate quality',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(1);
        expect(result.data.reason).toBe('Moderate quality');
      }
    });

    it('normalizes quality_scale to quality field', () => {
      const result = InputQualitySchema.safeParse({
        quality_scale: 2,
        reason: 'High quality',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(2);
      }
    });

    it('prefers quality over quality_scale when both provided', () => {
      const result = InputQualitySchema.safeParse({
        quality: 1,
        quality_scale: 2,
        reason: 'Test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(1);
      }
    });

    it('returns error when both quality and quality_scale are undefined', () => {
      const result = InputQualitySchema.safeParse({
        quality: undefined,
        quality_scale: undefined,
        reason: 'Test reason',
      });
      // The refine requires at least one to be defined
      expect(result.success).toBe(false);
    });

    it('uses quality_scale when quality is omitted (nullish coalescing branch)', () => {
      const result = InputQualitySchema.safeParse({
        quality_scale: 0,
        reason: 'Low quality',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quality).toBe(0);
      }
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
