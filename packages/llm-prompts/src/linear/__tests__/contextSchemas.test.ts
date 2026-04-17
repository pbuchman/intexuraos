import { describe, expect, it } from 'vitest';
import {
  LinearIssueDataSchema,
  LinearIssueTitleSchema,
  LinearIssueTypeSchema,
} from '../contextSchemas.js';

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
        expect(result.error.issues[0]?.path[0]).toBe('priority');
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
        expect(result.error.issues[0]?.path[0]).toBe('priority');
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

describe('LinearIssueTypeSchema', () => {
  it('accepts feature type', () => {
    const result = LinearIssueTypeSchema.safeParse('feature');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('feature');
    }
  });

  it('accepts bug type', () => {
    const result = LinearIssueTypeSchema.safeParse('bug');
    expect(result.success).toBe(true);
  });

  it('accepts refactor type', () => {
    const result = LinearIssueTypeSchema.safeParse('refactor');
    expect(result.success).toBe(true);
  });

  it('accepts research type', () => {
    const result = LinearIssueTypeSchema.safeParse('research');
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = LinearIssueTypeSchema.safeParse('task');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = LinearIssueTypeSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects number', () => {
    const result = LinearIssueTypeSchema.safeParse(1);
    expect(result.success).toBe(false);
  });
});

describe('LinearIssueTitleSchema', () => {
  describe('valid inputs', () => {
    it('accepts valid title with feature type', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Enable users to sign in with Google',
        issueType: 'feature',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Enable users to sign in with Google');
        expect(result.data.issueType).toBe('feature');
      }
    });

    it('accepts valid title with bug type', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Fix login button not responding on mobile',
        issueType: 'bug',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid title with refactor type', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Improve API response time for dashboard',
        issueType: 'refactor',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid title with research type', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Evaluate caching strategies for performance',
        issueType: 'research',
      });
      expect(result.success).toBe(true);
    });

    it('accepts title at exactly 80 characters', () => {
      const title = 'x'.repeat(80);
      const result = LinearIssueTitleSchema.safeParse({
        title,
        issueType: 'feature',
      });
      expect(result.success).toBe(true);
    });

    it('accepts single character title', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'X',
        issueType: 'bug',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('title validation', () => {
    it('rejects empty title', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: '',
        issueType: 'feature',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('title');
      }
    });

    it('rejects title longer than 80 characters', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'x'.repeat(81),
        issueType: 'feature',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('title');
      }
    });

    it('rejects missing title', () => {
      const result = LinearIssueTitleSchema.safeParse({
        issueType: 'feature',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string title', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 123,
        issueType: 'feature',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('issueType validation', () => {
    it('rejects missing issueType', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Valid title',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid issueType', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Valid title',
        issueType: 'task',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('issueType');
      }
    });

    it('rejects empty issueType', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Valid title',
        issueType: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts title with special characters', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Fix "Error 500" on /api/users endpoint',
        issueType: 'bug',
      });
      expect(result.success).toBe(true);
    });

    it('accepts title with unicode characters', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Napraw błąd logowania dla użytkowników SSO',
        issueType: 'bug',
      });
      expect(result.success).toBe(true);
    });

    it('accepts title with emojis (within length limit)', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Add 🌙 dark mode toggle',
        issueType: 'feature',
      });
      expect(result.success).toBe(true);
    });

    it('rejects null input', () => {
      const result = LinearIssueTitleSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('rejects undefined input', () => {
      const result = LinearIssueTitleSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('ignores extra fields', () => {
      const result = LinearIssueTitleSchema.safeParse({
        title: 'Valid title',
        issueType: 'feature',
        extraField: 'should be ignored',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)['extraField']).toBeUndefined();
      }
    });
  });
});
