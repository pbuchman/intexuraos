import type { FastifyPluginAsync } from 'fastify';
import {
  authenticateInternalPubSub,
  authenticateInternalScheduler,
  logIncomingRequest,
  validateInternalAuth,
} from '@intexuraos/common-http';
import {
  acquireMessageDigestDeliveryAuthorization,
  releaseMessageDigestDeliveryAuthorization,
} from '../domain/usecases/authorizeMessageDigestDelivery.js';
import { dispatchMessageDigestOutbox } from '../domain/usecases/dispatchMessageDigestOutbox.js';
import { processMessageDigestRun } from '../domain/usecases/processMessageDigestRun.js';
import { reconcileMessageDigestDelivery } from '../domain/usecases/reconcileMessageDigestDelivery.js';
import { getMessageDigest } from '../domain/usecases/queryMessageDigests.js';
import { tickMessageDigestScheduler } from '../domain/usecases/tickMessageDigestScheduler.js';
import { formatWhatsAppDigest } from '../infra/notification/formatWhatsAppDigest.js';
import { getServices } from '../services.js';
import { messageDigestResponseSchema } from './messageDigestSchemas.js';

interface SchedulerTickBody {
  limit?: number | undefined;
  cursor?: string | undefined;
}

interface PubSubPushBody {
  message: {
    data: string;
    messageId: string;
    message_id?: string | undefined;
    publishTime: string;
    publish_time?: string | undefined;
    attributes?: Record<string, string> | undefined;
    orderingKey?: string | undefined;
  };
  subscription: string;
  deliveryAttempt?: number | undefined;
}

interface MessageDigestRunRequest {
  type: 'message-digest.run';
  version: 1;
  userId: string;
  definitionId: string;
  runId: string;
  requestedAt: string;
}

interface DeliveryAuthorizationBody {
  userId: string;
  definitionId: string;
  runId: string;
  idempotencyKey: string;
  payloadDigest: string;
  ownerDigest: string;
}

interface DeliveryAuthorizationReleaseBody extends DeliveryAuthorizationBody {
  fence: number;
}

interface CutoverListCheckBody {
  ownerUserId: string;
  foreignUserId: string;
  definitionId: string;
}

const DELIVERY_AUTHORIZATION_CALLER_ROLE = 'whatsapp_message_digest_delivery';
const CUTOVER_VERIFIER_CALLER_ROLE = 'message_digest_cutover_verifier';

const schedulerTickBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    cursor: { type: 'string', minLength: 1, maxLength: 4_096 },
  },
} as const;

const pubsubPushBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'subscription'],
  properties: {
    message: {
      type: 'object',
      additionalProperties: true,
      required: ['data', 'messageId', 'publishTime'],
      properties: {
        data: { type: 'string', minLength: 4, maxLength: 400_000 },
        messageId: { type: 'string', minLength: 1, maxLength: 256 },
        publishTime: { type: 'string', format: 'date-time' },
        attributes: {
          type: 'object',
          maxProperties: 100,
          propertyNames: { type: 'string', minLength: 1, maxLength: 256 },
          additionalProperties: { type: 'string', maxLength: 1_024 },
        },
        orderingKey: { type: 'string', maxLength: 1_024 },
      },
    },
    subscription: { type: 'string', minLength: 1, maxLength: 1_024 },
    deliveryAttempt: { type: 'integer', minimum: 0 },
  },
} as const;

const deliveryAuthorizationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'userId',
    'definitionId',
    'runId',
    'idempotencyKey',
    'payloadDigest',
    'ownerDigest',
  ],
  properties: {
    userId: { type: 'string', minLength: 1, maxLength: 256 },
    definitionId: { type: 'string', pattern: '^md_[A-Za-z0-9_-]{3,120}$' },
    runId: { type: 'string', pattern: '^mdr_[A-Za-z0-9_-]{3,160}$' },
    idempotencyKey: {
      type: 'string',
      pattern: '^message-digest:mdr_[A-Za-z0-9_-]{3,160}$',
      maxLength: 256,
    },
    payloadDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    ownerDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
} as const;

const deliveryAuthorizationReleaseBodySchema = {
  ...deliveryAuthorizationBodySchema,
  required: [...deliveryAuthorizationBodySchema.required, 'fence'],
  properties: {
    ...deliveryAuthorizationBodySchema.properties,
    fence: { type: 'integer', minimum: 1 },
  },
} as const;

const cutoverListCheckBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ownerUserId', 'foreignUserId', 'definitionId'],
  properties: {
    ownerUserId: { type: 'string', minLength: 1, maxLength: 256 },
    foreignUserId: { type: 'string', minLength: 1, maxLength: 256 },
    definitionId: {
      type: 'string',
      minLength: 6,
      maxLength: 128,
      pattern: '^md_[A-Za-z0-9_-]{3,120}$',
    },
  },
} as const;

