import type { Logger } from '@intexuraos/common-core';
import type { GitHubWebhookAgentConfig } from '../../config/githubWebhookAgentConfig.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { WebhookEventGroup, WebhookAgentRunRecord, WebhookAgentDecision } from './models.js';
import { evaluateWebhookActionabilityRules, type RuleEvaluationInput } from './rules.js';
import { compileWebhookActionPlan, type ActionCompilerInput } from './actionCompiler.js';
import { validateWebhookActionPlan } from './validator.js';
import { executeWebhookActionPlan, type ExecutorDeps } from './executor.js';
import { evaluateWorkflowRepairEligibility, type RepairEligibilityDeps } from './eventFamilies/githubActionResult.js';
import { evaluateConflictResolutionEligibility, extractMergeableState, type ConflictEligibilityDeps } from './eventFamilies/pullRequest.js';
import { buildDecisionFromEvaluator } from './decisionBuilder.js';

export interface ProcessEventDeps {
  logger: Logger;
  config: GitHubWebhookAgentConfig;
  executorDeps: ExecutorDeps;
  classifyEventGroup: (eventType: string, action: string | null) => WebhookEventGroup;
  isSenderAllowed: (senderLogin: string) => boolean;
  isUserMapped: (senderLogin: string) => boolean;
  hasExistingTask: (repository: string, prNumber: number) => Promise<boolean>;
  saveRunRecord: (record: WebhookAgentRunRecord) => Promise<void>;
  repairDeps: RepairEligibilityDeps;
  conflictDeps: ConflictEligibilityDeps;
}

export interface ProcessEventResult {
  handled: boolean;
  mode: 'disabled' | 'observe' | 'notify' | 'execute';
  runId?: string;
  outcome?: string;
}

function generateRunId(): string {
  return `run_${crypto.randomUUID()}`;
}

function buildRulesDecision(
  eventGroup: WebhookEventGroup,
  event: GitHubPREvent,
  senderAllowed: boolean,
  existingTask: boolean
): WebhookAgentDecision {
  const ruleInput: RuleEvaluationInput = {
    eventGroup,
    action: event.action,
    senderLogin: event.senderLogin,
    senderAllowed,
    body: event.body,
    hasExistingTask: existingTask,
  };

  const ruleResult = evaluateWebhookActionabilityRules(ruleInput);
  // TODO(INT-631): When planner is wired (Phase 2), invoke it for 'uncertain' results
  // instead of treating them as actionable. Currently safe because execute mode uses
  // placeholder tools that no-op. See planner.ts / plannerPrompt.ts for LLM integration.
  const isActionable = ruleResult.actionability !== 'non_actionable';

  return {
    version: '1.0',
    eventGroup,
    actionability: ruleResult.actionability,
    confidence: ruleResult.confidence,
    reasoning: ruleResult.reasoning,
    requestedWorkerType: null,
    decision: {
      kind: isActionable
        ? (existingTask ? 'send_task_message' : 'create_pr_comment_task')
        : 'noop',
    },
  };
}

