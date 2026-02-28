import type { WebhookEventGroup } from './models.js';
import type { WebhookAgentDecision, WebhookActionPlan } from './models.js';
import type { ActionPlanValidationResult } from './validator.js';
import { evaluateWebhookActionabilityRules, type RuleEvaluationInput } from './rules.js';
import { compileWebhookActionPlan, type ActionCompilerInput } from './actionCompiler.js';
import { validateWebhookActionPlan } from './validator.js';

export interface ReplayFixtureEvent {
  id: string;
  githubEventId: number;
  repository: string;
  repositoryId: number;
  pullRequestNumber: number;
  pullRequestId: number;
  eventType: string;
  action: string | null;
  senderLogin: string;
  senderId: number;
  senderType: string;
  title: string | null;
  body: string | null;
  state: string | null;
  mergedAt: null;
  payload: unknown;
}

export interface ReplayFixtureExpected {
  decisionKind: string;
  actionCount: number;
}

export interface ReplayFixture {
  description?: string;
  event: ReplayFixtureEvent;
  expected: ReplayFixtureExpected;
}

export interface ReplayDeps {
  isSenderAllowed: (senderLogin: string) => boolean;
  isUserMapped: (senderLogin: string) => boolean;
  hasExistingTask: boolean;
  ownsProcessingMarker: boolean;
}

export interface ReplayDiagnostics {
  eventGroup: WebhookEventGroup;
  ruleReasonCode: string;
  validationFailed: boolean;
  fallbackApplied: boolean;
}

export interface ReplayResult {
  decision: WebhookAgentDecision;
  plan: WebhookActionPlan;
  validation: ActionPlanValidationResult;
  diagnostics: ReplayDiagnostics;
  promptVersion: string;
  fallbackPlan?: WebhookActionPlan;
}

function classifyEventGroup(eventType: string): WebhookEventGroup {
  if (
    eventType === 'issue_comment' ||
    eventType === 'pull_request_review' ||
    eventType === 'pull_request_review_comment'
  ) {
    return 'comment';
  }
  if (eventType === 'pull_request') return 'pull_request';
  if (
    eventType === 'check_run' ||
    eventType === 'check_suite' ||
    eventType === 'workflow_run'
  ) {
    return 'github_action_result';
  }
  return 'other';
}

export function replayWebhookEventDryRun(
  deps: ReplayDeps,
  fixture: ReplayFixture
): ReplayResult {
  const { event } = fixture;
  const runId = `replay_${event.id}`;

  const eventGroup = classifyEventGroup(event.eventType);
  const senderAllowed = deps.isSenderAllowed(event.senderLogin);

  const ruleInput: RuleEvaluationInput = {
    eventGroup,
    action: event.action,
    senderLogin: event.senderLogin,
    senderAllowed,
    body: event.body,
    hasExistingTask: deps.hasExistingTask,
  };

  const ruleResult = evaluateWebhookActionabilityRules(ruleInput);
  const isActionable = ruleResult.actionability !== 'non_actionable';

  const decision: WebhookAgentDecision = {
    version: '1.0',
    eventGroup,
    actionability: ruleResult.actionability,
    confidence: ruleResult.confidence,
    reasoning: ruleResult.reasoning,
    requestedWorkerType: null,
    decision: {
      kind: isActionable
        ? (deps.hasExistingTask ? 'send_task_message' : 'create_pr_comment_task')
        : 'noop',
    },
  };

  const compilerInput: ActionCompilerInput = {
    runId,
    decision,
    hasExistingTask: deps.hasExistingTask,
    userMapped: deps.isUserMapped(event.senderLogin),
    ownsProcessingMarker: deps.ownsProcessingMarker,
  };

  const plan = compileWebhookActionPlan(compilerInput);

  const validation = validateWebhookActionPlan(plan, decision, {
    hasExistingTask: deps.hasExistingTask,
    existingTaskWorkerType: null,
    senderAllowed,
    userMapped: deps.isUserMapped(event.senderLogin),
  });

  const validationFailed = !validation.valid;

  const base = {
    decision,
    plan,
    validation,
    diagnostics: {
      eventGroup,
      ruleReasonCode: ruleResult.reasonCode,
      validationFailed,
      fallbackApplied: validationFailed,
    },
    promptVersion: '1.0',
  };

  if (validationFailed) {
    return {
      ...base,
      fallbackPlan: { version: '1.0' as const, decisionKind: 'noop' as const, actions: [] },
    };
  }

  return base;
}