export const internalMessageDigestRoutes: FastifyPluginAsync = (app) => {
  app.post<{ Body: CutoverListCheckBody }>(
    '/internal/message-digests/cutover/check',
    {
      schema: {
        operationId: 'checkMessageDigestCutoverVisibility',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: cutoverListCheckBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Message Digest cutover visibility check',
        bodyPreviewLength: 0,
        includeHeaders: false,
        includeParams: false,
      });
      if (!isCaller(request, CUTOVER_VERIFIER_CALLER_ROLE)) {
        return await reply.fail('UNAUTHORIZED', 'Message Digest cutover authentication failed');
      }
      if (request.body.ownerUserId.trim() === request.body.foreignUserId.trim()) {
        return await reply.fail('INVALID_REQUEST', 'Invalid Message Digest cutover check');
      }
      try {
        const store = getServices().messageDigestStore;
        const [owner, foreign] = await Promise.all([
          getMessageDigest(
            {
              userId: request.body.ownerUserId,
              definitionId: request.body.definitionId,
            },
            { store }
          ),
          getMessageDigest(
            {
              userId: request.body.foreignUserId,
              definitionId: request.body.definitionId,
            },
            { store }
          ),
        ]);
        return await reply.ok({
          ownerDefinitionVisible: owner.ok,
          foreignDefinitionVisible: foreign.ok,
        });
      } catch {
        return await reply.fail(
          'SERVICE_UNAVAILABLE',
          'Message Digest cutover check is unavailable'
        );
      }
    }
  );

  app.post<{ Body: SchedulerTickBody }>(
    '/internal/message-digests/scheduler/tick',
    {
      schema: {
        operationId: 'tickMessageDigestScheduler',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: schedulerTickBodySchema,
        response: messageDigestResponseSchema(),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Message Digest scheduler tick',
        bodyPreviewLength: 0,
      });
      if (!authenticateInternalScheduler(request).authenticated) {
        return await reply.fail('UNAUTHORIZED', 'Message Digest scheduler authentication failed');
      }
      const services = getServices();
      const workerId = `scheduler:${request.id}`;
      try {
        const result = await tickMessageDigestScheduler(
          {
            workerId,
            limit: request.body.limit as number,
            ...(request.body.cursor === undefined ? {} : { cursor: request.body.cursor }),
          },
          {
            store: services.messageDigestStore,
            whatsappClient: services.messageDigestWhatsAppClient,
            dispatchOutbox: async (outboxId) =>
              await dispatchMessageDigestOutbox(
                { outboxId, workerId },
                {
                  store: services.messageDigestStore,
                  runRequestPublisher: services.messageDigestRunPublisher,
                  whatsappPublisher: services.whatsappSendPublisher,
                }
              ),
            reconcileDelivery: async (input) =>
              await reconcileMessageDigestDelivery(input, {
                store: services.messageDigestStore,
                whatsappClient: services.messageDigestWhatsAppClient,
              }),
          }
        );
        if (!result.ok) {
          return await reply.fail('INVALID_REQUEST', 'Invalid Message Digest scheduler tick');
        }
        return await reply.ok(result);
      } catch {
        return await reply.fail('SERVICE_UNAVAILABLE', 'Message Digest scheduler retry required');
      }
    }
  );

  app.post<{ Body: DeliveryAuthorizationBody }>(
    '/internal/message-digests/delivery-authorizations/acquire',
    {
      schema: {
        operationId: 'acquireMessageDigestDeliveryAuthorization',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: deliveryAuthorizationBodySchema,
        response: {
          ...messageDigestResponseSchema(),
          503: errorResponseSchema('Message Digest delivery authorization is temporarily busy'),
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Message Digest delivery authorization request',
        bodyPreviewLength: 0,
      });
      if (!isDeliveryAuthorizationCaller(request)) {
        return await reply.fail(
          'UNAUTHORIZED',
          'Message Digest delivery authorization failed'
        );
      }
      try {
        const result = await acquireMessageDigestDeliveryAuthorization(request.body, {
          store: getServices().messageDigestStore,
        });
        if (!result.ok) {
          return await reply.fail('INVALID_REQUEST', 'Invalid delivery authorization request');
        }
        if (result.disposition === 'busy') {
          return await reply.fail(
            'SERVICE_UNAVAILABLE',
            'Message Digest delivery authorization is temporarily busy'
          );
        }
        return await reply.ok(
          result.disposition === 'authorized'
            ? {
                disposition: result.disposition,
                fence: result.fence,
                expiresAt: result.expiresAt,
              }
            : { disposition: result.disposition }
        );
      } catch {
        return await reply.fail(
          'SERVICE_UNAVAILABLE',
          'Message Digest delivery authorization is temporarily unavailable'
        );
      }
    }
  );

  app.post<{ Body: DeliveryAuthorizationReleaseBody }>(
    '/internal/message-digests/delivery-authorizations/release',
    {
      schema: {
        operationId: 'releaseMessageDigestDeliveryAuthorization',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: deliveryAuthorizationReleaseBodySchema,
        response: {
          ...messageDigestResponseSchema(),
          503: errorResponseSchema('Message Digest delivery authorization release failed'),
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Message Digest delivery authorization release',
        bodyPreviewLength: 0,
      });
      if (!isDeliveryAuthorizationCaller(request)) {
        return await reply.fail(
          'UNAUTHORIZED',
          'Message Digest delivery authorization failed'
        );
      }
      try {
        const result = await releaseMessageDigestDeliveryAuthorization(request.body, {
          store: getServices().messageDigestStore,
        });
        if (!result.ok) {
          return await reply.fail('INVALID_REQUEST', 'Invalid delivery authorization release');
        }
        return await reply.ok({ disposition: result.disposition });
      } catch {
        return await reply.fail(
          'SERVICE_UNAVAILABLE',
          'Message Digest delivery authorization release failed'
        );
      }
    }
  );

  app.post<{ Body: PubSubPushBody }>(
    '/internal/message-digests/pubsub/run',
    {
      schema: {
        operationId: 'processMessageDigestRunPubSub',
        tags: ['internal'],
        security: [{ internalAuth: [] }],
        body: pubsubPushBodySchema,
        response: {
          ...messageDigestResponseSchema(),
          503: errorResponseSchema('Run processing retry required'),
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Message Digest run request',
        bodyPreviewLength: 0,
        additionalFields: { messageId: request.body.message.messageId },
      });
      if (!authenticateInternalPubSub(request).authenticated) {
        return await reply.fail('UNAUTHORIZED', 'Message Digest Pub/Sub authentication failed');
      }
      const runRequest = decodeRunRequest(request.body.message.data);
      if (runRequest === null) {
        return await reply.fail('INVALID_REQUEST', 'Invalid Message Digest run request');
      }
      const services = getServices();
      const workerId = `pubsub:${request.body.message.messageId}`;
      try {
        const result = await processMessageDigestRun(
          {
            userId: runRequest.userId,
            definitionId: runRequest.definitionId,
            runId: runRequest.runId,
            workerId,
          },
          {
            store: services.messageDigestStore,
            whatsappClient: services.messageDigestWhatsAppClient,
            aggregator: services.messageDigestAggregator,
            formatDelivery: (run) =>
              formatWhatsAppDigest({ run, webAppUrl: services.config.webAppUrl }),
            dispatchOutbox: async (outboxId) =>
              await dispatchMessageDigestOutbox(
                { outboxId, workerId: `delivery:${request.body.message.messageId}` },
                {
                  store: services.messageDigestStore,
                  runRequestPublisher: services.messageDigestRunPublisher,
                  whatsappPublisher: services.whatsappSendPublisher,
                }
              ),
          }
        );
        if (result.ok && result.disposition === 'deferred') {
          return await reply.fail('SERVICE_UNAVAILABLE', 'Message Digest run is temporarily busy');
        }
        return await reply.ok({
          accepted: true,
          disposition: result.ok ? result.disposition : 'failed',
        });
      } catch {
        return await reply.fail('SERVICE_UNAVAILABLE', 'Message Digest run retry required');
      }
    }
  );
  return Promise.resolve();
};

