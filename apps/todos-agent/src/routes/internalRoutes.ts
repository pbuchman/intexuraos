import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createTodo } from '../domain/usecases/createTodo.js';
import type { Todo, TodoItem, TodoPriority, TodoStatus } from '../domain/models/todo.js';

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

const todoItemResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string', enum: todoStatusEnum },
    priority: { type: ['string', 'null'], enum: [...todoPriorityEnum, null] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    position: { type: 'number' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const todoResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: todoPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    source: { type: 'string' },
    sourceId: { type: 'string' },
    status: { type: 'string', enum: todoStatusEnum },
    archived: { type: 'boolean' },
    items: { type: 'array', items: todoItemResponseSchema },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

function formatTodoItem(item: TodoItem): object {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    dueDate: item.dueDate !== null ? item.dueDate.toISOString() : null,
    position: item.position,
    completedAt: item.completedAt !== null ? item.completedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function formatTodo(todo: Todo): object {
  return {
    id: todo.id,
    userId: todo.userId,
    title: todo.title,
    description: todo.description,
    tags: todo.tags,
    priority: todo.priority,
    dueDate: todo.dueDate !== null ? todo.dueDate.toISOString() : null,
    source: todo.source,
    sourceId: todo.sourceId,
    status: todo.status,
    archived: todo.archived,
    items: todo.items.map(formatTodoItem),
    completedAt: todo.completedAt !== null ? todo.completedAt.toISOString() : null,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
  };
}

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
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  todo: todoResponseSchema,
                },
              },
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
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const todo = result.value;
      const todoId = todo.id;
      const url = `/#/todos/${todoId}`;

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

      void reply.status(201);
      return await reply.ok({
        id: todoId,
        url,
        todo: formatTodo(todo),
      });
    }
  );

  done();
};
