/**
 * Tests for synthesis prompt configuration.
 */

import { describe, it, expect } from 'vitest';
import {
  SYNTHESIS_PROMPT,
  TITLE_GENERATION_PROMPT,
  buildSynthesisInput,
} from '../../../../domain/research/config/synthesisPrompt.js';

describe('synthesisPrompt config', () => {
  describe('SYNTHESIS_PROMPT', () => {
    it('contains required sections', () => {
      expect(SYNTHESIS_PROMPT).toContain('ROLE');
      expect(SYNTHESIS_PROMPT).toContain('OBJECTIVE');
      expect(SYNTHESIS_PROMPT).toContain('INPUTS FORMAT');
      expect(SYNTHESIS_PROMPT).toContain('OUTPUT STRUCTURE');
      expect(SYNTHESIS_PROMPT).toContain('RULES');
    });

    it('defines expected input format markers', () => {
      expect(SYNTHESIS_PROMPT).toContain('===ORIGINAL_PROMPT_START===');
      expect(SYNTHESIS_PROMPT).toContain('===ORIGINAL_PROMPT_END===');
      expect(SYNTHESIS_PROMPT).toContain('===REPORT_START model:');
      expect(SYNTHESIS_PROMPT).toContain('===REPORT_END model:');
    });

    it('defines expected output sections', () => {
      expect(SYNTHESIS_PROMPT).toContain('## Summary');
      expect(SYNTHESIS_PROMPT).toContain('## Detailed Findings');
      expect(SYNTHESIS_PROMPT).toContain('## Agreements');
      expect(SYNTHESIS_PROMPT).toContain('## Disagreements');
      expect(SYNTHESIS_PROMPT).toContain('## Sources');
    });
  });

  describe('TITLE_GENERATION_PROMPT', () => {
    it('specifies word limit', () => {
      expect(TITLE_GENERATION_PROMPT).toContain('5-10 words');
    });

    it('instructs to return only the title', () => {
      expect(TITLE_GENERATION_PROMPT).toContain('Return only the title');
    });
  });

  describe('buildSynthesisInput', () => {
    it('wraps original prompt with markers', () => {
      const result = buildSynthesisInput('What is AI?', []);

      expect(result).toContain('===ORIGINAL_PROMPT_START===');
      expect(result).toContain('What is AI?');
      expect(result).toContain('===ORIGINAL_PROMPT_END===');
    });

    it('formats single report correctly', () => {
      const result = buildSynthesisInput('Prompt', [
        { model: 'GPT-4', content: 'GPT findings here.' },
      ]);

      expect(result).toContain('===REPORT_START model: GPT-4===');
      expect(result).toContain('GPT findings here.');
      expect(result).toContain('===REPORT_END model: GPT-4===');
    });

    it('formats multiple reports correctly', () => {
      const result = buildSynthesisInput('Prompt', [
        { model: 'GPT-4', content: 'GPT content' },
        { model: 'Claude', content: 'Claude content' },
        { model: 'Gemini', content: 'Gemini content' },
      ]);

      expect(result).toContain('===REPORT_START model: GPT-4===');
      expect(result).toContain('===REPORT_END model: GPT-4===');
      expect(result).toContain('===REPORT_START model: Claude===');
      expect(result).toContain('===REPORT_END model: Claude===');
      expect(result).toContain('===REPORT_START model: Gemini===');
      expect(result).toContain('===REPORT_END model: Gemini===');
    });

    it('preserves report order', () => {
      const result = buildSynthesisInput('Prompt', [
        { model: 'First', content: 'First content' },
        { model: 'Second', content: 'Second content' },
      ]);

      const firstIndex = result.indexOf('model: First');
      const secondIndex = result.indexOf('model: Second');

      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it('handles empty reports array', () => {
      const result = buildSynthesisInput('Just a prompt', []);

      expect(result).toContain('===ORIGINAL_PROMPT_START===');
      expect(result).toContain('Just a prompt');
      expect(result).not.toContain('===REPORT_START');
    });

    it('preserves special characters in content', () => {
      const result = buildSynthesisInput('Test', [
        { model: 'Model', content: 'Content with **markdown** and `code`' },
      ]);

      expect(result).toContain('**markdown**');
      expect(result).toContain('`code`');
    });

    it('preserves newlines in content', () => {
      const result = buildSynthesisInput('Test', [
        { model: 'Model', content: 'Line 1\nLine 2\nLine 3' },
      ]);

      expect(result).toContain('Line 1\nLine 2\nLine 3');
    });
  });
});
