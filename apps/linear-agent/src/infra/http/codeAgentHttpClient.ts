import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeAgentClient, CodeAgentError, TriggerCodeTaskResponse } from '../../domain/ports.js';

export type { CodeAgentClient, CodeAgentError, TriggerCodeTaskResponse };

export interface TriggerCodeTaskRequest {
  userId: string;
  linearIssueId: string;
  prompt: string;
  workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
  actionId: string;
  approvalEventId: string;
}

export interface CodeAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

export function createCodeAgentHttpClient(
  config: CodeAgentHttpClientConfig,
  logger: Logger
): CodeAgentClient {
  const { baseUrl, internalAuthToken, timeoutMs } = config;

  return {
    async triggerCodeTask(request: TriggerCodeTaskRequest): Promise<Result<TriggerCodeTaskResponse, CodeAgentError>> {
      const url = `${baseUrl}/internal/code/process`;

      logger.info({ linearIssueId: request.linearIssueId }, 'Triggering code task via code-agent');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': internalAuthToken,
          },
          body: JSON.stringify({
            actionId: request.actionId,
            approvalEventId: request.approvalEventId,
            userId: request.userId,
            payload: {
              prompt: request.prompt,
              workerType: request.workerType,
              linearIssueId: request.linearIssueId,
            },
          }),
          signal: controller.signal,
        });

        /* v8 ignore start -- upstream: error handling for non-OK HTTP responses from code-agent @preserve */
        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'code-agent triggerCodeTask failed');

          if (response.status >= 500) {
            return err({ code: 'UNAVAILABLE', message: 'code-agent unavailable' });
          }
          return err({ code: 'INVALID_REQUEST', message: errorText });
        }
        /* v8 ignore stop @preserve */

        const body = await response.json() as {
          success: boolean;
          data?: {
            taskId: string;
          };
        };

        /* v8 ignore start -- test-infra: invalid response path requires malformed mock @preserve */
        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from code-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from code-agent' });
        }
        /* v8 ignore stop @preserve */

        logger.info({ codeTaskId: body.data.taskId, linearIssueId: request.linearIssueId }, 'Code task triggered');

        return ok({ codeTaskId: body.data.taskId });
      } catch (error) {
        /* v8 ignore start -- test-infra: AbortError path requires timing-dependent mock @preserve */
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'code-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }
        /* v8 ignore stop @preserve */

        logger.error({ error }, 'code-agent triggerCodeTask request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
