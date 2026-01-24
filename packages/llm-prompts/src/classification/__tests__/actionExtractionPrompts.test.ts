import { describe, it, expect } from 'vitest';
import { calendarActionExtractionPrompt } from '../calendarActionExtractionPrompt.js';
import { linearActionExtractionPrompt } from '../linearActionExtractionPrompt.js';

describe('calendarActionExtractionPrompt', () => {
  it('builds prompt without truncation when text is within default max length', () => {
    const prompt = calendarActionExtractionPrompt.build({
      text: 'Meeting tomorrow at 3pm',
      currentDate: '2024-01-15',
    });
    expect(prompt).toContain('Meeting tomorrow at 3pm');
    expect(prompt).not.toContain('IMPORTANT: Text was truncated');
  });

  it('truncates text when exceeding custom maxDescriptionLength', () => {
    const longText = 'a'.repeat(100);
    const prompt = calendarActionExtractionPrompt.build(
      { text: longText, currentDate: '2024-01-15' },
      { maxDescriptionLength: 50 }
    );
    expect(prompt).toContain('IMPORTANT: Text was truncated to first 50 characters');
    expect(prompt).toContain('a'.repeat(50));
    expect(prompt).not.toContain('a'.repeat(51));
  });

  it('truncates text when exceeding default maxDescriptionLength (1000)', () => {
    const longText = 'b'.repeat(1100);
    const prompt = calendarActionExtractionPrompt.build({
      text: longText,
      currentDate: '2024-01-15',
    });
    expect(prompt).toContain('IMPORTANT: Text was truncated to first 1000 characters');
    expect(prompt).toContain('b'.repeat(1000));
    expect(prompt).not.toContain('b'.repeat(1001));
  });

  it('uses deps.maxDescriptionLength when provided even for short text', () => {
    const prompt = calendarActionExtractionPrompt.build(
      { text: 'short text', currentDate: '2024-01-15' },
      { maxDescriptionLength: 5 }
    );
    expect(prompt).toContain('IMPORTANT: Text was truncated to first 5 characters');
    expect(prompt).toContain('short');
    expect(prompt).not.toContain('short text');
  });

  it('does not truncate when text length equals maxDescriptionLength', () => {
    const exactText = 'x'.repeat(50);
    const prompt = calendarActionExtractionPrompt.build(
      { text: exactText, currentDate: '2024-01-15' },
      { maxDescriptionLength: 50 }
    );
    expect(prompt).not.toContain('IMPORTANT: Text was truncated');
    expect(prompt).toContain('x'.repeat(50));
  });
});

describe('linearActionExtractionPrompt', () => {
  it('builds prompt without truncation when text is within default max length', () => {
    const prompt = linearActionExtractionPrompt.build({
      text: 'Fix the login bug',
    });
    expect(prompt).toContain('Fix the login bug');
    expect(prompt).not.toContain('IMPORTANT: Text was truncated');
  });

  it('truncates text when exceeding custom maxDescriptionLength', () => {
    const longText = 'c'.repeat(100);
    const prompt = linearActionExtractionPrompt.build(
      { text: longText },
      { maxDescriptionLength: 50 }
    );
    expect(prompt).toContain('IMPORTANT: Text was truncated to first 50 characters');
    expect(prompt).toContain('c'.repeat(50));
    expect(prompt).not.toContain('c'.repeat(51));
  });

  it('truncates text when exceeding default maxDescriptionLength (2000)', () => {
    const longText = 'd'.repeat(2100);
    const prompt = linearActionExtractionPrompt.build({ text: longText });
    expect(prompt).toContain('IMPORTANT: Text was truncated to first 2000 characters');
    expect(prompt).toContain('d'.repeat(2000));
    expect(prompt).not.toContain('d'.repeat(2001));
  });

  it('does not truncate when text length equals maxDescriptionLength', () => {
    const exactText = 'y'.repeat(100);
    const prompt = linearActionExtractionPrompt.build(
      { text: exactText },
      { maxDescriptionLength: 100 }
    );
    expect(prompt).not.toContain('IMPORTANT: Text was truncated');
    expect(prompt).toContain('y'.repeat(100));
  });
});
