/**
 * User Settings Routes
 *
 * GET /users/:uid/settings - Get user settings
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import { isFastModel, getProviderForModel } from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import { getUserSettings, isTranscriptionProvider, type GetUserSettingsErrorCode } from '../domain/settings/index.js';

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

  // PATCH /users/:uid/settings
  fastify.patch(
    '/users/:uid/settings',
    {
      schema: {
        operationId: 'updateUserSettings',
        summary: 'Update user settings',
        description: 'Update user preferences such as default LLM model.',
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
          required: ['defaultModel'],
          properties: {
            defaultModel: {
              type: 'string',
              description: 'Default fast model for generate() calls',
            },
          },
        },
        response: {
          200: {
            description: 'Settings updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  defaultModel: { type: 'string' },
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
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          403: {
            description: 'Forbidden',
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
        message: 'Received request to PATCH /users/:uid/settings',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body = request.body as { defaultModel: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      if (!isFastModel(body.defaultModel)) {
        return await reply.fail('INVALID_REQUEST', `Invalid model: ${body.defaultModel}. Must be a supported fast model.`);
      }

      const { userSettingsRepository } = getServices();

      // Verify the user has an API key configured for the model's provider
      const provider = getProviderForModel(body.defaultModel);
      const settingsResult = await userSettingsRepository.getSettings(params.uid);

      if (!settingsResult.ok) {
        return await reply.fail('INTERNAL_ERROR', settingsResult.error.message);
      }

      const hasKey = settingsResult.value?.llmApiKeys?.[provider] !== undefined;
      if (!hasKey) {
        return await reply.fail(
          'INVALID_REQUEST',
          `Cannot set default model to ${body.defaultModel}: no API key configured for provider '${provider}'`
        );
      }

      const result = await userSettingsRepository.updateLlmPreferences(params.uid, body.defaultModel);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ defaultModel: body.defaultModel });
    }
  );

  // PATCH /users/:uid/settings/transcription
  fastify.patch(
    '/users/:uid/settings/transcription',
    {
      schema: {
        operationId: 'updateTranscriptionPreferences',
        summary: 'Update transcription provider preference',
        description: 'Update user transcription provider preference.',
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
          required: ['provider'],
          properties: {
            provider: {
              type: 'string',
              enum: ['speechmatics'],
              description: 'Transcription provider',
            },
          },
        },
        response: {
          200: {
            description: 'Transcription preferences updated',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
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
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          403: {
            description: 'Forbidden',
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
        message: 'Received request to PATCH /users/:uid/settings/transcription',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body = request.body as { provider: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      if (!isTranscriptionProvider(body.provider)) {
        return await reply.fail('INVALID_REQUEST', `Invalid provider: ${body.provider}`);
      }

      const { userSettingsRepository } = getServices();
      const result = await userSettingsRepository.updateTranscriptionPreferences(
        params.uid,
        body.provider
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ provider: body.provider });
    }
  );

  done();
};
