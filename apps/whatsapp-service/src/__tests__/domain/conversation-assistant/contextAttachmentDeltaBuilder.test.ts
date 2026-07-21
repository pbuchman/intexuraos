import { err, ok } from '@intexuraos/common-core';
import { describe, expect, it, vi } from 'vitest';
import type {
  PrivateWhatsAppAccount,
  PrivateWhatsAppRepository,
} from '../../../domain/whatsapp/index.js';
import type { ConversationAssistantContextAttachment } from '../../../domain/conversation-assistant/types.js';
import { createConversationAssistantContextAttachmentDeltaBuilder } from '../../../domain/conversation-assistant/contextAttachmentDeltaBuilder.js';

function attachment(
  overrides: Partial<ConversationAssistantContextAttachment> = {}
): ConversationAssistantContextAttachment {
  return {
    id: 'attachment-1',
    sessionId: 'session-1',
    userId: 'user-1',
    sessionGenerationId: 'generation-1',
    sourceAccountId: 'source-1',
    sourceAccountGeneration: 'source-generation-1',
    chatId: 'chat-1',
    preparationRequestId: 'prepare-1',
    preparationRequestFingerprint: 'fingerprint-1',
    status: 'preparing',
    initialContextFrom: '2026-07-14T00:00:00.000Z',
    baseContextVersion: 0,
    baseEventThrough: '2026-07-17T00:00:00.000Z',
    capturedAt: '2026-07-21T00:00:00.000Z',
    baseChangeSeq: 0,
    cutoffChangeSeq: 0,
    captureRange: {
      from: '2026-07-17T00:00:00.000Z',
      to: '2026-07-21T00:00:00.000Z',
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
    previousContextChainSha256: 'a'.repeat(64),
    requiresConfirmation: false,
    preparationAttempt: 1,
    ...overrides,
  };
}

function repository(
  overrides: Partial<PrivateWhatsAppRepository> = {}
): PrivateWhatsAppRepository {
  return {
    getActiveAccountBySourceAccountId: vi.fn(async () =>
      ok({
        id: 'user-1',
        userId: 'user-1',
        sourceAccountId: 'source-1',
        generationId: 'source-generation-1',
        phoneNumberNormalized: '48111111111',
        displayName: '+48111111111',
        status: 'active' as const,
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
        schemaVersion: 1 as const,
      })
    ),
    getChatById: vi.fn(async () =>
      ok({
        id: 'chat-1',
        userId: 'user-1',
        sourceAccountId: 'source-1',
        matrixRoomId: '!room:example',
        chatType: 'direct' as const,
        firstSeenAt: '2026-07-14T00:00:00.000Z',
        lastEventAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      })
    ),
    findConversationContextMessages: vi.fn(async () =>
      ok({ messages: [], totalCount: 0 })
    ),
    getConversationContextJournalHead: vi.fn(async () => ok(0)),
    findConversationContextJournalEntries: vi.fn(async () => ok({ entries: [] })),
    ...overrides,
  } as unknown as PrivateWhatsAppRepository;
}

describe('createConversationAssistantContextAttachmentDeltaBuilder', () => {
  it('loads the frozen source range and returns a zero immutable delta', async () => {
    const source = repository();
    const builder = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: source,
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });

    const result = await builder.buildExactCutoffDelta({ attachment: attachment() });

    expect(result).toMatchObject({
      ok: true,
      value: { transcriptText: '', counts: { included: 0, omitted: 0 } },
    });
    expect(source.findConversationContextMessages).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      from: '2026-07-17T00:00:00.000Z',
      to: '2026-07-21T00:00:00.000Z',
      limit: 5_000,
    });
    expect(source.getConversationContextJournalHead).toHaveBeenCalledAfter(
      source.findConversationContextMessages as ReturnType<typeof vi.fn>
    );
  });

  it('paginates source messages and the entire observed journal range', async () => {
    const findMessages = vi
      .fn()
      .mockResolvedValueOnce(ok({ messages: [], totalCount: 0, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(ok({ messages: [], totalCount: 0 }));
    const findJournal = vi
      .fn()
      .mockResolvedValueOnce(ok({ entries: [], nextAfterSequence: 1 }))
      .mockResolvedValueOnce(ok({ entries: [], nextAfterSequence: 2 }))
      .mockResolvedValueOnce(ok({ entries: [] }));
    const source = repository({
      findConversationContextMessages: findMessages,
      getConversationContextJournalHead: vi.fn(async () => ok(3)),
      findConversationContextJournalEntries: findJournal,
    });
    const builder = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: source,
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });

    const result = await builder.buildExactCutoffDelta({
      attachment: attachment({
        baseChangeSeq: 0,
        cutoffChangeSeq: 0,
      }),
    });

    expect(findMessages).toHaveBeenCalledTimes(2);
    expect(findMessages).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' }));
    expect(findJournal).toHaveBeenCalledTimes(3);
    expect(findJournal.mock.calls.map((call) => call[0].afterSequence)).toEqual([0, 1, 2]);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONTEXT_JOURNAL_GAP' },
    });
  });

  it('fails safely for a missing or foreign source chat', async () => {
    const missing = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({ getChatById: vi.fn(async () => ok(null)) }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });
    const foreign = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        getChatById: vi.fn(async () =>
          ok({
            id: 'chat-1',
            userId: 'other-user',
            sourceAccountId: 'source-1',
            matrixRoomId: '!room:example',
            chatType: 'direct' as const,
            firstSeenAt: '',
            lastEventAt: '',
            updatedAt: '',
          })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });

    await expect(missing.buildExactCutoffDelta({ attachment: attachment() })).resolves.toEqual(
      err({ code: 'SOURCE_UNAVAILABLE', message: 'The source conversation is unavailable' })
    );
    await expect(foreign.buildExactCutoffDelta({ attachment: attachment() })).resolves.toEqual(
      err({ code: 'SOURCE_UNAVAILABLE', message: 'The source conversation is unavailable' })
    );
  });

  it('fails closed when the source account is disconnected, foreign, or unreadable', async () => {
    const disconnected = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        getActiveAccountBySourceAccountId: vi.fn(async () => ok(null)),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });
    const foreign = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        getActiveAccountBySourceAccountId: vi.fn(async () =>
          ok({
            id: 'other-user',
            userId: 'other-user',
            sourceAccountId: 'source-1',
            phoneNumberNormalized: '48222222222',
            displayName: '+48222222222',
            status: 'active' as const,
            createdAt: '2026-07-14T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
            schemaVersion: 1 as const,
          })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });
    const unreadable = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        getActiveAccountBySourceAccountId: vi.fn(async () =>
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'private account read detail' })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });

    await expect(disconnected.buildExactCutoffDelta({ attachment: attachment() })).resolves.toEqual(
      err({ code: 'SOURCE_UNAVAILABLE', message: 'The source conversation is unavailable' })
    );
    await expect(foreign.buildExactCutoffDelta({ attachment: attachment() })).resolves.toEqual(
      err({ code: 'SOURCE_UNAVAILABLE', message: 'The source conversation is unavailable' })
    );
    const unreadableResult = await unreadable.buildExactCutoffDelta({ attachment: attachment() });
    expect(unreadableResult).toEqual(
      err({
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      })
    );
    expect(JSON.stringify(unreadableResult)).not.toContain('private account read detail');
  });

  it('rejects an erasing account and a same-source replacement generation before reading messages', async () => {
    const messageScan = vi.fn(async () => ok({ messages: [], totalCount: 0 }));
    const buildWithAccount = (
      account: PrivateWhatsAppAccount
    ): ReturnType<typeof createConversationAssistantContextAttachmentDeltaBuilder> =>
      createConversationAssistantContextAttachmentDeltaBuilder({
        privateWhatsAppRepository: repository({
          getActiveAccountBySourceAccountId: vi.fn(async () => ok(account)),
          findConversationContextMessages: messageScan,
        }),
        confirmationSecret: 'secret',
        warningMessageThreshold: 5_000,
        warningTokenThreshold: 50_000,
      });
    const baseAccount = {
      id: 'user-1',
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'source-generation-1',
      phoneNumberNormalized: '48111111111',
      displayName: '+48111111111',
      status: 'active' as const,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      schemaVersion: 1 as const,
    };
    const expected = err({
      code: 'SOURCE_UNAVAILABLE',
      message: 'The source conversation is unavailable',
    });

    await expect(
      buildWithAccount({ ...baseAccount, erasureStatus: 'erasing' }).buildExactCutoffDelta({
        attachment: attachment(),
      })
    ).resolves.toEqual(expected);
    await expect(
      buildWithAccount({
        ...baseAccount,
        generationId: 'source-generation-2',
      }).buildExactCutoffDelta({ attachment: attachment() })
    ).resolves.toEqual(expected);
    expect(messageScan).not.toHaveBeenCalled();
  });

  it('maps source failures without leaking repository details and rejects non-advancing cursors', async () => {
    const chatFailure = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        getChatById: vi.fn(async () =>
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'private chat read detail' })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });
    const failed = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        findConversationContextMessages: vi.fn(async () =>
          err({ code: 'PERSISTENCE_ERROR' as const, message: 'private firestore detail' })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });
    const looping = createConversationAssistantContextAttachmentDeltaBuilder({
      privateWhatsAppRepository: repository({
        findConversationContextMessages: vi.fn(async () =>
          ok({ messages: [], totalCount: 0, nextCursor: 'same' })
        ),
      }),
      confirmationSecret: 'secret',
      warningMessageThreshold: 5_000,
      warningTokenThreshold: 50_000,
    });

    const chatFailureResult = await chatFailure.buildExactCutoffDelta({ attachment: attachment() });
    const failedResult = await failed.buildExactCutoffDelta({ attachment: attachment() });
    const loopResult = await looping.buildExactCutoffDelta({ attachment: attachment() });

    expect(chatFailureResult).toEqual(
      err({
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      })
    );
    expect(JSON.stringify(chatFailureResult)).not.toContain('private chat read detail');
    expect(failedResult).toEqual(
      err({
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      })
    );
    expect(JSON.stringify(failedResult)).not.toContain('private firestore detail');
    expect(loopResult).toEqual(
      err({
        code: 'ATTACHMENT_PREPARATION_FAILED',
        message: 'The context attachment could not be prepared',
      })
    );
  });

  it('fails safely for journal-head, journal-page, and non-advancing journal errors', async () => {
    const build = (source: PrivateWhatsAppRepository): Promise<unknown> =>
      createConversationAssistantContextAttachmentDeltaBuilder({
        privateWhatsAppRepository: source,
        confirmationSecret: 'secret',
        warningMessageThreshold: 5_000,
        warningTokenThreshold: 50_000,
      }).buildExactCutoffDelta({ attachment: attachment() });
    const expected = err({
      code: 'ATTACHMENT_PREPARATION_FAILED',
      message: 'The context attachment could not be prepared',
    });

    await expect(
      build(
        repository({
          getConversationContextJournalHead: vi.fn(async () =>
            err({ code: 'PERSISTENCE_ERROR' as const, message: 'private head detail' })
          ),
        })
      )
    ).resolves.toEqual(expected);
    await expect(
      build(
        repository({
          getConversationContextJournalHead: vi.fn(async () => ok(1)),
          findConversationContextJournalEntries: vi.fn(async () =>
            err({ code: 'PERSISTENCE_ERROR' as const, message: 'private page detail' })
          ),
        })
      )
    ).resolves.toEqual(expected);
    await expect(
      build(
        repository({
          getConversationContextJournalHead: vi.fn(async () => ok(2)),
          findConversationContextJournalEntries: vi.fn(async () =>
            ok({ entries: [], nextAfterSequence: 0 })
          ),
        })
      )
    ).resolves.toEqual(expected);
  });
});
