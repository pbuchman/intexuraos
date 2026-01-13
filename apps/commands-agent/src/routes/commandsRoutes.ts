import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

const commandSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    sourceType: { type: 'string', enum: ['whatsapp_text', 'whatsapp_voice', 'pwa-shared'] },
    externalId: { type: 'string' },
    text: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    status: {
      type: 'string',
      enum: ['received', 'classified', 'pending_classification', 'failed', 'archived'],
    },
    classification: {
      type: 'object',
      nullable: true,
      properties: {
        type: {
          type: 'string',
          enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'unclassified'],
        },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
        classifiedAt: { type: 'string', format: 'date-time' },
      },
    },
    actionId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'userId',
    'sourceType',
    'externalId',
    'text',
    'timestamp',
    'status',
    'createdAt',
    'updatedAt',
  ],
} as const;

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

      const { commandRepository } = getServices();
      const commands = await commandRepository.listByUserId(user.userId);

      return await reply.ok({ commands });
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

      const { text, source } = request.body as { text: string; source: 'pwa-shared' };
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const externalId = `${String(timestamp)}-${randomSuffix}`;

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
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success'],
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

      const { commandRepository } = getServices();
      const command = await commandRepository.getById(commandId);

      if (command?.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Command not found');
      }

      const deletableStatuses = ['received', 'pending_classification', 'failed'];
      if (!deletableStatuses.includes(command.status)) {
        return await reply.fail(
          'INVALID_REQUEST',
          'Cannot delete classified command. Use archive instead.'
        );
      }

      await commandRepository.delete(commandId);

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
      const { status } = request.body as { status: 'archived' };

      const { commandRepository } = getServices();
      const command = await commandRepository.getById(commandId);

      if (command?.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Command not found');
      }

      if (command.status !== 'classified') {
        return await reply.fail('INVALID_REQUEST', 'Can only archive classified commands');
      }

      command.status = status;
      command.updatedAt = new Date().toISOString();
      await commandRepository.update(command);

      return await reply.ok({ command });
    }
  );

  done();
};
