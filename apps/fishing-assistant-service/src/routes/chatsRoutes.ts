import type { FastifyInstance } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { sendChatError } from './chatRouteErrors.js';
import { withAuth } from './authRoute.js';
import { sendChatMessage } from '../domain/usecases/sendChatMessage.js';

interface ChatMessageBody {
  message?: string;
}

function parseChatMessageBody(body: unknown): ChatMessageBody {
  return body !== null && typeof body === 'object' ? (body as ChatMessageBody) : {};
}

export function registerChatsRoutes(app: FastifyInstance): void {
  app.get('/fishing/chats', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const result = await getServices().chatRepository.listChatsByUserId(user.userId);
      if (!result.ok) return await sendChatError(reply, result.error);
      return await reply.ok({ items: result.value });
    });
  });

  app.post('/fishing/chats', async (request, reply) => {
    logIncomingRequest(request);
    return await withAuth(request, reply, async (user) => {
      const result = await getServices().chatRepository.createChat({
        id: getServices().generateId(),
        userId: user.userId,
        title: 'New Chat',
      });
      if (!result.ok) return await sendChatError(reply, result.error);
      return await reply.ok({ chat: result.value });
    });
  });

  app.get('/fishing/chats/:chatId', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { chatId: string };
      const result = await getServices().chatRepository.getChatByIdForUser({
        userId: user.userId,
        chatId: params.chatId,
      });
      if (!result.ok) return await sendChatError(reply, result.error);
      if (result.value === null) {
        return await reply.fail('NOT_FOUND', `Fishing chat ${params.chatId} not found`);
      }
      return await reply.ok({ chat: result.value });
    });
  });

  app.get('/fishing/chats/:chatId/messages', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { chatId: string };
      const result = await getServices().chatRepository.listMessagesForChat({
        userId: user.userId,
        chatId: params.chatId,
      });
      if (!result.ok) return await sendChatError(reply, result.error);
      return await reply.ok({ items: result.value });
    });
  });

  app.post('/fishing/chats/:chatId/messages', async (request, reply) => {
    logIncomingRequest(request, { includeParams: true, bodyPreviewLength: 0 });
    return await withAuth(request, reply, async (user) => {
      const params = request.params as { chatId: string };
      const body = parseChatMessageBody(request.body);
      if (body.message === undefined || body.message.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'message is required.');
      }

      const result = await sendChatMessage(
        {
          chatRepository: getServices().chatRepository,
          chatAdapter: getServices().chatAdapter,
          embeddingClient: getServices().embeddingClient,
          chunkRepository: getServices().repositories.chunkRepository,
          pageRepository: getServices().repositories.pageRepository,
          mobileNotificationsClient: getServices().mobileNotificationsClient,
          generateId: getServices().generateId,
          now: new Date(),
        },
        {
          userId: user.userId,
          chatId: params.chatId,
          message: body.message.trim(),
        }
      );
      if (!result.ok) return await sendChatError(reply, result.error);
      return await reply.ok(result.value);
    });
  });
}
