export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority | null;
  dueDate: Date | null;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  tags: string[];
  priority: TodoPriority;
  dueDate: Date | null;
  source: string;
  sourceId: string;
  status: TodoStatus;
  archived: boolean;
  items: TodoItem[];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTodoInput {
  userId: string;
  title: string;
  description?: string | null | undefined;
  tags: string[];
  priority?: TodoPriority | undefined;
  dueDate?: Date | null | undefined;
  source: string;
  sourceId: string;
  items?: CreateTodoItemInput[] | undefined;
}

export interface CreateTodoItemInput {
  title: string;
  priority?: TodoPriority | null | undefined;
  dueDate?: Date | null | undefined;
}

export interface UpdateTodoInput {
  title?: string | undefined;
  description?: string | null | undefined;
  tags?: string[] | undefined;
  priority?: TodoPriority | undefined;
  dueDate?: Date | null | undefined;
}

export interface UpdateTodoItemInput {
  title?: string | undefined;
  status?: TodoStatus | undefined;
  priority?: TodoPriority | null | undefined;
  dueDate?: Date | null | undefined;
}

export interface TodoFilters {
  status?: TodoStatus | undefined;
  archived?: boolean | undefined;
  priority?: TodoPriority | undefined;
  tags?: string[] | undefined;
}

export interface ReorderItemsInput {
  itemIds: string[];
}
