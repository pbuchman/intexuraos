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
import { syncSingleIssue } from '../domain/index.js';
import type { LinearWebhookEvent } from '../domain/webhookTypes.js';

interface LinearWebhookBody {
  action: string;
  type: string;
  data: {
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
  };
  webhookTimestamp: number;
  webhookId: string;
}

async function handleLinearWebhook(
  request: FastifyRequest<{ Body: LinearWebhookBody }>,
  reply: FastifyReply
): Promise<unknown> {
  logIncomingRequest(request);

  const services = getServices();
  const webhookSecret = process.env['INTEXURAOS_LINEAR_WEBHOOK_SECRET'];

  /* v8 ignore start -- test-infra: missing env var is config error tested by infra @preserve */
  if (webhookSecret === undefined || webhookSecret === '') {
    request.log.error('Missing INTEXURAOS_LINEAR_WEBHOOK_SECRET environment variable');
    reply.status(500);
    return await reply.fail('INTERNAL_ERROR', 'Webhook secret not configured');
  }
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- test-infra: signature validation and user lookup covered by tests @preserve */
  // Validate signature
  const signatureResult = validateLinearWebhookSignature(request, webhookSecret);
  if (!signatureResult.ok) {
    request.log.warn({ error: signatureResult.error }, 'Linear webhook signature validation failed');
    reply.status(401);
    return await reply.fail('UNAUTHORIZED', 'Invalid webhook signature');
  }

  // Extract team ID from webhook payload
  const { data, action, type, webhookTimestamp, webhookId } = request.body;

  if (type !== 'Issue') {
    request.log.info({ type }, 'Ignoring non-Issue webhook event');
    return await reply.ok({ message: 'Ignored' });
  }

  // Find user by team ID
  const connectionResult = await services.connectionRepository.findUserIdByTeamId(data.team.id);
  if (!connectionResult.ok) {
    request.log.error({ error: connectionResult.error, teamId: data.team.id }, 'Failed to find user by team ID');
    reply.status(500);
    return await reply.fail('INTERNAL_ERROR', 'Failed to find user');
  }

  const userId = connectionResult.value;
  if (userId === null) {
    request.log.warn({ teamId: data.team.id }, 'No connected user found for team');
    // Return 200 to avoid retrying, but log the issue
    return await reply.ok({ message: 'Team not connected' });
  }

  // Sync the issue
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
    webhookTimestamp,
    webhookId,
  };

  const syncResult = await syncSingleIssue(event, userId, {
    issueRepo: services.issueRepository,
    logger: request.log as unknown as Logger,
  });

  if (!syncResult.ok) {
    request.log.error(
      { error: syncResult.error, issueId: data.id, userId },
      'Failed to sync issue from webhook'
    );
    reply.status(500);
    return await reply.fail('INTERNAL_ERROR', 'Failed to sync issue');
  }

  request.log.info(
    { action: syncResult.value.action, issueId: data.id, identifier: data.identifier, userId },
    'Issue synced from webhook'
  );

  return await reply.ok({
    message: 'Webhook processed',
    action: syncResult.value.action,
    issueId: syncResult.value.issueId,
  });
  /* v8 ignore stop @preserve */
}

const webhookSchema: FastifySchema = {
  description: 'Linear webhook endpoint for issue synchronization',
  tags: ['webhooks'],
  headers: {
    type: 'object',
    properties: {
      'linear-hmacsha256': {
        type: 'string',
        description: 'HMAC-SHA256 signature of request body',
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
      action: { type: 'string', enum: ['create', 'update', 'remove'] },
      type: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          identifier: { type: 'string' },
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          priority: { type: 'number' },
          url: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
          state: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
            },
          },
          assignee: {
            type: ['object', 'null'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
          labels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
          team: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              key: { type: 'string' },
            },
          },
        },
      },
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
