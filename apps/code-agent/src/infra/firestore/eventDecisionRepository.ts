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
  };
}
