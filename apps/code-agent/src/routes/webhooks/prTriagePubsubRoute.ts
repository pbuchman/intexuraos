/**
 * POST /internal/code/pubsub/pr-triage
 *
 * Pub/Sub push target. The webhook handler at /webhooks/github publishes a
 * PRTriageEvent whenever it saves a github-pr-events record; this handler
 * receives the push, reloads the event from Firestore, and awaits
 * unifiedEvaluator.evaluate(...) to completion inside the request lifetime.
 *
 * Running inside an in-flight HTTP request guarantees Cloud Run keeps CPU
 * allocated for the full evaluation (cpu-throttling=true would otherwise
 * kill fire-and-forget work after the original webhook response).
 *
 * Return codes:
 * - 200 on success, completed redelivery, missing event, or decoding failure
 *   (these are all "stop retrying" cases)
 * - 401 on auth failure
 * - 500 on active lease, Firestore, evaluator, or completion errors
 *   (triggers Pub/Sub retry, then DLQ)
 */
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import type { PRTriageEvent } from '@intexuraos/pr-triage-pubsub-client';
import { getServices } from '../../services.js';
import { authenticatePubSub, decodePubSubMessage } from './pubsubHelpers.js';

const PR_TRIAGE_LEASE_DURATION_MS = 15 * 60 * 1000;

export const prTriagePubsubRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post('/internal/code/pubsub/pr-triage', async (request, reply) => {
    logIncomingRequest(request);

    const authed = await authenticatePubSub(request, reply);
    if (!authed) return;

    const decoded = decodePubSubMessage<PRTriageEvent>(request);
    if (decoded === null) {
      // Malformed message — ack to prevent infinite redelivery.
      return await reply.ok({});
    }

    const { eventId, correlationId, repository, pullRequestNumber } = decoded.data;
    const requestLogger = request.log.child({
      correlationId,
      eventId,
      repository,
      prNumber: pullRequestNumber,
      messageId: decoded.messageId,
    });

    const { gitHubPREventRepo, unifiedEvaluator } = getServices();

    const acquiredAt = new Date();
    const acquireResult = await gitHubPREventRepo.acquireTriage({
      eventId,
      leaseOwner: decoded.messageId,
      acquiredAt,
      leaseDurationMs: PR_TRIAGE_LEASE_DURATION_MS,
    });
    if (!acquireResult.ok) {
      requestLogger.error(
        { error: acquireResult.error.message }, // @allow-result-access -- narrowed by !acquireResult.ok
        'Failed to acquire github-pr-events triage lease'
      );
      return await reply.fail('INTERNAL_ERROR', 'firestore_unavailable');
    }

    const acquisition = acquireResult.value; // @allow-result-access -- narrowed by !acquireResult.ok
    if (acquisition.kind === 'not_found') {
      requestLogger.warn('github-pr-events doc not found — acking to drop message');
      return await reply.ok({});
    }
    if (acquisition.kind === 'completed') {
      requestLogger.debug('PR triage already completed — acking redelivery');
      return await reply.ok({});
    }
    if (acquisition.kind === 'busy') {
      requestLogger.warn('PR triage lease is active — returning 5xx for Pub/Sub retry');
      return await reply.fail('INTERNAL_ERROR', 'triage_busy');
    }

    try {
      await unifiedEvaluator.evaluate(acquisition.event, requestLogger);
      const completeResult = await gitHubPREventRepo.completeTriage({
        eventId,
        leaseToken: acquisition.leaseToken,
        completedAt: new Date(),
      });
      if (!completeResult.ok) {
        requestLogger.error(
          { error: completeResult.error.message }, // @allow-result-access -- narrowed by !completeResult.ok
          'Failed to complete github-pr-events triage lease'
        );
        return await reply.fail('INTERNAL_ERROR', 'triage_completion_failed');
      }
      return await reply.ok({});
    } catch (evalErr: unknown) {
      const failureMessage = getErrorMessage(evalErr, 'unknown');
      const failResult = await gitHubPREventRepo.failTriage({
        eventId,
        leaseToken: acquisition.leaseToken,
        failedAt: new Date(),
        reason: failureMessage,
      });
      if (!failResult.ok) {
        requestLogger.error(
          { error: failResult.error.message }, // @allow-result-access -- narrowed by !failResult.ok
          'Failed to release github-pr-events triage lease after evaluator error'
        );
      }
      requestLogger.error(
        { err: failureMessage },
        'unifiedEvaluator.evaluate threw — returning 5xx for Pub/Sub retry'
      );
      return await reply.fail('INTERNAL_ERROR', 'evaluator_failed');
    }
  });

  done();
};
