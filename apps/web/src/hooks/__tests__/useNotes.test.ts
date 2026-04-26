/**
 * Tests for useNotes hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Note } from '@/types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mocks.getAccessToken } => ({
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/notesApi', () => ({
  listNotes: mocks.listNotes,
  createNote: mocks.createNote,
  updateNote: mocks.updateNote,
  deleteNote: mocks.deleteNote,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string =>
    err instanceof Error ? err.message : defaultMsg,
}));

import { useNotes } from '../useNotes.js';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    userId: 'u',
    title: `Note ${id}`,
    content: 'body',
    tags: [],
    source: 'manual',
    sourceId: 's',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
    ...overrides,
  };
}

describe('useNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue('tok');
  });

  it('happy path: loads notes on mount', async () => {
    const notes = [makeNote('1'), makeNote('2')];
    mocks.listNotes.mockResolvedValue(notes);

    const { result } = renderHook(() => useNotes());

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.notes).toEqual(notes);
    expect(mocks.listNotes).toHaveBeenCalledWith('tok');
  });

  it('error path: surfaces error', async () => {
    mocks.listNotes.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useNotes());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe('network down');
    expect(result.current.notes).toEqual([]);
  });

  it('createNote prepends, updateNote replaces, deleteNote removes', async () => {
    mocks.listNotes.mockResolvedValue([makeNote('1'), makeNote('2')]);
    mocks.createNote.mockResolvedValue(makeNote('3'));
    mocks.updateNote.mockResolvedValue(makeNote('1', { title: 'updated' }));
    mocks.deleteNote.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.createNote({
        title: 'new', content: 'c', tags: [], source: 'manual', sourceId: 's',
      });
    });
    expect(result.current.notes.map((n) => n.id)).toEqual(['3', '1', '2']);

    await act(async () => {
      await result.current.updateNote('1', { title: 'updated' });
    });
    expect(result.current.notes.find((n) => n.id === '1')?.title).toBe('updated');

    await act(async () => {
      await result.current.deleteNote('2');
    });
    expect(result.current.notes.map((n) => n.id)).toEqual(['3', '1']);
  });

  it('refresh re-invokes listNotes', async () => {
    mocks.listNotes.mockResolvedValue([]);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(mocks.listNotes).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh(false);
    });

    expect(mocks.listNotes).toHaveBeenCalledTimes(2);
  });
});
