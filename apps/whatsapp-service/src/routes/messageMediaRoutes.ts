/**
 * Routes for WhatsApp message media access and deletion.
 * - GET /whatsapp/messages/:message_id/media — get signed URL for original media
 * - GET /whatsapp/messages/:message_id/thumbnail — get signed URL for thumbnail
 * - DELETE /whatsapp/messages/:message_id — delete a message
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

interface MessageParams {
  message_id: string;
}

export const messageMediaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /whatsapp/messages/:message_id/media — get signed URL for original media
  fastify.get<{ Params: MessageParams }>(
    '/whatsapp/messages/:message_id/media',
    {
      schema: {
        operationId: 'getWhatsAppMessageMedia',
        summary: 'Get signed URL for message media',
        description: 'Get a short-lived signed URL (15 min) for accessing the original media file.',
        tags: ['whatsapp'],
        params: {
          type: 'object',
          required: ['message_id'],
          properties: {
            message_id: { type: 'string', description: 'Message ID' },
          },
        },
        response: {
          200: {
            description: 'Signed URL generated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'Signed URL for media access' },
                  expiresAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'URL expiration time',
                  },
                },
                required: ['url', 'expiresAt'],
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
            description: 'Message not found, not owned by user, or has no media',
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
    async (request: FastifyRequest<{ Params: MessageParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/messages/:message_id/media',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { message_id: messageId } = request.params;
      const { messageRepository, mediaStorage } = getServices();

      const messageResult = await messageRepository.getMessage(messageId);

      if (!messageResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', messageResult.error.message);
      }

      if (messageResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      if (messageResult.value.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      const gcsPath = messageResult.value.gcsPath;
      if (gcsPath === undefined) {
        return await reply.fail('NOT_FOUND', 'Message has no media');
      }

      const ttlSeconds = 900; // 15 minutes
      const urlResult = await mediaStorage.getSignedUrl(gcsPath, ttlSeconds);

      if (!urlResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', urlResult.error.message);
      }

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      return await reply.ok({
        url: urlResult.value,
        expiresAt,
      });
    }
  );

  // GET /whatsapp/messages/:message_id/thumbnail — get signed URL for thumbnail
  fastify.get<{ Params: MessageParams }>(
    '/whatsapp/messages/:message_id/thumbnail',
    {
      schema: {
        operationId: 'getWhatsAppMessageThumbnail',
        summary: 'Get signed URL for message thumbnail',
        description:
          'Get a short-lived signed URL (15 min) for accessing the image thumbnail (256px max edge).',
        tags: ['whatsapp'],
        params: {
          type: 'object',
          required: ['message_id'],
          properties: {
            message_id: { type: 'string', description: 'Message ID' },
          },
        },
        response: {
          200: {
            description: 'Signed URL generated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'Signed URL for thumbnail access' },
                  expiresAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'URL expiration time',
                  },
                },
                required: ['url', 'expiresAt'],
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
            description: 'Message not found, not owned by user, or has no thumbnail',
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
    async (request: FastifyRequest<{ Params: MessageParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/messages/:message_id/thumbnail',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { message_id: messageId } = request.params;
      const { messageRepository, mediaStorage } = getServices();

      const messageResult = await messageRepository.getMessage(messageId);

      if (!messageResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', messageResult.error.message);
      }

      if (messageResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      if (messageResult.value.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Message not found');
      }

      const thumbnailGcsPath = messageResult.value.thumbnailGcsPath;
      if (thumbnailGcsPath === undefined) {
        return await reply.fail('NOT_FOUND', 'Message has no thumbnail');
      }

      const ttlSeconds = 900; // 15 minutes
      const urlResult = await mediaStorage.getSignedUrl(thumbnailGcsPath, ttlSeconds);

      if (!urlResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', urlResult.error.message);
      }

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      return await reply.ok({
        url: urlResult.value,
        expiresAt,
      });
    }
  );

  // DELETE /whatsapp/messages/:message_id — delete a message
  fastify.delete<{ Params: MessageParams }>(
    '/whatsapp/messages/:message_id',
    {
      schema: {
        operationId: 'deleteWhatsAppMessage',
        summary: 'Delete a WhatsApp message',
        description: 'Delete a specific WhatsApp message. User can only delete their own messages.',
        tags: ['whatsapp'],
        params: {
          type: 'object',
          required: ['message_id'],
          properties: {
            message_id: { type: 'string', description: 'Message ID to delete' },
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
    async (request: FastifyRequest<{ Params: MessageParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /whatsapp/messages/:message_id',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { message_id: messageId } = request.params;
      const { messageRepository, eventPublisher } = getServices();

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

      // Collect GCS paths for cleanup before deletion
      const gcsPaths: string[] = [];
      if (messageResult.value.gcsPath !== undefined) {
        gcsPaths.push(messageResult.value.gcsPath);
      }
      if (messageResult.value.thumbnailGcsPath !== undefined) {
        gcsPaths.push(messageResult.value.thumbnailGcsPath);
      }

      // Delete the message from Firestore first
      const deleteResult = await messageRepository.deleteMessage(messageId);

      if (!deleteResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', deleteResult.error.message);
      }

      // Publish cleanup event for GCS media deletion (async, best-effort)
      // Event is published after successful Firestore deletion to ensure data consistency.
      // If publish fails, orphaned media files will remain in GCS but user sees successful deletion.
      if (gcsPaths.length > 0) {
        await eventPublisher.publishMediaCleanup({
          type: 'whatsapp.media.cleanup',
          userId: user.userId,
          messageId,
          gcsPaths,
          timestamp: new Date().toISOString(),
        });
        // Note: Ignoring publish result - cleanup is best-effort.
        // Failed events will be handled by DLQ monitoring if Pub/Sub delivery fails.
      }

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
