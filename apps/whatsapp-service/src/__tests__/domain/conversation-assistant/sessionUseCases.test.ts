import { err, ok } from '@intexuraos/common-core';
import type { GenerateResult, LlmGenerateClient } from '@intexuraos/llm-factory';
import { describe, expect, it } from 'vitest';
import {
  FakeConversationAssistantRepository,
  FakeLlmGenerateClient,
  FakePrivateWhatsAppRepository,
} from '../../fakes.js';
import {
  createConversationAssistantSession,
  getConversationAssistantSession,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
} from '../../../domain/conversation-assistant/sessionUseCases.js';
import type { ConversationAssistantDeps } from '../../../domain/conversation-assistant/ports.js';
import type {
  PrivateConversationContextMessageQueryInput,
  StorePrivateWhatsAppMessageInput,
} from '../../../domain/whatsapp/models/PrivateWhatsApp.js';

const USER_ID = 'user-123';
const SOURCE_ACCOUNT_ID = 'source-123';
const CHAT_ID = `chat:${SOURCE_ACCOUNT_ID}:!direct`;

function makeDeps(): {
  deps: ConversationAssistantDeps;
  conversationRepository: FakeConversationAssistantRepository;
  privateRepository: FakePrivateWhatsAppRepository;
  llmClient: FakeLlmGenerateClient;
  llmFactoryUserIds: string[];
} {
  const conversationRepository = new FakeConversationAssistantRepository();
  const privateRepository = new FakePrivateWhatsAppRepository();
  const llmClient = new FakeLlmGenerateClient();
  const llmFactoryUserIds: string[] = [];
  const clock = { now: (): string => '2026-06-30T12:00:00.000Z' };
  const ids = {
    sessionId: (): string => 'whatsapp_conv_session_test',
    turnId: (() => {
      let counter = 0;
      return (): string => {
        counter += 1;
        return `whatsapp_conv_turn_${String(counter)}`;
      };
    })(),
  };
  return {
    deps: {
      repository: conversationRepository,
      privateWhatsAppRepository: privateRepository,
      llmClientFactory: {
        createLlmClientForUser(userId: string): FakeLlmGenerateClient {
          llmFactoryUserIds.push(userId);
          return llmClient;
        },
      },
      model: 'or:google/gemini-3.5-flash',
      clock,
      ids,
    },
    conversationRepository,
    privateRepository,
    llmClient,
    llmFactoryUserIds,
  };
}

async function seedDirectMessage(
  repository: FakePrivateWhatsAppRepository,
  options: { displayName?: string | undefined; text?: string } = {}
): Promise<void> {
  const hasDisplayName = Object.hasOwn(options, 'displayName');
  const displayName = hasDisplayName ? options.displayName : 'Alice';
  repository.setAccount({
    id: USER_ID,
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    phoneNumberNormalized: '48123456789',
    displayName: '+48123456789',
    status: 'active',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    schemaVersion: 1,
  });
  const input: StorePrivateWhatsAppMessageInput = {
    sourceAccountId: SOURCE_ACCOUNT_ID,
    userId: USER_ID,
    deliveryMode: 'backfill',
    receivedAt: '2026-06-30T10:00:00.000Z',
    chat: { matrixRoomId: '!direct', type: 'direct' },
    message: {
      matrixRoomId: '!direct',
      matrixEventId: '$event-1',
      matrixSenderId: '@alice:matrix.example',
      senderKey: 'phone:+48111111111',
      direction: 'incoming',
      type: 'text',
      text: options.text ?? 'We agreed to meet at 17:00.',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      rawMatrixEvent: { type: 'm.room.message' },
    },
  };
  if (displayName !== undefined) {
    input.chat.displayName = displayName;
    input.message.senderDisplayName = displayName;
  }
  const result = await repository.storeIncomingMessage(input);
  expect(result.ok).toBe(true);
}

