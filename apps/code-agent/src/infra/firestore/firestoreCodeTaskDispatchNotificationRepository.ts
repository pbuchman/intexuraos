import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore, withSchemaVersion } from '@intexuraos/infra-firestore';
import type {
  CodeTaskDispatchNotificationRepository,
  CodeTaskDispatchNotificationRepositoryError,
  ReserveDispatchNotificationInput,
  ReserveDispatchNotificationResult,
} from '../../domain/repositories/codeTaskDispatchNotificationRepository.js';

const COLLECTION = 'code_task_dispatch_notifications';

function notificationId(input: ReserveDispatchNotificationInput): string {
  return `${input.taskId}:${input.channel}:${input.reason}:${input.phase}`;
}

export interface FirestoreCodeTaskDispatchNotificationRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreCodeTaskDispatchNotificationRepository implements CodeTaskDispatchNotificationRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreCodeTaskDispatchNotificationRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async reserve(
    input: ReserveDispatchNotificationInput
  ): Promise<Result<ReserveDispatchNotificationResult, CodeTaskDispatchNotificationRepositoryError>> {
    const id = notificationId(input);
    try {
      const reserved = await this.firestore.runTransaction(async (transaction) => {
        const ref = this.firestore.collection(COLLECTION).doc(id);
        const snapshot = await transaction.get(ref);
        const now = Timestamp.fromDate(new Date());
        if (snapshot.exists) {
          const data = snapshot.data();
          if (data?.['status'] === 'delivered' || data?.['status'] === 'reserved') {
            return false;
          }
          transaction.set(ref, withSchemaVersion({
            ...data,
            status: 'reserved',
            /* v8 ignore start -- upstream: repository-created notification records always set attempts; nullish fallback supports legacy records @preserve */
            attempts: Number(data?.['attempts'] ?? 0) + 1,
            /* v8 ignore stop @preserve */
            updatedAt: now,
            lastError: null,
          }, 1));
          return true;
        }

        transaction.set(ref, withSchemaVersion({
          id,
          taskId: input.taskId,
          channel: input.channel,
          reason: input.reason,
          phase: input.phase,
          status: 'reserved',
          attempts: 1,
          createdAt: now,
          updatedAt: now,
        }, 1));
        return true;
      });
      return ok({ reserved, id });
    } catch (error) {
      this.logger.warn({ id, error: getErrorMessage(error) }, 'Failed to reserve dispatch notification');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async markDelivered(id: string): Promise<Result<void, CodeTaskDispatchNotificationRepositoryError>> {
    return await this.updateStatus(id, { status: 'delivered', lastError: null });
  }

  async markFailed(id: string, error: string): Promise<Result<void, CodeTaskDispatchNotificationRepositoryError>> {
    return await this.updateStatus(id, { status: 'failed', lastError: error });
  }

  private async updateStatus(
    id: string,
    fields: { status: 'delivered' | 'failed'; lastError: string | null }
  ): Promise<Result<void, CodeTaskDispatchNotificationRepositoryError>> {
    try {
      await this.firestore.collection(COLLECTION).doc(id).set(withSchemaVersion({
        ...fields,
        updatedAt: Timestamp.fromDate(new Date()),
      }, 1), { merge: true });
      return ok(undefined);
    } catch (error) {
      this.logger.warn({ id, error: getErrorMessage(error) }, 'Failed to update dispatch notification status');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreCodeTaskDispatchNotificationRepository(
  deps: FirestoreCodeTaskDispatchNotificationRepositoryDeps
): CodeTaskDispatchNotificationRepository {
  return new FirestoreCodeTaskDispatchNotificationRepository(deps);
}
