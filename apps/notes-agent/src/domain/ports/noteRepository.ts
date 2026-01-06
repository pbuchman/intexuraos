import type { Result } from '@intexuraos/common-core';
import type { Note, CreateNoteInput, UpdateNoteInput } from '../models/note.js';

export type NoteErrorCode = 'NOT_FOUND' | 'STORAGE_ERROR';

export interface NoteError {
  code: NoteErrorCode;
  message: string;
}

export interface NoteRepository {
  create(input: CreateNoteInput): Promise<Result<Note, NoteError>>;
  findById(id: string): Promise<Result<Note | null, NoteError>>;
  findByUserId(userId: string): Promise<Result<Note[], NoteError>>;
  update(id: string, input: UpdateNoteInput): Promise<Result<Note, NoteError>>;
  delete(id: string): Promise<Result<void, NoteError>>;
}
