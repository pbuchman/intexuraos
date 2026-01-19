/**
 * Firestore repository for tracking successfully processed actions.
 * Provides idempotency for Linear issue creation.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { ProcessedAction, ProcessedActionRepository, LinearError } from '../../domain/index.js';

const COLLECTION_NAME = 'linear_processed_actions';

interface ProcessedActionDoc {
  actionId: string;
  userId: string;
  issueId: string;
  issueIdentifier: string;
  resourceUrl: string;
  createdAt: string;
}

function toProcessedAction(doc: ProcessedActionDoc): ProcessedAction {
  return {
    actionId: doc.actionId,
    userId: doc.userId,
    issueId: doc.issueId,
    issueIdentifier: doc.issueIdentifier,
    resourceUrl: doc.resourceUrl,
    createdAt: doc.createdAt,
  };
}

export async function getProcessedActionByActionId(
  actionId: string
): Promise<Result<ProcessedAction | null, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(actionId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return ok(null);
    }

    return ok(toProcessedAction(doc.data() as ProcessedActionDoc));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get processed action: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function createProcessedAction(input: {
  actionId: string;
  userId: string;
  issueId: string;
  issueIdentifier: string;
  resourceUrl: string;
}): Promise<Result<ProcessedAction, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(input.actionId);
    const now = new Date().toISOString();

    const doc: ProcessedActionDoc = {
      actionId: input.actionId,
      userId: input.userId,
      issueId: input.issueId,
      issueIdentifier: input.issueIdentifier,
      resourceUrl: input.resourceUrl,
      createdAt: now,
    };

    await docRef.set(doc);

    return ok(toProcessedAction(doc));
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to create processed action: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/** Factory for creating repository with interface */
export function createProcessedActionRepository(): ProcessedActionRepository {
  return {
    getByActionId: getProcessedActionByActionId,
    create: createProcessedAction,
  };
}
