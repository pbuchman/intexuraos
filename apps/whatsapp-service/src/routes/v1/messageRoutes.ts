/**
 * Routes for WhatsApp message management.
 * - GET /v1/whatsapp/messages — list user's messages
 * - DELETE /v1/whatsapp/messages/:messageId — delete a message
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../../services.js';

interface MessageParams {
  messageId: string;
}

export const messageRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /v1/whatsapp/messages — list user's messages
  fastify.get(
    '/v1/whatsapp/messages',
    {
      schema: {
        operationId: 'getWhatsAppMessages',
        summary: 'Get WhatsApp messages',
        description:
          'Get all WhatsApp messages for the authenticated user, sorted by newest first.',
        tags: ['whatsapp'],
        response: {
          200: {
            description: 'Messages retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        text: { type: 'string' },
                        fromNumber: { type: 'string' },
                        timestamp: { type: 'string' },
                        receivedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  fromNumber: {
                    type: 'string',
                    nullable: true,
                    description: 'User registered phone number',
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized - invalid or missing token',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { messageRepository, userMappingRepository } = getServices();

      // Get user's registered phone number for display
      const mappingResult = await userMappingRepository.getMapping(user.userId);
      const fromNumber = mappingResult.ok ? mappingResult.value?.phoneNumbers[0] : null;

      // Get messages
      const messagesResult = await messageRepository.getMessagesByUser(user.userId);

      if (!messagesResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', messagesResult.error.message);
      }

      // Transform to API response format
      const messages = messagesResult.value.map((msg) => ({
        id: msg.id,
        text: msg.text,
        fromNumber: msg.fromNumber,
        timestamp: msg.timestamp,
        receivedAt: msg.receivedAt,
      }));

      return await reply.ok({
        messages,
        fromNumber: fromNumber ?? null,
      });
    }
  );

  // DELETE /v1/whatsapp/messages/:messageId — delete a message
  fastify.delete<{ Params: MessageParams }>(
    '/v1/whatsapp/messages/:messageId',
    {
      schema: {
        operationId: 'deleteWhatsAppMessage',
        summary: 'Delete a WhatsApp message',
        description:
          'Delete a specific WhatsApp message. User can only delete their own messages.',
        tags: ['whatsapp'],
        params: {
          type: 'object',
          required: ['messageId'],
          properties: {
            messageId: { type: 'string', description: 'Message ID to delete' },
          },
        },
        response: {
          200: {
            description: 'Message deleted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  deleted: { type: 'boolean', enum: [true] },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized - invalid or missing token',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Message not found or not owned by user',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: MessageParams }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { messageId } = request.params;
      const { messageRepository } = getServices();

      // First, verify the message exists and belongs to the user
      const messageResult = await messageRepository.getMessage(messageId);

      if (!messageResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', messageResult.error.message);
      }

      if (messageResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      // Check ownership
      if (messageResult.value.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      // Delete the message
      const deleteResult = await messageRepository.deleteMessage(messageId);

      if (!deleteResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', deleteResult.error.message);
      }

      return await reply.ok({ deleted: true });
    }
  );

  done();
};

