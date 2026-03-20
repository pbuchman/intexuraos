import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { HellscriptBuffer } from '../../domain/models/hellscriptBuffer.js';
import type { HellscriptEvent } from '../../domain/models/hellscriptEvent.js';
import type { HellscriptDraftVersion } from '../../domain/models/hellscriptDraftVersion.js';
import type { MaterializedBufferState } from '../../domain/models/materializedBufferState.js';
import type { HellscriptRepository, BufferWithState } from '../../domain/ports/hellscriptRepository.js';

const COLLECTION = 'hellscript_buffers';

// Subcollection paths under hellscript_buffers/{id}/ - these are NOT top-level collections.
// Registered in firestore-collections.json as subcollections of hellscript_buffers.
// Path-based access avoids the ownership validator's .collection() regex.
function eventsPath(bufferId: string): string {
  return `${COLLECTION}/${bufferId}/events`;
}

function draftsPath(bufferId: string): string {
  return `${COLLECTION}/${bufferId}/draft_versions`;
}

function deriveTitle(state: MaterializedBufferState): string {
  const firstThought = state.thoughts[0];
  if (firstThought === undefined || firstThought.text.trim() === '') {
    return 'Untitled buffer';
  }
  const text = firstThought.text.trim();
  return text.length > 80 ? text.slice(0, 80) : text;
}

