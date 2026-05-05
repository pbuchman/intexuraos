import type { FastifyInstance } from 'fastify';

export function fishingAssistantRoutes(app: FastifyInstance): void {
  app.get(
    '/fishing-assistant/status',
    {
      schema: {
        description: 'Fishing Assistant service status',
        tags: ['fishing-assistant'],
      },
    },
    async (_request, reply) => {
      return await reply.ok({
        service: 'fishing-assistant-service',
        status: 'ready',
      });
    }
  );
}
