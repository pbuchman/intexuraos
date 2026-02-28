import type { Logger } from '@intexuraos/common-core';
import type { GitHubWebhookAgentConfig } from '../../config/githubWebhookAgentConfig.js';
import type { GitHubPREvent } from '../models/gitHubPREvent.js';
import type { WebhookEventGroup, WebhookAgentRunRecord } from './models.js';
import { evaluateWebhookActionabilityRules, type RuleEvaluationInput } from './rules.js';
import { compileWebhookActionPlan, type ActionCompilerInput } from './actionCompiler.js';
import { validateWebhookActionPlan } from './validator.js';
import { executeWebhookActionPlan, type ExecutorDeps } from './executor.js';

export interface ProcessEventDeps {
  logger: Logger;
  config: GitHubWebhookAgentConfig;
  executorDeps: ExecutorDeps;
  classifyEventGroup: (eventType: string, action: string | null) => WebhookEventGroup;
  isSenderAllowed: (senderLogin: string) => boolean;
  isUserMapped: (senderLogin: string) => boolean;
  hasExistingTask: (repository: string, prNumber: number) => Promise<boolean>;
  saveRunRecord: (record: WebhookAgentRunRecord) => Promise<void>;
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
  const existingTask = await deps.hasExistingTask(event.repository, event.pullRequestNumber);

  const ruleInput: RuleEvaluationInput = {
    eventGroup,
    action: event.action,
    senderLogin: event.senderLogin,
    senderAllowed,
    body: event.body,
    hasExistingTask: existingTask,
  };

  const ruleResult = evaluateWebhookActionabilityRules(ruleInput);

  const isActionable = ruleResult.actionability !== 'non_actionable';

  const decision = {
    version: '1.0' as const,
    eventGroup,
    actionability: ruleResult.actionability,
    confidence: ruleResult.confidence,
    reasoning: ruleResult.reasoning,
    requestedWorkerType: null,
    decision: {
      kind: isActionable
        ? (existingTask ? 'send_task_message' as const : 'create_pr_comment_task' as const)
        : 'noop' as const,
    },
  };

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
      : 'execute' as const;

  logger.info(
    { runId, eventGroup, actionability: ruleResult.actionability, mode, eventId: event.id },
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

    await deps.saveRunRecord(record);
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

    await deps.saveRunRecord(record);
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

  await deps.saveRunRecord(record);

  return {
    handled: true,
    mode: 'execute',
    runId,
    outcome: executionResult.outcome,
  };
}
