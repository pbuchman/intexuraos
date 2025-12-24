/**
 * WhatsApp User Mapping Routes
 *
 * POST   /v1/whatsapp/connect    - Connect/update WhatsApp mapping
 * GET    /v1/whatsapp/status     - Get mapping status
 * DELETE /v1/whatsapp/disconnect - Disconnect mapping
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../../services.js';

/**
 * Request body schema for connecting WhatsApp mapping.
 */
const connectRequestSchema = z.object({
  phoneNumbers: z.array(z.string().min(1)).min(1, 'At least one phone number is required'),
  inboxNotesDbId: z.string().min(1, 'Inbox Notes database ID is required'),
});

type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const mappingRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/whatsapp/connect - Connect/update WhatsApp mapping
  fastify.post<{ Body: ConnectRequest }>(
    '/v1/whatsapp/connect',
    {
      schema: {
        operationId: 'connectWhatsAppMapping',
        summary: 'Connect WhatsApp mapping',
        description:
          'Save or update WhatsApp phone number mapping for the authenticated user. ' +
          'Maps phone numbers to user ID and stores Notion Inbox Notes database ID. ' +
          'Enforces global uniqueness: a phone number can only be mapped to one user.',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          required: ['phoneNumbers', 'inboxNotesDbId'],
          properties: {
            phoneNumbers: {
              type: 'array',
              items: { type: 'string' },
              description: 'WhatsApp phone numbers to map to this user (E.164 format recommended)',
            },
            inboxNotesDbId: {
              type: 'string',
              description: 'Notion Inbox Notes database ID (data source ID)',
            },
          },
        },
        response: {
          200: {
            description: 'Mapping saved or updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  phoneNumbers: { type: 'array', items: { type: 'string' } },
                  inboxNotesDbId: { type: 'string' },
                  connected: { type: 'boolean' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          409: {
            description: 'Phone number already mapped to another user',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error (storage failure)',
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
    async (request: FastifyRequest<{ Body: ConnectRequest }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      // Validate request body
      const parseResult = connectRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
      }

      const { phoneNumbers, inboxNotesDbId } = parseResult.data;

      // Save mapping
      const { userMappingRepository } = getServices();
      const result = await userMappingRepository.saveMapping(
        user.userId,
        phoneNumbers,
        inboxNotesDbId
      );

      if (!result.ok) {
        // Phone conflict returns VALIDATION_ERROR with details
        if (
          result.error.code === 'VALIDATION_ERROR' &&
          result.error.details !== undefined &&
          'phoneNumber' in result.error.details
        ) {
          return await reply.fail(
            'CONFLICT',
            result.error.message,
            undefined,
            result.error.details
          );
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // GET /v1/whatsapp/status - Get mapping status
  fastify.get(
    '/v1/whatsapp/status',
    {
      schema: {
        operationId: 'getWhatsAppMappingStatus',
        summary: 'Get WhatsApp mapping status',
        description: 'Get current WhatsApp phone number mapping status for the authenticated user.',
        tags: ['whatsapp'],
        response: {
          200: {
            description: 'Mapping status retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  phoneNumbers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Mapped phone numbers',
                  },
                  inboxNotesDbId: {
                    type: 'string',
                    description: 'Notion Inbox Notes database ID',
                  },
                  connected: {
                    type: 'boolean',
                    description: 'Whether mapping is active',
                  },
                  createdAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Mapping created time',
                  },
                  updatedAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Last mapping update time',
                  },
                },
                nullable: true,
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { userMappingRepository } = getServices();
      const result = await userMappingRepository.getMapping(user.userId);

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // DELETE /v1/whatsapp/disconnect - Disconnect mapping
  fastify.delete(
    '/v1/whatsapp/disconnect',
    {
      schema: {
        operationId: 'disconnectWhatsAppMapping',
        summary: 'Disconnect WhatsApp mapping',
        description:
          'Remove WhatsApp phone number mapping for the authenticated user. ' +
          'This will stop processing incoming messages for the mapped phone numbers.',
        tags: ['whatsapp'],
        response: {
          200: {
            description: 'Mapping disconnected successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  phoneNumbers: { type: 'array', items: { type: 'string' } },
                  inboxNotesDbId: { type: 'string' },
                  connected: { type: 'boolean', enum: [false] },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
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
            description: 'No mapping found',
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

      const { userMappingRepository } = getServices();
      const result = await userMappingRepository.disconnectMapping(user.userId);

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
