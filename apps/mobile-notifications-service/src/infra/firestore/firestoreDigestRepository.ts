import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type {
  DigestRepository,
  PersistedDailySummary,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';
import type { DailySummary } from '../../domain/schemas/digestSchemas.js';

const logger = createAppLogger({ name: 'FirestoreDigestRepository' });
const COLLECTION = 'notification_daily_digests';

interface DigestDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly summary: DailySummary;
  readonly generation: number;
  readonly generatedAt: string;
  readonly modelId: string;
}

function docId(userId: string, groupKey: string, date: string): string {
  return `${userId}_${groupKey}_${date}`;
}

export class FirestoreDigestRepository implements DigestRepository {
  async save(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly summary: DailySummary;
    readonly modelId: string;
  }): Promise<Result<PersistedDailySummary, RepositoryError>> {
    try {
      const db = getFirestore();
      const id = docId(input.userId, input.groupKey, input.summary.date);
      const ref = db.collection(COLLECTION).doc(id);

      const persisted = await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        const generation = existing.exists ? (existing.data() as DigestDoc).generation + 1 : 1;
        const doc: DigestDoc = {
          userId: input.userId,
          groupKey: input.groupKey,
          date: input.summary.date,
          summary: input.summary,
          generation,
          generatedAt: new Date().toISOString(),
          modelId: input.modelId,
        };
        tx.set(ref, doc);
        return doc;
      });

      logger.info({ id, generation: persisted.generation }, 'Saved daily digest');
      return ok({
        summary: persisted.summary,
        generation: persisted.generation,
        generatedAt: persisted.generatedAt,
        modelId: persisted.modelId,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to save daily digest');
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'save failed') });
    }
  }

  async findByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<PersistedDailySummary | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey, input.date)).get();
      if (!snap.exists) return ok(null);
      const data = snap.data() as DigestDoc;
      return ok({
        summary: data.summary,
        generation: data.generation,
        generatedAt: data.generatedAt,
        modelId: data.modelId,
      });
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findByDate failed') });
    }
  }

  async findRecentByGroup(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly limit: number;
  }): Promise<Result<readonly PersistedDailySummary[], RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .orderBy('date', 'desc')
        .limit(input.limit)
        .get();
      const items = snap.docs.map((d) => {
        const data = d.data() as DigestDoc;
        return {
          summary: data.summary,
          generation: data.generation,
          generatedAt: data.generatedAt,
          modelId: data.modelId,
        };
      });
      return ok(items);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findRecentByGroup failed') });
    }
  }

  async findInRange(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<Result<{
    readonly items: readonly PersistedDailySummary[];
    readonly nextCursor?: string;
  }, RepositoryError>> {
    try {
      const db = getFirestore();
      let query: FirebaseFirestore.Query = db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .where('date', '>=', input.fromDate)
        .where('date', '<=', input.toDate)
        .orderBy('date', 'desc');

      if (input.cursor !== undefined) {
        query = query.startAfter(input.cursor);
      }
      const snap = await query.limit(input.limit + 1).get();
      const docs = snap.docs.slice(0, input.limit);
      const items = docs.map((d) => {
        const data = d.data() as DigestDoc;
        return {
          summary: data.summary,
          generation: data.generation,
          generatedAt: data.generatedAt,
          modelId: data.modelId,
        };
      });
      const result: { items: readonly PersistedDailySummary[]; nextCursor?: string } = { items };
      if (snap.docs.length > input.limit) {
        const lastDate = items[items.length - 1]?.summary.date;
        /* v8 ignore start -- ts-type: items.length === limit > 0 when snap.docs.length > limit, so lastDate is always defined @preserve */
        if (lastDate !== undefined) result.nextCursor = lastDate;
        /* v8 ignore stop @preserve */
      }
      return ok(result);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findInRange failed') });
    }
  }
}
