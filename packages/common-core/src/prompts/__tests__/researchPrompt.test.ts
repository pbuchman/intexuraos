import { describe, it, expect } from 'vitest';
import { buildResearchPrompt } from '../researchPrompt.js';

describe('buildResearchPrompt', () => {
  it('includes the user prompt in the research request section', () => {
    const userPrompt = 'What are the latest developments in quantum computing?';
    const result = buildResearchPrompt(userPrompt);

    expect(result).toContain('## Research Request');
    expect(result).toContain(userPrompt);
  });

  it('includes all required output structure sections', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('### Executive Summary');
    expect(result).toContain('### Key Findings');
    expect(result).toContain('### Analysis');
    expect(result).toContain('### Sources');
  });

  it('includes instructions for web search and source citation', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('Search the web');
    expect(result).toContain('Cross-reference');
    expect(result).toContain('Cite all sources');
  });

  it('includes quality standards', () => {
    const result = buildResearchPrompt('test query');

    expect(result).toContain('## Quality Standards');
    expect(result).toContain('authoritative, reputable sources');
  });

  it('returns a non-empty string for empty user prompt', () => {
    const result = buildResearchPrompt('');

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('## Research Request');
  });
});
