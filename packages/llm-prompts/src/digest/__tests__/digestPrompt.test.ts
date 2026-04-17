import { describe, expect, it } from 'vitest';
import { buildDigestPrompt, DIGEST_PROMPT_VERSION } from '../digestPrompt.js';

describe('buildDigestPrompt', () => {
  const baseInput = {
    userId: 'google-oauth2|test-user',
    groupKey: 'grupa-wedkarska-skool',
    date: '2026-04-15',
    previousState: null,
    last3Summaries: [],
    todaysMessages: [{ sender: 'Test', text: 'Cześć', postTimeSec: 1776380400 }],
  };

  it('returns a non-empty prompt with the date and group key', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('2026-04-15');
    expect(prompt).toContain('grupa-wedkarska-skool');
  });

  it('embeds both few-shot examples', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toContain('2026-04-08');
    expect(prompt).toContain('2026-04-11');
  });

  it('instructs the model to write Polish narratives', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('po polsku');
  });

  it('instructs the model to output headline + bullets (hybrid format)', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toMatch(/headline/i);
    expect(prompt).toMatch(/bullets/i);
    expect(prompt).toMatch(/3.{0,10}7/);
  });

  it('forbids copying from last3Summaries', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('nie kopiuj');
  });

  it('exposes semver version 2.x', () => {
    expect(DIGEST_PROMPT_VERSION).toMatch(/^2\.\d+\.\d+$/);
  });
});
