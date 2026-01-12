import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createTodo } from '../domain/usecases/createTodo.js';
import { getTodo } from '../domain/usecases/getTodo.js';
import { listTodos } from '../domain/usecases/listTodos.js';
import { updateTodo } from '../domain/usecases/updateTodo.js';
import { deleteTodo } from '../domain/usecases/deleteTodo.js';
import { addTodoItem } from '../domain/usecases/addTodoItem.js';
import { updateTodoItem } from '../domain/usecases/updateTodoItem.js';
import { deleteTodoItem } from '../domain/usecases/deleteTodoItem.js';
import { reorderTodoItems } from '../domain/usecases/reorderTodoItems.js';
import { archiveTodo } from '../domain/usecases/archiveTodo.js';
import { unarchiveTodo } from '../domain/usecases/unarchiveTodo.js';
import { cancelTodo } from '../domain/usecases/cancelTodo.js';
import type { Todo, TodoItem, TodoStatus, TodoItemStatus, TodoPriority } from '../domain/models/todo.js';

interface CreateTodoBody {
  title: string;
  description?: string | null;
  tags: string[];
  priority?: TodoPriority;
  dueDate?: string | null;
  source: string;
  sourceId: string;
  items?: { title: string; priority?: TodoPriority | null; dueDate?: string | null }[];
}

interface UpdateTodoBody {
  title?: string;
  description?: string | null;
  tags?: string[];
  priority?: TodoPriority;
  dueDate?: string | null;
}

interface TodoParams {
  id: string;
}

interface TodoItemParams {
  id: string;
  itemId: string;
}

interface ListTodosQuery {
  status?: TodoStatus;
  archived?: string;
  priority?: TodoPriority;
  tags?: string;
}

interface CreateTodoItemBody {
  title: string;
  priority?: TodoPriority | null;
  dueDate?: string | null;
}

interface UpdateTodoItemBody {
  title?: string;
  status?: TodoItemStatus;
  priority?: TodoPriority | null;
  dueDate?: string | null;
}

interface ReorderItemsBody {
  itemIds: string[];
}

const todoStatusEnum = ['draft', 'processing', 'pending', 'in_progress', 'completed', 'cancelled'];
const todoItemStatusEnum = ['pending', 'completed'];
const todoPriorityEnum = ['low', 'medium', 'high', 'urgent'];

const createTodoBodySchema = {
  type: 'object',
  required: ['title', 'tags', 'source', 'sourceId'],
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: todoPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
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

const updateTodoBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: todoPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

const todoParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const todoItemParamsSchema = {
  type: 'object',
  required: ['id', 'itemId'],
  properties: {
    id: { type: 'string' },
    itemId: { type: 'string' },
  },
} as const;

const listTodosQuerySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: todoStatusEnum },
    archived: { type: 'string', enum: ['true', 'false'] },
    priority: { type: 'string', enum: todoPriorityEnum },
    tags: { type: 'string' },
  },
} as const;

const createTodoItemBodySchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1 },
    priority: { type: ['string', 'null'], enum: [...todoPriorityEnum, null] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

const updateTodoItemBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: todoItemStatusEnum },
    priority: { type: ['string', 'null'], enum: [...todoPriorityEnum, null] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

const reorderItemsBodySchema = {
  type: 'object',
  required: ['itemIds'],
  properties: {
    itemIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

const todoItemResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string', enum: todoItemStatusEnum },
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

export const todoRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: ListTodosQuery }>(
    '/todos',
    {
      schema: {
        operationId: 'listTodos',
        summary: 'List todos',
        description: 'List all todos for the authenticated user.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        querystring: listTodosQuerySchema,
        response: {
          200: {
            description: 'List of todos',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: todoResponseSchema },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListTodosQuery }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const filters = {
        status: request.query.status,
        archived:
          request.query.archived === 'true'
            ? true
            : request.query.archived === 'false'
              ? false
              : undefined,
        priority: request.query.priority,
        tags: request.query.tags !== undefined ? request.query.tags.split(',') : undefined,
      };

      const result = await listTodos({ todoRepository, logger: request.log }, user.userId, filters);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value.map(formatTodo));
    }
  );

  fastify.post<{ Body: CreateTodoBody }>(
    '/todos',
    {
      schema: {
        operationId: 'createTodo',
        summary: 'Create todo',
        description: 'Create a new todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        body: createTodoBodySchema,
        response: {
          201: {
            description: 'Created todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateTodoBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await createTodo(
        { todoRepository, logger: request.log },
        {
          userId: user.userId,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          priority: request.body.priority,
          dueDate: parseDate(request.body.dueDate),
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

      void reply.status(201);
      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.get<{ Params: TodoParams }>(
    '/todos/:id',
    {
      schema: {
        operationId: 'getTodo',
        summary: 'Get todo',
        description: 'Get a specific todo by ID.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        response: {
          200: {
            description: 'Todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await getTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.patch<{ Params: TodoParams; Body: UpdateTodoBody }>(
    '/todos/:id',
    {
      schema: {
        operationId: 'updateTodo',
        summary: 'Update todo',
        description: 'Update an existing todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        body: updateTodoBodySchema,
        response: {
          200: {
            description: 'Updated todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: TodoParams; Body: UpdateTodoBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await updateTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId,
        {
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          priority: request.body.priority,
          dueDate: request.body.dueDate !== undefined ? parseDate(request.body.dueDate) : undefined,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.delete<{ Params: TodoParams }>(
    '/todos/:id',
    {
      schema: {
        operationId: 'deleteTodo',
        summary: 'Delete todo',
        description: 'Delete a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        response: {
          200: {
            description: 'Deletion confirmed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await deleteTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({});
    }
  );

  fastify.post<{ Params: TodoParams; Body: CreateTodoItemBody }>(
    '/todos/:id/items',
    {
      schema: {
        operationId: 'addTodoItem',
        summary: 'Add item to todo',
        description: 'Add a new item to a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        body: createTodoItemBodySchema,
        response: {
          201: {
            description: 'Updated todo with new item',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: TodoParams; Body: CreateTodoItemBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await addTodoItem(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId,
        {
          title: request.body.title,
          priority: request.body.priority,
          dueDate: parseDate(request.body.dueDate),
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      void reply.status(201);
      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.patch<{ Params: TodoItemParams; Body: UpdateTodoItemBody }>(
    '/todos/:id/items/:itemId',
    {
      schema: {
        operationId: 'updateTodoItem',
        summary: 'Update todo item',
        description: 'Update an item within a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoItemParamsSchema,
        body: updateTodoItemBodySchema,
        response: {
          200: {
            description: 'Updated todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: TodoItemParams; Body: UpdateTodoItemBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await updateTodoItem(
        { todoRepository, logger: request.log },
        request.params.id,
        request.params.itemId,
        user.userId,
        {
          title: request.body.title,
          status: request.body.status,
          priority: request.body.priority,
          dueDate: request.body.dueDate !== undefined ? parseDate(request.body.dueDate) : undefined,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.delete<{ Params: TodoItemParams }>(
    '/todos/:id/items/:itemId',
    {
      schema: {
        operationId: 'deleteTodoItem',
        summary: 'Delete todo item',
        description: 'Delete an item from a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoItemParamsSchema,
        response: {
          200: {
            description: 'Updated todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoItemParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await deleteTodoItem(
        { todoRepository, logger: request.log },
        request.params.id,
        request.params.itemId,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.post<{ Params: TodoParams; Body: ReorderItemsBody }>(
    '/todos/:id/items/reorder',
    {
      schema: {
        operationId: 'reorderTodoItems',
        summary: 'Reorder todo items',
        description: 'Reorder items within a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        body: reorderItemsBodySchema,
        response: {
          200: {
            description: 'Updated todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: TodoParams; Body: ReorderItemsBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await reorderTodoItems(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId,
        { itemIds: request.body.itemIds }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        if (result.error.code === 'INVALID_OPERATION') {
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.post<{ Params: TodoParams }>(
    '/todos/:id/archive',
    {
      schema: {
        operationId: 'archiveTodo',
        summary: 'Archive todo',
        description: 'Archive a completed or cancelled todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        response: {
          200: {
            description: 'Archived todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await archiveTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        if (result.error.code === 'INVALID_OPERATION') {
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.post<{ Params: TodoParams }>(
    '/todos/:id/unarchive',
    {
      schema: {
        operationId: 'unarchiveTodo',
        summary: 'Unarchive todo',
        description: 'Unarchive a todo.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        response: {
          200: {
            description: 'Unarchived todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await unarchiveTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  fastify.post<{ Params: TodoParams }>(
    '/todos/:id/cancel',
    {
      schema: {
        operationId: 'cancelTodo',
        summary: 'Cancel todo',
        description: 'Cancel a todo. Completed todos cannot be cancelled.',
        tags: ['todos'],
        security: [{ bearerAuth: [] }],
        params: todoParamsSchema,
        response: {
          200: {
            description: 'Cancelled todo',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: todoResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { todoRepository } = getServices();
      const result = await cancelTodo(
        { todoRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Todo not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        if (result.error.code === 'INVALID_OPERATION') {
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatTodo(result.value));
    }
  );

  done();
};
