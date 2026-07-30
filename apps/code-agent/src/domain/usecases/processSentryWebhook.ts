import { randomUUID } from 'node:crypto';
import { getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { getServices } from '../../services.js';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
  NormalizedSentryIssueEvent,
  SentryIssueEventParseError,
  SentryIssueTaskContext,
} from '../models/sentryIssueEvent.js';
import { sanitizePrompt } from '../utils/promptSanitization.js';
import { sanitizePromptForInjection } from '../utils/promptInjectionSanitizer.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { resolveDefaultWorkerType } from '../utils/defaultWorkerTypeResolution.js';
import type { CodeTask, TaskStatus } from '../models/codeTask.js';

const SYSTEM_PROMPT_HASH_PLACEHOLDER = 'sentry-agent-system-prompt-v1';
const SENTRY_RESERVATION_LEASE_DURATION_MS = 5 * 60 * 1000;
const ACTIONABLE_ISSUE_ACTIONS = new Set(['created', 'regressed', 'unresolved', 'reopened']);
const TERMINAL_ISSUE_STATUSES = new Set(['resolved', 'ignored', 'muted', 'archived', 'deleted']);
const ACTIVE_DUPLICATE_TASK_STATUSES = new Set<TaskStatus>(['queued', 'dispatched', 'running']);
const SENTRY_AUTOMATION_SELF_ALERT_TITLES = new Set([
  'failed to reserve sentry issue event',
  'failed to record task completion metric',
  'failed to record task duration metric',
  'issue not found for comment',
  'dispatch blocked by worker capability or health state',
  'dispatch failed for fallback decision',
  'log upload failed, retrying',
  'error: failed to upload log chunks after retries',
  'code worker auth not ready',
  'code worker auth not ready at startup',
]);

export type VerifySentrySignature = (payload: Buffer, signature: string, secret: string) => boolean;
export type ParseSentryIssueEvent = (
  resource: string | undefined,
  payload: unknown
) => Result<NormalizedSentryIssueEvent, SentryIssueEventParseError>;

export interface ProcessSentryWebhookInput {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  resourceHeader: string | undefined;
  body: unknown;
  logger: Logger;
  webhookSecret: string;
  orchestratorSecret: string;
  automationUserId: string;
  repository: string;
  baseBranch: string;
  verifySignature: VerifySentrySignature;
  parseIssueEvent: ParseSentryIssueEvent;
}

export type ProcessSentryWebhookResult =
  | { ok: true; outcome: 'processed'; message: string; codeTaskId: string }
  | { ok: true; outcome: 'duplicate'; message: string; codeTaskId?: string | undefined }
  | { ok: true; outcome: 'ignored'; message: string }
  | {
    ok: false;
    reason: 'invalid_signature' | 'internal_error' | 'invalid_payload' | 'retryable';
    message: string;
  };

function retryableLeaseResult(): ProcessSentryWebhookResult {
  return {
    ok: false,
    reason: 'retryable',
    message: 'Sentry issue processing is already in progress',
  };
}

function buildSentryTaskPrompt(event: NormalizedSentryIssueEvent): string {
  return [
    'SentryBox reported an actionable IntexuraOS issue.',
    '',
    `SentryBox issue: ${event.issueTitle}`,
    `SentryBox URL: ${event.issueUrl}`,
    `Organization: ${event.organizationSlug}`,
    `Project: ${event.projectSlug}`,
    `Issue ID: ${event.issueId}`,
    `Webhook resource: ${event.resource}`,
    `Webhook action: ${event.action}`,
    event.eventId !== undefined ? `Event ID: ${event.eventId}` : undefined,
    '',
    'Handle this without user interaction. Fetch current SentryBox issue details and recent events, attempt reproduction when feasible, then open a pull request that either fixes the bug or suppresses the report in code with evidence.',
  ].filter((line): line is string => line !== undefined).join('\n');
}

function toTaskContext(event: NormalizedSentryIssueEvent, receivedAt: Date): SentryIssueTaskContext {
  return {
    organizationSlug: event.organizationSlug,
    projectSlug: event.projectSlug,
    issueId: event.issueId,
    issueUrl: event.issueUrl,
    title: event.issueTitle,
    action: event.action,
    receivedAt: receivedAt.toISOString(),
    ...(event.projectId !== undefined && { projectId: event.projectId }),
    ...(event.issueShortId !== undefined && { issueShortId: event.issueShortId }),
    ...(event.eventId !== undefined && { eventId: event.eventId }),
  };
}

function normalizeToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTerminalIssueStatus(event: NormalizedSentryIssueEvent): boolean {
  const status = normalizeToken(event.status);
  return status !== undefined && TERMINAL_ISSUE_STATUSES.has(status);
}

function isSentrySampleEventAlert(event: NormalizedSentryIssueEvent): boolean {
  const title = normalizeTitle(event.issueTitle);
  return title.startsWith('this is an example ')
    || title.includes('sentry sample')
    || title.includes('sample event')
    || title.includes('test event');
}

function isSentryAutomationSelfAlert(event: NormalizedSentryIssueEvent): boolean {
  const title = normalizeTitle(event.issueTitle);
  return SENTRY_AUTOMATION_SELF_ALERT_TITLES.has(title)
    || title.startsWith('detected phantom summaries with no displayable tasks');
}

function classifySentryIssueEvent(event: NormalizedSentryIssueEvent):
  | { actionable: true }
  | { actionable: false; message: string } {
  const action = normalizeToken(event.action) ?? 'unknown';
  if (event.resource === 'issue') {
    if (ACTIONABLE_ISSUE_ACTIONS.has(action)) {
      return { actionable: true };
    }
    return {
      actionable: false,
      message: `Ignored non-actionable Sentry issue event: issue.${action}`,
    };
  }

  if (action !== 'triggered' || isTerminalIssueStatus(event)) {
    return {
      actionable: false,
      message: `Ignored non-actionable Sentry issue event: event_alert.${action}`,
    };
  }

  if (isSentrySampleEventAlert(event)) {
    return {
      actionable: false,
      message: 'Ignored Sentry sample event_alert delivery',
    };
  }

  return { actionable: true };
}

function hasOpenPullRequest(task: CodeTask): boolean {
  const hasPullRequest = task.prNumber !== undefined || task.result?.prUrl !== undefined;
  return hasPullRequest && task.prMergedAt === undefined && task.prClosedAt === undefined;
}

function isLinkedSentryTaskBlocking(task: CodeTask): boolean {
  if (ACTIVE_DUPLICATE_TASK_STATUSES.has(task.status)) {
    return true;
  }
  return hasOpenPullRequest(task);
}

