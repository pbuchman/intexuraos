import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, FileText, Plus } from 'lucide-react';
import { Button, Card, ErrorBanner, Layout } from '@/components';
import { useNotes } from '@/hooks';
import type { Note } from '@/types';
import { NoteModal } from '@/components/notes/NoteModal.js';
import { CreateNoteModal } from '@/components/notes/CreateNoteModal.js';
import { NoteRow } from '@/components/notes/NoteRow.js';

// Sort options
export type NoteSortOption = 'updated' | 'created' | 'title';
export const NOTE_SORT_OPTIONS: { key: NoteSortOption; label: string }[] = [
  { key: 'updated', label: 'Updated' },
  { key: 'created', label: 'Created' },
  { key: 'title', label: 'Title' },
];

function getStoredTagFilter(): Set<string> {
  try {
    const stored = localStorage.getItem('notes-tag-filter');
    if (stored !== null) {
      const parsed = JSON.parse(stored) as string[];
      return new Set(parsed);
    }
  } catch {
    // Corrupted localStorage data — fall back to defaults
  }
  return new Set<string>();
}

function getStoredSort(): NoteSortOption {
  try {
    const stored = localStorage.getItem('notes-sort');
    if (stored === 'updated' || stored === 'created' || stored === 'title') return stored;
  } catch {
    // Corrupted localStorage data — fall back to defaults
  }
  return 'updated';
}

const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

export function NotesListPage(): React.JSX.Element {
  const { notes, loading, error, createNote, updateNote, deleteNote } = useNotes();
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTags, setSelectedTags] = useState<Set<string>>(getStoredTagFilter);
  const [sort, setSort] = useState<NoteSortOption>(getStoredSort);

  // Deep link: auto-open modal when ?id= is present
  useEffect(() => {
    const noteId = searchParams.get('id');
    if (noteId !== null && notes.length > 0) {
      const note = notes.find((n) => n.id === noteId);
      if (note !== undefined) {
        setSelectedNote(note);
        setSearchParams({}, { replace: true });
      }
    }
  }, [notes, searchParams, setSearchParams]);

  // Extract all unique tags from notes
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [notes]);

  // Toggle tag selection — empty set means "show all"
  const toggleTag = (): void => {
    setSelectedTags(new Set<string>());
    localStorage.setItem('notes-tag-filter', JSON.stringify([]));
  };

  // Toggle specific tag
  const toggleSpecificTag = (tag: string): void => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      // Persist to localStorage
      localStorage.setItem('notes-tag-filter', JSON.stringify([...next]));
      return next;
    });
  };

  // Is a tag active?
  const isTagActive = (tag: string): boolean => {
    if (selectedTags.size === 0) return true; // All selected by default
    return selectedTags.has(tag);
  };

  // Handle sort change
  const handleSortChange = (s: NoteSortOption): void => {
    setSort(s);
    localStorage.setItem('notes-sort', s);
  };

  // Filter and sort notes
  const filteredSortedNotes = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (selectedTags.size === 0) return true;
      return note.tags.some((tag) => selectedTags.has(tag));
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'updated') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sort === 'created') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return a.title.localeCompare(b.title);
    });
  }, [notes, selectedTags, sort]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* R1 Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">My Notes</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{notes.length} notes</p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            setShowCreateModal(true);
          }}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Note</span>
        </Button>
      </div>

      {/* ErrorBanner */}
      <ErrorBanner message={error} className="mb-6" />

      {/* Tag Filter Pills */}
      {allTags.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={(): void => { toggleTag(); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selectedTags.size === 0 ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400' : INACTIVE_CLASS
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            All
            <span className="font-medium">{String(notes.length)}</span>
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={(): void => { toggleSpecificTag(tag); }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isTagActive(tag) ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400' : INACTIVE_CLASS
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              {tag}
              <span className="font-medium">
                {String(notes.filter((n) => n.tags.includes(tag)).length)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Sort Selector */}
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
        <div className="flex gap-1.5">
          {NOTE_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => { handleSortChange(key); }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                sort === key
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes List */}
      {filteredSortedNotes.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">No notes yet</h3>
            <p className="mb-4 text-slate-500 dark:text-slate-400">Create your first note to get started.</p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                setShowCreateModal(true);
              }}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Note</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-1">
          {filteredSortedNotes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onSelect={(n): void => { setSelectedNote(n); }}
              onDelete={async (noteId): Promise<void> => {
                await deleteNote(noteId);
              }}
            />
          ))}
        </div>
      )}

      {/* Note Modal */}
      {selectedNote !== null ? (
        <NoteModal
          note={selectedNote}
          onClose={(): void => {
            setSelectedNote(null);
          }}
          onUpdate={async (request): Promise<void> => {
            const updated = await updateNote(selectedNote.id, request);
            setSelectedNote(updated);
          }}
          onDelete={async (): Promise<void> => {
            await deleteNote(selectedNote.id);
          }}
        />
      ) : null}

      {/* Create Note Modal */}
      {showCreateModal ? (
        <CreateNoteModal
          onClose={(): void => {
            setShowCreateModal(false);
          }}
          onCreate={async (title, content, tags): Promise<void> => {
            await createNote({
              title,
              content,
              tags,
              source: 'web',
              sourceId: `web-${String(Date.now())}`,
            });
          }}
        />
      ) : null}
    </Layout>
  );
}
