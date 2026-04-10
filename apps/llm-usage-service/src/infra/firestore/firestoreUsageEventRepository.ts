import { err, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import type { CreateEventResult, UsageEventRepository } from '../../domain/repositories/usageEventRepository.js';

const COLLECTION = 'llm_usage_events';

export class FirestoreUsageEventRepository implements UsageEventRepository {
  async createEvent(event: UsageEvent): Promise<Result<CreateEventResult, { code: string; message: string }>> {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(event.eventId);

    try {
      await docRef.create(event);
      return ok({ status: 'created' as const });
    } catch (error: unknown) {
      const firestoreError = error as { code?: number; message?: string };
      if (firestoreError.code === 6) {
        return ok({ status: 'duplicate' as const });
      }
      return err({
        code: String(firestoreError.code ?? 'UNKNOWN'),
        message: firestoreError.message ?? 'Unknown Firestore error',
      });
    }
  }
}
