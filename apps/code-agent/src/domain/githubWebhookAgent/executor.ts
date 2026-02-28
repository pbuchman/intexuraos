import { getErrorMessage } from '@intexuraos/common-core';
import type {
  WebhookActionPlan,
  ActionStep,
  WebhookActionStepResult,
} from './models.js';

export interface ActionToolResult {
  ok: boolean;
  error?: string;
}

export interface ActionTool {
  execute: (step: ActionStep) => Promise<ActionToolResult>;
  idempotencyKey: (step: ActionStep) => string;
}

export interface ExecutorDeps {
  getToolForAction: (step: ActionStep) => ActionTool;
  isActionCompleted: (idempotencyKey: string) => Promise<boolean>;
  markActionCompleted: (idempotencyKey: string) => Promise<void>;
}

export interface ExecutionResult {
  outcome: 'completed' | 'failed';
  stepResults: readonly WebhookActionStepResult[];
  error?: string;
}

export async function executeWebhookActionPlan(
  plan: WebhookActionPlan,
  deps: ExecutorDeps
): Promise<ExecutionResult> {
  if (plan.actions.length === 0) {
    return { outcome: 'completed', stepResults: [] };
  }

  const stepResults: WebhookActionStepResult[] = [];

  for (const action of plan.actions) {
    const tool = deps.getToolForAction(action);
    const idempotencyKey = tool.idempotencyKey(action);

    const alreadyCompleted = await deps.isActionCompleted(idempotencyKey);
    if (alreadyCompleted) {
      stepResults.push({
        actionId: action.actionId,
        status: 'skipped',
        durationMs: 0,
      });
      continue;
    }

    const startTime = Date.now();
    try {
      const result = await tool.execute(action);
      const durationMs = Date.now() - startTime;

      if (!result.ok) {
        const failError = result.error ?? 'Unknown tool error';
        stepResults.push({
          actionId: action.actionId,
          status: 'failed',
          durationMs,
          error: failError,
        });
        return {
          outcome: 'failed',
          stepResults,
          error: failError,
        };
      }

      await deps.markActionCompleted(idempotencyKey);
      stepResults.push({
        actionId: action.actionId,
        status: 'success',
        durationMs,
      });
    } catch (thrown: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = getErrorMessage(thrown);
      stepResults.push({
        actionId: action.actionId,
        status: 'failed',
        durationMs,
        error: errorMessage,
      });
      return {
        outcome: 'failed',
        stepResults,
        error: errorMessage,
      };
    }
  }

  return { outcome: 'completed', stepResults };
}
