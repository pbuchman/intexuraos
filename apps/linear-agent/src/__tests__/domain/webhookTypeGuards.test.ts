/**
 * Tests for webhook type guards.
 */
import { describe, expect, it } from 'vitest';
import { isIssueWebhookData, isCommentWebhookData } from '../../domain/webhookTypeGuards.js';

describe('webhookTypeGuards', () => {
  describe('isIssueWebhookData', () => {
    it('returns true for valid issue webhook data', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
        description: 'Test description',
        priority: 2,
        url: 'https://linear.app/issue/INT-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        state: {
          id: 'state-1',
          name: 'Backlog',
          type: 'backlog',
        },
        assignee: null,
        labels: [],
        team: {
          id: 'team-1',
          key: 'TEAM',
        },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });

    it('returns true for issue data with assignee', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
        description: 'Test description',
        priority: 2,
        url: 'https://linear.app/issue/INT-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        state: {
          id: 'state-1',
          name: 'In Progress',
          type: 'started',
        },
        assignee: {
          id: 'user-1',
          name: 'Test User',
        },
        labels: [
          { id: 'label-1', name: 'bug' },
        ],
        team: {
          id: 'team-1',
          key: 'TEAM',
        },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });

    it('returns false for null data', () => {
      expect(isIssueWebhookData(null)).toBe(false);
    });

    it('returns false for undefined data', () => {
      expect(isIssueWebhookData(undefined)).toBe(false);
    });

    it('returns false for string data', () => {
      expect(isIssueWebhookData('not an object')).toBe(false);
    });

    it('returns false for number data', () => {
      expect(isIssueWebhookData(123)).toBe(false);
    });

    it('returns false for comment webhook data', () => {
      const commentData = {
        id: 'comment-123',
        issueId: 'issue-123',
        issueIdentifier: 'INT-123',
        user: {
          id: 'user-1',
          name: 'Test User',
        },
        body: 'Test comment',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isIssueWebhookData(commentData)).toBe(false);
    });

    it('returns false when team is missing', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
      };

      expect(isIssueWebhookData(issueData)).toBe(false);
    });

    it('returns false when team is not an object', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
        team: 'not-an-object',
      };

      expect(isIssueWebhookData(issueData)).toBe(false);
    });

    it('returns true when only team is present (lenient type guard)', () => {
      // Type guard only checks for team presence, not other fields
      // Full validation happens during processing
      const issueData = {
        team: { id: 'team-1', key: 'TEAM' },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });

    it('returns true even when id is missing (lenient type guard)', () => {
      const issueData = {
        identifier: 'INT-123',
        title: 'Test Issue',
        team: { id: 'team-1', key: 'TEAM' },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });

    it('returns true even when identifier is missing (lenient type guard)', () => {
      const issueData = {
        id: 'issue-123',
        title: 'Test Issue',
        team: { id: 'team-1', key: 'TEAM' },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });

    it('returns true even when title is missing (lenient type guard)', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        team: { id: 'team-1', key: 'TEAM' },
      };

      expect(isIssueWebhookData(issueData)).toBe(true);
    });
  });

  describe('isCommentWebhookData', () => {
    it('returns true for valid comment webhook data', () => {
      const commentData = {
        id: 'comment-123',
        issueId: 'issue-123',
        issueIdentifier: 'INT-123',
        user: {
          id: 'user-1',
          name: 'Test User',
        },
        body: 'Test comment body',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(true);
    });

    it('returns false for null data', () => {
      expect(isCommentWebhookData(null)).toBe(false);
    });

    it('returns false for undefined data', () => {
      expect(isCommentWebhookData(undefined)).toBe(false);
    });

    it('returns false for string data', () => {
      expect(isCommentWebhookData('not an object')).toBe(false);
    });

    it('returns false for number data', () => {
      expect(isCommentWebhookData(123)).toBe(false);
    });

    it('returns false for issue webhook data', () => {
      const issueData = {
        id: 'issue-123',
        identifier: 'INT-123',
        title: 'Test Issue',
        description: 'Test description',
        priority: 2,
        url: 'https://linear.app/issue/INT-123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        state: {
          id: 'state-1',
          name: 'Backlog',
          type: 'backlog',
        },
        assignee: null,
        labels: [],
        team: {
          id: 'team-1',
          key: 'TEAM',
        },
      };

      expect(isCommentWebhookData(issueData)).toBe(false);
    });

    it('returns false when issueId is missing', () => {
      const commentData = {
        id: 'comment-123',
        issueIdentifier: 'INT-123',
        user: { id: 'user-1', name: 'Test User' },
        body: 'Test comment',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(false);
    });

    it('returns false when issueId is not a string', () => {
      const commentData = {
        id: 'comment-123',
        issueId: 123,
        issueIdentifier: 'INT-123',
        user: { id: 'user-1', name: 'Test User' },
        body: 'Test comment',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(false);
    });

    it('returns true when only issueId is present (lenient type guard)', () => {
      // Type guard only checks for issueId presence, not other fields
      // Full validation happens during processing
      const commentData = {
        issueId: 'issue-123',
      };

      expect(isCommentWebhookData(commentData)).toBe(true);
    });

    it('returns true even when id is missing (lenient type guard)', () => {
      const commentData = {
        issueId: 'issue-123',
        issueIdentifier: 'INT-123',
        user: { id: 'user-1', name: 'Test User' },
        body: 'Test comment',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(true);
    });

    it('returns true even when body is missing (lenient type guard)', () => {
      const commentData = {
        id: 'comment-123',
        issueId: 'issue-123',
        issueIdentifier: 'INT-123',
        user: { id: 'user-1', name: 'Test User' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(true);
    });

    it('returns true even when issueIdentifier is missing (lenient type guard)', () => {
      const commentData = {
        id: 'comment-123',
        issueId: 'issue-123',
        user: { id: 'user-1', name: 'Test User' },
        body: 'Test comment',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(isCommentWebhookData(commentData)).toBe(true);
    });
  });
});
