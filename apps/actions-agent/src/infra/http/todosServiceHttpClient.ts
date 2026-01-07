import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  TodosServiceClient,
  CreateTodoRequest,
  CreateTodoResponse,
} from '../../domain/ports/todosServiceClient.js';
import pino from 'pino';

export interface TodosServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'todosServiceHttpClient',
});

interface ApiResponse {
  success: boolean;
  data?: {
    id: string;
    userId: string;
    title: string;
    status: string;
  };
  error?: { code: string; message: string };
}

export function createTodosServiceHttpClient(
  config: TodosServiceHttpClientConfig
): TodosServiceClient {
  return {
    async createTodo(request: CreateTodoRequest): Promise<Result<CreateTodoResponse>> {
      const url = `${config.baseUrl}/internal/todos/todos`;

      logger.info({ url, userId: request.userId }, 'Creating todo via todos-agent');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(request),
        });
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to call todos-agent');
        return err(new Error(`Failed to call todos-agent: ${getErrorMessage(error)}`));
      }

      if (!response.ok) {
        logger.error(
          { httpStatus: response.status, statusText: response.statusText },
          'todos-agent returned error'
        );
        return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
      }

      const body = (await response.json()) as ApiResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from todos-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from todos-agent'));
      }

      const result: CreateTodoResponse = {
        id: body.data.id,
        userId: body.data.userId,
        title: body.data.title,
        status: body.data.status,
      };

      logger.info({ todoId: result.id }, 'Todo created successfully');
      return ok(result);
    },
  };
}
