import type { TodosCreateTodoRequest } from '@intexuraos/http-contracts';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { ServiceFeedbackRequestOptions } from '../shared/serviceFeedback.js';

export interface TodosAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type CreateTodoRequest = TodosCreateTodoRequest;

export type TodosAgentRequestOptions = ServiceFeedbackRequestOptions;

export interface TodosAgentServiceClient {
  createTodo(
    request: CreateTodoRequest,
    options?: TodosAgentRequestOptions
  ): Promise<Result<ServiceFeedback>>;
}
