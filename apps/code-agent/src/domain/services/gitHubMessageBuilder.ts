import type { GitHubPREvent, GitHubEventType } from '../models/gitHubPREvent.js';
import type { RuleResult } from './gitHubWebhookRules.js';

export interface TaskContext {
  taskId: string;
  userId: string;
}

/**
 * Interface for message templates that can render GitHub events into dispatch messages
 */
export interface MessageTemplate {
  render(event: GitHubPREvent, context?: TaskContext): string;
}

/**
 * Template for pull request review events
 */
export class PullRequestReviewTemplate implements MessageTemplate {
  render(event: GitHubPREvent, context?: TaskContext): string {
    const { repository, pullRequestNumber, senderLogin, body, payload } = event;
    const taskId = context?.taskId ?? 'unknown';
    const userId = context?.userId ?? 'unknown';

    // Extract review ID and state from payload
    const reviewId = this.extractId(payload);
    const reviewState = this.extractReviewState(payload);

    return `GitHub Pull Request Review
Repository: ${repository}
PR #${String(pullRequestNumber)}
Sender: ${senderLogin}
Review ID: ${reviewId}
Review State: ${reviewState}

${body ?? '(No review comment provided)'}

---

**Task Information**
- Task ID: ${taskId}
- User ID: ${userId}

**Instructions**
Use the following commands to interact with this task:
- \`/task status\` - Check current task status
- \`/task assign\` - Assign task to yourself
- \`/task complete\` - Mark task as completed
- \`/task help\` - Get help with task commands`;
  }

  private extractId(payload: unknown): string {
    if (typeof payload === 'object' && payload !== null && 'review' in payload) {
      const review = (payload as Record<string, unknown>)['review'];
      if (typeof review === 'object' && review !== null && 'id' in review) {
        const id = (review as Record<string, unknown>)['id'];
        return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
      }
    }
    return 'unknown';
  }

  private extractReviewState(payload: unknown): string {
    if (typeof payload === 'object' && payload !== null && 'review' in payload) {
      const review = (payload as Record<string, unknown>)['review'];
      if (typeof review === 'object' && review !== null && 'state' in review) {
        const state = (review as Record<string, unknown>)['state'];
        return typeof state === 'string' ? state : 'unknown';
      }
    }
    return 'unknown';
  }
}

/**
 * Template for issue comment events
 */
export class IssueCommentTemplate implements MessageTemplate {
  render(event: GitHubPREvent, context?: TaskContext): string {
    const { repository, pullRequestNumber, senderLogin, body } = event;
    const taskId = context?.taskId ?? 'unknown';
    const userId = context?.userId ?? 'unknown';

    return `GitHub Issue Comment
Repository: ${repository}
PR #${String(pullRequestNumber)}
Sender: ${senderLogin}

${body ?? '(No comment provided)'}

---

**Task Information**
- Task ID: ${taskId}
- User ID: ${userId}

**Instructions**
Use the following commands to interact with this task:
- \`/task status\` - Check current task status
- \`/task assign\` - Assign task to yourself
- \`/task complete\` - Mark task as completed
- \`/task help\` - Get help with task commands`;
  }
}

/**
 * Template for edited bot review events
 */
export class EditedBotReviewTemplate implements MessageTemplate {
  render(event: GitHubPREvent, context?: TaskContext): string {
    const { repository, pullRequestNumber, senderLogin, body } = event;
    const taskId = context?.taskId ?? 'unknown';
    const userId = context?.userId ?? 'unknown';

    return `GitHub Edited Bot Review
Repository: ${repository}
PR #${String(pullRequestNumber)}
Sender: ${senderLogin}

${body ?? '(No review comment provided)'}

---

**Task Information**
- Task ID: ${taskId}
- User ID: ${userId}

**Special Instructions for Triage Table Updates**
When updating the triage table, please follow these guidelines:
1. Maintain consistent formatting with existing rows
2. Include all required columns: Status, Priority, Owner, Due Date
3. Use the \`/triage update\` command to modify the table
4. Reference the original review ID when making changes

**General Instructions**
Use the following commands to interact with this task:
- \`/task status\` - Check current task status
- \`/task assign\` - Assign task to yourself
- \`/task complete\` - Mark task as completed
- \`/task help\` - Get help with task commands`;
  }
}

/**
 * Generic fallback template for unsupported event types
 */
export class GenericCommentTemplate implements MessageTemplate {
  render(event: GitHubPREvent, context?: TaskContext): string {
    const { repository, pullRequestNumber, senderLogin, body, eventType } = event;
    const taskId = context?.taskId ?? 'unknown';
    const userId = context?.userId ?? 'unknown';

    return `GitHub Event: ${eventType}
Repository: ${repository}
PR #${String(pullRequestNumber)}
Sender: ${senderLogin}

${body ?? '(No content provided)'}

---

**Task Information**
- Task ID: ${taskId}
- User ID: ${userId}

**Instructions**
Use the following commands to interact with this task:
- \`/task status\` - Check current task status
- \`/task assign\` - Assign task to yourself
- \`/task complete\` - Mark task as completed
- \`/task help\` - Get help with task commands`;
  }
}

export interface WebhookMessageBuilder {
  build(event: GitHubPREvent, taskContext: TaskContext): string;
  buildMessage(input: { event: GitHubPREvent; decision: RuleResult; taskId: string }): Promise<{ content: string }>;
  registerTemplate(eventType: GitHubEventType, template: MessageTemplate): void;
  getRegisteredTemplateTypes(): GitHubEventType[];
}

export class GitHubMessageBuilder implements WebhookMessageBuilder {
  private templateRegistry: Map<GitHubEventType, MessageTemplate>;

  constructor() {
    this.templateRegistry = new Map<GitHubEventType, MessageTemplate>();
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    this.templateRegistry.set('pull_request_review', new PullRequestReviewTemplate());
    this.templateRegistry.set('issue_comment', new IssueCommentTemplate());
    this.templateRegistry.set('edited_bot_review' as GitHubEventType, new EditedBotReviewTemplate());
  }

  /**
   * Build a dispatch message from a GitHub event and task context
   */
  build(event: GitHubPREvent, taskContext: TaskContext): string {
    const template = this.templateRegistry.get(event.eventType);

    if (template) {
      return template.render(event, taskContext);
    }

    // Fallback to generic template
    const genericTemplate = new GenericCommentTemplate();
    return genericTemplate.render(event, taskContext);
  }

  /**
   * Build a dispatch message for the GitHubDispatchService
   */
  buildMessage(input: {
    event: GitHubPREvent;
    decision: RuleResult;
    taskId: string;
  }): Promise<{ content: string }> {
    const { event, taskId } = input;

    const taskContext = {
      taskId,
      userId: 'unknown',
    };

    const message = this.build(event, taskContext);
    return Promise.resolve({ content: message });
  }

  /**
   * Register a custom template for a specific event type
   */
  registerTemplate(eventType: GitHubEventType, template: MessageTemplate): void {
    this.templateRegistry.set(eventType, template);
  }

  /**
   * Get all registered template types
   */
  getRegisteredTemplateTypes(): GitHubEventType[] {
    return Array.from(this.templateRegistry.keys());
  }
}

export function createWebhookMessageBuilder(): WebhookMessageBuilder {
  return new GitHubMessageBuilder();
}