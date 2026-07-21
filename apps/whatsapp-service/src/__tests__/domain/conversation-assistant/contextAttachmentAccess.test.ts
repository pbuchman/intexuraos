import { err, ok, type Logger } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteConversationAssistantContextAttachmentDraft,
  getConversationAssistantContextAttachmentPreview,
  getConversationAssistantContextAttachmentStatus,
  listConversationAssistantContextHistory,
  resolveConversationAssistantContinuationState,
  retryConversationAssistantContextAttachmentForUser,
} from '../../../domain/conversation-assistant/contextAttachmentAccess.js';
import type {
  ConversationAssistantContextAttachment,
  ConversationAssistantSession,
} from '../../../domain/conversation-assistant/types.js';
import type {
  ConversationAssistantContextAttachmentAccessDeps,
  ConversationAssistantContextAttachmentPreparationPublisher,
  ConversationAssistantContextAttachmentPublicRetryDeps,
} from '../../../domain/conversation-assistant/contextAttachmentPorts.js';
import {
  FakeConversationAssistantContextAttachmentRepository,
  FakeEventPublisher,
  FakePrivateWhatsAppRepository,
  fakePreparedContextAttachmentSnapshot,
} from '../../fakes.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
const USER_ID = 'user-access';
const SOURCE_ACCOUNT_ID = 'source-access';
const SESSION_ID = 'session-access';
const GENERATION_ID = 'generation-access';
const CHAT_ID = `chat:${SOURCE_ACCOUNT_ID}:!access`;

async function seedSource(repository: FakePrivateWhatsAppRepository): Promise<void> {
  repository.setAccount({
    id: USER_ID,
    userId: USER_ID,
    sourceAccountId: SOURCE_ACCOUNT_ID,
    phoneNumberNormalized: '48123456789',
    displayName: 'Test Number',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
  });
  await repository.storeIncomingMessage({
    sourceAccountId: SOURCE_ACCOUNT_ID,
    userId: USER_ID,
    deliveryMode: 'live',
    receivedAt: '2026-07-01T08:00:01.000Z',
    chat: { matrixRoomId: '!access', type: 'direct', displayName: 'Test Number' },
    message: {
      matrixRoomId: '!access',
      matrixEventId: '$base',
      matrixSenderId: '@test:matrix.example',
      direction: 'incoming',
      type: 'text',
      text: 'Base message',
      eventTimestamp: '2026-07-01T08:00:00.000Z',
      rawMatrixEvent: {},
    },
  });
}

function accessDeps(
  repository: FakeConversationAssistantContextAttachmentRepository,
  privateWhatsAppRepository: FakePrivateWhatsAppRepository
): ConversationAssistantContextAttachmentAccessDeps {
  return {
    repository,
    privateWhatsAppRepository,
    clock: { now: () => '2026-07-02T12:00:00.000Z' },
  };
}

function seedAttachment(
  repository: FakeConversationAssistantContextAttachmentRepository,
  overrides: Partial<ConversationAssistantContextAttachment> = {}
): void {
  repository.setSession({
    userId: USER_ID,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    contextVersion: 0,
  });
  repository.seedAttachment(
    {
      id: 'attachment-access',
      userId: USER_ID,
      sessionId: SESSION_ID,
      sessionGenerationId: GENERATION_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      sourceAccountGeneration: SOURCE_ACCOUNT_ID,
      chatId: CHAT_ID,
      preparationRequestId: 'request-access',
      preparationRequestFingerprint: 'fingerprint-access',
      status: 'ready',
      initialContextFrom: '2026-07-01T00:00:00.000Z',
      baseContextVersion: 0,
      baseEventThrough: '2026-07-01T08:00:00.000Z',
      capturedAt: '2026-07-01T09:00:00.000Z',
      baseChangeSeq: 0,
      cutoffChangeSeq: 1,
      captureRange: {
        from: '2026-07-01T08:00:00.000Z',
        to: '2026-07-01T09:00:00.000Z',
      },
      counts: {
        included: 0,
        omitted: 0,
        newlyAvailable: 0,
        edited: 0,
        redacted: 0,
        deleted: 0,
        reactionsChanged: 0,
        lateIngested: 0,
        completedTranscriptions: 0,
      },
      omitted: {
        mediaOnly: 0,
        failedTranscriptions: 0,
        pendingTranscriptions: 0,
        nonText: 0,
        overLimit: 0,
      },
      snapshotId: 'snapshot-access',
      chunkManifest: { chunkIds: ['chunk-access'], chunkCount: 1 },
      deltaTranscriptSha256: 'b'.repeat(64),
      previousContextChainSha256: 'a'.repeat(64),
      resultingContextChainSha256: 'c'.repeat(64),
      estimatedInputTokens: 0,
      requiresConfirmation: false,
      preparationAttempt: 1,
      expiresAt: '2099-01-01T00:00:00.000Z',
      ...overrides,
    },
    fakePreparedContextAttachmentSnapshot()
  );
}

