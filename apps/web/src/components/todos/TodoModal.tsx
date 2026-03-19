import { useState } from 'react';
import {
  Archive,
  Ban,
  Calendar,
  Edit2,
  Link2,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, ErrorBanner, Input } from '@/components';
import { PriorityBadge, StatusBadge } from '@/components/todos/shared.js';
import { TodoItemRow } from '@/components/todos/TodoItemRow.js';
import { formatDate, formatDateForInput } from '@/utils/dateFormat.js';
import { sortTodoItems } from '@/utils/todoItemSort.js';
import type {
  CreateTodoItemRequest,
  Todo,
  TodoPriority,
  UpdateTodoItemRequest,
  UpdateTodoRequest,
} from '@/types';

export interface TodoModalProps {
  todo: Todo;
  onClose: () => void;
  onUpdate: (request: UpdateTodoRequest) => Promise<Todo>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<Todo>;
  onUnarchive: () => Promise<Todo>;
  onCancel: () => Promise<Todo>;
  onAddItem: (request: CreateTodoItemRequest) => Promise<Todo>;
  onUpdateItem: (itemId: string, request: UpdateTodoItemRequest) => Promise<Todo>;
  onDeleteItem: (itemId: string) => Promise<Todo>;
}

export function TodoModal({
  todo,
  onClose,
  onUpdate,
  onDelete,
  onArchive,
  onUnarchive,
  onCancel,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: TodoModalProps): React.JSX.Element {
  const [currentTodo, setCurrentTodo] = useState(todo);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? '');
  const [tags, setTags] = useState(todo.tags.join(', '));
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [dueDate, setDueDate] = useState(formatDateForInput(todo.dueDate));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await onUpdate({
        title,
        description: description !== '' ? description : null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
        priority,
        dueDate: dueDate !== '' ? new Date(dueDate).toISOString() : null,
      });
      setCurrentTodo(updated);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save todo');
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

  const handleArchive = async (): Promise<void> => {
    setArchiving(true);
    setError(null);
    try {
      const updated = currentTodo.archived ? await onUnarchive() : await onArchive();
      setCurrentTodo(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive todo');
    } finally {
      setArchiving(false);
    }
  };

  const handleCancelTodo = async (): Promise<void> => {
    setCancelling(true);
    setError(null);
    try {
      const updated = await onCancel();
      setCurrentTodo(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel todo');
    } finally {
      setCancelling(false);
    }
  };

  const handleCancel = (): void => {
    setTitle(currentTodo.title);
    setDescription(currentTodo.description ?? '');
    setTags(currentTodo.tags.join(', '));
    setPriority(currentTodo.priority);
    setDueDate(formatDateForInput(currentTodo.dueDate));
    setIsEditing(false);
    setShowDeleteConfirm(false);
  };

  const handleAddItem = async (): Promise<void> => {
    if (newItemTitle.trim() === '') return;
    setAddingItem(true);
    try {
      const updated = await onAddItem({ title: newItemTitle.trim() });
      setCurrentTodo(updated);
      setNewItemTitle('');
      setShowAddItem(false);
    } finally {
      setAddingItem(false);
    }
  };

  const handleUpdateItem = async (
    itemId: string,
    request: UpdateTodoItemRequest
  ): Promise<void> => {
    const updated = await onUpdateItem(itemId, request);
    setCurrentTodo(updated);
  };

  const handleDeleteItem = async (itemId: string): Promise<void> => {
    const updated = await onDeleteItem(itemId);
    setCurrentTodo(updated);
  };

  const completedCount = currentTodo.items.filter((i) => i.status === 'completed').length;
  const canArchive = currentTodo.status === 'completed' || currentTodo.status === 'cancelled';

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEditing ? 'Edit Todo' : 'View Todo'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <ErrorBanner message={error} className="mb-4" />
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
                <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e): void => {
                    setDescription(e.target.value);
                  }}
                  rows={4}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Priority</label>
                  <select
                    value={priority}
                    onChange={(e): void => {
                      setPriority(e.target.value as TodoPriority);
                    }}
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e): void => {
                      setDueDate(e.target.value);
                    }}
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                </div>
              </div>
              <Input
                label="Tags (comma separated)"
                value={tags}
                onChange={(e): void => {
                  setTags(e.target.value);
                }}
                placeholder="e.g., work, important, project"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start gap-2">
                <h3 className="break-words text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {currentTodo.title}
                </h3>
                {currentTodo.archived ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                    <Archive className="h-3 w-3" />
                    Archived
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={currentTodo.status} />
                <PriorityBadge priority={currentTodo.priority} />
                {currentTodo.dueDate !== null ? (
                  <span className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    Due: {formatDate(currentTodo.dueDate)}
                  </span>
                ) : null}
              </div>
              {currentTodo.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {currentTodo.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {currentTodo.description !== null && currentTodo.description !== '' ? (
                <div className="prose prose-slate prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentTodo.description}
                  </ReactMarkdown>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1" title="Created">
                  <Calendar className="h-3 w-3" />
                  {formatDate(currentTodo.createdAt)}
                </span>
                <span className="flex items-center gap-1" title="Updated">
                  <RotateCcw className="h-3 w-3" />
                  {formatDate(currentTodo.updatedAt)}
                </span>
                <span className="flex items-center gap-1" title="Source">
                  <Link2 className="h-3 w-3" />
                  {currentTodo.source}
                </span>
              </div>
            </div>
          )}

          {/* Items Section */}
          <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-700">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-medium text-slate-900 dark:text-slate-100">
                Items ({completedCount}/{currentTodo.items.length})
              </h4>
              {isEditing && !showAddItem ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setShowAddItem(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add Item
                </Button>
              ) : null}
            </div>

            {showAddItem ? (
              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newItemTitle}
                  onChange={(e): void => {
                    setNewItemTitle(e.target.value);
                  }}
                  placeholder="New item title"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={(): void => {
                    void handleAddItem();
                  }}
                  disabled={addingItem || newItemTitle.trim() === ''}
                  isLoading={addingItem}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setShowAddItem(false);
                    setNewItemTitle('');
                  }}
                  disabled={addingItem}
                >
                  Cancel
                </Button>
              </div>
            ) : null}

            {currentTodo.items.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {sortTodoItems(currentTodo.items).map((item) => (
                    <TodoItemRow
                      key={item.id}
                      item={item}
                      isEditing={isEditing}
                      onUpdate={async (request): Promise<void> => {
                        await handleUpdateItem(item.id, request);
                      }}
                      onDelete={async (): Promise<void> => {
                        await handleDeleteItem(item.id);
                      }}
                    />
                  ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No items yet</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4 dark:border-slate-700">
          {showDeleteConfirm ? (
            <div className="flex-1 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-2 text-sm text-red-800 dark:text-red-300">Delete this todo?</p>
              <div className="flex gap-2">
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
                  Delete
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
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(): void => {
                  setShowDeleteConfirm(true);
                }}
                className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
              {canArchive || currentTodo.archived ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    void handleArchive();
                  }}
                  disabled={archiving || (!canArchive && !currentTodo.archived)}
                  isLoading={archiving}
                >
                  <Archive className="mr-1 h-4 w-4" />
                  {currentTodo.archived ? 'Unarchive' : 'Archive'}
                </Button>
              ) : null}
              {currentTodo.status !== 'completed' && currentTodo.status !== 'cancelled' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    void handleCancelTodo();
                  }}
                  disabled={cancelling}
                  isLoading={cancelling}
                  className="text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/30 dark:hover:text-orange-300"
                >
                  <Ban className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
              ) : null}
            </div>
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
