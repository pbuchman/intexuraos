/**
 * User Settings Routes
 *
 * GET /users/:uid/settings - Get user settings
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { getUserSettings, type GetUserSettingsErrorCode } from '../domain/settings/index.js';

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
 * Schema for user settings response data.
 */
const userSettingsDataSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['userId', 'createdAt', 'updatedAt'],
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
      logIncomingRequest(request, {
        message: 'Received request to GET /users/:uid/settings',
      });

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

  done();
};
