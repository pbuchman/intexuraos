import { PullRequestReviewTemplate, IssueCommentTemplate, EditedBotReviewTemplate, createWebhookMessageBuilder } from '../../../domain/services/gitHubMessageBuilder.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import { describe, it, expect } from 'vitest';

const ALLOWED_BOTS = new Set(['claude[bot]', 'chatgpt-codex-connector[bot]']);

const mockPRReviewEvent: GitHubPREvent = {
  id: 'event-123',
  githubEventId: 123,
  deliveryId: null,
  repository: 'intexuraos/code-agent',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'pull_request_review',
  action: 'submitted',
  senderLogin: 'pbuchman',
  senderId: 999,
  senderType: 'User',
  prAuthorLogin: null,
  title: 'Test PR',
  body: 'Looks good, minor nit on line 5',
  state: 'open',
  baseBranch: null,
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {
    review: {
      id: 456,
      state: 'approved',
    },
  },
};

const mockIssueCommentEvent: GitHubPREvent = {
  id: 'event-124',
  githubEventId: 124,
  deliveryId: null,
  repository: 'intexuraos/code-agent',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'issue_comment',
  action: 'created',
  senderLogin: 'pbuchman',
  senderId: 999,
  senderType: 'User',
  prAuthorLogin: null,
  title: 'Test PR',
  body: 'Can you fix the lint error?',
  state: 'open',
  baseBranch: null,
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {
    comment: {
      id: 789,
    },
  },
};

const mockEditedBotEvent: GitHubPREvent = {
  id: 'event-125',
  githubEventId: 125,
  deliveryId: null,
  repository: 'intexuraos/code-agent',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'issue_comment',
  action: 'edited',
  senderLogin: 'claude[bot]',
  senderId: 888,
  senderType: 'Bot',
  prAuthorLogin: null,
  title: 'Test PR',
  body: '## Code Review\n- Found unused import on line 3',
  state: 'open',
  baseBranch: null,
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {
    comment: {
      id: 1010,
    },
  },
};

