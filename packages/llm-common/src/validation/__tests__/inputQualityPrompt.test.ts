import { describe, expect, it } from 'vitest';
import { inputQualityPrompt } from '../inputQualityPrompt.js';

describe('inputQualityPrompt', () => {
  it('has correct metadata', () => {
    expect(inputQualityPrompt.name).toBe('input-quality-validation');
    expect(inputQualityPrompt.description).toContain('quality');
  });

  it('builds prompt with user input', () => {
    const result = inputQualityPrompt.build({ prompt: 'best travel tips' });
    expect(result).toContain('best travel tips');
    expect(result).toContain('QUALITY SCALE');
    expect(result).toContain('INVALID (0)');
    expect(result).toContain('WEAK_BUT_VALID (1)');
    expect(result).toContain('GOOD (2)');
  });

  it('includes evaluation criteria', () => {
    const result = inputQualityPrompt.build({ prompt: 'test' });
    expect(result).toContain('Specificity');
    expect(result).toContain('Clarity');
    expect(result).toContain('Scope');
    expect(result).toContain('Actionability');
  });

  it('includes JSON response format instructions', () => {
    const result = inputQualityPrompt.build({ prompt: 'test' });
    expect(result).toContain('JSON RESPONSE');
    expect(result).toContain('SAME LANGUAGE');
  });

  it('includes examples for each quality level', () => {
    const result = inputQualityPrompt.build({ prompt: 'test' });
    expect(result).toContain('Examples: "stuff"');
    expect(result).toContain('Examples: "travel tips"');
    expect(result).toContain('Compare budget airlines');
  });
});
