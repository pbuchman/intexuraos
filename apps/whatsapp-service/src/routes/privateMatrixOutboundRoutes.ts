import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { PrivateWhatsAppAccount } from '../domain/whatsapp/models/PrivateWhatsApp.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface MatrixDeliveryStatusParams {
  userId: string;
}

interface OutboundMatrixMessageBody {
  userId: string;
  text: string;
  startNewSession?: boolean;
  idempotencyKey?: string;
}

function toMatrixOutboundText(body: OutboundMatrixMessageBody): string {
  if (body.startNewSession === true) {
    return `new session: ${body.text}`;
  }
  return body.text;
}

function isActiveAccount(account: PrivateWhatsAppAccount | null): account is PrivateWhatsAppAccount {
  return account !== null && account.status === 'active';
}

export const privateMatrixOutboundRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/internal/whatsapp/private/matrix-delivery-status/:userId',
    {
      attachValidation: true,
      schema: {
        operationId: 'getPrivateMatrixDeliveryStatus',
        summary: 'Get private Matrix delivery readiness',
        description:
          'Internal endpoint that resolves the active private WhatsApp account and checks whether Matrix outbound delivery to intex_agent is ready.',
        tags: ['internal'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
          },
          required: ['userId'],
        },
        response: {
          200: {
            description: 'Private Matrix delivery status resolved',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ready', 'setup_required', 'error'] },
                  deliverable: { type: 'boolean' },
                  reason: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['status', 'deliverable'],
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: MatrixDeliveryStatusParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/matrix-delivery-status/:userId',
        bodyPreviewLength: 0,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for matrix delivery status');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for matrix delivery status');
      }

      /* v8 ignore start -- schema: Fastify route params cannot reach this handler with an empty required userId in app.inject(); attachValidation branch is defensive @preserve */
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      /* v8 ignore stop @preserve */

      const services = getServices();
      const accountResult = await services.privateWhatsAppRepository.getAccountByUserId(
        request.params.userId
      );
      if (!accountResult.ok) {
        return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
      }
      if (!isActiveAccount(accountResult.value)) {
        return await reply.ok({
          status: 'setup_required',
          deliverable: false,
          reason: 'Private WhatsApp account is not configured',
        });
      }
      const account = accountResult.value;

      const readiness = await services.matrixOutboundGateway.getDeliveryReadiness({
        sourceAccountId: account.sourceAccountId,
        target: 'intex_agent',
      });

      if (readiness.status === 'ready') {
        return await reply.ok({
          status: 'ready',
          deliverable: true,
        });
      }

      if (readiness.status === 'setup_required') {
        return await reply.ok({
          status: 'setup_required',
          deliverable: false,
          reason: readiness.reason,
        });
      }

      return await reply.ok({
        status: 'error',
        deliverable: false,
        message: readiness.message,
      });
    }
  );

  fastify.post(
    '/internal/whatsapp/private/outbound-matrix-messages',
    {
      attachValidation: true,
      schema: {
        operationId: 'sendPrivateOutboundMatrixMessage',
        summary: 'Send private outbound Matrix message',
        description:
          'Internal endpoint that resolves the active private WhatsApp account and asks the Matrix adapter to send a user-authored message to intex_agent.',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            text: { type: 'string', minLength: 1 },
            startNewSession: { type: 'boolean' },
            idempotencyKey: { type: 'string', minLength: 1 },
          },
          required: ['userId', 'text'],
        },
        response: {
          200: {
            description: 'Private outbound Matrix message result',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['sent', 'setup_required', 'error'] },
                  matrixEventId: { type: 'string' },
                  reason: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['status'],
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: OutboundMatrixMessageBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/outbound-matrix-messages',
        bodyPreviewLength: 0,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private outbound matrix messages'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private outbound matrix messages'
        );
      }

      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const services = getServices();
      const accountResult = await services.privateWhatsAppRepository.getAccountByUserId(
        request.body.userId
      );
      if (!accountResult.ok) {
        return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
      }
      if (!isActiveAccount(accountResult.value)) {
        return await reply.ok({
          status: 'setup_required',
          reason: 'Private WhatsApp account is not configured',
        });
      }
      const account = accountResult.value;

      const sendResult = await services.matrixOutboundGateway.sendMessage({
        sourceAccountId: account.sourceAccountId,
        target: 'intex_agent',
        text: toMatrixOutboundText(request.body),
        ...(request.body.idempotencyKey !== undefined
          ? { idempotencyKey: request.body.idempotencyKey }
          : {}),
      });

      if (sendResult.status === 'sent') {
        return await reply.ok({
          status: 'sent',
          matrixEventId: sendResult.matrixEventId,
        });
      }

      if (sendResult.status === 'setup_required') {
        return await reply.ok({
          status: 'setup_required',
          reason: sendResult.reason,
        });
      }

      return await reply.ok({
        status: 'error',
        message: sendResult.message,
      });
    }
  );

  done();
};
