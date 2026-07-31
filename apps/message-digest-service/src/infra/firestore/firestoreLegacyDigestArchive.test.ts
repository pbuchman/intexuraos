import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeFirestore,
  type FakeFirestore,
  type Firestore,
} from '@intexuraos/infra-firestore';
import type { LegacyDigestArchive } from '../../domain/ports/legacyDigestArchive.js';
import {
  LEGACY_DIGEST_ARCHIVE_COLLECTIONS,
  createFirestoreLegacyDigestArchive,
} from './firestoreLegacyDigestArchive.js';

const OWNER_ID = 'synthetic-owner-001';
const GROUP_KEY = 'synthetic-fishing-group';

describe('FirestoreLegacyDigestArchive', () => {
  let fake: FakeFirestore;
  let archive: ReturnType<typeof createFirestoreLegacyDigestArchive>;

  beforeEach(() => {
    fake = createFakeFirestore();
    archive = createFirestoreLegacyDigestArchive({
      firestore: fake as unknown as Firestore,
    });
    const domainArchive: LegacyDigestArchive = archive;
    expect(domainArchive).toBe(archive);
  });

  it('reads byte-original owner-and-alias scoped documents from all four archives', async () => {
    seedArchive(fake);

    await expect(
      archive.readSnapshot({ userId: OWNER_ID, legacyGroupKey: GROUP_KEY })
    ).resolves.toEqual({
      digests: [
        {
          id: 'digest-a',
          data: ownedData({ date: '2026-07-01', nested: { privateValue: 'preserved-a' } }),
        },
        {
          id: 'digest-b',
          data: ownedData({ date: '2026-07-02', nested: { privateValue: 'preserved-b' } }),
        },
      ],
      states: [
        {
          id: 'state-a',
          data: ownedData({ date: '2026-07-02', state: { topics: ['preserved-topic'] } }),
        },
      ],
      locks: [
        {
          id: 'lock-a',
          data: ownedData({ expiresAt: '2026-07-28T03:00:00.000Z' }),
        },
      ],
      backfills: [
        {
          id: 'backfill-a',
          data: ownedData({ status: 'completed', completedDates: ['2026-07-02'] }),
        },
      ],
    });
  });

  it('never returns another owner or another alias', async () => {
    seedArchive(fake);

    const snapshot = await archive.readSnapshot({
      userId: 'synthetic-owner-foreign',
      legacyGroupKey: GROUP_KEY,
    });

    expect(snapshot.digests.map((document) => document.id)).toEqual(['digest-foreign']);
    expect(snapshot.states).toEqual([]);
    expect(snapshot.locks).toEqual([]);
    expect(snapshot.backfills).toEqual([]);
  });

  it('returns bounded deletion references in stable collection order and leaves WhatsApp source untouched', async () => {
    seedArchive(fake);
    fake.seedCollection('whatsapp_messages', [
      {
        id: 'source-message-a',
        data: { userId: OWNER_ID, chatId: 'source-chat-a', text: 'must remain' },
      },
    ]);

    const deletedCollections: string[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await (fake as unknown as Firestore).runTransaction(async (transaction) => {
        const batch = await archive.readOwnedDeletionBatch(transaction, {
          userId: OWNER_ID,
          legacyGroupKey: GROUP_KEY,
          limit: 1,
        });
        for (const document of batch.documents) transaction.delete(document.ref);
        return batch;
      });
      if (result.collection === null) break;
      deletedCollections.push(result.collection);
    }

    expect(deletedCollections).toEqual([
      LEGACY_DIGEST_ARCHIVE_COLLECTIONS.digests,
      LEGACY_DIGEST_ARCHIVE_COLLECTIONS.digests,
      LEGACY_DIGEST_ARCHIVE_COLLECTIONS.states,
      LEGACY_DIGEST_ARCHIVE_COLLECTIONS.locks,
      LEGACY_DIGEST_ARCHIVE_COLLECTIONS.backfills,
    ]);
    await expect(
      archive.readSnapshot({ userId: OWNER_ID, legacyGroupKey: GROUP_KEY })
    ).resolves.toEqual({ digests: [], states: [], locks: [], backfills: [] });
    expect(fake.getAllData().get('whatsapp_messages')?.get('source-message-a')).toEqual({
      userId: OWNER_ID,
      chatId: 'source-chat-a',
      text: 'must remain',
    });
    expect(fake.getAllData().get(LEGACY_DIGEST_ARCHIVE_COLLECTIONS.digests)?.size).toBe(2);
  });

  it('rejects unbounded or malformed owner selectors', async () => {
    await expect(
      archive.readSnapshot({ userId: '', legacyGroupKey: GROUP_KEY })
    ).rejects.toThrow('INVALID_LEGACY_ARCHIVE_SELECTOR');
    await expect(
      (fake as unknown as Firestore).runTransaction(async (transaction) =>
        archive.readOwnedDeletionBatch(transaction, {
          userId: OWNER_ID,
          legacyGroupKey: GROUP_KEY,
          limit: 101,
        })
      )
    ).rejects.toThrow('INVALID_LEGACY_ARCHIVE_LIMIT');
  });

  it('rejects an oversized or ownership-conflicting Firestore snapshot', async () => {
    const oversized = createFirestoreLegacyDigestArchive({
      firestore: firestoreReturning(
        Array.from({ length: 1_001 }, (_, index) => queryDocument(`oversized-${index}`, ownedData({})))
      ),
    });
    await expect(
      oversized.readSnapshot({ userId: OWNER_ID, legacyGroupKey: GROUP_KEY })
    ).rejects.toThrow('LEGACY_ARCHIVE_SNAPSHOT_TOO_LARGE');

    const ownershipConflict = createFirestoreLegacyDigestArchive({
      firestore: firestoreReturning([
        queryDocument('foreign-document', {
          userId: 'synthetic-owner-foreign',
          groupKey: GROUP_KEY,
        }),
      ]),
    });
    await expect(
      ownershipConflict.readSnapshot({ userId: OWNER_ID, legacyGroupKey: GROUP_KEY })
    ).rejects.toThrow('LEGACY_ARCHIVE_OWNERSHIP_CONFLICT');
  });
});

