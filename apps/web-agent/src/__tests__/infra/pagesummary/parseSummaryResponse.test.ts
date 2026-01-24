import { describe, expect, it } from 'vitest';
import { parseSummaryResponseSync as parseSummaryResponse } from '../../../infra/pagesummary/parseSummaryResponse.js';

describe('parseSummaryResponse', () => {
  describe('valid summaries', () => {
    it('returns parsed summary for plain text', () => {
      const result = parseSummaryResponse('This is a valid summary about the page.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is a valid summary about the page.');
        expect(result.value.wordCount).toBe(8);
      }
    });

    it('handles multi-sentence summaries', () => {
      const result = parseSummaryResponse(
        'This is the first sentence. This is the second sentence. This is the third.'
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe(
          'This is the first sentence. This is the second sentence. This is the third.'
        );
        expect(result.value.wordCount).toBe(14);
      }
    });

    it('counts words correctly with multiple spaces', () => {
      const result = parseSummaryResponse('Word1    Word2  Word3');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wordCount).toBe(3);
      }
    });
  });

  describe('markdown code block stripping', () => {
    it('strips bare ``` code blocks', () => {
      const result = parseSummaryResponse('```\nThis is the summary.\n```');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary.');
      }
    });

    it('strips ```markdown code blocks', () => {
      const result = parseSummaryResponse('```markdown\nThis is the summary.\n```');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary.');
      }
    });

    it('strips ```text code blocks', () => {
      const result = parseSummaryResponse('```text\nThis is the summary.\n```');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary.');
      }
    });

    it('handles case variations in markdown tags', () => {
      const result = parseSummaryResponse('```MARKDOWN\nThis is the summary.\n```');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary.');
      }
    });

    it('strips opening ``` without closing', () => {
      const result = parseSummaryResponse('```\nThis is the summary text.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary text.');
      }
    });
  });

  describe('JSON detection', () => {
    it('rejects valid JSON object', () => {
      const json = '{"summary": "This is a summary", "wordCount": 5}';
      const result = parseSummaryResponse(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('JSON_FORMAT');
        expect(result.error.message).toContain('expected prose text');
      }
    });

    it('rejects valid JSON array', () => {
      const json = '[{"index": 0, "content": "text"}]';
      const result = parseSummaryResponse(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('JSON_FORMAT');
      }
    });

    it('rejects the original buggy Crawl4AI output', () => {
      const json = '[{"index": 0, "tags": ["introduction"], "content": ["The best thing you can do..."]}]';
      const result = parseSummaryResponse(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('JSON_FORMAT');
      }
    });

    it('allows bracket characters that are NOT valid JSON', () => {
      const text = '[This article discusses...] important topics.';
      const result = parseSummaryResponse(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe(text);
      }
    });

    it('allows content starting with { that is not valid JSON', () => {
      const text = '{This} is just text with curly braces.';
      const result = parseSummaryResponse(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe(text);
      }
    });
  });

  describe('unwanted prefix stripping', () => {
    it('strips "Here is" prefix', () => {
      const result = parseSummaryResponse('Here is the summary of the article.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('the summary of the article.');
      }
    });

    it('strips "HERE IS" prefix (uppercase)', () => {
      const result = parseSummaryResponse('HERE IS the summary of the article.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('the summary of the article.');
      }
    });

    it('strips "summary:" prefix', () => {
      const result = parseSummaryResponse('Summary: This is the content.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the content.');
      }
    });

    it('strips "The summary" prefix', () => {
      const result = parseSummaryResponse('The summary follows: content here.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('follows: content here.');
      }
    });

    it('strips "Below is" prefix', () => {
      const result = parseSummaryResponse('Below is the summary text.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('the summary text.');
      }
    });

    it('strips "Here\'s" prefix', () => {
      const result = parseSummaryResponse("Here's a summary of the page.");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('a summary of the page.');
      }
    });

    it('strips "The following is" prefix', () => {
      const result = parseSummaryResponse('The following is a summary.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('a summary.');
      }
    });

    it('only strips prefix when followed by space/colon/newline', () => {
      const result = parseSummaryResponse('Hereismiddleware word');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should NOT strip because "ismiddleware" is one word
        expect(result.value.summary).toBe('Hereismiddleware word');
      }
    });

    it('strips prefix when followed by colon', () => {
      const result = parseSummaryResponse('Summary: The content follows');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('The content follows');
      }
    });
  });

  describe('empty content validation', () => {
    it('rejects whitespace-only content after cleaning', () => {
      const result = parseSummaryResponse('   \n\n  ');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY');
      }
    });

    it('rejects empty string', () => {
      const result = parseSummaryResponse('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY');
      }
    });

    it('rejects content that becomes empty after prefix stripping', () => {
      const result = parseSummaryResponse('Summary:    ');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY');
        expect(result.error.message).toContain('after stripping prefixes');
      }
    });

    it('rejects content that becomes empty after markdown cleaning', () => {
      const result = parseSummaryResponse('```\n```');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY');
        expect(result.error.message).toContain('after cleaning');
      }
    });
  });

  describe('combined scenarios', () => {
    it('handles markdown with JSON-like content inside', () => {
      const result = parseSummaryResponse(
        '```\nThe article mentions [key points] in the text.\n```'
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('The article mentions [key points] in the text.');
      }
    });

    it('handles summary with prefix and markdown', () => {
      // Markdown stripping removes trailing ``` at end of string, but opening ``` in middle stays
      // Order: 1) strip trailing ```, 2) strip "Here is" prefix
      const result = parseSummaryResponse('Here is the summary:\n```\nContent\n```');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('the summary:\n```\nContent');
      }
    });

    it('trims surrounding whitespace', () => {
      const result = parseSummaryResponse('  This is the summary.  ');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toBe('This is the summary.');
      }
    });
  });
});