describe('Conversation Assistant session use cases', () => {
  it('creates a shell session with frozen transcript text and no turns', async () => {
    const { deps, conversationRepository, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns).toEqual([]);
    expect(result.value.session.transcriptText).toContain('We agreed to meet at 17:00.');
    expect(result.value.session.transcriptSha256).toBe(result.value.context.transcriptSha256);
    expect(conversationRepository.getAllSessions()).toHaveLength(1);
  });

  it('creates a session with first user and assistant turns using OpenRouter session id', async () => {
    const { deps, conversationRepository, privateRepository, llmClient, llmFactoryUserIds } =
      makeDeps();
    await seedDirectMessage(privateRepository);

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'What was agreed?',
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(conversationRepository.getAllTurns()).toHaveLength(2);
    expect(llmFactoryUserIds).toEqual([USER_ID]);
    expect(llmClient.chatCalls[0]?.options.sessionId).toBe('whatsapp_conv_session_test');
    expect(JSON.stringify(llmClient.chatCalls[0]?.messages)).toContain('cache_control');
  });

  it('persists assistant error turns when the LLM call fails', async () => {
    const { deps, privateRepository, conversationRepository, llmClient } = makeDeps();
    await seedDirectMessage(privateRepository);
    llmClient.failNextChat('upstream model error');

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'Summarize.',
      },
      deps
    );

    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns()[1]?.error?.code).toBe('LLM_ERROR');
  });

  it('sends follow-up turns with unchanged transcript prefix', async () => {
    const { deps, privateRepository, llmClient } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'What was agreed?',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const followUp = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'What time?' },
      deps
    );

    expect(followUp.ok).toBe(true);
    expect(llmClient.chatCalls).toHaveLength(2);
    expect(JSON.stringify(llmClient.chatCalls[0]?.messages[1])).toBe(
      JSON.stringify(llmClient.chatCalls[1]?.messages[1])
    );
  });

  it('rejects group chats and empty transcript ranges', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const groupResult = await privateRepository.storeIncomingMessage({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      userId: USER_ID,
      deliveryMode: 'backfill',
      receivedAt: '2026-06-30T11:00:00.000Z',
      chat: { matrixRoomId: '!group', type: 'group', displayName: 'Group' },
      message: {
        matrixRoomId: '!group',
        matrixEventId: '$event-group',
        matrixSenderId: '@bob:matrix.example',
        senderDisplayName: 'Bob',
        direction: 'incoming',
        type: 'text',
        text: 'hello',
        eventTimestamp: '2026-06-30T11:00:00.000Z',
        rawMatrixEvent: {},
      },
    });
    expect(groupResult.ok).toBe(true);

    const group = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: `chat:${SOURCE_ACCOUNT_ID}:!group`,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    const empty = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-29T00:00:00.000Z',
        to: '2026-06-29T01:00:00.000Z',
      },
      deps
    );

    expect(group.ok).toBe(false);
    if (!group.ok) expect(group.error.code).toBe('INVALID_REQUEST');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('EMPTY_TRANSCRIPT');
  });

  it('maps private WhatsApp repository failures and missing resources', async () => {
    const { deps, privateRepository } = makeDeps();
    privateRepository.failNext({ code: 'PERSISTENCE_ERROR', message: 'account failed' });

    const accountFailure = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(accountFailure.ok).toBe(false);
    if (!accountFailure.ok) expect(accountFailure.error.code).toBe('PERSISTENCE_ERROR');

    const missingAccount = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(missingAccount.ok).toBe(false);
    if (!missingAccount.ok) expect(missingAccount.error.code).toBe('NOT_FOUND');

    await seedDirectMessage(privateRepository);
    privateRepository.failNextDataQuery({ code: 'PERSISTENCE_ERROR', message: 'chat failed' });
    const chatFailure = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(chatFailure.ok).toBe(false);
    if (!chatFailure.ok) expect(chatFailure.error.code).toBe('PERSISTENCE_ERROR');

    const missingChat = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: `chat:${SOURCE_ACCOUNT_ID}:!missing`,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(missingChat.ok).toBe(false);
    if (!missingChat.ok) expect(missingChat.error.code).toBe('NOT_FOUND');

    const queryFailureRepository = Object.create(privateRepository) as FakePrivateWhatsAppRepository;
    queryFailureRepository.findConversationContextMessages = (
      _input: PrivateConversationContextMessageQueryInput
    ): ReturnType<FakePrivateWhatsAppRepository['findConversationContextMessages']> =>
      Promise.resolve(err({ code: 'PERSISTENCE_ERROR', message: 'messages failed' }));
    const messageFailure = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      { ...deps, privateWhatsAppRepository: queryFailureRepository }
    );
    expect(messageFailure.ok).toBe(false);
    if (!messageFailure.ok) expect(messageFailure.error.code).toBe('PERSISTENCE_ERROR');

    const countFailureRepository = Object.create(privateRepository) as FakePrivateWhatsAppRepository;
    countFailureRepository.countConversationContextMessages = (
      _input: Omit<PrivateConversationContextMessageQueryInput, 'limit'>
    ): ReturnType<FakePrivateWhatsAppRepository['countConversationContextMessages']> =>
      Promise.resolve(err({ code: 'PERSISTENCE_ERROR', message: 'count failed' }));
    const countFailure = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      { ...deps, privateWhatsAppRepository: countFailureRepository }
    );
    expect(countFailure.ok).toBe(false);
    if (!countFailure.ok) expect(countFailure.error.code).toBe('PERSISTENCE_ERROR');
  });

  it('validates create and follow-up inputs and session ownership', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

    const invalidDate = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(invalidDate.ok).toBe(false);
    if (!invalidDate.ok) expect(invalidDate.error.code).toBe('INVALID_REQUEST');

    const invalidCalendarDate = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-13-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(invalidCalendarDate.ok).toBe(false);
    if (!invalidCalendarDate.ok) expect(invalidCalendarDate.error.code).toBe('INVALID_REQUEST');

    const nonCanonicalDate = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-02-31T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(nonCanonicalDate.ok).toBe(false);
    if (!nonCanonicalDate.ok) expect(nonCanonicalDate.error.code).toBe('INVALID_REQUEST');

    const invalidLimit = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 5001,
      },
      deps
    );
    expect(invalidLimit.ok).toBe(false);
    if (!invalidLimit.ok) expect(invalidLimit.error.code).toBe('INVALID_REQUEST');

    const noMilliseconds = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00Z',
        to: '2026-07-01T00:00:00Z',
      },
      deps
    );
    expect(noMilliseconds.ok).toBe(true);

    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const emptyQuestion = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: '   ' },
      deps
    );
    expect(emptyQuestion.ok).toBe(false);
    if (!emptyQuestion.ok) expect(emptyQuestion.error.code).toBe('INVALID_REQUEST');

    const foreignSend = await sendConversationAssistantTurn(
      { userId: 'other-user', sessionId: created.value.session.id, question: 'What time?' },
      deps
    );
    const foreignGet = await getConversationAssistantSession(
      { userId: 'other-user', sessionId: created.value.session.id },
      deps
    );
    const foreignTurns = await listConversationAssistantTurns(
      { userId: 'other-user', sessionId: created.value.session.id },
      deps
    );
    expect(foreignSend.ok).toBe(false);
    expect(foreignGet.ok).toBe(false);
    expect(foreignTurns.ok).toBe(false);
  });

  it('derives fallback titles and assistant error turns for unavailable chat generation', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository, {
      displayName: undefined,
      text: 'A message without a stored chat display name.',
    });
    const longQuestion = `${'x'.repeat(90)}?`;

    const llmClientWithoutChat: LlmGenerateClient = {
      generate: (): ReturnType<LlmGenerateClient['generate']> =>
        Promise.resolve(
          ok({
            content: 'unused',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
          } satisfies GenerateResult)
        ),
    };

    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: longQuestion,
      },
      {
        ...deps,
        llmClientFactory: {
          createLlmClientForUser: () => llmClientWithoutChat,
        },
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.session.chatDisplayName).toBeUndefined();
    expect(created.value.session.transcriptText).toContain('Contact:');
    expect(created.value.session.transcriptText).not.toContain('phone:');
    expect(created.value.session.transcriptText).not.toContain('+48');
    expect(created.value.session.title).toBe(`${'x'.repeat(77)}...`);
    expect(created.value.turns[1]?.error?.message).toBe('Chat message generation is unavailable');

    const shell = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(shell.ok).toBe(true);
    if (shell.ok) {
      expect(shell.value.session.title).toBe(
        'WhatsApp chat (2026-06-30 to 2026-07-01)'
      );
    }
  });

  it('persists assistant error turns when chat generation rejects', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const rejectingClient: LlmGenerateClient = {
      generate: (): ReturnType<LlmGenerateClient['generate']> =>
        Promise.resolve(
          ok({
            content: 'unused',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
          } satisfies GenerateResult)
        ),
      generateChat: () => Promise.reject(new Error('network down')),
    };

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        question: 'Summarize.',
      },
      {
        ...deps,
        llmClientFactory: {
          createLlmClientForUser: () => rejectingClient,
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns().map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'network down',
    });
  });
});
