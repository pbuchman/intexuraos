import type { WebhookAgentDecision, WebhookActionPlan, WorkerType } from './models.js';

export interface ActionPlanValidationContext {
  hasExistingTask: boolean;
  existingTaskWorkerType: WorkerType | null;
  senderAllowed: boolean;
  userMapped: boolean;
}

export interface ValidationError {
  code: string;
  message: string;
}

export interface ActionPlanValidationResult {
  valid: boolean;
  errors: readonly ValidationError[];
}

export function validateWebhookActionPlan(
  plan: WebhookActionPlan,
  decision: WebhookAgentDecision,
  context: ActionPlanValidationContext
): ActionPlanValidationResult {
  if (plan.decisionKind === 'noop') {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = [];

  if (!context.senderAllowed) {
    errors.push({
      code: 'sender_not_allowed',
      message: 'Sender is not on the allowlist',
    });
  }

  if (
    context.hasExistingTask &&
    context.existingTaskWorkerType !== null &&
    decision.requestedWorkerType !== null &&
    decision.requestedWorkerType !== context.existingTaskWorkerType
  ) {
    errors.push({
      code: 'worker_switch_denied',
      message: `Worker type switch denied: task uses ${context.existingTaskWorkerType}, requested ${decision.requestedWorkerType}`,
    });
  }

  const hasDispatchAction = plan.actions.some((a) => a.type === 'dispatch_task');
  if (hasDispatchAction && !context.userMapped) {
    errors.push({
      code: 'user_mapping_required',
      message: 'Cannot dispatch task without user mapping',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
