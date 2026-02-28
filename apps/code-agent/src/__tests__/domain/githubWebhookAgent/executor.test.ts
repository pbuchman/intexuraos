import { describe, it, expect } from 'vitest';
import {
  executeWebhookActionPlan,
  type ExecutorDeps,
  type ActionTool,
} from '../../../domain/githubWebhookAgent/executor.js';
import type { WebhookActionPlan, ActionStep } from '../../../domain/githubWebhookAgent/models.js';

function makePlan(actions: ActionStep[]): WebhookActionPlan {
  return {
    version: '1.0',
    decisionKind: actions.length === 0 ? 'noop' : 'send_task_message',
    actions,
  };
}

function makeAction(id: string, type: ActionStep['type'] = 'send_task_message'): ActionStep {
  return { actionId: id, type, params: {} };
}

function successTool(): ActionTool {
  return {
    execute: () => Promise.resolve({ ok: true }),
    idempotencyKey: (step) => step.actionId,
  };
}

function failingTool(message: string): ActionTool {
  return {
    execute: () => Promise.resolve({ ok: false, error: message }),
    idempotencyKey: (step) => step.actionId,
  };
}

function throwingTool(message: string): ActionTool {
  return {
    execute: () => Promise.reject(new Error(message)),
    idempotencyKey: (step) => step.actionId,
  };
}

function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  const completedKeys = new Set<string>();
  return {
    getToolForAction: () => successTool(),
    isActionCompleted: (key) => Promise.resolve(completedKeys.has(key)),
    markActionCompleted: (key): Promise<void> => {
      completedKeys.add(key);
      return Promise.resolve();
    },
    ...overrides,
  };
}

describe('executeWebhookActionPlan', () => {
  describe('noop plan', () => {
    it('returns completed result with no steps', async () => {
      const result = await executeWebhookActionPlan(makePlan([]), makeDeps());
      expect(result.outcome).toBe('completed');
      expect(result.stepResults).toHaveLength(0);
    });
  });

  describe('successful execution', () => {
    it('executes all actions and records success', async () => {
      const plan = makePlan([
        makeAction('step-1'),
        makeAction('step-2'),
      ]);
      const result = await executeWebhookActionPlan(plan, makeDeps());
      expect(result.outcome).toBe('completed');
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0]?.status).toBe('success');
      expect(result.stepResults[1]?.status).toBe('success');
    });

    it('records duration for each step', async () => {
      const plan = makePlan([makeAction('step-1')]);
      const result = await executeWebhookActionPlan(plan, makeDeps());
      expect(result.stepResults[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('records action ids in step results', async () => {
      const plan = makePlan([makeAction('my-action-id')]);
      const result = await executeWebhookActionPlan(plan, makeDeps());
      expect(result.stepResults[0]?.actionId).toBe('my-action-id');
    });
  });

  describe('duplicate action skipped', () => {
    it('skips action when idempotency key already completed', async () => {
      const deps = makeDeps({
        isActionCompleted: () => Promise.resolve(true),
      });
      const plan = makePlan([makeAction('dup-1')]);
      const result = await executeWebhookActionPlan(plan, deps);
      expect(result.outcome).toBe('completed');
      expect(result.stepResults[0]?.status).toBe('skipped');
    });

    it('marks skipped actions with zero duration', async () => {
      const deps = makeDeps({
        isActionCompleted: () => Promise.resolve(true),
      });
      const plan = makePlan([makeAction('dup-1')]);
      const result = await executeWebhookActionPlan(plan, deps);
      expect(result.stepResults[0]?.durationMs).toBe(0);
    });
  });

  describe('failure stops pipeline', () => {
    it('stops execution on tool failure and records error', async () => {
      const deps = makeDeps({
        getToolForAction: (step) => {
          if (step.actionId === 'fail-step') return failingTool('Something broke');
          return successTool();
        },
      });
      const plan = makePlan([
        makeAction('ok-step'),
        makeAction('fail-step'),
        makeAction('never-reached'),
      ]);
      const result = await executeWebhookActionPlan(plan, deps);
      expect(result.outcome).toBe('failed');
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0]?.status).toBe('success');
      expect(result.stepResults[1]?.status).toBe('failed');
      expect(result.stepResults[1]?.error).toBe('Something broke');
    });

    it('uses fallback error when tool returns no error message', async () => {
      const deps = makeDeps({
        getToolForAction: (): ActionTool => ({
          execute: () => Promise.resolve({ ok: false }),
          idempotencyKey: (step) => step.actionId,
        }),
      });
      const plan = makePlan([makeAction('no-msg')]);
      const result = await executeWebhookActionPlan(plan, deps);
      expect(result.outcome).toBe('failed');
      expect(result.stepResults[0]?.error).toBe('Unknown tool error');
    });

    it('records error from thrown exception', async () => {
      const deps = makeDeps({
        getToolForAction: () => throwingTool('Unexpected crash'),
      });
      const plan = makePlan([makeAction('crash-step')]);
      const result = await executeWebhookActionPlan(plan, deps);
      expect(result.outcome).toBe('failed');
      expect(result.stepResults[0]?.status).toBe('failed');
      expect(result.stepResults[0]?.error).toContain('Unexpected crash');
    });
  });

  describe('determinism', () => {
    it('returns identical structure for identical inputs', async () => {
      const plan = makePlan([makeAction('det-1')]);
      const deps = makeDeps();
      const a = await executeWebhookActionPlan(plan, deps);
      const b = await executeWebhookActionPlan(plan, deps);
      expect(a.outcome).toBe(b.outcome);
      expect(a.stepResults.length).toBe(b.stepResults.length);
    });
  });
});
