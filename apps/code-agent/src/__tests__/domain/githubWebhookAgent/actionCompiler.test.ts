import { describe, it, expect } from 'vitest';
import {
  compileWebhookActionPlan,
  type ActionCompilerInput,
} from '../../../domain/githubWebhookAgent/actionCompiler.js';
import {
  validateWebhookActionPlan,
  type ActionPlanValidationContext,
} from '../../../domain/githubWebhookAgent/validator.js';
import type { WebhookAgentDecision, WebhookActionPlan } from '../../../domain/githubWebhookAgent/models.js';

function makeDecision(overrides: Partial<WebhookAgentDecision> = {}): WebhookAgentDecision {
  return {
    version: '1.0',
    eventGroup: 'comment',
    actionability: 'actionable',
    confidence: 0.9,
    reasoning: 'Human comment requesting change',
    requestedWorkerType: null,
    decision: { kind: 'send_task_message' },
    ...overrides,
  };
}

function makeCompilerInput(overrides: Partial<ActionCompilerInput> = {}): ActionCompilerInput {
  return {
    runId: 'run-001',
    decision: makeDecision(),
    hasExistingTask: false,
    userMapped: true,
    ownsProcessingMarker: false,
    ...overrides,
  };
}

function makeValidationContext(
  overrides: Partial<ActionPlanValidationContext> = {}
): ActionPlanValidationContext {
  return {
    hasExistingTask: false,
    existingTaskWorkerType: null,
    senderAllowed: true,
    userMapped: true,
    ...overrides,
  };
}

describe('compileWebhookActionPlan', () => {
  describe('noop decision', () => {
    it('generates noop plan for non_actionable decision', () => {
      const plan = compileWebhookActionPlan(
        makeCompilerInput({
          decision: makeDecision({
            actionability: 'non_actionable',
            decision: { kind: 'noop' },
          }),
        })
      );
      expect(plan.decisionKind).toBe('noop');
      expect(plan.actions).toHaveLength(0);
      expect(plan.version).toBe('1.0');
    });

    it('generates noop plan with requestedWorkerType present', () => {
      const plan = compileWebhookActionPlan(
        makeCompilerInput({
          decision: makeDecision({
            actionability: 'non_actionable',
            decision: { kind: 'noop' },
            requestedWorkerType: 'opus',
          }),
        })
      );
      expect(plan.decisionKind).toBe('noop');
      expect(plan.actions).toHaveLength(0);
    });
  });

  describe('send_task_message decision', () => {
    it('compiles send_task_message plan', () => {
      const plan = compileWebhookActionPlan(makeCompilerInput());
      expect(plan.decisionKind).toBe('send_task_message');
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.actions.some((a) => a.type === 'send_task_message')).toBe(true);
    });

    it('generates stable action ids', () => {
      const input = makeCompilerInput();
      const a = compileWebhookActionPlan(input);
      const b = compileWebhookActionPlan(input);
      expect(a.actions.map((s) => s.actionId)).toEqual(b.actions.map((s) => s.actionId));
    });

    it('includes unique action ids', () => {
      const plan = compileWebhookActionPlan(makeCompilerInput());
      const ids = plan.actions.map((a) => a.actionId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('create_pr_comment_task decision', () => {
    it('compiles plan with dispatch_task action', () => {
      const plan = compileWebhookActionPlan(
        makeCompilerInput({
          decision: makeDecision({
            decision: { kind: 'create_pr_comment_task' },
          }),
        })
      );
      expect(plan.decisionKind).toBe('create_pr_comment_task');
      expect(plan.actions.some((a) => a.type === 'dispatch_task')).toBe(true);
    });
  });

  describe('create_code_action decision', () => {
    it('compiles plan with dispatch_task and notify_chat actions', () => {
      const plan = compileWebhookActionPlan(
        makeCompilerInput({
          decision: makeDecision({
            decision: { kind: 'create_code_action' },
            requestedWorkerType: 'opus',
          }),
        })
      );
      expect(plan.decisionKind).toBe('create_code_action');
      expect(plan.actions.some((a) => a.type === 'dispatch_task')).toBe(true);
      expect(plan.actions.some((a) => a.type === 'notify_chat')).toBe(true);
    });
  });

  describe('empty body handling', () => {
    it('compiles send_task_message with empty body param', () => {
      const plan = compileWebhookActionPlan(makeCompilerInput());
      const sendAction = plan.actions.find((a) => a.type === 'send_task_message');
      expect(sendAction).toBeDefined();
    });
  });
});

describe('validateWebhookActionPlan', () => {
  describe('policy: worker switch on existing task', () => {
    it('rejects plan when decision requests worker change on existing task', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'create_pr_comment_task',
        actions: [
          {
            actionId: 'run-001-dispatch-0',
            type: 'dispatch_task',
            params: { workerType: 'opus' },
          },
        ],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision({ requestedWorkerType: 'opus' }),
        makeValidationContext({
          hasExistingTask: true,
          existingTaskWorkerType: 'sonnet',
        })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'worker_switch_denied')).toBe(true);
    });

    it('allows plan when worker type matches existing task', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'send_task_message',
        actions: [
          {
            actionId: 'run-001-send-0',
            type: 'send_task_message',
            params: {},
          },
        ],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision({ requestedWorkerType: 'sonnet' }),
        makeValidationContext({
          hasExistingTask: true,
          existingTaskWorkerType: 'sonnet',
        })
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('policy: missing user mapping', () => {
    it('rejects dispatch_task when user mapping is missing', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'create_pr_comment_task',
        actions: [
          {
            actionId: 'run-001-dispatch-0',
            type: 'dispatch_task',
            params: {},
          },
        ],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision({ decision: { kind: 'create_pr_comment_task' } }),
        makeValidationContext({ userMapped: false })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'user_mapping_required')).toBe(true);
    });
  });

  describe('policy: sender disallowed', () => {
    it('rejects plan when sender is not allowed', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'send_task_message',
        actions: [
          {
            actionId: 'run-001-send-0',
            type: 'send_task_message',
            params: {},
          },
        ],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision(),
        makeValidationContext({ senderAllowed: false })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'sender_not_allowed')).toBe(true);
    });
  });

  describe('valid plans', () => {
    it('passes noop plan', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'noop',
        actions: [],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision({ actionability: 'non_actionable', decision: { kind: 'noop' } }),
        makeValidationContext()
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes valid send_task_message plan', () => {
      const plan: WebhookActionPlan = {
        version: '1.0',
        decisionKind: 'send_task_message',
        actions: [
          {
            actionId: 'run-001-send-0',
            type: 'send_task_message',
            params: {},
          },
        ],
      };
      const result = validateWebhookActionPlan(
        plan,
        makeDecision(),
        makeValidationContext()
      );
      expect(result.valid).toBe(true);
    });
  });
});
