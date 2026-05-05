import type { FastifyInstance } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { registerFoldersRoutes } from './foldersRoutes.js';
import { registerPagesRoutes } from './pagesRoutes.js';

export function fishingAssistantRoutes(app: FastifyInstance): void {
  registerFoldersRoutes(app);
  registerPagesRoutes(app);

  app.get(
    '/fishing-assistant/status',
    {
      schema: {
        description: 'Fishing Assistant service status',
        tags: ['fishing-assistant'],
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received Fishing Assistant status request',
      });

      return await reply.ok({
        service: 'fishing-assistant-service',
        status: 'ready',
      });
    }
  );
}
