import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { commandSchema } from './schemas/index.js';

export const commandsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/commands',
    {
      schema: {
        operationId: 'listCommands',
        summary: 'List commands',
        description: 'List commands for the authenticated user.',
        tags: ['commands'],
        response: {
          200: {
            description: 'List of commands',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  commands: {
                    type: 'array',
                    items: commandSchema,
                  },
                },
                required: ['commands'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /commands',
      });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { listCommandsUseCase } = getServices();
      const result = await listCommandsUseCase.execute(user.userId);

      return await reply.ok({ commands: result.commands });
    }
  );

  fastify.post(
    '/commands',
    {
      schema: {
        operationId: 'createCommand',
        summary: 'Create command',
        description: 'Create a new command from a shared text or link.',
        tags: ['commands'],
        body: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1 },
            source: { type: 'string', enum: ['pwa-shared'] },
            externalId: { type: 'string', minLength: 1 },
          },
          required: ['text', 'source'],
        },
        response: {
          201: {
            description: 'Command created',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  command: commandSchema,
                },
                required: ['command'],
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /commands',
      });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { text, source, externalId: clientExternalId } = request.body as {
        text: string;
        source: 'pwa-shared';
        externalId?: string;
      };

      const externalId =
        clientExternalId ?? `${String(Date.now())}-${Math.random().toString(36).substring(2, 9)}`;

      const { processCommandUseCase } = getServices();
      const result = await processCommandUseCase.execute({
        userId: user.userId,
        sourceType: source,
        externalId,
        text,
        timestamp: new Date().toISOString(),
      });

      return await reply.code(201).ok({ command: result.command });
    }
  );

  fastify.delete(
    '/commands/:commandId',
    {
      schema: {
        operationId: 'deleteCommand',
        summary: 'Delete command',
        description:
          'Delete a command. Only allowed for commands with status: received, pending_classification, or failed.',
        tags: ['commands'],
        params: {
          type: 'object',
          properties: {
            commandId: { type: 'string' },
          },
          required: ['commandId'],
        },
        response: {
          200: {
            description: 'Command deleted',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Cannot delete classified command',
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
          404: {
            description: 'Command not found',
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
        message: 'Received request to DELETE /commands/:commandId',
        includeParams: true,
      });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { commandId } = request.params as { commandId: string };

      const { deleteCommandUseCase } = getServices();
      const result = await deleteCommandUseCase.execute(commandId, user.userId);

      if (!result.success) {
        return await reply.fail(
          result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST',
          result.message
        );
      }

      return await reply.ok({});
    }
  );

  fastify.patch(
    '/commands/:commandId',
    {
      schema: {
        operationId: 'archiveCommand',
        summary: 'Archive command',
        description: 'Archive a classified command.',
        tags: ['commands'],
        params: {
          type: 'object',
          properties: {
            commandId: { type: 'string' },
          },
          required: ['commandId'],
        },
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['archived'] },
          },
          required: ['status'],
        },
        response: {
          200: {
            description: 'Command archived',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  command: commandSchema,
                },
                required: ['command'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Cannot archive non-classified command',
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
          404: {
            description: 'Command not found',
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
        message: 'Received request to PATCH /commands/:commandId',
        includeParams: true,
      });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { commandId } = request.params as { commandId: string };

      const { archiveCommandUseCase } = getServices();
      const result = await archiveCommandUseCase.execute(commandId, user.userId);

      if (!result.success) {
        return await reply.fail(
          result.error === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST',
          result.message
        );
      }

      return await reply.ok({ command: result.command });
    }
  );

  done();
};
