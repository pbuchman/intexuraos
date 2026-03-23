import { describe, expect, it } from 'vitest';
import { extractEventUrl } from '../../../routes/code/extractEventUrl.js';

describe('extractEventUrl', () => {
  describe('issue_comment', () => {
    it('should extract html_url from payload.comment', () => {
      const url = 'https://github.com/org/repo/pull/42#issuecomment-123';
      expect(extractEventUrl('issue_comment', { comment: { html_url: url } })).toBe(url);
    });

    it('should return null when comment is missing', () => {
      expect(extractEventUrl('issue_comment', {})).toBeNull();
    });

    it('should return null when comment is not an object', () => {
      expect(extractEventUrl('issue_comment', { comment: 'not-object' })).toBeNull();
    });

    it('should return null when html_url is missing from comment', () => {
      expect(extractEventUrl('issue_comment', { comment: {} })).toBeNull();
    });
  });

  describe('pull_request_review_comment', () => {
    it('should extract html_url from payload.comment', () => {
      const url = 'https://github.com/org/repo/pull/42#discussion_r789';
      expect(extractEventUrl('pull_request_review_comment', { comment: { html_url: url } })).toBe(url);
    });

    it('should return null when comment is missing', () => {
      expect(extractEventUrl('pull_request_review_comment', {})).toBeNull();
    });
  });

  describe('pull_request_review', () => {
    it('should extract html_url from payload.review', () => {
      const url = 'https://github.com/org/repo/pull/42#pullrequestreview-456';
      expect(extractEventUrl('pull_request_review', { review: { html_url: url } })).toBe(url);
    });

    it('should return null when review is missing', () => {
      expect(extractEventUrl('pull_request_review', {})).toBeNull();
    });

    it('should return null when review is not an object', () => {
      expect(extractEventUrl('pull_request_review', { review: null })).toBeNull();
    });
  });

  describe('pull_request', () => {
    it('should extract html_url from payload.pull_request', () => {
      const url = 'https://github.com/org/repo/pull/42';
      expect(extractEventUrl('pull_request', { pull_request: { html_url: url } })).toBe(url);
    });

    it('should return null when pull_request is missing', () => {
      expect(extractEventUrl('pull_request', {})).toBeNull();
    });

    it('should return compare URL for synchronize events with before/after SHAs', () => {
      const payload = {
        before: 'abc1234',
        after: 'def5678',
        repository: { full_name: 'intexuraos/intexuraos' },
        pull_request: { html_url: 'https://github.com/intexuraos/intexuraos/pull/42' },
      };
      expect(extractEventUrl('pull_request', payload)).toBe(
        'https://github.com/intexuraos/intexuraos/compare/abc1234...def5678'
      );
    });

    it('should fall back to PR URL when before/after present but full_name is not a string', () => {
      const payload = {
        before: 'abc1234',
        after: 'def5678',
        repository: { full_name: 12345 },
        pull_request: { html_url: 'https://github.com/org/repo/pull/42' },
      };
      expect(extractEventUrl('pull_request', payload)).toBe(
        'https://github.com/org/repo/pull/42'
      );
    });

    it('should fall back to PR URL when before/after present but repository missing', () => {
      const payload = {
        before: 'abc1234',
        after: 'def5678',
        pull_request: { html_url: 'https://github.com/org/repo/pull/42' },
      };
      expect(extractEventUrl('pull_request', payload)).toBe(
        'https://github.com/org/repo/pull/42'
      );
    });
  });

  describe('push', () => {
    it('should extract compare from payload', () => {
      const url = 'https://github.com/org/repo/compare/abc123...def456';
      expect(extractEventUrl('push', { compare: url })).toBe(url);
    });

    it('should return null when compare is missing', () => {
      expect(extractEventUrl('push', {})).toBeNull();
    });

    it('should return null when compare is not a string', () => {
      expect(extractEventUrl('push', { compare: 123 })).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should return null for unknown event type', () => {
      expect(extractEventUrl('unknown_event', { comment: { html_url: 'https://example.com' } })).toBeNull();
    });

    it('should return null for null payload', () => {
      expect(extractEventUrl('issue_comment', null)).toBeNull();
    });

    it('should return null for non-object payload', () => {
      expect(extractEventUrl('issue_comment', 'string-payload')).toBeNull();
    });

    it('should return null for array payload', () => {
      expect(extractEventUrl('issue_comment', [{ comment: { html_url: 'url' } }])).toBeNull();
    });
  });
});
