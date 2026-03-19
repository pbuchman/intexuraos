import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, ListTodo, Plus } from 'lucide-react';
import { Button, ErrorBanner, Layout } from '@/components';
import { TodoModal } from '@/components/todos/TodoModal.js';
import { CreateTodoModal } from '@/components/todos/CreateTodoModal.js';
import { TodoRow } from '@/components/todos/TodoRow.js';
import {
  PRIORITY_ORDER,
  TODO_FILTER_CONFIG,
  TODO_GROUP_STATUSES,
  TODO_SORT_OPTIONS,
  type TodoSortOption,
} from '@/components/todos/shared.js';
import { useTodos } from '@/hooks';
import type { Todo, TodoStatus } from '@/types';

const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

function getStoredStatuses(): Set<TodoStatus> {
  try {
    const stored = localStorage.getItem('todos-status-filter');
    if (stored !== null) {
      const parsed = JSON.parse(stored) as TodoStatus[];
      return new Set(parsed);
    }
  } catch {
    // ignore
  }
  // Default: all except cancelled
  return new Set(TODO_GROUP_STATUSES.filter((s) => s !== 'cancelled'));
}

function getStoredSort(): TodoSortOption {
  const stored = localStorage.getItem('todos-sort');
  if (stored === 'created' || stored === 'priority' || stored === 'updated') return stored;
  return 'created';
}

export function TodosListPage(): React.JSX.Element {
  const {
    todos,
    loading,
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
  const [activeStatuses, setActiveStatuses] = useState<Set<TodoStatus>>(getStoredStatuses);
  const [sort, setSort] = useState<TodoSortOption>(getStoredSort);

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

  const toggleStatus = (status: TodoStatus): void => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      localStorage.setItem('todos-status-filter', JSON.stringify([...next]));
      return next;
    });
  };

  const handleSetSort = (s: TodoSortOption): void => {
    setSort(s);
    localStorage.setItem('todos-sort', s);
  };

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<TodoStatus, number>> = {};
    for (const t of todos) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [todos]);

  const inProgressCount = statusCounts.in_progress ?? 0;

  const filteredSortedTodos = useMemo(() => {
    const filtered = todos.filter((t) => activeStatuses.has(t.status));
    return [...filtered].sort((a, b) => {
      if (sort === 'priority') {
        return (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
      }
      if (sort === 'updated') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      // created (default)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [todos, activeStatuses, sort]);

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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">My Todos</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {String(todos.length)} todos · {String(inProgressCount)} in progress
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={(): void => { setShowCreateModal(true); }}
          >
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Todo</span>
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} className="mb-6" />

      {/* R2 Filter Pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TODO_GROUP_STATUSES.map((status) => {
          const config = TODO_FILTER_CONFIG[status];
          const isActive = activeStatuses.has(status);
          const count = statusCounts[status] ?? 0;
          return (
            <button
              key={status}
              onClick={(): void => { toggleStatus(status); }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${isActive ? config.activeClass : INACTIVE_CLASS}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
              {config.label}
              <span className="font-medium">{String(count)}</span>
            </button>
          );
        })}
      </div>

      {/* R3 Sort Selector */}
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
        <div className="flex gap-1.5">
          {TODO_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => { handleSetSort(key); }}
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

      {filteredSortedTodos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ListTodo className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
          <p className="text-slate-500 dark:text-slate-400">
            {todos.length === 0 ? 'No todos yet' : 'No todos match the current filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredSortedTodos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onSelect={setSelectedTodo}
              onDelete={async (id): Promise<void> => {
                await deleteTodo(id);
              }}
            />
          ))}
        </div>
      )}

      {selectedTodo !== null ? (
        <TodoModal
          todo={selectedTodo}
          onClose={(): void => { setSelectedTodo(null); }}
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
          onClose={(): void => { setShowCreateModal(false); }}
          onCreate={createTodo}
        />
      ) : null}
    </Layout>
  );
}
