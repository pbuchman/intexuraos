import { describe, expect, it } from 'vitest';
import { titlePrompt } from '../titlePrompt.js';

describe('titlePrompt', () => {
  it('has correct metadata', () => {
    expect(titlePrompt.name).toBe('title-generation');
    expect(titlePrompt.description).toContain('concise titles');
  });

  it('builds prompt with default deps', () => {
    const result = titlePrompt.build({ content: 'Test content' });
    expect(result).toContain('5-8 words');
    expect(result).toContain('Test content');
    expect(result).not.toContain('GOOD EXAMPLES');
  });

  it('respects custom word range', () => {
    const result = titlePrompt.build(
      { content: 'Test content' },
      { wordRange: { min: 3, max: 5 } }
    );
    expect(result).toContain('3-5 words');
  });

  it('includes maxLength when provided', () => {
    const result = titlePrompt.build({ content: 'Test' }, { maxLength: 100 });
    expect(result).toContain('Maximum 100 characters');
  });

  it('includes examples when requested', () => {
    const result = titlePrompt.build({ content: 'Test' }, { includeExamples: true });
    expect(result).toContain('GOOD EXAMPLES');
    expect(result).toContain('BAD EXAMPLES');
  });

  it('truncates long content with default limit', () => {
    const longContent = 'x'.repeat(6000);
    const result = titlePrompt.build({ content: longContent });
    expect(result).toContain('...');
    expect(result).not.toContain('x'.repeat(6000));
  });

  it('does not truncate short content', () => {
    const shortContent = 'Short content';
    const result = titlePrompt.build({ content: shortContent });
    expect(result).not.toContain('...');
    expect(result).toContain(shortContent);
  });

  it('respects custom content preview limit', () => {
    const content = 'x'.repeat(200);
    const result = titlePrompt.build({ content }, { contentPreviewLimit: 100 });
    expect(result).toContain('...');
    expect(result).toContain('x'.repeat(100));
  });
});