function isDeliveryAuthorizationCaller(request: Parameters<typeof validateInternalAuth>[0]): boolean {
  return isCaller(request, DELIVERY_AUTHORIZATION_CALLER_ROLE);
}

function isCaller(
  request: Parameters<typeof validateInternalAuth>[0],
  callerRole: string
): boolean {
  return validateInternalAuth(request).valid && request.headers['x-internal-caller-role'] === callerRole;
}

function decodeRunRequest(data: string): MessageDigestRunRequest | null {
  try {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.toString('base64') !== data) return null;
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed) || !hasExactKeys(parsed, RUN_REQUEST_KEYS)) return null;
    if (
      parsed['type'] !== 'message-digest.run' ||
      parsed['version'] !== 1 ||
      !isBoundedString(parsed['userId'], 256) ||
      typeof parsed['definitionId'] !== 'string' ||
      !/^md_[A-Za-z0-9_-]{3,120}$/u.test(parsed['definitionId']) ||
      typeof parsed['runId'] !== 'string' ||
      !/^mdr_[A-Za-z0-9_-]{3,160}$/u.test(parsed['runId']) ||
      typeof parsed['requestedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(parsed['requestedAt']))
    ) {
      return null;
    }
    return {
      type: 'message-digest.run',
      version: 1,
      userId: parsed['userId'],
      definitionId: parsed['definitionId'],
      runId: parsed['runId'],
      requestedAt: new Date(Date.parse(parsed['requestedAt'])).toISOString(),
    };
  } catch {
    return null;
  }
}

const RUN_REQUEST_KEYS = new Set([
  'type',
  'version',
  'userId',
  'definitionId',
  'runId',
  'requestedAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maxLength;
}

function errorResponseSchema(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    additionalProperties: false,
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
  };
}
