import { randomUUID } from 'crypto';
import type { Result } from '@intexuraos/common-core';
import type { Note, CreateNoteInput, UpdateNoteInput } from '../domain/models/note.js';
import type { NoteRepository, NoteError } from '../domain/ports/noteRepository.js';

type MethodName = 'create' | 'findById' | 'findByUserId' | 'update' | 'delete';

export class FakeNoteRepository implements NoteRepository {
  private notes = new Map<string, Note>();
  private nextError: NoteError | null = null;
  private methodErrors = new Map<MethodName, NoteError>();

  simulateNextError(error: NoteError): void {
    this.nextError = error;
  }

  simulateMethodError(method: MethodName, error: NoteError): void {
    this.methodErrors.set(method, error);
  }

  private checkError(method: MethodName): NoteError | null {
    const methodError = this.methodErrors.get(method);
    if (methodError !== undefined) {
      this.methodErrors.delete(method);
      return methodError;
    }
    const error = this.nextError;
    this.nextError = null;
    return error;
  }

  create(input: CreateNoteInput): Promise<Result<Note, NoteError>> {
    const error = this.checkError('create');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const now = new Date();
    const note: Note = {
      id: randomUUID(),
      ...input,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.notes.set(note.id, note);
    return Promise.resolve({ ok: true, value: note });
  }

  findById(id: string): Promise<Result<Note | null, NoteError>> {
    const error = this.checkError('findById');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const note = this.notes.get(id);
    return Promise.resolve({ ok: true, value: note ?? null });
  }

  findByUserId(userId: string): Promise<Result<Note[], NoteError>> {
    const error = this.checkError('findByUserId');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const userNotes = Array.from(this.notes.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return Promise.resolve({ ok: true, value: userNotes });
  }

  update(id: string, input: UpdateNoteInput): Promise<Result<Note, NoteError>> {
    const error = this.checkError('update');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    const existing = this.notes.get(id);
    if (existing === undefined) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Note not found' },
      });
    }

    const updated: Note = {
      ...existing,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.tags !== undefined && { tags: input.tags }),
      updatedAt: new Date(),
    };

    this.notes.set(id, updated);
    return Promise.resolve({ ok: true, value: updated });
  }

  delete(id: string): Promise<Result<void, NoteError>> {
    const error = this.checkError('delete');
    if (error !== null) {
      return Promise.resolve({ ok: false, error });
    }
    if (!this.notes.has(id)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Note not found' },
      });
    }

    this.notes.delete(id);
    return Promise.resolve({ ok: true, value: undefined });
  }

  clear(): void {
    this.notes.clear();
  }

  getAll(): Note[] {
    return Array.from(this.notes.values());
  }
}
