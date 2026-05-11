import { createCodeAgentServiceClient } from '@intexuraos/internal-clients';
import { err, type Result } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '@intexuraos/internal-clients';
import type {
  CodeAgentClient,
  CodeAgentError,
  CancelTaskError,
  CancelTaskWithNonceInput,
  CancelTaskWithNonceOutput,
  SubmitToPhase2Input,
  SubmitToPhase2Output,
  SubmitToPhase2Error,
} from '../../domain/ports/codeAgentClient.js';
import type { CodeActionPayload } from '../../domain/models/action.js';

export interface CodeAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
}

function mapSubmitTaskError(error: {
  code: 'DUPLICATE' | 'WORKER_UNAVAILABLE' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'UNAVAILABLE' | 'UNKNOWN';
  message: string;
  status?: number;
  existingTaskId?: string;
}): CodeAgentError {
  switch (error.code) {
    case 'DUPLICATE':
      return {
        code: 'DUPLICATE',
        message: error.message,
        ...(error.existingTaskId !== undefined ? { existingTaskId: error.existingTaskId } : {}),
      };
    case 'WORKER_UNAVAILABLE':
      return {
        code: 'WORKER_UNAVAILABLE',
        message: error.message,
      };
    case 'NETWORK_ERROR':
      return {
        code: 'NETWORK_ERROR',
        message: error.message,
      };
    case 'UNKNOWN':
      return {
        code: 'UNKNOWN',
        message: error.message,
      };
    default:
      return {
        code: 'UNKNOWN',
        message:
          error.status !== undefined
            ? `Unexpected response: ${String(error.status)}`
            : error.message,
      };
  }
}

export function createCodeAgentHttpClient(
  config: CodeAgentHttpClientConfig
): CodeAgentClient {
  const client = createCodeAgentServiceClient(config);

  return {
    async submitTask(input: {
      actionId: string;
      userId: string;
      approvalEventId: string;
      payload: CodeActionPayload;
    }): Promise<Result<{ codeTaskId: string; resourceUrl: string }, CodeAgentError>> {
      const result = await client.submitTask(input);
      if (!result.ok) {
        return err(mapSubmitTaskError(result.error));
      }
      return result;
    },

    async cancelTaskWithNonce(
      input: CancelTaskWithNonceInput
    ): Promise<Result<CancelTaskWithNonceOutput, CancelTaskError>> {
      return await client.cancelTaskWithNonce(input);
    },

    async submitToPhase2(
      input: SubmitToPhase2Input
    ): Promise<Result<SubmitToPhase2Output, SubmitToPhase2Error>> {
      return await client.submitToPhase2(input);
    },
  };
}
