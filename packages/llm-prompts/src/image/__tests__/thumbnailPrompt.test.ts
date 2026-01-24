import { describe, expect, it } from 'vitest';
import { thumbnailPrompt } from '../thumbnailPrompt.js';

describe('thumbnailPrompt', () => {
  it('has correct metadata', () => {
    expect(thumbnailPrompt.name).toBe('thumbnail-prompt');
    expect(thumbnailPrompt.description).toContain('thumbnail generation');
  });

  it('builds prompt with default deps', () => {
    const result = thumbnailPrompt.build({ text: 'Test article content' });
    expect(result).toContain('Thumbnail Prompt Synthesizer');
    expect(result).toContain('Test article content');
  });

  it('truncates text exceeding default maxTextLength', () => {
    const longText = 'x'.repeat(70000);
    const result = thumbnailPrompt.build({ text: longText });
    expect(result).toContain('x'.repeat(60000));
    expect(result).not.toContain('x'.repeat(70000));
  });

  it('does not truncate text shorter than maxTextLength', () => {
    const shortText = 'Short article text';
    const result = thumbnailPrompt.build({ text: shortText });
    expect(result).toContain(shortText);
  });

  it('respects custom maxTextLength', () => {
    const text = 'x'.repeat(200);
    const result = thumbnailPrompt.build({ text }, { maxTextLength: 100 });
    expect(result).toContain('x'.repeat(100));
    expect(result).not.toContain('x'.repeat(200));
  });

  it('includes required JSON structure in prompt', () => {
    const result = thumbnailPrompt.build({ text: 'Test' });
    expect(result).toContain('"title"');
    expect(result).toContain('"visualSummary"');
    expect(result).toContain('"prompt"');
    expect(result).toContain('"negativePrompt"');
    expect(result).toContain('"parameters"');
  });
});
