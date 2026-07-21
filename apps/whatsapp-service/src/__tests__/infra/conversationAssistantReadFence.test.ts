import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import {
  conversationAssistantSessionReadFenceAllows,
  conversationAssistantSessionReadFenceAllowsWithAccount,
} from '../../infra/firestore/conversationAssistantReadFence.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';

type ReadFenceInput = Parameters<typeof conversationAssistantSessionReadFenceAllows>[0];

describe('conversationAssistantReadFence', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let db: ReadFenceInput['db'];

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
    db = fakeFirestore as unknown as ReadFenceInput['db'];
  });

  afterEach(() => {
    resetFirestore();
  });

  const account = {
    userId: 'user-123',
    sourceAccountId: 'source-current',
    generationId: 'generation-current',
    status: 'active',
  };

  it('rejects malformed and conflicting source identities', async () => {
    const invalidSessionSource = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: { userId: 'user-123', sourceAccountId: '' },
      accountData: account,
    });
    const invalidContinuationSource = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: {
        userId: 'user-123',
        sourceAccountId: 'source-current',
        continuation: { sourceAccountId: '' },
      },
      accountData: account,
    });
    const conflictingSources = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: {
        userId: 'user-123',
        sourceAccountId: 'source-current',
        continuation: { sourceAccountId: 'source-previous' },
      },
      accountData: account,
    });

    expect([invalidSessionSource, invalidContinuationSource, conflictingSources]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('fails closed when a legacy session cannot recover an owned source from its chat', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
      {
        id: 'chat-without-source',
        data: { userId: 'user-123' },
      },
    ]);

    const missingChatId = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: { userId: 'user-123', chatId: '' },
      accountData: account,
    });
    const missingChat = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: { userId: 'user-123', chatId: 'missing-chat' },
      accountData: account,
    });
    const missingChatSource = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: { userId: 'user-123', chatId: 'chat-without-source' },
      accountData: account,
    });

    expect([missingChatId, missingChat, missingChatSource]).toEqual([false, false, false]);
  });

  it('requires a valid source generation when requested', async () => {
    const malformedGeneration = await conversationAssistantSessionReadFenceAllowsWithAccount({
      db,
      sessionData: {
        userId: 'user-123',
        sourceAccountId: 'source-current',
        sourceAccountGeneration: '',
      },
      accountData: account,
    });
    const missingRequiredGeneration =
      await conversationAssistantSessionReadFenceAllowsWithAccount({
        db,
        sessionData: { userId: 'user-123', sourceAccountId: 'source-current' },
        accountData: account,
        requireSourceAccountGeneration: true,
      });

    expect([malformedGeneration, missingRequiredGeneration]).toEqual([false, false]);
  });

  it('reads the account document before applying the generation fence', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
      { id: 'user-123', data: account },
    ]);

    await expect(
      conversationAssistantSessionReadFenceAllows({
        db,
        sessionData: {
          userId: 'user-123',
          sourceAccountId: 'source-current',
          sourceAccountGeneration: 'generation-current',
        },
        expectedUserId: 'user-123',
        requireSourceAccountGeneration: true,
      })
    ).resolves.toBe(true);
  });
});
