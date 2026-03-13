/**
 * Linear webhook routes.
 *
 * Handles incoming webhooks from Linear for issue synchronization.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { FastifySchema } from 'fastify';
import type { Logger } from 'pino';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

// Augment Fastify types to include rawBody for webhook signature validation
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }

  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}
import { validateLinearWebhookSignature } from '../infra/linearWebhookValidation.js';
import { syncSingleIssue, syncCommentFromWebhook, shouldTriggerCodeTask, triggerCodeTaskFromAssignment } from '../domain/index.js';
import type { LinearWebhookEvent, LinearCommentWebhookEvent, LinearWebhookUpdatedFrom } from '../domain/webhookTypes.js';

interface LinearWebhookBody {
  action: string;
  type: string;
  data:
    | {
        id: string;
        identifier: string;
        title: string;
        description: string | null;
        priority: number;
        url: string;
        createdAt: string;
        updatedAt: string;
        state: {
          id: string;
          name: string;
          type: string;
        };
        assignee: {
          id: string;
          name: string;
        } | null;
        labels: {
          id: string;
          name: string;
        }[];
        team: {
          id: string;
          key: string;
        };
      }
    | {
        id: string;
        issueId: string;
        issueIdentifier: string;
        user: {
          id: string;
          name: string;
        };
        body: string;
        createdAt: string;
        updatedAt: string;
      };
  updatedFrom?: LinearWebhookUpdatedFrom;
  webhookTimestamp: number;
  webhookId: string;
}

async function handleLinearWebhook(
  request: FastifyRequest<{ Body: LinearWebhookBody }>,
  reply: FastifyReply
): Promise<unknown> {
  logIncomingRequest(request);

  const services = getServices();

  // Extract data from webhook payload (untrusted at this point)
  const { data, action, type, webhookTimestamp, webhookId } = request.body;

  // Helper: Check if data is Issue type (has 'team' field)
  const isIssueData = (payload: typeof data): payload is {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    priority: number;
    url: string;
    createdAt: string;
    updatedAt: string;
    state: {
      id: string;
      name: string;
      type: string;
    };
    assignee: {
      id: string;
      name: string;
    } | null;
    labels: {
      id: string;
      name: string;
    }[];
    team: {
      id: string;
      key: string;
    };
  } => {
    return 'team' in payload && typeof (payload as Record<string, unknown>)['team'] === 'object';
  };

  // Helper: Check if data is Comment type (has 'issueId' field)
  const isCommentData = (payload: typeof data): payload is {
    id: string;
    issueId: string;
    issueIdentifier: string;
    user: {
      id: string;
      name: string;
    };
    body: string;
    createdAt: string;
    updatedAt: string;
  } => {
    return 'issueId' in payload && typeof (payload as Record<string, unknown>)['issueId'] === 'string';
  };

  // 1. For non-Issue and non-Comment events, skip processing early
  if (type !== 'Issue' && type !== 'Comment') {
    request.log.info({ type }, 'Ignoring non-Issue/non-Comment webhook event');
    return await reply.ok({ message: 'Ignored' });
  }

  // 2. Process based on event type
  if (isIssueData(data)) {
    // === ISSUE EVENT ===

    // Look up ALL user connections by team ID (fan-out to all team users)
    const teamId = data.team.id;
    const connectionResult = await services.connectionRepository.findUserIdsByTeamId(teamId);
    if (!connectionResult.ok) {
      request.log.error({ error: connectionResult.error, teamId }, 'Failed to lookup connections');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to lookup connection');
    }

    const userIds = connectionResult.value;
    if (userIds.length === 0) {
      request.log.warn({ teamId }, 'No connected users found for team');
      return await reply.ok({ message: 'Team not connected' });
    }

    // Validate webhook secret (any user's secret works — they share the same Linear webhook)
    const secretResult = await services.connectionRepository.findWebhookSecretByTeamId(teamId);
    if (!secretResult.ok) {
      request.log.error({ error: secretResult.error, teamId }, 'Failed to lookup webhook secret');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to lookup connection');
    }

    if (secretResult.value === null) {
      request.log.warn({ teamId }, 'Webhook secret not configured for team');
      return await reply.ok({ message: 'Webhook not configured' });
    }

    const { webhookSecret } = secretResult.value;

    const signatureResult = validateLinearWebhookSignature(request, webhookSecret);
    if (!signatureResult.ok) {
      request.log.warn({ error: signatureResult.error }, 'Linear webhook signature validation failed');
      reply.status(401);
      return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
    }

    // Build event once (shared across all users)
    const { updatedFrom } = request.body;
    const event: LinearWebhookEvent = {
      action: action as 'create' | 'update' | 'remove',
      type,
      data: {
        id: data.id,
        identifier: data.identifier,
        title: data.title,
        description: data.description,
        priority: data.priority,
        url: data.url,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        state: data.state,
        assignee: data.assignee,
        labels: data.labels,
        team: data.team,
      },
      ...(updatedFrom !== undefined && { updatedFrom }),
      webhookTimestamp,
      webhookId,
    };

    // Fan out sync to ALL connected users concurrently
    const syncResults = await Promise.allSettled(
      userIds.map((uid) =>
        syncSingleIssue(event, uid, {
          issueRepo: services.issueRepository,
          logger: request.log as unknown as Logger,
        })
      )
    );

    // Log per-user results, find first success for response
    let firstSuccessAction: string | null = null;
    let firstSuccessIssueId: string | null = null;
    for (let i = 0; i < syncResults.length; i++) {
      const result = syncResults[i];
      const uid = userIds[i];
      if (result === undefined || uid === undefined) continue;

      if (result.status === 'fulfilled' && result.value.ok) {
        request.log.info(
          { action: result.value.value.action, issueId: data.id, identifier: data.identifier, userId: uid }, // @allow-result-access -- guarded by result.value.ok
          'Issue synced from webhook'
        );
        if (firstSuccessAction === null) {
          firstSuccessAction = result.value.value.action; // @allow-result-access -- guarded by result.value.ok
          firstSuccessIssueId = result.value.value.issueId; // @allow-result-access -- guarded by result.value.ok
        }
      } else {
        const error = result.status === 'rejected' ? String(result.reason) : (result.value.ok ? '' : result.value.error);
        request.log.error({ error, issueId: data.id, userId: uid }, 'Failed to sync issue from webhook for user');
      }
    }

    if (firstSuccessAction === null) {
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to sync issue for all users');
    }

    // Trigger code task only for the first user (avoid duplicate tasks)
    if (shouldTriggerCodeTask(event)) {
      const firstUserId = userIds[0];
      if (firstUserId !== undefined) {
        void triggerCodeTaskFromAssignment(event, firstUserId, {
          codeAgentClient: services.codeAgentClient,
          logger: request.log as unknown as Logger,
        });
      }
    }

    return await reply.ok({
      message: 'Webhook processed',
      action: firstSuccessAction,
      issueId: firstSuccessIssueId,
    });
  } else if (isCommentData(data)) {
    // === COMMENT EVENT ===

    // Look up issue to get teamId for signature validation
    const issueResult = await services.issueRepository.findById(data.issueId);
    if (!issueResult.ok) {
      request.log.error({ error: issueResult.error, issueId: data.issueId }, 'Failed to lookup issue for comment');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to lookup issue');
    }

    const issue = issueResult.value;
    if (!issue) {
      request.log.warn({ issueId: data.issueId }, 'Issue not found for comment');
      return await reply.ok({ message: 'Issue not found' });
    }

    // Validate webhook signature using teamId from the issue
    if (issue.teamId === '') {
      // Issues synced before teamId was added have empty string — cannot validate signature
      request.log.warn({ issueId: data.issueId, commentId: data.id }, 'Comment webhook skipped: issue has no teamId for signature validation');
      return await reply.ok({ message: 'Webhook not configured', action: 'ignored' });
    }

    const secretResult = await services.connectionRepository.findWebhookSecretByTeamId(issue.teamId);
    if (!secretResult.ok) {
      request.log.error({ error: secretResult.error, teamId: issue.teamId }, 'Failed to lookup webhook secret for comment');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to lookup connection');
    }

    if (secretResult.value === null) {
      request.log.warn({ teamId: issue.teamId }, 'Webhook secret not configured for comment');
      return await reply.ok({ message: 'Webhook not configured', action: 'ignored' });
    }

    const { webhookSecret } = secretResult.value;
    const signatureResult = validateLinearWebhookSignature(request, webhookSecret);
    if (!signatureResult.ok) {
      request.log.warn({ error: signatureResult.error }, 'Comment webhook signature validation failed');
      reply.status(401);
      return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
    }

    // Find all users who have this issue synced
    const userIdsResult = await services.issueRepository.findUserIdsByIssueId(data.issueId);
    let commentUserId: string;
    if (userIdsResult.ok && userIdsResult.value.length > 0) {
      commentUserId = userIdsResult.value[0] ?? issue.userId; // noUncheckedIndexedAccess
    } else {
      if (!userIdsResult.ok) {
        request.log.warn({ error: userIdsResult.error, issueId: data.issueId }, 'Failed to find users by issue ID, falling back to issue.userId');
      }
      commentUserId = issue.userId;
    }

    // Process Comment webhook
    // Comments are stored by Linear UUID (not user-scoped), so syncing once is sufficient
    const commentEvent: LinearCommentWebhookEvent = {
      action: action as 'create' | 'update' | 'remove',
      type,
      data: {
        id: data.id,
        issueId: data.issueId,
        issueIdentifier: data.issueIdentifier,
        user: data.user,
        body: data.body,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      webhookTimestamp,
      webhookId,
    };

    const syncResult = await syncCommentFromWebhook(commentEvent, commentUserId, {
      commentRepo: services.commentRepository,
      logger: request.log as unknown as Logger,
    });

    if (!syncResult.ok) {
      request.log.error({ error: syncResult.error, commentId: data.id, userId: commentUserId }, 'Failed to sync comment from webhook');
      reply.status(500);
      return await reply.fail('INTERNAL_ERROR', 'Failed to sync comment');
    }

    request.log.info({ action: syncResult.value.action, commentId: data.id, issueId: data.issueId, userId: commentUserId }, 'Comment synced from webhook');

    return await reply.ok({
      message: 'Webhook processed',
      action: syncResult.value.action,
      commentId: syncResult.value.commentId,
    });
  }

  request.log.warn({ type }, 'Unknown webhook data structure');
  return await reply.ok({ message: 'Unknown data structure' });
}

const webhookSchema: FastifySchema = {
  description: 'Linear webhook endpoint for issue and comment synchronization',
  tags: ['webhooks'],
  headers: {
    type: 'object',
    properties: {
      'linear-signature': {
        type: 'string',
        description: 'Linear webhook signature for verification (HMAC-SHA256)',
      },
      'linear-delivery': {
        type: 'string',
        description: 'Unique delivery identifier for idempotency',
      },
    },
  },
  body: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      type: { type: 'string' },
      data: { type: 'object', description: 'Issue or Comment data (discriminated at runtime)' },
      webhookTimestamp: { type: 'number' },
      webhookId: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            action: { type: 'string', enum: ['created', 'updated', 'deleted', 'skipped'] },
            issueId: { type: 'string' },
            commentId: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
    401: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
    500: {
      type: 'object',
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
  },
};

export const linearWebhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: LinearWebhookBody }>(
    '/linear/webhook',
    {
      schema: webhookSchema,
      // Configure raw body parser for signature validation
      config: {
        rawBody: true,
      },
    },
    handleLinearWebhook
  );

  done();
};
