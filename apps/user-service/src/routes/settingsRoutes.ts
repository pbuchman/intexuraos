/**
 * User Settings Routes
 *
 * GET /users/:uid/settings - Get user settings
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, logIncomingRequest } from '@intexuraos/common-http';
import {
  DEFAULT_INTEX_AGENT_MODEL,
  getProviderForModel,
  INTEX_AGENT_MODEL_OPTIONS,
  isDefaultEligibleModel,
  isIntexAgentModel,
} from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import { getUserSettings, isTranscriptionProvider, isValidTimezone, type GetUserSettingsErrorCode } from '../domain/settings/index.js';

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
    timezone: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    intexAgentCapabilities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        testRuns: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                status: { type: 'string', enum: ['available'] },
                runtimeAudience: { type: 'string', enum: ['home-dev'] },
              },
              required: ['status', 'runtimeAudience'],
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: { status: { type: 'string', enum: ['unavailable'] } },
              required: ['status'],
            },
          ],
        },
      },
      required: ['testRuns'],
    },
  },
  required: ['userId', 'createdAt', 'updatedAt', 'intexAgentCapabilities'],
} as const;

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype;
  } catch {
    return false;
  }
}

function isGeneralModelCandidate(value: unknown): value is Record<string, unknown> {
  if (!isPlainJsonObject(value)) {
    return false;
  }
  try {
    const keys = Object.keys(value);
    return Object.hasOwn(value, 'defaultModel') && keys.every((key) => key === 'defaultModel' || key === 'fallbackModel');
  } catch {
    return false;
  }
}

function isIntexAgentSelectorPatch(value: unknown): value is { intexAgentModel: unknown; expectedRevision: unknown } {
  if (!isPlainJsonObject(value)) {
    return false;
  }
  try {
    const keys = Object.keys(value);
    return keys.length === 2 && Object.hasOwn(value, 'intexAgentModel') && Object.hasOwn(value, 'expectedRevision');
  } catch {
    return false;
  }
}

function selectorResponse(
  explicitModel: import('@intexuraos/llm-contract').IntexAgentModel | null,
  revision: number
): Readonly<{
  explicitModel: import('@intexuraos/llm-contract').IntexAgentModel | null;
  effectiveModel: import('@intexuraos/llm-contract').IntexAgentModel;
  source: 'default_absent' | 'explicit';
  revision: number;
}> {
  return {
    explicitModel,
    effectiveModel: explicitModel ?? DEFAULT_INTEX_AGENT_MODEL,
    source: explicitModel === null ? ('default_absent' as const) : ('explicit' as const),
    revision,
  };
}

const INTEG_AGENT_MODEL_IDS = INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => id);

function intexAgentProjectionConsistencySchema(): Readonly<Record<string, unknown>> {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          explicitModel: { const: null },
          effectiveModel: { const: DEFAULT_INTEX_AGENT_MODEL },
          source: { const: 'default_absent' },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      },
      ...INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => ({
        type: 'object',
        properties: {
          explicitModel: { const: id },
          effectiveModel: { const: id },
          source: { const: 'explicit' },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      })),
    ],
  };
}

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
      const { userSettingsRepository, intexAgentTestRunsReadCapability } = getServices();

      const result = await getUserSettings(
        { userId: params.uid, requestingUserId: user.userId },
        { userSettingsRepository }
      );

      if (!result.ok) {
        return await reply.fail(mapGetErrorCode(result.error.code), result.error.message);
      }

      const testRunsAvailable = await intexAgentTestRunsReadCapability.isAvailableForUser(
        user.userId
      );
      return await reply.ok({
        ...result.value,
        intexAgentCapabilities: {
          testRuns: testRunsAvailable
            ? { status: 'available', runtimeAudience: 'home-dev' }
            : { status: 'unavailable' },
        },
      });
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
        response: {
          200: {
            description: 'Settings updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      defaultModel: { type: 'string' },
                      fallbackModel: { type: 'string', nullable: true },
                    },
                    required: ['defaultModel', 'fallbackModel'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      explicitModel: {
                        type: ['string', 'null'],
                        enum: [...INTEG_AGENT_MODEL_IDS, null],
                      },
                      effectiveModel: {
                        type: 'string',
                        enum: INTEG_AGENT_MODEL_IDS,
                      },
                      source: { type: 'string', enum: ['explicit', 'default_absent'] },
                      revision: { type: 'integer', minimum: 0 },
                    },
                    allOf: [intexAgentProjectionConsistencySchema()],
                    required: ['explicitModel', 'effectiveModel', 'source', 'revision'],
                  },
                ],
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
          404: {
            description: 'Intex Agent model selector unavailable',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          409: {
            description: 'Selector revision conflict',
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
        message: 'PATCH /users/:uid/settings',
        bodyPreviewLength: 0,
        includeParams: false,
        includeHeaders: false,
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body: unknown = request.body;

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      if (!isGeneralModelCandidate(body)) {
        const { userSettingsRepository, intexAgentModelAvailability } = getServices();
        if (!(await intexAgentModelAvailability.isAvailableForUser(params.uid))) {
          return await reply.fail('NOT_FOUND', 'Intex Agent model selector is unavailable');
        }
        if (!isIntexAgentSelectorPatch(body)) {
          return await reply.fail('INVALID_REQUEST', 'Invalid Intex Agent model selector request');
        }

        const { intexAgentModel, expectedRevision } = body;
        if (
          (intexAgentModel !== null && !isIntexAgentModel(intexAgentModel)) ||
          typeof expectedRevision !== 'number' ||
          !Number.isSafeInteger(expectedRevision) ||
          expectedRevision < 0
        ) {
          return await reply.fail('INVALID_REQUEST', 'Invalid Intex Agent model selector request');
        }

        try {
          const result = await userSettingsRepository.updateIntexAgentModel(
            params.uid,
            intexAgentModel,
            expectedRevision
          );
          if (!result.ok) {
            return await reply.fail('INTERNAL_ERROR', 'Failed to update Intex Agent model selector');
          }
          if (result.value.status === 'invalid_stored_value') {
            return await reply.fail('INTERNAL_ERROR', 'Intex Agent model selector state is invalid');
          }
          if (result.value.status === 'conflict') {
            return await reply.fail('CONFLICT', 'Revision conflict', undefined, {
              currentRevision: result.value.revision,
            });
          }
          if (result.value.status === 'revision_exhausted') {
            return await reply.fail('CONFLICT', 'Revision exhausted', undefined, {
              currentRevision: result.value.revision,
            });
          }
          return await reply.ok(selectorResponse(result.value.explicitModel, result.value.revision));
        } catch {
          return await reply.fail('INTERNAL_ERROR', 'Failed to update Intex Agent model selector');
        }
      }

      const generalBody = body as { defaultModel: string; fallbackModel?: string | null };

      if (!isDefaultEligibleModel(generalBody.defaultModel)) {
        return await reply.fail('INVALID_REQUEST', `Invalid model: ${generalBody.defaultModel}. Must be a supported model.`);
      }

      const { userSettingsRepository } = getServices();

      // Verify the user has an API key configured for the defaultModel's provider
      const provider = getProviderForModel(generalBody.defaultModel);
      const settingsResult = await userSettingsRepository.getSettings(params.uid);

      if (!settingsResult.ok) {
        return await reply.fail('INTERNAL_ERROR', settingsResult.error.message);
      }

      const settings = settingsResult.value;
      const llmApiKeys = settings?.llmApiKeys;
      const hasKey = llmApiKeys?.[provider] !== undefined;
      if (!hasKey) {
        return await reply.fail(
          'INVALID_REQUEST',
          `Cannot set default model to ${generalBody.defaultModel}: no API key configured for provider '${provider}'`
        );
      }

      // Validate fallbackModel if provided and not null
      if (generalBody.fallbackModel !== undefined && generalBody.fallbackModel !== null) {
        if (!isDefaultEligibleModel(generalBody.fallbackModel)) {
          return await reply.fail('INVALID_REQUEST', `Invalid fallback model: ${generalBody.fallbackModel}. Must be a supported model.`);
        }
        if (generalBody.fallbackModel === generalBody.defaultModel) {
          return await reply.fail('INVALID_REQUEST', 'Fallback model must be different from the default model.');
        }
        const fallbackProvider = getProviderForModel(generalBody.fallbackModel);
        const hasFallbackKey = llmApiKeys[fallbackProvider] !== undefined;
        if (!hasFallbackKey) {
          return await reply.fail(
            'INVALID_REQUEST',
            `Cannot set fallback model to ${generalBody.fallbackModel}: no API key configured for provider '${fallbackProvider}'`
          );
        }
      }

      const result = await userSettingsRepository.updateLlmPreferences(params.uid, generalBody.defaultModel, generalBody.fallbackModel);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ defaultModel: generalBody.defaultModel, fallbackModel: generalBody.fallbackModel ?? null });
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
              description: 'Transcription provider (e.g. speechmatics)',
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

  // PATCH /users/:uid/settings/timezone
  fastify.patch(
    '/users/:uid/settings/timezone',
    {
      schema: {
        operationId: 'updateTimezonePreference',
        summary: 'Update timezone preference',
        description: 'Update user timezone preference (IANA timezone string).',
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
          required: ['timezone'],
          properties: {
            timezone: {
              type: 'string',
              description: 'IANA timezone string (e.g. Europe/Berlin)',
            },
          },
        },
        response: {
          200: {
            description: 'Timezone preference updated',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  timezone: { type: 'string' },
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
        message: 'Received request to PATCH /users/:uid/settings/timezone',
      });

      const user = await requireAuth(request, reply);
      if (!user) {
        return;
      }

      const params = request.params as { uid: string };
      const body = request.body as { timezone: string };

      if (params.uid !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Cannot update other user settings');
      }

      if (!isValidTimezone(body.timezone)) {
        return await reply.fail('INVALID_REQUEST', `Invalid timezone: ${body.timezone}`);
      }

      const { userSettingsRepository } = getServices();
      const result = await userSettingsRepository.updateTimezone(
        params.uid,
        body.timezone
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ timezone: body.timezone });
    }
  );

  done();
};
