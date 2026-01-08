import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createNote } from '../domain/usecases/createNote.js';
import type { Note } from '../domain/models/note.js';

interface CreateNoteBody {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  sourceId: string;
}

const createNoteBodySchema = {
  type: 'object',
  required: ['userId', 'title', 'content', 'tags', 'source', 'sourceId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
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

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateNoteBody }>(
    '/internal/notes',
    {
      schema: {
        operationId: 'createNoteInternal',
        summary: 'Create note (internal)',
        description: 'Internal endpoint for creating notes from other services.',
        tags: ['internal'],
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
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/notes',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create note');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { noteRepository } = getServices();
      const result = await createNote({ noteRepository, logger: request.log }, request.body);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      void reply.status(201);
      return await reply.ok(formatNote(result.value));
    }
  );

  done();
};
