import type { WebhookAgentDecision, WebhookEventGroup, DecisionKind } from './models.js';

export interface EvaluatorResult {
  eligible: boolean;
  decisionKind: DecisionKind;
  reasonCode: string;
  reasoning: string;
}

export interface EvaluatorDecision {
  decision: WebhookAgentDecision;
  reasonCode: string;
}

export function buildDecisionFromEvaluator(
  eventGroup: WebhookEventGroup,
  result: EvaluatorResult
): EvaluatorDecision {
  return {
    decision: {
      version: '1.0',
      eventGroup,
      actionability: result.eligible ? 'actionable' : 'non_actionable',
      confidence: 1.0,
      reasoning: result.reasoning,
      requestedWorkerType: null,
      decision: { kind: result.decisionKind },
    },
    reasonCode: result.reasonCode,
  };
}
