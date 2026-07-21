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
  conversationAssistantRandomIds,
  createConversationAssistantSession as createQueuedConversationAssistantSession,
  deleteConversationAssistantSession,
  deriveEffectiveRange,
  exportConversationAssistantSessionPdf,
  getConversationAssistantContext,
  getConversationAssistantSession,
  getConversationAssistantSessionByRequest,
  listConversationAssistantTurns,
  prepareConversationAssistantSession,
  retryConversationAssistantPreparation,
  sendConversationAssistantTurn,
  streamConversationAssistantTurn,
} from '../../../domain/conversation-assistant/sessionUseCases.js';
import type {
  ConversationAssistantDeps,
  ConversationAssistantPdfExporter,
  ConversationAssistantPdfExportError,
  ConversationAssistantPdfExportInput,
} from '../../../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantStreamEvent,
  ExportConversationAssistantPdfResult,
} from '../../../domain/conversation-assistant/types.js';
import type {
  PrivateWhatsAppMessage,
  PrivateConversationContextMessageQueryInput,
  StorePrivateWhatsAppMessageInput,
} from '../../../domain/whatsapp/models/PrivateWhatsApp.js';
import type { PrivateWhatsAppContextChange } from '../../../domain/whatsapp/index.js';
import { createHash } from 'node:crypto';
import { createConversationAssistantDeletionToken } from '../../../domain/conversation-assistant/deletionToken.js';

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
  preparationEvents: { sessionId: string; userId: string; attempt: number }[];
} {
  const conversationRepository = new FakeConversationAssistantRepository();
  const privateRepository = new FakePrivateWhatsAppRepository();
  const llmClient = new FakeLlmGenerateClient();
  const pdfExporter = new FakePdfConversationExporter();
  const llmFactoryCalls: { userId: string; model: string }[] = [];
  const preparationEvents: { sessionId: string; userId: string; attempt: number }[] = [];
  const clock = { now: (): string => '2026-06-30T12:00:00.000Z' };
  const sessionIdsByRequest = new Map<string, string>();
  const ids = {
    sessionId: (input?: { userId: string; requestId: string }): string => {
      const key = input === undefined ? `unseeded-${String(sessionIdsByRequest.size)}` : input.requestId;
      const existing = sessionIdsByRequest.get(key);
      if (existing !== undefined) return existing;
      const id =
        sessionIdsByRequest.size === 0
          ? 'whatsapp_conv_session_test'
          : `whatsapp_conv_session_test_${String(sessionIdsByRequest.size + 1)}`;
      sessionIdsByRequest.set(key, id);
      return id;
    },
    sessionGenerationId: (() => {
      let counter = 0;
      return (): string => {
        counter += 1;
        return `generation-${String(counter)}`;
      };
    })(),
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
      preparationPublisher: {
        publish(event: {
          sessionId: string;
          userId: string;
          attempt: number;
        }): Promise<ReturnType<typeof ok<void>>> {
          preparationEvents.push(event);
          return Promise.resolve(ok(undefined));
        },
      },
      defaultModel: ConversationAssistantModels.Gemini35FlashThinking,
      clock,
      ids,
    },
    conversationRepository,
    privateRepository,
    llmClient,
    pdfExporter,
    llmFactoryCalls,
    preparationEvents,
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

function makeContextJournalChange(
  sequence: number,
  overrides: Partial<PrivateWhatsAppContextChange> = {}
): PrivateWhatsAppContextChange {
  return {
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    chatId: CHAT_ID,
    sequence,
    messageId: `message:${SOURCE_ACCOUNT_ID}:$event-1`,
    messageRevision: sequence,
    changeType: 'edited',
    changedAt: '2026-06-30T11:00:00.000Z',
    eventTimestamp: '2026-06-30T10:00:00.000Z',
    before: {
      state: 'included',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:00.000Z',
      direction: 'incoming',
      speakerLabel: 'Alice',
      messageType: 'text',
      contentKind: 'text',
      content: 'Before journal update',
      reactions: [],
    },
    after: {
      state: 'included',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      importedAt: '2026-06-30T10:00:00.000Z',
      direction: 'incoming',
      speakerLabel: 'Alice',
      messageType: 'text',
      contentKind: 'text',
      content: `After journal update ${String(sequence)}`,
      reactions: [],
    },
    schemaVersion: 1,
    ...overrides,
  };
}

async function createConversationAssistantSession(
  input: Parameters<typeof createQueuedConversationAssistantSession>[0],
  deps: ConversationAssistantDeps
): Promise<Awaited<ReturnType<typeof prepareConversationAssistantSession>>> {
  const created = await createQueuedConversationAssistantSession(input, deps);
  if (!created.ok) {
    return created;
  }
  return await prepareConversationAssistantSession(
    preparationInput(created.value.session),
    deps
  );
}

function preparationInput(
  session: { id: string; userId: string; generationId?: string },
  overrides: { attempt?: number; claimId?: string } = {}
): {
  userId: string;
  sessionId: string;
  generationId?: string;
  attempt?: number;
  claimId?: string;
} {
  return {
    userId: session.userId,
    sessionId: session.id,
    ...(session.generationId !== undefined ? { generationId: session.generationId } : {}),
    ...overrides,
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

  it('creates an idempotent queued analysis without scanning its message range', async () => {
    const { deps, privateRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    const contextQuery = vi.spyOn(privateRepository, 'findConversationContextMessages');

    const result = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-123',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        displayTimeZone: 'Europe/Warsaw',
      },
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.status).toBe('preparing');
    expect(result.value.session.preparationStage).toBe('queued');
    expect(result.value.session).toMatchObject({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      sourceAccountGeneration: SOURCE_ACCOUNT_ID,
    });
    expect(result.value).not.toHaveProperty('context');
    expect(contextQuery).not.toHaveBeenCalled();
    expect(preparationEvents).toEqual([
      {
        type: 'whatsapp.conversation-assistant.prepare',
        sessionId: result.value.session.id,
        userId: USER_ID,
        attempt: 1,
        generationId: 'generation-1',
      },
    ]);
  });

  it('fails closed when erasure starts between source lookup and atomic session creation', async () => {
    const { deps, privateRepository, conversationRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    conversationRepository.fenceNextSessionCreation();

    const result = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-source-fenced',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Private WhatsApp mirror is not configured',
      },
    });
    expect(conversationRepository.getAllSessions()).toEqual([]);
    expect(preparationEvents).toEqual([]);
  });

  it('prepares the frozen context asynchronously and makes the analysis ready', async () => {
    const { deps, privateRepository, conversationRepository, llmFactoryCalls } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-prepare',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        displayTimeZone: 'Europe/Warsaw',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const prepared = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.session.status).toBe('ready');
    expect(prepared.value.session.preparationStage).toBe('ready');
    expect(prepared.value.session.transcriptMessageCount).toBe(1);
    expect(prepared.value.session.contextSnapshotId).toEqual(expect.any(String));
    expect(prepared.value.session.contextSnapshotId).not.toBe(
      prepared.value.session.transcriptSha256
    );
    expect(prepared.value.session.transcriptText).toContain('We agreed to meet at 17:00.');
    expect(prepared.value.session.continuation).toEqual({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      contextVersion: 0,
      contextEventThrough: '2026-07-01T00:00:00.000Z',
      contextChangeThrough: 1,
      contextChainSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      displayTimeZone: 'Europe/Warsaw',
      nextTurnSequence: 1,
      nextConversationRevision: 1,
      completedConversationRevision: 0,
      attachmentCount: 0,
      totalAttachedMessageCount: 0,
      totalAttachedOmittedCount: 0,
    });
    expect(prepared.value.context?.messages).toHaveLength(1);
    expect(
      conversationRepository.getContextMessages(
        prepared.value.session.id,
        prepared.value.session.contextSnapshotId ?? ''
      )
    ).toEqual(
      prepared.value.context?.messages
    );
    expect(llmFactoryCalls).toEqual([]);
  });

  it('reconciles source changes committed while the initial message range is being scanned', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    vi.spyOn(privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(2));
    const change: PrivateWhatsAppContextChange = {
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      chatId: CHAT_ID,
      sequence: 2,
      messageId: `message:${SOURCE_ACCOUNT_ID}:$event-1`,
      messageRevision: 2,
      changeType: 'edited',
      changedAt: '2026-06-30T11:00:00.000Z',
      eventTimestamp: '2026-06-30T10:00:00.000Z',
      before: {
        state: 'included',
        eventTimestamp: '2026-06-30T10:00:00.000Z',
        importedAt: '2026-06-30T10:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'We agreed to meet at 17:00.',
        reactions: [],
      },
      after: {
        state: 'included',
        eventTimestamp: '2026-06-30T10:00:00.000Z',
        importedAt: '2026-06-30T10:00:00.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'We agreed to meet at 18:00.',
        reactions: [],
      },
      schemaVersion: 1,
    };
    vi.spyOn(privateRepository, 'findConversationContextJournalEntries').mockResolvedValue(
      ok({ entries: [change] })
    );
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-reconciled-prepare',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
        displayTimeZone: 'Europe/Warsaw',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const prepared = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.session.transcriptText).toContain('We agreed to meet at 18:00.');
    expect(prepared.value.session.transcriptText).not.toContain('17:00');
    expect(prepared.value.session.continuation?.contextChangeThrough).toBe(2);
  });

  it('fails preparation for journal head, page, gap, and cursor consistency errors', async () => {
    async function createCase(requestId: string): Promise<{
      deps: ConversationAssistantDeps;
      privateRepository: FakePrivateWhatsAppRepository;
      session: { id: string; userId: string; generationId?: string };
    }> {
      const scenario = makeDeps();
      await seedDirectMessage(scenario.privateRepository);
      const created = await createQueuedConversationAssistantSession(
        {
          userId: USER_ID,
          requestId,
          chatId: CHAT_ID,
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        scenario.deps
      );
      if (!created.ok) throw new Error(created.error.message);
      return {
        deps: scenario.deps,
        privateRepository: scenario.privateRepository,
        session: created.value.session,
      };
    }

    const startHeadFailure = await createCase('request-start-head-failure');
    vi.spyOn(
      startHeadFailure.privateRepository,
      'getConversationContextJournalHead'
    ).mockResolvedValue(err({ code: 'PERSISTENCE_ERROR', message: 'start head failed' }));
    await expect(
      prepareConversationAssistantSession(
        preparationInput(startHeadFailure.session),
        startHeadFailure.deps
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR', message: 'start head failed' },
    });

    const cutoffHeadFailure = await createCase('request-cutoff-head-failure');
    vi.spyOn(cutoffHeadFailure.privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(err({ code: 'PERSISTENCE_ERROR', message: 'cutoff head failed' }));
    await expect(
      prepareConversationAssistantSession(
        preparationInput(cutoffHeadFailure.session),
        cutoffHeadFailure.deps
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR', message: 'cutoff head failed' },
    });

    const pageFailure = await createCase('request-journal-page-failure');
    vi.spyOn(pageFailure.privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(2));
    vi.spyOn(pageFailure.privateRepository, 'findConversationContextJournalEntries').mockResolvedValue(
      err({ code: 'PERSISTENCE_ERROR', message: 'journal page failed' })
    );
    await expect(
      prepareConversationAssistantSession(preparationInput(pageFailure.session), pageFailure.deps)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR', message: 'journal page failed' },
    });

    const gap = await createCase('request-journal-gap');
    vi.spyOn(gap.privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(3));
    vi.spyOn(gap.privateRepository, 'findConversationContextJournalEntries').mockResolvedValue(
      ok({ entries: [makeContextJournalChange(3)] })
    );
    await expect(
      prepareConversationAssistantSession(preparationInput(gap.session), gap.deps)
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PERSISTENCE_ERROR',
        message: 'Private WhatsApp context journal is incomplete at sequence 2',
      },
    });

    const nonAdvancing = await createCase('request-journal-cursor-stalled');
    vi.spyOn(nonAdvancing.privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(2));
    vi.spyOn(
      nonAdvancing.privateRepository,
      'findConversationContextJournalEntries'
    ).mockResolvedValue(ok({ entries: [], nextAfterSequence: 1 }));
    await expect(
      prepareConversationAssistantSession(
        preparationInput(nonAdvancing.session),
        nonAdvancing.deps
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PERSISTENCE_ERROR',
        message: 'Private WhatsApp context journal cursor did not advance',
      },
    });
  });

  it('reads a multi-page context journal until the cutoff', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-journal-pages',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    vi.spyOn(privateRepository, 'getConversationContextJournalHead')
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok(3));
    const journalQuery = vi
      .spyOn(privateRepository, 'findConversationContextJournalEntries')
      .mockResolvedValueOnce(
        ok({ entries: [makeContextJournalChange(2)], nextAfterSequence: 2 })
      )
      .mockResolvedValueOnce(ok({ entries: [makeContextJournalChange(3)] }));

    const prepared = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(prepared.ok).toBe(true);
    expect(journalQuery).toHaveBeenCalledTimes(2);
    expect(journalQuery.mock.calls[1]?.[0].afterSequence).toBe(2);
  });

  it('rejects a generation-less preparation event for a generated session', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-generation-fence',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      prepareConversationAssistantSession(
        { userId: USER_ID, sessionId: created.value.session.id },
        deps
      )
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    await expect(
      conversationRepository.getSessionById(created.value.session.id)
    ).resolves.toMatchObject({ status: 'preparing', preparationStage: 'queued' });
  });

  it('covers preparation entry boundaries and the legacy default attempt', async () => {
    expect(conversationAssistantRandomIds.sessionId()).toMatch(/^whatsapp_conv_session_/);
    expect(conversationAssistantRandomIds.sessionId()).not.toBe(
      conversationAssistantRandomIds.sessionId()
    );
    expect(
      conversationAssistantRandomIds.sessionId({
        userId: USER_ID,
        requestId: 'request-deterministic-id',
      })
    ).toMatch(/^whatsapp_conv_session_[a-f0-9]{32}$/);

    const { deps, privateRepository, conversationRepository } = makeDeps();
    const missing = await prepareConversationAssistantSession(
      { userId: USER_ID, sessionId: 'missing-session' },
      deps
    );
    expect(missing).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });

    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-preparation-boundaries',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await conversationRepository.saveSession({
      ...created.value.session,
      status: 'ready',
      preparationStage: 'ready',
    });
    const alreadyReady = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );
    expect(alreadyReady.ok && alreadyReady.value.session.status).toBe('ready');

    const legacy = {
      ...created.value.session,
      id: 'whatsapp_conv_session_legacy_attempt',
    };
    delete legacy.preparationAttempt;
    delete legacy.generationId;
    await conversationRepository.saveSession(legacy);
    const attempts: number[] = [];
    conversationRepository.claimPreparation = (
      input
    ): ReturnType<ConversationAssistantDeps['repository']['claimPreparation']> => {
      attempts.push(input.attempt);
      return Promise.resolve({ status: 'not_found' });
    };
    const disappeared = await prepareConversationAssistantSession(
      preparationInput(legacy),
      deps
    );
    expect(attempts).toEqual([1]);
    expect(disappeared).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
  });

  it('handles source failures before and during message loading after claiming preparation', async () => {
    const first = makeDeps();
    await seedDirectMessage(first.privateRepository);
    const chatFailureSession = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-chat-load-failure',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      first.deps
    );
    expect(chatFailureSession.ok).toBe(true);
    if (!chatFailureSession.ok) return;
    first.privateRepository.failNext({ code: 'PERSISTENCE_ERROR', message: 'account failed' });
    const savedFailure = await prepareConversationAssistantSession(
      preparationInput(chatFailureSession.value.session),
      first.deps
    );
    expect(savedFailure).toEqual({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR', message: 'account failed' },
    });

    const second = makeDeps();
    await seedDirectMessage(second.privateRepository);
    const lostChatFailure = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-lost-chat-failure',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      second.deps
    );
    expect(lostChatFailure.ok).toBe(true);
    if (!lostChatFailure.ok) return;
    second.privateRepository.failNext({ code: 'PERSISTENCE_ERROR', message: 'account failed' });
    vi.spyOn(second.conversationRepository, 'saveClaimedPreparationSession').mockResolvedValue(
      false
    );
    const currentAfterChatFailure = await prepareConversationAssistantSession(
      preparationInput(lostChatFailure.value.session),
      second.deps
    );
    expect(currentAfterChatFailure.ok).toBe(true);

    const third = makeDeps();
    await seedDirectMessage(third.privateRepository);
    const messageFailureSession = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-message-load-failure',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      third.deps
    );
    expect(messageFailureSession.ok).toBe(true);
    if (!messageFailureSession.ok) return;
    third.privateRepository.failNextConversationContextQuery({
      code: 'PERSISTENCE_ERROR',
      message: 'messages failed',
    });
    vi.spyOn(third.conversationRepository, 'saveClaimedPreparationSession').mockResolvedValue(
      false
    );
    const currentAfterMessageFailure = await prepareConversationAssistantSession(
      preparationInput(messageFailureSession.value.session),
      third.deps
    );
    expect(currentAfterMessageFailure.ok).toBe(true);
  });

  it('returns the latest state when preparation loses its claim before context projection', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-building-fence-loss',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    vi.spyOn(conversationRepository, 'saveClaimedPreparationSession').mockResolvedValue(false);
    const getSessionById = conversationRepository.getSessionById.bind(conversationRepository);
    let reads = 0;
    vi.spyOn(conversationRepository, 'getSessionById').mockImplementation(async (sessionId) => {
      reads += 1;
      return reads === 1 ? await getSessionById(sessionId) : null;
    });

    const result = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
  });

  it('returns the latest state when an empty projected context loses its failure fence', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository, { type: 'image' });
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-empty-context-fence-loss',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const saveClaimedPreparationSession =
      conversationRepository.saveClaimedPreparationSession.bind(conversationRepository);
    vi.spyOn(conversationRepository, 'saveClaimedPreparationSession').mockImplementation(
      async (input) =>
        input.session.status === 'failed'
          ? false
          : await saveClaimedPreparationSession(input)
    );

    const result = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(result.ok).toBe(true);
  });

  it('removes a newly written context snapshot when the preparation fence is lost', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-lost-fence',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const claimId = 'claim-lost-after-snapshot';
    const saveClaimedPreparationSession =
      conversationRepository.saveClaimedPreparationSession.bind(conversationRepository);
    vi.spyOn(conversationRepository, 'saveClaimedPreparationSession').mockImplementation(
      async (input) => {
        if (input.session.status === 'ready') return false;
        return await saveClaimedPreparationSession(input);
      }
    );

    const prepared = await prepareConversationAssistantSession(
      preparationInput(created.value.session, {
        attempt: 1,
        claimId,
      }),
      deps
    );

    expect(prepared.ok).toBe(true);
    const snapshotId = createHash('sha256')
      .update(`${created.value.session.id}:1:${claimId}`)
      .digest('hex');
    expect(
      conversationRepository.getContextMessages(created.value.session.id, snapshotId)
    ).toEqual([]);
  });

  it('returns the current preparation state when the context snapshot fence is lost', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-context-snapshot-fence-loss',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    vi.spyOn(conversationRepository, 'saveContextSnapshot').mockResolvedValue(false);

    const prepared = await prepareConversationAssistantSession(
      preparationInput(created.value.session),
      deps
    );

    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.value.session.status).toBe('preparing');
  });

  it('removes a partially written context snapshot when snapshot persistence fails', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-partial-snapshot',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const claimId = 'claim-partial-snapshot';
    const saveContextSnapshot = conversationRepository.saveContextSnapshot.bind(
      conversationRepository
    );
    vi.spyOn(conversationRepository, 'saveContextSnapshot').mockImplementation(
      async (...input) => {
        await saveContextSnapshot(...input);
        throw new Error('Partial snapshot write');
      }
    );

    await expect(
      prepareConversationAssistantSession(
        preparationInput(created.value.session, {
          attempt: 1,
          claimId,
        }),
        deps
      )
    ).rejects.toThrow('Partial snapshot write');

    const snapshotId = createHash('sha256')
      .update(`${created.value.session.id}:1:${claimId}`)
      .digest('hex');
    expect(
      conversationRepository.getContextMessages(created.value.session.id, snapshotId)
    ).toEqual([]);
  });

  it('rejects a parallel preparation claim and ignores stale preparation events', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-concurrency',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const firstClaim = await conversationRepository.claimPreparation({
      sessionId: created.value.session.id,
      userId: USER_ID,
      attempt: 1,
      claimId: 'claim-1',
      now: '2026-06-30T12:00:00.000Z',
      leaseExpiresAt: '2026-06-30T12:05:00.000Z',
      ...(created.value.session.generationId !== undefined
        ? { expectedGenerationId: created.value.session.generationId }
        : {}),
    });
    expect(firstClaim.status).toBe('claimed');

    const duplicate = await prepareConversationAssistantSession(
      preparationInput(created.value.session, {
        attempt: 1,
        claimId: 'claim-2',
      }),
      deps
    );
    expect(duplicate).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_ERROR',
        message: 'Conversation Assistant preparation is already in progress',
      },
    });

    const claimedSession = await conversationRepository.getSessionById(created.value.session.id);
    expect(claimedSession).not.toBeNull();
    if (claimedSession === null) return;
    const failed = { ...claimedSession, status: 'failed' as const, preparationStage: 'failed' as const };
    delete failed.preparationClaimId;
    delete failed.preparationLeaseExpiresAt;
    await conversationRepository.saveSession(failed);
    const retried = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(retried.ok).toBe(true);

    const stale = await prepareConversationAssistantSession(
      preparationInput(created.value.session, {
        attempt: 1,
        claimId: 'late-claim-1',
      }),
      deps
    );
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.session.preparationAttempt).toBe(2);
      expect(stale.value.session.status).toBe('preparing');
    }
  });

  it('uses a fresh fencing token for every preparation execution', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-fencing',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const claims: string[] = [];
    conversationRepository.claimPreparation = (
      input
    ): ReturnType<FakeConversationAssistantRepository['claimPreparation']> => {
      claims.push(input.claimId);
      return Promise.resolve({ status: 'busy', session: created.value.session });
    };

    await prepareConversationAssistantSession(
      preparationInput(created.value.session, { attempt: 1 }),
      deps
    );
    await prepareConversationAssistantSession(
      preparationInput(created.value.session, { attempt: 1 }),
      deps
    );

    expect(claims).toHaveLength(2);
    expect(claims[0]).not.toBe(claims[1]);
  });

  it('does not overwrite a preparation claim when publishing reports a failure', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    deps.preparationPublisher.publish = async (
      event
    ): ReturnType<ConversationAssistantDeps['preparationPublisher']['publish']> => {
      const claimed = await conversationRepository.claimPreparation({
        sessionId: event.sessionId,
        userId: event.userId,
        attempt: event.attempt,
        claimId: 'worker-claim',
        now: '2026-06-30T12:00:00.000Z',
        leaseExpiresAt: '2026-06-30T12:05:00.000Z',
        ...(event.generationId !== undefined
          ? { expectedGenerationId: event.generationId }
          : {}),
      });
      expect(claimed.status).toBe('claimed');
      return err({ code: 'INTERNAL_ERROR', message: 'Publish response was lost' });
    };

    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-publish-race',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.session.status).toBe('preparing');
    expect(created.value.session.preparationStage).toBe('loading_messages');
    expect(created.value.session.preparationClaimId).toBe('worker-claim');
  });

  it('returns the exact frozen messages used by the analysis', async () => {
    const { deps, privateRepository } = makeDeps();
    await seedDirectMessage(privateRepository, {
      matrixEventId: '$frozen-message',
      text: 'Frozen message used by the model.',
    });
    const prepared = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    await seedDirectMessage(privateRepository, {
      eventTimestamp: '2026-06-30T11:00:00.000Z',
      matrixEventId: '$later-message',
      text: 'Added to the source after the snapshot.',
    });
    const context = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: prepared.value.session.id },
      deps
    );

    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.value.snapshotAvailable).toBe(true);
    expect(context.value.messageCount).toBe(1);
    expect(context.value.messages).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        speakerLabel: 'Alice',
        content: 'Frozen message used by the model.',
        contentKind: 'text',
      }),
    ]);
    expect(context.value.messages[0]?.content).not.toContain('Added to the source');
    expect(context.value.transcriptSha256).toBe(prepared.value.session.transcriptSha256);
  });

  it('returns one session for repeated creation requests and supports recovery by request id', async () => {
    const { deps, privateRepository, conversationRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    const input = {
      userId: USER_ID,
      requestId: 'request-idempotent',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };

    const first = await createQueuedConversationAssistantSession(input, deps);
    const repeated = await createQueuedConversationAssistantSession(input, deps);
    const recovered = await getConversationAssistantSessionByRequest(
      { userId: USER_ID, requestId: input.requestId },
      deps
    );

    expect(first.ok && repeated.ok ? repeated.value.session.id : undefined).toBe(
      first.ok ? first.value.session.id : undefined
    );
    expect(conversationRepository.getAllSessions()).toHaveLength(1);
    expect(preparationEvents).toHaveLength(1);
    expect(recovered.ok ? recovered.value.id : undefined).toBe(
      first.ok ? first.value.session.id : undefined
    );
    const unavailableContext = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: first.ok ? first.value.session.id : 'missing' },
      deps
    );
    expect(unavailableContext).toEqual({
      ok: false,
      error: {
        code: 'CONTEXT_NOT_READY',
        message: 'Conversation context is not ready yet',
      },
    });
  });

  it('validates request recovery and detects deterministic request collisions', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    expect(
      await getConversationAssistantSessionByRequest({ userId: USER_ID, requestId: '   ' }, deps)
    ).toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'Request id is required' },
    });

    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-recovery-collision',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await conversationRepository.saveSession({
      ...created.value.session,
      creationRequestId: 'different-request',
    });

    const recovered = await getConversationAssistantSessionByRequest(
      { userId: USER_ID, requestId: 'request-recovery-collision' },
      deps
    );
    const collision = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-recovery-collision',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );

    expect(recovered.ok).toBe(false);
    if (!recovered.ok) expect(recovered.error.code).toBe('NOT_FOUND');
    expect(collision).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Conversation Assistant request collision' },
    });
  });

  it('does not reuse an idempotent session after deletion has started', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const input = {
      userId: USER_ID,
      requestId: 'request-deleting-reuse',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };
    const created = await createQueuedConversationAssistantSession(input, deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await conversationRepository.saveSession({
      ...created.value.session,
      deletionStartedAt: '2026-06-30T12:01:00.000Z',
    });

    await expect(createQueuedConversationAssistantSession(input, deps)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
  });

  it('reuses a ready idempotent analysis and requeues a failed legacy analysis', async () => {
    const readyCase = makeDeps();
    await seedDirectMessage(readyCase.privateRepository);
    const input = {
      userId: USER_ID,
      requestId: 'request-ready-reuse',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };
    const createdReady = await createQueuedConversationAssistantSession(input, readyCase.deps);
    expect(createdReady.ok).toBe(true);
    if (!createdReady.ok) return;
    await readyCase.conversationRepository.saveSession({
      ...createdReady.value.session,
      status: 'ready',
      preparationStage: 'ready',
    });
    const reusedReady = await createQueuedConversationAssistantSession(input, readyCase.deps);
    expect(reusedReady.ok && reusedReady.value.session.status).toBe('ready');

    const legacyCase = makeDeps();
    await seedDirectMessage(legacyCase.privateRepository);
    const legacyInput = { ...input, requestId: 'request-legacy-requeue' };
    const createdLegacy = await createQueuedConversationAssistantSession(
      legacyInput,
      legacyCase.deps
    );
    expect(createdLegacy.ok).toBe(true);
    if (!createdLegacy.ok) return;
    const failedLegacy = {
      ...createdLegacy.value.session,
      status: 'failed' as const,
      preparationStage: 'failed' as const,
    };
    delete failedLegacy.preparationAttempt;
    delete failedLegacy.generationId;
    await legacyCase.conversationRepository.saveSession(failedLegacy);

    const requeued = await createQueuedConversationAssistantSession(
      legacyInput,
      legacyCase.deps
    );

    expect(requeued.ok).toBe(true);
    if (requeued.ok) {
      expect(requeued.value.session.preparationAttempt).toBe(1);
      expect(requeued.value.session.status).toBe('preparing');
    }
  });

  it('handles a disappeared requeue and fallback attempt values after legacy retries', async () => {
    const missingCase = makeDeps();
    await seedDirectMessage(missingCase.privateRepository);
    const missingInput = {
      userId: USER_ID,
      requestId: 'request-requeue-disappeared',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };
    const createdMissing = await createQueuedConversationAssistantSession(
      missingInput,
      missingCase.deps
    );
    expect(createdMissing.ok).toBe(true);
    if (!createdMissing.ok) return;
    await missingCase.conversationRepository.saveSession({
      ...createdMissing.value.session,
      status: 'failed',
      preparationStage: 'failed',
    });
    vi.spyOn(missingCase.conversationRepository, 'requeueFailedPreparation').mockResolvedValue({
      status: 'not_found',
    });
    const disappeared = await createQueuedConversationAssistantSession(
      missingInput,
      missingCase.deps
    );
    expect(disappeared.ok).toBe(false);
    if (!disappeared.ok) expect(disappeared.error.code).toBe('NOT_FOUND');

    const fallbackCase = makeDeps();
    await seedDirectMessage(fallbackCase.privateRepository);
    const createdFallback = await createQueuedConversationAssistantSession(
      { ...missingInput, requestId: 'request-fallback-attempt' },
      fallbackCase.deps
    );
    expect(createdFallback.ok).toBe(true);
    if (!createdFallback.ok) return;
    const failedFallback = {
      ...createdFallback.value.session,
      status: 'failed' as const,
      preparationStage: 'failed' as const,
    };
    delete failedFallback.preparationAttempt;
    delete failedFallback.generationId;
    await fallbackCase.conversationRepository.saveSession(failedFallback);
    const queuedWithoutAttempt = {
      ...failedFallback,
      status: 'preparing' as const,
      preparationStage: 'queued' as const,
    };
    fallbackCase.conversationRepository.requeueFailedPreparation = (): ReturnType<
      ConversationAssistantDeps['repository']['requeueFailedPreparation']
    > => Promise.resolve({ status: 'queued', session: queuedWithoutAttempt });
    const publishedAttempts: number[] = [];
    fallbackCase.deps.preparationPublisher.publish = (
      event
    ): ReturnType<ConversationAssistantDeps['preparationPublisher']['publish']> => {
      publishedAttempts.push(event.attempt);
      return Promise.resolve(err({ code: 'INTERNAL_ERROR', message: 'publish failed' }));
    };
    const failedAttempts: number[] = [];
    fallbackCase.conversationRepository.failQueuedPreparation = (
      request
    ): ReturnType<ConversationAssistantDeps['repository']['failQueuedPreparation']> => {
      failedAttempts.push(request.attempt);
      return Promise.resolve({ status: 'not_found' });
    };

    const fallback = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: failedFallback.id },
      fallbackCase.deps
    );

    expect(fallback.ok).toBe(true);
    expect(publishedAttempts).toEqual([1]);
    expect(failedAttempts).toEqual([1]);
  });

  it('publishes only once for concurrent creates with the same request id', async () => {
    const { deps, privateRepository, conversationRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    const input = {
      userId: USER_ID,
      requestId: 'request-concurrent-create',
      chatId: CHAT_ID,
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    };

    const [first, second] = await Promise.all([
      createQueuedConversationAssistantSession(input, deps),
      createQueuedConversationAssistantSession(input, deps),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(conversationRepository.getAllSessions()).toHaveLength(1);
    expect(preparationEvents).toHaveLength(1);
  });

  it('blocks messages until context is ready and can requeue a failed preparation', async () => {
    const { deps, privateRepository, conversationRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-retry',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const blocked = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Too early' },
      deps
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('CONTEXT_NOT_READY');

    await conversationRepository.saveSession({
      ...created.value.session,
      status: 'failed',
      preparationStage: 'failed',
      preparationError: { code: 'PERSISTENCE_ERROR', message: 'Temporary failure' },
    });
    const retried = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.status).toBe('preparing');
    expect(retried.value.preparationStage).toBe('queued');
    expect(retried.value.preparationError).toBeUndefined();
    expect(retried.value.preparationAttempt).toBe(2);
    expect(preparationEvents).toHaveLength(2);
    expect(preparationEvents[1]?.attempt).toBe(2);
  });

  it('publishes only once for concurrent retries of the same failed preparation', async () => {
    const { deps, privateRepository, conversationRepository, preparationEvents } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-concurrent-retry',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await conversationRepository.saveSession({
      ...created.value.session,
      status: 'failed',
      preparationStage: 'failed',
      preparationError: { code: 'PERSISTENCE_ERROR', message: 'Temporary failure' },
    });

    const [first, second] = await Promise.all([
      retryConversationAssistantPreparation(
        { userId: USER_ID, sessionId: created.value.session.id },
        deps
      ),
      retryConversationAssistantPreparation(
        { userId: USER_ID, sessionId: created.value.session.id },
        deps
      ),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(preparationEvents).toHaveLength(2);
    expect(preparationEvents[1]?.attempt).toBe(2);
    expect(
      (await conversationRepository.getSessionById(created.value.session.id))
        ?.preparationAttempt
    ).toBe(2);
  });

  it('validates every retry state and handles a session disappearing during requeue', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    expect(
      await retryConversationAssistantPreparation(
        { userId: USER_ID, sessionId: 'missing-session' },
        deps
      )
    ).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });

    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-retry-states',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const preparing = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(preparing.ok).toBe(false);
    if (!preparing.ok) expect(preparing.error.message).toBe('Conversation context is already preparing');

    await conversationRepository.saveSession({
      ...created.value.session,
      status: 'ready',
      preparationStage: 'ready',
    });
    const ready = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(ready.ok).toBe(false);
    if (!ready.ok) expect(ready.error.message).toBe('Conversation context is already ready');

    await conversationRepository.saveSession({
      ...created.value.session,
      status: 'failed',
      preparationStage: 'failed',
    });
    vi.spyOn(conversationRepository, 'requeueFailedPreparation').mockResolvedValue({
      status: 'not_found',
    });
    const disappeared = await retryConversationAssistantPreparation(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(disappeared.ok).toBe(false);
    if (!disappeared.ok) expect(disappeared.error.code).toBe('NOT_FOUND');
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
    expect(result.value).not.toHaveProperty('turns');
    expect(result.value.session.transcriptText).toContain('We agreed to meet at 17:00.');
    expect(result.value.context).toBeDefined();
    if (result.value.context === undefined) return;
    expect(result.value.session.transcriptSha256).toBe(result.value.context.transcriptSha256);
    expect(conversationRepository.getAllSessions()).toHaveLength(1);
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
      expect(result.value.context).toBeDefined();
      if (result.value.context === undefined) return;
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
    const firstPage = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: result.value.session.id },
      deps
    );
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.messages).toHaveLength(100);
    expect(firstPage.value.nextMessageCursor).toBe(100);
    const nextMessageCursor = firstPage.value.nextMessageCursor;
    if (nextMessageCursor === undefined) return;
    const secondPage = await getConversationAssistantContext(
      {
        userId: USER_ID,
        sessionId: result.value.session.id,
        messageCursor: nextMessageCursor,
      },
      deps
    );
    expect(secondPage.ok).toBe(true);
    if (secondPage.ok) {
      expect(secondPage.value.messages[0]?.content).toBe('Message 101');
    }
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

  it('creates a shell and sends the first user and assistant turns separately', async () => {
    const { deps, conversationRepository, privateRepository, llmClient, llmFactoryCalls } =
      makeDeps();
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
    const firstTurn = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: result.value.session.id, question: 'What was agreed?' },
      deps
    );
    expect(firstTurn.ok).toBe(true);
    expect(firstTurn.ok ? firstTurn.value.map((turn) => turn.role) : []).toEqual([
      'user',
      'assistant',
    ]);
    expect(conversationRepository.getAllTurns()).toHaveLength(2);
    expect(llmFactoryCalls).toEqual([
      { userId: USER_ID, model: 'or:google/gemini-3.5-flash' },
    ]);
    expect(llmClient.chatCalls[0]?.options).not.toHaveProperty('sessionId');
    expect(llmClient.chatCalls[0]?.options).not.toHaveProperty('correlation');
    expect(JSON.stringify(llmClient.chatCalls[0]?.options)).not.toContain(
      'whatsapp_conv_session_test'
    );
    expect(llmClient.chatCalls[0]?.options.reasoning).toEqual({ enabled: true });
    const firstPrompt = JSON.stringify(llmClient.chatCalls[0]?.messages[1]);
    expect(firstPrompt).toContain('Information range: 30 June 2026 to 1 July 2026');
    expect(firstPrompt).toContain('Effective range: 30 June 2026 to 30 June 2026');
    expect(JSON.stringify(llmClient.chatCalls[0]?.messages)).toContain('cache_control');
  });

  it('persists assistant error turns when the LLM call fails', async () => {
    const { deps, privateRepository, conversationRepository, llmClient } = makeDeps();
    await seedDirectMessage(privateRepository);
    const privateMarker = 'PRIVATE_LEGACY_SYNC_LLM_MARKER_8e6a11c4';
    llmClient.failNextChat(privateMarker);

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
    const result = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Summarize.' },
      deps
    );
    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(JSON.stringify({ result, turns: conversationRepository.getAllTurns() })).not.toContain(
      privateMarker
    );
  });

  it('persists assistant error turns when user LLM key lookup fails before sync generation', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const privateMarker = 'PRIVATE_LEGACY_KEY_LOOKUP_MARKER_9db7879f';

    const unavailableDeps = {
      ...deps,
      llmClientFactory: {
        createLlmClientForUser: (): ReturnType<
          ConversationAssistantDeps['llmClientFactory']['createLlmClientForUser']
        > =>
          Promise.resolve(err({ code: 'LLM_ERROR' as const, message: privateMarker })),
      },
    };
    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      unavailableDeps
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Summarize.' },
      unavailableDeps
    );
    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(JSON.stringify({ result, turns: conversationRepository.getAllTurns() })).not.toContain(
      privateMarker
    );
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
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const firstTurn = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'What was agreed?' },
      deps
    );
    expect(firstTurn.ok).toBe(true);
    const followUp = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'What time?' },
      deps
    );

    expect(followUp.ok).toBe(true);
    expect(llmClient.chatCalls).toHaveLength(2);
    expect(llmFactoryCalls).toEqual([
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
      { userId: USER_ID, model: 'or:anthropic/claude-sonnet-5' },
    ]);
    expect(JSON.stringify(llmClient.chatCalls[0]?.messages[1])).toBe(
      JSON.stringify(llmClient.chatCalls[1]?.messages[1])
    );
  });

  it('returns not found when generation fences reject user or assistant turn persistence', async () => {
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
    const input = {
      userId: USER_ID,
      sessionId: created.value.session.id,
      question: 'Will this persist?',
    };

    const rejectedUserTurn = vi
      .spyOn(conversationRepository, 'saveTurnIfSessionExists')
      .mockResolvedValueOnce(false);
    await expect(sendConversationAssistantTurn(input, deps)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    rejectedUserTurn.mockRestore();

    const rejectedAssistantTurn = vi
      .spyOn(conversationRepository, 'saveAssistantTurnAndTouchSession')
      .mockResolvedValueOnce(false);
    await expect(sendConversationAssistantTurn(input, deps)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    rejectedAssistantTurn.mockRestore();

    vi.spyOn(conversationRepository, 'saveTurnIfSessionExists').mockResolvedValueOnce(false);
    const events: ConversationAssistantStreamEvent[] = [];
    await expect(
      streamConversationAssistantTurn(input, deps, (event) => events.push(event))
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    expect(events).toEqual([]);
  });

  it('keeps neutral session metadata when the first private message is sent', async () => {
    const { deps, conversationRepository } = makeDeps();
    await seedDirectMessage(deps.privateWhatsAppRepository as FakePrivateWhatsAppRepository);

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
    const firstTurn = await sendConversationAssistantTurn(
      {
        userId: USER_ID,
        sessionId: result.value.session.id,
        question: 'Why do I keep feeling anxious after these messages?',
      },
      deps
    );
    expect(firstTurn.ok).toBe(true);
    const updatedSession = await conversationRepository.getSessionById(result.value.session.id);
    expect(updatedSession?.assistantRoleLabel).toBe('Assistant');
    expect(updatedSession?.title).toBe('Alice (2026-06-30 to 2026-07-01)');
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
    expect(llmClient.streamChatCalls[0]?.options).not.toHaveProperty('sessionId');
    expect(llmClient.streamChatCalls[0]?.options).not.toHaveProperty('correlation');
    expect(JSON.stringify(llmClient.streamChatCalls[0]?.options)).not.toContain(
      created.value.session.id
    );
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
    const privateMarker = 'PRIVATE_LEGACY_STREAM_LLM_MARKER_e8d39632';
    llmClient.failNextStream(privateMarker, [{ type: 'delta', text: 'partial' }]);
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
      message: 'Conversation Assistant request failed',
    });
    expect(events.find((event) => event.type === 'error')).toEqual({
      type: 'error',
      error: { code: 'LLM_ERROR', message: 'Conversation Assistant request failed' },
    });
    expect(JSON.stringify({ result, events, turns: conversationRepository.getAllTurns() })).not.toContain(
      privateMarker
    );
  });

  it('does not recreate a session when it is deleted during a streamed response', async () => {
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
    llmClient.setNextStreamEvents([{ type: 'delta', text: 'late answer' }]);

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Delete while answering.' },
      deps,
      (event) => {
        if (event.type === 'user_turn') {
          void conversationRepository.deleteSession({
            sessionId: created.value.session.id,
            userId: USER_ID,
            deletionToken: createConversationAssistantDeletionToken(created.value.session),
          });
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    expect(await conversationRepository.getSessionById(created.value.session.id)).toBeNull();
    expect(conversationRepository.getAllTurns()).toEqual([]);
  });

  it('does not write a delayed streamed response into a replacement session with the same id', async () => {
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
    const originalSession = {
      ...created.value.session,
      generationId: 'generation-original',
    } as typeof created.value.session;
    await conversationRepository.saveSession(originalSession);
    llmClient.setNextStreamEvents([{ type: 'delta', text: 'late answer' }]);

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: originalSession.id, question: 'Replace while answering.' },
      deps,
      (event) => {
        if (event.type === 'user_turn') {
          void conversationRepository.deleteSession({
            sessionId: originalSession.id,
            userId: USER_ID,
            deletionToken: createConversationAssistantDeletionToken(originalSession),
          });
          void conversationRepository.saveSession({
            ...originalSession,
            generationId: 'generation-replacement',
            updatedAt: '2026-06-30T13:00:00.000Z',
          } as typeof originalSession);
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });
    expect(await conversationRepository.getSessionById(originalSession.id)).toMatchObject({
      generationId: 'generation-replacement',
      updatedAt: '2026-06-30T13:00:00.000Z',
    });
    expect(conversationRepository.getAllTurns()).toEqual([]);
  });

  it('exports an owned session PDF with mapped counts and chronological turns', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    const record = vi.fn(() => {
      throw new Error('metrics unavailable');
    });
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
      assistantRoleLabel: 'Psychologist',
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
      { ...deps, telemetry: { record } }
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
        assistantRoleLabel: 'Psychologist',
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
        cumulativeContext: {
          snapshotCount: 1,
          counts: {
            included: 7,
            omitted: 15,
            completedTranscriptions: 0,
            edited: 0,
            redacted: 0,
            deleted: 0,
            reactionsChanged: 0,
            lateIngested: 0,
          },
        },
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
    expect(pdfExporter.calls[0]?.assistantRoleLabel).toBe('Psychologist');
    expect(record).toHaveBeenCalledOnce();
  });

  it('exports only the completed revision and maps immutable attachment summaries without bodies', async () => {
    const { deps, conversationRepository, pdfExporter } = makeDeps();
    const record = vi.fn().mockRejectedValue(new Error('metrics unavailable'));
    const sessionId = 'whatsapp_conv_session_revision';
    await conversationRepository.saveSession({
      id: sessionId,
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
      transcriptSha256: 'initial-private-hash',
      transcriptMessageCount: 7,
      transcriptText: 'frozen transcript body must not be exported',
      assistantRoleLabel: 'Psychologist',
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      title: 'Revision export',
      createdAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-07-19T10:16:00.000Z',
      continuation: {
        sourceAccountId: 'private-source-account',
        contextVersion: 1,
        contextEventThrough: '2026-07-19T10:14:00.000Z',
        contextChangeThrough: 8,
        contextChainSha256: 'private-chain-hash',
        displayTimeZone: 'Europe/Warsaw',
        nextTurnSequence: 7,
        nextConversationRevision: 4,
        completedConversationRevision: 2,
        attachmentCount: 1,
        totalAttachedMessageCount: 18,
        totalAttachedOmittedCount: 2,
        activeTurnRequestId: 'request-active',
      },
    });
    for (const turn of [
      {
        id: 'turn-initial-user',
        role: 'user' as const,
        text: 'Initial question',
        createdAt: '2026-06-30T12:01:00.000Z',
        sequence: 1,
        conversationRevision: 1,
      },
      {
        id: 'turn-update-user',
        role: 'user' as const,
        text: 'How did the attitude change?',
        createdAt: '2026-07-19T10:15:00.000Z',
        sequence: 3,
        conversationRevision: 2,
        requestId: 'request-completed',
        kind: 'context_attachment_question' as const,
        contextAttachmentId: 'private-attachment-id',
        contextAttachment: {
          id: 'private-attachment-id',
          capturedAt: '2026-07-19T10:14:00.000Z',
          eventRange: {
            from: '2026-07-17T18:49:00.000Z',
            to: '2026-07-19T10:09:00.000Z',
          },
          captureRange: {
            from: '2026-06-30T10:30:00.000Z',
            to: '2026-07-19T10:14:00.000Z',
          },
          counts: {
            included: 18,
            excluded: 2,
            newlyAvailable: 18,
            completedTranscriptions: 1,
            edited: 2,
            redacted: 1,
            deleted: 2,
            reactionsChanged: 3,
            lateIngested: 1,
          },
          omitted: {
            mediaOnly: 1,
            failedTranscriptions: 0,
            pendingTranscriptions: 1,
            nonText: 0,
            overLimit: 0,
          },
        },
      },
      {
        id: 'turn-update-assistant',
        role: 'assistant' as const,
        text: 'The tone became more collaborative.',
        createdAt: '2026-07-19T10:15:04.000Z',
        sequence: 4,
        conversationRevision: 2,
        acknowledgment: 'Added 18 new messages and applied 7 context updates.',
      },
      {
        id: 'turn-active-user',
        role: 'user' as const,
        text: 'This active revision must not appear.',
        createdAt: '2026-07-19T10:16:00.000Z',
        sequence: 5,
        conversationRevision: 3,
      },
    ]) {
      await conversationRepository.saveTurn({
        ...turn,
        sessionId,
        userId: USER_ID,
      });
    }

    const result = await exportConversationAssistantSessionPdf(
      { userId: USER_ID, sessionId },
      { ...deps, telemetry: { record } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pdfExporter.calls[0]).toMatchObject({
      completedConversationRevision: 2,
      cumulativeContext: {
        snapshotCount: 2,
        counts: {
          included: 25,
          omitted: 2,
          completedTranscriptions: 1,
          edited: 2,
          redacted: 3,
          deleted: 0,
          reactionsChanged: 3,
          lateIngested: 1,
        },
      },
      messages: [
        {
          text: 'Initial question',
          conversationRevision: 1,
        },
        {
          text: 'How did the attitude change?',
          conversationRevision: 2,
          contextAttachment: {
            capturedAt: '2026-07-19T10:14:00.000Z',
            captureRange: {
              from: '2026-06-30T10:30:00.000Z',
              to: '2026-07-19T10:14:00.000Z',
            },
            counts: {
              included: 18,
              excluded: 2,
              completedTranscriptions: 1,
              edited: 2,
              redacted: 3,
              deleted: 0,
              reactionsChanged: 3,
              lateIngested: 1,
            },
          },
        },
        {
          text: 'The tone became more collaborative.',
          conversationRevision: 2,
          acknowledgment: 'Added 18 new messages and applied 7 context updates.',
        },
      ],
    });
    expect(pdfExporter.calls[0]?.messages.map((message) => message.text)).not.toContain(
      'This active revision must not appear.'
    );
    expect(JSON.stringify(pdfExporter.calls[0])).not.toContain('private-source-account');
    expect(JSON.stringify(pdfExporter.calls[0])).not.toContain('private-chain-hash');
    expect(JSON.stringify(pdfExporter.calls[0])).not.toContain('private-attachment-id');
    expect(JSON.stringify(pdfExporter.calls[0])).not.toContain('frozen transcript body');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'pdf_revision',
        outcome: 'completed',
        count: 2,
        durationMs: expect.any(Number),
      })
    );
    expect(JSON.stringify(record.mock.calls)).not.toMatch(
      /private-source-account|private-chain-hash|private-attachment-id|frozen transcript body/
    );

    const rejectedRecord = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pdfExporter, 'exportConversation').mockRejectedValue(
      new Error('renderer crashed')
    );
    await expect(
      exportConversationAssistantSessionPdf(
        { userId: USER_ID, sessionId },
        { ...deps, telemetry: { record: rejectedRecord } }
      )
    ).rejects.toThrow('renderer crashed');
    expect(rejectedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'pdf_revision',
        outcome: 'failed',
        count: 2,
      })
    );
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
      assistantRoleLabel: 'Assistant',
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
      { id: 'turn-z', role: 'assistant' as const, text: 'assistant same time', sequence: 1 },
      { id: 'turn-b', role: 'user' as const, text: 'user b', sequence: 1 },
      { id: 'turn-a', role: 'user' as const, text: 'user a', sequence: 1 },
      { id: 'turn-future', role: 'assistant' as const, text: 'assistant future', sequence: 3 },
    ]) {
      await conversationRepository.saveTurn({
        id: turn.id,
        sessionId: 'whatsapp_conv_session_test',
        userId: USER_ID,
        role: turn.role,
        text: turn.text,
        sequence: turn.sequence,
        createdAt:
          turn.id === 'turn-future'
            ? '2026-06-30T12:01:00.000Z'
            : '2026-06-30T12:00:00.000Z',
        ...(turn.id === 'turn-b'
          ? {
              contextAttachment: {
                id: 'attachment-without-event-range',
                capturedAt: '2026-06-30T11:59:00.000Z',
                captureRange: {
                  from: '2026-06-30T10:30:00.000Z',
                  to: '2026-06-30T11:59:00.000Z',
                },
                counts: {
                  included: 0,
                  excluded: 0,
                  newlyAvailable: 0,
                  completedTranscriptions: 0,
                  edited: 0,
                  redacted: 0,
                  deleted: 0,
                  reactionsChanged: 0,
                  lateIngested: 0,
                },
                omitted: {
                  mediaOnly: 0,
                  failedTranscriptions: 0,
                  pendingTranscriptions: 0,
                  nonText: 0,
                  overLimit: 0,
                },
              },
            }
          : {}),
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
    const exportAttachment = pdfExporter.calls[0]?.messages.find(
      (message) => message.text === 'user b'
    )?.contextAttachment;
    expect(exportAttachment).toBeDefined();
    if (exportAttachment !== undefined) expect(exportAttachment).not.toHaveProperty('eventRange');
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
      assistantRoleLabel: 'Assistant',
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
      assistantRoleLabel: 'Assistant',
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
    const record = vi.fn().mockResolvedValue(undefined);
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
      assistantRoleLabel: 'Assistant',
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
      { ...deps, telemetry: { record } }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'pdf failed' });
    }
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'pdf_revision',
        outcome: 'failed',
        durationMs: expect.any(Number),
      })
    );

    const rejectedRecord = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pdfExporter, 'exportConversation').mockRejectedValue(
      new Error('renderer crashed')
    );
    await expect(
      exportConversationAssistantSessionPdf(
        { userId: USER_ID, sessionId: 'whatsapp_conv_session_test' },
        { ...deps, telemetry: { record: rejectedRecord } }
      )
    ).rejects.toThrow('renderer crashed');
    expect(rejectedRecord).toHaveBeenCalledWith(
      expect.not.objectContaining({ count: expect.any(Number) })
    );
  });

  it('persists streaming assistant errors when the user LLM key is unavailable', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const privateMarker = 'PRIVATE_LEGACY_STREAM_KEY_MARKER_c76d15aa';
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
            Promise.resolve(err({ code: 'LLM_ERROR', message: privateMarker })),
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
      'Conversation Assistant request failed'
    );
    expect(JSON.stringify({ events, turns: conversationRepository.getAllTurns() })).not.toContain(
      privateMarker
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

  it('blocks streaming while the frozen context is still preparing', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-stream-before-ready',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const events = vi.fn();

    const result = await streamConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Too early' },
      deps,
      events
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'CONTEXT_NOT_READY', message: 'Conversation context is not ready yet' },
    });
    expect(events).not.toHaveBeenCalled();
    expect(conversationRepository.getAllTurns()).toHaveLength(0);
  });

  it('validates context ownership and cursors and supports legacy and omitted-only snapshots', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
    expect(
      await getConversationAssistantContext(
        { userId: USER_ID, sessionId: 'missing-session' },
        deps
      )
    ).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Conversation Assistant session not found' },
    });

    await seedDirectMessage(privateRepository);
    const created = await createQueuedConversationAssistantSession(
      {
        userId: USER_ID,
        requestId: 'request-context-boundaries',
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      deps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const legacyReady = {
      ...created.value.session,
      status: 'ready' as const,
      preparationStage: 'ready' as const,
    };
    await conversationRepository.saveSession(legacyReady);

    const invalidCursor = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: legacyReady.id, messageCursor: -1 },
      deps
    );
    expect(invalidCursor.ok).toBe(false);
    if (!invalidCursor.ok) expect(invalidCursor.error.code).toBe('INVALID_REQUEST');
    const legacyContext = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: legacyReady.id },
      deps
    );
    expect(legacyContext.ok).toBe(true);
    if (legacyContext.ok) expect(legacyContext.value.snapshotAvailable).toBe(false);

    const omittedMessages = Array.from({ length: 101 }, (_, index) => ({
      id: `omitted-${String(index)}`,
      eventTimestamp: new Date(Date.UTC(2026, 5, 30, 10, 0, index)).toISOString(),
      importedAt: new Date(Date.UTC(2026, 5, 30, 10, 0, index)).toISOString(),
      direction: 'incoming' as const,
      speakerLabel: 'Alice',
      messageType: 'image' as const,
      omissionReason: 'media_only' as const,
    }));
    const snapshotId = 'omitted-only-snapshot';
    await conversationRepository.saveContextSnapshot(
      legacyReady.id,
      USER_ID,
      snapshotId,
      { messages: [], omittedMessages },
      legacyReady.generationId
    );
    await conversationRepository.saveSession({
      ...legacyReady,
      contextSnapshotId: snapshotId,
      omitted: {
        mediaOnly: 101,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
    });
    const omittedPage = await getConversationAssistantContext(
      { userId: USER_ID, sessionId: legacyReady.id },
      deps
    );
    expect(omittedPage.ok).toBe(true);
    if (omittedPage.ok) {
      expect(omittedPage.value.omittedMessages).toHaveLength(100);
      expect(omittedPage.value.nextOmittedCursor).toBe(100);
    }
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

    for (const [index, displayTimeZone] of ['', ' Europe/Warsaw ', 'Mars/Olympus'].entries()) {
      const invalidTimeZone = await createConversationAssistantSession(
        {
          userId: USER_ID,
          requestId: `request-invalid-timezone-${String(index)}`,
          chatId: CHAT_ID,
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
          displayTimeZone,
        },
        deps
      );
      expect(invalidTimeZone).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
    }

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
    const ownedGet = await getConversationAssistantSession(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    const ownedTurns = await listConversationAssistantTurns(
      { userId: USER_ID, sessionId: created.value.session.id },
      deps
    );
    expect(foreignSend.ok).toBe(false);
    expect(foreignGet.ok).toBe(false);
    expect(foreignTurns.ok).toBe(false);
    expect(ownedGet.ok).toBe(true);
    expect(ownedTurns).toEqual({ ok: true, value: [] });
  });

  it('deletes an owned session idempotently without deleting a foreign session', async () => {
    const { deps, conversationRepository, privateRepository } = makeDeps();
    const record = vi.fn(() => {
      throw new Error('metrics unavailable');
    });
    const instrumentedDeps = { ...deps, telemetry: { record } };
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

    const ownedSession = created.value.session;
    await conversationRepository.saveTurn({
      id: 'owned-turn',
      sessionId: ownedSession.id,
      userId: USER_ID,
      role: 'user',
      text: 'Delete this analysis',
      createdAt: '2026-06-30T12:01:00.000Z',
    });
    await conversationRepository.saveContextSnapshot(
      ownedSession.id,
      USER_ID,
      'owned-snapshot',
      { messages: [], omittedMessages: [] }
    );
    await conversationRepository.saveSession({
      ...ownedSession,
      id: 'foreign-session',
      userId: 'other-user',
    });

    await expect(
      deleteConversationAssistantSession(
        {
          userId: USER_ID,
          sessionId: 'foreign-session',
          deletionToken: createConversationAssistantDeletionToken({
            ...ownedSession,
            id: 'foreign-session',
          }),
        },
        instrumentedDeps
      )
    ).resolves.toEqual({ ok: true, value: { deleted: true } });
    expect(await conversationRepository.getSessionById('foreign-session')).not.toBeNull();

    await expect(
      deleteConversationAssistantSession(
        {
          userId: USER_ID,
          sessionId: ownedSession.id,
          deletionToken: createConversationAssistantDeletionToken(ownedSession),
        },
        instrumentedDeps
      )
    ).resolves.toEqual({ ok: true, value: { deleted: true } });
    expect(await conversationRepository.getSessionById(ownedSession.id)).toBeNull();
    expect(conversationRepository.getAllTurns()).toEqual([]);
    expect(
      conversationRepository.getContextMessages(ownedSession.id, 'owned-snapshot')
    ).toEqual([]);

    await expect(
      deleteConversationAssistantSession(
        {
          userId: USER_ID,
          sessionId: ownedSession.id,
          deletionToken: createConversationAssistantDeletionToken(ownedSession),
        },
        instrumentedDeps
      )
    ).resolves.toEqual({ ok: true, value: { deleted: true } });
    expect(record).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'session_cleanup',
        outcome: 'completed',
        durationMs: expect.any(Number),
      })
    );
  });

  it('records cleanup failure without replacing the repository error', async () => {
    const { deps, conversationRepository } = makeDeps();
    vi.spyOn(conversationRepository, 'deleteSession').mockRejectedValue(
      new Error('delete cascade failed')
    );
    const record = vi.fn().mockRejectedValue(new Error('metrics unavailable'));

    await expect(
      deleteConversationAssistantSession(
        {
          userId: USER_ID,
          sessionId: 'session-delete-failure',
          deletionToken: 'delete-token',
        },
        { ...deps, telemetry: { record } }
      )
    ).rejects.toThrow('delete cascade failed');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'session_cleanup',
        outcome: 'failed',
        durationMs: expect.any(Number),
      })
    );
  });

  it('derives fallback titles and assistant error turns for unavailable chat generation', async () => {
    const { deps, privateRepository, conversationRepository } = makeDeps();
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
    const unavailableChatDeps = {
      ...deps,
      llmClientFactory: {
        createLlmClientForUser: (): ReturnType<
          ConversationAssistantDeps['llmClientFactory']['createLlmClientForUser']
        > => Promise.resolve(ok(llmClientWithoutChat)),
      },
    };

    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      unavailableChatDeps
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.session.chatDisplayName).toBeUndefined();
    expect(JSON.parse(created.value.session.transcriptText) as unknown).toMatchObject({
      reference: expect.stringMatching(/^wa_msg_[a-f0-9]{64}$/),
      speakerLabel: 'Unknown',
    });
    expect(created.value.session.transcriptText).not.toContain('phone:');
    expect(created.value.session.transcriptText).not.toContain('+48');
    const firstTurn = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: longQuestion },
      unavailableChatDeps
    );
    expect(firstTurn.ok).toBe(true);
    const updatedSession = await conversationRepository.getSessionById(created.value.session.id);
    expect(updatedSession?.title).toBe('WhatsApp chat (2026-06-30 to 2026-07-01)');
    expect(firstTurn.ok ? firstTurn.value[1]?.error?.message : undefined).toBe(
      'Conversation Assistant request failed'
    );

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
    const privateMarker = 'PRIVATE_LEGACY_REJECTION_MARKER_483061bc';
    const rejectingClient: LlmGenerateClient = {
      generate: (): ReturnType<LlmGenerateClient['generate']> =>
        Promise.resolve(
          ok({
            content: 'unused',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
          } satisfies GenerateResult)
        ),
      generateChat: () => Promise.reject(new Error(privateMarker)),
    };

    const rejectingDeps = {
      ...deps,
      llmClientFactory: {
        createLlmClientForUser: (): ReturnType<
          ConversationAssistantDeps['llmClientFactory']['createLlmClientForUser']
        > => Promise.resolve(ok(rejectingClient)),
      },
    };
    const created = await createConversationAssistantSession(
      {
        userId: USER_ID,
        chatId: CHAT_ID,
        from: '2026-06-30T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      },
      rejectingDeps
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await sendConversationAssistantTurn(
      { userId: USER_ID, sessionId: created.value.session.id, question: 'Summarize.' },
      rejectingDeps
    );
    expect(result.ok).toBe(true);
    expect(conversationRepository.getAllTurns().map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(conversationRepository.getAllTurns()[1]?.error).toEqual({
      code: 'LLM_ERROR',
      message: 'Conversation Assistant request failed',
    });
    expect(JSON.stringify({ result, turns: conversationRepository.getAllTurns() })).not.toContain(
      privateMarker
    );
  });
});
