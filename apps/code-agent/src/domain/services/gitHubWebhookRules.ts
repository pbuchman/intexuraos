import type { GitHubPREvent } from '../models/gitHubPREvent.js';

/**
 * Three-outcome rule result. Replaces the old boolean `RuleResult`.
 *
 * - `dispatch`: event passes this rule, continue to next rule
 * - `skip`: event should NOT be dispatched (short-circuits chain)
 * - `needs_triage`: rule can't decide — escalate to LLM triage
 */
export type RuleOutcome =
  | { action: 'dispatch'; reason: string; context?: Record<string, unknown> }
  | { action: 'skip'; reason: string; context?: Record<string, unknown> }
  | { action: 'needs_triage'; reason: string; context?: Record<string, unknown> };

/**
 * Interface for webhook rules that determine if a GitHub PR event is actionable.
 */
export interface WebhookRule {
  evaluate(event: GitHubPREvent): RuleOutcome;
}

/**
 * Rule that checks if the repository is in the allowed scope.
 */
export class RepositoryScopeRule implements WebhookRule {
  constructor(
    private readonly allowedRepositories: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    const repoFullName = event.repository;

    for (const pattern of this.allowedRepositories) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        if (repoFullName.startsWith(prefix)) {
          return {
            action: 'dispatch',
            reason: 'REPOSITORY_IN_SCOPE',
            context: { repository: repoFullName }
          };
        }
      } else if (repoFullName === pattern) {
        return {
          action: 'dispatch',
          reason: 'REPOSITORY_IN_SCOPE',
          context: { repository: repoFullName }
        };
      }
    }

    return {
      action: 'skip',
      reason: 'REPOSITORY_NOT_IN_SCOPE',
      context: {
        repository: repoFullName,
        allowedRepositories: Array.from(this.allowedRepositories)
      }
    };
  }
}

/**
 * Rule that gates events from code-worker bots to prevent feedback loops.
 * Allows pull_request.opened and pull_request.synchronize (so reviews get dispatched),
 * but blocks comments, reviews, and other events the bot generates as output.
 */
export class CodeWorkerOutputRule implements WebhookRule {
  constructor(
    private readonly codeWorkerBots: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    if (!this.codeWorkerBots.has(event.senderLogin)) {
      return { action: 'dispatch', reason: 'NOT_A_CODE_WORKER_BOT' };
    }

    if (event.eventType === 'pull_request' && (event.action === 'opened' || event.action === 'synchronize')) {
      return { action: 'dispatch', reason: 'CODE_WORKER_PR_EVENT' };
    }

    return { action: 'skip', reason: 'CODE_WORKER_NON_PR_EVENT' };
  }
}

export class ActionableEventRule implements WebhookRule {
  constructor(private readonly allowedBots: Set<string>) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    // issue_comment created → needs_triage (LLM decides if actionable)
    if (event.eventType === 'issue_comment' && event.action === 'created') {
      return { action: 'needs_triage', reason: 'ISSUE_COMMENT_NEEDS_TRIAGE' };
    }
    // pull_request_review submitted → hard dispatch (no LLM)
    if (event.eventType === 'pull_request_review' && event.action === 'submitted') {
      return { action: 'dispatch', reason: 'ACTIONABLE_PR_REVIEW' };
    }
    // issue_comment edited by allowed bot → needs_triage
    if (event.eventType === 'issue_comment' && event.action === 'edited' && this.allowedBots.has(event.senderLogin)) {
      return { action: 'needs_triage', reason: 'BOT_EDIT_NEEDS_TRIAGE' };
    }
    // issue_comment edited by non-bot → skip (unchanged)
    if (event.eventType === 'issue_comment' && event.action === 'edited') {
      return {
        action: 'skip',
        reason: 'EVENT_NOT_ACTIONABLE',
        context: { eventType: event.eventType, action: event.action },
      };
    }
    // pull_request opened/synchronize → needs_triage
    if (event.eventType === 'pull_request' && (event.action === 'opened' || event.action === 'synchronize')) {
      return { action: 'needs_triage', reason: 'PR_NEEDS_TRIAGE' };
    }
    // Everything else → skip
    return {
      action: 'skip',
      reason: 'EVENT_NOT_ACTIONABLE',
      context: { eventType: event.eventType, action: event.action },
    };
  }
}

/**
 * Rule that skips PRs targeting protected base branches (main, master).
 * These are release merges that have already been reviewed on development.
 */
export class ProtectedBaseBranchRule implements WebhookRule {
  private static readonly PROTECTED_BRANCHES = new Set(['main', 'master']);

  evaluate(event: GitHubPREvent): RuleOutcome {
    if (event.eventType !== 'pull_request') {
      return { action: 'dispatch', reason: 'NOT_A_PR_EVENT' };
    }

    if (event.baseBranch === null) {
      return { action: 'dispatch', reason: 'BASE_BRANCH_UNKNOWN' };
    }

    if (ProtectedBaseBranchRule.PROTECTED_BRANCHES.has(event.baseBranch)) {
      return { action: 'skip', reason: 'PROTECTED_BASE_BRANCH', context: { baseBranch: event.baseBranch } };
    }

    return { action: 'dispatch', reason: 'BASE_BRANCH_ALLOWED', context: { baseBranch: event.baseBranch } };
  }
}

