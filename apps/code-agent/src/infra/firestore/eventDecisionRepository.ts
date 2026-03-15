/**
 * Firestore repository for event decisions.
 */

import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type {
  EventDecision,
  CreateEventDecisionInput,
} from '../../domain/models/eventDecision.js';
import type {
  EventDecisionRepository,
  EventDecisionRepositoryError,
} from '../../domain/repositories/eventDecisionRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION_NAME = 'event_decisions';

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

export function createFirestoreEventDecisionRepository(deps: {
  logger: Logger;
}): EventDecisionRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async save(
      input: CreateEventDecisionInput
    ): Promise<Result<EventDecision, EventDecisionRepositoryError>> {
      try {
        const id = `ed_${input.eventId}`;
        const docRef = collection.doc(id);
        const now = new Date();

        const data = {
          eventId: input.eventId,
          ...(input.normalizedEventId !== undefined && { normalizedEventId: input.normalizedEventId }),
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          eventType: input.eventType,
          eventAction: input.eventAction,
          senderLogin: input.senderLogin,
          decidedBy: input.decidedBy,
          decision: input.decision,
          reason: input.reason,
          ...(input.dispatchAction !== undefined && { dispatchAction: input.dispatchAction }),
          ...(input.dispatchParams !== undefined && { dispatchParams: input.dispatchParams }),
          ...(input.llmModel !== undefined && { llmModel: input.llmModel }),
          ...(input.llmCostUsd !== undefined && { llmCostUsd: input.llmCostUsd }),
          ...(input.llmToolCalls !== undefined && { llmToolCalls: input.llmToolCalls }),
          ...(input.llmReasoning !== undefined && { llmReasoning: input.llmReasoning }),
          ...(input.dispatchSuccess !== undefined && { dispatchSuccess: input.dispatchSuccess }),
          ...(input.dispatchError !== undefined && { dispatchError: input.dispatchError }),
          createdAt: now,
          decisionLatencyMs: input.decisionLatencyMs,
        };

        await docRef.set(data);

        return ok({
          id,
          ...data,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to save event decision');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async existsByPRAndReason(
      repository: string,
      prNumber: number,
      reason: string,
      since: Date
    ): Promise<Result<boolean, EventDecisionRepositoryError>> {
      try {
        const snapshot = await collection
          .where('repository', '==', repository)
          .where('pullRequestNumber', '==', prNumber)
          .where('reason', '==', reason)
          .where('createdAt', '>', since)
          .limit(1)
          .get();

        return ok(!snapshot.empty);
      } catch (error) {
        logger.error({ error, repository, prNumber, reason }, 'Failed to check existing enforcement decision');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByEventIds(
      eventIds: string[]
    ): Promise<Result<EventDecision[], EventDecisionRepositoryError>> {
      try {
        const snapshots = await Promise.all(
          eventIds.map((eventId) => collection.doc(`ed_${eventId}`).get())
        );

        const decisions: EventDecision[] = [];
        for (const snapshot of snapshots) {
          if (!snapshot.exists) {
            continue;
          }

          const data = snapshot.data() as Omit<EventDecision, 'id'> & {
            createdAt: unknown;
          };

          decisions.push({
            ...data,
            id: snapshot.id,
            createdAt: toDate(data.createdAt),
          });
        }

        return ok(decisions);
      } catch (error) {
        logger.error({ error, eventIds }, 'Failed to load event decisions by event ids');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
