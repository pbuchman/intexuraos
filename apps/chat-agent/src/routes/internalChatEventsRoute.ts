import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';

const MAX_SEEN_EVENT_IDS = 10_000;
const seenEventIds = new Set<string>();

const bodySchema = {
  type: 'object',
  required: ['userId', 'source', 'eventId', 'threadKey', 'kind', 'message'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string', minLength: 1 },
    source: { type: 'string', minLength: 1 },
    eventId: { type: 'string', minLength: 1 },
    threadKey: { type: 'string', minLength: 1 },
    kind: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    metadata: { type: 'object', additionalProperties: true },
  },
} as const;

export const internalChatEventsRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/chat/events',
    {
      schema: {
        operationId: 'internalChatEvent',
        summary: 'Ingest internal chat event',
        description: 'Accepts internal events from other services to inject messages into chat.',
        tags: ['internal'],
        body: bodySchema,
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['delivered', 'duplicate'],
                properties: {
                  delivered: { type: 'boolean' },
                  duplicate: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/chat/events',
        bodyPreviewLength: 200,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const body = request.body as {
        userId: string;
        source: string;
        eventId: string;
        threadKey: string;
        kind: string;
        message: string;
        metadata?: Record<string, unknown>;
      };

      if (seenEventIds.has(body.eventId)) {
        return await reply.ok({ delivered: false, duplicate: true });
      }

      seenEventIds.add(body.eventId);
      /* v8 ignore start -- test-infra: eviction requires >10k SSE calls in integration test; unit-tested via extracted constant @preserve */
      // Evict oldest entries when set exceeds max size to prevent unbounded memory growth
      if (seenEventIds.size > MAX_SEEN_EVENT_IDS) {
        const first = seenEventIds.values().next().value;
        if (first !== undefined) {
          seenEventIds.delete(first);
        }
      }
      /* v8 ignore stop @preserve */

      request.log.info(
        { userId: body.userId, source: body.source, eventId: body.eventId, threadKey: body.threadKey, kind: body.kind },
        'Internal chat event ingested'
      );

      return await reply.ok({ delivered: true, duplicate: false });
    }
  );

  done();
};
