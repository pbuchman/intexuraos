import type { Result } from '@intexuraos/common-core';
import type { NoteRepository, NoteError } from '../ports/noteRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface DeleteNoteDeps {
  noteRepository: NoteRepository;
  logger: MinimalLogger;
}

export async function deleteNote(
  deps: DeleteNoteDeps,
  noteId: string,
  userId: string
): Promise<Result<void, NoteError | { code: 'FORBIDDEN'; message: string }>> {
  deps.logger.info({ noteId, userId }, 'Deleting note');

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

  const result = await deps.noteRepository.delete(noteId);

  if (result.ok) {
    deps.logger.info({ noteId }, 'Note deleted');
  }

  return result;
}
