import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import {
  RepositoryScopeRule,
  ActionableEventRule,
  ProtectedBaseBranchRule,
  SenderWhitelistRule,
  SkipPrefixRule,
  BotReviewEditRule,
  CodeWorkerOutputRule,
  GitHubWebhookRules
} from '../../../domain/services/gitHubWebhookRules.js';

import { describe, it, expect } from 'vitest';

describe('GitHubWebhookRules', () => {
  const mockEvent: GitHubPREvent = {
    id: 'event-123',
    githubEventId: 123,
    deliveryId: null,
    repository: 'test-org/test-repo',
    repositoryId: 54321,
    pullRequestNumber: 123,
    pullRequestId: 12345,
    eventType: 'pull_request',
    action: 'opened',
    senderLogin: 'test-user',
    senderId: 999,
    senderType: 'User',
    prAuthorLogin: null,
    title: 'Test PR',
    body: 'Test description',
    state: 'open',
    baseBranch: null,
    mergedAt: null,
    createdAt: new Date('2026-03-03T10:00:00Z'),
    processedAt: new Date('2026-03-03T10:00:00Z'),
    payload: {}
  };

  describe('RepositoryScopeRule', () => {
    it('should return dispatch when repository is in allowed scope', () => {
      const allowedRepos = new Set(['test-org/test-repo', 'other-org/other-repo']);
      const rule = new RepositoryScopeRule(allowedRepos);
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REPOSITORY_IN_SCOPE',
        context: { repository: 'test-org/test-repo' }
      });
    });

    it('should return skip when repository is not in allowed scope', () => {
      const allowedRepos = new Set(['other-org/other-repo']);
      const rule = new RepositoryScopeRule(allowedRepos);
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        action: 'skip',
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

    it('should return needs_triage for issue_comment created', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'created' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'needs_triage', reason: 'ISSUE_COMMENT_NEEDS_TRIAGE' });
    });

    it('should dispatch pull_request_review + submitted', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'submitted' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'ACTIONABLE_PR_REVIEW' });
    });

    it('should return needs_triage for issue_comment edited from allowed bot', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'edited' as const, senderLogin: 'claude[bot]' };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'needs_triage', reason: 'BOT_EDIT_NEEDS_TRIAGE' });
    });

    it('should skip issue_comment edited from non-bot', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'edited' as const, senderLogin: 'random-user' };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'issue_comment', action: 'edited' },
      });
    });

    it('should return needs_triage for pull_request opened', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'opened' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' });
    });

    it('should return needs_triage for pull_request synchronize', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'synchronize' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' });
    });

    it('should skip pull_request_review dismissed', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'dismissed' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'pull_request_review', action: 'dismissed' },
      });
    });

    it('should skip issue_comment deleted', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'deleted' as const };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'issue_comment', action: 'deleted' },
      });
    });

    it('should skip ping events', () => {
      const event = { ...mockEvent, eventType: 'ping' as const, action: null };
      const rule = new ActionableEventRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: 'ping', action: null },
      });
    });
  });

  describe('ProtectedBaseBranchRule', () => {
    const rule = new ProtectedBaseBranchRule();

    it('should skip pull_request targeting main', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, baseBranch: 'main' };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'skip', reason: 'PROTECTED_BASE_BRANCH', context: { baseBranch: 'main' } });
    });

    it('should skip pull_request targeting master', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, baseBranch: 'master' };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'skip', reason: 'PROTECTED_BASE_BRANCH', context: { baseBranch: 'master' } });
    });

    it('should dispatch pull_request targeting development', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, baseBranch: 'development' };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'BASE_BRANCH_ALLOWED', context: { baseBranch: 'development' } });
    });

    it('should dispatch pull_request with null baseBranch', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, baseBranch: null };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'BASE_BRANCH_UNKNOWN' });
    });

    it('should pass through for issue_comment events', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'NOT_A_PR_EVENT' });
    });

    it('should pass through for pull_request_review events', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const };
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'NOT_A_PR_EVENT' });
    });
  });

  describe('SenderWhitelistRule', () => {
    it('should return dispatch when sender is repository owner', () => {
      const event = { ...mockEvent, senderLogin: 'test-org', eventType: 'issue_comment' as const };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'SENDER_IS_REPO_OWNER',
        context: { sender: 'test-org', repoOwner: 'test-org' }
      });
    });

    it('should return dispatch when sender is in allowed bots list', () => {
      const event = { ...mockEvent, senderLogin: 'bot1', eventType: 'issue_comment' as const };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'SENDER_IS_ALLOWED_BOT',
        context: { sender: 'bot1', allowedBots: ['bot1', 'bot2'] }
      });
    });

    it('should return skip when sender is neither owner nor allowed bot', () => {
      const event = { ...mockEvent, senderLogin: 'random-user', eventType: 'issue_comment' as const };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'SENDER_NOT_WHITELISTED',
        context: {
          sender: 'random-user',
          repoOwner: 'test-org',
          allowedBots: ['bot1', 'bot2']
        }
      });
    });

    it('should pass through for created issue_comment events from non-whitelisted senders', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'random-user',
        eventType: 'issue_comment' as const,
        action: 'created' as const,
      };
      const allowedBots = new Set(['bot1', 'bot2']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'ISSUE_COMMENT_CREATED_PASS_THROUGH',
      });
    });

    it('should pass through for pull_request events', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, senderLogin: 'random-user' };
      const allowedBots = new Set(['bot1']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'PR_EVENT_PASS_THROUGH',
      });
    });

    it('should evaluate normally for pull_request_review events', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, senderLogin: 'random-user' };
      const allowedBots = new Set(['bot1']);
      const rule = new SenderWhitelistRule(allowedBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'SENDER_NOT_WHITELISTED',
        context: {
          sender: 'random-user',
          repoOwner: 'test-org',
          allowedBots: ['bot1']
        }
      });
    });
  });

  describe('SkipPrefixRule', () => {
    it('should pass through for non-issue_comment events (pull_request)', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, body: 'Test description' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'NOT_A_COMMENT_EVENT'
      });
    });

    it('should pass through for pull_request_review events (even with body)', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, body: 'LGTM' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'NOT_A_COMMENT_EVENT'
      });
    });

    it('should return dispatch for empty comment bodies', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: '  ' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'EMPTY_COMMENT'
      });
    });

    it('should return dispatch for null body on issue_comment', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: null };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'EMPTY_COMMENT'
      });
    });

    it('should return skip for comments starting with skip prefix', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: '/ignore this' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '/', commentBody: '/ignore this' }
      });
    });

    it('should return skip for comments starting with exclamation mark', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: '!skip this' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '!', commentBody: '!skip this' }
      });
    });

    it('should return dispatch for comments without skip prefixes', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: 'This is a normal comment' };
      const rule = new SkipPrefixRule();
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'COMMENT_DOES_NOT_HAVE_SKIP_PREFIX',
        context: { commentBody: 'this is a normal comment' }
      });
    });

    it('should handle custom skip prefixes', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, body: '#skip this' };
      const rule = new SkipPrefixRule(['#', '@']);
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'COMMENT_HAS_SKIP_PREFIX',
        context: { prefix: '#', commentBody: '#skip this' }
      });
    });

    it('should match skip prefixes case-insensitively', () => {
      const rule = new SkipPrefixRule(['@claude', '@codex']);

      const upperCase = { ...mockEvent, eventType: 'issue_comment' as const, body: '@Claude review this' };
      expect(rule.evaluate(upperCase).action).toBe('skip');

      const allCaps = { ...mockEvent, eventType: 'issue_comment' as const, body: '@CODEX fix this' };
      expect(rule.evaluate(allCaps).action).toBe('skip');

      const mixedCase = { ...mockEvent, eventType: 'issue_comment' as const, body: '@ClAuDe help' };
      expect(rule.evaluate(mixedCase).action).toBe('skip');
    });
  });

  describe('BotReviewEditRule', () => {
    it('should return dispatch for non-review events', () => {
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(mockEvent);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'NOT_A_REVIEW_EDIT_EVENT'
      });
    });

    it('should return dispatch when reviewer info is missing', () => {
      const event = {
        ...mockEvent,
        senderLogin: '',
        payload: { changes: { body: { from: 'old' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REVIEWER_INFO_MISSING'
      });
    });

    it('should return skip for bot reviews with no meaningful changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'skip',
        reason: 'BOT_REVIEW_EDIT_NO_MEANINGFUL_CHANGES',
        context: {
          reviewer: 'claude-bot',
          changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } }
        }
      });
    });

    it('should return dispatch for bot reviews with body changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { body: { from: 'old body' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'claude-bot',
          isBot: true,
          changes: { body: { from: 'old body' } }
        }
      });
    });

    it('should return dispatch for bot reviews with state changes', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'claude-bot',
        payload: { changes: { state: { from: 'commented' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'claude-bot',
          isBot: true,
          changes: { state: { from: 'commented' } }
        }
      });
    });

    it('should return dispatch for non-bot reviewers', () => {
      const event = {
        ...mockEvent,
        senderLogin: 'human-reviewer',
        payload: { changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } } }
      };
      const rule = new BotReviewEditRule(new Set(['claude-bot']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REVIEW_EDIT_IS_ACTIONABLE',
        context: {
          reviewer: 'human-reviewer',
          isBot: false,
          changes: { submitted_at: { from: '2026-03-02T10:00:00Z' } }
        }
      });
    });
  });

  describe('CodeWorkerOutputRule', () => {
    const codeWorkerBots = new Set(['intexuraos-code-worker[bot]']);

    it('should dispatch pull_request.opened by code worker', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'opened' as const, senderLogin: 'intexuraos-code-worker[bot]' };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'CODE_WORKER_PR_EVENT' });
    });

    it('should dispatch pull_request.synchronize by code worker', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'synchronize' as const, senderLogin: 'intexuraos-code-worker[bot]' };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'CODE_WORKER_PR_EVENT' });
    });

    it('should skip issue_comment.created by code worker', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'created' as const, senderLogin: 'intexuraos-code-worker[bot]' };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'skip', reason: 'CODE_WORKER_NON_PR_EVENT' });
    });

    it('should dispatch pull_request_review.submitted by code worker unconditionally', () => {
      const body = '## Code Quality Review\n\n### Suggestions\n\n1. **Hardcoded value** — Extract timeout to a constant.';
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'submitted' as const, senderLogin: 'intexuraos-code-worker[bot]', body };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'CODE_WORKER_REVIEW' });
    });

    it('should dispatch pull_request_review.submitted by code worker with null body', () => {
      const event = { ...mockEvent, eventType: 'pull_request_review' as const, action: 'submitted' as const, senderLogin: 'intexuraos-code-worker[bot]', body: null };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'CODE_WORKER_REVIEW' });
    });

    it('should dispatch pull_request.opened by non-bot sender', () => {
      const event = { ...mockEvent, eventType: 'pull_request' as const, action: 'opened' as const, senderLogin: 'test-user' };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'NOT_A_CODE_WORKER_BOT' });
    });

    it('should dispatch issue_comment.created by claude[bot] (not a code worker)', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'created' as const, senderLogin: 'claude[bot]' };
      const rule = new CodeWorkerOutputRule(codeWorkerBots);
      const result = rule.evaluate(event);

      expect(result).toEqual({ action: 'dispatch', reason: 'NOT_A_CODE_WORKER_BOT' });
    });
  });

  describe('GitHubWebhookRules (chain)', () => {
    it('should return dispatch when all rules pass', () => {
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
        action: 'dispatch',
        reason: 'ALL_RULES_PASSED'
      });
    });

    it('should short-circuit on first skip', () => {
      const allowedRepos = new Set(['other-org/other-repo']);
      const allowedBots = new Set(['bot1']);
      const rules = [
        new RepositoryScopeRule(allowedRepos),
        new SenderWhitelistRule(allowedBots)
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(mockEvent);

      expect(result).toEqual({
        action: 'skip',
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
        action: 'dispatch',
        reason: 'ALL_RULES_PASSED'
      });
    });

    it('should evaluate rules in order', () => {
      const event = { ...mockEvent, eventType: 'issue_comment' as const, action: 'created' as const };
      const allowedRepos = new Set(['test-org/test-repo']);
      const allowedBots = new Set(['random-user']);
      const rules = [
        new RepositoryScopeRule(allowedRepos),
        new SenderWhitelistRule(allowedBots)
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'ALL_RULES_PASSED'
      });
    });

    it('should propagate needs_triage when no later rule skips', () => {
      const event = {
        ...mockEvent,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'test-org',
        body: 'Please review this',
      };
      const allowedBots = new Set(['claude[bot]']);
      const rules = [
        new ActionableEventRule(allowedBots),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({
        action: 'needs_triage',
        reason: 'TRIAGE_REQUIRED'
      });
    });

    it('should let created issue_comment from unauthorized sender reach triage', () => {
      const event = {
        ...mockEvent,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'random-user',
        body: 'Please review this',
      };
      const allowedBots = new Set(['claude[bot]']);
      const rules = [
        new ActionableEventRule(allowedBots),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({
        action: 'needs_triage',
        reason: 'TRIAGE_REQUIRED',
      });
    });

    it('should let skip prefix win over needs_triage', () => {
      const event = {
        ...mockEvent,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'test-org',
        body: '@claude review this',
      };
      const allowedBots = new Set(['claude[bot]']);
      const rules = [
        new ActionableEventRule(allowedBots),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('COMMENT_HAS_SKIP_PREFIX');
    });

    it('should let ProtectedBaseBranchRule skip override ActionableEventRule needs_triage for PR targeting main', () => {
      const event = {
        ...mockEvent,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        baseBranch: 'main',
      };
      const allowedBots = new Set(['claude[bot]']);
      const rules = [
        new ActionableEventRule(allowedBots),
        new ProtectedBaseBranchRule(),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('PROTECTED_BASE_BRANCH');
    });

    it('should block code worker issue_comment before SenderWhitelistRule runs', () => {
      const event = {
        ...mockEvent,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'intexuraos-code-worker[bot]',
        body: 'Some comment from code worker',
      };
      const codeWorkerBots = new Set(['intexuraos-code-worker[bot]']);
      const allowedBots = new Set(['claude[bot]', 'intexuraos-code-worker[bot]']);
      const rules = [
        new CodeWorkerOutputRule(codeWorkerBots),
        new ActionableEventRule(allowedBots),
        new ProtectedBaseBranchRule(),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result.action).toBe('skip');
      expect(result.reason).toBe('CODE_WORKER_NON_PR_EVENT');
    });

    it('should let code worker pull_request.opened reach needs_triage', () => {
      const event = {
        ...mockEvent,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        senderLogin: 'intexuraos-code-worker[bot]',
        baseBranch: 'development',
      };
      const codeWorkerBots = new Set(['intexuraos-code-worker[bot]']);
      const allowedBots = new Set(['claude[bot]', 'intexuraos-code-worker[bot]']);
      const rules = [
        new CodeWorkerOutputRule(codeWorkerBots),
        new ActionableEventRule(allowedBots),
        new ProtectedBaseBranchRule(),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({ action: 'needs_triage', reason: 'TRIAGE_REQUIRED' });
    });

    it('should propagate needs_triage for PR opened with all dispatch after', () => {
      const event = {
        ...mockEvent,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        senderLogin: 'test-org',
      };
      const allowedBots = new Set(['claude[bot]']);
      const rules = [
        new ActionableEventRule(allowedBots),
        new SenderWhitelistRule(allowedBots),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ];
      const service = new GitHubWebhookRules(rules);
      const result = service.evaluate(event);

      expect(result).toEqual({
        action: 'needs_triage',
        reason: 'TRIAGE_REQUIRED'
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle wildcard repository patterns', () => {
      const event = { ...mockEvent, repository: 'intexuraos/some-repo' };
      const rule = new RepositoryScopeRule(new Set(['intexuraos/*']));
      const result = rule.evaluate(event);

      expect(result).toEqual({
        action: 'dispatch',
        reason: 'REPOSITORY_IN_SCOPE',
        context: { repository: 'intexuraos/some-repo' }
      });
    });

    it('should reject repositories not matching wildcard', () => {
      const event = { ...mockEvent, repository: 'other-org/some-repo' };
      const rule = new RepositoryScopeRule(new Set(['intexuraos/*']));
      const result = rule.evaluate(event);

      expect(result.action).toBe('skip');
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
