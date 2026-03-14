/**
 * GitHub webhook route handler.
 *
 * Receives GitHub webhook events for pull requests.
 * Validates signatures using HMAC-SHA256.
 * Stores events in Firestore for historical queries.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getErrorMessage } from '@intexuraos/common-core';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { verifyGitHubSignature } from '../../infra/github-webhook-auth.js';
import { loadConfig } from '../../config.js';
import {
  parseGitHubWebhookEvent,
} from '../../infra/github-event-parser.js';
import type { CreateGitHubPREventInput } from '../../domain/models/gitHubPREvent.js';
import type { UpsertGitHubPRSummaryInput } from '../../domain/models/gitHubPRSummary.js';
import {
  toGitHubWebhookAction,
  toGitHubWebhookEventType,
} from '../../domain/models/gitHubWebhookTypes.js';
import type {
  GitHubWebhookAuditEvent,
  GitHubWebhookNormalizationStatus,
} from '../../domain/models/gitHubWebhookAuditEvent.js';
import type { GitHubEventLogEntry } from '../../domain/models/gitHubEventLogEntry.js';

export const ALLOWED_BOTS = new Set([
  'claude[bot]',
  'chatgpt-codex-connector[bot]',
  'intexuraos-code-worker[bot]',
]);

export const CODE_WORKER_BOTS = new Set([
  'intexuraos-code-worker[bot]',
]);

export interface GitHubWebhookHeaders {
  'x-hub-signature-256': string;
  'x-github-event': string;
}

export interface GitHubWebhookBody {
  action?: string;
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
  };
  pull_request?: {
    id: number;
    number: number;
    title?: string;
    body?: string | null;
    state?: string;
    merged_at?: string | null;
  };
  sender?: {
    login: string;
    id: number;
    type?: string;
  };
}

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
  logger: ReturnType<typeof getServices>['logger'];
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
      'Failed to save route-level GitHub event decision'
    );
    return false;
  }

  if (gitHubEventLogEntryRepo === undefined) {
    input.logger.error({ eventId: input.auditEvent.id }, 'GitHub event log entry repository not configured');
    return false;
  }

  const completeResult = await gitHubEventLogEntryRepo.complete({
    id: input.pendingEntry.id,
    decisionId: decisionResult.value.id,
    decisionState: 'completed',
    decisionOutcome: 'skip',
    updatedAt: new Date(),
    rowVersion: input.pendingEntry.rowVersion + 1,
  });

  if (!completeResult.ok) {
    input.logger.error(
      { error: completeResult.error, eventId: input.auditEvent.id, reason: input.reason },
      'Failed to complete GitHub event log entry'
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
        'Failed to update GitHub webhook audit normalization status'
      );
    }
  }

  return true;
}

async function updateAuditNormalizationStatus(input: {
  auditEventId: string;
  normalizationStatus: GitHubWebhookNormalizationStatus;
  logger: ReturnType<typeof getServices>['logger'];
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
      'Failed to update GitHub webhook audit normalization status'
    );
  }
}

async function ensureDecisionAfterEvaluationFailure(input: {
  auditEvent: GitHubWebhookAuditEvent;
  pendingEntry: GitHubEventLogEntry;
  logger: ReturnType<typeof getServices>['logger'];
  errorMessage: string;
}): Promise<void> {
  const { eventDecisionRepo } = getServices();

  try {
    /* v8 ignore start -- async-timing: detached unifiedEvaluator catch runs after the response lifecycle and coverage does not attribute this guarded fallback branch @preserve */
    if (eventDecisionRepo.findByEventIds !== undefined) {
      const existingResult = await eventDecisionRepo.findByEventIds([input.auditEvent.id]);
      if (existingResult.ok && existingResult.value.length > 0) {
        return;
      }
    }
    /* v8 ignore stop @preserve */

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
      'Failed to persist fallback decision after evaluation failure'
    );
  }
}