describe('GitHubMessageBuilder', () => {
  describe('PullRequestReviewTemplate', () => {
    it('renders header with PR number, repo, sender, review ID, and state', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent);

      expect(result).toContain('[PR Review] New review on PR #42 in intexuraos/code-agent');
      expect(result).toContain('From: @pbuchman');
      expect(result).toContain('Review ID: 456');
      expect(result).toContain('Review state: approved');
    });

    it('includes review body', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent);

      expect(result).toContain('Review body:\nLooks good, minor nit on line 5');
    });

    it('includes gh CLI instructions for inline comments and replies', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent);

      expect(result).toContain('gh pr view 42 --json state,merged');
      expect(result).toContain('gh api /repos/intexuraos/code-agent/pulls/42/reviews/456/comments');
      expect(result).toContain('React with rocket to each inline comment');
      expect(result).toContain('Reply to each comment');
    });

    it('uses literal ${repository} in worker instruction lines', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent);

      expect(result).toContain('gh api /repos/${repository}/pulls/comments/{id}/reactions');
      expect(result).toContain('gh api /repos/${repository}/pulls/${prNumber}/comments');
    });

    it('handles null body with (empty)', () => {
      const event: GitHubPREvent = { ...mockPRReviewEvent, body: null };
      const template = new PullRequestReviewTemplate();
      const result = template.render(event);

      expect(result).toContain('Review body:\n(empty)');
    });

    it('handles missing review payload gracefully', () => {
      const event: GitHubPREvent = { ...mockPRReviewEvent, payload: {} };
      const template = new PullRequestReviewTemplate();
      const result = template.render(event);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review state: unknown');
    });

    it('handles review with non-object review field', () => {
      const event: GitHubPREvent = { ...mockPRReviewEvent, payload: { review: 'not-an-object' } };
      const template = new PullRequestReviewTemplate();
      const result = template.render(event);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review state: unknown');
    });

    it('handles review with non-standard id and state types', () => {
      const event: GitHubPREvent = { ...mockPRReviewEvent, payload: { review: { id: true, state: 42 } } };
      const template = new PullRequestReviewTemplate();
      const result = template.render(event);

      expect(result).toContain('Review ID: unknown');
      expect(result).toContain('Review state: unknown');
    });

    it('does not include TaskContext', () => {
      const template = new PullRequestReviewTemplate();
      const result = template.render(mockPRReviewEvent);

      expect(result).not.toContain('Task ID');
      expect(result).not.toContain('User ID');
    });
  });

  describe('IssueCommentTemplate', () => {
    it('renders header with PR number, repo, sender, and comment ID', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent);

      expect(result).toContain('[PR Comment] New comment on PR #42 in intexuraos/code-agent');
      expect(result).toContain('From: @pbuchman');
      expect(result).toContain('Comment ID: 789');
      expect(result).toContain('Type: issue_comment');
    });

    it('includes commenter body', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent);

      expect(result).toContain('The commenter said:\nCan you fix the lint error?');
    });

    it('includes gh CLI instructions for reactions and replies', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent);

      expect(result).toContain('gh api /repos/intexuraos/code-agent/issues/comments/789/reactions');
      expect(result).toContain('gh api /repos/intexuraos/code-agent/issues/42/comments -f body="..."');
    });

    it('handles null body with (empty)', () => {
      const event: GitHubPREvent = { ...mockIssueCommentEvent, body: null };
      const template = new IssueCommentTemplate();
      const result = template.render(event);

      expect(result).toContain('The commenter said:\n(empty)');
    });

    it('handles missing comment payload gracefully', () => {
      const event: GitHubPREvent = { ...mockIssueCommentEvent, payload: {} };
      const template = new IssueCommentTemplate();
      const result = template.render(event);

      expect(result).toContain('Comment ID: unknown');
    });

    it('does not include TaskContext', () => {
      const template = new IssueCommentTemplate();
      const result = template.render(mockIssueCommentEvent);

      expect(result).not.toContain('Task ID');
      expect(result).not.toContain('User ID');
    });
  });

  describe('EditedBotReviewTemplate', () => {
    it('renders header with PR number, repo, sender, and comment ID', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('[PR Comment — Bot Review Edit] Comment updated on PR #42 in intexuraos/code-agent');
      expect(result).toContain('From: @claude[bot]');
      expect(result).toContain('Comment ID: 1010');
      expect(result).toContain('Type: issue_comment (edited)');
    });

    it('includes full comment body', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('Full comment body:\n## Code Review\n- Found unused import on line 3');
    });

    it('includes in-progress detection instructions', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('CHECK IF REVIEW IS STILL IN PROGRESS');
      expect(result).toContain('Body contains "is working"');
    });

    it('includes triage table instructions', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('Post a response comment with a triage table');
      expect(result).toContain('Columns: # | Finding | Verdict (FIX/SKIP) | Reasoning | Action');
    });

    it('includes mandatory implementation warning', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('MANDATORY — DO NOT STOP AFTER POSTING THE TABLE');
      expect(result).toContain('contract violation');
    });

    it('includes gh CLI instructions for reactions', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).toContain('gh api /repos/intexuraos/code-agent/issues/comments/1010/reactions -f content=rocket');
    });

    it('handles null body with (empty)', () => {
      const event: GitHubPREvent = { ...mockEditedBotEvent, body: null };
      const template = new EditedBotReviewTemplate();
      const result = template.render(event);

      expect(result).toContain('Full comment body:\n(empty)');
    });

    it('does not include TaskContext', () => {
      const template = new EditedBotReviewTemplate();
      const result = template.render(mockEditedBotEvent);

      expect(result).not.toContain('Task ID');
      expect(result).not.toContain('User ID');
    });
  });

  describe('createWebhookMessageBuilder', () => {
    it('routes pull_request_review to PullRequestReviewTemplate', () => {
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(mockPRReviewEvent);

      expect(result).toContain('[PR Review] New review on PR #42');
    });

    it('routes issue_comment to IssueCommentTemplate', () => {
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(mockIssueCommentEvent);

      expect(result).toContain('[PR Comment] New comment on PR #42');
    });

    it('routes edited bot comment to EditedBotReviewTemplate', () => {
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(mockEditedBotEvent);

      expect(result).toContain('[PR Comment — Bot Review Edit]');
    });

    it('does not route edited non-bot comment to EditedBotReviewTemplate', () => {
      const nonBotEditedEvent: GitHubPREvent = {
        ...mockEditedBotEvent,
        senderLogin: 'random-user',
      };
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(nonBotEditedEvent);

      expect(result).toContain('[PR Comment] New comment on PR #42');
      expect(result).not.toContain('Bot Review Edit');
    });

    it('falls back to IssueCommentTemplate for unknown event types', () => {
      const unknownEvent: GitHubPREvent = {
        ...mockIssueCommentEvent,
        eventType: 'push',
        action: 'created',
      };
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(unknownEvent);

      expect(result).toContain('[PR Comment] New comment on PR #42');
    });

    it('prioritizes edited bot detection over eventType routing', () => {
      const editedBotReviewEvent: GitHubPREvent = {
        ...mockPRReviewEvent,
        action: 'edited',
        senderLogin: 'claude[bot]',
        payload: { comment: { id: 555 } },
      };
      const builder = createWebhookMessageBuilder(ALLOWED_BOTS);
      const result = builder.build(editedBotReviewEvent);

      expect(result).toContain('[PR Comment — Bot Review Edit]');
    });

  });
});
