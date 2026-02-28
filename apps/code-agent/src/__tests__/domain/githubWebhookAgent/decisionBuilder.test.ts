import { describe, it, expect } from 'vitest';
import {
  buildDecisionFromEvaluator,
  type EvaluatorResult,
} from '../../../domain/githubWebhookAgent/decisionBuilder.js';

describe('buildDecisionFromEvaluator', () => {
  it('builds actionable decision from eligible evaluator result', () => {
    const result: EvaluatorResult = {
      eligible: true,
      decisionKind: 'create_code_action',
      reasonCode: 'workflow_failure_eligible',
      reasoning: 'PR #42 workflow failed',
    };

    const { decision, reasonCode } = buildDecisionFromEvaluator('github_action_result', result);

    expect(decision.actionability).toBe('actionable');
    expect(decision.decision.kind).toBe('create_code_action');
    expect(decision.eventGroup).toBe('github_action_result');
    expect(decision.confidence).toBe(1.0);
    expect(decision.reasoning).toBe('PR #42 workflow failed');
    expect(reasonCode).toBe('workflow_failure_eligible');
  });

  it('builds non-actionable decision from ineligible evaluator result', () => {
    const result: EvaluatorResult = {
      eligible: false,
      decisionKind: 'noop',
      reasonCode: 'protected_branch_denied',
      reasoning: 'Branch is protected',
    };

    const { decision, reasonCode } = buildDecisionFromEvaluator('pull_request', result);

    expect(decision.actionability).toBe('non_actionable');
    expect(decision.decision.kind).toBe('noop');
    expect(decision.eventGroup).toBe('pull_request');
    expect(reasonCode).toBe('protected_branch_denied');
  });
});
