import { describe, it, expect } from 'vitest';
import {
  groupWebhookEvent,
  createEventFamilyRegistry,
} from '../../../domain/githubWebhookAgent/eventFamilies.js';
import type { WebhookEventGroup } from '../../../domain/githubWebhookAgent/models.js';

describe('groupWebhookEvent', () => {
  it('groups issue_comment created as comment', () => {
    expect(groupWebhookEvent('issue_comment', 'created')).toBe('comment');
  });

  it('groups issue_comment deleted as comment', () => {
    expect(groupWebhookEvent('issue_comment', 'deleted')).toBe('comment');
  });

  it('groups pull_request_review_comment as comment', () => {
    expect(groupWebhookEvent('pull_request_review_comment', 'created')).toBe('comment');
  });

  it('groups pull_request as pull_request', () => {
    expect(groupWebhookEvent('pull_request', 'opened')).toBe('pull_request');
  });

  it('groups pull_request_review as pull_request', () => {
    expect(groupWebhookEvent('pull_request_review', 'submitted')).toBe('pull_request');
  });

  it('groups push as other', () => {
    expect(groupWebhookEvent('push', null)).toBe('other');
  });

  it('groups ping as other', () => {
    expect(groupWebhookEvent('ping', null)).toBe('other');
  });

  it('groups workflow_run as github_action_result', () => {
    expect(groupWebhookEvent('workflow_run', 'completed')).toBe('github_action_result');
  });

  it('groups check_run as github_action_result', () => {
    expect(groupWebhookEvent('check_run', 'completed')).toBe('github_action_result');
  });

  it('groups check_suite as github_action_result', () => {
    expect(groupWebhookEvent('check_suite', 'completed')).toBe('github_action_result');
  });

  it('groups completely unknown event as other', () => {
    expect(groupWebhookEvent('deployment_status', null)).toBe('other');
  });

  it('is deterministic for the same input', () => {
    const a = groupWebhookEvent('issue_comment', 'created');
    const b = groupWebhookEvent('issue_comment', 'created');
    expect(a).toBe(b);
  });
});

describe('createEventFamilyRegistry', () => {
  it('returns handler for pull_request group', () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('pull_request');
    expect(handler.group).toBe('pull_request');
  });

  it('returns handler for comment group', () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('comment');
    expect(handler.group).toBe('comment');
  });

  it('returns handler for github_action_result group (stub)', () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('github_action_result');
    expect(handler.group).toBe('github_action_result');
  });

  it('returns handler for other group', () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('other');
    expect(handler.group).toBe('other');
  });

  it('stub handler enrichContext returns empty object', async () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('github_action_result');
    const result = await handler.enrichContext();
    expect(result).toEqual({});
  });

  it('stub handler validatePolicy returns allowed', async () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('github_action_result');
    const result = await handler.validatePolicy();
    expect(result.allowed).toBe(true);
  });

  it('returns fallback stub for unknown group value', () => {
    const registry = createEventFamilyRegistry();
    const handler = registry.getHandler('unknown_group' as WebhookEventGroup);
    expect(handler.group).toBe('unknown_group');
  });
});
