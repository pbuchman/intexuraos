/**
 * Firestore repository for tracking successfully processed calendar actions.
 * Uses actionId as document ID for natural idempotency and O(1) lookups.
 */

import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { ProcessedAction } from '../../domain/models.js';
import type { ProcessedActionRepository } from '../../domain/ports.js';
import type { CalendarError } from '../../domain/errors.js';

const COLLECTION = 'calendar_processed_actions';

interface ProcessedActionDocument {
  actionId: string;
  userId: string;
  eventId: string;
  resourceUrl: string;
  createdAt: string;
}

function toProcessedAction(doc: ProcessedActionDocument): ProcessedAction {
  return {
    actionId: doc.actionId,
    userId: doc.userId,
    eventId: doc.eventId,
    resourceUrl: doc.resourceUrl,
    createdAt: doc.createdAt,
  };
}

function toCalendarError(error: unknown, message: string): CalendarError {
  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, message),
  };
}

export async function getProcessedActionByActionId(
  actionId: string
): Promise<Result<ProcessedAction | null, CalendarError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(actionId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { ok: true, value: null };
    }

    return { ok: true, value: toProcessedAction(doc.data() as ProcessedActionDocument) };
  } catch (error) {
    return {
      ok: false,
      error: toCalendarError(error, 'Failed to get processed action'),
    };
  }
}

export async function createProcessedAction(input: {
  actionId: string;
  userId: string;
  eventId: string;
  resourceUrl: string;
}): Promise<Result<ProcessedAction, CalendarError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(input.actionId);
    const now = new Date().toISOString();

    const doc: ProcessedActionDocument = {
      actionId: input.actionId,
      userId: input.userId,
      eventId: input.eventId,
      resourceUrl: input.resourceUrl,
      createdAt: now,
    };

    await docRef.set(doc);

    return { ok: true, value: toProcessedAction(doc) };
  } catch (error) {
    return {
      ok: false,
      error: toCalendarError(error, 'Failed to save processed action'),
    };
  }
}

export function createProcessedActionRepository(): ProcessedActionRepository {
  return {
    getByActionId: getProcessedActionByActionId,
    create: createProcessedAction,
  };
}
