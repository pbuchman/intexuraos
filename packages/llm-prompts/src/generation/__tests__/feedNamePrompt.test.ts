import { describe, expect, it } from 'vitest';
import { feedNamePrompt } from '../feedNamePrompt.js';

describe('feedNamePrompt', () => {
  it('has correct metadata', () => {
    expect(feedNamePrompt.name).toBe('feed-name-generation');
    expect(feedNamePrompt.description).toContain('composite data feeds');
  });

  it('builds prompt with default deps', () => {
    const result = feedNamePrompt.build({
      purpose: 'Track tech news',
      sourceNames: ['TechCrunch', 'Hacker News'],
      filterNames: ['Urgent'],
    });
    expect(result).toContain('100 characters');
    expect(result).toContain('Track tech news');
    expect(result).toContain('TechCrunch, Hacker News');
    expect(result).toContain('Urgent');
  });

  it('respects custom maxLength', () => {
    const result = feedNamePrompt.build(
      { purpose: 'Test', sourceNames: [], filterNames: [] },
      { maxLength: 50 }
    );
    expect(result).toContain('50 characters');
  });

  it('handles empty sources and filters', () => {
    const result = feedNamePrompt.build({
      purpose: 'General feed',
      sourceNames: [],
      filterNames: [],
    });
    expect(result).toContain('Data sources included: None');
    expect(result).toContain('Notification filters: None');
  });
});
