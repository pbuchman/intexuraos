/**
 * Tests for HTML generator utility.
 */

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
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Google result content',
          },
          {
            provider: 'openai',
            model: 'o4-mini',
            status: 'completed',
            result: 'OpenAI result content',
          },
        ],
      });

      expect(html).toContain('Individual Provider Reports');
      expect(html).toContain('<details>');
      expect(html).toContain('gemini-2.0-flash');
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
            provider: 'google',
            model: 'gemini-2.0-flash',
            status: 'completed',
            result: 'Google result',
          },
          {
            provider: 'openai',
            model: 'o4-mini',
            status: 'failed',
          },
        ],
      });

      expect(html).toContain('gemini-2.0-flash');
      expect(html).not.toContain('o4-mini');
    });

    it('excludes LLM results with empty result', () => {
      const html = generateShareableHtml({
        ...baseInput,
        llmResults: [
          {
            provider: 'google',
            model: 'gemini-2.0-flash',
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

    it('does not render section when empty array', () => {
      const html = generateShareableHtml({
        ...baseInput,
        inputContexts: [],
      });

      expect(html).not.toContain('Additional Context');
    });
  });
});
