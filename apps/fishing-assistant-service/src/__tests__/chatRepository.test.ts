import { describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, type Firestore, Timestamp } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import { createFirestoreChatRepository } from '../infra/firestore/chatRepository.js';
import {
  FISHING_CHATS_COLLECTION,
  FISHING_CHAT_MESSAGES_COLLECTION,
} from '../infra/firestore/collections.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeFirestore(): Firestore {
  return createFakeFirestore() as unknown as Firestore;
}

describe('FirestoreChatRepository', () => {
  it('maps sparse chat and message documents with defensive defaults', async () => {
    const firestore = createFakeFirestore();
    firestore.seedCollection(FISHING_CHATS_COLLECTION, [
      {
        id: 'chat-1',
        data: {
          userId: 'user-1',
          title: 42,
          lastMessagePreview: null,
          lastMessageAt: 'not-a-timestamp',
          createdAt: 'not-a-timestamp',
          updatedAt: 'not-a-timestamp',
        },
      },
    ]);
    firestore.seedCollection(FISHING_CHAT_MESSAGES_COLLECTION, [
      {
        id: 'message-user',
        data: {
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'nonsense',
          content: null,
          citations: 'bad-shape',
          createdAt: 'not-a-timestamp',
          confidence: 'certain',
        },
      },
      {
        id: 'message-assistant',
        data: {
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'assistant',
          content: 'Answer',
          citations: [
            {
              sourceId: 'chunk-1',
              sourceType: 'knowledge_page',
              title: 'Spring Bait',
              quote: 'Use pinka.',
              usedFor: 'bait choice',
              url: '/fishing-assistant/knowledge/pages/page-1',
              date: '2026-05-01',
              pageId: 'page-1',
            },
          ],
          createdAt: Timestamp.now(),
          confidence: 'high',
        },
      },
      {
        id: 'message-plain',
        data: {
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'assistant',
          content: 'Plain answer',
          citations: [
            {
              sourceId: 'chunk-2',
              sourceType: 'knowledge_page',
              title: 'No metadata',
              quote: 'Plain answer',
              usedFor: 'fallback branch',
            },
          ],
          createdAt: Timestamp.now(),
          confidence: 'medium',
        },
      },
      {
        id: 'message-bad-array',
        data: {
          chatId: 'chat-1',
          userId: 'user-1',
          role: 'assistant',
          content: 'Broken citations',
          citations: [null, { sourceId: 'missing-shape' }],
          createdAt: Timestamp.now(),
          confidence: 'low',
        },
      },
    ]);

    const repository = createFirestoreChatRepository({
      firestore: firestore as unknown as Firestore,
      logger,
    });

    const chat = await repository.getChatByIdForUser({ userId: 'user-1', chatId: 'chat-1' });
    const messages = await repository.listMessagesForChat({ userId: 'user-1', chatId: 'chat-1' });

    expect(chat.ok).toBe(true);
    expect(messages.ok).toBe(true);
    if (!chat.ok || !messages.ok) return;

    expect(chat.value).toMatchObject({
      id: 'chat-1',
      userId: 'user-1',
      title: 'New Chat',
      lastMessagePreview: '',
    });
    expect(chat.value?.createdAt.toMillis()).toBe(0);
    expect(chat.value?.updatedAt.toMillis()).toBe(0);
    expect(chat.value?.lastMessageAt.toMillis()).toBe(0);

    expect(messages.value[0]).toMatchObject({
      id: 'message-user',
      chatId: 'chat-1',
      role: 'user',
      content: '',
      citations: [],
    });
    expect(messages.value[0]?.createdAt.toMillis()).toBe(0);
    expect(messages.value[0]).not.toHaveProperty('confidence');
    expect(messages.value[1]).toMatchObject({
      id: 'message-assistant',
      role: 'assistant',
      confidence: 'high',
      citations: [
        expect.objectContaining({
          sourceId: 'chunk-1',
          url: '/fishing-assistant/knowledge/pages/page-1',
          date: '2026-05-01',
          pageId: 'page-1',
        }),
      ],
    });
    expect(messages.value[2]).toMatchObject({
      id: 'message-plain',
      role: 'assistant',
      confidence: 'medium',
      citations: [
        {
          sourceId: 'chunk-2',
          sourceType: 'knowledge_page',
          title: 'No metadata',
          quote: 'Plain answer',
          usedFor: 'fallback branch',
        },
      ],
    });
    expect(messages.value[2]?.citations[0]).not.toHaveProperty('url');
    expect(messages.value[2]?.citations[0]).not.toHaveProperty('pageId');
    expect(messages.value[3]).toMatchObject({
      id: 'message-bad-array',
      role: 'assistant',
      confidence: 'low',
      citations: [],
    });
  });

  it('returns null for missing or foreign chats and NOT_FOUND for foreign message reads', async () => {
    const firestore = createFakeFirestore();
    firestore.seedCollection(FISHING_CHATS_COLLECTION, [
      {
        id: 'chat-foreign',
        data: {
          userId: 'other-user',
          title: 'Foreign',
          lastMessagePreview: '',
          lastMessageAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);

    const repository = createFirestoreChatRepository({
      firestore: firestore as unknown as Firestore,
      logger,
    });

    const missing = await repository.getChatByIdForUser({ userId: 'user-1', chatId: 'missing' });
    const foreign = await repository.getChatByIdForUser({
      userId: 'user-1',
      chatId: 'chat-foreign',
    });
    const foreignMessages = await repository.listMessagesForChat({
      userId: 'user-1',
      chatId: 'chat-foreign',
    });

    expect(missing).toEqual({ ok: true, value: null });
    expect(foreign).toEqual({ ok: true, value: null });
    expect(foreignMessages.ok).toBe(false);
    if (foreignMessages.ok) return;
    expect(foreignMessages.error.code).toBe('NOT_FOUND');
  });

  it('treats malformed chat owners as foreign when reading by id', async () => {
    const firestore = createFakeFirestore();
    firestore.seedCollection(FISHING_CHATS_COLLECTION, [
      {
        id: 'chat-invalid-owner',
        data: {
          userId: 123,
          title: 'Broken',
          lastMessagePreview: '',
          lastMessageAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
    ]);

    const repository = createFirestoreChatRepository({
      firestore: firestore as unknown as Firestore,
      logger,
    });

    const result = await repository.getChatByIdForUser({
      userId: 'user-1',
      chatId: 'chat-invalid-owner',
    });

    expect(result).toEqual({ ok: true, value: null });
  });

  it('updates chats and stores summarized previews for new messages', async () => {
    const repository = createFirestoreChatRepository({ firestore: makeFirestore(), logger });

    const created = await repository.createChat({
      id: 'chat-1',
      userId: 'user-1',
      title: 'New Chat',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await repository.updateChat({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Spring Session',
    });
    const message = await repository.createMessage({
      id: 'message-1',
      chatId: 'chat-1',
      userId: 'user-1',
      role: 'assistant',
      content:
        'This is a deliberately long fishing answer that should be truncated in the chat preview once it exceeds one hundred and twenty characters in length.',
      confidence: 'medium',
      citations: [],
    });
    const chats = await repository.listChatsByUserId('user-1');

    expect(updated.ok).toBe(true);
    expect(message.ok).toBe(true);
    expect(chats.ok).toBe(true);
    if (!updated.ok || !message.ok || !chats.ok) return;

    expect(updated.value.title).toBe('Spring Session');
    expect(message.value.confidence).toBe('medium');
    expect(chats.value[0]?.lastMessagePreview.endsWith('...')).toBe(true);
    expect(chats.value[0]?.lastMessagePreview.length).toBe(120);
  });

  it('returns NOT_FOUND when updating or appending to a missing chat', async () => {
    const repository = createFirestoreChatRepository({ firestore: makeFirestore(), logger });

    const update = await repository.updateChat({
      userId: 'user-1',
      chatId: 'missing',
      title: 'Missing',
    });
    const message = await repository.createMessage({
      id: 'message-1',
      chatId: 'missing',
      userId: 'user-1',
      role: 'user',
      content: 'hello',
    });

    expect(update.ok).toBe(false);
    expect(message.ok).toBe(false);
    if (update.ok || message.ok) return;
    expect(update.error.code).toBe('NOT_FOUND');
    expect(message.error.code).toBe('NOT_FOUND');
  });

  it('returns FIRESTORE_ERROR when the underlying store fails', async () => {
    const fake = createFakeFirestore();
    fake.configure({ errorToThrow: new Error('firestore failed') });
    const repository = createFirestoreChatRepository({
      firestore: fake as unknown as Firestore,
      logger,
    });

    const list = await repository.listChatsByUserId('user-1');
    const get = await repository.getChatByIdForUser({ userId: 'user-1', chatId: 'chat-1' });
    const update = await repository.updateChat({
      userId: 'user-1',
      chatId: 'chat-1',
      title: 'Broken',
    });
    const messages = await repository.listMessagesForChat({
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(list.ok).toBe(false);
    expect(get.ok).toBe(false);
    expect(update.ok).toBe(false);
    expect(messages.ok).toBe(false);
    if (list.ok || get.ok || update.ok || messages.ok) return;
    expect(list.error.code).toBe('FIRESTORE_ERROR');
    expect(get.error.code).toBe('FIRESTORE_ERROR');
    expect(update.error.code).toBe('FIRESTORE_ERROR');
    expect(messages.error.code).toBe('FIRESTORE_ERROR');
  });
});
