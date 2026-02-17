/**
 * Tests for HTML generator utility.
 */

import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { describe, expect, it } from 'vitest';
import { generateShareableHtml } from '../../../../domain/research/utils/htmlGenerator.js';

describe('generateShareableHtml', () => {
  const baseInput = {
    title: 'Test Research',
    synthesizedResult: 'This is the synthesized result.',
    shareUrl: 'https://example.com/share/research/abc123-token-test.html',
    sharedAt: '2024-01-15T10:00:00Z',
    staticAssetsUrl: 'https://storage.googleapis.com/bucket',
  };

  it('generates basic HTML with required fields', () => {
    const html = generateShareableHtml(baseInput);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test Research | IntexuraOS Research</title>');
    expect(html).toContain('This is the synthesized result.');
    expect(html).toContain('Generated on January 15, 2024');
  });

  it('uses default title when title is empty', () => {
    const html = generateShareableHtml({ ...baseInput, title: '' });

    expect(html).toContain('<title>Research Report | IntexuraOS Research</title>');
    expect(html).toContain('<h1>Research Report</h1>');
  });

  it('includes correct asset paths', () => {
    const html = generateShareableHtml(baseInput);

    expect(html).toContain(
      'https://storage.googleapis.com/bucket/branding/exports/logo-primary-dark.png'
    );
    expect(html).toContain('https://storage.googleapis.com/bucket/branding/exports/icon-dark.png');
  });

  it('escapes HTML in title', () => {
    const html = generateShareableHtml({
      ...baseInput,
      title: '<script>alert("xss")</script>',
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders markdown links with target="_blank"', () => {
    const html = generateShareableHtml({
      ...baseInput,
      synthesizedResult: 'Check out [Google](https://google.com) for more info.',
    });

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://google.com"');
  });

  it('renders markdown links with title attribute', () => {
    const html = generateShareableHtml({
      ...baseInput,
      synthesizedResult: 'Check out [Google](https://google.com "Search engine") for more info.',
    });

    expect(html).toContain('title="Search engine"');
  });

  it('includes meta tags for social sharing', () => {
    const html = generateShareableHtml(baseInput);

    expect(html).toContain('og:title');
    expect(html).toContain('og:type');
    expect(html).toContain('og:url');
    expect(html).toContain('noindex, nofollow');
  });

  describe('llmResults section', () => {
    it('renders completed LLM results as collapsible sections', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result content',
          },
          {
            provider: LlmProviders.OpenAI,
            model: 'o4-mini',
            status: 'completed',
            result: 'OpenAI result content',
          },
        ],
      });

      expect(html).toContain('Individual Provider Reports');
      expect(html).toContain('<details>');
      expect(html).toContain(LlmModels.Gemini20Flash);
      expect(html).toContain('provider-google');
      expect(html).toContain('Google result content');
      expect(html).toContain('o4-mini');
      expect(html).toContain('provider-openai');
      expect(html).toContain('OpenAI result content');
    });

    it('excludes failed LLM results', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: LlmProviders.OpenAI,
            model: 'o4-mini',
            status: 'failed',
          },
        ],
      });

      expect(html).toContain(LlmModels.Gemini20Flash);
      expect(html).not.toContain('o4-mini');
    });

    it('excludes LLM results with empty result', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: LlmProviders.Google,
            model: LlmModels.Gemini20Flash,
            status: 'completed',
            result: '',
          },
        ],
      });

      expect(html).not.toContain('Individual Provider Reports');
    });

    it('does not render section when no llmResults provided', () => {
      const html = generateShareableHtml(baseInput);

      expect(html).not.toContain('Individual Provider Reports');
    });

    it('renders sources section when LLM result has sources', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: LlmProviders.Perplexity,
            model: LlmModels.SonarPro,
            status: 'completed',
            result: 'Research result with citations',
            sources: [
              'https://example.com/source1',
              'https://example.com/source2',
            ],
          },
        ],
      });

      expect(html).toContain('class="sources"');
      expect(html).toContain('<h4>Sources</h4>');
      expect(html).toContain('https://example.com/source1');
      expect(html).toContain('https://example.com/source2');
    });

    it('does not render sources when sources array is empty', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: LlmProviders.Perplexity,
            model: LlmModels.SonarPro,
            status: 'completed',
            result: 'Research result without citations',
            sources: [],
          },
        ],
      });

      expect(html).not.toContain('class="sources"');
    });
  });

  describe('generatedBy section', () => {
    it('renders "Generated by name with IntexuraOS" when name provided', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { name: 'John Doe' },
      });

      expect(html).toContain('Generated by John Doe with IntexuraOS on January 15, 2024');
    });

    it('renders name with email in parentheses when both provided', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { name: 'John Doe', email: 'john@example.com' },
      });

      expect(html).toContain('Generated by John Doe (john@example.com) with IntexuraOS on January 15, 2024');
    });

    it('renders email only when name is missing', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { email: 'john@example.com' },
      });

      expect(html).toContain('Generated by john@example.com with IntexuraOS on January 15, 2024');
    });

    it('falls back to date only when generatedBy is undefined', () => {
      const html = generateShareableHtml(baseInput);

      expect(html).toContain('Generated on January 15, 2024');
      expect(html).not.toContain('Generated by');
    });

    it('falls back to date only when name and email are both empty strings', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { name: '', email: '' },
      });

      expect(html).toContain('Generated on January 15, 2024');
      expect(html).not.toContain('with IntexuraOS');
    });

    it('escapes HTML in name', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { name: '<script>alert("xss")</script>' },
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('escapes HTML in email', () => {
      const html = generateShareableHtml({
        ...baseInput,
        generatedBy: { email: '<script>alert("xss")</script>' },
      });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });
  });

  describe('inputContexts section', () => {
    it('renders input contexts as collapsible sections', () => {
      const html = generateShareableHtml({
        ...baseInput,
        inputContexts: [
          { content: 'Input context 1', label: 'claude-3.5-sonnet' },
          { content: 'Input context 2' },
        ],
      });

      expect(html).toContain('Additional Context');
      expect(html).toContain('<details>');
      expect(html).toContain('claude-3.5-sonnet');
      expect(html).toContain('Input context 1');
      expect(html).toContain('Context 2');
      expect(html).toContain('Input context 2');
    });

    it('uses numbered label when label is empty string', () => {
      const html = generateShareableHtml({
        ...baseInput,
        inputContexts: [{ content: 'Context content', label: '' }],
      });

      expect(html).toContain('Context 1');
    });

    it('uses numbered label when label is undefined', () => {
      const html = generateShareableHtml({
        ...baseInput,
        inputContexts: [{ content: 'Context content' } as { content: string; label?: string }],
      });

      expect(html).toContain('Context 1');
    });

    it('does not render section when empty array', () => {
      const html = generateShareableHtml({
        ...baseInput,
        inputContexts: [],
      });

      expect(html).not.toContain('Additional Context');
    });
  });
});
