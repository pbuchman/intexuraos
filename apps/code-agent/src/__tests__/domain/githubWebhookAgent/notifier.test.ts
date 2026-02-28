import { describe, it, expect } from 'vitest';
import { buildChatNotification } from '../../../domain/githubWebhookAgent/notifier.js';
import type { ActionStep } from '../../../domain/githubWebhookAgent/models.js';

function makeStep(type: ActionStep['type'], params: Record<string, unknown> = {}): ActionStep {
  return { actionId: 'action-1', type, params };
}

describe('buildChatNotification', () => {
  it('returns failure notification when tool result is not ok', () => {
    const result = buildChatNotification(
      makeStep('dispatch_task'),
      { ok: false, error: 'Connection refused' }
    );

    expect(result.kind).toBe('webhook_action_failed');
    expect(result.message).toContain('Connection refused');
  });

  it('returns failure notification with unknown error when error is undefined', () => {
    const result = buildChatNotification(
      makeStep('dispatch_task'),
      { ok: false }
    );

    expect(result.kind).toBe('webhook_action_failed');
    expect(result.message).toContain('unknown error');
  });

  it('returns send_task_message notification with taskId', () => {
    const result = buildChatNotification(
      makeStep('send_task_message', { taskId: 'task_42' }),
      { ok: true }
    );

    expect(result.kind).toBe('webhook_action');
    expect(result.message).toContain('task_42');
    expect(result.metadata['taskId']).toBe('task_42');
  });

  it('returns send_task_message notification with unknown taskId when not a string', () => {
    const result = buildChatNotification(
      makeStep('send_task_message', { taskId: 123 }),
      { ok: true }
    );

    expect(result.message).toContain('unknown');
  });

  it('returns dispatch_task notification', () => {
    const result = buildChatNotification(
      makeStep('dispatch_task'),
      { ok: true }
    );

    expect(result.kind).toBe('webhook_action');
    expect(result.message).toContain('dispatched');
  });

  it('returns notify_chat notification', () => {
    const result = buildChatNotification(
      makeStep('notify_chat'),
      { ok: true }
    );

    expect(result.kind).toBe('webhook_action');
    expect(result.message).toContain('delivered');
  });

  it('returns mark_processing notification', () => {
    const result = buildChatNotification(
      makeStep('mark_processing'),
      { ok: true }
    );

    expect(result.kind).toBe('webhook_action');
    expect(result.message).toContain('processing');
  });
});
