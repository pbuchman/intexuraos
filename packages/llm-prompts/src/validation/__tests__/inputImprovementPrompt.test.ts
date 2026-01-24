import { describe, expect, it } from 'vitest';
import { inputImprovementPrompt } from '../inputImprovementPrompt.js';

describe('inputImprovementPrompt', () => {
  it('has correct metadata', () => {
    expect(inputImprovementPrompt.name).toBe('input-improvement');
    expect(inputImprovementPrompt.description).toContain('prompt');
  });

  it('builds prompt with user input', () => {
    const result = inputImprovementPrompt.build({ prompt: 'travel tips' });
    expect(result).toContain('travel tips');
    expect(result).toContain('REQUIREMENTS');
    expect(result).toContain('ORIGINAL LANGUAGE');
    expect(result).toContain('ORIGINAL INTENT');
  });

  it('includes improvement suggestions', () => {
    const result = inputImprovementPrompt.build({ prompt: 'test' });
    expect(result).toContain('IMPROVEMENTS TO MAKE');
    expect(result).toContain('timeframes');
    expect(result).toContain('geographic scope');
    expect(result).toContain('Clarify ambiguous terms');
  });

  it('includes critical output rules', () => {
    const result = inputImprovementPrompt.build({ prompt: 'test' });
    expect(result).toContain('CRITICAL RULES');
    expect(result).toContain('Return ONLY the improved prompt text');
    expect(result).toContain('NO explanations');
    expect(result).toContain('NO quotes');
  });

  it('includes language preservation requirement', () => {
    const result = inputImprovementPrompt.build({ prompt: 'test' });
    expect(result).toContain('SAME LANGUAGE');
    expect(result).toContain('Polish, output must be Polish');
  });

  it('structures prompt with sections', () => {
    const result = inputImprovementPrompt.build({ prompt: 'test' });
    expect(result).toContain('ORIGINAL PROMPT:');
    expect(result).toContain('IMPROVED PROMPT:');
  });
});
