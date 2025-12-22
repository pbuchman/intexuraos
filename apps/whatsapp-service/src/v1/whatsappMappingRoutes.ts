/**
 * WhatsApp user mapping routes.
 * JWT-protected endpoints for managing per-user WhatsApp phone number mappings.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@praxos/common';
import { getServices } from '../services.js';

/**
 * Request body schema for connecting WhatsApp mapping.
 */
const connectRequestSchema = z.object({
  phoneNumbers: z.array(z.string().min(1)).min(1, 'At least one phone number is required'),
  inboxNotesDbId: z.string().min(1, 'Inbox Notes database ID is required'),
});

type ConnectRequest = z.infer<typeof connectRequestSchema>;

/**
 * WhatsApp mapping routes plugin.
 */
export const createWhatsAppMappingRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /whatsapp/connect - Connect/update WhatsApp mapping for current user.
   */
  fastify.post<{ Body: ConnectRequest }>(
    '/whatsapp/connect',
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
            description: 'Mapping created/updated successfully',
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
            description: 'Invalid request body',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized - missing or invalid JWT',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          409: {
            description: 'Conflict - phone number already mapped to another user',
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
        if (result.error.code === 'VALIDATION_ERROR') {
          return await reply.fail(
            'CONFLICT',
            result.error.message,
            undefined,
            result.error.details
          );
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  /**
   * GET /whatsapp/status - Get current WhatsApp mapping for authenticated user.
   */
  fastify.get(
    '/whatsapp/status',
    {
      schema: {
        operationId: 'getWhatsAppMappingStatus',
        summary: 'Get WhatsApp mapping status',
        description:
          'Retrieve the current WhatsApp mapping configuration for the authenticated user.',
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
                    description: 'Creation timestamp',
                  },
                  updatedAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Last update timestamp',
                  },
                },
                nullable: true,
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized - missing or invalid JWT',
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
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  /**
   * DELETE /whatsapp/disconnect - Disconnect WhatsApp mapping for authenticated user.
   */
  fastify.delete(
    '/whatsapp/disconnect',
    {
      schema: {
        operationId: 'disconnectWhatsAppMapping',
        summary: 'Disconnect WhatsApp mapping',
        description:
          'Mark the WhatsApp mapping as disconnected for the authenticated user. ' +
          'This does not delete the mapping, but sets connected=false.',
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
            description: 'Unauthorized - missing or invalid JWT',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Mapping not found',
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
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
