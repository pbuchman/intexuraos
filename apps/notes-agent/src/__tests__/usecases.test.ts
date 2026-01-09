import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { FakeNoteRepository } from './fakeNoteRepository.js';
import { createNote } from '../domain/usecases/createNote.js';
import { getNote } from '../domain/usecases/getNote.js';
import { listNotes } from '../domain/usecases/listNotes.js';
import { updateNote } from '../domain/usecases/updateNote.js';
import { deleteNote } from '../domain/usecases/deleteNote.js';

const logger = pino({ level: 'silent' });

describe('Use Cases', () => {
  let fakeRepo: FakeNoteRepository;

  beforeEach(() => {
    fakeRepo = new FakeNoteRepository();
  });

  describe('createNote', () => {
    it('creates a note successfully', async () => {
      const result = await createNote(
        { noteRepository: fakeRepo, logger },
        {
          userId: 'user-1',
          title: 'Test',
          content: 'Content',
          tags: ['tag1'],
          source: 'test',
          sourceId: 'src-1',
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test');
        expect(result.value.userId).toBe('user-1');
      }
    });

    it('returns error when repository fails', async () => {
      fakeRepo.simulateNextError({ code: 'STORAGE_ERROR', message: 'Database error' });
      const result = await createNote(
        { noteRepository: fakeRepo, logger },
        {
          userId: 'user-1',
          title: 'Test',
          content: 'Content',
          tags: [],
          source: 'test',
          sourceId: 'src-1',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('getNote', () => {
    it('returns note for owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Test',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await getNote({ noteRepository: fakeRepo, logger }, noteId, 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Test');
      }
    });

    it('returns FORBIDDEN for non-owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Test',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await getNote({ noteRepository: fakeRepo, logger }, noteId, 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns NOT_FOUND for non-existent note', async () => {
      const result = await getNote({ noteRepository: fakeRepo, logger }, 'non-existent', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error when repository fails', async () => {
      fakeRepo.simulateNextError({ code: 'STORAGE_ERROR', message: 'Database error' });
      const result = await getNote({ noteRepository: fakeRepo, logger }, 'any-id', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('listNotes', () => {
    it('lists notes for user', async () => {
      await fakeRepo.create({
        userId: 'user-1',
        title: 'Note 1',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });
      await fakeRepo.create({
        userId: 'user-1',
        title: 'Note 2',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-2',
      });
      await fakeRepo.create({
        userId: 'other-user',
        title: 'Other',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-3',
      });

      const result = await listNotes({ noteRepository: fakeRepo, logger }, 'user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }
    });

    it('returns error when repository fails', async () => {
      fakeRepo.simulateNextError({ code: 'STORAGE_ERROR', message: 'Database error' });
      const result = await listNotes({ noteRepository: fakeRepo, logger }, 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('updateNote', () => {
    it('updates note for owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Original',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await updateNote({ noteRepository: fakeRepo, logger }, noteId, 'user-1', {
        title: 'Updated',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Updated');
      }
    });

    it('returns FORBIDDEN for non-owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Original',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await updateNote({ noteRepository: fakeRepo, logger }, noteId, 'other-user', {
        title: 'Hacked',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns NOT_FOUND for non-existent note', async () => {
      const result = await updateNote(
        { noteRepository: fakeRepo, logger },
        'non-existent',
        'user-1',
        { title: 'Updated' }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error when repository findById fails', async () => {
      fakeRepo.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });
      const result = await updateNote({ noteRepository: fakeRepo, logger }, 'any-id', 'user-1', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });

    it('returns error when repository update fails', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Test',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      fakeRepo.simulateMethodError('update', { code: 'STORAGE_ERROR', message: 'Update failed' });
      const result = await updateNote({ noteRepository: fakeRepo, logger }, noteId, 'user-1', {
        title: 'Updated',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });
  });

  describe('deleteNote', () => {
    it('deletes note for owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'To Delete',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await deleteNote({ noteRepository: fakeRepo, logger }, noteId, 'user-1');

      expect(result.ok).toBe(true);

      const findResult = await fakeRepo.findById(noteId);
      expect(findResult.ok && findResult.value).toBeNull();
    });

    it('returns FORBIDDEN for non-owner', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Protected',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      const result = await deleteNote({ noteRepository: fakeRepo, logger }, noteId, 'other-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN');
      }
    });

    it('returns NOT_FOUND for non-existent note', async () => {
      const result = await deleteNote(
        { noteRepository: fakeRepo, logger },
        'non-existent',
        'user-1'
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns error when repository findById fails', async () => {
      fakeRepo.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });
      const result = await deleteNote({ noteRepository: fakeRepo, logger }, 'any-id', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });

    it('returns error when repository delete fails', async () => {
      const created = await fakeRepo.create({
        userId: 'user-1',
        title: 'Test',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';
      fakeRepo.simulateMethodError('delete', { code: 'STORAGE_ERROR', message: 'Delete failed' });
      const result = await deleteNote({ noteRepository: fakeRepo, logger }, noteId, 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('STORAGE_ERROR');
      }
    });
  });
});
