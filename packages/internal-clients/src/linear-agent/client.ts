import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  LinearAgentRequestOptions,
  LinearAgentServiceClient,
  LinearAgentServiceConfig,
} from './types.js';

export function createLinearAgentServiceClient(
  config: LinearAgentServiceConfig
): LinearAgentServiceClient {
  return {
    async processAction(
      actionId: string,
      userId: string,
      text: string,
      options?: LinearAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      return await postServiceFeedback(config, {
        path: '/internal/linear/process-action',
        body: {
          action: {
            id: actionId,
            userId,
            text,
            ...(options?.summary !== undefined ? { summary: options.summary } : {}),
          },
        },
        options,
        invalidJsonMessage: 'Invalid response from linear-agent',
        invalidEnvelopeMessage: 'Invalid response from linear-agent',
        networkErrorPrefix: 'Failed to call linear-agent',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: ${response.statusText}`,
      });
    },
  };
}
