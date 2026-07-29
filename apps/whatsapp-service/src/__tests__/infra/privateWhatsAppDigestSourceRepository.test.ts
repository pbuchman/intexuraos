import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import {
  createFakeFirestore,
  resetFirestore,
  setFirestore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import type { PrivateDigestSourceError } from '../../domain/whatsapp/models/PrivateWhatsAppDigestSource.js';
import type {
  PrivateDigestSourceCursorClaims,
  PrivateDigestSourceRouteBinding,
  PrivateDigestSourceTokenCodec,
} from '../../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';
import { createPrivateWhatsAppDigestSourceRepository } from '../../infra/firestore/privateWhatsAppDigestSourceRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
} from '../../infra/firestore/privateWhatsAppRepository.js';

const fakeFirestore = createFakeFirestore();

const baseQuery = {
  userId: 'user-1',
  sourceAccountId: 'source-1',
  generationId: 'generation-1',
  chatId: 'chat-1',
  chatType: 'group' as const,
  windowStart: '2026-07-27T00:00:00.000Z',
  windowEnd: '2026-07-28T00:00:00.000Z',
  limit: 2,
};

interface FakeTokenHarness {
  codec: PrivateDigestSourceTokenCodec;
  rejectNextCursor(error: PrivateDigestSourceError): void;
  cursorClaims(token: string): PrivateDigestSourceCursorClaims | undefined;
}

function createFakeTokenHarness(): FakeTokenHarness {
  const cursors = new Map<string, PrivateDigestSourceCursorClaims>();
  let cursorCounter = 0;
  let revisionCounter = 0;
  let watermarkCounter = 0;
  let nextCursorError: PrivateDigestSourceError | undefined;

  const codec: PrivateDigestSourceTokenCodec = {
    issueSourceRevision: vi.fn().mockImplementation(() => {
      revisionCounter += 1;
      return ok(`revision-${String(revisionCounter)}`);
    }),
    issueHighWatermark: vi.fn().mockImplementation(() => {
      watermarkCounter += 1;
      return ok(`watermark-${String(watermarkCounter)}`);
    }),
    issueCursor: vi.fn().mockImplementation((claims: PrivateDigestSourceCursorClaims) => {
      cursorCounter += 1;
      const token = `cursor-${String(cursorCounter)}`;
      cursors.set(token, structuredClone(claims));
      return ok(token);
    }),
    readCursor: vi
      .fn()
      .mockImplementation(
        (input: {
          token: string;
          binding: PrivateDigestSourceRouteBinding;
        }): Result<PrivateDigestSourceCursorClaims, PrivateDigestSourceError> => {
          if (nextCursorError !== undefined) {
            const failure = nextCursorError;
            nextCursorError = undefined;
            return err(failure);
          }
          const claims = cursors.get(input.token);
          return claims === undefined
            ? err({ code: 'VALIDATION_ERROR', message: 'Invalid digest cursor' })
            : ok(structuredClone(claims));
        }
      ),
    createMessageRef: vi.fn().mockImplementation(({ messageId, projectionKey }) => {
      return `ref:${String(messageId)}:${String(projectionKey)}`;
    }),
  };

  return {
    codec,
    rejectNextCursor(error: PrivateDigestSourceError): void {
      nextCursorError = error;
    },
    cursorClaims(token: string): PrivateDigestSourceCursorClaims | undefined {
      const claims = cursors.get(token);
      return claims === undefined ? undefined : structuredClone(claims);
    },
  };
}

function seedOwnedSource(
  options: {
    chatType?: 'group' | 'direct' | 'unknown';
    contextChangeSequence?: number;
    userId?: string;
    generationId?: string;
  } = {}
): void {
  const userId = options.userId ?? 'user-1';
  fakeFirestore.seedCollection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION, [
    {
      id: userId,
      data: {
        id: 'account-1',
        userId,
        sourceAccountId: 'source-1',
        generationId: options.generationId ?? 'generation-1',
        phoneNumberNormalized: '+48000000000',
        displayName: 'Primary',
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
        schemaVersion: 1,
      },
    },
  ]);
  fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CHATS_COLLECTION, [
    {
      id: 'chat-1',
      data: {
        id: 'chat-1',
        userId,
        sourceAccountId: 'source-1',
        matrixRoomId: '!private-room:example.invalid',
        chatType: options.chatType ?? 'group',
        displayName: 'Fishing group',
        contextChangeSequence: options.contextChangeSequence ?? 0,
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastEventAt: '2026-07-27T03:00:00.000Z',
        updatedAt: '2026-07-27T03:00:01.000Z',
      },
    },
  ]);
}

