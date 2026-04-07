import { describe, it, expect } from 'vitest';
import { renderEvent } from '../../../domain/services/automationCommentRenderer.js';
import type { AutomationEvent } from '../../../domain/ports/automationLog.js';

function webhookReceivedEvent(eventType: string, action: string): AutomationEvent {
  return {
    type: 'webhook_received',
    eventType,
    action,
    sender: 'octocat',
    deliveryId: 'test-delivery-id',
  };
}

describe('renderEvent task_dispatched', () => {
  it('labels ask_agent task as "Ask Agent"', () => {
    const event: AutomationEvent = {
      type: 'task_dispatched',
      taskId: 'task_123',
      workerType: 'opus',
      agentType: 'ask_agent',
    };
    const result = renderEvent(event);
    expect(result).toContain('Ask Agent');
  });
});

describe('renderEvent webhook_received', () => {
  it('labels pull_request.synchronize as "Commits pushed"', () => {
    const result = renderEvent(webhookReceivedEvent('pull_request', 'synchronize'));
    expect(result).toContain('Commits pushed');
  });

  it('labels pull_request.closed as "PR closed"', () => {
    const result = renderEvent(webhookReceivedEvent('pull_request', 'closed'));
    expect(result).toContain('PR closed');
  });

  it('labels pull_request.reopened as "PR reopened"', () => {
    const result = renderEvent(webhookReceivedEvent('pull_request', 'reopened'));
    expect(result).toContain('PR reopened');
  });

  it('labels pull_request_review_comment.created as "Inline comment"', () => {
    const result = renderEvent(webhookReceivedEvent('pull_request_review_comment', 'created'));
    expect(result).toContain('Inline comment');
  });
});
