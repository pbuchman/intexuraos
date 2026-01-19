import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  TodosServiceClient,
  CreateTodoRequest,
} from '../../domain/ports/todosServiceClient.js';
import { type Logger } from 'pino';

export interface TodosServiceHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

interface ApiResponse {
  success: boolean;
  data?: {
    status: 'completed' | 'failed';
    message: string;
    resourceUrl?: string;
    errorCode?: string;
  };
  error?: { code: string; message: string };
}

export function createTodosServiceHttpClient(
  config: TodosServiceHttpClientConfig
): TodosServiceClient {
  const { logger } = config;

  return {
    async createTodo(request: CreateTodoRequest): Promise<Result<ServiceFeedback>> {
      const url = `${config.baseUrl}/internal/todos`;

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

      let body: ApiResponse;
      try {
        body = (await response.json()) as ApiResponse;
      } catch {
        if (!response.ok) {
          logger.error(
            { httpStatus: response.status, statusText: response.statusText },
            'todos-agent returned error (non-JSON response)'
          );
          return err(new Error(`HTTP ${String(response.status)}: ${response.statusText}`));
        }
        logger.error({ httpStatus: response.status }, 'Invalid JSON response from todos-agent');
        return err(new Error('Invalid response from todos-agent'));
      }

      if (!response.ok) {
        const errorCode = body.error?.code;
        const errorMessage = body.error?.message ?? `HTTP ${String(response.status)}: ${response.statusText}`;
        logger.error(
          { httpStatus: response.status, statusText: response.statusText, errorCode, errorMessage },
          'todos-agent returned error'
        );
        return ok({
          status: 'failed',
          message: errorMessage,
          ...(errorCode !== undefined && { errorCode }),
        });
      }
      if (!body.success || body.data === undefined) {
        logger.error({ body }, 'Invalid response from todos-agent');
        return err(new Error(body.error?.message ?? 'Invalid response from todos-agent'));
      }

      const result: ServiceFeedback = {
        status: body.data.status,
        message: body.data.message,
        ...(body.data.resourceUrl !== undefined && { resourceUrl: body.data.resourceUrl }),
        ...(body.data.errorCode !== undefined && { errorCode: body.data.errorCode }),
      };

      logger.info({ status: result.status }, 'Todo action processed');
      return ok(result);
    },
  };
}
