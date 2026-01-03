import { describe, expect, it } from 'vitest';
import { buildResearchPrompt } from '../researchPrompt.js';

describe('buildResearchPrompt', () => {
  it('includes the user prompt in the research request section', () => {
    const userPrompt = 'What are the latest developments in quantum computing?';
    const result = buildResearchPrompt(userPrompt);

    expect(result).toContain('## Research Request');
    expect(result).toContain(userPrompt);
  });

  it('includes output structure with flexibility for user structure', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## Output Structure');
    expect(result).toContain('If the Research Request contains its own structure');
    expect(result).toContain('Overview');
    expect(result).toContain('Main Content');
  });

  it('includes research guidelines with dynamic year', () => {
    const result = buildResearchPrompt('test query');
    const currentYear = new Date().getFullYear();

    expect(result).toContain('## Research Guidelines');
    expect(result).toContain('Cross-reference');
    expect(result).toContain(String(currentYear));
  });

  it('includes inline citation rules with example', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## Citation Rules (CRITICAL)');
    expect(result).toContain('Inline citations');
    expect(result).toContain('Teide volcano');
  });

  it('includes what NOT to do section', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## What NOT to Do');
    expect(result).toContain('Do NOT invent or hallucinate sources');
    expect(result).toContain('Do NOT use outdated information');
  });

  it('includes language requirement', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## Language Requirement');
    expect(result).toContain('SAME LANGUAGE');
  });

  it('includes adaptive behavior section', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## Adaptive Behavior');
    expect(result).toContain('Travel/lifestyle');
    expect(result).toContain('Technical/programming');
    expect(result).toContain('Medical/health');
  });

  it('returns a non-empty string for empty user prompt', () => {
    const result = buildResearchPrompt('');

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('## Research Request');
  });
});