function storedMessage(input: {
  id: string;
  eventTimestamp: string;
  text?: string;
  userId?: string;
  chatId?: string;
  sourceAccountId?: string;
}): { id: string; data: Record<string, unknown> } {
  return {
    id: input.id,
    data: {
      id: input.id,
      chatId: input.chatId ?? 'chat-1',
      userId: input.userId ?? 'user-1',
      sourceAccountId: input.sourceAccountId ?? 'source-1',
      matrixRoomId: '!private-room:example.invalid',
      matrixEventId: `$${input.id}`,
      matrixSenderId: '@private-sender:example.invalid',
      senderDisplayName: 'Alice',
      direction: 'incoming',
      messageType: 'text',
      text: input.text ?? input.id,
      eventTimestamp: input.eventTimestamp,
      receivedAt: input.eventTimestamp,
      ingestedAt: input.eventTimestamp,
      deliveryMode: 'live',
      contextRevision: 1,
      contextState: 'visible',
      rawMatrixEvent: { private: true },
    },
  };
}

function contextChange(input: {
  sequence: number;
  messageId: string;
  eventTimestamp: string;
  changeType?: 'created' | 'edited' | 'redacted' | 'reaction_changed';
}): { id: string; data: Record<string, unknown> } {
  return {
    id: `change-${String(input.sequence).padStart(4, '0')}`,
    data: {
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      sequence: input.sequence,
      messageId: input.messageId,
      messageRevision: input.sequence,
      changeType: input.changeType ?? 'created',
      changedAt: '2026-07-27T12:00:00.000Z',
      eventTimestamp: input.eventTimestamp,
      before: { state: 'missing' },
      after: { state: 'missing' },
      schemaVersion: 1,
    },
  };
}

function updateChatHead(sequence: number): void {
  const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get('chat-1');
  if (chat === undefined) throw new Error('Expected seeded chat');
  chat['contextChangeSequence'] = sequence;
}

function manualCursorClaims(
  overrides: Partial<PrivateDigestSourceCursorClaims> = {}
): PrivateDigestSourceCursorClaims {
  return {
    userId: baseQuery.userId,
    sourceAccountId: baseQuery.sourceAccountId,
    generationId: baseQuery.generationId,
    chatId: baseQuery.chatId,
    chatType: baseQuery.chatType,
    windowStart: baseQuery.windowStart,
    windowEnd: baseQuery.windowEnd,
    watermark: {
      eventTimestamp: '2026-07-27T02:00:00.000Z',
      messageId: 'message-b',
    },
    position: {
      eventTimestamp: '2026-07-27T01:00:00.000Z',
      messageId: 'message-a',
    },
    validatedContextSequence: 0,
    sourceRevision: 'opaque-source-revision',
    highWatermark: 'opaque-high-watermark',
    ...overrides,
  };
}

beforeEach(() => {
  fakeFirestore.clear();
  setFirestore(fakeFirestore as unknown as Firestore);
  seedOwnedSource();
});

afterEach(() => {
  resetFirestore();
});

