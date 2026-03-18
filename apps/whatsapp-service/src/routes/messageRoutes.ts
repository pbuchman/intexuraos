/**
 * Routes for WhatsApp message listing.
 * - GET /whatsapp/messages — list user's messages
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

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

  done();
};
