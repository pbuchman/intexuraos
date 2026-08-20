/**
 * Use case: Process a GitHub webhook delivery.
 *
 * Extracted from `routes/webhooks/github.ts`. Given a raw payload, the
 * signature header, the event type, and a delivery id, this use case executes
 * the entire processing pipeline:
 *
 *  1. Verify the HMAC-SHA256 signature against the configured secret.
 *  2. Persist an auth-passed audit event and a pending event-log entry.
 *  3. Record a best-effort `webhook_received` automation log line when the
 *     event carries PR context.
 *  4. Handle ping events with a dedicated `pong` outcome.
 *  5. Parse the payload via `parseGitHubWebhookEvent`.
 *  6. Short-circuit on invalid / unsupported / out-of-scope events with the
 *     correct audit + log-entry finalization.
 *  7. Save the normalized PR event (deduplicating by delivery id).
 *  8. Upsert the PR summary row for display.
 *  9. Publish a PR triage event to Pub/Sub (falling back to inline evaluator).
 * 10. Fire-and-forget `handlePrClose` on PR close events.
 * 11. Fire-and-forget `detectOnPush` on push events.
 *
 * Dependencies are resolved lazily via `getServices()` so that route-level
 * integration tests that call `setServices(...)` mid-flight (to simulate a
 * repository disappearing) behave identically to the original implementation.
 *
 * The use case returns a discriminated `ProcessGitHubWebhookResult` that the
 * route maps to an HTTP status + body. The return contract is chosen so every
 * terminal branch of the handler corresponds to exactly one discriminant.
 */

import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { extractEventUrl } from '../utils/extractEventUrl.js';
import { extractEventSummary } from '../utils/extractEventSummary.js';
import type { CreateGitHubPREventInput } from '../models/gitHubPREvent.js';
import type { UpsertGitHubPRSummaryInput } from '../models/gitHubPRSummary.js';
import {
  toGitHubWebhookAction,
  toGitHubWebhookEventType,
} from '../models/gitHubWebhookTypes.js';
import type {
  GitHubWebhookAuditEvent,
  GitHubWebhookNormalizationStatus,
} from '../models/gitHubWebhookAuditEvent.js';
import type { GitHubEventLogEntry } from '../models/gitHubEventLogEntry.js';
import { resolveLoginForTaskCreation } from '../services/gitHubDispatchService.js';
import { handlePrClose } from './handlePrClose.js';
import { ALLOWED_BOTS } from '../constants/gitHubBots.js';
import { resolvePrCloseSourceTimestamp } from '../utils/prCloseTimestamp.js';
import type { GitHubWebhookBody } from '../models/gitHubWebhookHttp.js';

export type VerifyGitHubSignature = (payload: Buffer, signature: string, secret: string) => boolean;
export type ParseGitHubWebhookEvent = (
  eventType: string,
  payload: unknown,
) => Result<CreateGitHubPREventInput | null, { code: 'INVALID_PAYLOAD'; message: string }>;

export interface ProcessGitHubWebhookInput {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  eventType: string | undefined;
  deliveryId: string | undefined;
  body: GitHubWebhookBody;
  logger: Logger;
  webhookSecret: string;
  verifySignature: VerifyGitHubSignature;
  parseEvent: ParseGitHubWebhookEvent;
}

export type ProcessGitHubWebhookOk =
  | { ok: true; outcome: 'processed'; message: string }
  | { ok: true; outcome: 'pong'; message: string }
  | { ok: true; outcome: 'acknowledged'; message: string }
  | { ok: true; outcome: 'duplicate'; message: string }
  | { ok: true; outcome: 'ignored'; message: string };

export type ProcessGitHubWebhookErr =
  | { ok: false; reason: 'invalid_signature'; message: string }
  | { ok: false; reason: 'internal_error'; message: string };

export type ProcessGitHubWebhookResult = ProcessGitHubWebhookOk | ProcessGitHubWebhookErr;

const PR_TRIAGE_LEASE_DURATION_MS = 15 * 60 * 1000;

