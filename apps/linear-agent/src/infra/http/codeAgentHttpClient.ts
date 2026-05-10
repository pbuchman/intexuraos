import { createCodeAgentServiceClient } from '@intexuraos/internal-clients';
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain';
import type { CodeAgentClient, CodeAgentError, TriggerCodeTaskResponse } from '../../domain/ports.js';

export type { CodeAgentClient, CodeAgentError, TriggerCodeTaskResponse };

export interface TriggerCodeTaskRequest {
  userId: string;
  linearIssueId: string;
  prompt: string;
  workerType: CodeTaskWorkerType;
  actionId: string;
  approvalEventId: string;
}

export interface CodeAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

function mapTriggerError(error: {
  code: 'DUPLICATE' | 'WORKER_UNAVAILABLE' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'UNAVAILABLE' | 'UNKNOWN';
  message: string;
}): CodeAgentError {
  switch (error.code) {
    case 'WORKER_UNAVAILABLE':
    case 'UNAVAILABLE':
      return { code: 'UNAVAILABLE', message: 'code-agent unavailable' };
    case 'DUPLICATE':
    case 'INVALID_REQUEST':
      return { code: 'INVALID_REQUEST', message: error.message };
    default:
      return { code: 'UNKNOWN', message: error.message };
  }
}

function mapNotifyError(error: {
  code: 'INVALID_REQUEST' | 'UNAVAILABLE' | 'UNKNOWN';
  message: string;
  status?: number;
}): CodeAgentError {
  switch (error.code) {
    case 'UNAVAILABLE':
      return { code: 'UNAVAILABLE', message: error.message };
    case 'INVALID_REQUEST':
      return { code: 'INVALID_REQUEST', message: error.message };
    default:
      return { code: 'UNKNOWN', message: error.message };
  }
}

export function createCodeAgentHttpClient(
  config: CodeAgentHttpClientConfig,
  logger: Logger
): CodeAgentClient {
  const client = createCodeAgentServiceClient({
    baseUrl: config.baseUrl,
    internalAuthToken: config.internalAuthToken,
    defaultTimeoutMs: config.timeoutMs,
    logger,
  });

  return {
    async triggerCodeTask(
      request: TriggerCodeTaskRequest
    ): Promise<Result<TriggerCodeTaskResponse, CodeAgentError>> {
      const result = await client.submitTask({
        actionId: request.actionId,
        approvalEventId: request.approvalEventId,
        userId: request.userId,
        payload: {
          prompt: request.prompt,
          workerType: request.workerType,
          linearIssueId: request.linearIssueId,
        },
      });

      if (!result.ok) {
        return err(mapTriggerError(result.error));
      }

      return ok({ codeTaskId: result.value.codeTaskId });
    },

    async notifyGroupSummaryRecompute(request: {
      userId: string;
      linearIssueId: string;
      labels: { id: string; name: string }[];
      sourceTimestamp: string;
    }): Promise<Result<void, CodeAgentError>> {
      const result = await client.notifyGroupSummaryRecompute(request);
      if (!result.ok) {
        if (result.error.status !== undefined && result.error.status >= 400 && result.error.status < 500) {
          const logPayload = {
            status: result.error.status,
            error: result.error.message,
            linearIssueId: request.linearIssueId,
          };

          if (result.error.status === 404) {
            logger.info(logPayload, 'code-agent notifyGroupSummaryRecompute failed');
          } else {
            logger.warn(logPayload, 'code-agent notifyGroupSummaryRecompute failed');
          }
        }
        return err(mapNotifyError(result.error));
      }
      return ok(undefined);
    },
  };
}
