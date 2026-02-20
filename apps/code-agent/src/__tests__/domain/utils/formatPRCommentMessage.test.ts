import { describe, it, expect } from 'vitest';
import { formatPRCommentMessage } from '../../../domain/utils/formatPRCommentMessage.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';

function createBaseEvent(overrides: Partial<GitHubPREvent>): GitHubPREvent {
  return {
    id: 'evt-1',
    githubEventId: 123,
    repository: 'test/intexuraos',
    repositoryId: 456,
    pullRequestNumber: 42,
    pullRequestId: 101,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'reviewer',
    senderId: 222,
    senderType: 'User',
    title: 'Test PR',
    body: 'Please fix the lint errors',
    state: 'open',
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: {},
    ...overrides,
  };
}

describe('formatPRCommentMessage', () => {
  describe('issue_comment events', () => {
    it('formats a basic issue comment', () => {
      const event = createBaseEvent({
        eventType: 'issue_comment',
        body: 'Please fix the lint errors',
      });

      const result = formatPRCommentMessage(event);

      expect(result).toBe(
        '[PR Comment] from @reviewer on PR #42\n\nPlease fix the lint errors'
      );
    });

    it('handles null body gracefully', () => {
      const event = createBaseEvent({
        eventType: 'issue_comment',
        body: null,
      });

      const result = formatPRCommentMessage(event);

      expect(result).toBe('[PR Comment] from @reviewer on PR #42\n\n');
    });
  });

  describe('pull_request_review_comment events', () => {
    it('formats inline comment with file, line, and diff context', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review_comment',
        body: 'This variable is unused',
        payload: {
          comment: {
            path: 'src/utils/helper.ts',
            line: 42,
            diff_hunk: '@@ -40,6 +40,8 @@\n context line\n+const unused = true;\n+const used = false;',
          },
        },
      });

      const result = formatPRCommentMessage(event);

      expect(result).toContain('[PR Inline Comment] from @reviewer on PR #42');
      expect(result).toContain('File: src/utils/helper.ts:42');
      expect(result).toContain('Diff context:');
      expect(result).toContain('```');
      expect(result).toContain('This variable is unused');
    });

    it('formats inline comment without line number', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review_comment',
        body: 'General comment on this file',
        payload: {
          comment: {
            path: 'src/index.ts',
            line: null,
            diff_hunk: '+new line',
          },
        },
      });

      const result = formatPRCommentMessage(event);

      expect(result).toContain('File: src/index.ts');
      expect(result).not.toContain('src/index.ts:');
    });

    it('formats inline comment without diff hunk', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review_comment',
        body: 'Needs refactoring',
        payload: {
          comment: {
            path: 'src/index.ts',
            line: 10,
          },
        },
      });

      const result = formatPRCommentMessage(event);

      expect(result).toContain('File: src/index.ts:10');
      expect(result).not.toContain('Diff context:');
      expect(result).toContain('Needs refactoring');
    });

    it('truncates long diff hunks to last 5 lines', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${String(i + 1)}`);
      const event = createBaseEvent({
        eventType: 'pull_request_review_comment',
        body: 'Check this',
        payload: {
          comment: {
            path: 'src/file.ts',
            line: 5,
            diff_hunk: lines.join('\n'),
          },
        },
      });

      const result = formatPRCommentMessage(event);
      const codeBlock = result.split('```')[1] ?? '';
      const diffLines = codeBlock.trim().split('\n');

      expect(diffLines).toHaveLength(5);
      expect(diffLines[0]).toBe('line 6');
      expect(diffLines[4]).toBe('line 10');
    });

    it('handles missing payload comment gracefully', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review_comment',
        body: 'Some comment',
        payload: {},
      });

      const result = formatPRCommentMessage(event);

      expect(result).toContain('[PR Inline Comment] from @reviewer on PR #42');
      expect(result).not.toContain('File:');
      expect(result).toContain('Some comment');
    });
  });

  describe('pull_request_review events', () => {
    it('formats a review with state', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review',
        body: 'Please address the issues above',
        payload: {
          review: {
            state: 'changes_requested',
          },
        },
      });

      const result = formatPRCommentMessage(event);

      expect(result).toBe(
        '[PR Review] from @reviewer on PR #42 (state: changes_requested)\n\nPlease address the issues above'
      );
    });

    it('handles missing review state', () => {
      const event = createBaseEvent({
        eventType: 'pull_request_review',
        body: 'Approved',
        payload: {},
      });

      const result = formatPRCommentMessage(event);

      expect(result).toContain('(state: unknown)');
      expect(result).toContain('Approved');
    });
  });
});
