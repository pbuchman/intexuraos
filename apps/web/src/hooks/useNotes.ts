import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createNote as createNoteApi,
  deleteNote as deleteNoteApi,
  listNotes as listNotesApi,
  updateNote as updateNoteApi,
} from '@/services/notesApi';
import type { CreateNoteRequest, Note, UpdateNoteRequest } from '@/types';

interface UseNotesResult {
  notes: Note[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createNote: (request: CreateNoteRequest) => Promise<Note>;
  updateNote: (id: string, request: UpdateNoteRequest) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
}

export function useNotes(): UseNotesResult {
  const { getAccessToken } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listNotesApi(token);
      setNotes(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load notes'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createNote = useCallback(
    async (request: CreateNoteRequest): Promise<Note> => {
      const token = await getAccessToken();
      const newNote = await createNoteApi(token, request);
      setNotes((prev) => [newNote, ...prev]);
      return newNote;
    },
    [getAccessToken]
  );

  const updateNote = useCallback(
    async (id: string, request: UpdateNoteRequest): Promise<Note> => {
      const token = await getAccessToken();
      const updated = await updateNoteApi(token, id, request);
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      return updated;
    },
    [getAccessToken]
  );

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteNoteApi(token, id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    },
    [getAccessToken]
  );

  return {
    notes,
    loading,
    error,
    refresh,
    createNote,
    updateNote,
    deleteNote,
  };
}
