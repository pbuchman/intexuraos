import { describe, it, expect } from 'vitest';
import { linearActionExtractionPrompt } from '../linearActionExtractionPrompt.js';

describe('linearActionExtractionPrompt', () => {
  describe('text truncation', () => {
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

  describe('prompt content', () => {
    it('includes priority examples', () => {
      const prompt = linearActionExtractionPrompt.build({
        text: 'Test issue',
      });
      expect(prompt).toContain('0 = No priority');
      expect(prompt).toContain('1 = Urgent');
      expect(prompt).toContain('2 = High');
      expect(prompt).toContain('3 = Normal');
      expect(prompt).toContain('4 = Low');
    });

    it('includes JSON output format specification', () => {
      const prompt = linearActionExtractionPrompt.build({
        text: 'Test',
      });
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"priority"');
      expect(prompt).toContain('"functionalRequirements"');
      expect(prompt).toContain('"technicalDetails"');
      expect(prompt).toContain('"valid"');
      expect(prompt).toContain('"reasoning"');
    });

    it('includes language preservation rules', () => {
      const prompt = linearActionExtractionPrompt.build({
        text: 'Test',
      });
      expect(prompt).toContain('SAME LANGUAGE');
      expect(prompt).toContain('English message');
      expect(prompt).toContain('Polish message');
    });

    it('includes Polish examples', () => {
      const prompt = linearActionExtractionPrompt.build({
        text: 'Test',
      });
      expect(prompt).toContain('Dodaj');
      expect(prompt).toContain('Napraw');
    });

    it('includes no-markdown instruction', () => {
      const prompt = linearActionExtractionPrompt.build({
        text: 'Test',
      });
      expect(prompt).toContain('ONLY a JSON object');
    });
  });
});
