import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createNote } from '../domain/usecases/createNote.js';
import { getNote } from '../domain/usecases/getNote.js';
import { listNotes } from '../domain/usecases/listNotes.js';
import { updateNote } from '../domain/usecases/updateNote.js';
import { deleteNote } from '../domain/usecases/deleteNote.js';
import type { Note } from '../domain/models/note.js';

interface CreateNoteBody {
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}

interface UpdateNoteBody {
  title?: string;
  content?: string;
  tags?: string[];
}

interface NoteParams {
  id: string;
}

const createNoteBodySchema = {
  type: 'object',
  required: ['title', 'content', 'tags', 'source', 'sourceId'],
  properties: {
    title: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
  },
} as const;

const updateNoteBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const;

const noteParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const noteResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
    sourceId: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

function formatNote(note: Note): object {
  return {
    id: note.id,
    userId: note.userId,
    title: note.title,
    content: note.content,
    tags: note.tags,
    source: note.source,
    sourceId: note.sourceId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export const noteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/notes',
    {
      schema: {
        operationId: 'listNotes',
        summary: 'List notes',
        description: 'List all notes for the authenticated user.',
        tags: ['notes'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of notes',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: noteResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { noteRepository } = getServices();
      const result = await listNotes({ noteRepository, logger: request.log }, user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value.map(formatNote));
    }
  );

  fastify.post<{ Body: CreateNoteBody }>(
    '/notes',
    {
      schema: {
        operationId: 'createNote',
        summary: 'Create note',
        description: 'Create a new note.',
        tags: ['notes'],
        security: [{ bearerAuth: [] }],
        body: createNoteBodySchema,
        response: {
          201: {
            description: 'Created note',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: noteResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateNoteBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { noteRepository } = getServices();
      const result = await createNote(
        { noteRepository, logger: request.log },
        { ...request.body, userId: user.userId }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      void reply.status(201);
      return await reply.ok(formatNote(result.value));
    }
  );

  fastify.get<{ Params: NoteParams }>(
    '/notes/:id',
    {
      schema: {
        operationId: 'getNote',
        summary: 'Get note',
        description: 'Get a specific note by ID.',
        tags: ['notes'],
        security: [{ bearerAuth: [] }],
        params: noteParamsSchema,
        response: {
          200: {
            description: 'Note',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: noteResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: NoteParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { noteRepository } = getServices();
      const result = await getNote(
        { noteRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Note not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatNote(result.value));
    }
  );

  fastify.patch<{ Params: NoteParams; Body: UpdateNoteBody }>(
    '/notes/:id',
    {
      schema: {
        operationId: 'updateNote',
        summary: 'Update note',
        description: 'Update an existing note.',
        tags: ['notes'],
        security: [{ bearerAuth: [] }],
        params: noteParamsSchema,
        body: updateNoteBodySchema,
        response: {
          200: {
            description: 'Updated note',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: noteResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: NoteParams; Body: UpdateNoteBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { noteRepository } = getServices();
      const result = await updateNote(
        { noteRepository, logger: request.log },
        request.params.id,
        user.userId,
        request.body
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Note not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatNote(result.value));
    }
  );

  fastify.delete<{ Params: NoteParams }>(
    '/notes/:id',
    {
      schema: {
        operationId: 'deleteNote',
        summary: 'Delete note',
        description: 'Delete a note.',
        tags: ['notes'],
        security: [{ bearerAuth: [] }],
        params: noteParamsSchema,
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
    async (request: FastifyRequest<{ Params: NoteParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { noteRepository } = getServices();
      const result = await deleteNote(
        { noteRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Note not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({});
    }
  );

  done();
};
