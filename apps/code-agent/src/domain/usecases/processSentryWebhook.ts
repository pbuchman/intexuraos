import { randomUUID } from 'node:crypto';
import { getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { getServices } from '../../services.js';
import type {
  NormalizedSentryIssueEvent,
  SentryIssueEventParseError,
  SentryIssueTaskContext,
} from '../models/sentryIssueEvent.js';
import { sanitizePrompt } from '../utils/promptSanitization.js';
import { sanitizePromptForInjection } from '../utils/promptInjectionSanitizer.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import { resolveDefaultWorkerType } from '../utils/defaultWorkerTypeResolution.js';

const SYSTEM_PROMPT_HASH_PLACEHOLDER = 'sentry-agent-system-prompt-v1';

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
  | { ok: false; reason: 'invalid_signature' | 'internal_error' | 'invalid_payload'; message: string };

function buildSentryTaskPrompt(event: NormalizedSentryIssueEvent): string {
  return [
    'Sentry reported an actionable IntexuraOS issue.',
    '',
    `Sentry issue: ${event.issueTitle}`,
    `Sentry URL: ${event.issueUrl}`,
    `Organization: ${event.organizationSlug}`,
    `Project: ${event.projectSlug}`,
    `Issue ID: ${event.issueId}`,
    `Webhook resource: ${event.resource}`,
    `Webhook action: ${event.action}`,
    event.eventId !== undefined ? `Event ID: ${event.eventId}` : undefined,
    '',
    'Handle this without user interaction. Fetch current Sentry issue details and recent events, attempt reproduction when feasible, then open a pull request that either fixes the bug or suppresses the report in code with evidence.',
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

  const { sentryIssueEventRepo, workerSettingsRepo, linearIssueService, codeTaskRepo, taskEnqueueService } =
    getServices();
  if (sentryIssueEventRepo === undefined) {
    logger.error({}, 'Sentry issue event repository is not configured');
    return { ok: false, reason: 'internal_error', message: 'Sentry issue event repository is not configured' };
  }

  const receivedAt = new Date();
  const reserveResult = await sentryIssueEventRepo.reserve({
    event: parsed.value,
    receivedAt,
    payload: body,
  });
  if (!reserveResult.ok) {
    logger.error({ error: reserveResult.error }, 'Failed to reserve Sentry issue event');
    return { ok: false, reason: 'internal_error', message: reserveResult.error.message };
  }

  if (!reserveResult.value.created) {
    return {
      ok: true,
      outcome: 'duplicate',
      message: 'Sentry issue already has a code task',
      ...(reserveResult.value.record.codeTaskId !== undefined && {
        codeTaskId: reserveResult.value.record.codeTaskId,
      }),
    };
  }

  const settingsResult = await workerSettingsRepo.getSettings(automationUserId);
  if (!settingsResult.ok) {
    logger.error({ userId: automationUserId, error: settingsResult.error }, 'Failed to load Sentry automation worker settings');
    return { ok: false, reason: 'internal_error', message: settingsResult.error.message };
  }

  const enabledWorkers = settingsResult.value?.workers.filter((worker) => worker.enabled) ?? [];
  const firstWorker = enabledWorkers[0];
  if (firstWorker === undefined) {
    return {
      ok: false,
      reason: 'internal_error',
      message: 'Sentry automation user has no enabled workers',
    };
  }

  const workerResolution = resolveDefaultWorkerType({
    agentType: 'sentry',
    settings: settingsResult.value,
  });
  const prompt = buildSentryTaskPrompt(parsed.value);
  const secretRedacted = sanitizePrompt(prompt);
  const injectionResult = sanitizePromptForInjection(secretRedacted);
  if (!injectionResult.ok) {
    return { ok: false, reason: 'invalid_payload', message: injectionResult.error.message };
  }

  const issueResult = await linearIssueService.ensureIssueExists({
    userId: automationUserId,
    taskPrompt: injectionResult.value,
  });
  if (issueResult.linearFallback || issueResult.linearIssueId === undefined) {
    return {
      ok: false,
      reason: 'internal_error',
      message: issueResult.linearFallbackError ?? 'Failed to create or link Linear issue for Sentry issue',
    };
  }

  const taskId = `task_${randomUUID()}`;
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
    logger.error({ error: createResult.error }, 'Failed to create Sentry code task');
    return { ok: false, reason: 'internal_error', message: createResult.error.message };
  }

  const task = createResult.value;
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: task.id,
    userId: automationUserId,
  });
  if (!enqueueResult.ok) {
    logger.error({ error: enqueueResult.error, taskId: task.id }, 'Failed to enqueue Sentry code task');
    return {
      ok: false,
      reason: 'internal_error',
      message: getErrorMessage(enqueueResult.error, 'Failed to enqueue Sentry code task'),
    };
  }

  const markResult = await sentryIssueEventRepo.markCodeTaskCreated({
    dedupeKey: reserveResult.value.record.dedupeKey,
    codeTaskId: task.id,
    linearIssueId: issueResult.linearIssueId,
  });
  if (!markResult.ok) {
    logger.error({ error: markResult.error, taskId: task.id }, 'Failed to link Sentry issue event to code task');
    return { ok: false, reason: 'internal_error', message: markResult.error.message };
  }

  return {
    ok: true,
    outcome: 'processed',
    message: 'Sentry issue code task created',
    codeTaskId: task.id,
  };
}