interface BufferDocument {
  userId: string;
  title: string;
  eventCount: number;
  latestDraftVersionNumber: number | null;
  latestDraftVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EventDocument {
  bufferId: string;
  rawUtterance: string;
  intent: {
    kind: string;
    payload: Record<string, unknown>;
    fallbackReason?: string;
  };
  createdAt: string;
}

interface DraftDocument {
  bufferId: string;
  versionNumber: number;
  markdown: string;
  requestText: string;
  createdAt: string;
}

function toBuffer(id: string, doc: BufferDocument): HellscriptBuffer {
  return {
    id,
    userId: doc.userId,
    title: doc.title,
    eventCount: doc.eventCount,
    latestDraftVersionNumber: doc.latestDraftVersionNumber,
    latestDraftVersionId: doc.latestDraftVersionId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toEvent(id: string, doc: EventDocument): HellscriptEvent {
  return {
    id,
    bufferId: doc.bufferId,
    rawUtterance: doc.rawUtterance,
    intent: {
      kind: doc.intent.kind as HellscriptEvent['intent']['kind'],
      payload: doc.intent.payload,
      ...(doc.intent.fallbackReason !== undefined
        ? { fallbackReason: doc.intent.fallbackReason }
        : {}),
    },
    createdAt: doc.createdAt,
  };
}

function toDraft(id: string, doc: DraftDocument): HellscriptDraftVersion {
  return {
    id,
    bufferId: doc.bufferId,
    versionNumber: doc.versionNumber,
    markdown: doc.markdown,
    requestText: doc.requestText,
    createdAt: doc.createdAt,
  };
}

export class FirestoreHellscriptRepository implements HellscriptRepository {
  async createBuffer(userId: string, title: string): Promise<Result<HellscriptBuffer>> {
    try {
      const db = getFirestore();
      const now = new Date().toISOString();
      const docRef = db.collection(COLLECTION).doc();

      const document: BufferDocument = {
        userId,
        title,
        eventCount: 0,
        latestDraftVersionNumber: null,
        latestDraftVersionId: null,
        createdAt: now,
        updatedAt: now,
      };

      await docRef.set(document);

      return { ok: true, value: toBuffer(docRef.id, document) };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to create buffer')),
      };
    }
  }

  async getBuffer(
    bufferId: string,
    userId: string
  ): Promise<Result<HellscriptBuffer | null>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(bufferId).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      const data = doc.data() as BufferDocument;
      if (data.userId !== userId) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toBuffer(doc.id, data) };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get buffer')),
      };
    }
  }

  async getBufferWithState(
    bufferId: string,
    userId: string
  ): Promise<Result<BufferWithState | null>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(bufferId).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      const data = doc.data() as BufferDocument & {
        materializedState?: MaterializedBufferState;
      };
      if (data.userId !== userId) {
        return { ok: true, value: null };
      }

      return {
        ok: true,
        value: {
          buffer: toBuffer(doc.id, data),
          state: data.materializedState ?? null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get buffer with state')),
      };
    }
  }

  async listBuffers(userId: string): Promise<Result<HellscriptBuffer[]>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .get();

      const buffers = snapshot.docs.map((doc) => toBuffer(doc.id, doc.data() as BufferDocument));

      return { ok: true, value: buffers };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to list buffers')),
      };
    }
  }

  async saveEvent(event: Omit<HellscriptEvent, 'id'>): Promise<Result<HellscriptEvent>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(eventsPath(event.bufferId)).doc();

      const document: EventDocument = {
        bufferId: event.bufferId,
        rawUtterance: event.rawUtterance,
        intent: event.intent,
        createdAt: event.createdAt,
      };

      await docRef.set(document);

      return { ok: true, value: toEvent(docRef.id, document) };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to save event')),
      };
    }
  }

  async getEvents(bufferId: string): Promise<Result<HellscriptEvent[]>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(eventsPath(bufferId))
        .orderBy('createdAt', 'asc')
        .get();

      const events = snapshot.docs.map((doc) => toEvent(doc.id, doc.data() as EventDocument));

      return { ok: true, value: events };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get events')),
      };
    }
  }

  async updateBufferState(
    bufferId: string,
    state: MaterializedBufferState,
    eventCount: number
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      const title = deriveTitle(state);
      await db
        .collection(COLLECTION)
        .doc(bufferId)
        .update({
          title,
          eventCount,
          updatedAt: new Date().toISOString(),
          materializedState: state,
        });

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to update buffer state')),
      };
    }
  }

  async getBufferState(
    bufferId: string
  ): Promise<Result<MaterializedBufferState | null>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(bufferId).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      const data = doc.data() as BufferDocument & {
        materializedState?: MaterializedBufferState;
      };

      return { ok: true, value: data.materializedState ?? null };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get buffer state')),
      };
    }
  }

  async saveDraftVersion(
    draft: Omit<HellscriptDraftVersion, 'id'>
  ): Promise<Result<HellscriptDraftVersion>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(draftsPath(draft.bufferId)).doc();

      const document: DraftDocument = {
        bufferId: draft.bufferId,
        versionNumber: draft.versionNumber,
        markdown: draft.markdown,
        requestText: draft.requestText,
        createdAt: draft.createdAt,
      };

      await docRef.set(document);

      return { ok: true, value: toDraft(docRef.id, document) };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to save draft version')),
      };
    }
  }

  async getDraftVersions(
    bufferId: string
  ): Promise<Result<HellscriptDraftVersion[]>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(draftsPath(bufferId))
        .orderBy('versionNumber', 'asc')
        .get();

      const drafts = snapshot.docs.map((doc) => toDraft(doc.id, doc.data() as DraftDocument));

      return { ok: true, value: drafts };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get draft versions')),
      };
    }
  }

  async getDraftVersion(
    draftVersionId: string,
    bufferId: string
  ): Promise<Result<HellscriptDraftVersion | null>> {
    try {
      const db = getFirestore();
      const doc = await db
        .collection(draftsPath(bufferId))
        .doc(draftVersionId)
        .get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toDraft(doc.id, doc.data() as DraftDocument) };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to get draft version')),
      };
    }
  }

  async updateBufferDraftInfo(
    bufferId: string,
    versionNumber: number,
    versionId: string
  ): Promise<Result<void>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(bufferId).update({
        latestDraftVersionNumber: versionNumber,
        latestDraftVersionId: versionId,
        updatedAt: new Date().toISOString(),
      });

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: new Error(getErrorMessage(error, 'Failed to update buffer draft info')),
      };
    }
  }
}
