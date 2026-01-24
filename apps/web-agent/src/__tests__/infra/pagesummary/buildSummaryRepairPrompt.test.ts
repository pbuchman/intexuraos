import { describe, expect, it } from 'vitest';
import {
  buildSummaryPrompt,
  buildSummaryRepairPrompt,
  summaryPrompt,
  summaryRepairPrompt,
  type SummaryPromptInput,
  type SummaryRepairPromptInput,
} from '../../../infra/pagesummary/buildSummaryRepairPrompt.js';

describe('buildSummaryPrompt (convenience function)', () => {
  it('builds prompt with maxSentences', () => {
    const prompt = buildSummaryPrompt(10, 2);
    expect(prompt).toContain('Maximum 10 sentences');
    expect(prompt).toContain('Maximum 400 words');
  });

  it('builds prompt with maxReadingMinutes', () => {
    const prompt = buildSummaryPrompt(20, 5);
    expect(prompt).toContain('Maximum 20 sentences');
    expect(prompt).toContain('Maximum 1000 words');
  });

  it('includes word calculation (200 words per minute)', () => {
    const prompt = buildSummaryPrompt(15, 3);
    expect(prompt).toContain('Maximum 15 sentences');
    expect(prompt).toContain('Maximum 600 words');
  });

  it('includes all required requirements', () => {
    const prompt = buildSummaryPrompt(20, 3);
    expect(prompt).toContain('Extract all relevant points');
    expect(prompt).toContain('Focus on key information');
    expect(prompt).toContain('Use clear, concise language');
    expect(prompt).toContain('Do not include any meta-commentary');
  });

  it('includes structured sections with ## headers', () => {
    const prompt = buildSummaryPrompt(20, 3);
    expect(prompt).toContain('## Your Task');
    expect(prompt).toContain('## REQUIREMENTS');
    expect(prompt).toContain('## OUTPUT FORMAT');
  });

  it('includes explicit no-JSON instruction in output format', () => {
    const prompt = buildSummaryPrompt(20, 3);
    expect(prompt).toContain('NO JSON format');
    expect(prompt).toContain('NO markdown code blocks');
  });
});

describe('summaryPrompt (PromptBuilder)', () => {
  it('has name and description', () => {
    expect(summaryPrompt.name).toBe('page-summary-generation');
    expect(summaryPrompt.description).toBe('Generates concise prose summaries from web page content');
  });

  it('builds same output as convenience function', () => {
    const input: SummaryPromptInput = { maxSentences: 15, maxReadingMinutes: 3 };
    const builderPrompt = summaryPrompt.build(input);
    const conveniencePrompt = buildSummaryPrompt(15, 3);

    expect(builderPrompt).toBe(conveniencePrompt);
  });

  it('supports custom wordsPerMinute dependency', () => {
    const input: SummaryPromptInput = { maxSentences: 10, maxReadingMinutes: 2 };
    const prompt = summaryPrompt.build(input, { wordsPerMinute: 250 });

    expect(prompt).toContain('Maximum 500 words'); // 2 * 250
  });

  it('uses default wordsPerMinute when not provided', () => {
    const input: SummaryPromptInput = { maxSentences: 10, maxReadingMinutes: 2 };
    const prompt = summaryPrompt.build(input);

    expect(prompt).toContain('Maximum 400 words'); // 2 * 200
  });
});

describe('buildSummaryRepairPrompt (convenience function)', () => {
  it('includes error message in prompt', () => {
    const prompt = buildSummaryRepairPrompt('content', 'invalid response', 'JSON format error');
    expect(prompt).toContain('## ERROR');
    expect(prompt).toContain('JSON format error');
  });

  it('includes original truncated content', () => {
    const longContent = 'A'.repeat(6000);
    const prompt = buildSummaryRepairPrompt(longContent, 'invalid', 'error');

    expect(prompt).toContain('...');
    // Should truncate to 5000 chars
    const contentMatch = prompt.match(/A{5000}/);
    expect(contentMatch).toBeTruthy();
  });

  it('does not truncate short content', () => {
    const shortContent = 'Short content';
    const prompt = buildSummaryRepairPrompt(shortContent, 'invalid', 'error');

    expect(prompt).toContain('Short content');
    expect(prompt).not.toContain('...');
  });

  it('truncates invalidResponse at 1000 chars', () => {
    const longInvalid = 'X'.repeat(2000);
    const prompt = buildSummaryRepairPrompt('content', longInvalid, 'error');

    expect(prompt).toContain('...');
    // Should truncate invalid response
    const match = prompt.match(/X{1000}/);
    expect(match).toBeTruthy();
  });

  it('includes structured sections', () => {
    const prompt = buildSummaryRepairPrompt('content', 'invalid', 'error');

    expect(prompt).toContain('## Your Task');
    expect(prompt).toContain('## ERROR');
    expect(prompt).toContain('## INVALID RESPONSE');
    expect(prompt).toContain('## REQUIREMENTS');
    expect(prompt).toContain('## OUTPUT FORMAT');
  });

  it('includes invalid response snippet', () => {
    const invalid = '[{"json": "format"}]';
    const prompt = buildSummaryRepairPrompt('content', invalid, 'error');

    expect(prompt).toContain('## INVALID RESPONSE');
    expect(prompt).toContain(invalid);
  });
});

describe('summaryRepairPrompt (PromptBuilder)', () => {
  it('has name and description', () => {
    expect(summaryRepairPrompt.name).toBe('page-summary-repair');
    expect(summaryRepairPrompt.description).toBe('Requests LLM to fix invalid summary response format');
  });

  it('builds same output as convenience function', () => {
    const input: SummaryRepairPromptInput = {
      originalContent: 'test content',
      invalidResponse: 'bad response',
      errorMessage: 'test error',
    };
    const builderPrompt = summaryRepairPrompt.build(input);
    const conveniencePrompt = buildSummaryRepairPrompt('test content', 'bad response', 'test error');

    expect(builderPrompt).toBe(conveniencePrompt);
  });

  it('supports custom contentMaxLength dependency', () => {
    const longContent = 'A'.repeat(6000);
    const input: SummaryRepairPromptInput = {
      originalContent: longContent,
      invalidResponse: 'bad',
      errorMessage: 'error',
    };
    const prompt = summaryRepairPrompt.build(input, { contentMaxLength: 1000 });

    const match = prompt.match(/A{1000}/);
    expect(match).toBeTruthy();
  });

  it('supports custom invalidResponseMaxLength dependency', () => {
    const longInvalid = 'X'.repeat(2000);
    const input: SummaryRepairPromptInput = {
      originalContent: 'content',
      invalidResponse: longInvalid,
      errorMessage: 'error',
    };
    const prompt = summaryRepairPrompt.build(input, { invalidResponseMaxLength: 500 });

    const match = prompt.match(/X{500}/);
    expect(match).toBeTruthy();
  });

  it('supports custom maxSentences and maxWords dependencies', () => {
    const input: SummaryRepairPromptInput = {
      originalContent: 'content',
      invalidResponse: 'bad',
      errorMessage: 'error',
    };
    const prompt = summaryRepairPrompt.build(input, { maxSentences: 5, maxWords: 200 });

    expect(prompt).toContain('Maximum 5 sentences');
    expect(prompt).toContain('Maximum 200 words');
  });
});
