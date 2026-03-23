import type { Logger } from 'pino';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CompleteGitHubEventLogEntryInput,
  CreatePendingGitHubEventLogEntryInput,
  GitHubEventLogEntry,
} from '../../domain/models/gitHubEventLogEntry.js';
import type { GitHubWebhookEventType } from '../../domain/models/gitHubWebhookTypes.js';
import type {
  GitHubEventLogEntryRepository,
  GitHubEventLogEntryRepositoryError,
} from '../../domain/repositories/gitHubEventLogEntryRepository.js';

const COLLECTION_NAME = 'github-event-log-entries';

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

function toEntry(
  id: string,
  data: Omit<GitHubEventLogEntry, 'id'> & {
    authPassedAt: unknown;
    updatedAt: unknown;
  },
): GitHubEventLogEntry {
  return {
    ...data,
    id,
    authPassedAt: toDate(data.authPassedAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function createFirestoreGitHubEventLogEntryRepository(deps: {
  logger: Logger;
}): GitHubEventLogEntryRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async createPending(
      input: CreatePendingGitHubEventLogEntryInput
    ): Promise<Result<GitHubEventLogEntry, GitHubEventLogEntryRepositoryError>> {
      try {
        await collection.doc(input.id).set({
          ...input,
          decisionId: null,
        });

        return ok({
          ...input,
          decisionId: null,
        });
      } catch (error) {
        logger.error({ error, input }, 'Failed to create pending GitHub event log entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async complete(
      input: CompleteGitHubEventLogEntryInput
    ): Promise<Result<GitHubEventLogEntry, GitHubEventLogEntryRepositoryError>> {
      try {
        const docRef = collection.doc(input.id);
        await docRef.update({
          decisionId: input.decisionId,
          decisionState: input.decisionState,
          decisionOutcome: input.decisionOutcome,
          updatedAt: input.updatedAt,
          rowVersion: input.rowVersion,
        });

        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          return err({
            code: 'FIRESTORE_ERROR',
            message: `Missing GitHub event log entry: ${input.id}`,
          });
        }

        const data = snapshot.data() as Omit<GitHubEventLogEntry, 'id'> & {
          authPassedAt: unknown;
          updatedAt: unknown;
        };

        return ok(toEntry(snapshot.id, data));
      } catch (error) {
        logger.error({ error, input }, 'Failed to complete GitHub event log entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async listRecent(options: {
      limit: number;
      cursor?: string;
      eventTypes?: readonly GitHubWebhookEventType[];
    }): Promise<
      Result<{
        entries: GitHubEventLogEntry[];
        nextCursor?: string;
      }, GitHubEventLogEntryRepositoryError>
    > {
      try {
        let query = collection.orderBy('authPassedAt', 'desc');
        if (options.eventTypes !== undefined && options.eventTypes.length > 0) {
          query = query.where('eventType', 'in', [...options.eventTypes]);
        }
        if (options.cursor !== undefined) {
          const cursorDate = new Date(options.cursor);
          if (!Number.isNaN(cursorDate.getTime())) {
            query = query.startAfter(cursorDate);
          }
        }

        const snapshot = await query.limit(options.limit + 1).get();
        const docs = snapshot.docs;
        const hasMore = docs.length > options.limit;
        const resultDocs = hasMore ? docs.slice(0, options.limit) : docs;
        const entries = resultDocs.map((doc) => {
          const data = doc.data() as Omit<GitHubEventLogEntry, 'id'> & {
            authPassedAt: unknown;
            updatedAt: unknown;
          };
          return toEntry(doc.id, data);
        });

        const output: {
          entries: GitHubEventLogEntry[];
          nextCursor?: string;
        } = {
          entries,
        };
        if (hasMore && entries.length > 0) {
          const lastEntry = entries[entries.length - 1];
          /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard — entries.length > 0 guarantees last element defined @preserve */
          if (lastEntry !== undefined) {
            output.nextCursor = lastEntry.authPassedAt.toISOString();
          }
          /* v8 ignore stop @preserve */
        }

        return ok(output);
      } catch (error) {
        logger.error({ error, options }, 'Failed to list GitHub event log entries');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByIds(
      ids: string[]
    ): Promise<Result<GitHubEventLogEntry[], GitHubEventLogEntryRepositoryError>> {
      try {
        const snapshots = await Promise.all(ids.map((id) => collection.doc(id).get()));
        const entries: GitHubEventLogEntry[] = [];

        for (const snapshot of snapshots) {
          if (!snapshot.exists) {
            continue;
          }

          const data = snapshot.data() as Omit<GitHubEventLogEntry, 'id'> & {
            authPassedAt: unknown;
            updatedAt: unknown;
          };
          entries.push(toEntry(snapshot.id, data));
        }

        return ok(entries);
      } catch (error) {
        logger.error({ error, ids }, 'Failed to load GitHub event log entries by id');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
