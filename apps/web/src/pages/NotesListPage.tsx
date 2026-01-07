import { useState } from 'react';
import { Edit2, FileText, Plus, Tag, Trash2, X } from 'lucide-react';
import { Button, Card, Input, Layout } from '@/components';
import { useNotes } from '@/hooks';
import type { Note, UpdateNoteRequest } from '@/types';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}

interface NoteModalProps {
  note: Note;
  onClose: () => void;
  onUpdate: (request: UpdateNoteRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}

function NoteModal({ note, onClose, onUpdate, onDelete }: NoteModalProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await onUpdate({
        title,
        content,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = (): void => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags.join(', '));
    setIsEditing(false);
    setShowDeleteConfirm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Edit Note' : 'View Note'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {isEditing ? (
            <div className="space-y-4">
              <Input
                label="Title"
                value={title}
                onChange={(e): void => {
                  setTitle(e.target.value);
                }}
              />
              <div className="space-y-1">
                <label htmlFor="content" className="block text-sm font-medium text-slate-700">
                  Content
                </label>
                <textarea
                  id="content"
                  value={content}
                  onChange={(e): void => {
                    setContent(e.target.value);
                  }}
                  rows={8}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <Input
                label="Tags (comma separated)"
                value={tags}
                onChange={(e): void => {
                  setTags(e.target.value);
                }}
                placeholder="e.g., work, important, ideas"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-slate-900">{note.title}</h3>
              {note.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-all text-slate-700">{note.content}</div>
              <div className="text-xs text-slate-400">
                <span>Created: {formatDate(note.createdAt)}</span>
                <span className="mx-2">·</span>
                <span>Updated: {formatDate(note.updatedAt)}</span>
                <span className="mx-2">·</span>
                <span>Source: {note.source}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4">
          {showDeleteConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-600">Delete this note?</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={(): void => {
                  void handleDelete();
                }}
                disabled={deleting}
                isLoading={deleting}
              >
                Confirm
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={(): void => {
                  setShowDeleteConfirm(false);
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(true);
              }}
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          )}

          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button type="button" variant="secondary" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={(): void => {
                    void handleSave();
                  }}
                  disabled={saving}
                  isLoading={saving}
                >
                  Save
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={(): void => {
                  setIsEditing(true);
                }}
              >
                <Edit2 className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CreateNoteModalProps {
  onClose: () => void;
  onCreate: (title: string, content: string, tags: string[]) => Promise<void>;
}

function CreateNoteModal({ onClose, onCreate }: CreateNoteModalProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      await onCreate(title.trim(), content, parsedTags);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">Create New Note</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {error !== null ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-4">
            <Input
              label="Title"
              value={title}
              onChange={(e): void => {
                setTitle(e.target.value);
              }}
              placeholder="Enter note title"
            />
            <div className="space-y-1">
              <label htmlFor="create-content" className="block text-sm font-medium text-slate-700">
                Content
              </label>
              <textarea
                id="create-content"
                value={content}
                onChange={(e): void => {
                  setContent(e.target.value);
                }}
                rows={8}
                placeholder="Enter note content"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <Input
              label="Tags (comma separated)"
              value={tags}
              onChange={(e): void => {
                setTags(e.target.value);
              }}
              placeholder="e.g., work, important, ideas"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={(): void => {
              void handleCreate();
            }}
            disabled={saving}
            isLoading={saving}
          >
            Create Note
          </Button>
        </div>
      </div>
    </div>
  );
}

interface NoteRowProps {
  note: Note;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}

function NoteRow({ note, onOpen, onDelete }: NoteRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <button onClick={onOpen} className="flex-1 min-w-0 text-left" type="button">
          <h3 className="font-medium text-slate-900 hover:text-blue-600 transition-colors">
            {note.title}
          </h3>
          <p className="mt-1 text-sm text-slate-500 line-clamp-2">
            {truncateContent(note.content)}
          </p>
          {note.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </span>
              ))}
              {note.tags.length > 3 ? (
                <span className="text-xs text-slate-400">+{note.tags.length - 3} more</span>
              ) : null}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-slate-400">Updated {formatDate(note.updatedAt)}</p>
        </button>

        {!showDeleteConfirm ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              setShowDeleteConfirm(true);
            }}
            className="text-slate-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Delete "{note.title}"?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleDelete();
              }}
              disabled={isDeleting}
              isLoading={isDeleting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function NotesListPage(): React.JSX.Element {
  const { notes, loading, error, createNote, updateNote, deleteNote } = useNotes();
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Notes</h2>
          <p className="text-slate-600">Manage your personal notes.</p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            setShowCreateModal(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Note
        </Button>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {notes.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No notes yet</h3>
            <p className="mb-4 text-slate-500">Create your first note to get started.</p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                setShowCreateModal(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Note
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onOpen={(): void => {
                setSelectedNote(note);
              }}
              onDelete={async (): Promise<void> => {
                await deleteNote(note.id);
              }}
            />
          ))}
        </div>
      )}

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
