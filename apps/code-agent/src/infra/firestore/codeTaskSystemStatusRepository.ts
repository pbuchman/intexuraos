import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  CodeTaskSystemStatus,
  UpsertCodeTaskSystemStatusInput,
} from '../../domain/models/codeTaskSystemStatus.js';
import type {
  CodeTaskSystemStatusRepository,
  CodeTaskSystemStatusRepositoryError,
  ResolveCodeTaskSystemStatusesInput,
} from '../../domain/repositories/codeTaskSystemStatusRepository.js';
import type { CodeTaskDispatchBlockerReason } from '../../domain/services/codeTaskDispatchBlockers.js';

const COLLECTION_NAME = 'code_task_system_statuses';
const COMPONENT = 'code-task-dispatch';

interface CodeTaskSystemStatusDoc {
  userId: string;
  component: 'code-task-dispatch';
  status: 'active' | 'resolved';
  severity: 'warning' | 'critical';
  workerType: string;
  reason: CodeTaskDispatchBlockerReason;
  message: string;
  remediation: string;
  affectedTaskCount: number;
  exampleTaskIds: string[];
  workerNames: string[];
  firstSeenAt: Timestamp | Date | string;
  lastSeenAt: Timestamp | Date | string;
  resolvedAt?: Timestamp | Date | string;
  lastNotifiedAt?: Timestamp | Date | string;
}

export function buildCodeTaskSystemStatusId(
  userId: string,
  workerType: string,
  reason: CodeTaskDispatchBlockerReason,
): string {
  return `${COMPONENT}__${encodeURIComponent(userId)}__${encodeURIComponent(workerType)}__${reason}`;
}

function toDate(value: Timestamp | Date | string): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function deserializeStatus(id: string, data: CodeTaskSystemStatusDoc): CodeTaskSystemStatus {
  return {
    id,
    userId: data.userId,
    component: data.component,
    status: data.status,
    severity: data.severity,
    workerType: data.workerType,
    reason: data.reason,
    message: data.message,
    remediation: data.remediation,
    affectedTaskCount: data.affectedTaskCount,
    exampleTaskIds: data.exampleTaskIds,
    workerNames: data.workerNames,
    firstSeenAt: toDate(data.firstSeenAt),
    lastSeenAt: toDate(data.lastSeenAt),
    ...(data.resolvedAt !== undefined && { resolvedAt: toDate(data.resolvedAt) }),
    ...(data.lastNotifiedAt !== undefined && { lastNotifiedAt: toDate(data.lastNotifiedAt) }),
  };
}

export function createFirestoreCodeTaskSystemStatusRepository(deps: {
  readonly firestore: Firestore;
  readonly logger: Logger;
}): CodeTaskSystemStatusRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async upsertActive(
      input: UpsertCodeTaskSystemStatusInput,
    ): Promise<Result<CodeTaskSystemStatus, CodeTaskSystemStatusRepositoryError>> {
      try {
        const id = buildCodeTaskSystemStatusId(input.userId, input.workerType, input.reason);
        const docRef = collection.doc(id);
        const now = new Date();
        const data = await firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(collection.where('userId', '==', input.userId));
          const existing = snapshot.docs.find((doc) => doc.id === id);
          const existingData = existing?.data() as CodeTaskSystemStatusDoc | undefined;
          const firstSeenAt = existingData?.status === 'active'
            ? toDate(existingData.firstSeenAt)
            : now;
          const lastNotifiedAt = existingData?.lastNotifiedAt;

          const nextData: CodeTaskSystemStatusDoc = {
            userId: input.userId,
            component: COMPONENT,
            status: 'active',
            severity: input.severity,
            workerType: input.workerType,
            reason: input.reason,
            message: input.message,
            remediation: input.remediation,
            affectedTaskCount: input.affectedTaskCount,
            exampleTaskIds: [...input.exampleTaskIds],
            workerNames: [...input.workerNames],
            firstSeenAt: Timestamp.fromDate(firstSeenAt),
            lastSeenAt: Timestamp.fromDate(now),
            ...(lastNotifiedAt !== undefined && { lastNotifiedAt }),
          };
          const resolvedAt = Timestamp.fromDate(now);
          for (const statusDoc of snapshot.docs) {
            const statusData = statusDoc.data() as CodeTaskSystemStatusDoc;
            if (
              statusDoc.id !== id
              && statusData.status === 'active'
              && statusData.workerType === input.workerType
            ) {
              transaction.update(statusDoc.ref, {
                status: 'resolved',
                resolvedAt,
                lastSeenAt: resolvedAt,
              });
            }
          }
          transaction.set(docRef, nextData);
          return nextData;
        });

        return ok(deserializeStatus(id, data));
      } catch (error) {
        logger.error({ error }, 'Failed to upsert code task system status');
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Unknown error') });
      }
    },

    async listActiveForUser(
      userId: string,
    ): Promise<Result<CodeTaskSystemStatus[], CodeTaskSystemStatusRepositoryError>> {
      try {
        const snapshot = await collection.where('userId', '==', userId).get();
        const statuses = snapshot.docs
          .map((doc) => deserializeStatus(doc.id, doc.data() as CodeTaskSystemStatusDoc))
          .filter((status) => status.status === 'active')
          .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime());

        return ok(statuses);
      } catch (error) {
        logger.error({ error, userId }, 'Failed to list active code task system statuses');
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Unknown error') });
      }
    },

    async resolveActive(
      input: ResolveCodeTaskSystemStatusesInput,
    ): Promise<Result<number, CodeTaskSystemStatusRepositoryError>> {
      try {
        const reasons = new Set(input.reasons ?? []);
        const shouldResolveReason: (reason: CodeTaskDispatchBlockerReason) => boolean = reasons.size === 0
          ? (): boolean => true
          : (reason: CodeTaskDispatchBlockerReason): boolean => reasons.has(reason);
        const now = Timestamp.fromDate(new Date());
        const resolvedCount = await firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(collection.where('userId', '==', input.userId));
          let count = 0;

          for (const doc of snapshot.docs) {
            const data = doc.data() as CodeTaskSystemStatusDoc;
            if (
              data.status === 'active'
              && data.workerType === input.workerType
              && shouldResolveReason(data.reason)
              && (
                input.observedBefore === undefined
                || toDate(data.lastSeenAt).getTime() <= input.observedBefore.getTime()
              )
            ) {
              transaction.update(doc.ref, {
                status: 'resolved',
                resolvedAt: now,
                lastSeenAt: now,
              });
              count += 1;
            }
          }
          return count;
        });

        return ok(resolvedCount);
      } catch (error) {
        logger.error({ error, input }, 'Failed to resolve code task system statuses');
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Unknown error') });
      }
    },

    async markNotified(
      id: string,
      notifiedAt: Date,
    ): Promise<Result<void, CodeTaskSystemStatusRepositoryError>> {
      try {
        await collection.doc(id).update({
          lastNotifiedAt: Timestamp.fromDate(notifiedAt),
        });
        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, 'Failed to mark code task system status notified');
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error, 'Unknown error') });
      }
    },
  };
}