function firestoreReturning(documents: FirebaseFirestore.QueryDocumentSnapshot[]): Firestore {
  interface QueryStub {
    where(): QueryStub;
    limit(): QueryStub;
    get(): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[] }>;
  }
  const query: QueryStub = {
    where: (): typeof query => query,
    limit: (): typeof query => query,
    get: async (): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[] }> => ({
      docs: documents,
    }),
  };
  return {
    collection: (): typeof query => query,
  } as unknown as Firestore;
}

function queryDocument(
  id: string,
  data: Record<string, unknown>
): FirebaseFirestore.QueryDocumentSnapshot {
  return {
    id,
    data: () => data,
  } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
}

function seedArchive(fake: FakeFirestore): void {
  fake.seedCollection(LEGACY_DIGEST_ARCHIVE_COLLECTIONS.digests, [
    { id: 'digest-b', data: ownedData({ date: '2026-07-02', nested: { privateValue: 'preserved-b' } }) },
    { id: 'digest-a', data: ownedData({ date: '2026-07-01', nested: { privateValue: 'preserved-a' } }) },
    {
      id: 'digest-other-group',
      data: { ...ownedData({ date: '2026-07-01' }), groupKey: 'synthetic-other-group' },
    },
    {
      id: 'digest-foreign',
      data: { ...ownedData({ date: '2026-07-01' }), userId: 'synthetic-owner-foreign' },
    },
  ]);
  fake.seedCollection(LEGACY_DIGEST_ARCHIVE_COLLECTIONS.states, [
    {
      id: 'state-a',
      data: ownedData({ date: '2026-07-02', state: { topics: ['preserved-topic'] } }),
    },
  ]);
  fake.seedCollection(LEGACY_DIGEST_ARCHIVE_COLLECTIONS.locks, [
    {
      id: 'lock-a',
      data: ownedData({ expiresAt: '2026-07-28T03:00:00.000Z' }),
    },
  ]);
  fake.seedCollection(LEGACY_DIGEST_ARCHIVE_COLLECTIONS.backfills, [
    {
      id: 'backfill-a',
      data: ownedData({ status: 'completed', completedDates: ['2026-07-02'] }),
    },
  ]);
}

function ownedData(extra: Record<string, unknown>): Record<string, unknown> {
  return { userId: OWNER_ID, groupKey: GROUP_KEY, ...extra };
}
