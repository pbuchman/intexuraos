import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  CreateTodoRequest,
  TodosAgentServiceClient,
  TodosAgentServiceConfig,
  TodosAgentRequestOptions,
} from './types.js';

export function createTodosAgentServiceClient(
  config: TodosAgentServiceConfig
): TodosAgentServiceClient {
  return {
    async createTodo(
      request: CreateTodoRequest,
      options?: TodosAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      return await postServiceFeedback(config, {
        path: '/internal/todos',
        body: request,
        options,
        invalidJsonMessage: 'Invalid response from todos-agent',
        invalidEnvelopeMessage: 'Invalid response from todos-agent',
        networkErrorPrefix: 'Failed to call todos-agent',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: ${response.statusText}`,
      });
    },
  };
}