function extractRepositoryDetails(body: GitHubWebhookBody): {
  repository: string | null;
  repositoryId: number | null;
} {
  const repository = body.repository;
  if (repository === undefined) {
    return { repository: null, repositoryId: null };
  }

  return {
    repository: repository.full_name,
    repositoryId: repository.id,
  };
}

function extractPullRequestDetails(body: GitHubWebhookBody): {
  pullRequestNumber: number | null;
  pullRequestId: number | null;
} {
  const pullRequest = body.pull_request;
  if (pullRequest === undefined) {
    return { pullRequestNumber: null, pullRequestId: null };
  }

  return {
    pullRequestNumber: pullRequest.number,
    pullRequestId: pullRequest.id,
  };
}

function extractSenderDetails(body: GitHubWebhookBody): {
  senderLogin: string | null;
  senderId: number | null;
  senderType: string | null;
} {
  const sender = body.sender;
  if (sender === undefined) {
    return { senderLogin: null, senderId: null, senderType: null };
  }

  return {
    senderLogin: sender.login,
    senderId: sender.id,
    senderType: sender.type ?? null,
  };
}

function shouldProcessNormalizedRepository(repository: string): boolean {
  return repository.startsWith('intexuraos/') || repository.endsWith('/intexuraos');
}

async function persistRouteDecision(input: {
  auditEvent: GitHubWebhookAuditEvent;
  pendingEntry: GitHubEventLogEntry;
  reason: string;
  normalizationStatus: GitHubWebhookNormalizationStatus;
  logger: Logger;
  decisionLatencyMs: number;
}): Promise<boolean> {
  const { eventDecisionRepo, gitHubEventLogEntryRepo, gitHubWebhookAuditEventRepo } = getServices();

  const decisionResult = await eventDecisionRepo.save({
    eventId: input.auditEvent.id,
    repository: input.auditEvent.repository,
    pullRequestNumber: input.auditEvent.pullRequestNumber,
    eventType: input.auditEvent.eventType,
    eventAction: input.auditEvent.action ?? 'unknown',
    senderLogin: input.auditEvent.senderLogin,
    decidedBy: 'webhook_route',
    decision: 'skip',
    reason: input.reason,
    decisionLatencyMs: input.decisionLatencyMs,
  });

  if (!decisionResult.ok) {
    input.logger.error(
      { error: decisionResult.error, eventId: input.auditEvent.id, reason: input.reason },
      'Failed to save route-level GitHub event decision',
    );
    return false;
  }

  if (gitHubEventLogEntryRepo === undefined) {
    input.logger.error(
      { eventId: input.auditEvent.id },
      'GitHub event log entry repository not configured',
    );
    return false;
  }

  const completeResult = await gitHubEventLogEntryRepo.complete({
    id: input.pendingEntry.id,
    decisionId: decisionResult.value.id, // @allow-result-access -- narrowed by !decisionResult.ok above
    decisionState: 'completed',
    decisionOutcome: 'skip',
    updatedAt: new Date(),
    rowVersion: input.pendingEntry.rowVersion + 1,
  });

  if (!completeResult.ok) {
    input.logger.error(
      { error: completeResult.error, eventId: input.auditEvent.id, reason: input.reason },
      'Failed to complete GitHub event log entry',
    );
    return false;
  }

  if (gitHubWebhookAuditEventRepo !== undefined) {
    const auditStatusResult = await gitHubWebhookAuditEventRepo.updateNormalizationStatus({
      id: input.auditEvent.id,
      normalizationStatus: input.normalizationStatus,
    });
    if (!auditStatusResult.ok) {
      input.logger.warn(
        {
          error: auditStatusResult.error,
          eventId: input.auditEvent.id,
          normalizationStatus: input.normalizationStatus,
        },
        'Failed to update GitHub webhook audit normalization status',
      );
    }
  }

  return true;
}

async function updateAuditNormalizationStatus(input: {
  auditEventId: string;
  normalizationStatus: GitHubWebhookNormalizationStatus;
  logger: Logger;
}): Promise<void> {
  const { gitHubWebhookAuditEventRepo } = getServices();

  if (gitHubWebhookAuditEventRepo === undefined) {
    return;
  }

  const result = await gitHubWebhookAuditEventRepo.updateNormalizationStatus({
    id: input.auditEventId,
    normalizationStatus: input.normalizationStatus,
  });
  if (!result.ok) {
    input.logger.warn(
      { error: result.error, eventId: input.auditEventId, normalizationStatus: input.normalizationStatus },
      'Failed to update GitHub webhook audit normalization status',
    );
  }
}

