import type { Logger } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CreateGitHubWebhookAuditEventInput,
  GitHubWebhookAuditEvent,
  UpdateGitHubWebhookAuditEventNormalizationStatusInput,
} from '../../domain/models/gitHubWebhookAuditEvent.js';
import type {
  GitHubWebhookAuditEventRepository,
  GitHubWebhookAuditEventRepositoryError,
} from '../../domain/repositories/gitHubWebhookAuditEventRepository.js';

const COLLECTION_NAME = 'github-webhook-audit-events';

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const timestamp = value as { toDate: () => Date };
    return timestamp.toDate();
  }
  return new Date(String(value));
}

function toAuditEvent(
  id: string,
  data: Omit<GitHubWebhookAuditEvent, 'id'> & {
    authPassedAt: unknown;
    receivedAt: unknown;
  },
): GitHubWebhookAuditEvent {
  return {
    ...data,
    id,
    authPassedAt: toDate(data.authPassedAt),
    receivedAt: toDate(data.receivedAt),
  };
}

export function createFirestoreGitHubWebhookAuditEventRepository(deps: {
  logger: Logger;
}): GitHubWebhookAuditEventRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  async function findByIds(
    ids: string[]
  ): Promise<Result<GitHubWebhookAuditEvent[], GitHubWebhookAuditEventRepositoryError>> {
    try {
      const snapshots = await Promise.all(ids.map((id) => collection.doc(id).get()));

      const events: GitHubWebhookAuditEvent[] = [];
      for (const snapshot of snapshots) {
        if (!snapshot.exists) {
          continue;
        }

        const data = snapshot.data() as Omit<GitHubWebhookAuditEvent, 'id'> & {
          authPassedAt: unknown;
          receivedAt: unknown;
        };
        events.push(toAuditEvent(snapshot.id, data));
      }

      return ok(events);
    } catch (error) {
      logger.error({ error, ids }, 'Failed to load GitHub webhook audit events');
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  return {
    async save(
      input: CreateGitHubWebhookAuditEventInput
    ): Promise<Result<GitHubWebhookAuditEvent, GitHubWebhookAuditEventRepositoryError>> {
      try {
        const docRef = collection.doc();
        await docRef.set(input);

        return ok({
          id: docRef.id,
          ...input,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to save GitHub webhook audit event');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async updateNormalizationStatus(
      input: UpdateGitHubWebhookAuditEventNormalizationStatusInput
    ): Promise<Result<GitHubWebhookAuditEvent, GitHubWebhookAuditEventRepositoryError>> {
      try {
        const docRef = collection.doc(input.id);
        await docRef.update({
          normalizationStatus: input.normalizationStatus,
        });

        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          return err({
            code: 'FIRESTORE_ERROR',
            message: `Missing GitHub webhook audit event: ${input.id}`,
          });
        }

        const data = snapshot.data() as Omit<GitHubWebhookAuditEvent, 'id'> & {
          authPassedAt: unknown;
          receivedAt: unknown;
        };

        return ok(toAuditEvent(snapshot.id, data));
      } catch (error) {
        logger.error({ error, input }, 'Failed to update GitHub webhook audit event normalization status');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    findByIds,
  };
}