export async function processSentryWebhook(
  input: ProcessSentryWebhookInput
): Promise<ProcessSentryWebhookResult> {
  const {
    rawBody,
    signatureHeader,
    resourceHeader,
    body,
    logger,
    webhookSecret,
    orchestratorSecret,
    automationUserId,
    repository,
    baseBranch,
    verifySignature,
    parseIssueEvent,
  } = input;

  if (
    signatureHeader === undefined
    || signatureHeader === ''
    || !verifySignature(rawBody, signatureHeader, webhookSecret)
  ) {
    logger.warn({ _skipSentry: true }, 'Invalid Sentry webhook signature');
    return {
      ok: false,
      reason: 'invalid_signature',
      message: 'Invalid Sentry webhook signature',
    };
  }

  const parsed = parseIssueEvent(resourceHeader, body);
  if (!parsed.ok) {
    if (parsed.error.code === 'UNSUPPORTED_RESOURCE') {
      return { ok: true, outcome: 'ignored', message: parsed.error.message };
    }
    return { ok: false, reason: 'invalid_payload', message: parsed.error.message };
  }

  const classification = classifySentryIssueEvent(parsed.value);
  if (!classification.actionable) {
    return { ok: true, outcome: 'ignored', message: classification.message };
  }

  if (isSentryAutomationSelfAlert(parsed.value)) {
    return {
      ok: true,
      outcome: 'ignored',
      message: `Ignored Sentry automation self-alert: ${parsed.value.issueTitle}`,
    };
  }

  const { sentryIssueEventRepo, workerSettingsRepo, linearIssueService, codeTaskRepo, taskEnqueueService } =
    getServices();
  if (sentryIssueEventRepo === undefined) {
    logger.error({}, 'Sentry issue event repository is not configured');
    return { ok: false, reason: 'internal_error', message: 'Sentry issue event repository is not configured' };
  }

  const receivedAt = new Date();
  const proposedCodeTaskId = `task_${randomUUID()}`;
  const acquireInput: AcquireSentryTaskReservationInput = {
    event: parsed.value,
    receivedAt,
    proposedCodeTaskId,
    leaseOwner: proposedCodeTaskId,
    leaseDurationMs: SENTRY_RESERVATION_LEASE_DURATION_MS,
    payload: body,
  };
  let acquireResult = await sentryIssueEventRepo.acquire(acquireInput);
  if (!acquireResult.ok) {
    logger.error({ error: acquireResult.error }, 'Failed to reserve Sentry issue event');
    return { ok: false, reason: 'internal_error', message: acquireResult.error.message };
  }

  if (acquireResult.value.kind === 'duplicate') {
    return {
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      ...(acquireResult.value.codeTaskId !== undefined && {
        codeTaskId: acquireResult.value.codeTaskId,
      }),
    };
  }

  if (acquireResult.value.kind === 'retryable') {
    return retryableLeaseResult();
  }

  if (acquireResult.value.kind === 'inspect_linked_task') {
    const linkedTaskId = acquireResult.value.codeTaskId;
    const taskResult = await codeTaskRepo.findById(linkedTaskId);
    if (!taskResult.ok && taskResult.error.code !== 'NOT_FOUND') {
      return { ok: false, reason: 'internal_error', message: taskResult.error.message };
    }
    if (taskResult.ok && isLinkedSentryTaskBlocking(taskResult.value)) {
      return {
        ok: true,
        outcome: 'duplicate',
        message: 'Sentry issue already has a code task',
        codeTaskId: linkedTaskId,
      };
    }

    acquireResult = await sentryIssueEventRepo.acquire({
      ...acquireInput,
      replaceLinkedCodeTaskId: linkedTaskId,
    });
    if (!acquireResult.ok) {
      logger.error({ error: acquireResult.error }, 'Failed to replace stale Sentry task reservation');
      return { ok: false, reason: 'internal_error', message: acquireResult.error.message };
    }
    if (acquireResult.value.kind === 'retryable') {
      return retryableLeaseResult();
    }
    if (acquireResult.value.kind !== 'acquired') {
      return {
        ok: true,
        outcome: 'duplicate',
        message: 'Sentry issue already has a code task',
        ...(acquireResult.value.codeTaskId !== undefined && {
          codeTaskId: acquireResult.value.codeTaskId,
        }),
      };
    }
  }

  const reservation: Extract<AcquireSentryTaskReservationResult, { kind: 'acquired' }> =
    acquireResult.value;

  const failReservation = async (input: {
    result: ProcessSentryWebhookResult;
    reason: string;
    codeTaskId?: string | undefined;
    linearIssueId?: string | undefined;
  }): Promise<ProcessSentryWebhookResult> => {
    const failed = await sentryIssueEventRepo.failReservation({
      transitionKey: reservation.transitionKey,
      issueKey: reservation.issueKey,
      leaseToken: reservation.leaseToken,
      reason: input.reason,
      ...(input.codeTaskId !== undefined && { codeTaskId: input.codeTaskId }),
      ...(input.linearIssueId !== undefined && { linearIssueId: input.linearIssueId }),
    });
    if (!failed.ok) {
      logger.error({ error: failed.error }, 'Failed to release Sentry task reservation');
      return { ok: false, reason: 'internal_error', message: failed.error.message };
    }
    return input.result;
  };

  const completeReservation = async (task: CodeTask): Promise<ProcessSentryWebhookResult> => {
    const completed = await sentryIssueEventRepo.completeReservation({
      transitionKey: reservation.transitionKey,
      issueKey: reservation.issueKey,
      leaseToken: reservation.leaseToken,
      codeTaskId: task.id,
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    });
    if (!completed.ok) {
      logger.error({ error: completed.error, taskId: task.id }, 'Failed to complete Sentry task reservation');
      return await failReservation({
        result: { ok: false, reason: 'internal_error', message: completed.error.message },
        reason: completed.error.message,
        codeTaskId: task.id,
        linearIssueId: task.linearIssueId,
      });
    }
    return {
      ok: true,
      outcome: 'processed',
      message: 'Sentry issue code task created',
      codeTaskId: task.id,
    };
  };

  const existingTaskResult = await codeTaskRepo.findById(reservation.codeTaskId);
  if (existingTaskResult.ok) {
    const existingTask = existingTaskResult.value;
    if (existingTask.status === 'queued') {
      const enqueueResult = await taskEnqueueService.enqueue({
        taskId: existingTask.id,
        userId: automationUserId,
      });
      if (!enqueueResult.ok) {
        const message = getErrorMessage(enqueueResult.error, 'Failed to enqueue Sentry code task');
        return await failReservation({
          result: { ok: false, reason: 'internal_error', message },
          reason: message,
          codeTaskId: existingTask.id,
          linearIssueId: existingTask.linearIssueId,
        });
      }
    }
    return await completeReservation(existingTask);
  }
  if (existingTaskResult.error.code !== 'NOT_FOUND') {
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message: existingTaskResult.error.message },
      reason: existingTaskResult.error.message,
    });
  }

  const settingsResult = await workerSettingsRepo.getSettings(automationUserId);
  if (!settingsResult.ok) {
    logger.error({ userId: automationUserId, error: settingsResult.error }, 'Failed to load Sentry automation worker settings');
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message: settingsResult.error.message },
      reason: settingsResult.error.message,
    });
  }

  const enabledWorkers = settingsResult.value?.workers.filter((worker) => worker.enabled) ?? [];
  const firstWorker = enabledWorkers[0];
  if (firstWorker === undefined) {
    const message = 'Sentry automation user has no enabled workers';
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message },
      reason: message,
    });
  }

  const workerResolution = resolveDefaultWorkerType({
    agentType: 'sentry',
    settings: settingsResult.value,
  });
  const prompt = buildSentryTaskPrompt(parsed.value);
  const secretRedacted = sanitizePrompt(prompt);
  const injectionResult = sanitizePromptForInjection(secretRedacted);
  if (!injectionResult.ok) {
    return await failReservation({
      result: { ok: false, reason: 'invalid_payload', message: injectionResult.error.message },
      reason: injectionResult.error.message,
    });
  }

  const issueResult = await linearIssueService.ensureIssueExists({
    userId: automationUserId,
    taskPrompt: injectionResult.value,
    idempotencyKey: reservation.transitionKey,
    ...(reservation.linearIssueId !== undefined && {
      linearIssueId: reservation.linearIssueId,
    }),
  });
  if (issueResult.linearFallback || issueResult.linearIssueId === undefined) {
    const message = issueResult.linearFallbackError ?? 'Failed to create or link Linear issue for Sentry issue';
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message },
      reason: message,
    });
  }

  const checkpointResult = await sentryIssueEventRepo.checkpointLinearIssue({
    transitionKey: reservation.transitionKey,
    issueKey: reservation.issueKey,
    leaseToken: reservation.leaseToken,
    linearIssueId: issueResult.linearIssueId,
  });
  if (!checkpointResult.ok) {
    logger.error({ error: checkpointResult.error }, 'Failed to checkpoint Sentry Linear issue');
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message: checkpointResult.error.message },
      reason: checkpointResult.error.message,
      linearIssueId: issueResult.linearIssueId,
    });
  }

  const taskId = reservation.codeTaskId;
  const createResult = await codeTaskRepo.create({
    id: taskId,
    userId: automationUserId,
    prompt,
    sanitizedPrompt: injectionResult.value,
    systemPromptHash: SYSTEM_PROMPT_HASH_PLACEHOLDER,
    workerType: workerResolution.workerType,
    workerLocation: firstWorker.name,
    repository,
    baseBranch,
    traceId: `sentry-${parsed.value.issueId}-${String(Date.now())}`,
    webhookSecret: generateWebhookSecret(orchestratorSecret, taskId),
    linearIssueId: issueResult.linearIssueId,
    agentType: 'sentry',
    sentryIssue: toTaskContext(parsed.value, receivedAt),
  });
  if (!createResult.ok) {
    if (
      (createResult.error.code === 'DUPLICATE_PROMPT' || createResult.error.code === 'ACTIVE_TASK_EXISTS')
      && createResult.error.existingTaskId === taskId
    ) {
      const recovered = await codeTaskRepo.findById(taskId);
      if (recovered.ok) {
        if (recovered.value.status === 'queued') {
          const enqueueRecovered = await taskEnqueueService.enqueue({
            taskId: recovered.value.id,
            userId: automationUserId,
          });
          if (!enqueueRecovered.ok) {
            const message = getErrorMessage(enqueueRecovered.error, 'Failed to enqueue Sentry code task');
            return await failReservation({
              result: { ok: false, reason: 'internal_error', message },
              reason: message,
              codeTaskId: recovered.value.id,
              linearIssueId: recovered.value.linearIssueId,
            });
          }
        }
        return await completeReservation(recovered.value);
      }
    }
    logger.error({ error: createResult.error }, 'Failed to create Sentry code task');
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message: createResult.error.message },
      reason: createResult.error.message,
      linearIssueId: issueResult.linearIssueId,
    });
  }

  const task = createResult.value;
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId: automationUserId,
  });
  if (!enqueueResult.ok) {
    logger.error({ error: enqueueResult.error, taskId: task.id }, 'Failed to enqueue Sentry code task');
    const message = getErrorMessage(enqueueResult.error, 'Failed to enqueue Sentry code task');
    return await failReservation({
      result: { ok: false, reason: 'internal_error', message },
      reason: message,
      codeTaskId: task.id,
      linearIssueId: issueResult.linearIssueId,
    });
  }

  return await completeReservation(task);
}
