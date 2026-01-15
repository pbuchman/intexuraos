import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  FailedEvent,
  CreateFailedEventInput,
  FailedEventFilters,
} from '../../domain/models.js';
import type { FailedEventRepository } from '../../domain/ports.js';
import type { CalendarError } from '../../domain/errors.js';

const COLLECTION = 'calendar_failed_events';

interface FailedEventDocument {
  userId: string;
  actionId: string;
  originalText: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  error: string;
  reasoning: string;
  createdAt: string;
}

function toFailedEvent(id: string, doc: FailedEventDocument): FailedEvent {
  return {
    id,
    userId: doc.userId,
    actionId: doc.actionId,
    originalText: doc.originalText,
    summary: doc.summary,
    start: doc.start,
    end: doc.end,
    location: doc.location,
    description: doc.description,
    error: doc.error,
    reasoning: doc.reasoning,
    createdAt: new Date(doc.createdAt),
  };
}

function toFailedEventDocument(input: CreateFailedEventInput, now: Date): FailedEventDocument {
  return {
    userId: input.userId,
    actionId: input.actionId,
    originalText: input.originalText,
    summary: input.summary,
    start: input.start,
    end: input.end,
    location: input.location,
    description: input.description,
    error: input.error,
    reasoning: input.reasoning,
    createdAt: now.toISOString(),
  };
}

function toCalendarError(error: unknown, message: string): CalendarError {
  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, message),
  };
}

export class FirestoreFailedEventRepository implements FailedEventRepository {
  async create(input: CreateFailedEventInput): Promise<Result<FailedEvent, CalendarError>> {
    try {
      const db = getFirestore();
      const now = new Date();
      const docRef = db.collection(COLLECTION).doc();

      const failedEvent: FailedEvent = {
        id: docRef.id,
        userId: input.userId,
        actionId: input.actionId,
        originalText: input.originalText,
        summary: input.summary,
        start: input.start,
        end: input.end,
        location: input.location,
        description: input.description,
        error: input.error,
        reasoning: input.reasoning,
        createdAt: now,
      };

      await docRef.set(toFailedEventDocument(input, now));

      return { ok: true, value: failedEvent };
    } catch (error) {
      return {
        ok: false,
        error: toCalendarError(error, 'Failed to create failed event'),
      };
    }
  }

  async list(
    userId: string,
    filters?: FailedEventFilters
  ): Promise<Result<FailedEvent[], CalendarError>> {
    try {
      const db = getFirestore();
      const limit = filters?.limit ?? 10;

      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return { ok: true, value: snapshot.docs.map((doc) => toFailedEvent(doc.id, doc.data() as FailedEventDocument)) };
    } catch (error) {
      return {
        ok: false,
        error: toCalendarError(error, 'Failed to list failed events'),
      };
    }
  }

  async get(id: string): Promise<Result<FailedEvent | null, CalendarError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toFailedEvent(doc.id, doc.data() as FailedEventDocument) };
    } catch (error) {
      return {
        ok: false,
        error: toCalendarError(error, 'Failed to get failed event'),
      };
    }
  }

  async delete(id: string): Promise<Result<void, CalendarError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Failed event not found' } };
      }

      await docRef.delete();
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: toCalendarError(error, 'Failed to delete failed event'),
      };
    }
  }
}

export function createFailedEventRepository(): FailedEventRepository {
  return new FirestoreFailedEventRepository();
}
