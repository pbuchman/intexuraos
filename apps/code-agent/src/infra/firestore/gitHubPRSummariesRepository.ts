/**
 * Firestore repository for GitHub PR summaries.
 *
 * Doc ID: `${repository.replace('/', '__')}#${pullRequestNumber}`
 * Slash in repository is replaced with '__' since '/' is Firestore's path separator.
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
function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const obj = value as { toDate: () => Date };
    return obj.toDate();
  }
  return new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value !== null && value !== undefined ? toDate(value) : null;
}

function mapSummaryData(data: Record<string, unknown>): GitHubPRSummary {
  return {
    repository: data['repository'] as string,
    pullRequestNumber: data['pullRequestNumber'] as number,
    title: (data['title'] as string | null | undefined) ?? null,
    state: (data['state'] as string | null | undefined) ?? null,
    mergedAt: toNullableDate(data['mergedAt']),
    baseBranch: (data['baseBranch'] as string | null | undefined) ?? null,
    authorLogin: (data['authorLogin'] as string | null | undefined) ?? null,
    headBranch: (data['headBranch'] as string | null | undefined) ?? null,
    mergeConflictStatus: (data['mergeConflictStatus'] as GitHubPRSummary['mergeConflictStatus'] | undefined) ?? null,
    lastConflictCheckedAt: toNullableDate(data['lastConflictCheckedAt']),
    conflictEpisodeStartedAt: toNullableDate(data['conflictEpisodeStartedAt']),
    conflictResolvedAt: toNullableDate(data['conflictResolvedAt']),
    managedConflictCommentId: (data['managedConflictCommentId'] as number | null | undefined) ?? null,
    managedConflictTaskId: (data['managedConflictTaskId'] as string | null | undefined) ?? null,
    managedConflictTaskOwnerUserId: (data['managedConflictTaskOwnerUserId'] as string | null | undefined) ?? null,
    lastActivityAt: toDate(data['lastActivityAt']),
    firstSeenAt: toDate(data['firstSeenAt']),
    lastReviewedCommitSha: (data['lastReviewedCommitSha'] as string | null | undefined) ?? null,
    lastReviewNeedsRemediation: (data['lastReviewNeedsRemediation'] as string | null | undefined) ?? null,
  };
}

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
        const docId = `${input.repository.replace('/', '__')}#${String(input.pullRequestNumber)}`;
        const docRef = collection.doc(docId);

        const data: Record<string, unknown> = {
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          lastActivityAt: input.lastActivityAt,
        };

        if (input.firstSeenAt !== undefined) {
          data['firstSeenAt'] = input.firstSeenAt;
        }

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
        if ('baseBranch' in input) {
          data['baseBranch'] = input.baseBranch ?? null;
        }
        if ('authorLogin' in input) {
          data['authorLogin'] = input.authorLogin ?? null;
        }
        if ('headBranch' in input) {
          data['headBranch'] = input.headBranch ?? null;
        }
        if ('mergeConflictStatus' in input) {
          data['mergeConflictStatus'] = input.mergeConflictStatus ?? null;
        }
        if ('lastConflictCheckedAt' in input) {
          data['lastConflictCheckedAt'] = input.lastConflictCheckedAt ?? null;
        }
        if ('conflictEpisodeStartedAt' in input) {
          data['conflictEpisodeStartedAt'] = input.conflictEpisodeStartedAt ?? null;
        }
        if ('conflictResolvedAt' in input) {
          data['conflictResolvedAt'] = input.conflictResolvedAt ?? null;
        }
        if ('managedConflictCommentId' in input) {
          data['managedConflictCommentId'] = input.managedConflictCommentId ?? null;
        }
        if ('managedConflictTaskId' in input) {
          data['managedConflictTaskId'] = input.managedConflictTaskId ?? null;
        }
        if ('managedConflictTaskOwnerUserId' in input) {
          data['managedConflictTaskOwnerUserId'] = input.managedConflictTaskOwnerUserId ?? null;
        }
        if ('lastReviewedCommitSha' in input) {
          data['lastReviewedCommitSha'] = input.lastReviewedCommitSha ?? null;
        }
        if ('lastReviewNeedsRemediation' in input) {
          data['lastReviewNeedsRemediation'] = input.lastReviewNeedsRemediation ?? null;
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

        const summaries: GitHubPRSummary[] = snapshot.docs.map((doc) => mapSummaryData(doc.data() as Record<string, unknown>));

        return ok(summaries);
      } catch (error) {
        logger.error({ error, withinDays }, 'Failed to find recently active GitHub PR summaries');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByPullRequest(
      repository: string,
      pullRequestNumber: number
    ): Promise<Result<GitHubPRSummary | null, SummaryRepositoryError>> {
      try {
        const docId = `${repository.replace('/', '__')}#${String(pullRequestNumber)}`;
        const snapshot = await collection.doc(docId).get();

        if (!snapshot.exists) {
          return ok(null);
        }

        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (data === undefined) {
          return ok(null);
        }

        return ok(mapSummaryData(data));
      } catch (error) {
        logger.error({ error, repository, pullRequestNumber }, 'Failed to find GitHub PR summary by PR');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findOpenByBaseBranch(
      repository: string,
      baseBranch: string
    ): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>> {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('state', '==', 'open')
          .where('baseBranch', '==', baseBranch)
          .get();

        return ok(
          snapshot.docs.map((doc) => mapSummaryData(doc.data() as Record<string, unknown>))
        );
      } catch (error) {
        logger.error({ error, repository, baseBranch }, 'Failed to find open GitHub PR summaries by base branch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findOpenByRepository(
      repository: string
    ): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>> {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('state', '==', 'open')
          .get();

        return ok(
          snapshot.docs.map((doc) => mapSummaryData(doc.data() as Record<string, unknown>))
        );
      } catch (error) {
        logger.error({ error, repository }, 'Failed to find open GitHub PR summaries by repository');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findAllOpen(): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>> {
      // No pagination limit — expected to be bounded by the number of active repos and open PRs
      // in a single IntexuraOS deployment. Add a limit + cursor if this grows beyond ~500 rows.
      try {
        const snapshot = await collection
          .where('state', '==', 'open')
          .get();

        return ok(
          snapshot.docs.map((doc) => mapSummaryData(doc.data() as Record<string, unknown>))
        );
      } catch (error) {
        logger.error({ error }, 'Failed to find all open GitHub PR summaries');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
