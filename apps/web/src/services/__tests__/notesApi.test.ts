/**
 * Tests for notesApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  deleteNote,
} from '../notesApi.js';
import type { Note } from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    notesAgentUrl: 'https://notes.test',
  },
}));

const TOKEN = 'tok';

const sampleNote: Note = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Hello',
  content: 'World',
  tags: ['tag-a'],
  source: 'manual',
  sourceId: 'src-1',
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T00:00:00Z',
};

describe('notesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listNotes (happy path)', () => {
    it('GETs /notes and returns the parsed array', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue([sampleNote]);

      const result = await listNotes(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://notes.test');
      expect(call?.[1]).toBe('/');
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toEqual([sampleNote]);
    });
  });

  describe('createNote (happy path)', () => {
    it('POSTs the create request body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleNote);

      const request = {
        title: 'Hello',
        content: 'World',
        tags: ['tag-a'],
        source: 'manual',
        sourceId: 'src-1',
      };
      const result = await createNote(TOKEN, request);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/');
      expect(call?.[3]).toEqual({ method: 'POST', body: request });
      expect(result).toBe(sampleNote);
    });
  });

  describe('getNote', () => {
    it('GETs /notes/:id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleNote);

      const result = await getNote(TOKEN, 'note-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/note-1');
      expect(result).toBe(sampleNote);
    });
  });

  describe('updateNote', () => {
    it('PATCHes /notes/:id with body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const updated: Note = { ...sampleNote, title: 'New title' };
      vi.mocked(apiRequest).mockResolvedValue(updated);

      const result = await updateNote(TOKEN, 'note-1', { title: 'New title' });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/note-1');
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { title: 'New title' } });
      expect(result).toBe(updated);
    });
  });

  describe('deleteNote (error path propagates)', () => {
    it('DELETEs /notes/:id', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      await deleteNote(TOKEN, 'note-1');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/note-1');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });

    it('propagates errors thrown by apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const err = new Error('boom');
      vi.mocked(apiRequest).mockRejectedValue(err);

      await expect(listNotes(TOKEN)).rejects.toThrow('boom');
    });
  });
});
