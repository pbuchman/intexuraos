import type { FastifyInstance } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  createKnowledgePage,
  reindexKnowledgePage,
  updateKnowledgePage,
} from '../domain/usecases/indexKnowledgePage.js';
import { sendKnowledgeError } from './routeErrors.js';
import { withAuth } from './authRoute.js';

interface PageBody {
  folderId?: string;
  rawText?: string;
}

function parsePageBody(body: unknown): PageBody {
  return body !== null && typeof body === 'object' ? (body as PageBody) : {};
}

function getIndexingDeps(): Parameters<typeof createKnowledgePage>[0] {
  const services = getServices();
  return {
    pageRepository: services.repositories.pageRepository,
    chunkRepository: services.repositories.chunkRepository,
    embeddingClient: services.embeddingClient,
    generateId: services.generateId,
  };
}

export function registerPagesRoutes(app: FastifyInstance): void {
  app.get('/fishing/pages', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const query = request.query as { folderId?: string };
      const result = await getServices().repositories.pageRepository.listByUserId({
        userId: user.userId,
        ...(query.folderId !== undefined ? { folderId: query.folderId } : {}),
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ items: result.value });
    });
  });

  app.post('/fishing/pages', async (request, reply) => {
    logIncomingRequest(request, { bodyPreviewLength: 0 });
    return await withAuth(request, reply, async (user) => {
      const body = parsePageBody(request.body);
      if (body.folderId === undefined || body.folderId === '') {
        return await reply.fail('INVALID_REQUEST', 'Folder id is required.');
      }
      if (body.rawText === undefined || body.rawText.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'Page text is required.');
      }

      const result = await createKnowledgePage(getIndexingDeps(), {
        userId: user.userId,
        folderId: body.folderId,
        rawText: body.rawText,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ page: result.value });
    });
  });

  app.get('/fishing/pages/:pageId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { pageId: string };
      const result = await getServices().repositories.pageRepository.getByIdForUser({
        userId: user.userId,
        pageId: params.pageId,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      if (result.value === null) return await reply.fail('NOT_FOUND', `Fishing knowledge page ${params.pageId} not found`);
      return await reply.ok({ page: result.value });
    });
  });

  app.patch('/fishing/pages/:pageId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true, bodyPreviewLength: 0 });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { pageId: string };
      const body = parsePageBody(request.body);
      if (body.rawText === undefined || body.rawText.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'Page text is required.');
      }

      const result = await updateKnowledgePage(getIndexingDeps(), {
        userId: user.userId,
        pageId: params.pageId,
        rawText: body.rawText,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ page: result.value });
    });
  });

  app.delete('/fishing/pages/:pageId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { pageId: string };
      const result = await getServices().repositories.pageRepository.deleteForUser({
        userId: user.userId,
        pageId: params.pageId,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ deleted: true });
    });
  });

  app.post('/fishing/pages/:pageId/reindex', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { pageId: string };
      const result = await reindexKnowledgePage(getIndexingDeps(), {
        userId: user.userId,
        pageId: params.pageId,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ page: result.value });
    });
  });
}
