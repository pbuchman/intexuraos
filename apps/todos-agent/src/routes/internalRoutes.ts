import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { ServiceFeedback } from '@intexuraos/common-core';
import { ServiceErrorCodes } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { createTodo } from '../domain/usecases/createTodo.js';
import type { TodoPriority, TodoStatus } from '../domain/models/todo.js';

interface CreateTodoBody {
  userId: string;
  title: string;
  description?: string | null;
  tags: string[];
  priority?: TodoPriority;
  dueDate?: string | null;
  status?: TodoStatus;
  source: string;
  sourceId: string;
  items?: { title: string; priority?: TodoPriority | null; dueDate?: string | null }[];
}

const todoPriorityEnum = ['low', 'medium', 'high', 'urgent'];
const todoStatusEnum = ['draft', 'processing', 'pending', 'in_progress', 'completed', 'cancelled'];

const createTodoBodySchema = {
  type: 'object',
  required: ['userId', 'title', 'tags', 'source', 'sourceId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: todoPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: todoStatusEnum },
    source: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          priority: { type: ['string', 'null'], enum: [...todoPriorityEnum, null] },
          dueDate: { type: ['string', 'null'], format: 'date-time' },
        },
      },
    },
  },
} as const;

function parseDate(dateStr: string | null | undefined): Date | null {
  if (dateStr === null || dateStr === undefined) {
    return null;
  }
  return new Date(dateStr);
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateTodoBody }>(
    '/internal/todos',
    {
      schema: {
        operationId: 'createTodoInternal',
        summary: 'Create todo (internal)',
        description: 'Internal endpoint for creating todos from other services.',
        tags: ['internal'],
        body: createTodoBodySchema,
        response: {
          201: {
            description: 'Created todo',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  message: { type: 'string', description: 'Human-readable feedback message' },
                  resourceUrl: { type: 'string', description: 'URL to created resource (success only)' },
                  errorCode: { type: 'string', description: 'Error code for debugging (failure only)' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateTodoBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/todos',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create todo');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { todoRepository, todosProcessingPublisher } = getServices();
      const result = await createTodo(
        { todoRepository, logger: request.log },
        {
          userId: request.body.userId,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          priority: request.body.priority,
          dueDate: parseDate(request.body.dueDate),
          status: 'processing',
          source: request.body.source,
          sourceId: request.body.sourceId,
          items: request.body.items?.map((item) => ({
            title: item.title,
            priority: item.priority,
            dueDate: parseDate(item.dueDate),
          })),
        }
      );

      if (!result.ok) {
        const feedback: ServiceFeedback = {
          status: 'failed',
          message: result.error.message,
          errorCode: ServiceErrorCodes.EXTERNAL_API_ERROR,
        };
        void reply.status(500);
        return await reply.ok(feedback);
      }

      const todo = result.value;
      const todoId = todo.id;
      const resourceUrl = `/#/todos/${todoId}`;

      const publishResult = await todosProcessingPublisher.publishTodoCreated({
        todoId,
        userId: todo.userId,
        title: todo.title,
      });

      if (!publishResult.ok) {
        request.log.error(
          { todoId, error: publishResult.error },
          'Failed to publish todo processing event'
        );
      } else {
        request.log.info({ todoId }, 'Published todo processing event');
      }

      const feedback: ServiceFeedback = {
        status: 'completed',
        message: `Todo "${todo.title}" created successfully`,
        resourceUrl,
      };

      void reply.status(201);
      return await reply.ok(feedback);
    }
  );

  done();
};
