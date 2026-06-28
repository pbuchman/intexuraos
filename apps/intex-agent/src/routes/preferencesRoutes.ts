import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';
import {
  DEFAULT_EXTERNAL_SAVE_SOURCE,
  MASKED_EXTERNAL_SAVE_SECRET,
  type IntexAgentExternalSavePreferences,
  type IntexAgentPreferences,
} from '../domain/preferences/types.js';

const MAX_INSTRUCTIONS_LENGTH = 5000;

const putPreferencesBodySchema = {
  type: 'object',
  required: ['instructions'],
  properties: {
    instructions: { type: 'string', maxLength: MAX_INSTRUCTIONS_LENGTH },
    externalSave: {
      type: 'object',
      required: ['enabled', 'endpointUrl', 'cfAccessClientId', 'cfAccessClientSecret', 'source'],
      properties: {
        enabled: { type: 'boolean' },
        endpointUrl: { type: 'string' },
        cfAccessClientId: { type: 'string' },
        cfAccessClientSecret: { type: 'string' },
        source: { type: 'string' },
      },
    },
  },
} as const;

function normalizeInstructions(value: string): string {
  return value.trim();
}

interface ExternalSaveRequestBody {
  enabled: boolean;
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
}

interface PutPreferencesBody {
  instructions: string;
  externalSave?: ExternalSaveRequestBody;
}

