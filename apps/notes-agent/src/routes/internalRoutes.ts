import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import type { ServiceFeedback } from '@intexuraos/common-core';
import { ServiceErrorCodes } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import { createNote } from '../domain/usecases/createNote.js';
import type { NoteStatus } from '../domain/models/note.js';

interface CreateNoteBody {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  status?: NoteStatus;
  source: string;
  sourceId: string;
}

const noteStatusEnum = ['draft', 'active'];

const createNoteBodySchema = {
  type: 'object',
  required: ['userId', 'title', 'content', 'tags', 'source', 'sourceId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: noteStatusEnum },
    source: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
  },
} as const;

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
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['status', 'message'],
                properties: {
                  status: { type: 'string', enum: ['failed'] },
                  message: { type: 'string', description: 'Error message' },
                  errorCode: { type: 'string', description: 'Error code for debugging' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
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
      const result = await createNote({ noteRepository, logger: request.log }, {
        ...request.body,
        status: request.body.status,
      });

      if (!result.ok) {
        const feedback: ServiceFeedback = {
          status: 'failed',
          message: result.error.message,
          errorCode: ServiceErrorCodes.EXTERNAL_API_ERROR,
        };
        void reply.status(500);
        return await reply.ok(feedback);
      }

      const note = result.value;
      const noteId = note.id;
      const resourceUrl = `/#/notes/${noteId}`;

      const feedback: ServiceFeedback = {
        status: 'completed',
        message: `Note "${note.title}" created successfully`,
        resourceUrl,
      };

      void reply.status(201);
      return await reply.ok(feedback);
    }
  );

  done();
};
