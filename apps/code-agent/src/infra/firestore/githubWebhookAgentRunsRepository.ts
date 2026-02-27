import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import { WebhookAgentRunRecordSchema } from '../../domain/githubWebhookAgent/models.js';
import type { WebhookAgentRunRecord } from '../../domain/githubWebhookAgent/models.js';
import { getFirestore } from '@intexuraos/infra-firestore';

export type RunsRepositoryError =
  | { code: 'VALIDATION_ERROR'; message: string }
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface GithubWebhookAgentRunsRepository {
  upsert(record: WebhookAgentRunRecord): Promise<Result<void, RunsRepositoryError>>;
  findByRunId(runId: string): Promise<Result<WebhookAgentRunRecord | null, RunsRepositoryError>>;
  findBySavedEventId(savedEventId: string): Promise<Result<WebhookAgentRunRecord[], RunsRepositoryError>>;
}

const COLLECTION_NAME = 'github-webhook-agent-runs';

export function createGithubWebhookAgentRunsRepository(deps: {
  logger: Logger;
}): GithubWebhookAgentRunsRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async upsert(record): Promise<Result<void, RunsRepositoryError>> {
      const parsed = WebhookAgentRunRecordSchema.safeParse(record);
      if (!parsed.success) {
        return err({
          code: 'VALIDATION_ERROR',
          message: parsed.error.message,
        });
      }

      try {
        const docRef = collection.doc(parsed.data.runId);
        await docRef.set(parsed.data, { merge: true });
        return ok(undefined);
      } catch (error) {
        logger.error({ error, runId: record.runId }, 'Failed to upsert webhook agent run record');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByRunId(runId): Promise<Result<WebhookAgentRunRecord | null, RunsRepositoryError>> {
      try {
        const docRef = collection.doc(runId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
          return ok(null);
        }

        return ok(snapshot.data() as WebhookAgentRunRecord);
      } catch (error) {
        logger.error({ error, runId }, 'Failed to read webhook agent run record');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findBySavedEventId(savedEventId): Promise<Result<WebhookAgentRunRecord[], RunsRepositoryError>> {
      try {
        const query = collection
          .where('savedEventId', '==', savedEventId)
          .orderBy('startedAt', 'desc')
          .limit(10);

        const snapshot = await query.get();

        const records: WebhookAgentRunRecord[] = snapshot.docs.map(
          (doc) => doc.data() as WebhookAgentRunRecord
        );

        return ok(records);
      } catch (error) {
        logger.error({ error, savedEventId }, 'Failed to find runs by saved event id');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
