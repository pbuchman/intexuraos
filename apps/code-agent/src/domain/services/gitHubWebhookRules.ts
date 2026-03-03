import type { GitHubPREvent } from '../models/gitHubPREvent.js';

/**
 * Represents the result of evaluating a webhook rule.
 */
export interface RuleResult {
  /**
   * Whether the webhook event should be dispatched (is actionable).
   */
  shouldDispatch: boolean;

  /**
   * A human-readable reason for the decision.
   */
  reason: string;

  /**
   * Optional context information about the evaluation.
   */
  context?: Record<string, unknown>;
}

/**
 * Interface for webhook rules that determine if a GitHub PR event is actionable.
 */
export interface WebhookRule {
  /**
   * Evaluates whether the given GitHub PR event is actionable according to this rule.
   * @param event The GitHub PR event to evaluate
   * @returns A RuleResult indicating whether the event is actionable and why
   */
  evaluate(event: GitHubPREvent): RuleResult;
}

/**
 * Rule that checks if the repository is in the allowed scope.
 */
export class RepositoryScopeRule implements WebhookRule {
  constructor(
    private readonly allowedRepositories: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleResult {
    const repoFullName = event.repository;

    for (const pattern of this.allowedRepositories) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1);
        if (repoFullName.startsWith(prefix)) {
          return {
            shouldDispatch: true,
            reason: 'REPOSITORY_IN_SCOPE',
            context: { repository: repoFullName }
          };
        }
      } else if (repoFullName === pattern) {
        return {
          shouldDispatch: true,
          reason: 'REPOSITORY_IN_SCOPE',
          context: { repository: repoFullName }
        };
      }
    }

    return {
      shouldDispatch: false,
      reason: 'REPOSITORY_NOT_IN_SCOPE',
      context: {
        repository: repoFullName,
        allowedRepositories: Array.from(this.allowedRepositories)
      }
    };
  }
}

export class ActionableEventRule implements WebhookRule {
  constructor(private readonly allowedBots: Set<string>) {}

  evaluate(event: GitHubPREvent): RuleResult {
    if (event.eventType === 'issue_comment' && event.action === 'created') {
      return { shouldDispatch: true, reason: 'ACTIONABLE_ISSUE_COMMENT' };
    }
    if (event.eventType === 'pull_request_review' && event.action === 'submitted') {
      return { shouldDispatch: true, reason: 'ACTIONABLE_PR_REVIEW' };
    }
    if (event.eventType === 'issue_comment' && event.action === 'edited' && this.allowedBots.has(event.senderLogin)) {
      return { shouldDispatch: true, reason: 'ACTIONABLE_BOT_EDIT' };
    }
    return {
      shouldDispatch: false,
      reason: 'EVENT_NOT_ACTIONABLE',
      context: { eventType: event.eventType, action: event.action },
    };
  }
}

/**
 * Rule that checks if the sender is in the allowed bots list or is the repository owner.
 */
export class SenderWhitelistRule implements WebhookRule {
  constructor(
    private readonly allowedBots: Set<string>
  ) {}

  evaluate(event: GitHubPREvent): RuleResult {
    const sender = event.senderLogin;
    const repoOwner = event.repository.split('/')[0];

    // Allow if sender is the repository owner
    if (sender === repoOwner) {
      return {
        shouldDispatch: true,
        reason: 'SENDER_IS_REPO_OWNER',
        context: { sender, repoOwner }
      };
    }

    // Allow if sender is in the allowed bots list
    if (this.allowedBots.has(sender)) {
      return {
        shouldDispatch: true,
        reason: 'SENDER_IS_ALLOWED_BOT',
        context: { sender, allowedBots: Array.from(this.allowedBots) }
      };
    }

    return {
      shouldDispatch: false,
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
 */
export class SkipPrefixRule implements WebhookRule {
  constructor(
    private readonly skipPrefixes: string[] = ['/', '!']
  ) {}

  evaluate(event: GitHubPREvent): RuleResult {
    // Only apply this rule to comment events
    if (event.body === null) {
      return {
        shouldDispatch: true,
        reason: 'NOT_A_COMMENT_EVENT'
      };
    }

    const commentBody = event.body.trim().toLowerCase();

    // If comment is empty, it's actionable
    if (commentBody === '') {
      return {
        shouldDispatch: true,
        reason: 'EMPTY_COMMENT'
      };
    }

    // Check if comment starts with any skip prefix (case-insensitive)
    for (const prefix of this.skipPrefixes) {
      if (commentBody.startsWith(prefix.toLowerCase())) {
        return {
          shouldDispatch: false,
          reason: 'COMMENT_HAS_SKIP_PREFIX',
          context: {
            prefix,
            commentBody
          }
        };
      }
    }

    return {
      shouldDispatch: true,
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

  evaluate(event: GitHubPREvent): RuleResult {
    // Only apply this rule to review events
    if (event.payload === null || event.payload === undefined || typeof event.payload !== 'object' || !('changes' in event.payload)) {
      return {
        shouldDispatch: true,
        reason: 'NOT_A_REVIEW_EDIT_EVENT'
      };
    }

    const reviewer = event.senderLogin;

    // If there's no reviewer info, treat as actionable
    if (!reviewer) {
      return {
        shouldDispatch: true,
        reason: 'REVIEWER_INFO_MISSING'
      };
    }

    // Check if the reviewer is a bot
    if (this.botUsernames.has(reviewer)) {
      // For bot reviews, check if the edit is meaningful
      // (i.e., not just timestamp updates or minor metadata changes)
      const payload = event.payload as Record<string, unknown>;
      const changes = payload['changes'] as Record<string, unknown> | undefined;
      const hasBodyChange = changes !== undefined && 'body' in changes;
      const hasStateChange = changes !== undefined && 'state' in changes;

      if (!hasBodyChange && !hasStateChange) {
        return {
          shouldDispatch: false,
          reason: 'BOT_REVIEW_EDIT_NO_MEANINGFUL_CHANGES',
          context: { reviewer, changes }
        };
      }
    }

    return {
      shouldDispatch: true,
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
  evaluate(event: GitHubPREvent): RuleResult;
}

/**
 * Service that evaluates GitHub PR webhook events against a set of rules
 * to determine if they are actionable.
 */
export class GitHubWebhookRules implements WebhookRulesService {
  constructor(
    private readonly rules: WebhookRule[]
  ) {}

  evaluate(event: GitHubPREvent): RuleResult {
    for (const rule of this.rules) {
      const result = rule.evaluate(event);

      if (!result.shouldDispatch) {
        return result;
      }
    }

    return {
      shouldDispatch: true,
      reason: 'ALL_RULES_PASSED'
    };
  }
}

export function createWebhookRulesService(rules: WebhookRule[]): WebhookRulesService {
  return new GitHubWebhookRules(rules);
}