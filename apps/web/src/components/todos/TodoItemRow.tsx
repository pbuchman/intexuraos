import { useState } from 'react';
import { Calendar, Edit2, Trash2 } from 'lucide-react';
import { Button, Input } from '@/components';
import { ItemStatusIcon, PriorityBadge } from '@/components/todos/shared.js';
import { formatDate, formatDateForInput } from '@/utils/dateFormat.js';
import type { TodoItem, TodoPriority, TodoStatus, UpdateTodoItemRequest } from '@/types';

export interface TodoItemRowProps {
  item: TodoItem;
  isEditing: boolean;
  onUpdate: (request: UpdateTodoItemRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function TodoItemRow({ item, isEditing, onUpdate, onDelete }: TodoItemRowProps): React.JSX.Element {
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
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
        <Input
          label="Title"
          value={title}
          onChange={(e): void => {
            setTitle(e.target.value);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Priority</label>
            <select
              value={priority}
              onChange={(e): void => {
                setPriority(e.target.value as TodoPriority | '');
              }}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="">None</option>
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
          className={`break-words text-sm ${item.status === 'completed' ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}
        >
          {item.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {item.priority !== null ? <PriorityBadge priority={item.priority} /> : null}
          {item.dueDate !== null ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(item.dueDate)}
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
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(): void => {
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {showDeleteConfirm ? (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 dark:border-red-800 dark:bg-red-900/30">
          <span className="text-xs text-red-800 dark:text-red-300">Delete?</span>
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
      ) : null}
    </div>
  );
}
