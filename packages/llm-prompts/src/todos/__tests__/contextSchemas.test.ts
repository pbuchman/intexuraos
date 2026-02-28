import { describe, expect, it } from 'vitest';
import { ExtractedItemSchema, TodoExtractionResponseSchema } from '../contextSchemas.js';

describe('ExtractedItemSchema', () => {
  it('accepts valid item with all fields', () => {
    const result = ExtractedItemSchema.safeParse({
      title: 'Buy groceries',
      priority: 'high',
      dueDate: '2026-01-25',
      reasoning: 'Need food for the week',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid item with null priority', () => {
    const result = ExtractedItemSchema.safeParse({
      title: 'Call mom',
      priority: null,
      dueDate: null,
      reasoning: 'Check in',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid priority enum value', () => {
    const result = ExtractedItemSchema.safeParse({
      title: 'Test',
      priority: 'critical' as never,
      dueDate: null,
      reasoning: 'test',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path[0]).toBe('priority');
    }
  });

  it('rejects missing title', () => {
    const result = ExtractedItemSchema.safeParse({
      priority: 'medium',
      dueDate: null,
      reasoning: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reasoning', () => {
    const result = ExtractedItemSchema.safeParse({
      title: 'Test',
      priority: 'low',
      dueDate: null,
    });
    expect(result.success).toBe(false);
  });

  describe('dueDate ISO format enforcement', () => {
    it('accepts valid ISO date YYYY-MM-DD', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '2026-03-15',
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('accepts null dueDate', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('rejects date with time component', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '2026-03-15T10:30:00Z',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });

    it('rejects non-ISO date format MM/DD/YYYY', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '03/15/2026',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });

    it('rejects natural language date', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: 'tomorrow',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });

    it('rejects empty string dueDate', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });

    it('rejects partial date format YYYY-MM', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '2026-03',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });

    it('rejects date with wrong separators', () => {
      const result = ExtractedItemSchema.safeParse({
        title: 'Test',
        priority: 'low',
        dueDate: '2026.03.15',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('dueDate');
      }
    });
  });
});

describe('TodoExtractionResponseSchema', () => {
  it('accepts valid response with multiple items', () => {
    const result = TodoExtractionResponseSchema.safeParse({
      items: [
        { title: 'Task 1', priority: 'high', dueDate: '2026-01-25', reasoning: 'Important' },
        { title: 'Task 2', priority: null, dueDate: null, reasoning: 'Less important' },
      ],
      summary: '2 tasks extracted',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid response with empty items array', () => {
    const result = TodoExtractionResponseSchema.safeParse({
      items: [],
      summary: 'No tasks found',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-array items', () => {
    const result = TodoExtractionResponseSchema.safeParse({
      items: 'not an array' as never,
      summary: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing summary', () => {
    const result = TodoExtractionResponseSchema.safeParse({
      items: [{ title: 'Test', priority: 'low', dueDate: null, reasoning: 'test' }],
    });
    expect(result.success).toBe(false);
  });

  it('provides detailed error for invalid item in array', () => {
    const result = TodoExtractionResponseSchema.safeParse({
      items: [
        { title: 'Valid', priority: 'low', dueDate: null, reasoning: 'test' },
        { title: 'Invalid', priority: 'wrong', dueDate: null, reasoning: 'test' },
      ],
      summary: 'test',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('items') && i.path.includes('priority'))
      ).toBe(true);
    }
  });
});
