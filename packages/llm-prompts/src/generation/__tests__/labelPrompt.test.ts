import { describe, expect, it } from 'vitest';
import { labelPrompt } from '../labelPrompt.js';

describe('labelPrompt', () => {
  it('has correct metadata', () => {
    expect(labelPrompt.name).toBe('label-generation');
    expect(labelPrompt.description).toContain('short labels');
  });

  it('builds prompt with default deps', () => {
    const result = labelPrompt.build({ content: 'Test content' });
    expect(result).toContain('3-6 words');
    expect(result).toContain('Test content');
  });

  it('respects custom word range', () => {
    const result = labelPrompt.build(
      { content: 'Test content' },
      { wordRange: { min: 2, max: 4 } }
    );
    expect(result).toContain('2-4 words');
  });

  it('truncates long content with default limit', () => {
    const longContent = 'x'.repeat(3000);
    const result = labelPrompt.build({ content: longContent });
    expect(result).toContain('...');
    expect(result).not.toContain('x'.repeat(3000));
  });

  it('does not truncate short content', () => {
    const shortContent = 'This is short content';
    const result = labelPrompt.build({ content: shortContent });
    expect(result).not.toContain('...');
    expect(result).toContain(shortContent);
  });

  it('respects custom content preview limit', () => {
    const content = 'x'.repeat(100);
    const result = labelPrompt.build({ content }, { contentPreviewLimit: 50 });
    expect(result).toContain('...');
    expect(result).toContain('x'.repeat(50));
  });
});
