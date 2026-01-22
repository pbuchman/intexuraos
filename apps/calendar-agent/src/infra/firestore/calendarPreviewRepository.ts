/**
 * Firestore repository for calendar event previews.
 * Uses actionId as document ID for natural lookups and O(1) access.
 */

import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  CalendarPreview,
  CalendarPreviewStatus,
  CreateCalendarPreviewInput,
  UpdateCalendarPreviewInput,
} from '../../domain/models.js';
import type { CalendarPreviewRepository } from '../../domain/ports.js';
import type { CalendarError } from '../../domain/errors.js';

const COLLECTION = 'calendar_previews';

interface CalendarPreviewDocument {
  actionId: string;
  userId: string;
  status: CalendarPreviewStatus;
  summary?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
  duration?: string | null;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
  generatedAt: string;
}

function toCalendarPreview(doc: CalendarPreviewDocument): CalendarPreview {
  const preview: CalendarPreview = {
    actionId: doc.actionId,
    userId: doc.userId,
    status: doc.status,
    generatedAt: doc.generatedAt,
  };

  // Only add optional fields if they are defined
  if (doc.summary !== undefined) {
    preview.summary = doc.summary;
  }
  if (doc.start !== undefined) {
    preview.start = doc.start;
  }
  if (doc.end !== undefined) {
    preview.end = doc.end;
  }
  if (doc.location !== undefined) {
    preview.location = doc.location;
  }
  if (doc.description !== undefined) {
    preview.description = doc.description;
  }
  if (doc.duration !== undefined) {
    preview.duration = doc.duration;
  }
  if (doc.isAllDay !== undefined) {
    preview.isAllDay = doc.isAllDay;
  }
  if (doc.error !== undefined) {
    preview.error = doc.error;
  }
  if (doc.reasoning !== undefined) {
    preview.reasoning = doc.reasoning;
  }

  return preview;
}

function toCalendarError(error: unknown, message: string): CalendarError {
  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, message),
  };
}

export async function getCalendarPreviewByActionId(
  actionId: string
): Promise<Result<CalendarPreview | null, CalendarError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(actionId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { ok: true, value: null };
    }

    return { ok: true, value: toCalendarPreview(doc.data() as CalendarPreviewDocument) };
  } catch (error) {
    return {
      ok: false,
      error: toCalendarError(error, 'Failed to get calendar preview'),
    };
  }
}

export async function createCalendarPreview(
  input: CreateCalendarPreviewInput
): Promise<Result<CalendarPreview, CalendarError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(input.actionId);
    const now = new Date().toISOString();

    const doc: CalendarPreviewDocument = {
      actionId: input.actionId,
      userId: input.userId,
      status: input.status,
      generatedAt: now,
    };

    // Only add optional fields if they are present
    if (input.summary !== undefined) {
      doc.summary = input.summary;
    }
    if (input.start !== undefined) {
      doc.start = input.start;
    }
    if (input.end !== undefined) {
      doc.end = input.end;
    }
    if (input.location !== undefined) {
      doc.location = input.location;
    }
    if (input.description !== undefined) {
      doc.description = input.description;
    }
    if (input.duration !== undefined) {
      doc.duration = input.duration;
    }
    if (input.isAllDay !== undefined) {
      doc.isAllDay = input.isAllDay;
    }
    if (input.error !== undefined) {
      doc.error = input.error;
    }
    if (input.reasoning !== undefined) {
      doc.reasoning = input.reasoning;
    }

    await docRef.set(doc);

    return { ok: true, value: toCalendarPreview(doc) };
  } catch (error) {
    return {
      ok: false,
      error: toCalendarError(error, 'Failed to create calendar preview'),
    };
  }
}

export async function updateCalendarPreview(
  actionId: string,
  updates: UpdateCalendarPreviewInput
): Promise<Result<void, CalendarError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION).doc(actionId);

    // Build update object with only defined fields
    const updateData: Record<string, unknown> = {};

    if (updates.status !== undefined) {
      updateData['status'] = updates.status;
    }
    if (updates.summary !== undefined) {
      updateData['summary'] = updates.summary;
    }
    if (updates.start !== undefined) {
      updateData['start'] = updates.start;
    }
    if (updates.end !== undefined) {
      updateData['end'] = updates.end;
    }
    if (updates.location !== undefined) {
      updateData['location'] = updates.location;
    }
    if (updates.description !== undefined) {
      updateData['description'] = updates.description;
    }
    if (updates.duration !== undefined) {
      updateData['duration'] = updates.duration;
    }
    if (updates.isAllDay !== undefined) {
      updateData['isAllDay'] = updates.isAllDay;
    }
    if (updates.error !== undefined) {
      updateData['error'] = updates.error;
    }
    if (updates.reasoning !== undefined) {
      updateData['reasoning'] = updates.reasoning;
    }

    await docRef.update(updateData);

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: toCalendarError(error, 'Failed to update calendar preview'),
    };
  }
}

export function createCalendarPreviewRepository(): CalendarPreviewRepository {
  return {
    getByActionId: getCalendarPreviewByActionId,
    create: createCalendarPreview,
    update: updateCalendarPreview,
  };
}
