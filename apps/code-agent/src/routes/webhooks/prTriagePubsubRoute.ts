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
 * - 200 on success, or when the eventId is not found, or when decoding fails
 *   (all three are "stop retrying" cases)
 * - 401 on auth failure
 * - 500 on Firestore / evaluator errors (triggers Pub/Sub retry, then DLQ)
 */
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import type { PRTriageEvent } from '@intexuraos/pr-triage-pubsub-client';
import { getServices } from '../../services.js';
import { authenticatePubSub, decodePubSubMessage } from './pubsubHelpers.js';

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

    const fetchResult = await gitHubPREventRepo.findById(eventId);
    if (!fetchResult.ok) {
      requestLogger.error(
        { error: fetchResult.error.message }, // @allow-result-access -- narrowed by !fetchResult.ok
        'Failed to load github-pr-events doc for triage'
      );
      return await reply.fail('INTERNAL_ERROR', 'firestore_unavailable');
    }

    const event = fetchResult.value; // @allow-result-access -- narrowed by !fetchResult.ok
    if (event === null) {
      requestLogger.warn('github-pr-events doc not found — acking to drop message');
      return await reply.ok({});
    }

    try {
      await unifiedEvaluator.evaluate(event, requestLogger);
      return await reply.ok({});
    } catch (evalErr: unknown) {
      requestLogger.error(
        { err: getErrorMessage(evalErr, 'unknown') },
        'unifiedEvaluator.evaluate threw — returning 5xx for Pub/Sub retry'
      );
      return await reply.fail('INTERNAL_ERROR', 'evaluator_failed');
    }
  });

  done();
};
