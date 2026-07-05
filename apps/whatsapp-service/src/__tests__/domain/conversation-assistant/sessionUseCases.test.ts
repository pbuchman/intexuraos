import { err, ok } from '@intexuraos/common-core';
import type { GenerateResult, LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  ConversationAssistantModels,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { describe, expect, it, vi } from 'vitest';
import {
  FakeConversationAssistantRepository,
  FakeLlmGenerateClient,
  FakePrivateWhatsAppRepository,
} from '../../fakes.js';
import {
  checkConversationAssistantContext,
  createConversationAssistantSession,
  deriveEffectiveRange,
  exportConversationAssistantSessionPdf,
  getConversationAssistantSession,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
  streamConversationAssistantTurn,
} from '../../../domain/conversation-assistant/sessionUseCases.js';
import type {
  ConversationAssistantDeps,
  ConversationAssistantPdfExporter,
  ConversationAssistantPdfExportError,
  ConversationAssistantPdfExportInput,
} from '../../../domain/conversation-assistant/ports.js';
import {
  DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
  type ConversationAssistantStreamEvent,
  type ExportConversationAssistantPdfResult,
} from '../../../domain/conversation-assistant/types.js';
import type {
  PrivateWhatsAppMessage,
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
  pdfExporter: FakePdfConversationExporter;
  llmFactoryCalls: { userId: string; model: string }[];
} {
  const conversationRepository = new FakeConversationAssistantRepository();
  const privateRepository = new FakePrivateWhatsAppRepository();
  const llmClient = new FakeLlmGenerateClient();
  const pdfExporter = new FakePdfConversationExporter();
  const llmFactoryCalls: { userId: string; model: string }[] = [];
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
        createLlmClientForUser(userId: string, model: string): ReturnType<
          ConversationAssistantDeps['llmClientFactory']['createLlmClientForUser']
        > {
          llmFactoryCalls.push({ userId, model });
          return Promise.resolve(ok(llmClient));
        },
      },
      pdfExporter,
      defaultModel: ConversationAssistantModels.Gemini35FlashThinking,
      clock,
      ids,
    },
    conversationRepository,
    privateRepository,
    llmClient,
    pdfExporter,
    llmFactoryCalls,
  };
}

class FakePdfConversationExporter implements ConversationAssistantPdfExporter {
  readonly calls: ConversationAssistantPdfExportInput[] = [];
  private nextResult: import('@intexuraos/common-core').Result<
    ExportConversationAssistantPdfResult,
    ConversationAssistantPdfExportError
  > = ok({
    bytes: Buffer.from('%PDF-test'),
    fileName: 'alice-context.pdf',
    contentType: 'application/pdf',
  });

  exportConversation(
    input: ConversationAssistantPdfExportInput
  ): Promise<
    import('@intexuraos/common-core').Result<
      ExportConversationAssistantPdfResult,
      ConversationAssistantPdfExportError
    >
  > {
    this.calls.push(input);
    return Promise.resolve(this.nextResult);
  }

  failNext(message = 'render failed'): void {
    this.nextResult = err({ message });
  }

  setFileName(fileName: string): void {
    this.nextResult = ok({
      bytes: Buffer.from('%PDF-test'),
      fileName,
      contentType: 'application/pdf',
    });
  }
}

async function seedDirectMessage(
  repository: FakePrivateWhatsAppRepository,
  options: {
    displayName?: string | undefined;
    eventTimestamp?: string;
    matrixEventId?: string;
    receivedAt?: string;
    text?: string;
    type?: 'text' | 'image';
  } = {}
): Promise<void> {
  const hasDisplayName = Object.hasOwn(options, 'displayName');
  const displayName = hasDisplayName ? options.displayName : 'Alice';
  const eventTimestamp = options.eventTimestamp ?? '2026-06-30T10:00:00.000Z';
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
    receivedAt: options.receivedAt ?? eventTimestamp,
    chat: { matrixRoomId: '!direct', type: 'direct' },
    message: {
      matrixRoomId: '!direct',
      matrixEventId: options.matrixEventId ?? '$event-1',
      matrixSenderId: '@alice:matrix.example',
      senderKey: 'phone:+48111111111',
      direction: 'incoming',
      type: options.type ?? 'text',
      eventTimestamp,
      rawMatrixEvent: { type: 'm.room.message' },
    },
  };
  if (options.type !== 'image') {
    input.message.text = options.text ?? 'We agreed to meet at 17:00.';
  }
  if (displayName !== undefined) {
    input.chat.displayName = displayName;
    input.message.senderDisplayName = displayName;
  }
  const result = await repository.storeIncomingMessage(input);
  expect(result.ok).toBe(true);
}

