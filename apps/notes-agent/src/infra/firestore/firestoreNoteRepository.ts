import type { Result } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { Note, CreateNoteInput, UpdateNoteInput } from '../../domain/models/note.js';
import type { NoteRepository, NoteError } from '../../domain/ports/noteRepository.js';

const COLLECTION = 'notes';

interface NoteDocument {
  userId: string;
  title: string;
  content: string;
  tags: string[];
  status: string;
  source: string;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
}

function toNote(id: string, doc: NoteDocument): Note {
  return {
    id,
    userId: doc.userId,
    title: doc.title,
    content: doc.content,
    tags: doc.tags,
    status: (doc.status || 'active') as Note['status'],
    source: doc.source,
    sourceId: doc.sourceId,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

export class FirestoreNoteRepository implements NoteRepository {
  async create(input: CreateNoteInput): Promise<Result<Note, NoteError>> {
    try {
      const db = getFirestore();
      const now = new Date();
      const docRef = db.collection(COLLECTION).doc();

      const document: NoteDocument = {
        userId: input.userId,
        title: input.title,
        content: input.content,
        tags: input.tags,
        status: input.status ?? 'active',
        source: input.source,
        sourceId: input.sourceId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      await docRef.set(document);

      return {
        ok: true,
        value: {
          id: docRef.id,
          ...input,
          status: input.status ?? 'active',
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to create note') },
      };
    }
  }

  async findById(id: string): Promise<Result<Note | null, NoteError>> {
    try {
      const db = getFirestore();
      const doc = await db.collection(COLLECTION).doc(id).get();

      if (!doc.exists) {
        return { ok: true, value: null };
      }

      return { ok: true, value: toNote(doc.id, doc.data() as NoteDocument) };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to find note') },
      };
    }
  }

  async findByUserId(userId: string): Promise<Result<Note[], NoteError>> {
    try {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .get();

      const notes = snapshot.docs.map((doc) => toNote(doc.id, doc.data() as NoteDocument));

      return { ok: true, value: notes };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to list notes') },
      };
    }
  }

  async update(id: string, input: UpdateNoteInput): Promise<Result<Note, NoteError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Note not found' } };
      }

      const now = new Date();
      const updateData: Partial<NoteDocument> & { updatedAt: string } = {
        updatedAt: now.toISOString(),
      };

      if (input.title !== undefined) {
        updateData.title = input.title;
      }
      if (input.content !== undefined) {
        updateData.content = input.content;
      }
      if (input.tags !== undefined) {
        updateData.tags = input.tags;
      }

      await docRef.update(updateData);

      const updated = await docRef.get();
      return { ok: true, value: toNote(updated.id, updated.data() as NoteDocument) };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to update note') },
      };
    }
  }

  async delete(id: string): Promise<Result<void, NoteError>> {
    try {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'Note not found' } };
      }

      await docRef.delete();
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'STORAGE_ERROR', message: getErrorMessage(error, 'Failed to delete note') },
      };
    }
  }
}
