import type { Result } from '@intexuraos/common-core';
import type { Note, CreateNoteInput } from '../models/note.js';
import type { NoteRepository, NoteError } from '../ports/noteRepository.js';

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface CreateNoteDeps {
  noteRepository: NoteRepository;
  logger: MinimalLogger;
}

export async function createNote(
  deps: CreateNoteDeps,
  input: CreateNoteInput
): Promise<Result<Note, NoteError>> {
  deps.logger.info({ userId: input.userId, source: input.source }, 'Creating note');

  const result = await deps.noteRepository.create(input);

  if (result.ok) {
    deps.logger.info({ noteId: result.value.id }, 'Note created');
  } else {
    deps.logger.error({ error: result.error }, 'Failed to create note');
  }

  return result;
}
