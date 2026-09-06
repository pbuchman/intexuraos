import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type {
  PrivateWhatsAppAccount,
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
} from '../../../domain/whatsapp/models/PrivateWhatsApp.js';
import {
  projectPrivateDigestMessages,
  resolvePrivateDigestMigrationBinding,
  validatePrivateDigestSource,
  type PrivateWhatsAppDigestMigrationBindingDeps,
  type PrivateWhatsAppDigestSourceDeps,
} from '../../../domain/whatsapp/usecases/privateWhatsAppDigestSource.js';
import { readPrivateWhatsAppDigestSource } from '../../../domain/whatsapp/usecases/readPrivateWhatsAppDigestSource.js';

const account: PrivateWhatsAppAccount = {
  id: 'account-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  generationId: 'generation-1',
  phoneNumberNormalized: '+48000000000',
  displayName: 'Primary account',
  status: 'active',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-27T08:00:00.000Z',
  schemaVersion: 1,
};

const groupChat: PrivateWhatsAppChat = {
  id: 'chat-1',
  userId: 'user-1',
  sourceAccountId: 'source-1',
  matrixRoomId: '!private-room:example.invalid',
  chatType: 'group',
  displayName: '  Weekend\n  fishing   group  ',
  messageCount: 42,
  participantCount: 8,
  contextChangeSequence: 17,
  firstSeenAt: '2026-07-01T09:00:00.000Z',
  lastEventAt: '2026-07-27T07:59:00.000Z',
  updatedAt: '2026-07-27T08:00:00.000Z',
};

function sourceDeps(
  overrides: {
    account?: PrivateWhatsAppAccount | null;
    chat?: PrivateWhatsAppChat | null;
  } = {}
): PrivateWhatsAppDigestSourceDeps {
  return {
    repository: {
      getAccountByUserId: vi.fn().mockResolvedValue(ok(overrides.account ?? account)),
      getChatById: vi.fn().mockResolvedValue(ok(overrides.chat ?? groupChat)),
      getConversationContextJournalHead: vi.fn().mockResolvedValue(ok(17)),
    },
    issueSourceRevision: vi.fn().mockReturnValue(ok('opaque-source-revision')),
  };
}

type MessageOverrides = Omit<Partial<PrivateWhatsAppMessage>, 'text'> & {
  text?: string | undefined;
};

function message(overrides: MessageOverrides = {}): PrivateWhatsAppMessage {
  const { text, ...rest } = overrides;
  const value: PrivateWhatsAppMessage = {
    id: 'message-1',
    chatId: 'chat-1',
    userId: 'user-1',
    sourceAccountId: 'source-1',
    matrixRoomId: '!private-room:example.invalid',
    matrixEventId: '$private-event',
    matrixSenderId: '@private-sender:example.invalid',
    senderDisplayName: '  Alice\n Example  ',
    senderPhoneNumber: '+48111111111',
    senderPhoneNumberNormalized: '+48111111111',
    senderKey: 'sender-private-key',
    direction: 'incoming',
    messageType: 'text',
    text: '  Current visible text  ',
    eventTimestamp: '2026-07-27T07:00:00.000Z',
    receivedAt: '2026-07-27T07:00:01.000Z',
    ingestedAt: '2026-07-27T07:00:02.000Z',
    deliveryMode: 'live',
    contextRevision: 1,
    contextState: 'visible',
    rawMatrixEvent: {
      sender: '@private-sender:example.invalid',
      secretMarker: 'raw-private-payload',
    },
    ...rest,
  };
  if (!Object.hasOwn(overrides, 'text')) return value;
  if (text === undefined) {
    delete value.text;
  } else {
    value.text = text;
  }
  return value;
}

function withoutParticipantCount(chat: PrivateWhatsAppChat): PrivateWhatsAppChat {
  const copy = { ...chat };
  delete copy.participantCount;
  return copy;
}

function withoutDisplayName(chat: PrivateWhatsAppChat): PrivateWhatsAppChat {
  const copy = { ...chat };
  delete copy.displayName;
  return copy;
}

