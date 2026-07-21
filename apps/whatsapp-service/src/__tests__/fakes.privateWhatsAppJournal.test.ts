import { describe, expect, it } from 'vitest';
import type { StorePrivateWhatsAppMessageInput } from '../domain/whatsapp/index.js';
import { FakePrivateWhatsAppRepository } from './fakes.js';

const USER_ID = 'user-journal';
const SOURCE_ACCOUNT_ID = 'source-journal';
const CHAT_ID = `chat:${SOURCE_ACCOUNT_ID}:!journal-room`;

function message(
  matrixEventId: string,
  overrides: Partial<StorePrivateWhatsAppMessageInput['message']> = {}
): StorePrivateWhatsAppMessageInput {
  return {
    sourceAccountId: SOURCE_ACCOUNT_ID,
    userId: USER_ID,
    deliveryMode: 'live',
    receivedAt: '2026-07-21T08:00:01.000Z',
    chat: { matrixRoomId: '!journal-room', type: 'direct', displayName: 'Test chat' },
    message: {
      matrixRoomId: '!journal-room',
      matrixEventId,
      matrixSenderId: '@test:matrix.example',
      senderDisplayName: 'Test person',
      direction: 'incoming',
      type: 'text',
      text: 'Visible message',
      eventTimestamp: '2026-07-21T08:00:00.000Z',
      rawMatrixEvent: { type: 'm.room.message', event_id: matrixEventId },
      ...overrides,
    },
  };
}

describe('FakePrivateWhatsAppRepository context journal', () => {
  it('keeps the context head independent from operational relation rows', async () => {
    const repository = new FakePrivateWhatsAppRepository();
    await repository.storeIncomingMessage(message('$logical-message'));
    await repository.storeIncomingMessage(
      message('$replacement', {
        text: 'Edited text',
        relation: {
          kind: 'replacement',
          targetMatrixEventId: '$logical-message',
          applicationStatus: 'pending',
        },
      })
    );

    const head = await repository.getConversationContextJournalHead({
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      chatId: CHAT_ID,
    });
    expect(head).toEqual({ ok: true, value: 1 });

    const journal = await repository.findConversationContextJournalEntries({
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      chatId: CHAT_ID,
      afterSequence: 0,
      throughSequence: 1,
      limit: 10,
    });
    expect(journal.ok).toBe(true);
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value.entries).toHaveLength(1);
    expect(journal.value.entries[0]).toMatchObject({
      sequence: 1,
      changeType: 'created',
      after: { state: 'included', content: 'Visible message' },
    });
  });
});
