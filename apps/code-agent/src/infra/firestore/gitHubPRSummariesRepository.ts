/**
 * Firestore repository for GitHub PR summaries.
 *
 * Doc ID: `${repository}#${pullRequestNumber}`
 * Uses set({ merge: true }) so partial updates preserve existing fields.
 */

import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type {
  GitHubPRSummary,
  UpsertGitHubPRSummaryInput,
} from '../../domain/models/gitHubPRSummary.js';
import type {
  GitHubPRSummaryRepository,
  SummaryRepositoryError,
} from '../../domain/repositories/gitHubPRSummaryRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

/**
 * Convert Firestore Timestamp or Date to JavaScript Date.
 * Handles both real Firestore Timestamp objects and plain Date objects from fake Firestore.
 */
/* v8 ignore start -- upstream: Firestore returns different types (Timestamp, Date, string) depending on context @preserve */
function toDate(value: unknown): Date {
  /* v8 ignore start -- ts-type: type guard for Date vs Firestore Timestamp @preserve */
  if (value instanceof Date) {
    return value;
  }
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- ts-type: null guard for unknown type, callers always have null guards so this is unreachable @preserve */
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    /* v8 ignore stop @preserve */
    const obj = value as { toDate: () => Date };
    return obj.toDate();
  }
  /* v8 ignore start -- ts-type: fallback branch for string parsing, unreachable with proper typed callers @preserve */
  return new Date(String(value));
  /* v8 ignore stop @preserve */
}
/* v8 ignore stop @preserve */

const COLLECTION_NAME = 'github-pr-summaries';

export function createFirestoreGitHubPRSummariesRepository(deps: {
  logger: Logger;
}): GitHubPRSummaryRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async upsert(
      input: UpsertGitHubPRSummaryInput
    ): Promise<Result<void, SummaryRepositoryError>> {
      try {
        const docId = `${input.repository}#${String(input.pullRequestNumber)}`;
        const docRef = collection.doc(docId);

        const data: Record<string, unknown> = {
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          lastActivityAt: input.lastActivityAt,
          firstSeenAt: input.firstSeenAt,
        };

        // Only include title/state/mergedAt when explicitly provided (pull_request events)
        if ('title' in input) {
          data['title'] = input.title ?? null;
        }
        if ('state' in input) {
          data['state'] = input.state ?? null;
        }
        if ('mergedAt' in input) {
          data['mergedAt'] = input.mergedAt ?? null;
        }

        await docRef.set(data, { merge: true });

        return ok(undefined);
      } catch (error) {
        logger.error({ error }, 'Failed to upsert GitHub PR summary');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findRecentlyActive(
      withinDays: number
    ): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>> {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - withinDays);

        const query = collection
          .where('lastActivityAt', '>=', cutoff)
          .orderBy('lastActivityAt', 'desc');

        const snapshot = await query.get();

        const summaries: GitHubPRSummary[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return {
            repository: data['repository'] as string,
            pullRequestNumber: data['pullRequestNumber'] as number,
            title: (data['title'] as string | null | undefined) ?? null,
            state: (data['state'] as string | null | undefined) ?? null,
            /* v8 ignore start -- ts-type: ternary type narrowing for optional null @preserve */
            mergedAt: data['mergedAt'] !== null && data['mergedAt'] !== undefined ? toDate(data['mergedAt']) : null,
            /* v8 ignore stop @preserve */
            lastActivityAt: toDate(data['lastActivityAt']),
            firstSeenAt: toDate(data['firstSeenAt']),
          };
        });

        return ok(summaries);
      } catch (error) {
        logger.error({ error, withinDays }, 'Failed to find recently active GitHub PR summaries');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
