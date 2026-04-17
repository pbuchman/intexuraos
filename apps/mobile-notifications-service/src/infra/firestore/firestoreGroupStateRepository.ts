import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  GroupStateRepository,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';
import type { GroupState } from '../../domain/schemas/digestSchemas.js';

const COLLECTION = 'notification_group_states';
const MAX_RECENT_DATES = 30;

function docId(userId: string, groupKey: string, date: string): string {
  return `${userId}_${groupKey}_${date}`;
}

interface StateDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly state: GroupState;
}

function trimRecent(state: GroupState): GroupState {
  if (state.recentSummaryDates.length <= MAX_RECENT_DATES) return state;
  return {
    ...state,
    recentSummaryDates: state.recentSummaryDates.slice(-MAX_RECENT_DATES),
  };
}

export class FirestoreGroupStateRepository implements GroupStateRepository {
  async getByDate(input: { userId: string; groupKey: string; date: string }): Promise<Result<GroupState | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey, input.date)).get();
      if (!snap.exists) return ok(null);
      return ok((snap.data() as StateDoc).state);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'getByDate failed') });
    }
  }

  async getLatest(input: { userId: string; groupKey: string }): Promise<Result<GroupState | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .orderBy('date', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return ok(null);
      const doc = snap.docs[0];
      /* v8 ignore next -- ts-type: snap.empty=false guarantees length>=1 but noUncheckedIndexedAccess @preserve */
      if (doc === undefined) return ok(null);
      return ok((doc.data() as StateDoc).state);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'getLatest failed') });
    }
  }

  async save(input: { state: GroupState; date: string }): Promise<Result<void, RepositoryError>> {
    try {
      const trimmed = trimRecent(input.state);
      const db = getFirestore();
      const id = docId(input.state.userId, input.state.groupKey, input.date);
      const doc: StateDoc = {
        userId: input.state.userId,
        groupKey: input.state.groupKey,
        date: input.date,
        state: trimmed,
      };
      await db.collection(COLLECTION).doc(id).set(doc);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'save failed') });
    }
  }
}