async function ensureDecisionAfterEvaluationFailure(input: {
  auditEvent: GitHubWebhookAuditEvent;
  pendingEntry: GitHubEventLogEntry;
  logger: Logger;
  errorMessage: string;
}): Promise<void> {
  const { eventDecisionRepo } = getServices();

  try {
    if (eventDecisionRepo.findByEventIds !== undefined) {
      const existingResult = await eventDecisionRepo.findByEventIds([input.auditEvent.id]);
      if (existingResult.ok && existingResult.value.length > 0) { // @allow-result-access -- narrowed by existingResult.ok check
        return;
      }
    }

    await persistRouteDecision({
      auditEvent: input.auditEvent,
      pendingEntry: input.pendingEntry,
      logger: input.logger,
      reason: `evaluation_failed:${input.errorMessage}`,
      normalizationStatus: 'failed',
      decisionLatencyMs: 0,
    });
  } catch (error) {
    input.logger.error(
      { eventId: input.auditEvent.id, error },
      'Failed to persist fallback decision after evaluation failure',
    );
  }
}

async function runInlineTriageFallback(input: {
  eventId: string;
  auditEvent: GitHubWebhookAuditEvent;
  pendingEntry: GitHubEventLogEntry;
  logger: Logger;
}): Promise<boolean> {
  const { gitHubPREventRepo, unifiedEvaluator } = getServices();
  const acquireResult = await gitHubPREventRepo.acquireTriage({
    eventId: input.eventId,
    leaseOwner: `webhook-inline:${input.auditEvent.id}`,
    acquiredAt: new Date(),
    leaseDurationMs: PR_TRIAGE_LEASE_DURATION_MS,
  });

  if (!acquireResult.ok) {
    input.logger.error(
      { error: acquireResult.error, eventId: input.eventId },
      'Failed to acquire PR triage lease for inline fallback',
    );
    return false;
  }

  const acquisition = acquireResult.value; // @allow-result-access -- narrowed by !acquireResult.ok above
  if (acquisition.kind === 'completed') {
    input.logger.debug(
      { eventId: input.eventId, triageState: acquisition.kind },
      'Skipping inline PR triage fallback because the event is already completed',
    );
    return true;
  }
  if (acquisition.kind === 'busy') {
    input.logger.debug(
      { eventId: input.eventId, triageState: acquisition.kind },
      'Deferring inline PR triage fallback because the event has an active lease',
    );
    return false;
  }
  if (acquisition.kind === 'not_found') {
    input.logger.error(
      { eventId: input.eventId },
      'Saved PR event disappeared before inline triage fallback',
    );
    return false;
  }

  try {
    await unifiedEvaluator.evaluate(acquisition.event, input.logger);
  } catch (evalErr: unknown) {
    const errorMessage = getErrorMessage(evalErr, 'unknown_evaluation_error');
    const failResult = await gitHubPREventRepo.failTriage({
      eventId: input.eventId,
      leaseToken: acquisition.leaseToken,
      failedAt: new Date(),
      reason: errorMessage,
    });
    if (!failResult.ok) {
      input.logger.error(
        { error: failResult.error, eventId: input.eventId },
        'Failed to release PR triage lease after inline evaluator error',
      );
    }
    input.logger.error({ evalErr }, 'Unhandled error in unified evaluator (fallback path)');
    await ensureDecisionAfterEvaluationFailure({
      auditEvent: input.auditEvent,
      pendingEntry: input.pendingEntry,
      logger: input.logger,
      errorMessage,
    });
    return false;
  }

  const completeResult = await gitHubPREventRepo.completeTriage({
    eventId: input.eventId,
    leaseToken: acquisition.leaseToken,
    completedAt: new Date(),
  });
  if (!completeResult.ok) {
    input.logger.error(
      { error: completeResult.error, eventId: input.eventId },
      'Failed to complete PR triage lease after inline evaluation',
    );
    return false;
  }
  return true;
}

