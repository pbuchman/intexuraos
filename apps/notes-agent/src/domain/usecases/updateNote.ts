import type { Result } from '@intexuraos/common-core';
import type { Note, UpdateNoteInput } from '../models/note.js';
import type { NoteRepository, NoteError } from '../ports/noteRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface UpdateNoteDeps {
  noteRepository: NoteRepository;
  logger: MinimalLogger;
}

export async function updateNote(
  deps: UpdateNoteDeps,
  noteId: string,
  userId: string,
  input: UpdateNoteInput
): Promise<Result<Note, NoteError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ noteId, userId }, 'Updating note');

  const findResult = await deps.noteRepository.findById(noteId);

  if (!findResult.ok) {
    return findResult;
  }

  if (findResult.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Note not found' } };
  }

  if (findResult.value.userId !== userId) {
    deps.logger.warn({ noteId, userId, ownerId: findResult.value.userId }, 'Access denied to note');
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  const result = await deps.noteRepository.update(noteId, input);

  if (result.ok) {
    deps.logger.info({ noteId }, 'Note updated');
  }

  return result;
}
