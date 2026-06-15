import type { FastifyInstance } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { sendKnowledgeError } from './routeErrors.js';
import { withAuth } from './authRoute.js';
import { serializeKnowledgeFolder } from './responseSerializers.js';

interface FolderBody {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
}

function parseFolderBody(body: unknown): FolderBody {
  return body !== null && typeof body === 'object' ? (body as FolderBody) : {};
}

export function registerFoldersRoutes(app: FastifyInstance): void {
  app.get('/folders', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const result = await getServices().repositories.folderRepository.listByUserId(user.userId);
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ items: result.value.map(serializeKnowledgeFolder) });
    });
  });

  app.post('/folders', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const body = parseFolderBody(request.body);
      if (body.name === undefined || body.name.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'Folder name is required.');
      }

      const result = await getServices().repositories.folderRepository.create({
        id: getServices().generateId(),
        userId: user.userId,
        name: body.name.trim(),
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ folder: serializeKnowledgeFolder(result.value) });
    });
  });

  app.patch('/folders/:folderId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { folderId: string };
      const body = parseFolderBody(request.body);
      if (body.name === undefined || body.name.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'Folder name is required.');
      }

      const result = await getServices().repositories.folderRepository.updateForUser({
        id: params.folderId,
        userId: user.userId,
        name: body.name.trim(),
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ folder: serializeKnowledgeFolder(result.value) });
    });
  });

  app.delete('/folders/:folderId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { folderId: string };
      const result = await getServices().repositories.folderRepository.deleteForUser({
        userId: user.userId,
        folderId: params.folderId,
      });
      if (!result.ok) return await sendKnowledgeError(reply, result.error);
      return await reply.ok({ deleted: true });
    });
  });
}
