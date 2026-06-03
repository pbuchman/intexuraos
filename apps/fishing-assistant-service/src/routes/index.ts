import type { FastifyInstance } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { registerChatsRoutes } from './chatsRoutes.js';
import { registerDigestsRoutes } from './digestsRoutes.js';
import { registerFoldersRoutes } from './foldersRoutes.js';
import { registerPagesRoutes } from './pagesRoutes.js';

export function fishingAssistantRoutes(app: FastifyInstance): void {
  registerChatsRoutes(app);
  registerDigestsRoutes(app);
  registerFoldersRoutes(app);
  registerPagesRoutes(app);

  app.get(
    '/status',
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
