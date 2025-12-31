import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

const commandSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    sourceType: { type: 'string', enum: ['whatsapp_text', 'whatsapp_voice'] },
    externalId: { type: 'string' },
    text: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['received', 'classified', 'failed'] },
    classification: {
      type: 'object',
      nullable: true,
      properties: {
        type: {
          type: 'string',
          enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'unclassified'],
        },
        confidence: { type: 'number' },
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

const actionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    commandId: { type: 'string' },
    type: { type: 'string', enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'] },
    confidence: { type: 'number' },
    title: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
    payload: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'userId',
    'commandId',
    'type',
    'confidence',
    'title',
    'status',
    'payload',
    'createdAt',
    'updatedAt',
  ],
} as const;

export const routerRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/router/commands',
    {
      schema: {
        operationId: 'listCommands',
        summary: 'List commands',
        description: 'List commands for the authenticated user.',
        tags: ['router'],
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
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { commandRepository } = getServices();
      const commands = await commandRepository.listByUserId(user.userId);

      return await reply.ok({ commands });
    }
  );

  fastify.get(
    '/router/actions',
    {
      schema: {
        operationId: 'listActions',
        summary: 'List actions',
        description: 'List actions for the authenticated user.',
        tags: ['router'],
        response: {
          200: {
            description: 'List of actions',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: actionSchema,
                  },
                },
                required: ['actions'],
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
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { actionRepository } = getServices();
      const actions = await actionRepository.listByUserId(user.userId);

      return await reply.ok({ actions });
    }
  );

  done();
};
