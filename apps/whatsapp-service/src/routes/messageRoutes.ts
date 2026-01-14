/**
 * Routes for WhatsApp message management.
 * - GET /whatsapp/messages — list user's messages
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

interface ListQuerystring {
  limit?: number;
  cursor?: string;
}

export const messageRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /whatsapp/messages — list user's messages
  fastify.get<{ Querystring: ListQuerystring }>(
    '/whatsapp/messages',
    {
      schema: {
        operationId: 'getWhatsAppMessages',
        summary: 'Get WhatsApp messages',
        description:
          'Get paginated WhatsApp messages for the authenticated user, sorted by newest first.',
        tags: ['whatsapp'],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Messages retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['messages'],
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
                        mediaType: {
                          type: 'string',
                          enum: ['text', 'image', 'audio'],
                          description: 'Type of message content',
                        },
                        hasMedia: {
                          type: 'boolean',
                          description: 'Whether message has media attached',
                        },
                        caption: {
                          type: 'string',
                          nullable: true,
                          description: 'Media caption (for image/audio)',
                        },
                        transcriptionStatus: {
                          type: 'string',
                          enum: ['pending', 'processing', 'completed', 'failed'],
                          description: 'Transcription status for audio messages',
                        },
                        transcription: {
                          type: 'string',
                          description: 'Transcription text for completed audio messages',
                        },
                        transcriptionError: {
                          type: 'object',
                          nullable: true,
                          description: 'Error details if transcription failed',
                          properties: {
                            code: { type: 'string' },
                            message: { type: 'string' },
                          },
                        },
                        linkPreview: {
                          type: 'object',
                          nullable: true,
                          description: 'Link preview state for messages with URLs',
                          properties: {
                            status: {
                              type: 'string',
                              enum: ['pending', 'completed', 'failed'],
                            },
                            previews: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  url: { type: 'string' },
                                  title: { type: 'string' },
                                  description: { type: 'string' },
                                  image: { type: 'string' },
                                  favicon: { type: 'string' },
                                  siteName: { type: 'string' },
                                },
                                required: ['url'],
                              },
                            },
                            error: {
                              type: 'object',
                              properties: {
                                code: { type: 'string' },
                                message: { type: 'string' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  fromNumber: {
                    type: 'string',
                    nullable: true,
                    description: 'User registered phone number',
                  },
                  nextCursor: {
                    type: 'string',
                    description: 'Cursor for fetching next page of results',
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
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
    async (request: FastifyRequest<{ Querystring: ListQuerystring }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/messages',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { limit, cursor } = request.query;
      const { messageRepository, userMappingRepository } = getServices();

      // Get user's registered phone number for display
      const mappingResult = await userMappingRepository.getMapping(user.userId);
      const fromNumber = mappingResult.ok ? mappingResult.value?.phoneNumbers[0] : null;

      // Build pagination options (only include defined values)
      const options: { limit?: number; cursor?: string } = {};
      if (limit !== undefined) {
        options.limit = limit;
      }
      if (cursor !== undefined) {
        options.cursor = cursor;
      }

      // Get messages with pagination
      const messagesResult = await messageRepository.getMessagesByUser(user.userId, options);

      if (!messagesResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', messagesResult.error.message);
      }

      // Transform to API response format
      const messages = messagesResult.value.messages.map((msg) => {
        const base: Record<string, unknown> = {
          id: msg.id,
          text: msg.text,
          fromNumber: msg.fromNumber,
          timestamp: msg.timestamp,
          receivedAt: msg.receivedAt,
          mediaType: msg.mediaType,
          hasMedia: msg.gcsPath !== undefined,
          caption: msg.caption ?? null,
        };

        // Add transcription fields for audio messages
        if (msg.transcription !== undefined) {
          base['transcriptionStatus'] = msg.transcription.status;
          base['transcription'] = msg.transcription.text;
          base['transcriptionError'] = msg.transcription.error;
        }

        // Add link preview for text messages with URLs
        if (msg.linkPreview !== undefined) {
          base['linkPreview'] = msg.linkPreview;
        }

        return base;
      });

      const response: Record<string, unknown> = {
        messages,
        fromNumber: fromNumber ?? null,
      };

      if (messagesResult.value.nextCursor !== undefined) {
        response['nextCursor'] = messagesResult.value.nextCursor;
      }

      return await reply.ok(response);
    }
  );

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
