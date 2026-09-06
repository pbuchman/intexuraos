import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

const READINESS_BODY_KEYS = new Set(['userId']);
const RECEIPT_BODY_KEYS = new Set(['userId', 'idempotencyKey']);
const RETRY_BODY_KEYS = new Set(['userId', 'idempotencyKey', 'payloadDigest']);

const errorResponseSchema = {
  description: 'WhatsApp outbound delivery observation error',
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    error: { $ref: 'ErrorBody#' },
  },
  required: ['success', 'error'],
} as const;

const commonObservationProperties = {
  observationVersion: { type: 'string' },
  observedAt: { type: 'string' },
} as const;

export const outboundDeliveryRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/whatsapp/delivery-readiness/get',
    {
      attachValidation: true,
      schema: {
        operationId: 'getWhatsAppDeliveryReadiness',
        summary: 'Get first-number WhatsApp delivery readiness',
        tags: ['internal'],
        body: strictUserBody(),
        response: {
          200: {
            description: 'Primary WhatsApp delivery readiness',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { type: 'string', const: 'ready' },
                      maskedPrimaryNumber: { type: 'string' },
                      ...commonObservationProperties,
                    },
                    required: ['status', 'maskedPrimaryNumber', 'observationVersion', 'observedAt'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: {
                        type: 'string',
                        enum: ['mapping_missing', 'disconnected', 'delivery_disabled'],
                      },
                      ...commonObservationProperties,
                    },
                    required: ['status', 'observationVersion', 'observedAt'],
                  },
                ],
              },
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received internal WhatsApp delivery state request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'readiness' },
      });
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for delivery readiness');
      }
      if (hasValidationError(request) || !rawBodyUsesAllowlist(request, READINESS_BODY_KEYS)) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const readiness = getServices().whatsAppDeliveryReadiness;
      if (readiness === undefined) {
        return await reply.fail('INTERNAL_ERROR', 'WhatsApp delivery readiness is not configured');
      }
      const result = await readiness.getReadiness((request.body as { userId: string }).userId);
      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', 'WhatsApp delivery readiness failed');
      }
      return await reply.ok(result.value);
    }
  );

  fastify.post(
    '/internal/whatsapp/outbound-deliveries/get',
    {
      attachValidation: true,
      schema: {
        operationId: 'getWhatsAppOutboundDeliveryState',
        summary: 'Get a user-bound idempotent WhatsApp delivery receipt',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 },
          },
          required: ['userId', 'idempotencyKey'],
        },
        response: {
          200: {
            description: 'Idempotent WhatsApp outbound delivery state',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                oneOf: [
                  closedStatusSchema(['pending', 'missing']),
                  terminalStatusSchema('sent', 'acceptedAt'),
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { type: 'string', const: 'ambiguous' },
                      acceptedAt: { type: 'string' },
                    },
                    required: ['status'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      status: { type: 'string', const: 'failed' },
                      failedAt: { type: 'string' },
                      failureCode: { type: 'string' },
                    },
                    required: ['status', 'failedAt', 'failureCode'],
                  },
                ],
              },
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received internal WhatsApp delivery state request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'receipt' },
      });
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for delivery receipt');
      }
      if (hasValidationError(request) || !rawBodyUsesAllowlist(request, RECEIPT_BODY_KEYS)) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const body = request.body as { userId: string; idempotencyKey: string };
      const result = await getServices().outboundMessageRepository.getIdempotentDeliveryState(body);
      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', 'WhatsApp delivery receipt lookup failed');
      }
      return await reply.ok(result.value);
    }
  );

  fastify.post(
    '/internal/whatsapp/outbound-deliveries/retry',
    {
      attachValidation: true,
      schema: {
        operationId: 'authorizeWhatsAppOutboundDeliveryRetry',
        summary: 'Authorize one byte-identical retry of a definitively failed WhatsApp delivery',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 256 },
            idempotencyKey: {
              type: 'string',
              minLength: 1,
              maxLength: 256,
              pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$',
            },
            payloadDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
          required: ['userId', 'idempotencyKey', 'payloadDigest'],
        },
        response: {
          200: {
            description: 'Outbound delivery retry authorization',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: { authorized: { type: 'boolean', const: true } },
                required: ['authorized'],
              },
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received internal WhatsApp delivery state request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'retry' },
      });
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for delivery retry');
      }
      if (hasValidationError(request) || !rawBodyUsesAllowlist(request, RETRY_BODY_KEYS)) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const body = request.body as {
        userId: string;
        idempotencyKey: string;
        payloadDigest: string;
      };
      const result = await getServices().outboundMessageRepository.authorizeIdempotentDeliveryRetry(
        { ...body, now: new Date().toISOString() }
      );
      if (!result.ok) {
        switch (result.code) {
          case 'INVALID_INPUT':
            return await reply.fail('INVALID_REQUEST', 'Outbound delivery retry is invalid');
          case 'NOT_FOUND':
            return await reply.fail('NOT_FOUND', 'Outbound delivery receipt was not found');
          case 'CORRELATED_REPLAY_CONFLICT':
          case 'INVALID_STATE':
            return await reply.fail('CONFLICT', 'Outbound delivery retry is not authorized');
          case 'CORRUPT_RECEIPT':
          case 'PERSISTENCE_ERROR':
            return await reply.fail('INTERNAL_ERROR', 'Outbound delivery retry failed');
        }
      }
      return await reply.ok({ authorized: true as const });
    }
  );

  done();
};

function strictUserBody(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { userId: { type: 'string', minLength: 1 } },
    required: ['userId'],
  };
}

function closedStatusSchema(statuses: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { status: { type: 'string', enum: statuses } },
    required: ['status'],
  };
}

function terminalStatusSchema(status: string, timestampField: string): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', const: status },
      [timestampField]: { type: 'string' },
    },
    required: ['status', timestampField],
  };
}

function hasValidationError(request: FastifyRequest): boolean {
  return (request as FastifyRequest & { validationError?: Error }).validationError !== undefined;
}

function rawBodyUsesAllowlist(request: FastifyRequest, allowedKeys: ReadonlySet<string>): boolean {
  const rawBody = (request as FastifyRequest & { rawBody?: unknown }).rawBody;
  return outboundDeliveryBodyUsesAllowlist(rawBody, allowedKeys);
}

export function outboundDeliveryBodyUsesAllowlist(
  rawBody: unknown,
  allowedKeys: ReadonlySet<string>
): boolean {
  if (typeof rawBody !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).every((key) => allowedKeys.has(key))
    );
  } catch {
    return false;
  }
}
