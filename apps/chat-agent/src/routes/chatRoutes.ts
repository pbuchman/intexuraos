/**
 * Chat Routes
 *
 * POST   /chat                      - Send a message and get a response
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';

export const chatRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /chat
  fastify.post(
    '/chat',
    {
      schema: {
        operationId: 'chat',
        summary: 'Send chat message',
        description: 'Send a message to Intex and get a response.',
        tags: ['chat'],
        body: {
          type: 'object',
          required: ['message', 'conversationHistory'],
          properties: {
            message: { type: 'string' },
            conversationHistory: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['response', 'sources', 'suggestedAction'],
                properties: {
                  response: { type: 'string' },
                  sources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['filePath', 'section'],
                      properties: {
                        filePath: { type: 'string' },
                        section: { type: 'string' },
                      },
                    },
                  },
                  suggestedAction: {
                    type: ['object', 'null'],
                    properties: {
                      type: { type: 'string' },
                      payload: { type: 'object' },
                      awaitingConfirmation: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /chat',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      /* v8 ignore start -- test-infra: requireAuth returns null for auth failure in test environment @preserve */
      if (user === null) {
        return;
      }
      /* v8 ignore stop @preserve */

      // Stub implementation - returns 501 until RAG pipeline is implemented
      return await reply.fail('INTERNAL_ERROR', 'Chat endpoint not yet implemented');
    }
  );

  done();
};
