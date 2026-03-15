/**
 * Firestore repository for PR automation comments.
 *
 * Doc ID: `${repository_safe}#${prNumber}` e.g. "pbuchman__intexuraos#42"
 * Stores one document per PR tracking the GitHub comment used for the unified automation log.
 */

import type { Logger } from 'pino';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { PRAutomationComment, PRAutomationCommentRepository } from '../../domain/ports/prAutomationCommentRepository.js';

export type { PRAutomationComment, PRAutomationCommentRepository };

const COLLECTION_NAME = 'pr_automation_comments';

function buildDocId(repository: string, prNumber: number): string {
  return `${repository.replace('/', '__')}#${String(prNumber)}`;
}

export function createFirestorePRAutomationCommentRepository(_deps: {
  logger: Logger;
}): PRAutomationCommentRepository {
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async get(repository: string, prNumber: number): Promise<PRAutomationComment | undefined> {
      const docId = buildDocId(repository, prNumber);
      const snapshot = await collection.doc(docId).get();

      if (!snapshot.exists) {
        return undefined;
      }

      const data = snapshot.data() as Record<string, unknown> | undefined;
      /* v8 ignore start -- test-infra: FakeFirestore cannot produce undefined data() when exists===true @preserve */
      if (data === undefined) {
        return undefined;
      }
      /* v8 ignore stop @preserve */

      return {
        repository: data['repository'] as string,
        prNumber: data['prNumber'] as number,
        commentId: data['commentId'] as number,
        tokenUserId: data['tokenUserId'] as string,
        eventCount: data['eventCount'] as number,
        createdAt: data['createdAt'] as string,
        updatedAt: data['updatedAt'] as string,
      };
    },

    async create(comment: PRAutomationComment): Promise<void> {
      const docId = buildDocId(comment.repository, comment.prNumber);
      const docRef = collection.doc(docId);

      await docRef.set({
        repository: comment.repository,
        prNumber: comment.prNumber,
        commentId: comment.commentId,
        tokenUserId: comment.tokenUserId,
        eventCount: comment.eventCount,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      });
    },

    async update(
      repository: string,
      prNumber: number,
      fields: { eventCount: number; updatedAt: string }
    ): Promise<void> {
      const docId = buildDocId(repository, prNumber);
      await collection.doc(docId).update({
        eventCount: fields.eventCount,
        updatedAt: fields.updatedAt,
      });
    },
  };
}
