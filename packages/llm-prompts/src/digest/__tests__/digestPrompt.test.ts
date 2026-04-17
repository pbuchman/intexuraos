import { describe, expect, it } from 'vitest';
import { buildDigestPrompt, DIGEST_PROMPT_VERSION } from '../digestPrompt.js';

describe('buildDigestPrompt', () => {
  const baseInput = {
    userId: 'google-oauth2|test-user',
    groupKey: 'grupa-wedkarska-skool',
    date: '2026-04-15',
    previousState: null,
    last3Summaries: [],
    todaysMessages: [
      { sender: 'Test', text: 'Cześć', postTimeSec: 1776380400 },
    ],
  };

  it('returns a non-empty prompt with the date and group key', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('2026-04-15');
    expect(prompt).toContain('grupa-wedkarska-skool');
  });

  it('embeds both few-shot examples', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toContain('2026-04-08'); // cold-start example date
    expect(prompt).toContain('2026-04-11'); // with-context example date
  });

  it('instructs the model to write Polish narratives', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('po polsku');
  });

  it('exposes a semver version constant', () => {
    expect(DIGEST_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
