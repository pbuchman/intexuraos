import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { getMessageDigest, queryMessageDigests } from './queryMessageDigests.js';

describe('queryMessageDigests', () => {
  it('normalizes search and forwards the exact bounded filter/sort grammar', async () => {
    const listOwnedDefinitions = vi.fn<
      Pick<MessageDigestStore, 'listOwnedDefinitions'>['listOwnedDefinitions']
    >(async () => ({ items: [definition()], nextCursor: 'opaque-next' }));

    const result = await queryMessageDigests(
      {
        userId: 'synthetic-user-001',
        query: '  ŻÓŁW  ',
        chatType: 'group',
        status: 'needs_attention',
        sort: 'name',
        direction: 'desc',
        limit: 7,
        cursor: 'opaque-current',
      },
      { store: { listOwnedDefinitions } }
    );

    expect(result).toEqual({ ok: true, items: [definition()], nextCursor: 'opaque-next' });
    expect(listOwnedDefinitions).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      query: 'żółw',
      chatType: 'group',
      status: 'needs_attention',
      sort: 'name',
      direction: 'desc',
      limit: 7,
      cursor: 'opaque-current',
      queryFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('uses updatedAt descending defaults without a search and name ascending with one', async () => {
    const listOwnedDefinitions = vi.fn<
      Pick<MessageDigestStore, 'listOwnedDefinitions'>['listOwnedDefinitions']
    >(async () => ({ items: [], nextCursor: null }));
    const deps = { store: { listOwnedDefinitions } };

    await queryMessageDigests({ userId: 'synthetic-user-001' }, deps);
    await queryMessageDigests({ userId: 'synthetic-user-001', query: 'daily' }, deps);

    expect(listOwnedDefinitions.mock.calls[0]?.[0]).toMatchObject({
      limit: 25,
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(listOwnedDefinitions.mock.calls[1]?.[0]).toMatchObject({
      query: 'daily',
      sort: 'name',
      direction: 'asc',
    });
  });

  it.each([
    [{ userId: 'synthetic-user-001', limit: 0 }],
    [{ userId: 'synthetic-user-001', limit: 51 }],
    [{ userId: 'synthetic-user-001', query: 'daily', sort: 'updatedAt' as const }],
    [{ userId: ' ' }],
  ])('rejects invalid list grammar without reading the store', async (input) => {
    const listOwnedDefinitions = vi.fn();

    await expect(
      queryMessageDigests(input, {
        store: { listOwnedDefinitions } as unknown as Pick<
          MessageDigestStore,
          'listOwnedDefinitions'
        >,
      })
    ).resolves.toEqual({ ok: false, code: 'INVALID_QUERY' });
    expect(listOwnedDefinitions).not.toHaveBeenCalled();
  });

  it('uses a static not-found result for foreign and missing definitions', async () => {
    const getOwnedDefinition = vi.fn<
      Pick<MessageDigestStore, 'getOwnedDefinition'>['getOwnedDefinition']
    >(async () => null);

    await expect(
      getMessageDigest(
        { userId: 'synthetic-user-001', definitionId: 'md_foreign_or_missing' },
        { store: { getOwnedDefinition } }
      )
    ).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('treats blank search as absent and applies explicit name defaults', async () => {
    const listOwnedDefinitions = vi.fn<MessageDigestStore['listOwnedDefinitions']>(async () => ({
      items: [],
      nextCursor: null,
    }));

    await queryMessageDigests(
      { userId: 'synthetic-user-001', query: '   ' },
      { store: { listOwnedDefinitions } }
    );
    await queryMessageDigests(
      { userId: 'synthetic-user-001', sort: 'name' },
      { store: { listOwnedDefinitions } }
    );

    expect(listOwnedDefinitions.mock.calls[0]?.[0]).toMatchObject({
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(listOwnedDefinitions.mock.calls[0]?.[0]).not.toHaveProperty('query');
    expect(listOwnedDefinitions.mock.calls[1]?.[0]).toMatchObject({
      sort: 'name',
      direction: 'asc',
    });
  });

  it('maps only the canonical cursor error and rethrows unexpected store failures', async () => {
    const invalidCursor = vi.fn<MessageDigestStore['listOwnedDefinitions']>(async () => {
      throw new Error('INVALID_CURSOR');
    });
    await expect(
      queryMessageDigests(
        { userId: 'synthetic-user-001', cursor: 'opaque-invalid' },
        { store: { listOwnedDefinitions: invalidCursor } }
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_CURSOR' });

    const unexpected = vi.fn<MessageDigestStore['listOwnedDefinitions']>(async () => {
      throw new Error('synthetic store failure');
    });
    await expect(
      queryMessageDigests(
        { userId: 'synthetic-user-001' },
        { store: { listOwnedDefinitions: unexpected } }
      )
    ).rejects.toThrow('synthetic store failure');
  });

  it('rejects fractional limits and blank cursors and reads valid owned definitions', async () => {
    for (const input of [
      { userId: 'synthetic-user-001', limit: 1.5 },
      { userId: 'synthetic-user-001', cursor: '   ' },
    ]) {
      await expect(
        queryMessageDigests(input, {
          store: { listOwnedDefinitions: vi.fn() },
        })
      ).resolves.toEqual({ ok: false, code: 'INVALID_QUERY' });
    }

    const getOwnedDefinition = vi.fn<MessageDigestStore['getOwnedDefinition']>(async () =>
      definition()
    );
    await expect(
      getMessageDigest(
        { userId: 'synthetic-user-001', definitionId: 'md_definition_001' },
        { store: { getOwnedDefinition } }
      )
    ).resolves.toEqual({ ok: true, definition: definition() });
    for (const input of [
      { userId: ' ', definitionId: 'md_definition_001' },
      { userId: 'synthetic-user-001', definitionId: ' ' },
    ]) {
      await expect(getMessageDigest(input, { store: { getOwnedDefinition } })).resolves.toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
    }
  });
});

function definition(): MessageDigestDefinition {
  return {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Daily chat summary',
    nameSortKey: 'daily chat summary',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 1,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Fishing friends',
      sourceRevision: 'synthetic-source-revision-001',
    },
    instructions: {
      templateId: 'custom',
      text: 'Summarize the important decisions and follow-ups from this chat.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'ready-v1',
      readinessObservedAt: '2026-07-27T10:00:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
  };
}