function withoutGenerationId(value: PrivateWhatsAppAccount): PrivateWhatsAppAccount {
  const copy = { ...value };
  delete copy.generationId;
  return copy;
}

function withoutGenerationFence(value: PrivateWhatsAppAccount): PrivateWhatsAppAccount {
  const copy: Partial<PrivateWhatsAppAccount> = { ...value };
  delete copy.generationId;
  delete copy.sourceAccountId;
  return copy as PrivateWhatsAppAccount;
}

describe('private WhatsApp digest source', () => {
  it('resolves one exact NFKC/trim group across bounded owner pages', async () => {
    const findChats = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          chats: [{ ...groupChat, id: 'lookalike', displayName: 'Fishing group VIP' }],
          nextCursor: 'next-page',
        })
      )
      .mockResolvedValueOnce(
        ok({ chats: [{ ...groupChat, displayName: '  Weekend fishing gro\u0075p  ' }] })
      );
    const deps: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats,
      },
    };

    const result = await resolvePrivateDigestMigrationBinding(
      { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
      deps
    );

    expect(result).toEqual(
      ok({
        sourceAccountId: 'source-1',
        generationId: 'generation-1',
        chatId: 'chat-1',
        displayName: 'Weekend fishing group',
      })
    );
    expect(findChats).toHaveBeenNthCalledWith(1, { sourceAccountId: 'source-1', limit: 100 });
    expect(findChats).toHaveBeenNthCalledWith(2, {
      sourceAccountId: 'source-1',
      limit: 100,
      cursor: 'next-page',
    });
  });

  it('resolves one unique group across case, accent, and separator drift', async () => {
    const deps: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn().mockResolvedValue(
          ok({
            chats: [
              { ...groupChat, id: 'lookalike', displayName: 'Weekend fishing group VIP' },
              { ...groupChat, displayName: 'WEEKEND FÍSHING-GROUP!' },
            ],
          })
        ),
      },
    };

    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        deps
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        chatId: 'chat-1',
        displayName: 'WEEKEND FÍSHING-GROUP!',
      },
    });
  });

  it('uses the source account as the immutable generation fence for legacy accounts', async () => {
    const findChats = vi.fn().mockResolvedValue(
      ok({
        chats: [{ ...groupChat, displayName: 'Weekend fishing group' }],
      })
    );
    const migrationDeps: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(withoutGenerationId(account))),
        findChats,
      },
    };

    const migration = await resolvePrivateDigestMigrationBinding(
      { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
      migrationDeps
    );
    expect(migration).toEqual(
      ok({
        sourceAccountId: 'source-1',
        generationId: 'source-1',
        chatId: 'chat-1',
        displayName: 'Weekend fishing group',
      })
    );
    expect(findChats).toHaveBeenCalledWith({ sourceAccountId: 'source-1', limit: 100 });

    const validationDeps = sourceDeps({
      account: withoutGenerationId(account),
    });
    const validation = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1', expectedGenerationId: 'source-1' },
      validationDeps
    );
    expect(validation).toMatchObject({
      ok: true,
      value: {
        sourceAccountId: 'source-1',
        generationId: 'source-1',
      },
    });
    expect(validationDeps.issueSourceRevision).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: 'source-1' })
    );
  });

  it('fails closed when an account has no immutable generation fence', async () => {
    const findChats = vi.fn();
    const deps: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(withoutGenerationFence(account))),
        findChats,
      },
    };

    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        deps
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(findChats).not.toHaveBeenCalled();
  });

  it('fails closed for a non-unique exact migration group', async () => {
    const duplicate: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn().mockResolvedValue(
          ok({
            chats: [
              { ...groupChat, id: 'chat-a', displayName: 'Weekend fishing group' },
              { ...groupChat, id: 'chat-b', displayName: ' Weekend fishing group ' },
            ],
          })
        ),
      },
    };

    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        duplicate
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
  });

  it('bounds migration discovery and propagates only stable dependency failures', async () => {
    const accountFailure: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi
          .fn()
          .mockResolvedValue(err({ code: 'PERSISTENCE_ERROR', message: 'Safe account failure' })),
        findChats: vi.fn(),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        accountFailure
      )
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe account failure' }));

    const emptyDisplayName: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn(),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: undefined as unknown as string },
        emptyDisplayName
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(emptyDisplayName.repository.findChats).not.toHaveBeenCalled();

    const pageFailure: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi
          .fn()
          .mockResolvedValue(err({ code: 'PERSISTENCE_ERROR', message: 'Safe page failure' })),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        pageFailure
      )
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe page failure' }));

    const noMatch: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn().mockResolvedValue(ok({ chats: [withoutDisplayName(groupChat)] })),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        noMatch
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });

    const cyclicCursor: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn().mockResolvedValue(ok({ chats: [], nextCursor: 'same-page' })),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        cyclicCursor
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const oversizedPage: PrivateWhatsAppDigestMigrationBindingDeps = {
      repository: {
        getAccountByUserId: vi.fn().mockResolvedValue(ok(account)),
        findChats: vi.fn().mockResolvedValue(
          ok({
            chats: Array.from({ length: 1_001 }, (_value, index) => ({
              ...groupChat,
              id: `distractor-${String(index)}`,
              displayName: 'Different group',
            })),
          })
        ),
      },
    };
    await expect(
      resolvePrivateDigestMigrationBinding(
        { userId: 'user-1', expectedDisplayName: 'Weekend fishing group' },
        oversizedPage
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('validates and normalizes an owned group with its immutable generation fence', async () => {
    const deps = sourceDeps();

    const result = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1', expectedGenerationId: 'generation-1' },
      deps
    );

    expect(result).toEqual(
      ok({
        sourceAccountId: 'source-1',
        generationId: 'generation-1',
        chatId: 'chat-1',
        chatType: 'group',
        displayName: 'Weekend fishing group',
        messageCount: 42,
        participantCount: 8,
        lastActivityAt: '2026-07-27T07:59:00.000Z',
        sourceRevision: 'opaque-source-revision',
      })
    );
    expect(deps.repository.getChatById).toHaveBeenCalledWith({
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
    });
    expect(deps.issueSourceRevision).toHaveBeenCalledWith({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group',
      contextChangeSequence: 17,
    });
  });

  it('supports a direct chat and uses a safe fallback instead of an identifier', async () => {
    const deps = sourceDeps({
      chat: {
        ...withoutParticipantCount(groupChat),
        chatType: 'direct',
        displayName: '  +48 111 222 333  ',
      },
    });

    const result = await validatePrivateDigestSource({ userId: 'user-1', chatId: 'chat-1' }, deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        chatType: 'direct',
        displayName: 'WhatsApp contact',
      },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).not.toHaveProperty('participantCount');
  });

  it('rejects a stale generation before reading the chat', async () => {
    const deps = sourceDeps();

    const result = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1', expectedGenerationId: 'stale-generation' },
      deps
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
    expect(deps.repository.getChatById).not.toHaveBeenCalled();
  });

  it('rejects unknown chat types and foreign ownership without exposing stored identifiers', async () => {
    const unsupported = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1' },
      sourceDeps({ chat: { ...groupChat, chatType: 'unknown' } })
    );
    expect(unsupported).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Unsupported WhatsApp chat type' },
    });

    const foreign = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1' },
      sourceDeps({ chat: { ...groupChat, userId: 'foreign-user' } })
    );
    expect(foreign).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' },
    });
    expect(JSON.stringify(foreign)).not.toContain('foreign-user');
    expect(JSON.stringify(foreign)).not.toContain('!private-room');
  });

  it('propagates safe validation dependencies and normalizes invalid source counters', async () => {
    const accountFailure = sourceDeps();
    vi.mocked(accountFailure.repository.getAccountByUserId).mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'Safe account failure' })
    );
    await expect(
      validatePrivateDigestSource({ userId: 'user-1', chatId: 'chat-1' }, accountFailure)
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe account failure' }));

    await expect(
      validatePrivateDigestSource(
        { userId: 'user-1', chatId: 'chat-1' },
        sourceDeps({ account: { ...account, status: 'disabled' } })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const chatFailure = sourceDeps();
    vi.mocked(chatFailure.repository.getChatById).mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'Safe chat failure' })
    );
    await expect(
      validatePrivateDigestSource({ userId: 'user-1', chatId: 'chat-1' }, chatFailure)
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe chat failure' }));

    const journalFailure = sourceDeps();
    vi.mocked(journalFailure.repository.getConversationContextJournalHead).mockResolvedValueOnce(
      err({ code: 'PERSISTENCE_ERROR', message: 'Safe journal failure' })
    );
    await expect(
      validatePrivateDigestSource({ userId: 'user-1', chatId: 'chat-1' }, journalFailure)
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe journal failure' }));

    const revisionFailure = sourceDeps();
    vi.mocked(revisionFailure.issueSourceRevision).mockReturnValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'Safe token failure' })
    );
    await expect(
      validatePrivateDigestSource({ userId: 'user-1', chatId: 'chat-1' }, revisionFailure)
    ).resolves.toEqual(err({ code: 'INTERNAL_ERROR', message: 'Safe token failure' }));

    const invalidCounters = await validatePrivateDigestSource(
      { userId: 'user-1', chatId: 'chat-1' },
      sourceDeps({
        chat: {
          ...groupChat,
          messageCount: -1,
          participantCount: Number.NaN,
        },
      })
    );
    expect(invalidCounters).toMatchObject({
      ok: true,
      value: { messageCount: 0, participantCount: 0 },
    });
  });

  it('projects the effective edited text and omits replacement and redacted records', () => {
    const projected = projectPrivateDigestMessages(
      [
        message({
          id: 'effective-target',
          text: 'Edited visible text',
          contextOriginalText: 'Old secret revision',
          editedAt: '2026-07-27T07:10:00.000Z',
        }),
        message({
          id: 'replacement-row',
          matrixEventId: '$replacement',
          text: 'Edit operation payload',
          relation: {
            kind: 'replacement',
            targetMatrixEventId: '$private-event',
            targetMessageId: 'effective-target',
            applicationStatus: 'applied',
          },
        }),
        message({
          id: 'redacted-row',
          text: 'Redacted secret',
          contextState: 'redacted',
          redactedAt: '2026-07-27T07:12:00.000Z',
        }),
      ],
      ({ messageId, projectionKey }) => `ref:${messageId}:${projectionKey}`
    );

    expect(projected).toEqual([
      {
        messageRef: 'ref:effective-target:content',
        eventTimestamp: '2026-07-27T07:00:00.000Z',
        direction: 'inbound',
        authorLabel: 'Alice Example',
        text: 'Edited visible text',
        contentKind: 'text',
      },
    ]);
    expect(JSON.stringify(projected)).not.toContain('Old secret revision');
    expect(JSON.stringify(projected)).not.toContain('Edit operation payload');
    expect(JSON.stringify(projected)).not.toContain('Redacted secret');
  });

  it('represents effective reactions exactly once with display-safe authors', () => {
    const projected = projectPrivateDigestMessages(
      [
        message({
          id: 'reaction-target',
          reactions: [
            {
              id: 'reaction-1',
              emoji: '👍',
              senderDisplayName: '@private-reactor:example.invalid',
              senderPhoneNumber: '+48222222222',
              senderKey: 'private-reactor-key',
              direction: 'incoming',
              eventTimestamp: '2026-07-27T07:01:00.000Z',
            },
            {
              id: 'reaction-2',
              emoji: '✅',
              direction: 'outgoing',
              eventTimestamp: '2026-07-27T07:02:00.000Z',
            },
          ],
        }),
        message({
          id: 'raw-reaction-row',
          messageType: 'reaction',
          text: undefined,
          reaction: {
            emoji: '👍',
            targetMatrixEventId: '$private-event',
            targetMessageId: 'reaction-target',
            applicationStatus: 'applied',
          },
        }),
      ],
      ({ messageId, projectionKey }) => `ref:${messageId}:${projectionKey}`
    );

    expect(projected).toEqual([
      expect.objectContaining({
        messageRef: 'ref:reaction-target:content',
        contentKind: 'text',
      }),
      {
        messageRef: 'ref:reaction-target:reaction:reaction-1',
        eventTimestamp: '2026-07-27T07:01:00.000Z',
        direction: 'inbound',
        authorLabel: 'Participant',
        text: 'Reacted 👍',
        contentKind: 'reaction',
      },
      {
        messageRef: 'ref:reaction-target:reaction:reaction-2',
        eventTimestamp: '2026-07-27T07:02:00.000Z',
        direction: 'outbound',
        authorLabel: 'You',
        text: 'Reacted ✅',
        contentKind: 'reaction',
      },
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('+48222222222');
    expect(serialized).not.toContain('@private-reactor');
    expect(serialized).not.toContain('private-reactor-key');
  });

  it('projects safe media markers, captions, and completed transcription exactly once', () => {
    const projected = projectPrivateDigestMessages(
      [
        message({
          id: 'captioned-image',
          messageType: 'image',
          text: 'Sunrise at the lake',
          media: { mxcUri: 'mxc://private/image', gcsPath: 'private/image.jpg' },
        }),
        message({
          id: 'transcribed-audio',
          messageType: 'audio',
          text: undefined,
          media: { mxcUri: 'mxc://private/audio', gcsPath: 'private/audio.ogg' },
          transcription: {
            status: 'completed',
            text: 'Meet at six near the pier.',
            summary: 'private summary',
          },
          eventTimestamp: '2026-07-27T07:03:00.000Z',
        }),
        message({
          id: 'media-only-file',
          messageType: 'file',
          text: undefined,
          media: { mxcUri: 'mxc://private/file', fileName: 'private-name.pdf' },
          eventTimestamp: '2026-07-27T07:04:00.000Z',
        }),
      ],
      ({ messageId, projectionKey }) => `ref:${messageId}:${projectionKey}`
    );

    expect(projected).toEqual([
      expect.objectContaining({
        messageRef: 'ref:captioned-image:content',
        text: '[Image] Sunrise at the lake',
        contentKind: 'media_caption',
      }),
      expect.objectContaining({
        messageRef: 'ref:transcribed-audio:content',
        text: 'Meet at six near the pier.',
        contentKind: 'transcription',
      }),
      expect.objectContaining({
        messageRef: 'ref:media-only-file:content',
        text: '[File]',
        contentKind: 'media_caption',
      }),
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('mxc://');
    expect(serialized).not.toContain('private/image');
    expect(serialized).not.toContain('private-name.pdf');
    expect(serialized).not.toContain('private summary');
  });

  it('bounds labels and emits no raw identifiers or payload fields', () => {
    const projected = projectPrivateDigestMessages(
      [
        message({
          senderDisplayName: `  ${'A'.repeat(120)}  `,
          text: 'Visible content',
        }),
        message({
          id: 'system-record',
          messageType: 'unknown',
          text: undefined,
          eventTimestamp: '2026-07-27T07:05:00.000Z',
        }),
      ],
      ({ messageId }) => `opaque:${messageId}`
    );

    expect(projected[0]?.authorLabel).toHaveLength(80);
    expect(projected[1]).toEqual({
      messageRef: 'opaque:system-record',
      eventTimestamp: '2026-07-27T07:05:00.000Z',
      direction: 'system',
      authorLabel: 'System',
      text: '[Unsupported WhatsApp message]',
      contentKind: 'system',
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('$private-event');
    expect(serialized).not.toContain('@private-sender');
    expect(serialized).not.toContain('+48111111111');
    expect(serialized).not.toContain('raw-private-payload');
    expect(serialized).not.toContain('sender-private-key');
  });

  it('covers non-media transcription, bounded reactions, and every safe media label', () => {
    const projected = projectPrivateDigestMessages(
      [
        message({
          id: 'transcribed-unknown',
          messageType: 'unknown',
          text: undefined,
          transcription: { status: 'completed', text: 'Recovered transcript' },
        }),
        message({
          id: 'empty-unknown',
          messageType: 'unknown',
          text: ' \u0000 \n ',
          eventTimestamp: '2026-07-27T07:00:01.000Z',
        }),
        ...(['audio', 'video', 'sticker'] as const).map((messageType, index) =>
          message({
            id: `media-${messageType}`,
            messageType,
            text: undefined,
            eventTimestamp: `2026-07-27T07:00:0${String(index + 2)}.000Z`,
          })
        ),
        message({
          id: 'reaction-bounds',
          eventTimestamp: '2026-07-27T07:00:05.000Z',
          reactions: [
            {
              id: 'reaction-b',
              emoji: '✅',
              direction: 'incoming',
              eventTimestamp: '2026-07-27T07:01:00.000Z',
            },
            {
              id: 'reaction-a',
              emoji: '👍',
              direction: 'incoming',
              eventTimestamp: '2026-07-27T07:01:00.000Z',
            },
            {
              id: 'reaction-a',
              emoji: 'duplicate must be ignored',
              direction: 'incoming',
              eventTimestamp: '2026-07-27T07:01:01.000Z',
            },
            {
              id: 'reaction-empty',
              emoji: ' \u0000 ',
              direction: 'incoming',
              eventTimestamp: '2026-07-27T07:01:02.000Z',
            },
          ],
        }),
      ],
      ({ messageId, projectionKey }) => `ref:${messageId}:${projectionKey}`
    );

    expect(projected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageRef: 'ref:transcribed-unknown:content',
          text: 'Recovered transcript',
          contentKind: 'transcription',
        }),
        expect.objectContaining({ messageRef: 'ref:empty-unknown:content', contentKind: 'system' }),
        expect.objectContaining({ messageRef: 'ref:media-audio:content', text: '[Audio]' }),
        expect.objectContaining({ messageRef: 'ref:media-video:content', text: '[Video]' }),
        expect.objectContaining({ messageRef: 'ref:media-sticker:content', text: '[Sticker]' }),
        expect.objectContaining({
          messageRef: 'ref:reaction-bounds:reaction:reaction-a',
          text: 'Reacted 👍',
        }),
        expect.objectContaining({
          messageRef: 'ref:reaction-bounds:reaction:reaction-b',
          text: 'Reacted ✅',
        }),
      ])
    );
    expect(projected.filter((item) => item.contentKind === 'reaction')).toHaveLength(2);
  });

  it('returns only the safe public page and binds references to the complete source query', async () => {
    const repository = {
      queryMessages: vi.fn().mockResolvedValue(
        ok({
          messages: [message({ id: 'private-message-id', text: 'Visible digest text' })],
          sourceRevision: 'opaque-revision',
          highWatermark: 'opaque-watermark',
          nextCursor: 'opaque-cursor',
        })
      ),
    };
    const createMessageRef = vi.fn().mockReturnValue('opaque-message-reference');
    const input = {
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group' as const,
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 50,
    };

    const result = await readPrivateWhatsAppDigestSource(input, {
      repository,
      tokens: { createMessageRef },
    });

    expect(result).toEqual(
      ok({
        messages: [
          {
            messageRef: 'opaque-message-reference',
            eventTimestamp: '2026-07-27T07:00:00.000Z',
            direction: 'inbound',
            authorLabel: 'Alice Example',
            text: 'Visible digest text',
            contentKind: 'text',
          },
        ],
        sourceRevision: 'opaque-revision',
        highWatermark: 'opaque-watermark',
        nextCursor: 'opaque-cursor',
      })
    );
    expect(createMessageRef).toHaveBeenCalledWith({
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group',
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      messageId: 'private-message-id',
      projectionKey: 'content',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-message-id');
    expect(serialized).not.toContain('raw-private-payload');
    expect(serialized).not.toContain('@private-sender');
  });

  it('keeps projected reactions inside the exact half-open source window', async () => {
    const repository = {
      queryMessages: vi.fn().mockResolvedValue(
        ok({
          messages: [
            message({
              id: 'reaction-target',
              reactions: [
                {
                  id: 'before-window',
                  emoji: '1️⃣',
                  direction: 'incoming',
                  eventTimestamp: '2026-07-26T23:59:59.999Z',
                },
                {
                  id: 'at-window-start',
                  emoji: '2️⃣',
                  direction: 'incoming',
                  eventTimestamp: '2026-07-27T00:00:00.000Z',
                },
                {
                  id: 'inside-window',
                  emoji: '3️⃣',
                  direction: 'outgoing',
                  eventTimestamp: '2026-07-27T23:59:59.999Z',
                },
                {
                  id: 'at-window-end',
                  emoji: '4️⃣',
                  direction: 'incoming',
                  eventTimestamp: '2026-07-28T00:00:00.000Z',
                },
                {
                  id: 'after-window',
                  emoji: '5️⃣',
                  direction: 'incoming',
                  eventTimestamp: '2026-07-28T00:00:00.001Z',
                },
              ],
            }),
          ],
          sourceRevision: 'opaque-revision',
          highWatermark: 'opaque-watermark',
          nextCursor: null,
        })
      ),
    };
    const createMessageRef = vi
      .fn()
      .mockImplementation(
        (input: { projectionKey: string }) => `opaque-reference:${input.projectionKey}`
      );

    const result = await readPrivateWhatsAppDigestSource(
      {
        userId: 'user-1',
        sourceAccountId: 'source-1',
        generationId: 'generation-1',
        chatId: 'chat-1',
        chatType: 'group',
        windowStart: '2026-07-27T00:00:00.000Z',
        windowEnd: '2026-07-28T00:00:00.000Z',
        limit: 50,
      },
      { repository, tokens: { createMessageRef } }
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        messages: [
          { contentKind: 'text', eventTimestamp: '2026-07-27T07:00:00.000Z' },
          {
            messageRef: 'opaque-reference:reaction:at-window-start',
            contentKind: 'reaction',
            eventTimestamp: '2026-07-27T00:00:00.000Z',
          },
          {
            messageRef: 'opaque-reference:reaction:inside-window',
            contentKind: 'reaction',
            eventTimestamp: '2026-07-27T23:59:59.999Z',
          },
        ],
      },
    });
  });

  it('maps repository and timestamp failures to content-free read errors', async () => {
    const baseInput = {
      userId: 'user-1',
      sourceAccountId: 'source-1',
      generationId: 'generation-1',
      chatId: 'chat-1',
      chatType: 'group' as const,
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-28T00:00:00.000Z',
      limit: 50,
    };
    await expect(
      readPrivateWhatsAppDigestSource(baseInput, {
        repository: {
          queryMessages: vi
            .fn()
            .mockResolvedValue(
              err({ code: 'PERSISTENCE_ERROR', message: 'Safe repository failure' })
            ),
        },
        tokens: { createMessageRef: vi.fn() },
      })
    ).resolves.toEqual(err({ code: 'PERSISTENCE_ERROR', message: 'Safe repository failure' }));

    await expect(
      readPrivateWhatsAppDigestSource(
        { ...baseInput, windowStart: 'invalid-timestamp' },
        {
          repository: {
            queryMessages: vi.fn().mockResolvedValue(
              ok({
                messages: [],
                sourceRevision: 'opaque-revision',
                highWatermark: null,
                nextCursor: null,
              })
            ),
          },
          tokens: { createMessageRef: vi.fn() },
        }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
