import type { Result } from '@intexuraos/common-core';
import type { Note } from '../models/note.js';
import type { NoteRepository, NoteError } from '../ports/noteRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
}

export interface ListNotesDeps {
  noteRepository: NoteRepository;
  logger: MinimalLogger;
}

export async function listNotes(
  deps: ListNotesDeps,
  userId: string
): Promise<Result<Note[], NoteError>> {
  deps.logger.info({ userId }, 'Listing notes');

  const result = await deps.noteRepository.findByUserId(userId);

  if (result.ok) {
    deps.logger.info({ userId, count: result.value.length }, 'Notes listed');
  }

  return result;
}
