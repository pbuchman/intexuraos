import { describe, expect, it } from 'vitest';
import { LinearIssueDataSchema } from '../contextSchemas.js';

describe('LinearIssueDataSchema', () => {
  it('accepts valid issue data with all fields', () => {
    const result = LinearIssueDataSchema.safeParse({
      title: 'Fix authentication bug',
      priority: 0, // Urgent
      functionalRequirements: 'User must be able to login with OAuth',
      technicalDetails: 'Check token validation in auth service',
      valid: true,
      error: null,
      reasoning: 'Critical bug blocking users',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid issue data with null optional fields', () => {
    const result = LinearIssueDataSchema.safeParse({
      title: 'Update documentation',
      priority: 3, // Low
      functionalRequirements: null,
      technicalDetails: null,
      valid: true,
      error: null,
      reasoning: 'Nice to have improvement',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid issue with error field set', () => {
    const result = LinearIssueDataSchema.safeParse({
      title: 'Ambiguous request',
      priority: 2,
      functionalRequirements: null,
      technicalDetails: null,
      valid: false,
      error: 'Cannot determine scope',
      reasoning: 'User request is unclear',
    });
    expect(result.success).toBe(true);
  });

  describe('priority validation', () => {
    it('accepts priority 0 (Urgent)', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 0,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('accepts priority 4 (No Priority)', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 4,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('rejects priority less than 0', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: -1,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('priority');
      }
    });

    it('rejects priority greater than 4', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 5,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('priority');
      }
    });

    it('rejects float priority values', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 1.5,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects string priority', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 'high' as never,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('required field validation', () => {
    it('rejects missing title', () => {
      const result = LinearIssueDataSchema.safeParse({
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing priority', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing valid', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing reasoning', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('type validation', () => {
    it('rejects non-string title', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 123 as never,
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean valid', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: 'true' as never,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string functionalRequirements when not null', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: 123 as never,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string technicalDetails when not null', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: 123 as never,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string error when not null', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: 123 as never,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts empty string title', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: '',
        priority: 2,
        functionalRequirements: null,
        technicalDetails: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('accepts very long description fields', () => {
      const longText = 'x'.repeat(10000);
      const result = LinearIssueDataSchema.safeParse({
        title: 'Test',
        priority: 2,
        functionalRequirements: longText,
        technicalDetails: longText,
        valid: true,
        error: null,
        reasoning: longText,
      });
      expect(result.success).toBe(true);
    });

    it('accepts special characters in text fields', () => {
      const result = LinearIssueDataSchema.safeParse({
        title: 'Fix bug: "Error 500" on /api/users endpoint',
        priority: 1,
        functionalRequirements: 'Handle: UTF-8, emojis 😊, quotes \'"',
        technicalDetails: 'See: https://example.com\n\n```json\n{"test": "value"}\n```',
        valid: true,
        error: null,
        reasoning: 'Complex formatting test',
      });
      expect(result.success).toBe(true);
    });
  });
});
