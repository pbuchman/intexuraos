import type { Result } from '@intexuraos/common-core';

export interface CreateTodoRequest {
  userId: string;
  title: string;
  description?: string | null;
  tags: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string | null;
  source: string;
  sourceId: string;
}

export interface CreateTodoResponse {
  id: string;
  userId: string;
  title: string;
  status: string;
}

export interface TodosServiceClient {
  createTodo(request: CreateTodoRequest): Promise<Result<CreateTodoResponse>>;
}
