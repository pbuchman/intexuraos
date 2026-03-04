import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import {
  RepositoryScopeRule,
  ActionableEventRule,
  SenderWhitelistRule,
  SkipPrefixRule,
  BotReviewEditRule,
  GitHubWebhookRules
} from '../../../domain/services/gitHubWebhookRules.js';

import { describe, it, expect } from 'vitest';

describe('GitHubWebhookRules', () => {
  const mockEvent: GitHubPREvent = {
    id: 'event-123',
    githubEventId: 123,
    repository: 'test-org/test-repo',
    repositoryId: 54321,
    pullRequestNumber: 123,
    pullRequestId: 12345,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'test-user',
    senderId: 999,
    senderType: 'User',
    title: 'Test PR',
    body: 'Test description',
    state: 'open',
    mergedAt: null,
    createdAt: new Date('2026-03-03T10:00:00Z'),
    processedAt: new Date('2026-03-03T10:00:00Z'),
    payload: {}
  };

  describe('RepositoryScopeRule', () => {
    it('should return actionable true when repository is in allowed scope', () => {
      const allowedRepos = new Set(['test-org/test-repo', 'other-org/other-repo']);
      const rule = new RepositoryScopeRule(allowedRepos);
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REPOSITORY_IN_SCOPE',
        context: { repository: 'test-org/test-repo' }
      });
    });

    it('should return shouldDispatch false when repository is not in allowed scope', () => {
      const allowedRepos = new Set(['other-org/other-repo']);
      const rule = new RepositoryScopeRule(allowedRepos);
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'REPOSITORY_NOT_IN_SCOPE',
        context: {
          repository: 'test-org/test-repo',
          allowedRepositories: ['other-org/other-repo']
        }
      });
    });
  });

  describe('ActionableEventRule', () => {
    const allowedBots = new Set(['claude[bot]']);

    it('should dispatch issue_comment + created', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'created' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ shouldDispatch: true, reason: 'ACTIONABLE_ISSUE_COMMENT' });
    });

    it('should dispatch pull_request_review + submitted', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'submitted' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ shouldDispatch: true, reason: 'ACTIONABLE_PR_REVIEW' });
    });

    it('should dispatch issue_comment + edited from allowed bot', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'edited' as const, senderLogin: 'claude[bot]' };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ shouldDispatch: true, reason: 'ACTIONABLE_BOT_EDIT' });
    });

    it('should NOT dispatch issue_comment + edited from non-bot', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'edited' as const, senderLogin: 'random-user' };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'issue_comment', action: 'edited' },
      });
    });

    it('should NOT dispatch pull_request + opened', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'opened' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'pull_request', action: 'opened' },
      });
    });

    it('should NOT dispatch pull_request_review + dismissed', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'dismissed' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'pull_request_review', action: 'dismissed' },
      });
    });

    it('should NOT dispatch issue_comment + deleted', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'deleted' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'issue_comment', action: 'deleted' },
      });
    });

    it('should NOT dispatch ping events', () => {
      const event = { ...mockEvent, eventType: 'ping' as const, action: null };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'ping', action: null },
      });
    });
  });

  describe('SenderWhitelistRule', () => {
    it('should return actionable true when sender is repository owner', () => {
      const event = { ...mockEvent, senderLogin: 'test-org' };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'SENDER_IS_REPO_OWNER',
        context: { sender: 'test-org', repoOwner: 'test-org' }
      });
    });

    it('should return actionable true when sender is in allowed bots list', () => {
      const event = { ...mockEvent, senderLogin: 'bot1' };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'SENDER_IS_ALLOWED_BOT',
        context: { sender: 'bot1', allowedBots: ['bot1', 'bot2'] }
      });
    });

    it('should return actionable false when sender is neither owner nor allowed bot', () => {
      const event = { ...mockEvent, senderLogin: 'random-user' };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'SENDER_NOT_WHITELISTED',
        context: {
          sender: 'random-user',
          repoOwner: 'test-org',
          allowedBots: ['bot1', 'bot2']
        }
      });
    });
  });

  describe('SkipPrefixRule', () => {
    it('should return shouldDispatch true for non-comment events', () => {
      const event = { ...mockEvent, body: null };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'NOT_A_COMMENT_EVENT'
      });
    });

    it('should return shouldDispatch true for empty comment bodies', () => {
      const event = { ...mockEvent, body: '  ' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'EMPTY_COMMENT'
      });
    });

    it('should return shouldDispatch false for comments starting with skip prefix', () => {
      const event = { ...mockEvent, body: '/ignore this' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '/', commentBody: '/ignore this' }
      });
    });

    it('should return shouldDispatch false for comments starting with exclamation mark', () => {
      const event = { ...mockEvent, body: '!skip this' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '!', commentBody: '!skip this' }
      });
    });

    it('should return shouldDispatch true for comments without skip prefixes', () => {
      const event = { ...mockEvent, body: 'This is a normal comment' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'COMMENT_DOES_NOT_HAVE_SKIP_PREFIX',
        context: { commentBody: 'this is a normal comment' }
      });
    });

    it('should handle custom skip prefixes', () => {
      const event = { ...mockEvent, body: '#skip this' };
      const rule = new SkipPrefixRule(['#', '@']);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '#', commentBody: '#skip this' }
      });
    });

    it('should match skip prefixes case-insensitively', () => {
      const rule = new SkipPrefixRule(['@claude', '@codex']);

      const upperCase = { ...mockEvent, body: '@Claude review this' };
      expect(rule.evaluate(upperCase).shouldDispatch).toBe(false);

      const allCaps = { ...mockEvent, body: '@CODEX fix this' };
      expect(rule.evaluate(allCaps).shouldDispatch).toBe(false);

      const mixedCase = { ...mockEvent, body: '@ClAuDe help' };
      expect(rule.evaluate(mixedCase).shouldDispatch).toBe(false);
    });
  });

  describe('BotReviewEditRule', () => {
    it('should return actionable true for non-review events', () => {
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'NOT_A_REVIEW_EDIT_EVENT'
      });
    });

    it('should return actionable true when reviewer info is missing', () => {
      const event = {
        ...mockEvent,
        senderLogin: '',
        payload: { changes: { body: { from: 'old' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REVIEWER_INFO_MISSING'
      });
    });

    it('should return actionable false for bot reviews with no meaningful changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'BOT_REVIEW_EDIT_NO_MEANINGFUL_CHANGES',
        context: {
          reviewer: 'claude-bot',
          changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } }
        }
      });
    });

    it('should return actionable true for bot reviews with body changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { body: { from: 'old body' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'claude-bot',
          isBot: true,
          changes: { body: { from: 'old body' } }
        }
      });
    });

    it('should return actionable true for bot reviews with state changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { state: { from: 'commented' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'claude-bot',
          isBot: true,
          changes: { state: { from: 'commented' } }
        }
      });
    });

    it('should return actionable true for non-bot reviewers', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'human-reviewer',
        payload: { changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'human-reviewer',
          isBot: false,
          changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } }
        }
      });
    });
  });

  describe('GitHubWebhookRules', () => {
    it('should return shouldDispatch true when all rules pass', () => {
      const event = { ...mockEvent, senderLogin: 'test-org' };
      const allowedRepos = new Set(['test-org/test-repo']);
      const allowedBots = new Set(['bot1']);
      const rules = [
        new RepositoryScopeRule(allowedRepos),
        new SenderWhitelistRule(allowedBots)
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'ALL_RULES_PASSED'
      });
    });

    it('should short-circuit on first rejection', () => {
      const allowedRepos = new Set(['other-org/other-repo']); // This will fail
      const allowedBots = new Set(['bot1']);
      const rules = [
        new RepositoryScopeRule(allowedRepos),
        new SenderWhitelistRule(allowedBots) // This won't be evaluated
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'REPOSITORY_NOT_IN_SCOPE',
        context: {
          repository: 'test-org/test-repo',
          allowedRepositories: ['other-org/other-repo']
        }
      });
    });

    it('should handle empty rules array', () => {
      const service = new GitHubWebhookRules([]);
      const result = service.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'ALL_RULES_PASSED'
      });
    });

    it('should evaluate rules in order', () => {
      const allowedRepos = new Set(['test-org/test-repo']);
      const allowedBots = new Set(['random-user']); // This will fail second
      const rules = [
        new RepositoryScopeRule(allowedRepos), // This passes
        new SenderWhitelistRule(allowedBots) // This fails
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(mockEvent);

      expect(result).toEqual({
        shouldDispatch: false,
        reason: 'SENDER_NOT_WHITELISTED',
        context: {
          sender: 'test-user',
          repoOwner: 'test-org',
          allowedBots: ['random-user']
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle wildcard repository patterns', () => {
      const event = { ...mockEvent, repository: 'intexuraos/some-repo' };
      const rule = new RepositoryScopeRule(new Set(['intexuraos/*']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        shouldDispatch: true,
        reason: 'REPOSITORY_IN_SCOPE',
        context: { repository: 'intexuraos/some-repo' }
      });
    });

    it('should reject repositories not matching wildcard', () => {
      const event = { ...mockEvent, repository: 'other-org/some-repo' };
      const rule = new RepositoryScopeRule(new Set(['intexuraos/*']));
      const result = rule.evaluate(event);

      expect(result.shouldDispatch).toBe(false);
      expect(result.reason).toBe('REPOSITORY_NOT_IN_SCOPE');
    });

    it('should handle malformed events with missing properties', () => {
      const partialEvent = {
        action: 'opened',
        number: 123,
      } as unknown as GitHubPREvent;

      const service = new GitHubWebhookRules([
        new RepositoryScopeRule(new Set(['test-org/test-repo'])),
        new SenderWhitelistRule(new Set(['test-user']))
      ]);
      expect(() => service.evaluate(partialEvent)).not.toThrow();
    });
  });
});