export async function processGitHubWebhookEvent(
  deps: ProcessEventDeps,
  event: GitHubPREvent
): Promise<ProcessEventResult> {
  const { logger, config } = deps;

  if (!config.enabled) {
    return { handled: false, mode: 'disabled' };
  }

  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  const eventGroup = deps.classifyEventGroup(event.eventType, event.action);
  const senderAllowed = deps.isSenderAllowed(event.senderLogin);
  const userMapped = deps.isUserMapped(event.senderLogin);

  let existingTask: boolean;
  try {
    existingTask = await deps.hasExistingTask(event.repository, event.pullRequestNumber);
  } catch (error: unknown) {
    logger.error({ error, eventId: event.id }, 'Failed to check existing task for webhook event');
    existingTask = false;
  }

  let decision: WebhookAgentDecision;

  if (eventGroup === 'github_action_result') {
    const repairResult = evaluateWorkflowRepairEligibility(
      {
        eventType: event.eventType,
        action: event.action,
        state: event.state,
        pullRequestNumber: event.pullRequestNumber,
        repository: event.repository,
        senderLogin: event.senderLogin,
      },
      deps.repairDeps
    );

    const built = buildDecisionFromEvaluator(eventGroup, repairResult);
    decision = built.decision;
  } else if (eventGroup === 'pull_request') {
    const mergeableState = extractMergeableState(event.payload);
    const conflictResult = evaluateConflictResolutionEligibility(
      {
        eventType: event.eventType,
        action: event.action,
        mergeableState,
        pullRequestNumber: event.pullRequestNumber,
        repository: event.repository,
        senderLogin: event.senderLogin,
      },
      deps.conflictDeps
    );

    if (conflictResult.eligible) {
      const built = buildDecisionFromEvaluator(eventGroup, conflictResult);
      decision = built.decision;
    } else {
      decision = buildRulesDecision(eventGroup, event, senderAllowed, existingTask);
    }
  } else {
    decision = buildRulesDecision(eventGroup, event, senderAllowed, existingTask);
  }

  const compilerInput: ActionCompilerInput = {
    runId,
    decision,
    hasExistingTask: existingTask,
    userMapped,
    ownsProcessingMarker: config.ownsProcessingMarker,
  };

  const plan = compileWebhookActionPlan(compilerInput);
  const validation = validateWebhookActionPlan(plan, decision, {
    hasExistingTask: existingTask,
    existingTaskWorkerType: null,
    senderAllowed,
    userMapped,
  });

  if (!validation.valid) {
    logger.warn(
      { runId, errors: validation.errors },
      'Webhook action plan failed validation'
    );
  }

  const mode = config.observeOnly
    ? 'observe' as const
    : config.notifyOnly
      ? 'notify' as const
      : !config.executeComments
        ? 'notify' as const
        : 'execute' as const;

  logger.info(
    { runId, eventGroup, actionability: decision.actionability, mode, eventId: event.id },
    'Webhook agent processed event'
  );

  if (mode === 'observe') {
    const record: WebhookAgentRunRecord = {
      runId,
      savedEventId: event.id,
      eventGroup,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      decision,
      actionPlan: plan,
      stepResults: [],
      outcome: 'noop',
    };

    try {
      await deps.saveRunRecord(record);
    } catch (error: unknown) {
      logger.error({ error, runId }, 'Failed to save observe-mode run record');
    }
    return { handled: true, mode: 'observe', runId, outcome: 'noop' };
  }

  if (mode === 'notify' || !validation.valid) {
    const record: WebhookAgentRunRecord = {
      runId,
      savedEventId: event.id,
      eventGroup,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
      decision,
      actionPlan: plan,
      stepResults: [],
      outcome: validation.valid ? 'noop' : 'failed',
      ...(!validation.valid && { error: validation.errors.map((e) => e.message).join('; ') }),
    };

    try {
      await deps.saveRunRecord(record);
    } catch (error: unknown) {
      logger.error({ error, runId }, 'Failed to save notify-mode run record');
    }
    return { handled: true, mode, runId, outcome: record.outcome };
  }

  const executionStart = Date.now();
  const executionResult = await executeWebhookActionPlan(plan, deps.executorDeps);
  const durationMs = Date.now() - executionStart;

  const record: WebhookAgentRunRecord = {
    runId,
    savedEventId: event.id,
    eventGroup,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    decision,
    actionPlan: plan,
    stepResults: [...executionResult.stepResults],
    outcome: executionResult.outcome === 'completed' ? 'completed' : 'failed',
    ...(executionResult.error !== undefined && { error: executionResult.error }),
  };

  try {
    await deps.saveRunRecord(record);
  } catch (error: unknown) {
    logger.error({ error, runId }, 'Failed to save execute-mode run record');
  }

  return {
    handled: true,
    mode: 'execute',
    runId,
    outcome: executionResult.outcome,
  };
}