async function publishPRTriageWithFallback(input: {
  eventId: string;
  repository: string;
  pullRequestNumber: number;
  auditEvent: GitHubWebhookAuditEvent;
  pendingEntry: GitHubEventLogEntry;
  logger: Logger;
}): Promise<boolean> {
  const { prTriagePublisher } = getServices();
  const publishResult = await prTriagePublisher.publishPRTriage({
    eventId: input.eventId,
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    correlationId: input.eventId,
  });

  if (publishResult.ok) return true;

  input.logger.error(
    { error: publishResult.error, eventId: input.eventId },
    'Failed to publish PR triage event — falling back to inline evaluator',
  );
  return await runInlineTriageFallback(input);
}

export async function processGitHubWebhook(
  input: ProcessGitHubWebhookInput,
): Promise<ProcessGitHubWebhookResult> {
  const {
    rawBody,
    signatureHeader,
    eventType,
    deliveryId,
    body,
    logger,
    webhookSecret,
    verifySignature,
    parseEvent,
  } = input;

  if (
    signatureHeader === undefined
    || signatureHeader === ''
    || !verifySignature(rawBody, signatureHeader, webhookSecret)
  ) {
    const sigPreview = signatureHeader !== undefined && signatureHeader !== ''
      ? signatureHeader.slice(0, 20)
      : undefined;
    logger.warn({ signature: sigPreview, _skipSentry: true }, 'Invalid GitHub webhook signature');
    return { ok: false, reason: 'invalid_signature', message: 'Invalid webhook signature' };
  }

  logger.debug({ eventType, hasSignature: true }, 'GitHub webhook signature verified');

  const {
    gitHubPREventRepo,
    gitHubPRSummaryRepo,
    gitHubWebhookAuditEventRepo,
    gitHubEventLogEntryRepo,
    automationLog,
    userServiceClient,
  } = getServices();

  if (gitHubWebhookAuditEventRepo === undefined || gitHubEventLogEntryRepo === undefined) {
    logger.error({}, 'GitHub webhook audit repositories are not configured');
    return { ok: false, reason: 'internal_error', message: 'GitHub event logging is not configured' };
  }

  const authPassedAt = new Date();
  const webhookEventType = toGitHubWebhookEventType(eventType);
  const webhookAction = toGitHubWebhookAction(body.action);
  const repositoryDetails = extractRepositoryDetails(body);
  const pullRequestDetails = extractPullRequestDetails(body);
  const senderDetails = extractSenderDetails(body);

  const auditResult = await gitHubWebhookAuditEventRepo.save({
    deliveryId: typeof deliveryId === 'string' ? deliveryId : null,
    githubEventName: typeof eventType === 'string' ? eventType : 'unknown',
    eventType: webhookEventType,
    action: webhookAction,
    repository: repositoryDetails.repository,
    repositoryId: repositoryDetails.repositoryId,
    pullRequestNumber: pullRequestDetails.pullRequestNumber,
    pullRequestId: pullRequestDetails.pullRequestId,
    senderLogin: senderDetails.senderLogin,
    senderId: senderDetails.senderId,
    senderType: senderDetails.senderType,
    authPassedAt,
    receivedAt: authPassedAt,
    normalizationStatus: 'pending',
    payload: body,
  });

  if (!auditResult.ok) {
    logger.error({ error: auditResult.error }, 'Failed to save auth-passed GitHub audit event');
    return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event audit' };
  }

  const auditEvent = auditResult.value; // @allow-result-access -- narrowed by !auditResult.ok above
  const auditEventId = auditEvent.id;

  const pendingLogEntryResult = await gitHubEventLogEntryRepo.createPending({
    id: auditEventId,
    githubEventName: typeof eventType === 'string' ? eventType : 'unknown',
    eventType: webhookEventType,
    action: webhookAction,
    repository: repositoryDetails.repository,
    pullRequestNumber: pullRequestDetails.pullRequestNumber,
    authPassedAt,
    updatedAt: authPassedAt,
    decisionState: 'pending',
    decisionOutcome: null,
    rowVersion: 1,
  });

  if (!pendingLogEntryResult.ok) {
    logger.error({ error: pendingLogEntryResult.error }, 'Failed to create pending GitHub event log entry');
    return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event log entry' };
  }

  const pendingEntry = pendingLogEntryResult.value; // @allow-result-access -- narrowed by !pendingLogEntryResult.ok above

  // Best-effort: record webhook_received in the automation log when we have PR context
  if (
    repositoryDetails.repository !== null
    && pullRequestDetails.pullRequestNumber !== null
    && pullRequestDetails.pullRequestNumber !== 0
  ) {
    /* v8 ignore start -- ts-type: typeof string check ?? fallback for already-validated header @preserve */
    const resolvedDeliveryId = typeof deliveryId === 'string' ? deliveryId : 'unknown';
    const resolvedEventType = typeof eventType === 'string' ? eventType : 'unknown';
    /* v8 ignore stop @preserve */
    const eventUrl = extractEventUrl(resolvedEventType, body);
    const eventSummary = extractEventSummary(resolvedEventType, body);
    const webhookReceivedRepo = repositoryDetails.repository;
    const webhookReceivedPrNumber = pullRequestDetails.pullRequestNumber;
    void (async (): Promise<void> => {
      let tokenUserId: string | undefined;
      if (senderDetails.senderLogin !== null) {
        try {
          const login = resolveLoginForTaskCreation(senderDetails.senderLogin, webhookReceivedRepo, ALLOWED_BOTS);
          const userResult = await userServiceClient.resolveGitHubUsername(login);
          if (userResult.ok) {
            const resolvedUser = userResult.value; // @allow-result-access -- narrowed by userResult.ok
            if (resolvedUser !== null) {
              tokenUserId = resolvedUser.userId;
            }
          }
        } catch {
          // Best-effort — userId resolution failure must not block automation logging
        }
      }
      await automationLog.record(
        { repository: webhookReceivedRepo, prNumber: webhookReceivedPrNumber },
        {
          type: 'webhook_received',
          eventType: resolvedEventType,
          /* v8 ignore start -- ts-type: action ?? and sender ?? fallbacks for optional webhook fields @preserve */
          action: body.action ?? 'unknown',
          sender: senderDetails.senderLogin ?? 'unknown',
          deliveryId: resolvedDeliveryId,
          ...(eventUrl !== null ? { eventUrl } : {}),
          ...(eventSummary !== null ? { summary: eventSummary } : {}),
          /* v8 ignore stop @preserve */
        },
        tokenUserId,
      );
    })()
      .catch((recordErr: unknown) => {
        logger.warn({ error: getErrorMessage(recordErr) }, 'Failed to record webhook_received in automation log');
      });
  }

  // Handle ping event (GitHub test)
  if (eventType === 'ping') {
    logger.info('Received GitHub ping event');
    const saved = await persistRouteDecision({
      auditEvent,
      pendingEntry,
      reason: 'ping_event',
      normalizationStatus: 'ignored',
      logger,
      decisionLatencyMs: Date.now() - authPassedAt.getTime(),
    });
    if (!saved) {
      return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
    }
    return { ok: true, outcome: 'pong', message: 'pong' };
  }

  const parseResult = parseEvent(eventType ?? '', body);

  if (!parseResult.ok) {
    logger.warn({ error: parseResult.error }, 'Failed to parse GitHub webhook event'); // @allow-result-access -- narrowed by !parseResult.ok
    const saved = await persistRouteDecision({
      auditEvent,
      pendingEntry,
      reason: 'invalid_payload',
      normalizationStatus: 'invalid',
      logger,
      decisionLatencyMs: Date.now() - authPassedAt.getTime(),
    });
    if (!saved) {
      return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
    }
    return { ok: true, outcome: 'acknowledged', message: 'acknowledged' };
  }

  const parsedEvent = parseResult.value; // @allow-result-access -- narrowed by !parseResult.ok

  if (parsedEvent === null) {
    logger.info({ eventType }, 'Unhandled GitHub event type, acknowledging');
    const saved = await persistRouteDecision({
      auditEvent,
      pendingEntry,
      reason: 'unsupported_event',
      normalizationStatus: 'unsupported',
      logger,
      decisionLatencyMs: Date.now() - authPassedAt.getTime(),
    });
    if (!saved) {
      return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
    }
    return { ok: true, outcome: 'acknowledged', message: 'acknowledged' };
  }

  if (!shouldProcessNormalizedRepository(parsedEvent.repository)) {
    logger.info(
      { repository: parsedEvent.repository },
      'Ignoring event from non-IntexuraOS repository',
    );
    if (parsedEvent.pullRequestNumber !== 0) {
      void automationLog.record(
        { repository: parsedEvent.repository, prNumber: parsedEvent.pullRequestNumber },
        { type: 'skipped', decidedBy: 'webhook_route', reason: 'repository_out_of_scope' },
      ).catch((recordErr: unknown) => {
        logger.warn({ error: getErrorMessage(recordErr) }, 'Failed to record skipped event in automation log');
      });
    }
    const saved = await persistRouteDecision({
      auditEvent,
      pendingEntry,
      reason: 'repository_out_of_scope',
      normalizationStatus: 'ignored',
      logger,
      decisionLatencyMs: Date.now() - authPassedAt.getTime(),
    });
    if (!saved) {
      return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
    }
    return { ok: true, outcome: 'ignored', message: 'ignored' };
  }

  const eventWithDeliveryId: CreateGitHubPREventInput = {
    ...parsedEvent,
    auditEventId,
    deliveryId: typeof deliveryId === 'string' ? deliveryId : null,
  };

  const saveResult = await gitHubPREventRepo.save(eventWithDeliveryId);

  if (!saveResult.ok) {
    if (saveResult.error.code === 'DUPLICATE_EVENT') { // @allow-result-access -- narrowed by !saveResult.ok
      logger.debug({ deliveryId }, 'Duplicate webhook delivery, replaying triage publication');
      const duplicateEventId = saveResult.error.eventId; // @allow-result-access -- narrowed by !saveResult.ok above
      let triageHandoffSucceeded = true;
      if (duplicateEventId !== undefined) {
        triageHandoffSucceeded = await publishPRTriageWithFallback({
          eventId: duplicateEventId,
          repository: parsedEvent.repository,
          pullRequestNumber: parsedEvent.pullRequestNumber,
          auditEvent,
          pendingEntry,
          logger,
        });
      }
      if (parsedEvent.pullRequestNumber !== 0) {
        void automationLog.record(
          { repository: parsedEvent.repository, prNumber: parsedEvent.pullRequestNumber },
          { type: 'skipped', decidedBy: 'webhook_route', reason: 'duplicate_delivery' },
        ).catch((recordErr: unknown) => {
          logger.warn({ error: getErrorMessage(recordErr) }, 'Failed to record skipped event in automation log');
        });
      }
      const saved = await persistRouteDecision({
        auditEvent,
        pendingEntry,
        reason: 'duplicate_delivery',
        normalizationStatus: 'duplicate',
        logger,
        decisionLatencyMs: Date.now() - authPassedAt.getTime(),
      });
      if (!saved) {
        return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
      }
      if (!triageHandoffSucceeded) {
        return {
          ok: false,
          reason: 'internal_error',
          message: 'Failed to hand off GitHub PR event for triage',
        };
      }
      return { ok: true, outcome: 'duplicate', message: 'duplicate' };
    }
    logger.error({ error: saveResult.error }, 'Failed to save GitHub PR event'); // @allow-result-access -- narrowed by !saveResult.ok
    /* v8 ignore start -- upstream: FakeFirestore PR events save never returns err() so this path is unreachable @preserve */
    if (parsedEvent.pullRequestNumber !== 0) {
    /* v8 ignore stop @preserve */
      void automationLog.record(
        { repository: parsedEvent.repository, prNumber: parsedEvent.pullRequestNumber },
        { type: 'skipped', decidedBy: 'webhook_route', reason: 'normalized_event_save_failed' },
      ).catch((recordErr: unknown) => {
        logger.warn({ error: getErrorMessage(recordErr) }, 'Failed to record skipped event in automation log');
      });
    }
    const saved = await persistRouteDecision({
      auditEvent,
      pendingEntry,
      reason: 'normalized_event_save_failed',
      normalizationStatus: 'failed',
      logger,
      decisionLatencyMs: Date.now() - authPassedAt.getTime(),
    });
    if (!saved) {
      return { ok: false, reason: 'internal_error', message: 'Failed to persist GitHub event decision' };
    }
    return { ok: false, reason: 'internal_error', message: 'Failed to save GitHub PR event' };
  }

  const savedEvent = saveResult.value; // @allow-result-access -- narrowed by !saveResult.ok above
  await updateAuditNormalizationStatus({
    auditEventId,
    normalizationStatus: 'normalized',
    logger,
  });

  if (parsedEvent.pullRequestNumber !== 0) {
    const summaryInput: UpsertGitHubPRSummaryInput = {
      repository: parsedEvent.repository,
      pullRequestNumber: parsedEvent.pullRequestNumber,
      lastActivityAt: parsedEvent.createdAt,
      firstSeenAt: parsedEvent.createdAt,
      ...(parsedEvent.eventType === 'pull_request' && {
        title: parsedEvent.title,
        state: parsedEvent.state,
        mergedAt: parsedEvent.mergedAt ?? null,
        baseBranch: parsedEvent.baseBranch,
        authorLogin: parsedEvent.prAuthorLogin,
        ...(parsedEvent.state === 'open' && { lastConflictCheckedAt: null }),
      }),
    };
    const summaryResult = await gitHubPRSummaryRepo.upsert(summaryInput);
    if (!summaryResult.ok) {
      logger.warn({ error: summaryResult.error.message }, 'Failed to upsert PR summary'); // @allow-result-access -- narrowed by !summaryResult.ok
    }
  }

  logger.info(
    {
      eventId: savedEvent.id,
      eventType: parsedEvent.eventType,
      repository: parsedEvent.repository,
      pullRequestNumber: parsedEvent.pullRequestNumber,
    },
    'GitHub PR event saved',
  );

  const triageHandoffSucceeded = await publishPRTriageWithFallback({
    eventId: savedEvent.id,
    repository: parsedEvent.repository,
    pullRequestNumber: parsedEvent.pullRequestNumber,
    auditEvent,
    pendingEntry,
    logger,
  });
  if (!triageHandoffSucceeded) {
    return {
      ok: false,
      reason: 'internal_error',
      message: 'Failed to hand off GitHub PR event for triage',
    };
  }

  if (parsedEvent.eventType === 'pull_request' && parsedEvent.action === 'closed') {
    const {
      codeTaskRepo,
      linearIssueService,
      userServiceClient: userServiceClientForClose,
      taskDispatcher,
      workerSettingsRepo,
      groupSummaryRepo,
    } = getServices();
    const closedAt = body.pull_request?.closed_at;
    void handlePrClose(
      {
        codeTaskRepo,
        linearIssueService,
        userServiceClient: userServiceClientForClose,
        taskDispatcher,
        workerSettingsRepo,
        groupSummaryRepo: groupSummaryRepo as NonNullable<typeof groupSummaryRepo>,
        logger,
      },
      {
        repository: parsedEvent.repository,
        prNumber: parsedEvent.pullRequestNumber,
        prBody: parsedEvent.body,
        prTitle: parsedEvent.title,
        prAuthorLogin: parsedEvent.prAuthorLogin,
        senderLogin: parsedEvent.senderLogin,
        isMerged: parsedEvent.mergedAt !== null,
        sourceTimestamp: resolvePrCloseSourceTimestamp({ closedAt, mergedAt: parsedEvent.mergedAt }),
      },
    ).catch((closeErr: unknown) => {
      logger.error({ closeErr }, 'Unhandled error in handlePrClose');
    });
  }

  if (parsedEvent.eventType === 'push') {
    const { mergeConflictDetector } = getServices();
    void mergeConflictDetector.detectOnPush(savedEvent, logger).catch((pushErr: unknown) => {
      logger.error({ pushErr }, 'Unhandled error in detectOnPush');
    });
  }

  return { ok: true, outcome: 'processed', message: 'processed' };
}
