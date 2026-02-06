/**
 * Chat Routes
 *
 * POST   /chat                      - Send a message and get a response
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, tryAuth } from '@intexuraos/common-http';
import { getServices, createChatClient } from '../services.js';
import { generateResponse } from '../domain/usecases/generateResponse.js';
import type { SuggestedAction, ConversationHistory } from '../domain/index.js';

// Error codes for chat operations - must use standard ErrorCode values
type ChatErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED';

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
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              minLength: 1,
            },
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
            pendingAction: {
              type: ['object', 'null'],
              properties: {
                type: { type: 'string' },
                payload: {
                  type: 'object',
                  additionalProperties: true,
                },
                awaitingConfirmation: { type: 'boolean' },
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
                      payload: {
                        type: 'object',
                        additionalProperties: true,
                      },
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

      // Validate request body
      const body = request.body as {
        message: string;
        conversationHistory?: ConversationHistory[];
        pendingAction?: SuggestedAction;
      };

      // Try to authenticate - returns null if no valid auth token
      const user = await tryAuth(request);

      let chatClient;
      let userId: string;
      let guestSessionId: string | null = null;

      if (user !== null) {
        // AUTHENTICATED USER - use their LLM client
        userId = user.userId;

        const llmClientResult = await getServices().userServiceClient.getLlmClient(userId);
        if (!llmClientResult.ok) {
          return await reply.fail('DOWNSTREAM_ERROR', llmClientResult.error.message);
        }

        chatClient = createChatClient({
          llmClient: llmClientResult.value, // @allow-result-access -- guarded by !llmClientResult.ok check above
          logger: getServices().logger,
        });
      } else {
        // GUEST USER - use platform GLM client with rate limiting
        const sessionHeader = request.headers['x-guest-session'];
        guestSessionId =
          typeof sessionHeader === 'string' ? sessionHeader : null;

        if (guestSessionId === null || guestSessionId.length === 0) {
          return await reply.fail('UNAUTHORIZED', 'Authentication required or guest session ID missing');
        }

        // Check rate limit
        const rateLimitResult = getServices().guestRateLimiter.check(guestSessionId);
        if (!rateLimitResult.ok) {
          return await reply.fail('RATE_LIMITED', rateLimitResult.error.message);
        }

        userId = 'guest';
        chatClient = createChatClient({
          llmClient: getServices().guestLlmClient,
          logger: getServices().logger,
        });
      }

      // Call generateResponse use case
      const result = await generateResponse(
        {
          llmClient: chatClient,
          searchDocumentation: {
            embeddingRepository: getServices().embeddingRepository,
            embeddingClient: getServices().embeddingClient,
            logger: getServices().logger,
          },
          logger: getServices().logger,
        },
        {
          message: body.message,
          conversationHistory: body.conversationHistory ?? [],
          userId,
          ...(body.pendingAction !== undefined && { pendingAction: body.pendingAction }),
        }
      );

      // Record guest usage after successful response
      if (guestSessionId !== null) {
        getServices().guestRateLimiter.record(guestSessionId);
      }

      if (!result.ok) {
        /* v8 ignore start -- upstream: Fallback for unknown error codes from domain layer @preserve */
        // Map domain error codes to standard error codes
        const errorMap: Record<string, ChatErrorCode> = {
          LLM_ERROR: 'DOWNSTREAM_ERROR',
          SEARCH_ERROR: 'DOWNSTREAM_ERROR',
          INVALID_REQUEST: 'INVALID_REQUEST',
          EMPTY_MESSAGE: 'INVALID_REQUEST',
        };
        const errorCode = errorMap[result.error.code] ?? 'INTERNAL_ERROR';
        return await reply.fail(errorCode, result.error.message);
        /* v8 ignore stop @preserve */
      }

      return await reply.ok({
        response: result.value.response, // @allow-result-access -- guarded by !result.ok check above
        sources: result.value.sources, // @allow-result-access -- guarded by !result.ok check above
        suggestedAction: result.value.suggestedAction ?? null, // @allow-result-access -- guarded by !result.ok check above
      });
    }
  );

  done();
};
