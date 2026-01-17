import type { Result, ServiceFeedback } from '@intexuraos/common-core';

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

export interface TodosServiceClient {
  createTodo(request: CreateTodoRequest): Promise<Result<ServiceFeedback>>;
}
