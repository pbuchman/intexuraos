import { describe, expect, it } from 'vitest';
import { itemExtractionPrompt } from '../itemExtractionPrompt.js';

describe('itemExtractionPrompt', () => {
  it('has correct metadata', () => {
    expect(itemExtractionPrompt.name).toBe('todo-item-extraction');
    expect(itemExtractionPrompt.description).toContain('Extracts actionable');
  });

  it('builds prompt with default deps', () => {
    const result = itemExtractionPrompt.build({ description: 'Buy groceries and call mom' });

    expect(result).toContain('50 items maximum');
    expect(result).toContain('Buy groceries and call mom');
    expect(result).toContain('MAXIMUM ITEMS:');
    expect(result).toContain('PRIORITY INFERENCE:');
    expect(result).toContain('DUE DATE INFERENCE:');
    expect(result).toContain('EXTRACTION RULES:');
    expect(result).toContain('RESPONSE FORMAT:');
    expect(result).toContain('DESCRIPTION TO PROCESS:');
  });

  it('respects custom maxItems', () => {
    const result = itemExtractionPrompt.build({ description: 'Test' }, { maxItems: 10 });

    expect(result).toContain('10 items maximum');
    expect(result).toContain('Maximum 10 items total');
  });

  it('respects custom maxDescriptionLength', () => {
    const longDescription = 'x'.repeat(600);
    const result = itemExtractionPrompt.build(
      { description: longDescription },
      { maxDescriptionLength: 500 }
    );

    expect(result).toContain('first 500 characters');
    expect(result).toContain('⚠️ IMPORTANT: Description was truncated');
  });

  it('includes truncation warning for long descriptions', () => {
    const longDescription = 'x'.repeat(11000);
    const result = itemExtractionPrompt.build({ description: longDescription });

    expect(result).toContain('⚠️ IMPORTANT: Description was truncated');
    expect(result).toContain('first 10000 characters');
  });

  it('does not include truncation warning for short descriptions', () => {
    const shortDescription = 'Short description';
    const result = itemExtractionPrompt.build({ description: shortDescription });

    expect(result).not.toContain('⚠️ IMPORTANT: Description was truncated');
    expect(result).not.toContain('truncated to first');
  });

  it('truncates description to custom maxLength', () => {
    const longDescription = 'x'.repeat(6000);
    const result = itemExtractionPrompt.build(
      { description: longDescription },
      { maxDescriptionLength: 1000 }
    );

    expect(result).toContain('first 1000 characters');
    // Should not contain the full description
    expect(result).not.toContain('x'.repeat(6000));
  });

  it('does not truncate short description with custom maxLength', () => {
    const shortDescription = 'Short description';
    const result = itemExtractionPrompt.build(
      { description: shortDescription },
      { maxDescriptionLength: 1000 }
    );

    expect(result).not.toContain('⚠️ IMPORTANT: Description was truncated');
    expect(result).toContain(shortDescription);
  });

  it('includes JSON response format', () => {
    const result = itemExtractionPrompt.build({ description: 'Test' });

    expect(result).toContain('"items"');
    expect(result).toContain('"title"');
    expect(result).toContain('"priority"');
    expect(result).toContain('"dueDate"');
    expect(result).toContain('"reasoning"');
    expect(result).toContain('"summary"');
  });

  it('includes all priority levels in response format', () => {
    const result = itemExtractionPrompt.build({ description: 'Test' });

    expect(result).toContain('"low"');
    expect(result).toContain('"medium"');
    expect(result).toContain('"high"');
    expect(result).toContain('"urgent"');
  });
});
