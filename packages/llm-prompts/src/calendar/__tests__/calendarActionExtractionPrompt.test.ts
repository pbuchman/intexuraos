import { describe, it, expect } from 'vitest';
import { calendarActionExtractionPrompt } from '../calendarActionExtractionPrompt.js';

describe('calendarActionExtractionPrompt', () => {
  describe('text truncation', () => {
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

  describe('prompt content', () => {
    it('includes currentDate in prompt', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Meeting',
        currentDate: '2026-01-30 Thursday',
      });
      expect(prompt).toContain('CURRENT DATE: 2026-01-30 Thursday');
    });

    it('includes Polish examples', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Spotkanie',
        currentDate: '2026-01-30',
      });
      expect(prompt).toContain('nastepny czwartek');
      expect(prompt).toContain('jutro');
    });

    it('includes English examples', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Meeting',
        currentDate: '2026-01-30',
      });
      expect(prompt).toContain('tomorrow at 3pm');
      expect(prompt).toContain('Meeting with John');
    });

    it('extracts date part from currentDate for examples', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Test',
        currentDate: '2026-01-30 Thursday',
      });
      expect(prompt).toContain('2026-01-30');
    });

    it('includes JSON output format specification', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Test',
        currentDate: '2026-01-30',
      });
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"start"');
      expect(prompt).toContain('"end"');
      expect(prompt).toContain('"valid"');
      expect(prompt).toContain('"reasoning"');
    });

    it('includes no-markdown instruction', () => {
      const prompt = calendarActionExtractionPrompt.build({
        text: 'Test',
        currentDate: '2026-01-30',
      });
      expect(prompt).toContain('ONLY a JSON object');
    });
  });
});
