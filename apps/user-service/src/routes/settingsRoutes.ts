/**
 * User Settings Routes
 *
 * GET   /users/:uid/settings - Get user settings
 * PATCH /users/:uid/settings - Update user settings
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  getUserSettings,
  updateUserSettings,
  type GetUserSettingsErrorCode,
  type UpdateUserSettingsErrorCode,
} from '../domain/settings/index.js';

/**
 * Map domain error codes to HTTP error codes for GET.
 */
function mapGetErrorCode(code: GetUserSettingsErrorCode): 'FORBIDDEN' | 'INTERNAL_ERROR' {
  switch (code) {
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR';
  }
}

/**
 * Map domain error codes to HTTP error codes for UPDATE.
 */
function mapUpdateErrorCode(
  code: UpdateUserSettingsErrorCode
): 'FORBIDDEN' | 'INVALID_REQUEST' | 'INTERNAL_ERROR' {
  switch (code) {
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'INVALID_REQUEST':
      return 'INVALID_REQUEST';
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR';
  }
}

/**
 * Schema for notification filter.
 */
const notificationFilterSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: 'Unique filter name' },
    app: { type: 'string', minLength: 1, description: 'App package name (e.g., com.whatsapp)' },
    source: { type: 'string', minLength: 1, description: 'Notification source (e.g., tasker)' },
    title: { type: 'string', minLength: 1, description: 'Title filter (case-insensitive partial)' },
  },
  required: ['name'],
} as const;

/**
 * Schema for user settings response data.
 */
const userSettingsDataSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    notifications: {
      type: 'object',
      properties: {
        filters: {
          type: 'array',
          items: notificationFilterSchema,
        },
      },
      required: ['filters'],
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['userId', 'notifications', 'createdAt', 'updatedAt'],
} as const;

export const settingsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /users/:uid/settings
  fastify.get(
    '/users/:uid/settings',
    {
      schema: {
        operationId: 'getUserSettings',
        summary: 'Get user settings',
        description:
          'Get settings for the authenticated user. User can only access their own settings.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        response: {
          200: {
            description: 'User settings retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: userSettingsDataSchema,
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
          403: {
            description: 'Forbidden - cannot access other user settings',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
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

      const params = request.params as { uid: string };
      const { userSettingsRepository } = getServices();

      const result = await getUserSettings(
        { userId: params.uid, requestingUserId: user.userId },
        { userSettingsRepository }
      );

      if (!result.ok) {
        return await reply.fail(mapGetErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // PATCH /users/:uid/settings
  fastify.patch(
    '/users/:uid/settings',
    {
      schema: {
        operationId: 'updateUserSettings',
        summary: 'Update user settings',
        description:
          'Update settings for the authenticated user. User can only update their own settings.',
        tags: ['settings'],
        params: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'User ID' },
          },
          required: ['uid'],
        },
        body: {
          type: 'object',
          properties: {
            notifications: {
              type: 'object',
              properties: {
                filters: {
                  type: 'array',
                  items: notificationFilterSchema,
                },
              },
              required: ['filters'],
            },
          },
          required: ['notifications'],
        },
        response: {
          200: {
            description: 'User settings updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: userSettingsDataSchema,
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
            description: 'Unauthorized - invalid or missing token',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          403: {
            description: 'Forbidden - cannot update other user settings',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal server error',
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

      const params = request.params as { uid: string };
      const body = request.body as {
        notifications: {
          filters: { name: string; app?: string; source?: string; title?: string }[];
        };
      };
      const { userSettingsRepository } = getServices();

      const result = await updateUserSettings(
        {
          userId: params.uid,
          requestingUserId: user.userId,
          notifications: body.notifications,
        },
        { userSettingsRepository }
      );

      if (!result.ok) {
        return await reply.fail(mapUpdateErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
