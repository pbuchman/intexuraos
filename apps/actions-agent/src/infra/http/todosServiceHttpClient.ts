import { createTodosAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type {
  TodosServiceClient,
  CreateTodoRequest,
} from '../../domain/ports/todosServiceClient.js';
import type { Logger } from 'pino';

export interface TodosServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export function createTodosServiceHttpClient(
  config: TodosServiceHttpClientConfig
): TodosServiceClient {
  const client = createTodosAgentServiceClient(config);

  return {
    async createTodo(request: CreateTodoRequest): Promise<Result<ServiceFeedback>> {
      return await client.createTodo(request);
    },
  };
}
