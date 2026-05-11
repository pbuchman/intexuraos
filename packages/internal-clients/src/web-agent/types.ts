import type { Result } from '@intexuraos/common-core';
import type {
  WebAgentLinkPreview as SharedWebAgentLinkPreview,
  WebAgentPageSummary as SharedWebAgentPageSummary,
  WebAgentSummarizePageRequest,
} from '@intexuraos/http-contracts';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';

export interface WebAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export interface WebAgentRequestOptions {
  requestId?: string;
  timeoutMs?: number;
}

export type WebAgentLinkPreview = SharedWebAgentLinkPreview;

export interface WebAgentLinkPreviewError {
  code: 'FETCH_FAILED' | 'PARSE_FAILED' | 'TIMEOUT' | 'TOO_LARGE';
  message: string;
}

export type WebAgentPageSummaryRequest = WebAgentSummarizePageRequest;

export type WebAgentPageSummary = SharedWebAgentPageSummary;

export interface WebAgentPageSummaryError {
  code:
    | 'API_ERROR'
    | 'FETCH_FAILED'
    | 'TIMEOUT'
    | 'TOO_LARGE'
    | 'INVALID_URL'
    | 'RATE_LIMITED'
    | 'NO_CONTENT';
  message: string;
  transient: boolean;
}

export interface WebAgentServiceClient {
  fetchPreview(
    url: string,
    options?: WebAgentRequestOptions
  ): Promise<Result<WebAgentLinkPreview, WebAgentLinkPreviewError>>;

  summarizePage(
    request: WebAgentPageSummaryRequest,
    options?: WebAgentRequestOptions
  ): Promise<Result<WebAgentPageSummary, WebAgentPageSummaryError>>;
}