export const preferencesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/preferences',
    {
      schema: {
        operationId: 'getIntexAgentPreferences',
        summary: 'Get INTEX Agent preferences',
        description: 'Get per-user instructions/preferences injected into the INTEX Agent prompt.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { preferencesRepository } = getServices();
      const preferences = await preferencesRepository.getPreferences(user.userId);
      return await reply.ok(toPreferencesResponse(preferences));
    }
  );

  fastify.put<{ Body: PutPreferencesBody }>(
    '/preferences',
    {
      schema: {
        operationId: 'saveIntexAgentPreferences',
        summary: 'Save INTEX Agent preferences',
        description:
          'Save per-user instructions/preferences injected into the INTEX Agent prompt. Overwrites existing preferences for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        body: putPreferencesBodySchema,
      },
    },
    async (request: FastifyRequest<{ Body: PutPreferencesBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const instructions = normalizeInstructions(request.body.instructions);
      const { preferencesRepository } = getServices();
      const existing = await preferencesRepository.getPreferences(user.userId);
      const externalSaveResult = normalizeExternalSave(request.body.externalSave, existing);
      if (!externalSaveResult.ok) {
        return await reply.fail('INVALID_REQUEST', externalSaveResult.message);
      }

      if (instructions === '' && externalSaveResult.value === undefined) {
        return await reply.fail(
          'INVALID_REQUEST',
          'instructions cannot be empty. Send DELETE /preferences to clear preferences.'
        );
      }

      const saved = await preferencesRepository.savePreferences(user.userId, {
        instructions,
        ...(externalSaveResult.value !== undefined
          ? { externalSave: externalSaveResult.value }
          : {}),
      });
      return await reply.ok(toPreferencesResponse(saved));
    }
  );

  fastify.post<{ Body: { externalSave?: ExternalSaveRequestBody } }>(
    '/preferences/external-save/test',
    {
      schema: {
        operationId: 'testIntexAgentExternalSave',
        summary: 'Test INTEX Agent external save connection',
        description:
          'Test the authenticated user external-save endpoint using configured Cloudflare Access credentials.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            externalSave: putPreferencesBodySchema.properties.externalSave,
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { externalSave?: ExternalSaveRequestBody } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { preferencesRepository, externalSaveTester } = getServices();
      const preferences = await preferencesRepository.getPreferences(user.userId);
      const externalSave =
        request.body.externalSave !== undefined
          ? resolveExternalSaveForTest(request.body.externalSave, preferences)
          : preferences?.externalSave;
      if (externalSave === null) {
        return await reply.fail('INVALID_REQUEST', 'External save is not fully configured');
      }
      if (externalSave === undefined || !isExternalSaveReady(externalSave)) {
        return await reply.fail('INVALID_REQUEST', 'External save is not fully configured');
      }

      const result = await externalSaveTester.testConnection(externalSave);
      return await reply.ok({
        status: result.status,
        message: result.message,
      });
    }
  );

  fastify.delete(
    '/preferences',
    {
      schema: {
        operationId: 'clearIntexAgentPreferences',
        summary: 'Clear INTEX Agent preferences',
        description:
          'Clear per-user instructions/preferences for the INTEX Agent prompt.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { preferencesRepository } = getServices();
      await preferencesRepository.deletePreferences(user.userId);
      return await reply.ok(toPreferencesResponse(null));
    }
  );

  done();
};

export const preferencesRouteConfig = {
  MAX_INSTRUCTIONS_LENGTH,
} as const;

function toPreferencesResponse(preferences: IntexAgentPreferences | null): {
  instructions: string;
  externalSave: ExternalSaveRequestBody;
  updatedAt: string | null;
} {
  return {
    instructions: preferences?.instructions ?? '',
    externalSave: maskExternalSave(preferences?.externalSave),
    updatedAt: preferences?.updatedAt ?? null,
  };
}

function maskExternalSave(
  externalSave: IntexAgentExternalSavePreferences | undefined
): ExternalSaveRequestBody {
  if (externalSave === undefined) {
    return {
      enabled: false,
      endpointUrl: '',
      cfAccessClientId: '',
      cfAccessClientSecret: '',
      source: DEFAULT_EXTERNAL_SAVE_SOURCE,
    };
  }

  return {
    enabled: externalSave.enabled,
    endpointUrl: externalSave.endpointUrl,
    cfAccessClientId: externalSave.cfAccessClientId,
    cfAccessClientSecret:
      externalSave.cfAccessClientSecret.trim() === '' ? '' : MASKED_EXTERNAL_SAVE_SECRET,
    source: externalSave.source,
  };
}

function normalizeExternalSave(
  input: ExternalSaveRequestBody | undefined,
  existing: IntexAgentPreferences | null
): { ok: true; value: IntexAgentExternalSavePreferences | undefined } | { ok: false; message: string } {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  const secret = resolveExternalSaveSecret(input.cfAccessClientSecret, existing?.externalSave);
  const externalSave: IntexAgentExternalSavePreferences = {
    enabled: input.enabled,
    endpointUrl: input.endpointUrl.trim(),
    cfAccessClientId: input.cfAccessClientId.trim(),
    cfAccessClientSecret: secret,
    source: input.source.trim() === '' ? DEFAULT_EXTERNAL_SAVE_SOURCE : input.source.trim(),
  };

  if (externalSave.enabled && !isExternalSaveReady(externalSave)) {
    return {
      ok: false,
      message:
        'externalSave endpointUrl, cfAccessClientId, cfAccessClientSecret, and source are required when enabled',
    };
  }

  return { ok: true, value: externalSave };
}

function resolveExternalSaveSecret(
  inputSecret: string,
  existing: IntexAgentExternalSavePreferences | undefined
): string {
  if (inputSecret === MASKED_EXTERNAL_SAVE_SECRET && existing !== undefined) {
    return existing.cfAccessClientSecret;
  }
  return inputSecret.trim();
}

function isExternalSaveReady(externalSave: IntexAgentExternalSavePreferences): boolean {
  return (
    externalSave.enabled &&
    externalSave.endpointUrl.trim() !== '' &&
    externalSave.cfAccessClientId.trim() !== '' &&
    externalSave.cfAccessClientSecret.trim() !== '' &&
    externalSave.source.trim() !== ''
  );
}

function resolveExternalSaveForTest(
  input: ExternalSaveRequestBody,
  existing: IntexAgentPreferences | null
): IntexAgentExternalSavePreferences | null {
  const normalized = normalizeExternalSave(input, existing);
  if (!normalized.ok || normalized.value === undefined) {
    return null;
  }
  return normalized.value;
}
