import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { ServiceFeedbackRequestOptions } from '../shared/serviceFeedback.js';

export interface LinearAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface LinearAgentRequestOptions extends ServiceFeedbackRequestOptions {
  summary?: string;
}

export interface LinearAgentServiceClient {
  processAction(
    actionId: string,
    userId: string,
    text: string,
    options?: LinearAgentRequestOptions
  ): Promise<Result<ServiceFeedback>>;
}
