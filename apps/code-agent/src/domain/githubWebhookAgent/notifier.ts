import type { ActionStep } from './models.js';
import type { ActionToolResult } from './executor.js';

export interface ChatNotification {
  kind: string;
  message: string;
  metadata: Record<string, unknown>;
}

export function buildChatNotification(
  step: ActionStep,
  toolResult: ActionToolResult
): ChatNotification {
  const base: Record<string, unknown> = {
    actionId: step.actionId,
    actionType: step.type,
    success: toolResult.ok,
  };

  if (!toolResult.ok) {
    return {
      kind: 'webhook_action_failed',
      message: `Action ${step.type} failed: ${toolResult.error ?? 'unknown error'}`,
      metadata: base,
    };
  }

  switch (step.type) {
    case 'send_task_message':
      return {
        kind: 'webhook_action',
        message: `Message sent to task ${typeof step.params['taskId'] === 'string' ? step.params['taskId'] : 'unknown'}`,
        metadata: { ...base, taskId: step.params['taskId'] },
      };
    case 'dispatch_task':
      return {
        kind: 'webhook_action',
        message: `New task dispatched for PR`,
        metadata: base,
      };
    case 'notify_chat':
      return {
        kind: 'webhook_action',
        message: `Chat notification delivered`,
        metadata: base,
      };
    case 'mark_processing':
      return {
        kind: 'webhook_action',
        message: `PR marked as processing`,
        metadata: base,
      };
  }
}