/**
 * Rule that checks if the sender is in the allowed bots list or is the repository owner.
 * Pass-through for pull_request events (sender filtering doesn't apply to PRs).
 */
export class SenderWhitelistRule implements WebhookRule {
  constructor(
    private readonly allowedBots: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    // Pass-through for pull_request events — sender filtering doesn't apply
    if (event.eventType === 'pull_request') {
      return { action: 'dispatch', reason: 'PR_EVENT_PASS_THROUGH' };
    }

    if (event.eventType === 'issue_comment' && event.action === 'created') {
      return { action: 'dispatch', reason: 'ISSUE_COMMENT_CREATED_PASS_THROUGH' };
    }

    const sender = event.senderLogin;
    const repoOwner = event.repository.split('/')[0];

    if (sender === repoOwner) {
      return {
        action: 'dispatch',
        reason: 'SENDER_IS_REPO_OWNER',
        context: { sender, repoOwner }
      };
    }

    if (this.allowedBots.has(sender)) {
      return {
        action: 'dispatch',
        reason: 'SENDER_IS_ALLOWED_BOT',
        context: { sender, allowedBots: Array.from(this.allowedBots) }
      };
    }

    return {
      action: 'skip',
      reason: 'SENDER_NOT_WHITELISTED',
      context: {
        sender,
        repoOwner,
        allowedBots: Array.from(this.allowedBots)
      }
    };
  }
}

/**
 * Rule that checks if a comment body starts with skip prefixes.
 * Only applies to issue_comment events (checks eventType, NOT body === null).
 */
export class SkipPrefixRule implements WebhookRule {
  constructor(
    private readonly skipPrefixes: string[] = ['/', '!']
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    // Pass-through for non-issue_comment events
    if (event.eventType !== 'issue_comment') {
      return {
        action: 'dispatch',
        reason: 'NOT_A_COMMENT_EVENT'
      };
    }

    // Null body on issue_comment is treated as empty (actionable)
    if (event.body === null) {
      return {
        action: 'dispatch',
        reason: 'EMPTY_COMMENT'
      };
    }

    const commentBody = event.body.trim().toLowerCase();

    if (commentBody === '') {
      return {
        action: 'dispatch',
        reason: 'EMPTY_COMMENT'
      };
    }

    for (const prefix of this.skipPrefixes) {
      if (commentBody.startsWith(prefix.toLowerCase())) {
        return {
          action: 'skip',
          reason: 'COMMENT_HAS_SKIP_PREFIX',
          context: {
            prefix,
            commentBody
          }
        };
      }
    }

    return {
      action: 'dispatch',
      reason: 'COMMENT_DOES_NOT_HAVE_SKIP_PREFIX',
      context: { commentBody }
    };
  }
}

/**
 * Rule for special handling of edited bot reviews.
 */
export class BotReviewEditRule implements WebhookRule {
  constructor(
    private readonly botUsernames: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    if (event.payload === null || event.payload === undefined || typeof event.payload !== 'object' || !('changes' in event.payload)) {
      return {
        action: 'dispatch',
        reason: 'NOT_A_REVIEW_EDIT_EVENT'
      };
    }

    const reviewer = event.senderLogin;

    if (!reviewer) {
      return {
        action: 'dispatch',
        reason: 'REVIEWER_INFO_MISSING'
      };
    }

    if (this.botUsernames.has(reviewer)) {
      const payload = event.payload as Record<string, unknown>;
      const changes = payload['changes'] as Record<string, unknown> | undefined;
      const hasBodyChange = changes !== undefined && 'body' in changes;
      const hasStateChange = changes !== undefined && 'state' in changes;

      if (!hasBodyChange && !hasStateChange) {
        return {
          action: 'skip',
          reason: 'BOT_REVIEW_EDIT_NO_MEANINGFUL_CHANGES',
          context: { reviewer, changes }
        };
      }
    }

    return {
      action: 'dispatch',
      reason: 'REVIEW_EDIT_IS_ACTIONABLE',
      context: {
        reviewer,
        isBot: this.botUsernames.has(reviewer),
        changes: event.payload.changes
      }
    };
  }
}

export interface WebhookRulesService {
  evaluate(event: GitHubPREvent): RuleOutcome;
}

/**
 * Service that evaluates GitHub PR webhook events against a set of rules.
 *
 * Chain propagation semantics:
 * - `skip` → short-circuit return (any rule can veto)
 * - `dispatch` → continue to next rule
 * - `needs_triage` → propagate through remaining rules; skip still wins
 */
export class GitHubWebhookRules implements WebhookRulesService {
  constructor(
    private readonly rules: WebhookRule[]
  ) {}

  evaluate(event: GitHubPREvent): RuleOutcome {
    let pendingTriage = false;

    for (const rule of this.rules) {
      const result = rule.evaluate(event);

      if (result.action === 'skip') return result;
      if (result.action === 'needs_triage') pendingTriage = true;
      // 'dispatch' → continue
    }

    return pendingTriage
      ? { action: 'needs_triage', reason: 'TRIAGE_REQUIRED' }
      : { action: 'dispatch', reason: 'ALL_RULES_PASSED' };
  }
}

export function createWebhookRulesService(rules: WebhookRule[]): WebhookRulesService {
  return new GitHubWebhookRules(rules);
}
