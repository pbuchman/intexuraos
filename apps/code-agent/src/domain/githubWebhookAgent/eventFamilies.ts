import type { WebhookEventGroup } from './models.js';
import type { GitHubEventType } from '../models/gitHubPREvent.js';

export interface EventFamilyHandler {
  readonly group: WebhookEventGroup;
  enrichContext: () => Promise<Record<string, unknown>>;
  compileActions: () => Promise<Record<string, unknown>>;
  validatePolicy: () => Promise<{ allowed: boolean; reason?: string }>;
}

interface EventGroupMapping {
  readonly eventType: GitHubEventType;
  readonly actions?: readonly string[];
  readonly group: WebhookEventGroup;
}

const EVENT_GROUP_MAPPINGS: readonly EventGroupMapping[] = [
  { eventType: 'pull_request', group: 'pull_request' },
  { eventType: 'pull_request_review', group: 'pull_request' },
  { eventType: 'pull_request_review_comment', group: 'comment' },
  { eventType: 'issue_comment', group: 'comment' },
  { eventType: 'push', group: 'other' },
  { eventType: 'ping', group: 'other' },
];

export function groupWebhookEvent(
  eventType: string,
  _action: string | null
): WebhookEventGroup {
  const mapping = EVENT_GROUP_MAPPINGS.find((m) => m.eventType === eventType);
  if (mapping === undefined) {
    return 'other';
  }
  return mapping.group;
}

function stubHandler(group: WebhookEventGroup): EventFamilyHandler {
  return {
    group,
    enrichContext: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    compileActions: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    validatePolicy: (): Promise<{ allowed: boolean; reason?: string }> =>
      Promise.resolve({ allowed: true }),
  };
}

export interface EventFamilyRegistry {
  getHandler(group: WebhookEventGroup): EventFamilyHandler;
}

export function createEventFamilyRegistry(): EventFamilyRegistry {
  const handlers = new Map<WebhookEventGroup, EventFamilyHandler>([
    ['pull_request', stubHandler('pull_request')],
    ['comment', stubHandler('comment')],
    ['github_action_result', stubHandler('github_action_result')],
    ['other', stubHandler('other')],
  ]);

  return {
    getHandler(group: WebhookEventGroup): EventFamilyHandler {
      return handlers.get(group) ?? stubHandler(group);
    },
  };
}
