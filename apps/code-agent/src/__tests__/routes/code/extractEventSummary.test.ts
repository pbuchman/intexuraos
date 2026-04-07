import { describe, it, expect } from 'vitest';
import { extractEventSummary } from '../../../routes/code/extractEventSummary.js';

describe('extractEventSummary', () => {
  describe('issue_comment', () => {
    it('returns comment body truncated to ~100 chars', () => {
      const payload = { comment: { body: 'Looks good to me!' } };
      expect(extractEventSummary('issue_comment', payload)).toBe('Looks good to me!');
    });

    it('truncates long comment body with ellipsis', () => {
      const longBody = 'A'.repeat(150);
      const payload = { comment: { body: longBody } };
      const result = extractEventSummary('issue_comment', payload);
      expect(result).toHaveLength(101); // 100 + ellipsis char
      expect(result?.endsWith('\u2026')).toBe(true);
    });

    it('returns null when comment has no body', () => {
      const payload = { comment: {} };
      expect(extractEventSummary('issue_comment', payload)).toBeNull();
    });

    it('returns null when comment body is empty string', () => {
      const payload = { comment: { body: '' } };
      expect(extractEventSummary('issue_comment', payload)).toBeNull();
    });

    it('returns null when comment body is whitespace only', () => {
      const payload = { comment: { body: '   ' } };
      expect(extractEventSummary('issue_comment', payload)).toBeNull();
    });

    it('returns null when comment is missing', () => {
      const payload = {};
      expect(extractEventSummary('issue_comment', payload)).toBeNull();
    });

    it('returns null when comment is not an object', () => {
      const payload = { comment: 'not an object' };
      expect(extractEventSummary('issue_comment', payload)).toBeNull();
    });

    it('replaces newlines with spaces', () => {
      const payload = { comment: { body: 'Line one\nLine two\r\nLine three' } };
      expect(extractEventSummary('issue_comment', payload)).toBe('Line one Line two Line three');
    });
  });

  describe('pull_request_review_comment', () => {
    it('returns comment body', () => {
      const payload = { comment: { body: 'Needs a fix here' } };
      expect(extractEventSummary('pull_request_review_comment', payload)).toBe('Needs a fix here');
    });
  });

  describe('pull_request_review', () => {
    describe('COMMENTED state', () => {
      it('returns body only, stripping COMMENTED prefix', () => {
        const payload = { review: { state: 'commented', body: 'Looks good to me' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('Looks good to me');
      });

      it('returns null when body is null (nothing meaningful to show)', () => {
        const payload = { review: { state: 'commented', body: null } };
        expect(extractEventSummary('pull_request_review', payload)).toBeNull();
      });

      it('returns null when body is empty', () => {
        const payload = { review: { state: 'commented', body: '' } };
        expect(extractEventSummary('pull_request_review', payload)).toBeNull();
      });

      it('returns null when body is whitespace only', () => {
        const payload = { review: { state: 'commented', body: '  ' } };
        expect(extractEventSummary('pull_request_review', payload)).toBeNull();
      });

      it('truncates long body', () => {
        const payload = { review: { state: 'commented', body: 'B'.repeat(150) } };
        const result = extractEventSummary('pull_request_review', payload);
        expect(result).not.toBeNull();
        expect(result).toHaveLength(101); // 100 + ellipsis
        expect(result?.startsWith('B')).toBe(true);
      });
    });

    describe('APPROVED state', () => {
      it('prepends ✓ indicator when body is present', () => {
        const payload = { review: { state: 'approved', body: 'Looks good' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✓ Looks good');
      });

      it('returns ✓ indicator only when body is null', () => {
        const payload = { review: { state: 'approved', body: null } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✓');
      });

      it('returns ✓ indicator only when body is empty', () => {
        const payload = { review: { state: 'approved', body: '' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✓');
      });

      it('truncates long body with ✓ prefix', () => {
        const payload = { review: { state: 'approved', body: 'B'.repeat(150) } };
        const result = extractEventSummary('pull_request_review', payload);
        expect(result).not.toBeNull();
        expect(result).toHaveLength(101); // 100 + ellipsis
        expect(result?.startsWith('✓ B')).toBe(true);
      });
    });

    describe('CHANGES_REQUESTED state', () => {
      it('prepends ✗ indicator when body is present', () => {
        const payload = { review: { state: 'changes_requested', body: 'Please fix X' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✗ Please fix X');
      });

      it('returns ✗ indicator only when body is null', () => {
        const payload = { review: { state: 'changes_requested', body: null } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✗');
      });

      it('returns ✗ indicator only when body is empty', () => {
        const payload = { review: { state: 'changes_requested', body: '' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('✗');
      });
    });

    describe('other states (DISMISSED, PENDING)', () => {
      it('returns body only for DISMISSED with body', () => {
        const payload = { review: { state: 'dismissed', body: 'Review dismissed' } };
        expect(extractEventSummary('pull_request_review', payload)).toBe('Review dismissed');
      });

      it('returns null for DISMISSED with no body', () => {
        const payload = { review: { state: 'dismissed', body: null } };
        expect(extractEventSummary('pull_request_review', payload)).toBeNull();
      });

      it('returns null for PENDING with no body', () => {
        const payload = { review: { state: 'pending', body: '' } };
        expect(extractEventSummary('pull_request_review', payload)).toBeNull();
      });
    });

    it('returns null when review is missing', () => {
      expect(extractEventSummary('pull_request_review', {})).toBeNull();
    });

    it('returns null when state is missing', () => {
      const payload = { review: { body: 'Some feedback' } };
      expect(extractEventSummary('pull_request_review', payload)).toBeNull();
    });
  });

  describe('pull_request', () => {
    it('returns PR title', () => {
      const payload = { pull_request: { title: 'Add user authentication' } };
      expect(extractEventSummary('pull_request', payload)).toBe('Add user authentication');
    });

    it('returns null when PR has no title', () => {
      const payload = { pull_request: {} };
      expect(extractEventSummary('pull_request', payload)).toBeNull();
    });

    it('returns null when PR title is empty', () => {
      const payload = { pull_request: { title: '' } };
      expect(extractEventSummary('pull_request', payload)).toBeNull();
    });

    it('returns null when pull_request is missing', () => {
      expect(extractEventSummary('pull_request', {})).toBeNull();
    });

    it('truncates long PR title', () => {
      const payload = { pull_request: { title: 'T'.repeat(150) } };
      const result = extractEventSummary('pull_request', payload);
      expect(result).toHaveLength(101);
      expect(result?.endsWith('\u2026')).toBe(true);
    });
  });

  describe('push', () => {
    it('returns head commit message', () => {
      const payload = { head_commit: { message: 'fix: resolve memory leak' } };
      expect(extractEventSummary('push', payload)).toBe('fix: resolve memory leak');
    });

    it('falls back to commit count when no head_commit', () => {
      const payload = { commits: [{ id: '1' }, { id: '2' }, { id: '3' }] };
      expect(extractEventSummary('push', payload)).toBe('3 commits');
    });

    it('uses singular form for single commit', () => {
      const payload = { commits: [{ id: '1' }] };
      expect(extractEventSummary('push', payload)).toBe('1 commit');
    });

    it('returns null when no head_commit and empty commits', () => {
      const payload = { commits: [] };
      expect(extractEventSummary('push', payload)).toBeNull();
    });

    it('returns null when no head_commit and no commits', () => {
      expect(extractEventSummary('push', {})).toBeNull();
    });

    it('truncates long commit message', () => {
      const payload = { head_commit: { message: 'M'.repeat(150) } };
      const result = extractEventSummary('push', payload);
      expect(result).toHaveLength(101);
    });

    it('prefers head_commit over commit count', () => {
      const payload = {
        head_commit: { message: 'fix: resolve issue' },
        commits: [{ id: '1' }, { id: '2' }],
      };
      expect(extractEventSummary('push', payload)).toBe('fix: resolve issue');
    });

    it('returns null when head_commit message is empty', () => {
      const payload = { head_commit: { message: '' }, commits: [{ id: '1' }] };
      expect(extractEventSummary('push', payload)).toBe('1 commit');
    });
  });

  describe('unsupported event types', () => {
    it('returns null for unknown event type', () => {
      expect(extractEventSummary('deployment', { some: 'data' })).toBeNull();
    });
  });

  describe('invalid payloads', () => {
    it('returns null for non-object payload', () => {
      expect(extractEventSummary('issue_comment', 'not an object')).toBeNull();
    });

    it('returns null for null payload', () => {
      expect(extractEventSummary('issue_comment', null)).toBeNull();
    });

    it('returns null for array payload', () => {
      expect(extractEventSummary('issue_comment', [1, 2, 3])).toBeNull();
    });
  });
});