function makeTranscriptMessage(index: number): PrivateWhatsAppMessage {
  const eventTimestamp = new Date(Date.UTC(2026, 5, 30, 0, 0, index)).toISOString();
  return {
    id: `msg-${String(index).padStart(4, '0')}`,
    chatId: CHAT_ID,
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    matrixRoomId: '!direct',
    matrixEventId: `$event-${index}`,
    matrixSenderId: '@alice:matrix.example',
    senderKey: 'phone:+48111111111',
    senderDisplayName: 'Alice',
    direction: 'incoming',
    messageType: 'text',
    text: `Message ${index}`,
    eventTimestamp,
    receivedAt: eventTimestamp,
    ingestedAt: eventTimestamp,
    deliveryMode: 'backfill',
    rawMatrixEvent: { type: 'm.room.message' },
    schemaVersion: 1,
  };
}

describe('Conversation Assistant session use cases', () => {
  it('falls back to the selected range when no projected messages are available', () => {
    expect(
      deriveEffectiveRange([], {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      })
    ).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
  });

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
    expect(result.value.session.assistantRoleLabel).toBe(
      DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL
    );
    expect(result.value.session.transcriptText).toContain('We agreed to meet at 17:00.');
    expect(result.value.session.transcriptSha256).toBe(result.value.context.transcriptSha256);
    expect(conversationRepository.getAllSessions()).toHaveLength(1);
  });

  it('persists an inferred assistant role label using the selected model and initial question only', async () => {
    const { deps, conversationRepository, privateRepository, llmClient, llmFactoryCalls } =
      makeDeps();
    await seedDirectMessage(privateRepository);
    llmClient.queueGenerateResult(
      ok({
        content:
          '{"roleLabel":"employment lawyer","confidence":0.93,"rationale":"The user asks whether they can sue an employer."}',
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, costUsd: 0.001 },
      })
    );

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:anthropic/claude-sonnet-5' as ConversationAssistantModel,
        question: 'Can I sue my employer?',
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.assistantRoleLabel).toBe('Employment Lawyer');
    expect(conversationRepository.getAllSessions()[0]?.assistantRoleLabel).toBe(
      'Employment Lawyer'
    );
    expect(llmFactoryCalls).toEqual([
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
    ]);
    expect(llmClient.generateCalls[0]?.options.promptType).toBe(
      'whatsapp-conversation-assistant-role-classifier'
    );
    expect(llmClient.generateCalls[0]?.prompt).toContain('Can I sue my employer?');
    expect(llmClient.generateCalls[0]?.prompt).not.toContain('We agreed to meet at 17:00.');
  });

  it('persists selected and effective transcript ranges from included messages', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository, {
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      matrixEventId: '$event-1',
      text: 'First included message.',
    });
    await seedDirectMessage(privateRepository, {
      eventTimestamp: '2026-06-30T10:05:00.000Z',
      matrixEventId: '$event-2',
      text: 'Last included message.',
    });

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
    expect(result.value.session.range).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(result.value.session.effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:05:00.000Z',
    });
  });

  it('uses the last included prompt message for effectiveRange when maxMessages truncates context', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository, {
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      matrixEventId: '$event-1',
      text: 'First included message.',
    });
    await seedDirectMessage(privateRepository, {
      eventTimestamp: '2026-06-30T10:05:00.000Z',
      matrixEventId: '$event-2',
      text: 'Truncated message.',
    });

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 1,
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.transcriptMessageCount).toBe(1);
    expect(result.value.session.effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:00:00.000Z',
    });
    expect(result.value.session.omitted.overLimit).toBeGreaterThan(0);
  });

  it('persists the selected Conversation Assistant model on session creation', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:anthropic/claude-sonnet-5' as ConversationAssistantModel,
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.model).toBe('or:anthropic/claude-sonnet-5');
  });

  it('rejects unsupported Conversation Assistant models', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:unknown/model' as ConversationAssistantModel,
      },
      deps
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unsupported Conversation Assistant model',
      },
    });
  });

  it('continues reading context pages until the selected range is exhausted', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const calls: PrivateConversationContextMessageQueryInput[] = [];
    const findContextMessages =
      privateRepository.findConversationContextMessages.bind(privateRepository);
    privateRepository.findConversationContextMessages = (
      input
    ): ReturnType<FakePrivateWhatsAppRepository['findConversationContextMessages']> => {
      calls.push(input);
      if (calls.length === 1) {
        return Promise.resolve(ok({ messages: [], totalCount: 1, nextCursor: 'page-two' }));
      }
      return findContextMessages(input);
    };

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
    expect(calls).toHaveLength(2);
    expect(calls[1]?.cursor).toBe('page-two');
    if (result.ok) {
      expect(result.value.context.messages).toHaveLength(1);
    }
  });

  it('retains more than 2000 projected messages when creating a session', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const messages = Array.from({ length: 2001 }, (_, index) =>
      makeTranscriptMessage(index + 1)
    );
    privateRepository.findConversationContextMessages = (
      input
    ): ReturnType<FakePrivateWhatsAppRepository['findConversationContextMessages']> => {
      expect(input.limit).toBe(5000);
      return Promise.resolve(ok({ messages, totalCount: messages.length }));
    };

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
    expect(result.value.session.transcriptMessageCount).toBe(2001);
    expect(result.value.session.transcriptText).toContain('Message 2001');
  });

  it('checks context size with the large-context warning threshold', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const calls: PrivateConversationContextMessageQueryInput[] = [];
    privateRepository.findConversationContextMessages = (
      input
    ): ReturnType<FakePrivateWhatsAppRepository['findConversationContextMessages']> => {
      calls.push(input);
      return Promise.resolve(ok({ messages: [], totalCount: 5001 }));
    };

    const result = await checkConversationAssistantContext(
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
    expect(calls).toHaveLength(1);
    expect(calls[0]?.limit).toBe(1);
    expect(result.value).toEqual({
      messageCount: 5001,
      warningThreshold: 5000,
      requiresConfirmation: true,
    });
  });

  it('maps context check validation, ownership, and message query failures', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

    const invalid = await checkConversationAssistantContext(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      },
      deps
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_REQUEST');

    const groupResult = await privateRepository.storeIncomingMessage({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      userId: USER_ID,
      deliveryMode: 'backfill',
      receivedAt: '2026-06-30T11:00:00.000Z',
      chat: { matrixRoomId: '!group-context', type: 'group', displayName: 'Group' },
      message: {
        matrixRoomId: '!group-context',
        matrixEventId: '$event-group-context',
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

    const group = await checkConversationAssistantContext(
      {
        userId: USER_ID,
        chatId: `chat:${SOURCE_ACCOUNT_ID}:!group-context`,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(group.ok).toBe(false);
    if (!group.ok) expect(group.error.code).toBe('INVALID_REQUEST');

    privateRepository.failNextConversationContextQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'count failed',
    });
    const queryFailure = await checkConversationAssistantContext(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(queryFailure.ok).toBe(false);
    if (!queryFailure.ok) expect(queryFailure.error.code).toBe('PERSISTENCE_ERROR');
  });

  it('creates a session with first user and assistant turns using OpenRouter session id', async () => {
    const { deps, conversationRepository, privateRepository, llmClient, llmFactoryCalls } =
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
    expect(llmFactoryCalls).toEqual([
      { userId: USER_ID, model: 'or:google/gemini-3.5-flash' },
      { userId: USER_ID, model: 'or:google/gemini-3.5-flash' },
    ]);
    expect(llmClient.chatCalls[0]?.options.sessionId).toBe('whatsapp_conv_session_test');
    expect(llmClient.chatCalls[0]?.options.reasoning).toEqual({ enabled: true });
    const firstPrompt = JSON.stringify(llmClient.chatCalls[0]?.messages[1]);
    expect(firstPrompt).toContain('Information range: 30 June 2026 to 1 July 2026');
    expect(firstPrompt).toContain('Effective range: 30 June 2026 to 30 June 2026');
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

  it('persists assistant error turns when user LLM key lookup fails before sync generation', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);

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
          createLlmClientForUser: () =>
            Promise.resolve(err({ code: 'LLM_ERROR', message: 'OpenRouter key missing' })),
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'OpenRouter key missing',
    });
  });

  it('sends follow-up turns with unchanged transcript prefix', async () => {
    const { deps, privateRepository, llmClient, llmFactoryCalls } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        model: 'or:anthropic/claude-sonnet-5' as ConversationAssistantModel,
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
    expect(llmFactoryCalls).toEqual([
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
    ]);
    expect(JSON.stringify(llmClient.chatCalls[0]?.messages[1])).toBe(
      JSON.stringify(llmClient.chatCalls[1]?.messages[1])
    );
  });

  it('streams follow-up turns and persists the final assistant turn', async () => {
    const { deps, privateRepository, conversationRepository, llmClient } = makeDeps();
    await seedDirectMessage(privateRepository);
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
    llmClient.setNextStreamEvents([
      { type: 'delta', text: 'streamed ' },
      { type: 'delta', text: 'answer' },
      {
        type: 'usage',
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18, costUsd: 0.002 },
      },
    ]);
    const events: ConversationAssistantStreamEvent[] = [];

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Stream this.' },
      deps,
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'user_turn',
      'assistant_delta',
      'assistant_delta',
      'usage',
      'assistant_turn',
      'done',
    ]);
    expect(llmClient.streamChatCalls[0]?.options.reasoning).toEqual({ enabled: true });
    expect(result.ok ? result.value.map((turn) => turn.role) : []).toEqual(['user', 'assistant']);
    expect(conversationRepository.getAllTurns().map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(conversationRepository.getAllTurns()[1]?.text).toBe('assistant answer');
  });

  it('streams partial deltas before persisting assistant error turns', async () => {
    const { deps, privateRepository, conversationRepository, llmClient } = makeDeps();
    await seedDirectMessage(privateRepository);
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
    llmClient.failNextStream('stream broke', [{ type: 'delta', text: 'partial' }]);
    const events: ConversationAssistantStreamEvent[] = [];

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Stream this.' },
      deps,
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'user_turn',
      'assistant_delta',
      'error',
      'assistant_turn',
      'done',
    ]);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'stream broke',
    });
  });

  it('exports an owned session PDF with mapped counts and chronological turns', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    await conversationRepository.saveSession({
      id: 'whatsapp_conv_session_test',
      userId: USER_ID,
      chatId: CHAT_ID,
      status: 'active',
      range: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      effectiveRange: {
        from: '2026-06-30T10:00:00.000Z',
        to: '2026-06-30T10:30:00.000Z',
      },
      model: 'or:google/gemini-3.5-flash',
      transcriptSha256: 'abc123',
      transcriptMessageCount: 7,
      transcriptText: 'frozen transcript',
      assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
      omitted: {
        mediaOnly: 2,
        failedTranscriptions: 1,
        pendingTranscriptions: 3,
        nonText: 4,
        overLimit: 5,
      },
      title: 'Alice context',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    });
    await conversationRepository.saveTurn({
      id: 'turn-b',
      sessionId: 'whatsapp_conv_session_test',
      userId: USER_ID,
      role: 'assistant',
      text: 'assistant answer',
      createdAt: '2026-06-30T12:02:00.000Z',
    });
    await conversationRepository.saveTurn({
      id: 'turn-a',
      sessionId: 'whatsapp_conv_session_test',
      userId: USER_ID,
      role: 'user',
      text: 'user question',
      createdAt: '2026-06-30T12:01:00.000Z',
    });

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe('application/pdf');
    expect(result.value.bytes.toString()).toBe('%PDF-test');
    expect(result.value.fileName).toBe('alice-context-whatsapp_conv_session_test.pdf');
    expect(pdfExporter.calls).toEqual([
      {
        title: 'Alice context',
        modelName: 'Gemini 3.5 Flash Thinking',
        assistantRoleLabel: 'Assistant',
        initialPrompt: 'user question',
        generatedAt: '2026-06-30T12:00:00.000Z',
        sourceRange: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        effectiveRange: {
          from: '2026-06-30T10:00:00.000Z',
          to: '2026-06-30T10:30:00.000Z',
        },
        messageCounts: { included: 7, excluded: 15 },
        omittedBreakdown: {
          mediaOnly: 2,
          failedTranscriptions: 1,
          pendingTranscriptions: 3,
          nonText: 4,
          overLimit: 5,
        },
        messages: [
          {
            role: 'user',
            createdAt: '2026-06-30T12:01:00.000Z',
            text: 'user question',
          },
          {
            role: 'assistant',
            createdAt: '2026-06-30T12:02:00.000Z',
            text: 'assistant answer',
          },
        ],
      },
    ]);
  });

  it('orders equal-timestamp PDF export turns by conversation role and same-role id', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    pdfExporter.setFileName('custom-base');
    await conversationRepository.saveSession({
      id: 'whatsapp_conv_session_test',
      userId: USER_ID,
      chatId: CHAT_ID,
      status: 'active',
      range: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      effectiveRange: {
        from: '2026-06-30T10:00:00.000Z',
        to: '2026-06-30T10:30:00.000Z',
      },
      model: 'or:google/gemini-3.5-flash',
      transcriptSha256: 'abc123',
      transcriptMessageCount: 4,
      transcriptText: 'frozen transcript',
      assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      title: 'Alice context',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    });
    for (const turn of [
      { id: 'turn-z', role: 'assistant' as const, text: 'assistant same time' },
      { id: 'turn-b', role: 'user' as const, text: 'user b' },
      { id: 'turn-a', role: 'user' as const, text: 'user a' },
      { id: 'turn-future', role: 'assistant' as const, text: 'assistant future' },
    ]) {
      await conversationRepository.saveTurn({
        id: turn.id,
        sessionId: 'whatsapp_conv_session_test',
        userId: USER_ID,
        role: turn.role,
        text: turn.text,
        createdAt:
          turn.id === 'turn-future'
            ? '2026-06-30T12:01:00.000Z'
            : '2026-06-30T12:00:00.000Z',
      });
    }

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fileName).toBe('custom-base-whatsapp_conv_session_test.pdf');
    expect(pdfExporter.calls[0]?.messages.map((message) => message.text)).toEqual([
      'user a',
      'user b',
      'assistant same time',
      'assistant future',
    ]);
    expect(pdfExporter.calls[0]?.sourceRange).toEqual({
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(pdfExporter.calls[0]?.effectiveRange).toEqual({
      from: '2026-06-30T10:00:00.000Z',
      to: '2026-06-30T10:30:00.000Z',
    });

    pdfExporter.setFileName('   ');
    const fallback = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      deps
    );
    expect(fallback.ok).toBe(true);
    if (fallback.ok) {
      expect(fallback.value.fileName).toBe(
        'conversation-assistant-export-whatsapp_conv_session_test.pdf'
      );
    }
  });

  it('rejects missing and foreign PDF export sessions without calling the exporter', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    await conversationRepository.saveSession({
      id: 'whatsapp_conv_session_test',
      userId: USER_ID,
      chatId: CHAT_ID,
      status: 'active',
      range: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      effectiveRange: {
        from: '2026-06-30T10:00:00.000Z',
        to: '2026-06-30T10:30:00.000Z',
      },
      model: 'or:google/gemini-3.5-flash',
      transcriptSha256: 'abc123',
      transcriptMessageCount: 1,
      transcriptText: 'frozen transcript',
      assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      title: 'Alice context',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    });

    const missing = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'missing' },
      deps
    );
    const foreign = await exportConversationAssistantSessionPdf(
      { userId: 'other-user', sessionId: 'whatsapp_conv_session_test' },
      deps
    );

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('NOT_FOUND');
    expect(pdfExporter.calls).toEqual([]);
    expect(conversationRepository.snapshotRequests).toEqual([
      { sessionId: 'missing', userId: USER_ID },
      { sessionId: 'whatsapp_conv_session_test', userId: 'other-user' },
    ]);
  });

  it('rejects PDF export when the session has no initial user prompt', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    await conversationRepository.saveSession({
      id: 'whatsapp_conv_session_test',
      userId: USER_ID,
      chatId: CHAT_ID,
      status: 'active',
      range: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      effectiveRange: {
        from: '2026-06-30T10:00:00.000Z',
        to: '2026-06-30T10:30:00.000Z',
      },
      model: 'or:google/gemini-3.5-flash',
      transcriptSha256: 'abc123',
      transcriptMessageCount: 1,
      transcriptText: 'frozen transcript',
      assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      title: 'Alice context',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    });
    await conversationRepository.saveTurn({
      id: 'turn-assistant',
      sessionId: 'whatsapp_conv_session_test',
      userId: USER_ID,
      role: 'assistant',
      text: 'assistant answer',
      createdAt: '2026-06-30T12:02:00.000Z',
    });

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      deps
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EMPTY_TRANSCRIPT');
    }
    expect(pdfExporter.calls).toEqual([]);
  });

  it('rejects PDF export when the exporter dependency is missing', async () => {
    const { deps } = makeDeps();
    const { pdfExporter: _pdfExporter, ...depsWithoutPdfExporter } = deps;

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      depsWithoutPdfExporter
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Conversation Assistant PDF exporter is not configured',
      });
    }
  });

  it('maps PDF rendering failures to internal errors', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    pdfExporter.failNext('pdf failed');
    await conversationRepository.saveSession({
      id: 'whatsapp_conv_session_test',
      userId: USER_ID,
      chatId: CHAT_ID,
      status: 'active',
      range: {
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      effectiveRange: {
        from: '2026-06-30T10:00:00.000Z',
        to: '2026-06-30T10:30:00.000Z',
      },
      model: 'or:google/gemini-3.5-flash',
      transcriptSha256: 'abc123',
      transcriptMessageCount: 1,
      transcriptText: 'frozen transcript',
      assistantRoleLabel: DEFAULT_CONVERSATION_ASSISTANT_ROLE_LABEL,
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      title: 'Alice context',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    });
    await conversationRepository.saveTurn({
      id: 'turn-user',
      sessionId: 'whatsapp_conv_session_test',
      userId: USER_ID,
      role: 'user',
      text: 'user question',
      createdAt: '2026-06-30T12:01:00.000Z',
    });

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
      deps
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'pdf failed' });
    }
  });

  it('persists streaming assistant errors when the user LLM key is unavailable', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
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
    const events: ConversationAssistantStreamEvent[] = [];

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Stream this.' },
      {
        ...deps,
        llmClientFactory: {
          createLlmClientForUser: () =>
            Promise.resolve(err({ code: 'LLM_ERROR', message: 'OpenRouter key is missing' })),
        },
      },
      (event) => events.push(event)
    );

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'user_turn',
      'error',
      'assistant_turn',
      'done',
    ]);
    expect(conversationRepository.getAllTurns()[1]?.error?.message).toBe(
      'OpenRouter key is missing'
    );
  });

  it('validates streaming input and session ownership before persisting turns', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
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

    const empty = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: '   ' },
      deps,
      vi.fn()
    );
    const foreign = await streamConversationAssistantTurn(
      { userId: 'other-user', sessionId: created.value.session.id, question: 'Hello?' },
      deps,
      vi.fn()
    );

    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('INVALID_REQUEST');
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('NOT_FOUND');
    expect(conversationRepository.getAllTurns()).toHaveLength(0);
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

  it('rejects ranges with raw messages that project to no textual transcript', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository, { type: 'image' });

    const result = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_TRANSCRIPT');
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

    const ignoredLimit = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        maxMessages: 5001,
      },
      deps
    );
    expect(ignoredLimit.ok).toBe(true);

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
          createLlmClientForUser: () => Promise.resolve(ok(llmClientWithoutChat)),
        },
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.session.chatDisplayName).toBeUndefined();
    expect(created.value.session.transcriptText).toContain('Unknown:');
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
          createLlmClientForUser: () => Promise.resolve(ok(rejectingClient)),
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
