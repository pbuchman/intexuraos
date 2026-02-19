/**
 * Linear webhook routes for agent session events.
 *
 * Handles webhooks from Linear when issues are delegated to IntexuraOS:
 * - POST /webhooks/linear → Validate signature, handle agent session events
 *
 * Flow: Linear delegation → webhook → validate → emit thought → dispatch task
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { loadConfig } from '../config.js';
import {
  validateLinearWebhookSignature,
  validateWebhookTimestamp,
} from '../infra/linearWebhookValidation.js';

const WEBHOOK_IDS_COLLECTION = 'linear_webhook_ids';
const WEBHOOK_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Webhook payload types from Linear.
 */
interface LinearWebhookPayload {
  action: string;
  type: string;
  createdAt: string;
  webhookTimestamp?: number;
  webhookId?: string;
  data?: {
    id?: string;
    issueId?: string;
    agentSession?: {
      id?: string;
    };
  };
  /** Formatted context string from Linear with issue details */
  promptContext?: string;
  /** User message body for 'prompted' events */
  agentActivity?: {
    body?: string;
  };
}

export const linearWebhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Register raw body capture for signature validation
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, contentDone) => {
      // Store raw body for signature validation, then parse JSON
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        const parsed: unknown = JSON.parse(body as string);
        contentDone(null, parsed);
      } catch (error) {
        contentDone(error as Error, undefined);
      }
    }
  );

  // POST /webhooks/linear - Handle Linear webhook events
  fastify.post<{
    Body: LinearWebhookPayload;
  }>(
    '/webhooks/linear',
    {
      schema: {
        operationId: 'linearWebhook',
        summary: 'Handle Linear webhook events',
        description: 'Receives AgentSessionEvent webhooks when issues are delegated to IntexuraOS.',
        tags: ['webhooks', 'linear'],
        body: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            type: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Webhook processed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  received: { type: 'boolean', enum: [true] },
                },
                required: ['received'],
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LinearWebhookPayload }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /webhooks/linear',
      });

      const { logger, linearOAuthRepo, linearActivityReporter, firestore } = getServices();

      // Step 1: Validate signature
      const signature = request.headers['linear-signature'];

      if (signature === undefined) {
        return await reply.fail('UNAUTHORIZED', 'Missing Linear-Signature header');
      }

      const config = loadConfig();
      const rawBody = (request as unknown as { rawBody: string }).rawBody;

      /* v8 ignore start -- test-infra: Fastify inject always sends headers as strings, cannot produce array @preserve */
      const signatureStr = Array.isArray(signature) ? signature[0] ?? '' : signature;
      /* v8 ignore stop @preserve */
      const isValid = validateLinearWebhookSignature(
        rawBody,
        signatureStr,
        config.linearWebhookSecret
      );

      if (!isValid) {
        logger.warn('Linear webhook signature validation failed');
        return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
      }

      // Step 2: Validate timestamp (replay protection) — mandatory
      const body = request.body;
      if (body.webhookTimestamp === undefined) {
        logger.warn('Linear webhook missing webhookTimestamp');
        return await reply.fail('INVALID_REQUEST', 'Missing webhook timestamp');
      }
      if (!validateWebhookTimestamp(body.webhookTimestamp)) {
        logger.warn(
          { webhookTimestamp: body.webhookTimestamp },
          'Linear webhook timestamp outside acceptable window'
        );
        return await reply.fail('INVALID_REQUEST', 'Webhook timestamp outside acceptable window');
      }

      // Step 3: Check idempotency via Firestore
      const webhookId = body.webhookId ?? body.data?.id;
      if (webhookId !== undefined) {
        const idDoc = await firestore.collection(WEBHOOK_IDS_COLLECTION).doc(webhookId).get();
        if (idDoc.exists) {
          logger.info({ webhookId }, 'Duplicate Linear webhook, skipping');
          return await reply.ok({ received: true });
        }
        const now = Date.now();
        await firestore.collection(WEBHOOK_IDS_COLLECTION).doc(webhookId).set({
          processedAt: now,
          expiresAt: now + WEBHOOK_ID_TTL_MS,
        });
      }

      // Step 4: Handle event types
      const { action, type } = body;

      logger.info(
        { action, type, webhookId, hasPromptContext: body.promptContext !== undefined },
        'Processing Linear webhook event'
      );

      // Only handle AgentSessionEvent types
      if (type !== 'AgentSessionEvent') {
        logger.info({ type }, 'Ignoring non-agent-session webhook event');
        return await reply.ok({ received: true });
      }

      const sessionId = body.data?.agentSession?.id;
      const issueId = body.data?.issueId;

      if (action === 'created') {
        // Step 5: Handle delegation (AgentSessionEvent.created)

        if (sessionId === undefined) {
          logger.warn('AgentSessionEvent.created missing session ID');
          return await reply.fail('INVALID_REQUEST', 'Missing agent session ID');
        }

        // Emit thought activity immediately (< 10 sec requirement)
        await linearActivityReporter.reportEvent({
          type: 'task_dispatched',
          sessionId,
        });

        // Extract issue context
        if (issueId === undefined) {
          logger.warn({ sessionId }, 'AgentSessionEvent.created missing issue ID');
          return await reply.fail('INVALID_REQUEST', 'Missing issue ID');
        }

        // Verify we have OAuth credentials (distinguish Firestore error from missing)
        const credResult = await linearOAuthRepo.get('default');
        if (!credResult.ok) {
          logger.error(
            { error: credResult.error },
            'Failed to look up Linear OAuth credentials'
          );
          return await reply.fail('INTERNAL_ERROR', 'Failed to verify Linear installation');
        }
        if (credResult.value === null) {
          logger.warn('No Linear OAuth credentials found, cannot process delegation');
          return await reply.fail('UNAUTHORIZED', 'Linear app not installed');
        }

        // Dispatch to existing processCodeAction infrastructure (async)
        // This reuses ALL existing infrastructure: dedup, Firestore task, orchestrator dispatch
        logger.info(
          { issueId, sessionId, promptContext: body.promptContext?.slice(0, 200) },
          'Linear delegation: dispatching code task'
        );

        // Fire-and-forget: dispatch in background
        const { codeTaskRepo, taskDispatcher, linearIssueService, whatsappNotifier, metricsClient, workerSettingsRepo } = getServices();

        // We need to import processCodeAction dynamically to avoid circular deps
        const { processCodeAction } = await import('../domain/usecases/processCodeAction.js');

        const dispatchResult = await processCodeAction(
          {
            logger,
            codeTaskRepo,
            taskDispatcher,
            linearIssueService,
            whatsappNotifier,
            metricsClient,
            workerSettingsRepo,
            orchestratorSecret: config.orchestratorSecret,
          },
          {
            actionId: `linear-session-${sessionId}`,
            approvalEventId: `linear-webhook-${webhookId ?? sessionId}`,
            userId: credResult.value.installedBy,
            prompt: body.promptContext ?? `Work on Linear issue ${issueId}`,
            workerType: 'auto',
            linearIssueId: issueId,
            source: 'web',
          }
        );

        if (!dispatchResult.ok) {
          logger.error(
            { issueId, sessionId, error: dispatchResult.error },
            'Failed to dispatch code task from Linear delegation'
          );

          // Report error to Linear session
          await linearActivityReporter.reportEvent({
            type: 'task_error',
            sessionId,
            details: `Failed to dispatch: ${dispatchResult.error.message}`,
          });

          return await reply.fail('INTERNAL_ERROR', 'Failed to dispatch code task');
        }

        logger.info(
          { issueId, sessionId, codeTaskId: dispatchResult.value.codeTaskId },
          'Code task dispatched from Linear delegation'
        );

        return await reply.ok({ received: true });
      }

      if (action === 'prompted') {
        // Handle follow-up user messages
        const userMessage = body.agentActivity?.body;
        logger.info(
          { sessionId, userMessage: userMessage?.slice(0, 200) },
          'Linear agent prompted (follow-up message received, logging for now)'
        );

        return await reply.ok({ received: true });
      }

      // Unknown action - acknowledge anyway
      logger.info({ action, type }, 'Unhandled Linear webhook action');
      return await reply.ok({ received: true });
    }
  );

  done();
};