export const githubWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /webhooks/github - Receive GitHub webhook events
  fastify.post<{
    Headers: GitHubWebhookHeaders;
    Body: GitHubWebhookBody;
  }>(
    '/webhooks/github',
    {
      schema: {
        operationId: 'githubWebhook',
        summary: 'Receive GitHub webhook events',
        description: 'Receives and processes GitHub webhook events for pull requests. Requires HMAC-SHA256 signature.',
        tags: ['webhooks', 'github'],
        response: {
          200: {
            description: 'Event processed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
              },
            },
          },
          401: {
            description: 'Invalid signature',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Headers: GitHubWebhookHeaders; Body: GitHubWebhookBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received GitHub webhook event',
      });

      // Get GitHub webhook secret from config
      const config = loadConfig();
      const {
        gitHubPREventRepo,
        gitHubPRSummaryRepo,
        gitHubWebhookAuditEventRepo,
        gitHubEventLogEntryRepo,
        logger,
      } = getServices();

      const signatureHeader = request.headers['x-hub-signature-256'];
      const eventType = request.headers['x-github-event'];
      const deliveryId = request.headers['x-github-delivery'];

      // Get raw request body for signature verification
      // Fastify parses JSON, so we need to get the raw body
      const rawBody = Buffer.from(JSON.stringify(request.body), 'utf-8');

      // Verify signature
      if (!signatureHeader || !verifyGitHubSignature(rawBody, signatureHeader, config.githubWebhookSecret)) {
        // Log only the first 20 chars of signature for security (or undefined if missing)
        const sigPreview = signatureHeader ? signatureHeader.slice(0, 20) : undefined;
        logger.warn({ signature: sigPreview }, 'Invalid GitHub webhook signature');
        return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
      }

      logger.debug(
        { eventType, hasSignature: !!signatureHeader },
        'GitHub webhook signature verified'
      );

      if (gitHubWebhookAuditEventRepo === undefined || gitHubEventLogEntryRepo === undefined) {
        logger.error('GitHub webhook audit repositories are not configured');
        return await reply.fail('INTERNAL_ERROR', 'GitHub event logging is not configured');
      }

      const authPassedAt = new Date();
      const webhookEventType = toGitHubWebhookEventType(eventType);
      const webhookAction = toGitHubWebhookAction(request.body.action);
      const repositoryDetails = extractRepositoryDetails(request.body);
      const pullRequestDetails = extractPullRequestDetails(request.body);
      const senderDetails = extractSenderDetails(request.body);

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
        payload: request.body,
      });

      if (!auditResult.ok) {
        logger.error({ error: auditResult.error }, 'Failed to save auth-passed GitHub audit event');
        return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event audit');
      }

      const pendingLogEntryResult = await gitHubEventLogEntryRepo.createPending({
        id: auditResult.value.id,
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
        return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event log entry');
      }

      // Handle ping event (GitHub test)
      if (eventType === 'ping') {
        logger.info('Received GitHub ping event');
        const saved = await persistRouteDecision({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          reason: 'ping_event',
          normalizationStatus: 'ignored',
          logger,
          decisionLatencyMs: Date.now() - authPassedAt.getTime(),
        });
        if (!saved) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
        }
        return await reply.ok({ message: 'pong' });
      }

      // Parse the event
      const parseResult = parseGitHubWebhookEvent(eventType, request.body);

      if (!parseResult.ok) {
        logger.warn({ error: parseResult.error }, 'Failed to parse GitHub webhook event'); // @allow-result-access -- narrowed by !parseResult.ok
        const saved = await persistRouteDecision({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          reason: 'invalid_payload',
          normalizationStatus: 'invalid',
          logger,
          decisionLatencyMs: Date.now() - authPassedAt.getTime(),
        });
        if (!saved) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
        }
        return await reply.ok({ message: 'acknowledged' });
      }

      const parsedEvent = parseResult.value; // @allow-result-access -- narrowed by !parseResult.ok

      // Null means event type is not stored (e.g., unknown events)
      if (parsedEvent === null) {
        logger.info({ eventType }, 'Unhandled GitHub event type, acknowledging');
        const saved = await persistRouteDecision({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          reason: 'unsupported_event',
          normalizationStatus: 'unsupported',
          logger,
          decisionLatencyMs: Date.now() - authPassedAt.getTime(),
        });
        if (!saved) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
        }
        return await reply.ok({ message: 'acknowledged' });
      }

      if (!shouldProcessNormalizedRepository(parsedEvent.repository)) {
        logger.info(
          { repository: parsedEvent.repository },
          'Ignoring event from non-IntexuraOS repository'
        );
        const saved = await persistRouteDecision({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          reason: 'repository_out_of_scope',
          normalizationStatus: 'ignored',
          logger,
          decisionLatencyMs: Date.now() - authPassedAt.getTime(),
        });
        if (!saved) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
        }
        return await reply.ok({ message: 'ignored' });
      }

      // Enrich with X-GitHub-Delivery header for deduplication
      const eventWithDeliveryId: CreateGitHubPREventInput = {
        ...parsedEvent,
        auditEventId: auditResult.value.id,
        deliveryId: typeof deliveryId === 'string' ? deliveryId : null,
      };

      // Save to Firestore
      const saveResult = await gitHubPREventRepo.save(eventWithDeliveryId);

      if (!saveResult.ok) {
        if (saveResult.error.code === 'DUPLICATE_EVENT') { // @allow-result-access -- narrowed by !saveResult.ok
          logger.debug({ deliveryId }, 'Duplicate webhook delivery, skipping evaluation');
          const saved = await persistRouteDecision({
            auditEvent: auditResult.value,
            pendingEntry: pendingLogEntryResult.value,
            reason: 'duplicate_delivery',
            normalizationStatus: 'duplicate',
            logger,
            decisionLatencyMs: Date.now() - authPassedAt.getTime(),
          });
          if (!saved) {
            return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
          }
          return await reply.ok({ message: 'duplicate' });
        }
        logger.error({ error: saveResult.error }, 'Failed to save GitHub PR event'); // @allow-result-access -- narrowed by !saveResult.ok
        const saved = await persistRouteDecision({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          reason: 'normalized_event_save_failed',
          normalizationStatus: 'failed',
          logger,
          decisionLatencyMs: Date.now() - authPassedAt.getTime(),
        });
        if (!saved) {
          return await reply.fail('INTERNAL_ERROR', 'Failed to persist GitHub event decision');
        }
        return await reply.ok({ message: 'acknowledged' });
      }

      const savedEvent = saveResult.value; // @allow-result-access -- narrowed by !saveResult.ok above
      await updateAuditNormalizationStatus({
        auditEventId: auditResult.value.id,
        normalizationStatus: 'normalized',
        logger,
      });

      // Upsert PR summary — skip push/ping events (pullRequestNumber === 0)
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
        'GitHub PR event saved'
      );

      const { unifiedEvaluator, mergeConflictDetector } = getServices();
      if (parsedEvent.eventType === 'push' && mergeConflictDetector !== undefined) {
        void mergeConflictDetector.detectOnPush(savedEvent, logger).catch((detectErr: unknown) => {
          logger.error({ error: getErrorMessage(detectErr) }, 'Unhandled error in merge conflict detector');
        });
      }

      // INT-744: Unified evaluation — hard rules + optional LLM triage
      void unifiedEvaluator.evaluate(savedEvent, logger).catch((evalErr: unknown) => {
        logger.error({ evalErr }, 'Unhandled error in unified evaluator');
        void ensureDecisionAfterEvaluationFailure({
          auditEvent: auditResult.value,
          pendingEntry: pendingLogEntryResult.value,
          logger,
          errorMessage: getErrorMessage(evalErr, 'unknown_evaluation_error'),
        });
      });

      return await reply.ok({ message: 'processed' });
    }
  );

  done();
};