describe('Conversation Assistant context attachment access', () => {
  it('reports an uncommitted attachment as expired at the exact logical expiry boundary', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    await seedSource(source);
    const expiresAt = '2026-07-02T12:30:00.000Z';
    seedAttachment(repository, { expiresAt });
    const accountLookup = vi.spyOn(source, 'getAccountByUserId');
    const deps = {
      repository,
      privateWhatsAppRepository: source,
      clock: { now: (): string => expiresAt },
    };

    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        deps,
        logger
      )
    ).resolves.toMatchObject({
      kind: 'found',
      attachment: { status: 'expired', expiresAt },
    });
    expect(accountLookup).toHaveBeenCalledTimes(1);

    seedAttachment(repository, {
      id: 'attachment-already-expired',
      status: 'expired',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    repository.setSession({
      userId: USER_ID,
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      contextVersion: 1,
    });
    await expect(
      getConversationAssistantContextAttachmentStatus(
        {
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: 'attachment-already-expired',
        },
        deps,
        logger
      )
    ).resolves.toMatchObject({
      kind: 'found',
      attachment: { status: 'expired', compatibility: 'stale' },
    });
    expect(accountLookup).toHaveBeenCalledTimes(2);
  });

  it('checks the source erasure fence before exposing expired attachment metadata', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    seedAttachment(repository, {
      status: 'expired',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
    source.setAccount({
      id: USER_ID,
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      phoneNumberNormalized: '48123456789',
      displayName: 'Erasing',
      status: 'disabled',
      erasureStatus: 'erasing',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-21T10:00:00.000Z',
      schemaVersion: 1,
    });

    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toEqual({ kind: 'source_unavailable' });
  });

  it('returns a public status with exact post-cutoff message availability', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    await seedSource(source);
    seedAttachment(repository);
    await source.storeIncomingMessage({
      sourceAccountId: SOURCE_ACCOUNT_ID,
      userId: USER_ID,
      deliveryMode: 'live',
      receivedAt: '2026-07-02T08:00:01.000Z',
      chat: { matrixRoomId: '!access', type: 'direct', displayName: 'Test Number' },
      message: {
        matrixRoomId: '!access',
        matrixEventId: '$new',
        matrixSenderId: '@test:matrix.example',
        direction: 'incoming',
        type: 'text',
        text: 'New message',
        eventTimestamp: '2026-07-02T08:00:00.000Z',
        rawMatrixEvent: {},
      },
    });

    const result = await getConversationAssistantContextAttachmentStatus(
      { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
      accessDeps(repository, source),
      logger
    );

    expect(result).toMatchObject({
      kind: 'found',
      attachment: {
        status: 'ready',
        compatibility: 'current',
        newerAvailableCount: 1,
        newerAvailableCorrectionCount: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain(SOURCE_ACCOUNT_ID);
    expect(JSON.stringify(result)).not.toContain('fingerprint-access');
  });

  it('restores a frozen draft for a disabled same-generation account and fails ownership closed', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    await seedSource(source);
    seedAttachment(repository);
    await source.disableAccount({ userId: USER_ID, now: '2026-07-03T00:00:00.000Z' });

    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toMatchObject({
      kind: 'found',
      attachment: {
        status: 'ready',
        newerAvailableCount: 0,
        newerAvailableCorrectionCount: 0,
      },
    });
    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: 'foreign', sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toEqual({ kind: 'not_found' });

    const active = new FakePrivateWhatsAppRepository();
    await seedSource(active);
    active.failNext({ code: 'INTERNAL_ERROR', message: 'journal unavailable' });
    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, active),
        logger
      )
    ).resolves.toEqual({ kind: 'source_unavailable' });
  });

  it('loads only an immutable prepared snapshot and validates its opaque cursor', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    seedAttachment(repository);
    const snapshot = fakePreparedContextAttachmentSnapshot();
    snapshot.messages = [
      {
        id: 'preview-message',
        eventTimestamp: '2026-07-02T08:00:00.000Z',
        importedAt: '2026-07-02T08:00:01.000Z',
        direction: 'incoming',
        speakerLabel: 'Alice',
        messageType: 'text',
        contentKind: 'text',
        content: 'Preview',
      },
    ];
    const storedAttachment = repository.getAttachment('attachment-access');
    if (storedAttachment === undefined) throw new Error('Missing attachment fixture');
    repository.seedAttachment(storedAttachment, snapshot);

    const found = await getConversationAssistantContextAttachmentPreview(
      {
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-access',
        limit: 1,
      },
      { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
      logger
    );
    const invalid = await getConversationAssistantContextAttachmentPreview(
      {
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-access',
        cursor: 'bad+cursor',
        limit: 1,
      },
      { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
      logger
    );

    expect(found).toMatchObject({ kind: 'found', page: { items: [{ kind: 'included' }] } });
    expect(invalid).toEqual({ kind: 'invalid', code: 'INVALID_CURSOR' });
  });

  it('returns no preview body when logical expiry wins the race with native TTL sweep', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    seedAttachment(repository, { expiresAt: '2026-07-02T11:59:59.000Z' });
    const storedAttachment = repository.getAttachment('attachment-access');
    if (storedAttachment === undefined) throw new Error('Missing attachment fixture');
    const snapshot = fakePreparedContextAttachmentSnapshot();
    snapshot.transcriptText = 'private expired preview body';
    repository.seedAttachment(storedAttachment, snapshot);

    const result = await getConversationAssistantContextAttachmentPreview(
      {
        userId: USER_ID,
        sessionId: SESSION_ID,
        attachmentId: 'attachment-access',
        limit: 50,
      },
      { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
      logger
    );

    expect(result).toEqual({ kind: 'not_found' });
    expect(JSON.stringify(result)).not.toContain('private expired preview body');
  });

  it('deletes drafts idempotently, rejects committed deletion, and lists history without source access', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    seedAttachment(repository);

    await expect(
      deleteConversationAssistantContextAttachmentDraft(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'deleted' });
    await expect(
      deleteConversationAssistantContextAttachmentDraft(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'deleted' });

    seedAttachment(repository, {
      id: 'attachment-committed',
      status: 'committed',
      committedTurnId: 'turn-2',
      committedAt: '2026-07-02T13:00:00.000Z',
    });
    await expect(
      deleteConversationAssistantContextAttachmentDraft(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-committed' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'committed' });
    await expect(
      listConversationAssistantContextHistory(
        { userId: USER_ID, sessionId: SESSION_ID },
        { repository },
        logger
      )
    ).resolves.toMatchObject({
      kind: 'found',
      snapshots: [
        { kind: 'initial', contextVersion: 0 },
        { kind: 'update', attachmentId: 'attachment-committed', linkedTurnId: 'turn-2' },
      ],
    });
  });

  it('requeues and publishes with server-owned generation, failing definite publication safely', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    seedAttachment(repository, {
      status: 'failed',
      preparationError: { code: 'ATTACHMENT_PREPARATION_FAILED', message: 'safe' },
    });
    const publisher = new FakeEventPublisher();

    const queued = await retryConversationAssistantContextAttachmentForUser(
      { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
      {
        repository,
        preparationPublisher: {
          publish: (event) => publisher.publishConversationAssistantContextAttachmentPreparation(event),
        },
        clock: { now: () => '2026-07-02T12:10:00.000Z' },
      },
      logger
    );

    expect(queued).toMatchObject({ kind: 'queued', attachment: { status: 'preparing' } });
    expect(publisher.getConversationAssistantContextAttachmentPreparationEvents()).toEqual([
      expect.objectContaining({ attempt: 2, sessionGenerationId: GENERATION_ID }),
    ]);

    seedAttachment(repository, {
      id: 'attachment-publish-failed',
      status: 'failed',
      preparationError: { code: 'ATTACHMENT_PREPARATION_FAILED', message: 'safe' },
    });
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        {
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: 'attachment-publish-failed',
        },
        {
          repository,
          preparationPublisher: {
            publish: () => Promise.resolve(err({ code: 'PUBLISH_FAILED', message: 'safe' })),
          },
          clock: { now: () => '2026-07-02T12:10:00.000Z' },
        },
        logger
      )
    ).resolves.toMatchObject({ kind: 'failed', attachment: { status: 'failed' } });
  });

  it('resolves authoritative continuation availability from active account and owned chat', async () => {
    const source = new FakePrivateWhatsAppRepository();
    await seedSource(source);
    const session = {
      id: SESSION_ID,
      userId: USER_ID,
      chatId: CHAT_ID,
      continuation: { sourceAccountId: SOURCE_ACCOUNT_ID },
    } as ConversationAssistantSession;

    await expect(
      resolveConversationAssistantContinuationState(session, source, logger)
    ).resolves.toBe('available');
    await source.disableAccount({ userId: USER_ID, now: '2026-07-03T00:00:00.000Z' });
    await expect(
      resolveConversationAssistantContinuationState(session, source, logger)
    ).resolves.toBe('source_unavailable');
    const legacySession = { ...session };
    delete legacySession.continuation;
    await expect(
      resolveConversationAssistantContinuationState(
        legacySession as ConversationAssistantSession,
        source,
        logger
      )
    ).resolves.toBe('legacy_session');
  });

  it('validates public inputs and maps unavailable repository states', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    const retryDeps: ConversationAssistantContextAttachmentPublicRetryDeps = {
      repository,
      preparationPublisher: { publish: () => Promise.resolve(ok(undefined)) },
      clock: { now: () => '2026-07-02T12:10:00.000Z' },
    };

    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: ' ', sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });
    await expect(
      getConversationAssistantContextAttachmentPreview(
        { userId: USER_ID, sessionId: ' ', attachmentId: 'attachment-access', limit: 1 },
        { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });
    await expect(
      deleteConversationAssistantContextAttachmentDraft(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: ' ' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });
    await expect(
      listConversationAssistantContextHistory(
        { userId: ' ', sessionId: SESSION_ID },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });
    await expect(
      listConversationAssistantContextHistory(
        { userId: USER_ID, sessionId: ' ' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        { userId: ' ', sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        retryDeps,
        logger
      )
    ).resolves.toEqual({ kind: 'invalid', code: 'INVALID_REQUEST' });

    await expect(
      getConversationAssistantContextAttachmentPreview(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'missing', limit: 1 },
        { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
        logger
      )
    ).resolves.toEqual({ kind: 'not_found' });
    await expect(
      deleteConversationAssistantContextAttachmentDraft(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'missing' },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'not_found' });
    await expect(
      listConversationAssistantContextHistory(
        { userId: USER_ID, sessionId: SESSION_ID },
        { repository },
        logger
      )
    ).resolves.toEqual({ kind: 'not_found' });
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'missing' },
        retryDeps,
        logger
      )
    ).resolves.toEqual({ kind: 'not_found' });

    seedAttachment(repository);
    await repository.deleteContextAttachmentPreparedSnapshot({
      attachmentId: 'attachment-access',
    });
    await expect(
      getConversationAssistantContextAttachmentPreview(
        {
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: 'attachment-access',
          limit: 1,
        },
        { repository, clock: { now: () => '2026-07-02T12:00:00.000Z' } },
        logger
      )
    ).resolves.toEqual({ kind: 'not_ready' });
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        retryDeps,
        logger
      )
    ).resolves.toEqual({ kind: 'invalid_state' });
  });

  it('restores frozen status when chat availability is unreadable but fences unsafe accounts', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    seedAttachment(repository);
    const inspect = async (source: FakePrivateWhatsAppRepository): Promise<unknown> =>
      await getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      );
    const unavailable = { kind: 'source_unavailable' };
    const expectFrozen = async (source: FakePrivateWhatsAppRepository): Promise<void> => {
      await expect(inspect(source)).resolves.toMatchObject({
        kind: 'found',
        attachment: {
          status: 'ready',
          newerAvailableCount: 0,
          newerAvailableCorrectionCount: 0,
        },
      });
    };

    const accountFailure = new FakePrivateWhatsAppRepository();
    accountFailure.failNext({ code: 'PERSISTENCE_ERROR', message: 'private account error' });
    await expect(inspect(accountFailure)).resolves.toEqual(unavailable);

    const missingChat = new FakePrivateWhatsAppRepository();
    missingChat.setAccount({
      id: USER_ID,
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      phoneNumberNormalized: '48123456789',
      displayName: 'Test Number',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: 1,
    });
    await expectFrozen(missingChat);

    const chatFailure = new FakePrivateWhatsAppRepository();
    await seedSource(chatFailure);
    vi.spyOn(chatFailure, 'getChatById').mockResolvedValue(
      err({ code: 'PERSISTENCE_ERROR', message: 'private chat error' })
    );
    await expectFrozen(chatFailure);

    const headFailure = new FakePrivateWhatsAppRepository();
    await seedSource(headFailure);
    vi.spyOn(headFailure, 'getConversationContextJournalHead').mockResolvedValue(
      err({ code: 'PERSISTENCE_ERROR', message: 'private head error' })
    );
    await expectFrozen(headFailure);

    const oldHead = new FakePrivateWhatsAppRepository();
    await seedSource(oldHead);
    vi.spyOn(oldHead, 'getConversationContextJournalHead').mockResolvedValue(ok(0));
    await expectFrozen(oldHead);

    const pageFailure = new FakePrivateWhatsAppRepository();
    await seedSource(pageFailure);
    vi.spyOn(pageFailure, 'getConversationContextJournalHead').mockResolvedValue(ok(2));
    vi.spyOn(pageFailure, 'findConversationContextJournalEntries').mockResolvedValue(
      err({ code: 'PERSISTENCE_ERROR', message: 'private journal error' })
    );
    await expectFrozen(pageFailure);

    const loopingPage = new FakePrivateWhatsAppRepository();
    await seedSource(loopingPage);
    vi.spyOn(loopingPage, 'getConversationContextJournalHead').mockResolvedValue(ok(2));
    vi.spyOn(loopingPage, 'findConversationContextJournalEntries').mockResolvedValue(
      ok({ entries: [], nextAfterSequence: 1 })
    );
    await expectFrozen(loopingPage);

    const advancingPage = new FakePrivateWhatsAppRepository();
    await seedSource(advancingPage);
    vi.spyOn(advancingPage, 'getConversationContextJournalHead').mockResolvedValue(ok(3));
    vi.spyOn(advancingPage, 'findConversationContextJournalEntries')
      .mockResolvedValueOnce(ok({ entries: [], nextAfterSequence: 2 }))
      .mockResolvedValueOnce(
        err({ code: 'PERSISTENCE_ERROR', message: 'private second page error' })
      );
    await expectFrozen(advancingPage);

    const incompleteJournal = new FakePrivateWhatsAppRepository();
    await seedSource(incompleteJournal);
    vi.spyOn(incompleteJournal, 'getConversationContextJournalHead').mockResolvedValue(ok(2));
    vi.spyOn(incompleteJournal, 'findConversationContextJournalEntries').mockResolvedValue(
      ok({ entries: [] })
    );
    await expectFrozen(incompleteJournal);

    for (const unsafeAccount of [
      {
        id: USER_ID,
        userId: USER_ID,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        generationId: 'replacement-generation',
        phoneNumberNormalized: '48123456789',
        displayName: 'Replacement',
        status: 'active' as const,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        schemaVersion: 1 as const,
      },
      {
        id: USER_ID,
        userId: USER_ID,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        phoneNumberNormalized: '48123456789',
        displayName: 'Erasing',
        status: 'disabled' as const,
        erasureStatus: 'erasing' as const,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        schemaVersion: 1 as const,
      },
    ]) {
      const unsafe = new FakePrivateWhatsAppRepository();
      unsafe.setAccount(unsafeAccount);
      await expect(inspect(unsafe)).resolves.toEqual(unavailable);
    }
  });

  it('maps stale compatibility and retry publication races without changing the cutoff', async () => {
    const repository = new FakeConversationAssistantContextAttachmentRepository();
    const source = new FakePrivateWhatsAppRepository();
    await seedSource(source);
    seedAttachment(repository, { baseContextVersion: 0 });
    repository.setSession({
      userId: USER_ID,
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      contextVersion: 1,
    });
    await expect(
      getConversationAssistantContextAttachmentStatus(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-access' },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toMatchObject({ kind: 'found', attachment: { compatibility: 'stale' } });

    seedAttachment(repository, {
      id: 'attachment-committed-current',
      status: 'committed',
      baseContextVersion: 0,
    });
    await expect(
      getConversationAssistantContextAttachmentStatus(
        {
          userId: USER_ID,
          sessionId: SESSION_ID,
          attachmentId: 'attachment-committed-current',
        },
        accessDeps(repository, source),
        logger
      )
    ).resolves.toMatchObject({ kind: 'found', attachment: { compatibility: 'current' } });

    seedAttachment(repository, {
      id: 'attachment-stale-retry',
      status: 'failed',
      baseContextVersion: 0,
    });
    repository.setSession({
      userId: USER_ID,
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      contextVersion: 1,
    });
    const publishSuccess: ConversationAssistantContextAttachmentPreparationPublisher = {
      publish: () => Promise.resolve(ok(undefined)),
    };
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-stale-retry' },
        {
          repository,
          preparationPublisher: publishSuccess,
          clock: { now: () => '2026-07-02T12:10:00.000Z' },
        },
        logger
      )
    ).resolves.toMatchObject({ kind: 'queued', attachment: { compatibility: 'stale' } });

    for (const failedStatus of ['not_found', 'stale'] as const) {
      seedAttachment(repository, {
        id: `attachment-${failedStatus}`,
        status: 'failed',
      });
      const attachment = repository.getAttachment(`attachment-${failedStatus}`);
      if (attachment === undefined) throw new Error('Missing retry fixture');
      vi.spyOn(repository, 'failQueuedContextAttachmentPreparation').mockResolvedValueOnce(
        failedStatus === 'not_found'
          ? { status: 'not_found' }
          : { status: 'stale', attachment }
      );
      await expect(
        retryConversationAssistantContextAttachmentForUser(
          {
            userId: USER_ID,
            sessionId: SESSION_ID,
            attachmentId: `attachment-${failedStatus}`,
          },
          {
            repository,
            preparationPublisher: {
              publish: () => Promise.resolve(err({ code: 'PUBLISH_FAILED', message: 'safe' })),
            },
            clock: { now: () => '2026-07-02T12:10:00.000Z' },
          },
          logger
        )
      ).resolves.toEqual({ kind: failedStatus });
    }

    seedAttachment(repository, { id: 'attachment-ambiguous', status: 'failed' });
    await expect(
      retryConversationAssistantContextAttachmentForUser(
        { userId: USER_ID, sessionId: SESSION_ID, attachmentId: 'attachment-ambiguous' },
        {
          repository,
          preparationPublisher: {
            publish: () => Promise.reject(new Error('ambiguous publisher timeout')),
          },
          clock: { now: () => '2026-07-02T12:10:00.000Z' },
        },
        logger
      )
    ).rejects.toThrow('ambiguous publisher timeout');
    expect(repository.getAttachment('attachment-ambiguous')).toMatchObject({
      status: 'queued',
      cutoffChangeSeq: 1,
    });
  });

  it('fails continuation resolution closed for account and chat ownership failures', async () => {
    const session = {
      id: SESSION_ID,
      userId: USER_ID,
      chatId: CHAT_ID,
      continuation: { sourceAccountId: SOURCE_ACCOUNT_ID },
    } as ConversationAssistantSession;

    const accountFailure = new FakePrivateWhatsAppRepository();
    accountFailure.failNext({ code: 'PERSISTENCE_ERROR', message: 'private account error' });
    await expect(
      resolveConversationAssistantContinuationState(session, accountFailure, logger)
    ).resolves.toBe('source_unavailable');

    const missingChat = new FakePrivateWhatsAppRepository();
    missingChat.setAccount({
      id: USER_ID,
      userId: USER_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      phoneNumberNormalized: '48123456789',
      displayName: 'Test Number',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      schemaVersion: 1,
    });
    await expect(
      resolveConversationAssistantContinuationState(session, missingChat, logger)
    ).resolves.toBe('source_unavailable');

    const foreignChat = new FakePrivateWhatsAppRepository();
    await seedSource(foreignChat);
    vi.spyOn(foreignChat, 'getChatById').mockResolvedValue(
      ok({
        id: CHAT_ID,
        userId: USER_ID,
        sourceAccountId: 'foreign-source',
        matrixRoomId: '!access',
        chatType: 'direct',
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastEventAt: '2026-07-01T08:00:00.000Z',
        updatedAt: '2026-07-01T08:00:00.000Z',
      })
    );
    await expect(
      resolveConversationAssistantContinuationState(session, foreignChat, logger)
    ).resolves.toBe('source_unavailable');
  });
});
