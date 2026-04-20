/**
 * WhatsApp Notification Preferences routes.
 *
 * GET  /whatsapp/preferences — read the authenticated user's level
 * PUT  /whatsapp/preferences — update it
 *
 * Privacy contract (INT-1418): never returned by /whatsapp/status, never
 * published on Pub/Sub, never read by other services.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { NotificationLevel } from '../domain/whatsapp/index.js';

const putSchema = z.object({
  notificationLevel: z.enum(['all', 'important']),
});

type PutBody = z.infer<typeof putSchema>;

export const preferencesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/whatsapp/preferences',
    {
      schema: {
        operationId: 'getWhatsAppPreferences',
        summary: 'Get WhatsApp notification preferences',
        description:
          'Get the authenticated user\'s WhatsApp notification level. ' +
          'Privacy contract (INT-1418): never returned by /whatsapp/status, ' +
          'never published on Pub/Sub, never read by other services.',
        tags: ['whatsapp'],
        response: {
          200: {
            description: 'Preferences retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notificationLevel'],
                properties: {
                  notificationLevel: { type: 'string', enum: ['all', 'important'] },
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/preferences',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const { notificationPreferencesRepository } = getServices();
      const result = await notificationPreferencesRepository.getPreferences(user.userId);
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }
      return await reply.ok({ notificationLevel: result.value.notificationLevel });
    }
  );

  fastify.put<{ Body: PutBody }>(
    '/whatsapp/preferences',
    {
      schema: {
        operationId: 'updateWhatsAppPreferences',
        summary: 'Update WhatsApp notification preferences',
        description:
          'Update the authenticated user\'s WhatsApp notification level. ' +
          'Privacy contract (INT-1418): never returned by /whatsapp/status, ' +
          'never published on Pub/Sub, never read by other services.',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          required: ['notificationLevel'],
          properties: {
            notificationLevel: { type: 'string', enum: ['all', 'important'] },
          },
        },
        response: {
          200: {
            description: 'Preferences updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notificationLevel'],
                properties: {
                  notificationLevel: { type: 'string', enum: ['all', 'important'] },
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
    async (request: FastifyRequest<{ Body: PutBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to PUT /whatsapp/preferences',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const parsed = putSchema.safeParse(request.body);
      if (!parsed.success) {
        const errors = parsed.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, { errors });
      }

      const level: NotificationLevel = parsed.data.notificationLevel;
      const { notificationPreferencesRepository } = getServices();
      const result = await notificationPreferencesRepository.savePreferences(user.userId, level);
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }
      return await reply.ok({ notificationLevel: result.value.notificationLevel });
    }
  );

  done();
};
