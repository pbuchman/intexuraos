import type { ResearchCreateDraftRequest } from '@intexuraos/http-contracts';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { ServiceFeedbackRequestOptions } from '../shared/serviceFeedback.js';

export interface ResearchAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type CreateResearchDraftRequest = ResearchCreateDraftRequest;

export type ResearchAgentRequestOptions = ServiceFeedbackRequestOptions;

export interface ResearchAgentServiceClient {
  createDraft(
    request: CreateResearchDraftRequest,
    options?: ResearchAgentRequestOptions
  ): Promise<Result<ServiceFeedback>>;
}
