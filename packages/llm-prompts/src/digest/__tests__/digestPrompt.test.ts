import { describe, expect, it } from 'vitest';
import { digestPrompt, DIGEST_PROMPT_VERSION } from '../digestPrompt.js';

describe('digestPrompt metadata', () => {
  it('has correct metadata', () => {
    expect(digestPrompt.name).toBe('whatsapp-digest');
    expect(digestPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(digestPrompt.version).toBe(DIGEST_PROMPT_VERSION);
  });
});

describe('digestPrompt.build', () => {
  const baseInput = {
    userId: 'google-oauth2|test-user',
    groupKey: 'grupa-wedkarska-skool',
    date: '2026-04-15',
    previousState: null,
    last3Summaries: [],
    todaysMessages: [{ sender: 'Test', text: 'Hello', postTimeSec: 1776380400 }],
  };

  it('returns a non-empty prompt with the date and group key', () => {
    const prompt = digestPrompt.build(baseInput);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('2026-04-15');
    expect(prompt).toContain('grupa-wedkarska-skool');
  });

  it('embeds both few-shot examples', () => {
    const prompt = digestPrompt.build(baseInput);
    expect(prompt).toContain('2026-04-08');
    expect(prompt).toContain('2026-04-11');
  });

  it('instructs the model to write English narratives', () => {
    const prompt = digestPrompt.build(baseInput);
    expect(prompt.toLowerCase()).toContain('in english');
    expect(prompt.toLowerCase()).not.toContain(['po', 'polsku'].join(' '));
  });

  it('instructs the model to output headline + bullets (hybrid format)', () => {
    const prompt = digestPrompt.build(baseInput);
    expect(prompt).toMatch(/headline/i);
    expect(prompt).toMatch(/bullets/i);
    expect(prompt).toMatch(/3.{0,10}7/);
  });

  it('forbids copying from last3Summaries', () => {
    const prompt = digestPrompt.build(baseInput);
    expect(prompt.toLowerCase()).toContain('do not copy');
  });

  it('exposes semver version 3.x', () => {
    expect(DIGEST_PROMPT_VERSION).toMatch(/^3\.\d+\.\d+$/);
  });
});
