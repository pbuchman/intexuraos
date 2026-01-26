import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Ban,
  Calendar,
  Check,
  CheckSquare,
  Circle,
  Edit2,
  Link2,
  ListTodo,
  Plus,
  RotateCcw,
  Square,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Card, Input, Layout, RefreshIndicator } from '@/components';
import { useTodos } from '@/hooks';
import type {
  CreateTodoItemRequest,
  CreateTodoRequest,
  Todo,
  TodoItem,
  TodoPriority,
  TodoStatus,
  UpdateTodoItemRequest,
  UpdateTodoRequest,
} from '@/types';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDueDate(isoString: string | null): string {
  if (isoString === null) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateForInput(isoString: string | null): string {
  if (isoString === null) return '';
  const date = new Date(isoString);
  return date.toISOString().split('T')[0] ?? '';
}

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-700' },
  medium: { label: 'Medium', className: 'bg-blue-100 text-blue-700' },
  high: { label: 'High', className: 'bg-orange-100 text-orange-700' },
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700' },
};

const STATUS_CONFIG: Record<TodoStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700' },
  processing: { label: 'Processing', className: 'bg-purple-100 text-purple-700' },
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700' },
};

function PriorityBadge({ priority }: { priority: TodoPriority }): React.JSX.Element {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function StatusBadge({ status }: { status: TodoStatus }): React.JSX.Element {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function ItemStatusIcon({ status }: { status: TodoStatus }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckSquare className="h-4 w-4 text-green-600" />;
    case 'in_progress':
      return <Circle className="h-4 w-4 text-blue-600" />;
    case 'cancelled':
      return <X className="h-4 w-4 text-red-600" />;
    default:
      return <Square className="h-4 w-4 text-slate-400" />;
  }
}

interface TodoItemRowProps {
  item: TodoItem;
  isEditing: boolean;
  onUpdate: (request: UpdateTodoItemRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}

function TodoItemRow({ item, isEditing, onUpdate, onDelete }: TodoItemRowProps): React.JSX.Element {
  const [editingItem, setEditingItem] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [priority, setPriority] = useState<TodoPriority | ''>(item.priority ?? '');
  const [dueDate, setDueDate] = useState(formatDateForInput(item.dueDate));
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleToggleStatus = async (): Promise<void> => {
    const newStatus: TodoStatus = item.status === 'completed' ? 'pending' : 'completed';
    await onUpdate({ status: newStatus });
  };

  const handleSaveItem = async (): Promise<void> => {
    setSaving(true);
    try {
      await onUpdate({
        title,
        priority: priority === '' ? null : priority,
        dueDate: dueDate !== '' ? new Date(dueDate).toISOString() : null,
      });
      setEditingItem(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleCancelEdit = (): void => {
    setTitle(item.title);
    setPriority(item.priority ?? '');
    setDueDate(formatDateForInput(item.dueDate));
    setEditingItem(false);
    setShowDeleteConfirm(false);
  };

  if (editingItem) {
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Input
          label="Title"
          value={title}
          onChange={(e): void => {
            setTitle(e.target.value);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Priority</label>
            <select
              value={priority}
              onChange={(e): void => {
                setPriority(e.target.value as TodoPriority | '');
              }}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e): void => {
                setDueDate(e.target.value);
              }}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCancelEdit}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={(): void => {
              void handleSaveItem();
            }}
            disabled={saving}
            isLoading={saving}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-2">
      <button
        type="button"
        onClick={(): void => {
          void handleToggleStatus();
        }}
        className="mt-0.5 shrink-0"
      >
        <ItemStatusIcon status={item.status} />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`break-words text-sm ${item.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}
        >
          {item.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {item.priority !== null ? <PriorityBadge priority={item.priority} /> : null}
          {item.dueDate !== null ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDueDate(item.dueDate)}
            </span>
          ) : null}
        </div>
      </div>
      {isEditing && !showDeleteConfirm ? (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={(): void => {
              setEditingItem(true);
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(): void => {
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {showDeleteConfirm ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-red-600">Delete?</span>
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
            Yes
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
            No
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface TodoModalProps {
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

function TodoModal({
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

  const handleSave = async (): Promise<void> => {
    setSaving(true);
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
    try {
      const updated = currentTodo.archived ? await onUnarchive() : await onArchive();
      setCurrentTodo(updated);
    } finally {
      setArchiving(false);
    }
  };

  const handleCancelTodo = async (): Promise<void> => {
    setCancelling(true);
    try {
      const updated = await onCancel();
      setCurrentTodo(updated);
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Edit Todo' : 'View Todo'}
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
                <label htmlFor="description" className="block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e): void => {
                    setDescription(e.target.value);
                  }}
                  rows={4}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700">Priority</label>
                  <select
                    value={priority}
                    onChange={(e): void => {
                      setPriority(e.target.value as TodoPriority);
                    }}
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-slate-700">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e): void => {
                      setDueDate(e.target.value);
                    }}
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
                <h3 className="break-words text-xl font-semibold text-slate-900">
                  {currentTodo.title}
                </h3>
                {currentTodo.archived ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                    <Archive className="h-3 w-3" />
                    Archived
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={currentTodo.status} />
                <PriorityBadge priority={currentTodo.priority} />
                {currentTodo.dueDate !== null ? (
                  <span className="flex items-center gap-1 text-sm text-slate-600">
                    <Calendar className="h-4 w-4" />
                    Due: {formatDueDate(currentTodo.dueDate)}
                  </span>
                ) : null}
              </div>
              {currentTodo.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {currentTodo.tags.map((tag) => (
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
              {currentTodo.description !== null && currentTodo.description !== '' ? (
                <div className="prose prose-slate prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentTodo.description}
                  </ReactMarkdown>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
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
          <div className="mt-6 border-t border-slate-200 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-medium text-slate-900">
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
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
              <div className="divide-y divide-slate-100">
                {currentTodo.items
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((item) => (
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
              <p className="py-4 text-center text-sm text-slate-500">No items yet</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4">
          {showDeleteConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-600">Delete this todo?</span>
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
            <div className="flex gap-2">
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
                  className="text-orange-600 hover:bg-orange-50 hover:text-orange-700"
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

interface CreateTodoModalProps {
  onClose: () => void;
  onCreate: (request: CreateTodoRequest) => Promise<Todo>;
}

function CreateTodoModal({ onClose, onCreate }: CreateTodoModalProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [dueDate, setDueDate] = useState('');
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
      await onCreate({
        title: title.trim(),
        description: description !== '' ? description : null,
        tags: parsedTags,
        priority,
        dueDate: dueDate !== '' ? new Date(dueDate).toISOString() : null,
        source: 'web',
        sourceId: `web-${String(Date.now())}`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create todo');
    } finally {
      setSaving(false);
    }
  };

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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">Create New Todo</h2>
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
              placeholder="Enter todo title"
            />
            <div className="space-y-1">
              <label
                htmlFor="create-description"
                className="block text-sm font-medium text-slate-700"
              >
                Description
              </label>
              <textarea
                id="create-description"
                value={description}
                onChange={(e): void => {
                  setDescription(e.target.value);
                }}
                rows={4}
                placeholder="Enter todo description"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Priority</label>
                <select
                  value={priority}
                  onChange={(e): void => {
                    setPriority(e.target.value as TodoPriority);
                  }}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e): void => {
                    setDueDate(e.target.value);
                  }}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            Create Todo
          </Button>
        </div>
      </div>
    </div>
  );
}

interface TodoRowProps {
  todo: Todo;
  onOpen: () => void;
}

function TodoRow({ todo, onOpen }: TodoRowProps): React.JSX.Element {
  const completedCount = todo.items.filter((i) => i.status === 'completed').length;
  const isPastDue =
    todo.dueDate !== null && new Date(todo.dueDate) < new Date() && todo.status !== 'completed';

  return (
    <Card>
      <button onClick={onOpen} className="w-full cursor-pointer text-left" type="button">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-slate-900 transition-colors hover:text-blue-600">
                {todo.title}
              </h3>
              {todo.archived ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  <Archive className="h-3 w-3" />
                  Archived
                </span>
              ) : null}
            </div>
            {todo.description !== null && todo.description !== '' ? (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{todo.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={todo.status} />
              <PriorityBadge priority={todo.priority} />
              {todo.items.length > 0 ? (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Check className="h-3 w-3" />
                  {completedCount}/{todo.items.length}
                </span>
              ) : null}
              {todo.dueDate !== null ? (
                <span
                  className={`flex items-center gap-1 text-xs ${isPastDue ? 'text-red-600' : 'text-slate-500'}`}
                >
                  {isPastDue ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <Calendar className="h-3 w-3" />
                  )}
                  {formatDueDate(todo.dueDate)}
                </span>
              ) : null}
            </div>
            {todo.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {todo.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {tag}
                  </span>
                ))}
                {todo.tags.length > 3 ? (
                  <span className="text-xs text-slate-400">+{todo.tags.length - 3} more</span>
                ) : null}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-slate-400">Updated {formatDate(todo.updatedAt)}</p>
          </div>
        </div>
      </button>
    </Card>
  );
}

export function TodosListPage(): React.JSX.Element {
  const {
    todos,
    loading,
    refreshing,
    error,
    createTodo,
    updateTodo,
    deleteTodo,
    archiveTodo,
    unarchiveTodo,
    cancelTodo,
    addItem,
    updateItem,
    deleteItem,
  } = useTodos();
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const todoId = searchParams.get('id');
    if (todoId !== null && todos.length > 0) {
      const todo = todos.find((t) => t.id === todoId);
      if (todo !== undefined) {
        setSelectedTodo(todo);
        setSearchParams({}, { replace: true });
      }
    }
  }, [todos, searchParams, setSearchParams]);

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
          <h2 className="text-2xl font-bold text-slate-900">My Todos</h2>
          <p className="text-slate-600">Manage your tasks and track progress.</p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            setShowCreateModal(true);
          }}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Todo</span>
        </Button>
      </div>

      <RefreshIndicator show={refreshing} />

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {todos.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListTodo className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No todos yet</h3>
            <p className="mb-4 text-slate-500">Create your first todo to get started.</p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                setShowCreateModal(true);
              }}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Todo</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onOpen={(): void => {
                setSelectedTodo(todo);
              }}
            />
          ))}
        </div>
      )}

      {selectedTodo !== null ? (
        <TodoModal
          todo={selectedTodo}
          onClose={(): void => {
            setSelectedTodo(null);
          }}
          onUpdate={async (request): Promise<Todo> => {
            const updated = await updateTodo(selectedTodo.id, request);
            setSelectedTodo(updated);
            return updated;
          }}
          onDelete={async (): Promise<void> => {
            await deleteTodo(selectedTodo.id);
          }}
          onArchive={async (): Promise<Todo> => {
            const updated = await archiveTodo(selectedTodo.id);
            setSelectedTodo(updated);
            return updated;
          }}
          onUnarchive={async (): Promise<Todo> => {
            const updated = await unarchiveTodo(selectedTodo.id);
            setSelectedTodo(updated);
            return updated;
          }}
          onCancel={async (): Promise<Todo> => {
            const updated = await cancelTodo(selectedTodo.id);
            setSelectedTodo(updated);
            return updated;
          }}
          onAddItem={async (request): Promise<Todo> => {
            const updated = await addItem(selectedTodo.id, request);
            setSelectedTodo(updated);
            return updated;
          }}
          onUpdateItem={async (itemId, request): Promise<Todo> => {
            const updated = await updateItem(selectedTodo.id, itemId, request);
            setSelectedTodo(updated);
            return updated;
          }}
          onDeleteItem={async (itemId): Promise<Todo> => {
            const updated = await deleteItem(selectedTodo.id, itemId);
            setSelectedTodo(updated);
            return updated;
          }}
        />
      ) : null}

      {showCreateModal ? (
        <CreateTodoModal
          onClose={(): void => {
            setShowCreateModal(false);
          }}
          onCreate={createTodo}
        />
      ) : null}
    </Layout>
  );
}
