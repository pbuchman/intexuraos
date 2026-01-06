import type { Result } from '@intexuraos/common-core';
import type { Note } from '../models/note.js';
import type { NoteRepository, NoteError } from '../ports/noteRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface GetNoteDeps {
  noteRepository: NoteRepository;
  logger: MinimalLogger;
}

export async function getNote(
  deps: GetNoteDeps,
  noteId: string,
  userId: string
): Promise<Result<Note, NoteError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ noteId, userId }, 'Getting note');

  const result = await deps.noteRepository.findById(noteId);

  if (!result.ok) {
    return result;
  }

  if (result.value === null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Note not found' } };
  }

  if (result.value.userId !== userId) {
    deps.logger.warn({ noteId, userId, ownerId: result.value.userId }, 'Access denied to note');
    return { ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } };
  }

  return { ok: true, value: result.value };
}