describe('private WhatsApp digest source Firestore repository', () => {
  it('uses the Firestore document id for an owned legacy chat without a duplicated payload id', async () => {
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get('chat-1');
    if (chat === undefined) throw new Error('Expected seeded chat');
    delete chat['id'];
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    const result = await repository.queryMessages(baseQuery);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messages.map((item) => item.id)).toEqual(['message-a']);
  });

  it('treats a legacy null context journal head as the zero baseline', async () => {
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get('chat-1');
    if (chat === undefined) throw new Error('Expected seeded chat');
    chat['contextChangeSequence'] = null;
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
      storedMessage({ id: 'message-c', eventTimestamp: '2026-07-27T03:00:00.000Z' }),
    ]);
    const tokens = createFakeTokenHarness();
    const repository = createPrivateWhatsAppDigestSourceRepository({ tokens: tokens.codec });

    const result = await repository.queryMessages(baseQuery);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.nextCursor === null) {
      throw new Error('Expected a legacy baseline cursor');
    }
    expect(tokens.cursorClaims(result.value.nextCursor)).toMatchObject({
      validatedContextSequence: 0,
    });
  });

  it.each([
    { name: 'negative', value: -1 },
    { name: 'fractional', value: 0.5 },
    { name: 'string', value: '0' },
  ])('fails closed for a $name context journal head', async ({ value }) => {
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get('chat-1');
    if (chat === undefined) throw new Error('Expected seeded chat');
    chat['contextChangeSequence'] = value;
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    const result = await repository.queryMessages(baseQuery);

    expect(result).toEqual({
      ok: false,
      error: { code: 'SOURCE_CHANGED', message: 'Private WhatsApp source changed' },
    });
  });

  it('uses the persisted source account id as the generation for a legacy account', async () => {
    const account = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      ?.get('user-1');
    if (account === undefined) throw new Error('Expected seeded account');
    delete account['generationId'];
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    const result = await repository.queryMessages({
      ...baseQuery,
      generationId: 'source-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messages.map((item) => item.id)).toEqual(['message-a']);
  });

  it('fails closed when the indexed source and chat contain a message with a conflicting owner', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({
        id: 'foreign-message',
        eventTimestamp: '2026-07-27T02:00:00.000Z',
        userId: 'foreign-user',
      }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    const result = await repository.queryMessages(baseQuery);

    expect(result).toEqual({
      ok: false,
      error: { code: 'SOURCE_CHANGED', message: 'Private WhatsApp source changed' },
    });
  });

  it('freezes a watermark and returns two stable pages ordered by timestamp then document id', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-c', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const tokens = createFakeTokenHarness();
    const repository = createPrivateWhatsAppDigestSourceRepository({ tokens: tokens.codec });

    const first = await repository.queryMessages(baseQuery);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.messages.map((item) => item.id)).toEqual(['message-a', 'message-b']);
    expect(first.value.sourceRevision).toBe('revision-1');
    expect(first.value.highWatermark).toBe('watermark-1');
    expect(first.value.nextCursor).toBe('cursor-1');

    const second = await repository.queryMessages({
      ...baseQuery,
      cursor: first.value.nextCursor ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.messages.map((item) => item.id)).toEqual(['message-c']);
    expect(second.value.sourceRevision).toBe(first.value.sourceRevision);
    expect(second.value.highWatermark).toBe(first.value.highWatermark);
    expect(second.value.nextCursor).toBeNull();

    const cursor = tokens.cursorClaims('cursor-1');
    expect(cursor).toMatchObject({
      watermark: {
        eventTimestamp: '2026-07-27T02:00:00.000Z',
        messageId: 'message-c',
      },
      position: {
        eventTimestamp: '2026-07-27T01:00:00.000Z',
        messageId: 'message-b',
      },
      validatedContextSequence: 0,
    });
  });

  it('uses exact half-open ISO boundaries supplied by the caller', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'at-start', eventTimestamp: '2026-03-28T23:00:00.000Z' }),
      storedMessage({ id: 'inside-23h', eventTimestamp: '2026-03-29T12:00:00.000Z' }),
      storedMessage({ id: 'at-end', eventTimestamp: '2026-03-29T22:00:00.000Z' }),
      storedMessage({ id: 'inside-25h', eventTimestamp: '2026-10-25T12:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    const spring = await repository.queryMessages({
      ...baseQuery,
      windowStart: '2026-03-28T23:00:00.000Z',
      windowEnd: '2026-03-29T22:00:00.000Z',
      limit: 10,
    });
    expect(spring.ok).toBe(true);
    if (!spring.ok) throw new Error(spring.error.message);
    expect(spring.value.messages.map((item) => item.id)).toEqual(['at-start', 'inside-23h']);

    const autumn = await repository.queryMessages({
      ...baseQuery,
      windowStart: '2026-10-24T22:00:00.000Z',
      windowEnd: '2026-10-25T23:00:00.000Z',
      limit: 10,
    });
    expect(autumn.ok).toBe(true);
    if (!autumn.ok) throw new Error(autumn.error.message);
    expect(autumn.value.messages.map((item) => item.id)).toEqual(['inside-25h']);
  });

  it('keeps the frozen snapshot valid after a strict append above its watermark', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    const first = await repository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected first page');

    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-c', eventTimestamp: '2026-07-27T03:00:00.000Z' }),
    ]);
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION, [
      contextChange({
        sequence: 1,
        messageId: 'message-c',
        eventTimestamp: '2026-07-27T03:00:00.000Z',
      }),
    ]);
    updateChatHead(1);

    const second = await repository.queryMessages({
      ...baseQuery,
      limit: 1,
      cursor: first.value.nextCursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.messages.map((item) => item.id)).toEqual(['message-b']);
    expect(second.value.sourceRevision).toBe(first.value.sourceRevision);
    expect(second.value.highWatermark).toBe(first.value.highWatermark);
  });

  it.each([
    { name: 'edit', changeType: 'edited' as const, messageId: 'message-b' },
    { name: 'late insertion', changeType: 'created' as const, messageId: 'message-late' },
  ])('fails closed when a relevant $name lands at or below the watermark', async (scenario) => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    const first = await repository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected first page');

    if (scenario.name === 'edit') {
      const target = fakeFirestore
        .getAllData()
        .get(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        ?.get('message-b');
      if (target === undefined) throw new Error('Expected target');
      target['text'] = 'Changed while paging';
      target['contextRevision'] = 2;
    } else {
      fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
        storedMessage({
          id: scenario.messageId,
          eventTimestamp: '2026-07-27T01:30:00.000Z',
        }),
      ]);
    }
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION, [
      contextChange({
        sequence: 1,
        messageId: scenario.messageId,
        eventTimestamp:
          scenario.name === 'edit' ? '2026-07-27T02:00:00.000Z' : '2026-07-27T01:30:00.000Z',
        changeType: scenario.changeType,
      }),
    ]);
    updateChatHead(1);

    const second = await repository.queryMessages({
      ...baseQuery,
      limit: 1,
      cursor: first.value.nextCursor,
    });
    expect(second).toEqual({
      ok: false,
      error: { code: 'SOURCE_CHANGED', message: 'Private WhatsApp source changed' },
    });
  });

  it('rejects foreign ownership, a generation mismatch, and a route-bound cursor mismatch', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const tokens = createFakeTokenHarness();
    const repository = createPrivateWhatsAppDigestSourceRepository({ tokens: tokens.codec });

    const foreign = await repository.queryMessages({ ...baseQuery, userId: 'foreign-user' });
    expect(foreign).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Private WhatsApp source not found' },
    });

    const stale = await repository.queryMessages({ ...baseQuery, generationId: 'stale' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });

    const first = await repository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected cursor');
    const mismatched = await repository.queryMessages({
      ...baseQuery,
      chatType: 'direct',
      limit: 1,
      cursor: first.value.nextCursor,
    });
    expect(mismatched).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
  });

  it.each([
    { code: 'VALIDATION_ERROR' as const, message: 'Invalid digest cursor' },
    { code: 'SOURCE_CHANGED' as const, message: 'Private WhatsApp source changed' },
  ])('propagates safe cursor authentication failures: $code', async (failure) => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const tokens = createFakeTokenHarness();
    const repository = createPrivateWhatsAppDigestSourceRepository({ tokens: tokens.codec });
    const first = await repository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected cursor');
    tokens.rejectNextCursor(failure);

    const result = await repository.queryMessages({
      ...baseQuery,
      limit: 1,
      cursor: first.value.nextCursor,
    });
    expect(result).toEqual(err(failure));
    expect(JSON.stringify(result)).not.toContain('message-a');
  });

  it('bounds journal validation and fails closed instead of performing an unbounded read', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    const first = await repository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected cursor');

    fakeFirestore.seedCollection(
      PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
      Array.from({ length: 401 }, (_value, index) =>
        contextChange({
          sequence: index + 1,
          messageId: `append-${String(index + 1)}`,
          eventTimestamp: '2026-07-27T03:00:00.000Z',
        })
      )
    );
    updateChatHead(401);

    const result = await repository.queryMessages({
      ...baseQuery,
      limit: 1,
      cursor: first.value.nextCursor,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
  });

  it('validates bounded inputs and maps unexpected Firestore failures safely', async () => {
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    await expect(repository.queryMessages({ ...baseQuery, userId: '' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    await expect(
      repository.queryMessages({ ...baseQuery, windowStart: 'invalid-timestamp' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    fakeFirestore.configure({ errorToThrow: new Error('private persistence detail') });
    const failed = await repository.queryMessages(baseQuery);
    expect(failed).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_ERROR',
        message: 'Failed to query private WhatsApp digest source',
      },
    });
    expect(JSON.stringify(failed)).not.toContain('private persistence detail');
    fakeFirestore.configure({});
  });

  it('distinguishes a missing chat, invalid source ownership, and changed chat type', async () => {
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.delete('chat-1');
    await expect(repository.queryMessages(baseQuery)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' },
    });

    seedOwnedSource();
    const account = fakeFirestore
      .getAllData()
      .get(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      ?.get('user-1');
    if (account === undefined) throw new Error('Expected seeded account');
    account['userId'] = 'foreign-user';
    await expect(repository.queryMessages(baseQuery)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Private WhatsApp source not found' },
    });

    seedOwnedSource();
    const chat = fakeFirestore.getAllData().get(PRIVATE_WHATSAPP_CHATS_COLLECTION)?.get('chat-1');
    if (chat === undefined) throw new Error('Expected seeded chat');
    chat['userId'] = 'foreign-user';
    await expect(repository.queryMessages(baseQuery)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' },
    });

    seedOwnedSource({ chatType: 'direct' });
    await expect(repository.queryMessages(baseQuery)).resolves.toMatchObject({
      ok: false,
      error: { code: 'SOURCE_CHANGED' },
    });
  });

  it('returns a stable empty first page and uses a document id when payload id is absent', async () => {
    const emptyTokens = createFakeTokenHarness();
    const emptyRepository = createPrivateWhatsAppDigestSourceRepository({
      tokens: emptyTokens.codec,
    });
    await expect(emptyRepository.queryMessages(baseQuery)).resolves.toEqual(
      ok({
        messages: [],
        sourceRevision: 'revision-1',
        highWatermark: null,
        nextCursor: null,
      })
    );
    expect(emptyTokens.codec.issueHighWatermark).not.toHaveBeenCalled();

    const withoutId = storedMessage({
      id: 'message-without-payload-id',
      eventTimestamp: '2026-07-27T01:00:00.000Z',
    });
    delete withoutId.data['id'];
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [withoutId]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    const result = await repository.queryMessages(baseQuery);
    expect(result).toMatchObject({
      ok: true,
      value: { messages: [{ id: 'message-without-payload-id' }] },
    });
  });

  it('fails closed when a foreign row appears below an owned frozen watermark', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({
        id: 'foreign-before-watermark',
        eventTimestamp: '2026-07-27T01:00:00.000Z',
        userId: 'foreign-user',
      }),
      storedMessage({ id: 'owned-watermark', eventTimestamp: '2026-07-27T03:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });

    await expect(repository.queryMessages({ ...baseQuery, limit: 10 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'SOURCE_CHANGED' },
    });
  });

  it('rejects a cursor ahead of the journal and incomplete or malformed journal pages', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const aheadTokens = createFakeTokenHarness();
    const aheadCursor = aheadTokens.codec.issueCursor(
      manualCursorClaims({ validatedContextSequence: 5 })
    );
    if (!aheadCursor.ok) throw new Error(aheadCursor.error.message);
    const aheadRepository = createPrivateWhatsAppDigestSourceRepository({
      tokens: aheadTokens.codec,
    });
    await expect(
      aheadRepository.queryMessages({ ...baseQuery, cursor: aheadCursor.value })
    ).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });

    const missingJournalTokens = createFakeTokenHarness();
    const missingJournalRepository = createPrivateWhatsAppDigestSourceRepository({
      tokens: missingJournalTokens.codec,
    });
    const first = await missingJournalRepository.queryMessages({ ...baseQuery, limit: 1 });
    if (!first.ok || first.value.nextCursor === null) throw new Error('Expected cursor');
    updateChatHead(1);
    await expect(
      missingJournalRepository.queryMessages({
        ...baseQuery,
        limit: 1,
        cursor: first.value.nextCursor,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });

    const invalidEntryTokens = createFakeTokenHarness();
    updateChatHead(0);
    const invalidEntryRepository = createPrivateWhatsAppDigestSourceRepository({
      tokens: invalidEntryTokens.codec,
    });
    const initial = await invalidEntryRepository.queryMessages({ ...baseQuery, limit: 1 });
    if (!initial.ok || initial.value.nextCursor === null) throw new Error('Expected cursor');
    const invalidEntry = contextChange({
      sequence: 1,
      messageId: 'message-b',
      eventTimestamp: '2026-07-27T03:00:00.000Z',
    });
    invalidEntry.data['userId'] = 'foreign-user';
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION, [invalidEntry]);
    updateChatHead(1);
    await expect(
      invalidEntryRepository.queryMessages({
        ...baseQuery,
        limit: 1,
        cursor: initial.value.nextCursor,
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_CHANGED' } });
  });

  it('returns an empty continuation when the cursor already points at the watermark', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const tokens = createFakeTokenHarness();
    const cursor = tokens.codec.issueCursor(
      manualCursorClaims({
        position: {
          eventTimestamp: '2026-07-27T02:00:00.000Z',
          messageId: 'message-b',
        },
      })
    );
    if (!cursor.ok) throw new Error(cursor.error.message);
    const repository = createPrivateWhatsAppDigestSourceRepository({ tokens: tokens.codec });

    await expect(repository.queryMessages({ ...baseQuery, cursor: cursor.value })).resolves.toEqual(
      ok({
        messages: [],
        sourceRevision: 'opaque-source-revision',
        highWatermark: 'opaque-high-watermark',
        nextCursor: null,
      })
    );
  });

  it('propagates safe token issuance failures without page content', async () => {
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      storedMessage({ id: 'message-a', eventTimestamp: '2026-07-27T01:00:00.000Z' }),
      storedMessage({ id: 'message-b', eventTimestamp: '2026-07-27T02:00:00.000Z' }),
    ]);
    const revisionTokens = createFakeTokenHarness();
    vi.mocked(revisionTokens.codec.issueSourceRevision).mockReturnValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'Safe revision failure' })
    );
    await expect(
      createPrivateWhatsAppDigestSourceRepository({ tokens: revisionTokens.codec }).queryMessages(
        baseQuery
      )
    ).resolves.toEqual(err({ code: 'INTERNAL_ERROR', message: 'Safe revision failure' }));

    const watermarkTokens = createFakeTokenHarness();
    vi.mocked(watermarkTokens.codec.issueHighWatermark).mockReturnValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'Safe watermark failure' })
    );
    await expect(
      createPrivateWhatsAppDigestSourceRepository({ tokens: watermarkTokens.codec }).queryMessages(
        baseQuery
      )
    ).resolves.toEqual(err({ code: 'INTERNAL_ERROR', message: 'Safe watermark failure' }));

    const cursorTokens = createFakeTokenHarness();
    vi.mocked(cursorTokens.codec.issueCursor).mockReturnValueOnce(
      err({ code: 'INTERNAL_ERROR', message: 'Safe cursor failure' })
    );
    await expect(
      createPrivateWhatsAppDigestSourceRepository({ tokens: cursorTokens.codec }).queryMessages({
        ...baseQuery,
        limit: 1,
      })
    ).resolves.toEqual(err({ code: 'INTERNAL_ERROR', message: 'Safe cursor failure' }));
  });

  it('maps malformed queried snapshots to one content-free persistence failure', async () => {
    const invalidRecord = Object.assign([], {
      userId: 'user-1',
      sourceAccountId: 'source-1',
      chatId: 'chat-1',
      eventTimestamp: '2026-07-27T01:00:00.000Z',
    });
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      { id: 'invalid-record', data: invalidRecord as never },
      storedMessage({ id: 'owned-watermark', eventTimestamp: '2026-07-27T03:00:00.000Z' }),
    ]);
    const repository = createPrivateWhatsAppDigestSourceRepository({
      tokens: createFakeTokenHarness().codec,
    });
    await expect(repository.queryMessages(baseQuery)).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR' },
    });

    fakeFirestore.clear();
    seedOwnedSource();
    const invalidTimestamp = storedMessage({
      id: 'invalid-timestamp',
      eventTimestamp: '2026-07-27T01:00:00.000Z',
    });
    invalidTimestamp.data['eventTimestamp'] = new String(
      '2026-07-27T01:00:00.000Z'
    ) as unknown as string;
    fakeFirestore.seedCollection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION, [
      invalidTimestamp,
      storedMessage({ id: 'owned-watermark', eventTimestamp: '2026-07-27T03:00:00.000Z' }),
    ]);
    await expect(repository.queryMessages(baseQuery)).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSISTENCE_ERROR' },
    });
  });
});
