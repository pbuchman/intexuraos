import type { Firestore } from '@intexuraos/infra-firestore';
import type {
  LegacyDigestArchive,
  LegacyDigestArchiveDocument,
  LegacyDigestArchiveSnapshot,
} from '../../domain/ports/legacyDigestArchive.js';

export const LEGACY_DIGEST_ARCHIVE_COLLECTIONS = Object.freeze({
  digests: 'notification_daily_digests',
  states: 'notification_group_states',
  locks: 'notification_digest_locks',
  backfills: 'notification_digest_backfill_runs',
});

const ARCHIVE_ENTRIES = Object.entries(LEGACY_DIGEST_ARCHIVE_COLLECTIONS) as [
  keyof LegacyDigestArchiveSnapshot,
  string,
][];
const MAX_SNAPSHOT_DOCUMENTS_PER_COLLECTION = 1_000;

interface FirestoreLegacyDigestArchiveConfig {
  firestore: Firestore;
}

export class FirestoreLegacyDigestArchive implements LegacyDigestArchive {
  constructor(private readonly config: FirestoreLegacyDigestArchiveConfig) {}

  async readSnapshot(input: {
    userId: string;
    legacyGroupKey: string;
  }): Promise<LegacyDigestArchiveSnapshot> {
    assertSelector(input);
    const snapshots = await Promise.all(
      ARCHIVE_ENTRIES.map(async ([kind, collection]) => {
        const snapshot = await this.ownedQuery(collection, input)
          .limit(MAX_SNAPSHOT_DOCUMENTS_PER_COLLECTION + 1)
          .get();
        if (snapshot.docs.length > MAX_SNAPSHOT_DOCUMENTS_PER_COLLECTION) {
          throw new Error('LEGACY_ARCHIVE_SNAPSHOT_TOO_LARGE');
        }
        const documents = snapshot.docs
          .map((document) => parseOwnedDocument(document, input))
          .sort((left, right) => left.id.localeCompare(right.id));
        return [kind, documents] as const;
      })
    );
    return Object.fromEntries(snapshots) as unknown as LegacyDigestArchiveSnapshot;
  }

  async readOwnedDeletionBatch(
    transaction: FirebaseFirestore.Transaction,
    input: { userId: string; legacyGroupKey: string; limit: number }
  ): Promise<{
    collection: string | null;
    documents: { ref: FirebaseFirestore.DocumentReference }[];
  }> {
    assertSelector(input);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('INVALID_LEGACY_ARCHIVE_LIMIT');
    }
    for (const [, collection] of ARCHIVE_ENTRIES) {
      const snapshot = await transaction.get(this.ownedQuery(collection, input).limit(input.limit));
      if (snapshot.empty) continue;
      for (const document of snapshot.docs) parseOwnedDocument(document, input);
      return {
        collection,
        documents: snapshot.docs.map((document) => ({ ref: document.ref })),
      };
    }
    return { collection: null, documents: [] };
  }

  private ownedQuery(
    collection: string,
    input: { userId: string; legacyGroupKey: string }
  ): FirebaseFirestore.Query {
    return this.config.firestore
      .collection(collection)
      .where('userId', '==', input.userId)
      .where('groupKey', '==', input.legacyGroupKey);
  }
}

export function createFirestoreLegacyDigestArchive(
  config: FirestoreLegacyDigestArchiveConfig
): FirestoreLegacyDigestArchive {
  return new FirestoreLegacyDigestArchive(config);
}

function assertSelector(input: { userId: string; legacyGroupKey: string }): void {
  if (
    input.userId.trim() === '' ||
    input.userId.length > 256 ||
    input.legacyGroupKey.length < 1 ||
    input.legacyGroupKey.length > 200 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.legacyGroupKey)
  ) {
    throw new Error('INVALID_LEGACY_ARCHIVE_SELECTOR');
  }
}

function parseOwnedDocument(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  input: { userId: string; legacyGroupKey: string }
): LegacyDigestArchiveDocument {
  const data: unknown = document.data();
  if (
    !isRecord(data) ||
    data['userId'] !== input.userId ||
    data['groupKey'] !== input.legacyGroupKey
  ) {
    throw new Error('LEGACY_ARCHIVE_OWNERSHIP_CONFLICT');
  }
  return { id: document.id, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
